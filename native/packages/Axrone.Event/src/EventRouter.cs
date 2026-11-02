namespace Axrone.Event;

/// <summary>
/// Single-type fan-out router over a bounded MPMC queue. Publishers stamp at the edge, one
/// background loop dispatches batches to active subscribers, failures land in dead letters.
/// </summary>
/// <remarks>
/// The dispatch loop starts at construction and drains continuously, so a publish can never spin
/// forever waiting for a future subscriber: envelopes with no active subscriber are dequeued,
/// counted as dropped, and discarded. <see cref="Publish(in TEvent)"/> spins while running;
/// <see cref="TryPublish(in TEvent)"/> is the non-blocking game-thread path.
/// </remarks>
/// <typeparam name="TEvent">Payload type.</typeparam>
public sealed class EventRouter<TEvent> : IDisposable, IAsyncDisposable
{
    private const int StateRunning = 0;
    private const int StateCompleting = 1;
    private const int StateTerminated = 2;
    private const int StateFaulted = 3;

    [ThreadStatic]
    private static bool t_immediateActive;

    private readonly VyukovBoundedBatchQueue<EventEnvelope<TEvent>> _queue;
    private readonly Internal.EventSubscriptionTable<TEvent> _subscriptions = new();
    private readonly ConcurrentQueue<DeadLetterEntry<TEvent>> _deadLetters = new();
    private readonly EventEnvelope<TEvent>[] _dispatchBuffer;
    private readonly Lock _gate = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly Task _dispatchLoop;

    private volatile List<IEventFilter<TEvent>> _filters = new();
    private volatile List<IEventInterceptor<TEvent>> _interceptors = new();

    private int _state;
    private long _sequence;
    private long _droppedUnsubscribed;
    private long _droppedPaused;
    private long _droppedDeadLetters;
    private long _reentrantDeferred;
    private long _reentrantDropped;
    private long _incompleteImmediate;
    private readonly int _deadLetterCapacity;
    private readonly EventTelemetry _telemetry;
    private ExceptionDispatchInfo? _fault;
    private int _disposed;

    /// <summary>All dequeued-but-undelivered items.</summary>
    public long DroppedItems => DroppedUnsubscribed + DroppedPaused;

    /// <summary>Items dequeued while no subscription existed.</summary>
    public long DroppedUnsubscribed => Interlocked.Read(ref _droppedUnsubscribed);

    /// <summary>Items skipped because every subscription was paused.</summary>
    public long DroppedPaused => Interlocked.Read(ref _droppedPaused);

    /// <summary>Dead letters discarded because the bound was full (oldest first).</summary>
    public long DroppedDeadLetters => Interlocked.Read(ref _droppedDeadLetters);

    /// <summary>Envelopes waiting in transport.</summary>
    public int QueuedCount => _queue.Count;

    /// <summary>Registered subscriptions.</summary>
    public int SubscriberCount => _subscriptions.Count;

    /// <summary>Immediate publishes deferred because the router was already dispatching on that thread.</summary>
    public long ReentrantDeferredPublishes => Interlocked.Read(ref _reentrantDeferred);

    /// <summary>Reentrant immediate publishes dropped because the transport was full.</summary>
    public long ReentrantDroppedPublishes => Interlocked.Read(ref _reentrantDropped);

    /// <summary>Async handlers started by immediate dispatch that had not completed synchronously.</summary>
    public long IncompleteImmediateDispatches => Interlocked.Read(ref _incompleteImmediate);

    /// <summary>Entries waiting in dead letters.</summary>
    public int DeadLetterCount => _deadLetters.Count;

    /// <summary>Creates a router with the given transport capacity (power of two).</summary>
    public EventRouter(int capacity = 65536)
        : this(RouterOptions.Default with { Capacity = capacity })
    {
    }

    /// <summary>Creates a router from options.</summary>
    public EventRouter(RouterOptions options)
    {
        if (options.DispatchBatchSize < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "DispatchBatchSize must be positive.");
        }

        if (options.DeadLetterCapacity < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "DeadLetterCapacity must be positive.");
        }

        _deadLetterCapacity = options.DeadLetterCapacity;
        _telemetry = new EventTelemetry(options.MeterName ?? "Axrone.Event");
        _dispatchBuffer = new EventEnvelope<TEvent>[options.DispatchBatchSize];
        _queue = new VyukovBoundedBatchQueue<EventEnvelope<TEvent>>(new BufferCapacity((uint)options.Capacity));
        CancellationToken token = _cts.Token;
        _dispatchLoop = Task.Factory.StartNew(
            () => DispatchLoopAsync(token),
            CancellationToken.None,
            TaskCreationOptions.LongRunning,
            TaskScheduler.Default).Unwrap();
    }

    /// <summary>Registers a publish-gate filter (copy-on-write; publishers never block).</summary>
    public void AddFilter(IEventFilter<TEvent> filter)
    {
        ArgumentNullException.ThrowIfNull(filter);
        lock (_gate)
        {
            var next = new List<IEventFilter<TEvent>>(_filters) { filter };
            _filters = next;
        }
    }

    /// <summary>Registers a publish/consumption observer (copy-on-write; publishers never block).</summary>
    public void AddInterceptor(IEventInterceptor<TEvent> interceptor)
    {
        ArgumentNullException.ThrowIfNull(interceptor);
        lock (_gate)
        {
            var next = new List<IEventInterceptor<TEvent>>(_interceptors) { interceptor };
            _interceptors = next;
        }
    }

    /// <summary>Subscribes a synchronous handler at <see cref="EventPriority.Normal"/>; starts delivery immediately.</summary>
    public IEventSubscription Subscribe(Action<EventEnvelope<TEvent>, CancellationToken> handler) =>
        Subscribe(handler, EventPriority.Normal);

    /// <summary>Subscribes a synchronous handler with an explicit dispatch priority.</summary>
    public IEventSubscription Subscribe(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority)
    {
        ArgumentNullException.ThrowIfNull(handler);
        var subscription = new EventSubscription<TEvent>(handler, RemoveSubscription, priority);
        _subscriptions.Add(subscription);
        return subscription;
    }

    /// <summary>Subscribes an asynchronous handler at <see cref="EventPriority.Normal"/>; starts delivery immediately.</summary>
    public IEventSubscription SubscribeAsync(Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler) =>
        SubscribeAsync(handler, EventPriority.Normal);

    /// <summary>Subscribes an asynchronous handler with an explicit dispatch priority.</summary>
    public IEventSubscription SubscribeAsync(
        Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler,
        EventPriority priority)
    {
        ArgumentNullException.ThrowIfNull(handler);
        var subscription = new EventSubscription<TEvent>(handler, RemoveSubscription, priority);
        _subscriptions.Add(subscription);
        return subscription;
    }

    /// <summary>
    /// Publishes a payload, spinning while the transport is full. Requires a running router;
    /// throws once completed. For subscriber-less emission use <see cref="TryPublish(in TEvent)"/>.
    /// </summary>
    public void Publish(in TEvent message)
    {
        var envelope = Stamp(message);
        PublishEnvelope(in envelope);
    }

    /// <summary>
    /// Publishes a pre-built envelope, preserving an existing stamp (replay) or stamping when
    /// unstamped. Spins while the transport is full.
    /// </summary>
    public void PublishEnvelope(in EventEnvelope<TEvent> envelope)
    {
        ProgressiveSpinBackoff.Initialize(out int backoff);
        while (!TryPublishCore(in envelope))
        {
            ThrowIfFaulted();
            if (Volatile.Read(ref _state) != StateRunning)
            {
                ThrowHelper.ThrowEngineTerminated();
            }

            ProgressiveSpinBackoff.Advance(ref backoff);
        }
    }

    /// <summary>
    /// Non-blocking publish; false when full or not running (backpressure, not an error).
    /// </summary>
    public bool TryPublish(in TEvent message)
    {
        var envelope = Stamp(message);
        return TryPublishCore(in envelope);
    }

    /// <summary>Non-blocking envelope publish; preserves an existing stamp.</summary>
    public bool TryPublishEnvelope(in EventEnvelope<TEvent> envelope) => TryPublishCore(in envelope);

    /// <summary>
    /// Dispatches synchronously on the caller thread in priority order, bypassing the transport.
    /// Reentrant calls from a handler are deferred to the transport instead of recursing.
    /// </summary>
    /// <param name="message">Payload to dispatch.</param>
    /// <returns>Active subscriptions invoked.</returns>
    public int PublishImmediate(in TEvent message)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            ThrowHelper.ThrowEngineTerminated();
        }

        EventEnvelope<TEvent> envelope = Stamp(message);
        return DispatchImmediate(in envelope);
    }

    /// <summary>
    /// Non-blocking immediate dispatch; returns zero once completed or when the transport is
    /// already running an immediate dispatch on this thread.
    /// </summary>
    /// <param name="message">Payload to dispatch.</param>
    /// <returns>Active subscriptions invoked.</returns>
    public int TryPublishImmediate(in TEvent message)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            return 0;
        }

        EventEnvelope<TEvent> envelope = Stamp(message);
        return DispatchImmediate(in envelope);
    }

    private int DispatchImmediate(in EventEnvelope<TEvent> envelope)
    {
        if (t_immediateActive)
        {
            if (TryPublishCore(in envelope))
            {
                Interlocked.Increment(ref _reentrantDeferred);
            }
            else
            {
                Interlocked.Increment(ref _reentrantDropped);
            }

            return 0;
        }

        if (!PassesPublishGate(in envelope))
        {
            return 0;
        }

        t_immediateActive = true;
        int delivered = 0;
        try
        {
            Internal.EventSubscriptionEntry<TEvent>[] entries = _subscriptions.Entries;
            for (int i = 0; i < entries.Length; i++)
            {
                EventSubscription<TEvent> subscription = entries[i].Subscription;
                if (!subscription.IsActive)
                {
                    continue;
                }

                delivered++;
                try
                {
                    ValueTask pending = subscription.InvokeAsync(in envelope, CancellationToken.None);
                    if (pending.IsCompletedSuccessfully)
                    {
                        continue;
                    }

                    if (pending.IsCompleted)
                    {
                        pending.GetAwaiter().GetResult();
                    }
                    else
                    {
                        ObserveIncompleteImmediate(pending, envelope);
                    }
                }
                catch (Exception ex)
                {
                    AddDeadLetter(DeadLetterEntry<TEvent>.Capture(
                        in envelope,
                        DeadLetterReason.HandlerException,
                        ex));
                    NotifyConsumptionError(in envelope, ex);
                }
            }

            foreach (IEventInterceptor<TEvent> interceptor in _interceptors)
            {
                interceptor.OnPublished(in envelope);
            }

            return delivered;
        }
        finally
        {
            t_immediateActive = false;
        }
    }

    private void ObserveIncompleteImmediate(ValueTask pending, EventEnvelope<TEvent> envelope)
    {
        Interlocked.Increment(ref _incompleteImmediate);
        pending.AsTask().ContinueWith(
            static (task, state) =>
            {
                var observation = (ImmediateObservation)state!;
                EventEnvelope<TEvent> observed = observation.Envelope;
                observation.Router.CompleteObservedImmediate(task, in observed);
            },
            new ImmediateObservation(this, envelope),
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private void CompleteObservedImmediate(Task pending, in EventEnvelope<TEvent> envelope)
    {
        try
        {
            pending.GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            AddDeadLetter(DeadLetterEntry<TEvent>.Capture(
                in envelope,
                DeadLetterReason.HandlerException,
                ex));
            NotifyConsumptionError(in envelope, ex);
        }
    }

    private bool PassesPublishGate(in EventEnvelope<TEvent> envelope)
    {
        foreach (IEventFilter<TEvent> filter in _filters)
        {
            if (!filter.ShouldProcess(in envelope))
            {
                return false;
            }
        }

        foreach (IEventInterceptor<TEvent> interceptor in _interceptors)
        {
            interceptor.OnPublishing(in envelope);
        }

        return true;
    }

    /// <summary>
    /// Publishes a batch, spinning while the transport is full. Filters apply per item; accepted
    /// items share one sequence-range reservation. Returns accepted items; throws once completed.
    /// </summary>
    public int PublishBatch(ReadOnlySpan<TEvent> items)
    {
        if (items.IsEmpty)
        {
            return 0;
        }

        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            ThrowHelper.ThrowEngineTerminated();
        }

        EventEnvelope<TEvent>[] buffer = ArrayPool<EventEnvelope<TEvent>>.Shared.Rent(items.Length);
        try
        {
            int accepted = FillBatch(items, buffer);
            int offset = 0;
            ProgressiveSpinBackoff.Initialize(out int backoff);
            while (offset < accepted)
            {
                int enqueued = _queue.TryEnqueueBatch(buffer.AsSpan(offset, accepted - offset));
                if (enqueued > 0)
                {
                    _telemetry.RecordPublished(enqueued);
                    NotifyPublished(buffer.AsSpan(offset, enqueued));
                    offset += enqueued;
                    continue;
                }

                ThrowIfFaulted();
                if (Volatile.Read(ref _state) != StateRunning)
                {
                    ThrowHelper.ThrowEngineTerminated();
                }

                ProgressiveSpinBackoff.Advance(ref backoff);
            }

            return accepted;
        }
        finally
        {
            ArrayPool<EventEnvelope<TEvent>>.Shared.Return(buffer, clearArray: true);
        }
    }

    /// <summary>
    /// Non-blocking batch publish; single transport reservation. Returns enqueued items
    /// (possibly partial when full); filtered items never consume slots.
    /// </summary>
    public int TryPublishBatch(ReadOnlySpan<TEvent> items)
    {
        if (items.IsEmpty)
        {
            return 0;
        }

        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            return 0;
        }

        EventEnvelope<TEvent>[] buffer = ArrayPool<EventEnvelope<TEvent>>.Shared.Rent(items.Length);
        try
        {
            int accepted = FillBatch(items, buffer);
            int enqueued = _queue.TryEnqueueBatch(buffer.AsSpan(0, accepted));
            if (enqueued > 0)
            {
                _telemetry.RecordPublished(enqueued);
                NotifyPublished(buffer.AsSpan(0, enqueued));
            }

            return enqueued;
        }
        finally
        {
            ArrayPool<EventEnvelope<TEvent>>.Shared.Return(buffer, clearArray: true);
        }
    }

    /// <summary>Filters, stamps, and observes publish intent; returns accepted items.</summary>
    private int FillBatch(ReadOnlySpan<TEvent> items, EventEnvelope<TEvent>[] buffer)
    {
        int accepted = 0;
        for (int i = 0; i < items.Length; i++)
        {
            EventEnvelope<TEvent> stamped = Stamp(in items[i]);
            if (!PassesPublishGate(in stamped))
            {
                continue;
            }

            buffer[accepted++] = stamped;
        }

        return accepted;
    }

    private void NotifyPublished(ReadOnlySpan<EventEnvelope<TEvent>> enqueued)
    {
        foreach (IEventInterceptor<TEvent> interceptor in _interceptors)
        {
            for (int i = 0; i < enqueued.Length; i++)
            {
                interceptor.OnPublished(in enqueued[i]);
            }
        }
    }

    /// <summary>Drains dead letters; the returned list is a cold-path allocation.</summary>
    public List<DeadLetterEntry<TEvent>> DrainDeadLetters()
    {
        var drained = new List<DeadLetterEntry<TEvent>>();
        while (_deadLetters.TryDequeue(out DeadLetterEntry<TEvent> entry))
        {
            drained.Add(entry);
        }

        return drained;
    }

    /// <summary>
    /// Stops accepting publishes. A clean completion lets the loop drain remaining items, then
    /// terminates; a fault stops dispatch immediately without draining.
    /// </summary>
    public void Complete(Exception? error = null)
    {
        if (error is not null)
        {
            int previous = Volatile.Read(ref _state);
            _fault = ExceptionDispatchInfo.Capture(error);
            Volatile.Write(ref _state, StateFaulted);
            EventEventSource.Log.FaultOccurred(error.GetType().Name, error.Message);
            EventEventSource.Log.StateTransition(previous, StateFaulted);
        }
        else if (Interlocked.CompareExchange(ref _state, StateCompleting, StateRunning) == StateRunning)
        {
            EventEventSource.Log.StateTransition(StateRunning, StateCompleting);
        }

        _cts.Cancel();
    }

    /// <summary>Rethrows the terminal fault captured by <see cref="Complete(Exception?)"/>.</summary>
    public void ThrowIfFaulted() => _fault?.Throw();

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Complete();
        try
        {
            _dispatchLoop.GetAwaiter().GetResult();
        }
        catch (OperationCanceledException)
        {
            // Loop observed cancellation mid-batch; shutdown is still clean.
        }

        _queue.Dispose();
        _telemetry.Dispose();
        _cts.Dispose();
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Complete();
        try
        {
            await _dispatchLoop.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Loop observed cancellation mid-batch; shutdown is still clean.
        }

        _queue.Dispose();
        _telemetry.Dispose();
        _cts.Dispose();
    }

    private bool TryPublishCore(in EventEnvelope<TEvent> envelope)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            return false;
        }

        EventEnvelope<TEvent> stamped = envelope.IsStamped ? envelope : StampEnvelope(in envelope);
        if (!PassesPublishGate(in stamped))
        {
            return true;
        }

        if (!_queue.TryEnqueue(in stamped))
        {
            return false;
        }

        _telemetry.RecordPublished(1);

        foreach (IEventInterceptor<TEvent> interceptor in _interceptors)
        {
            interceptor.OnPublished(in stamped);
        }

        return true;
    }

    private EventEnvelope<TEvent> Stamp(in TEvent message)
    {
        Guid id = Guid.NewGuid();
        return new EventEnvelope<TEvent>(
            new EventMetadata(
                id,
                id,
                Guid.Empty,
                Interlocked.Increment(ref _sequence),
                1,
                0,
                Stopwatch.GetTimestamp()),
            message);
    }

    private EventEnvelope<TEvent> StampEnvelope(in EventEnvelope<TEvent> envelope)
    {
        Guid id = Guid.NewGuid();
        EventMetadata metadata = envelope.Metadata.WithIdentity(id, id);
        metadata = metadata.WithSequence(Interlocked.Increment(ref _sequence));
        return new EventEnvelope<TEvent>(metadata, envelope.Payload);
    }

    private void RemoveSubscription(Guid subscriptionId) => _subscriptions.Remove(subscriptionId);

    /// <summary>Retains a forwarding failure in the dead-letter queue.</summary>
    internal void AddForwardingDeadLetter(
        in EventEnvelope<TEvent> envelope,
        DeadLetterReason reason,
        string? error) =>
        AddDeadLetter(new DeadLetterEntry<TEvent>(
            envelope,
            reason,
            error,
            Stopwatch.GetTimestamp()));

    private async Task DispatchLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            while (true)
            {
                int received;
                try
                {
                    received = await _queue.DequeueBatchAsync(_dispatchBuffer.AsMemory(), cancellationToken).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    break;
                }

                await DispatchBatchAsync(_dispatchBuffer.AsMemory(0, received), cancellationToken).ConfigureAwait(false);

                if (Volatile.Read(ref _state) != StateRunning && _queue.IsEmpty)
                {
                    break;
                }
            }
        }
        finally
        {
            if (Volatile.Read(ref _state) != StateFaulted)
            {
                await DrainRemainingAsync().ConfigureAwait(false);
                int previous = Interlocked.Exchange(ref _state, StateTerminated);
                EventEventSource.Log.StateTransition(previous, StateTerminated);
            }
        }
    }

    private async ValueTask DrainRemainingAsync()
    {
        while (true)
        {
            int received = _queue.TryDequeueBatch(_dispatchBuffer.AsSpan());
            if (received == 0)
            {
                break;
            }

            await DispatchBatchAsync(_dispatchBuffer.AsMemory(0, received), CancellationToken.None).ConfigureAwait(false);
        }
    }

    private async ValueTask DispatchBatchAsync(ReadOnlyMemory<EventEnvelope<TEvent>> batch, CancellationToken cancellationToken)
    {
        long start = Stopwatch.GetTimestamp();
        int dispatched = 0;
        int droppedUnsubscribed = 0;
        int droppedPaused = 0;

        for (int i = 0; i < batch.Length; i++)
        {
            EventEnvelope<TEvent> envelope = batch.Span[i];
            bool delivered = false;

            Internal.EventSubscriptionEntry<TEvent>[] entries = _subscriptions.Entries;
            for (int s = 0; s < entries.Length; s++)
            {
                EventSubscription<TEvent> subscription = entries[s].Subscription;
                if (!subscription.IsActive)
                {
                    continue;
                }

                delivered = true;
                try
                {
                    await subscription.InvokeAsync(in envelope, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    AddDeadLetter(DeadLetterEntry<TEvent>.Capture(in envelope, DeadLetterReason.HandlerException, ex));
                    NotifyConsumptionError(in envelope, ex);
                }
            }

            if (!delivered)
            {
                if (_subscriptions.Count == 0)
                {
                    droppedUnsubscribed++;
                    Interlocked.Increment(ref _droppedUnsubscribed);
                }
                else
                {
                    droppedPaused++;
                    Interlocked.Increment(ref _droppedPaused);
                }
            }
            else
            {
                dispatched++;
            }
        }

        _telemetry.RecordDispatch(dispatched, (Stopwatch.GetTimestamp() - start) * 1000d / Stopwatch.Frequency);
        if (droppedUnsubscribed > 0)
        {
            _telemetry.RecordDroppedUnsubscribed(droppedUnsubscribed);
        }

        if (droppedPaused > 0)
        {
            _telemetry.RecordDroppedPaused(droppedPaused);
        }
    }

    private void NotifyConsumptionError(in EventEnvelope<TEvent> envelope, Exception exception)
    {
        try
        {
            foreach (IEventInterceptor<TEvent> interceptor in _interceptors)
            {
                interceptor.OnConsumptionError(in envelope, exception);
            }
        }
        catch (Exception interceptorFault)
        {
            AddDeadLetter(DeadLetterEntry<TEvent>.Capture(in envelope, DeadLetterReason.DispatchFailure, interceptorFault));
        }
    }

    /// <summary>
    /// Retains a dead letter; when the bound is full the oldest entry is discarded first and
    /// counted. Count checks are approximate under concurrency; retention never exceeds the
    /// bound by more than the number of racing producers.
    /// </summary>
    private void AddDeadLetter(in DeadLetterEntry<TEvent> entry)
    {
        if (_deadLetters.Count >= _deadLetterCapacity && _deadLetters.TryDequeue(out _))
        {
            Interlocked.Increment(ref _droppedDeadLetters);
            _telemetry.RecordDeadLetterDropped();
        }

        _deadLetters.Enqueue(entry);
        _telemetry.RecordDeadLetter();
    }

    private readonly record struct ImmediateObservation(
        EventRouter<TEvent> Router,
        EventEnvelope<TEvent> Envelope);
}
