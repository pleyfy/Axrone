namespace Axrone.Event;

/// <summary>
/// Single-type fan-out router over a bounded MPMC queue. Publishers stamp at the edge, one
/// background loop dispatches batches to active subscribers, failures land in dead letters.
/// </summary>
/// <remarks>
/// The dispatch loop starts at construction and drains continuously, so a publish can never spin
/// forever waiting for a future subscriber: envelopes with no active subscriber are dequeued,
/// counted as dropped, and discarded. <see cref="Publish(in TEvent)"/> spins while running;
/// <see cref="TryPublish(in TEvent)"/> is the non-blocking game-thread path. Dispatch runs on the
/// dispatcher owned by the bus (or the process-wide dispatcher used by standalone routers):
/// producers only enqueue and signal, so publishing never schedules a thread-pool continuation
/// (allocation-free); an incomplete async handler blocks the shared dispatcher until it
/// completes, delaying the other event types served by the same dispatcher.
/// </remarks>
/// <typeparam name="TEvent">Payload type.</typeparam>
public sealed class EventRouter<TEvent> : IEventEmitter, IDisposable, IAsyncDisposable
{
    private const int StateRunning = 0;
    private const int StateCompleting = 1;
    private const int StateTerminated = 2;
    private const int StateFaulted = 3;

    [ThreadStatic]
    private static EventRouter<TEvent>? t_immediateRouter;

    /// <summary>Router currently draining transport batches on this thread.</summary>
    [ThreadStatic]
    private static EventRouter<TEvent>? t_dispatchRouter;

    private readonly VyukovBoundedBatchQueue<EventEnvelope<TEvent>> _queue;
    private readonly Internal.EventSubscriptionTable<TEvent> _subscriptions = new();
    private readonly ConcurrentQueue<DeadLetterEntry<TEvent>> _deadLetters = new();
    private readonly EventEnvelope<TEvent>[] _dispatchBuffer;
    private readonly EventMetricsRecorder _metrics = new();
    private readonly Lock _gate = new();
    private readonly Lock _drainGate = new();
    private readonly Lock _dispatchGate = new();
    private readonly CancellationTokenSource _cts = new();
    private readonly EventDispatcher _dispatcher;

    private volatile List<IEventFilter<TEvent>> _filters = new();
    private volatile List<IEventInterceptor<TEvent>> _interceptors = new();

    private int _state;
    private long _sequence;
    private long _droppedUnsubscribed;
    private long _droppedPaused;
    private long _droppedDeadLetters;
    private long _reentrantDeferred;
    private long _reentrantDropped;
    private long _filtered;
    private int _reentrantChain;
    private long _incompleteImmediate;
    private long _maxListenersWarnings;
    private readonly int _deadLetterCapacity;
    private readonly int _defaultMaxListeners;
    private readonly int _pausedBufferCapacity;
    private readonly long _maxQueueWaitTicks;
    private readonly int _maxReentrantDepth;
    private readonly MaxListenersPolicy _maxListenersPolicy;
    private readonly EventTelemetry _telemetry;
    private PausedEventBuffer<TEvent>? _pausedBuffer;
    private int _paused;
    private int _maxListeners;
    private ExceptionDispatchInfo? _fault;
    private int _disposed;
    private int _queueDisposed;

    /// <summary>Raised when a subscription is registered past <see cref="MaxListeners"/> under the warn policy.</summary>
    public event EventHandler<MaxListenersExceededEventArgs>? MaxListenersExceeded;

    /// <summary>All dequeued-but-undelivered items.</summary>
    public long DroppedItems => DroppedUnsubscribed + DroppedPaused;

    /// <summary>Items dequeued while no subscription existed.</summary>
    public long DroppedUnsubscribed => Interlocked.Read(ref _droppedUnsubscribed);

    /// <summary>Items skipped because every subscription was paused.</summary>
    public long DroppedPaused => Interlocked.Read(ref _droppedPaused);

    /// <summary>Dead letters discarded because the bound was full (oldest first).</summary>
    public long DroppedDeadLetters => Interlocked.Read(ref _droppedDeadLetters);

    /// <summary>Event type routed by this instance.</summary>
    public Type EventType => typeof(TEvent);

    /// <summary>Envelopes waiting in transport.</summary>
    public int QueuedCount => _queue.Count;

    /// <summary>Envelopes waiting in the pause buffer.</summary>
    public int BufferedCount => Volatile.Read(ref _pausedBuffer)?.Count ?? 0;

    /// <summary>Slot count of the pause buffer; the configured value until the first pause allocates it.</summary>
    public int BufferCapacity => Volatile.Read(ref _pausedBuffer)?.Capacity ?? _pausedBufferCapacity;

    /// <summary>Whether publishes are buffered instead of dispatched.</summary>
    public bool IsPaused => Volatile.Read(ref _paused) != 0;

    /// <summary>Subscription bound; zero means unlimited.</summary>
    public int MaxListeners => Volatile.Read(ref _maxListeners);

    /// <summary>Registrations that exceeded the subscription bound since construction.</summary>
    public long MaxListenersExceededCount => Interlocked.Read(ref _maxListenersWarnings);

    /// <summary>Per-router timing metrics; independent from the OpenTelemetry meter.</summary>
    public EventMetricsSnapshot Metrics => _metrics.Snapshot();

    /// <summary>Whether the allocated pause buffer lives on the pinned object heap.</summary>
    internal bool IsPausedBufferPinned => Volatile.Read(ref _pausedBuffer)?.IsPinned ?? false;

    /// <summary>Dispatcher this router is registered with.</summary>
    internal EventDispatcher Dispatcher => _dispatcher;

    /// <summary>Registered subscriptions.</summary>
    public int SubscriberCount => _subscriptions.Count;

    /// <summary>Immediate publishes deferred because the router was already dispatching on that thread.</summary>
    public long ReentrantDeferredPublishes => Interlocked.Read(ref _reentrantDeferred);

    /// <summary>Reentrant immediate publishes dropped because the transport was full.</summary>
    public long ReentrantDroppedPublishes => Interlocked.Read(ref _reentrantDropped);

    /// <summary>Envelopes rejected by a publish filter before reaching the transport.</summary>
    public long FilteredPublishes => Interlocked.Read(ref _filtered);

    /// <summary>Async handlers started by immediate dispatch that had not completed synchronously.</summary>
    public long IncompleteImmediateDispatches => Interlocked.Read(ref _incompleteImmediate);

    /// <summary>Entries waiting in dead letters.</summary>
    public int DeadLetterCount => _deadLetters.Count;

    /// <summary>Creates a router with the given transport capacity (power of two).</summary>
    public EventRouter(int capacity = 65536)
        : this(RouterOptions.Default with { Capacity = capacity })
    {
    }

    /// <summary>
    /// Creates a router from options on the process-wide standalone dispatcher. A router never
    /// starts a thread of its own.
    /// </summary>
    public EventRouter(RouterOptions options)
        : this(options, EventDispatcher.Shared)
    {
    }

    /// <summary>Creates a router owned by a bus dispatcher.</summary>
    internal EventRouter(RouterOptions options, EventDispatcher dispatcher)
    {
        ArgumentNullException.ThrowIfNull(dispatcher);

        if (options.DispatchBatchSize < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "DispatchBatchSize must be positive.");
        }

        if (options.DeadLetterCapacity < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "DeadLetterCapacity must be positive.");
        }

        if (options.MaxListeners < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "MaxListeners must be non-negative.");
        }

        if ((uint)options.MaxListenersPolicy > (uint)MaxListenersPolicy.Throw)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "MaxListenersPolicy must be Warn or Throw.");
        }

        if (options.PausedBufferCapacity < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "PausedBufferCapacity must be positive.");
        }

        if (options.MaxQueueWaitMs < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "MaxQueueWaitMs must be non-negative.");
        }

        if (options.MaxReentrantDepth < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "MaxReentrantDepth must be positive.");
        }

        _deadLetterCapacity = options.DeadLetterCapacity;
        _defaultMaxListeners = options.MaxListeners;
        _maxListeners = options.MaxListeners;
        _pausedBufferCapacity = options.PausedBufferCapacity;
        _maxQueueWaitTicks = options.MaxQueueWaitMs == 0
            ? 0
            : (long)(options.MaxQueueWaitMs * (Stopwatch.Frequency / 1000.0));
        _maxReentrantDepth = options.MaxReentrantDepth;
        _maxListenersPolicy = options.MaxListenersPolicy;
        _telemetry = new EventTelemetry(options.MeterName ?? "Axrone.Event");
        _dispatchBuffer = new EventEnvelope<TEvent>[options.DispatchBatchSize];
        _queue = new VyukovBoundedBatchQueue<EventEnvelope<TEvent>>(new BufferCapacity((uint)options.Capacity));
        _dispatcher = dispatcher;
        dispatcher.Register(this, TryDrainBatch);
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
        EventPriority priority) =>
        AddSubscription(handler, priority, once: false);

    /// <summary>
    /// Subscribes a synchronous handler that releases itself before the first delivery; later
    /// dispatches never observe it.
    /// </summary>
    public IEventSubscription SubscribeOnce(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority = EventPriority.Normal) =>
        AddSubscription(handler, priority, once: true);

    /// <summary>Subscribes an asynchronous handler at <see cref="EventPriority.Normal"/>; starts delivery immediately.</summary>
    public IEventSubscription SubscribeAsync(Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler) =>
        SubscribeAsync(handler, EventPriority.Normal);

    /// <summary>Subscribes an asynchronous handler with an explicit dispatch priority.</summary>
    public IEventSubscription SubscribeAsync(
        Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler,
        EventPriority priority) =>
        AddSubscription(handler, priority, once: false);

    /// <summary>
    /// Subscribes an asynchronous handler that releases itself before the first delivery; later
    /// dispatches never observe it.
    /// </summary>
    public IEventSubscription SubscribeOnceAsync(
        Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler,
        EventPriority priority = EventPriority.Normal) =>
        AddSubscription(handler, priority, once: true);

    /// <summary>
    /// Removes a subscription by identity. Equivalent to disposing the returned handle; returns
    /// false when the identity is not registered or was already released.
    /// </summary>
    /// <remarks>
    /// A paused subscription is still registered, so this returns true and removes it. Before
    /// this contract was fixed, <c>Pause()</c> followed by either this method or dispose leaked
    /// the registry entry permanently.
    /// </remarks>
    public bool Unsubscribe(Guid subscriptionId)
    {
        EventSubscription<TEvent>? subscription = _subscriptions.Find(subscriptionId);
        if (subscription is null)
        {
            return false;
        }

        return subscription.Release();
    }

    /// <summary>Whether a subscription with the given identity is currently registered.</summary>
    public bool HasSubscription(Guid subscriptionId) => _subscriptions.Contains(subscriptionId);

    /// <summary>
    /// Captures the subscription table in priority/registration order. The result is an immutable
    /// snapshot that enumerates without allocating.
    /// </summary>
    public SubscriptionSnapshot CaptureSubscriptions()
    {
        Internal.EventSubscriptionEntry<TEvent>[] entries = _subscriptions.Entries;
        if (entries.Length == 0)
        {
            return default;
        }

        var items = new EventSubscriptionInfo[entries.Length];
        for (int i = 0; i < entries.Length; i++)
        {
            Internal.EventSubscriptionEntry<TEvent> entry = entries[i];
            EventSubscription<TEvent> subscription = entry.Subscription;
            items[i] = new EventSubscriptionInfo(
                subscription.SubscriptionId,
                entry.Priority,
                subscription.IsOnce,
                subscription.IsActive,
                entry.Sequence);
        }

        return new SubscriptionSnapshot(items);
    }

    /// <summary>Sets the subscription bound; zero disables it.</summary>
    /// <param name="maxListeners">New bound; must be non-negative.</param>
    public void SetMaxListeners(int maxListeners)
    {
        if (maxListeners < 0)
        {
            ThrowHelper.ThrowArgumentNegative(nameof(maxListeners));
        }

        Volatile.Write(ref _maxListeners, maxListeners);
    }

    /// <summary>Restores the bound configured at construction.</summary>
    public void ResetMaxListeners() => Volatile.Write(ref _maxListeners, _defaultMaxListeners);

    /// <summary>Resets every per-router timing accumulator.</summary>
    public void ResetMetrics() => _metrics.Reset();

    /// <summary>Forwards every delivered payload to another router through an EventForwarder.</summary>
    /// <typeparam name="TTarget">Destination payload type.</typeparam>
    /// <param name="target">Destination router.</param>
    /// <param name="transform">Payload transform.</param>
    /// <param name="filter">Optional source-side filter.</param>
    /// <param name="options">Optional forwarding bounds.</param>
    public EventForwarder<TEvent, TTarget> Pipe<TTarget>(
        EventRouter<TTarget> target,
        Func<TEvent, TTarget> transform,
        IEventFilter<TEvent>? filter = null,
        EventForwardingOptions? options = null) =>
        new(this, target, transform, filter, options);

    /// <summary>Forwards every delivered payload to another router through an EventForwarder.</summary>
    /// <param name="target">Destination router.</param>
    /// <param name="filter">Optional source-side filter.</param>
    /// <param name="options">Optional forwarding bounds.</param>
    public EventForwarder<TEvent> Pipe(
        EventRouter<TEvent> target,
        IEventFilter<TEvent>? filter = null,
        EventForwardingOptions? options = null) =>
        new(this, target, filter, options);

    /// <summary>Forwards every delivered payload to another bus through an EventForwarder.</summary>
    /// <typeparam name="TTarget">Destination payload type.</typeparam>
    /// <param name="target">Destination bus.</param>
    /// <param name="transform">Payload transform.</param>
    /// <param name="filter">Optional source-side filter.</param>
    /// <param name="options">Optional forwarding bounds.</param>
    public EventForwarder<TEvent, TTarget> Pipe<TTarget>(
        EventBus target,
        Func<TEvent, TTarget> transform,
        IEventFilter<TEvent>? filter = null,
        EventForwardingOptions? options = null) =>
        new(this, target, transform, filter, options);

    private EventSubscription<TEvent> AddSubscription(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority,
        bool once)
    {
        ArgumentNullException.ThrowIfNull(handler);
        var subscription = new EventSubscription<TEvent>(handler, RemoveSubscription, priority, once);
        RegisterSubscription(subscription);
        return subscription;
    }

    private EventSubscription<TEvent> AddSubscription(
        Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler,
        EventPriority priority,
        bool once)
    {
        ArgumentNullException.ThrowIfNull(handler);
        var subscription = new EventSubscription<TEvent>(handler, RemoveSubscription, priority, once);
        RegisterSubscription(subscription);
        return subscription;
    }

    private void RegisterSubscription(EventSubscription<TEvent> subscription)
    {
        int maxListeners = MaxListeners;
        SubscriptionAddStatus status = _subscriptions.Add(
            subscription,
            maxListeners,
            _maxListenersPolicy == MaxListenersPolicy.Throw,
            out int countAfter);

        if (status == SubscriptionAddStatus.RejectedOverLimit)
        {
            ThrowHelper.ThrowMaxListenersExceeded(typeof(TEvent), countAfter + 1, maxListeners);
        }

        if (status == SubscriptionAddStatus.AddedOverLimit)
        {
            RaiseMaxListenersWarning(countAfter, maxListeners);
        }
    }

    private void RaiseMaxListenersWarning(int subscriptionCount, int maxListeners)
    {
        Interlocked.Increment(ref _maxListenersWarnings);
        EventEventSource.Log.MaxListenersExceeded(typeof(TEvent).Name, subscriptionCount, maxListeners);
        MaxListenersExceeded?.Invoke(this, new MaxListenersExceededEventArgs(typeof(TEvent), subscriptionCount, maxListeners));
    }

    /// <summary>
    /// Publishes a payload, spinning while the transport is full. Requires a running router;
    /// throws once completed. For subscriber-less emission use <see cref="TryPublish(in TEvent)"/>.
    /// </summary>
    /// <remarks>While paused, the envelope is buffered and <see cref="Flush"/> releases it.</remarks>
    public void Publish(in TEvent message)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            ThrowHelper.ThrowEngineTerminated();
        }

        long start = Stopwatch.GetTimestamp();
        EventEnvelope<TEvent> envelope = Stamp(message);
        PublishRoute route = RoutePublish(in envelope);
        if (route == PublishRoute.Transport)
        {
            PublishEnvelopeCore(in envelope);
        }

        _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
        if (route == PublishRoute.BufferFull)
        {
            ThrowHelper.ThrowBufferFull(typeof(TEvent), BufferCapacity);
        }
    }

    /// <summary>
    /// Publishes a pre-built envelope, preserving an existing stamp (replay) or stamping when
    /// unstamped. Spins while the transport is full.
    /// </summary>
    public void PublishEnvelope(in EventEnvelope<TEvent> envelope)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            ThrowHelper.ThrowEngineTerminated();
        }

        long start = Stopwatch.GetTimestamp();
        EventEnvelope<TEvent> stamped = envelope.IsStamped ? envelope : StampEnvelope(in envelope);
        PublishRoute route = RoutePublish(in stamped);
        if (route == PublishRoute.Transport)
        {
            PublishEnvelopeCore(in stamped);
        }

        _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
        if (route == PublishRoute.BufferFull)
        {
            ThrowHelper.ThrowBufferFull(typeof(TEvent), BufferCapacity);
        }
    }

    /// <summary>
    /// Non-blocking publish; false when full or not running (backpressure, not an error).
    /// Filtered events report true because the call was not backpressured; use
    /// <see cref="FilteredPublishes"/> or the batch count to observe filtering.
    /// </summary>
    public bool TryPublish(in TEvent message)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            return false;
        }

        long start = Stopwatch.GetTimestamp();
        if (!TryEnterReentrantPublish(throwOnLimit: false))
        {
            return false;
        }

        EventEnvelope<TEvent> envelope = Stamp(message);
        PublishRoute route = RoutePublish(in envelope);
        bool published = route == PublishRoute.Buffered ||
            (route == PublishRoute.Transport && TryPublishCore(in envelope));
        _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
        return published;
    }

    /// <summary>Non-blocking envelope publish; preserves an existing stamp.</summary>
    public bool TryPublishEnvelope(in EventEnvelope<TEvent> envelope)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            return false;
        }

        long start = Stopwatch.GetTimestamp();
        if (!TryEnterReentrantPublish(throwOnLimit: false))
        {
            return false;
        }

        EventEnvelope<TEvent> stamped = envelope.IsStamped ? envelope : StampEnvelope(in envelope);
        PublishRoute route = RoutePublish(in stamped);
        bool published = route == PublishRoute.Buffered ||
            (route == PublishRoute.Transport && TryPublishCore(in stamped));
        _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
        return published;
    }

    /// <summary>
    /// Non-blocking publish that reports why a payload was not accepted. Filters
    /// are evaluated once; a filtered payload is not retried.
    /// </summary>
    public EventPublishResult TryPublishWithResult(in TEvent message)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            return new EventPublishResult(EventPublishStatus.NotRunning);
        }

        long start = Stopwatch.GetTimestamp();
        if (!TryEnterReentrantPublish(throwOnLimit: false))
        {
            return new EventPublishResult(EventPublishStatus.Backpressured);
        }

        EventEnvelope<TEvent> envelope = Stamp(message);
        PublishRoute route = RoutePublish(in envelope);
        EventPublishResult result;

        if (route == PublishRoute.Buffered)
        {
            result = new EventPublishResult(EventPublishStatus.Buffered);
        }
        else if (route == PublishRoute.BufferFull)
        {
            result = new EventPublishResult(EventPublishStatus.Backpressured);
        }
        else if (!PassesPublishGate(in envelope))
        {
            result = new EventPublishResult(EventPublishStatus.Filtered);
        }
        else if (!_queue.TryEnqueue(in envelope))
        {
            result = new EventPublishResult(EventPublishStatus.Backpressured);
        }
        else
        {
            _dispatcher.Signal();
            _telemetry.RecordPublished(1);
            foreach (IEventInterceptor<TEvent> interceptor in _interceptors)
            {
                interceptor.OnPublished(in envelope);
            }

            result = new EventPublishResult(EventPublishStatus.Accepted);
        }

        _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
        return result;
    }

    /// <summary>
    /// Dispatches synchronously on the caller thread in priority order, bypassing the transport.
    /// Reentrant calls from a handler are deferred to the transport instead of recursing.
    /// </summary>
    /// <param name="message">Payload to dispatch.</param>
    /// <returns>Active subscriptions invoked; zero while paused.</returns>
    public int PublishImmediate(in TEvent message)
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            ThrowHelper.ThrowEngineTerminated();
        }

        long start = Stopwatch.GetTimestamp();
        EventEnvelope<TEvent> envelope = Stamp(message);
        PublishRoute route = RoutePublish(in envelope);
        int delivered = route == PublishRoute.Transport ? DispatchImmediate(in envelope, throwOnLimit: true) : 0;
        _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
        if (route == PublishRoute.BufferFull)
        {
            ThrowHelper.ThrowBufferFull(typeof(TEvent), BufferCapacity);
        }

        return delivered;
    }

    /// <summary>
    /// Non-blocking immediate dispatch; returns zero once completed, while paused, or when the
    /// transport is already running an immediate dispatch on this thread.
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

        long start = Stopwatch.GetTimestamp();
        EventEnvelope<TEvent> envelope = Stamp(message);
        PublishRoute route = RoutePublish(in envelope);
        int delivered = route == PublishRoute.Transport ? DispatchImmediate(in envelope, throwOnLimit: false) : 0;
        _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
        return delivered;
    }

    /// <summary>
    /// Stops transport dispatch and buffers subsequent publishes. The buffer is allocated on
    /// first use and is bounded by <see cref="RouterOptions.PausedBufferCapacity"/>.
    /// </summary>
    public void Pause()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            ThrowHelper.ThrowObjectDisposed(nameof(EventRouter<TEvent>));
        }

        _ = EnsurePausedBuffer();
        lock (_gate)
        {
            Volatile.Write(ref _paused, 1);
        }
    }

    /// <summary>
    /// Leaves the paused state and republishes buffered envelopes in FIFO order while the
    /// transport accepts them; any remainder stays buffered for the next flush.
    /// </summary>
    public void Resume()
    {
        lock (_gate)
        {
            Volatile.Write(ref _paused, 0);
        }

        _ = DrainPauseBuffer();
    }

    /// <summary>
    /// Republishes buffered envelopes in FIFO order without leaving the paused state, while the
    /// transport accepts them; buffered envelopes run through the publish gate again.
    /// </summary>
    /// <returns>Envelopes republished; the remainder stays buffered.</returns>
    public int Flush()
    {
        ThrowIfFaulted();
        if (Volatile.Read(ref _state) != StateRunning)
        {
            ThrowHelper.ThrowEngineTerminated();
        }

        return DrainPauseBuffer();
    }

    /// <summary>Discards every buffered envelope.</summary>
    /// <returns>Envelopes discarded.</returns>
    public int ClearBuffer() => Volatile.Read(ref _pausedBuffer)?.Clear() ?? 0;

    /// <summary>Copies buffered envelopes in FIFO order into a caller span.</summary>
    /// <param name="destination">Destination view; the copy stops at the smaller length.</param>
    /// <returns>Envelopes copied.</returns>
    public int CopyBufferedEnvelopes(Span<EventEnvelope<TEvent>> destination) =>
        Volatile.Read(ref _pausedBuffer)?.CopyTo(destination) ?? 0;

    private bool IsDispatchingOnCurrentThread =>
        ReferenceEquals(t_dispatchRouter, this) || ReferenceEquals(t_immediateRouter, this);

    private bool TryEnterReentrantPublish(bool throwOnLimit)
    {
        if (!IsDispatchingOnCurrentThread)
        {
            Interlocked.Exchange(ref _reentrantChain, 0);
            return true;
        }

        int depth = Interlocked.Increment(ref _reentrantChain);
        if (depth <= _maxReentrantDepth)
        {
            return true;
        }

        Interlocked.Increment(ref _reentrantDropped);
        if (throwOnLimit)
        {
            ThrowHelper.ThrowReentrantDepthExceeded(_maxReentrantDepth);
        }

        return false;
    }

    private void PublishEnvelopeCore(in EventEnvelope<TEvent> envelope)
    {
        if (IsDispatchingOnCurrentThread)
        {
            _ = TryEnterReentrantPublish(throwOnLimit: true);
            if (TryPublishCore(in envelope))
            {
                return;
            }

            Interlocked.Increment(ref _reentrantDropped);
            ThrowHelper.ThrowQueueFull(EventPriority.Normal, BufferCapacity);
        }

        _ = TryEnterReentrantPublish(throwOnLimit: false);

        ProgressiveSpinBackoff.Initialize(out int backoff);
        long started = _maxQueueWaitTicks == 0 ? 0 : Stopwatch.GetTimestamp();
        while (!TryPublishCore(in envelope))
        {
            ThrowIfFaulted();
            if (Volatile.Read(ref _state) != StateRunning)
            {
                ThrowHelper.ThrowEngineTerminated();
            }

            if (_maxQueueWaitTicks != 0 && Stopwatch.GetTimestamp() - started >= _maxQueueWaitTicks)
            {
                ThrowHelper.ThrowQueueFull(EventPriority.Normal, BufferCapacity);
            }

            ProgressiveSpinBackoff.Advance(ref backoff);
        }
    }

    private PublishRoute RoutePublish(in EventEnvelope<TEvent> envelope)
    {
        if (!IsPaused)
        {
            return PublishRoute.Transport;
        }

        PausedEventBuffer<TEvent> buffer = EnsurePausedBuffer();
        return buffer.TryEnqueue(in envelope) ? PublishRoute.Buffered : PublishRoute.BufferFull;
    }

    private PausedEventBuffer<TEvent> EnsurePausedBuffer()
    {
        PausedEventBuffer<TEvent>? buffer = Volatile.Read(ref _pausedBuffer);
        if (buffer is not null)
        {
            return buffer;
        }

        lock (_gate)
        {
            buffer = _pausedBuffer;
            if (buffer is null)
            {
                buffer = new PausedEventBuffer<TEvent>(_pausedBufferCapacity);
                Volatile.Write(ref _pausedBuffer, buffer);
            }

            return buffer;
        }
    }

    private int DrainPauseBuffer()
    {
        PausedEventBuffer<TEvent>? buffer = Volatile.Read(ref _pausedBuffer);
        if (buffer is null)
        {
            return 0;
        }

        lock (_drainGate)
        {
            int drained = 0;
            while (buffer.TryPeek(out EventEnvelope<TEvent> envelope))
            {
                long start = Stopwatch.GetTimestamp();
                bool accepted;
                try
                {
                    accepted = TryPublishCore(in envelope);
                }
                finally
                {
                    _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
                }

                if (!accepted)
                {
                    break;
                }

                _ = buffer.TryDequeue(out _);
                drained++;
            }

            return drained;
        }
    }

    private enum PublishRoute
    {
        Transport = 0,
        Buffered = 1,
        BufferFull = 2
    }

    private int DispatchImmediate(in EventEnvelope<TEvent> envelope, bool throwOnLimit)
    {
        if (t_immediateRouter is not null)
        {
            if (!TryEnterReentrantPublish(throwOnLimit))
            {
                return 0;
            }

            if (TryPublishCore(in envelope))
            {
                Interlocked.Increment(ref _reentrantDeferred);
            }
            else
            {
                Interlocked.Increment(ref _reentrantDropped);
                if (throwOnLimit)
                {
                    ThrowHelper.ThrowQueueFull(EventPriority.Normal, BufferCapacity);
                }
            }

            return 0;
        }

        _ = TryEnterReentrantPublish(throwOnLimit: false);
        if (!PassesPublishGate(in envelope))
        {
            return 0;
        }

        EventRouter<TEvent>? previousImmediate = t_immediateRouter;
        t_immediateRouter = this;
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

                bool once = subscription.IsOnce;
                if (once && !subscription.TryClaimOnce())
                {
                    continue;
                }

                delivered++;
                long executionStart = Stopwatch.GetTimestamp();
                bool pendingObserved = false;
                bool failed = false;
                try
                {
                    ValueTask pending = subscription.InvokeAsync(in envelope, CancellationToken.None);
                    if (!pending.IsCompletedSuccessfully)
                    {
                        if (pending.IsCompleted)
                        {
                            pending.GetAwaiter().GetResult();
                        }
                        else
                        {
                            ObserveIncompleteImmediate(pending, envelope, executionStart);
                            pendingObserved = true;
                        }
                    }
                }
                catch (Exception ex)
                {
                    failed = true;
                    AddDeadLetter(DeadLetterEntry<TEvent>.Capture(
                        in envelope,
                        DeadLetterReason.HandlerException,
                        ex));
                    NotifyConsumptionError(in envelope, ex);
                }
                finally
                {
                    if (!pendingObserved)
                    {
                        _metrics.RecordExecution(Stopwatch.GetTimestamp() - executionStart, failed);
                    }

                    if (once)
                    {
                        subscription.Dispose();
                    }
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
            t_immediateRouter = previousImmediate;
        }
    }

    private void ObserveIncompleteImmediate(
        ValueTask pending,
        EventEnvelope<TEvent> envelope,
        long executionStart)
    {
        Interlocked.Increment(ref _incompleteImmediate);
        pending.AsTask().ContinueWith(
            static (task, state) =>
            {
                var observation = (ImmediateObservation)state!;
                EventEnvelope<TEvent> observed = observation.Envelope;
                observation.Router.CompleteObservedImmediate(task, in observed, observation.ExecutionStart);
            },
            new ImmediateObservation(this, envelope, executionStart),
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    private void CompleteObservedImmediate(Task pending, in EventEnvelope<TEvent> envelope, long executionStart)
    {
        bool failed = false;
        try
        {
            pending.GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            failed = true;
            AddDeadLetter(DeadLetterEntry<TEvent>.Capture(
                in envelope,
                DeadLetterReason.HandlerException,
                ex));
            NotifyConsumptionError(in envelope, ex);
        }
        finally
        {
            _metrics.RecordExecution(Stopwatch.GetTimestamp() - executionStart, failed);
        }
    }

    private bool PassesPublishGate(in EventEnvelope<TEvent> envelope)
    {
        foreach (IEventFilter<TEvent> filter in _filters)
        {
            if (!filter.ShouldProcess(in envelope))
            {
                Interlocked.Increment(ref _filtered);
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

        _ = TryEnterReentrantPublish(throwOnLimit: true);
        long start = Stopwatch.GetTimestamp();
        if (IsPaused)
        {
            PausedEventBuffer<TEvent> pauseBuffer = EnsurePausedBuffer();
            int buffered = 0;
            while (buffered < items.Length)
            {
                EventEnvelope<TEvent> stamped = Stamp(in items[buffered]);
                if (!pauseBuffer.TryEnqueue(in stamped))
                {
                    break;
                }

                buffered++;
            }

            _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
            if (buffered < items.Length)
            {
                ThrowHelper.ThrowBufferFull(typeof(TEvent), pauseBuffer.Capacity);
            }

            return buffered;
        }

        EventEnvelope<TEvent>[] buffer = ArrayPool<EventEnvelope<TEvent>>.Shared.Rent(items.Length);
        try
        {
            int accepted = FillBatch(items, buffer);
            int offset = 0;
            ProgressiveSpinBackoff.Initialize(out int backoff);
            long started = _maxQueueWaitTicks == 0 ? 0 : Stopwatch.GetTimestamp();
            while (offset < accepted)
            {
                int enqueued = _queue.TryEnqueueBatch(buffer.AsSpan(offset, accepted - offset));
                if (enqueued > 0)
                {
                    _dispatcher.Signal();
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

                if (_maxQueueWaitTicks != 0 && Stopwatch.GetTimestamp() - started >= _maxQueueWaitTicks)
                {
                    ThrowHelper.ThrowQueueFull(EventPriority.Normal, BufferCapacity);
                }

                ProgressiveSpinBackoff.Advance(ref backoff);
            }

            _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
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

        if (!TryEnterReentrantPublish(throwOnLimit: false))
        {
            return 0;
        }

        long start = Stopwatch.GetTimestamp();
        if (IsPaused)
        {
            PausedEventBuffer<TEvent> pauseBuffer = EnsurePausedBuffer();
            int buffered = 0;
            while (buffered < items.Length)
            {
                EventEnvelope<TEvent> stamped = Stamp(in items[buffered]);
                if (!pauseBuffer.TryEnqueue(in stamped))
                {
                    break;
                }

                buffered++;
            }

            _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
            return buffered;
        }

        EventEnvelope<TEvent>[] buffer = ArrayPool<EventEnvelope<TEvent>>.Shared.Rent(items.Length);
        try
        {
            int accepted = FillBatch(items, buffer);
            int enqueued = _queue.TryEnqueueBatch(buffer.AsSpan(0, accepted));
            if (enqueued > 0)
            {
                _dispatcher.Signal();
                _telemetry.RecordPublished(enqueued);
                NotifyPublished(buffer.AsSpan(0, enqueued));
            }

            _metrics.RecordEmit(Stopwatch.GetTimestamp() - start);
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

        _dispatcher.Signal();
        _cts.Cancel();
    }

    /// <summary>Rethrows the terminal fault captured by <see cref="Complete(Exception?)"/>.</summary>
    public void ThrowIfFaulted() => _fault?.Throw();

    /// <inheritdoc/>
    public void Dispose()
    {
        DisposeCore();
        GC.SuppressFinalize(this);
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        DisposeCore();
        GC.SuppressFinalize(this);
        return ValueTask.CompletedTask;
    }

    private void DisposeCore()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Complete();
        lock (_dispatchGate)
        {
            if (Volatile.Read(ref _state) != StateFaulted)
            {
                while (true)
                {
                    int received = _queue.TryDequeueBatch(_dispatchBuffer.AsSpan());
                    if (received == 0)
                    {
                        break;
                    }

                    DispatchBatch(_dispatchBuffer.AsMemory(0, received), CancellationToken.None);
                }

                int previous = Interlocked.Exchange(ref _state, StateTerminated);
                if (previous != StateTerminated)
                {
                    EventEventSource.Log.StateTransition(previous, StateTerminated);
                }
            }

            Volatile.Write(ref _queueDisposed, 1);
        }

        _dispatcher.Unregister(this);
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

        _dispatcher.Signal();
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

    /// <summary>Drains at most one transport batch for the shared dispatcher.</summary>
    /// <returns><see langword="true"/> when a batch was dispatched; false when idle or excluded.</returns>
    internal bool TryDrainBatch()
    {
        if (Volatile.Read(ref _queueDisposed) != 0 || Volatile.Read(ref _state) == StateFaulted)
        {
            return false;
        }

        if (!_dispatchGate.TryEnter())
        {
            return false;
        }

        try
        {
            if (Volatile.Read(ref _queueDisposed) != 0)
            {
                return false;
            }

            int received = _queue.TryDequeueBatch(_dispatchBuffer.AsSpan());
            if (received == 0)
            {
                if (Volatile.Read(ref _state) == StateCompleting)
                {
                    Interlocked.CompareExchange(ref _state, StateTerminated, StateCompleting);
                }

                return false;
            }

            DispatchBatch(_dispatchBuffer.AsMemory(0, received), _cts.Token);
            return true;
        }
        finally
        {
            _dispatchGate.Exit();
        }
    }

    private void DispatchBatch(ReadOnlyMemory<EventEnvelope<TEvent>> batch, CancellationToken cancellationToken)
    {
        EventRouter<TEvent>? previousDispatch = t_dispatchRouter;
        t_dispatchRouter = this;
        try
        {
            DispatchBatchCore(batch, cancellationToken);
        }
        finally
        {
            t_dispatchRouter = previousDispatch;
        }
    }

    private void DispatchBatchCore(ReadOnlyMemory<EventEnvelope<TEvent>> batch, CancellationToken cancellationToken)
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

                bool once = subscription.IsOnce;
                if (once && !subscription.TryClaimOnce())
                {
                    continue;
                }

                delivered = true;
                long executionStart = Stopwatch.GetTimestamp();
                bool failed = false;
                try
                {
                    ValueTask pending = subscription.InvokeAsync(in envelope, cancellationToken);
                    if (!pending.IsCompletedSuccessfully)
                    {
                        if (pending.IsCompleted)
                        {
                            pending.GetAwaiter().GetResult();
                        }
                        else
                        {
                            pending.AsTask().GetAwaiter().GetResult();
                        }
                    }
                }
                catch (Exception ex)
                {
                    failed = true;
                    AddDeadLetter(DeadLetterEntry<TEvent>.Capture(in envelope, DeadLetterReason.HandlerException, ex));
                    NotifyConsumptionError(in envelope, ex);
                }
                finally
                {
                    _metrics.RecordExecution(Stopwatch.GetTimestamp() - executionStart, failed);
                    if (once)
                    {
                        subscription.Dispose();
                    }
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
        EventEnvelope<TEvent> Envelope,
        long ExecutionStart);
}
