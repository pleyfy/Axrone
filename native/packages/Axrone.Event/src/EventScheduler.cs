namespace Axrone.Event;

/// <summary>One queued envelope plus its scheduling identity.</summary>
/// <param name="Envelope">Queued envelope.</param>
/// <param name="Priority">Queue lane priority.</param>
/// <param name="Sequence">Monotonic enqueue sequence; stable tie-breaker and trace id.</param>
public readonly record struct ScheduledEvent<TEvent>(
    EventEnvelope<TEvent> Envelope,
    EventPriority Priority,
    long Sequence);

/// <summary>Consumer invoked by <see cref="EventScheduler{TEvent}.Drain{TDispatcher}"/>.</summary>
/// <typeparam name="TEvent">Payload type.</typeparam>
public interface IEventDispatcher<TEvent>
{
    /// <summary>Dispatches one scheduled envelope.</summary>
    void Dispatch(in ScheduledEvent<TEvent> item);
}

/// <summary>Scheduler bounds. Capacity applies per priority lane.</summary>
/// <param name="Capacity">Slots per priority lane; must be positive.</param>
public readonly record struct EventSchedulerOptions(int Capacity)
{
    /// <summary>Maximum pending timers; must be positive.</summary>
    public int MaxTimers { get; init; } = 4096;

    /// <summary>1k slots per lane and 4k timers.</summary>
    public static EventSchedulerOptions Default => new(1024);
}

/// <summary>Raised when a lane or the timer table is full.</summary>
public sealed class EventQueueFullException : InvalidOperationException
{
    /// <summary>Creates a queue-full failure.</summary>
    public EventQueueFullException()
    {
    }

    /// <summary>Creates a queue-full failure with a message.</summary>
    public EventQueueFullException(string message)
        : base(message)
    {
    }

    /// <summary>Creates a queue-full failure with a message and inner failure.</summary>
    public EventQueueFullException(string message, Exception innerException)
        : base(message, innerException)
    {
    }

    internal EventQueueFullException(string message, EventPriority priority, int capacity)
        : base(message)
    {
        Priority = priority;
        Capacity = capacity;
    }

    /// <summary>Lane that rejected the envelope.</summary>
    public EventPriority Priority { get; }

    /// <summary>Configured capacity of the rejecting lane or timer table.</summary>
    public int Capacity { get; }
}

/// <summary>
/// Bounded three-lane priority scheduler with deterministic FIFO order inside each lane and a
/// pull-based timer table. <see cref="Drain{TDispatcher}"/> pulls in High, Normal, Low order;
/// <see cref="AdvanceDueTimers"/> moves due timers into those lanes. Steady-state
/// advance/dequeue allocates nothing.
/// </summary>
/// <remarks>
/// Time only advances when the caller invokes <see cref="AdvanceDueTimers"/>; no OS timers are
/// created. <see cref="TimeProvider"/> supplies the clock, so tests can drive a deterministic
/// manual provider. Timers due at the same instant are ordered by priority, then creation order.
/// A full target lane stops the advance without losing timers; they fire on a later advance.
/// <para>
/// Ordering is one <see cref="PriorityQueue{TElement,TPriority}"/> for envelopes and one for
/// timers. Pause, resume and cancel rebuild the timer heap because the BCL queue has no removal;
/// those are cold paths, while advance and dequeue stay allocation-free.
/// </para>
/// </remarks>
/// <typeparam name="TEvent">Payload type.</typeparam>
public sealed class EventScheduler<TEvent>
{
    private const int LaneCount = 3;
    private const int TimerStateActive = 0;
    private const int TimerStatePaused = 1;
    private const int TimerStateTerminal = 2;

    private static readonly long MaxUtcTicks = DateTimeOffset.MaxValue.UtcTicks;

    private readonly PriorityQueue<ScheduledEvent<TEvent>, (EventPriority Priority, long Sequence)> _queue = new();
    private readonly PriorityQueue<TimerEntry, (long DueTicks, EventPriority Priority, long Sequence)> _timers = new();
    private readonly List<TimerEntry> _paused = new();
    private readonly int[] _laneCounts = new int[LaneCount];
    private readonly int _capacity;
    private readonly int _maxTimers;
    private readonly TimeProvider _timeProvider;
    private readonly Lock _gate = new();

    private long _sequence;
    private long _stampSequence;
    private long _timerSequence;
    private long _scheduled;
    private long _dequeued;
    private int _timerCount;
    private long _firedTimerTicks;
    private int _completed;
    private int _dispatching;

    /// <summary>Creates a scheduler with the given per-lane capacity.</summary>
    /// <param name="capacity">Slots per priority lane; must be positive.</param>
    public EventScheduler(int capacity = 1024)
        : this(new EventSchedulerOptions(capacity))
    {
    }

    /// <summary>Creates a scheduler from options using <see cref="TimeProvider.System"/>.</summary>
    /// <param name="options">Scheduler bounds.</param>
    public EventScheduler(EventSchedulerOptions options)
        : this(options, TimeProvider.System)
    {
    }

    /// <summary>Creates a scheduler from options and an explicit clock.</summary>
    /// <param name="options">Scheduler bounds.</param>
    /// <param name="timeProvider">Clock used by delay, deadline and recurring timers.</param>
    public EventScheduler(EventSchedulerOptions options, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);
        if (options.Capacity < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "Capacity must be positive.");
        }

        if (options.MaxTimers < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "MaxTimers must be positive.");
        }

        _capacity = options.Capacity;
        _maxTimers = options.MaxTimers;
        _timeProvider = timeProvider;
    }

    /// <summary>Configured slots per lane.</summary>
    public int Capacity => _capacity;

    /// <summary>Configured timer table bound.</summary>
    public int MaxTimers => _maxTimers;

    /// <summary>Total envelopes waiting across every lane.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _queue.Count;
            }
        }
    }

    /// <summary>Pending timers, active and paused.</summary>
    public int TimerCount => Volatile.Read(ref _timerCount);

    /// <summary>Timers currently paused.</summary>
    public int PausedTimerCount
    {
        get
        {
            lock (_gate)
            {
                return _paused.Count;
            }
        }
    }

    /// <summary>Total timer ticks fired since construction.</summary>
    public long FiredTimerTicks => Interlocked.Read(ref _firedTimerTicks);

    /// <summary>Whether the scheduler stopped accepting work.</summary>
    public bool IsCompleted => Volatile.Read(ref _completed) != 0;

    /// <summary>Envelopes accepted since construction.</summary>
    public long ScheduledCount => Interlocked.Read(ref _scheduled);

    /// <summary>Envelopes dequeued since construction.</summary>
    public long DequeuedCount => Interlocked.Read(ref _dequeued);

    /// <summary>Envelopes waiting in one lane.</summary>
    /// <param name="priority">Lane to inspect.</param>
    public int CountInLane(EventPriority priority)
    {
        EventPriorityGuard.Validate(priority);
        lock (_gate)
        {
            return _laneCounts[(int)priority];
        }
    }

    /// <summary>Attempts to enqueue without blocking.</summary>
    /// <param name="envelope">Envelope to queue.</param>
    /// <param name="priority">Lane priority.</param>
    /// <returns>False when the lane is full or the scheduler is completed.</returns>
    public bool TrySchedule(
        in EventEnvelope<TEvent> envelope,
        EventPriority priority = EventPriority.Normal)
    {
        EventPriorityGuard.Validate(priority);

        if (Volatile.Read(ref _completed) != 0)
        {
            return false;
        }

        EventEnvelope<TEvent> stamped = envelope.IsStamped ? envelope : StampPayload(envelope.Payload);
        lock (_gate)
        {
            return Volatile.Read(ref _completed) == 0 && TryEnqueueLocked(in stamped, priority);
        }
    }

    /// <summary>Wraps an unstamped payload and attempts to enqueue it.</summary>
    /// <param name="payload">Payload to queue.</param>
    /// <param name="priority">Lane priority.</param>
    public bool TrySchedule(in TEvent payload, EventPriority priority = EventPriority.Normal) =>
        TrySchedule(StampPayload(payload), priority);

    /// <summary>Enqueues, throwing when the lane is full or the scheduler is completed.</summary>
    /// <param name="envelope">Envelope to queue.</param>
    /// <param name="priority">Lane priority.</param>
    /// <exception cref="EventQueueFullException">The target lane is full.</exception>
    public void Schedule(
        in EventEnvelope<TEvent> envelope,
        EventPriority priority = EventPriority.Normal)
    {
        if (TrySchedule(in envelope, priority))
        {
            return;
        }

        if (Volatile.Read(ref _completed) != 0)
        {
            ThrowHelper.ThrowEngineTerminated();
        }

        ThrowHelper.ThrowQueueFull(priority, _capacity);
    }

    /// <summary>Wraps an unstamped payload and enqueues it, throwing when the lane is full.</summary>
    /// <param name="payload">Payload to queue.</param>
    /// <param name="priority">Lane priority.</param>
    public void Schedule(in TEvent payload, EventPriority priority = EventPriority.Normal) =>
        Schedule(new EventEnvelope<TEvent>(payload), priority);

    /// <summary>Schedules a one-shot timer relative to the current clock.</summary>
    /// <param name="delay">Delay; negative values fire on the next advance.</param>
    /// <param name="payload">Payload emitted when the timer fires.</param>
    /// <param name="priority">Lane priority used when the timer fires.</param>
    /// <param name="cancellationToken">Cancels the timer and returns an inactive handle.</param>
    /// <returns>False when completed or the timer table is full.</returns>
    public EventTimerHandle? TryScheduleDelay(
        TimeSpan delay,
        in TEvent payload,
        EventPriority priority = EventPriority.Normal,
        CancellationToken cancellationToken = default)
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        long dueTicks = AddClamped(now, delay.Ticks > 0 ? delay.Ticks : 0);
        return TryCreateTimer(dueTicks, intervalTicks: 0, maxTicks: 0, in payload, priority, cancellationToken, out _);
    }

    /// <summary>Schedules a one-shot timer, throwing when completed or the timer table is full.</summary>
    /// <param name="delay">Delay; negative values fire on the next advance.</param>
    /// <param name="payload">Payload emitted when the timer fires.</param>
    /// <param name="priority">Lane priority used when the timer fires.</param>
    /// <param name="cancellationToken">Cancels the timer and returns an inactive handle.</param>
    public EventTimerHandle ScheduleDelay(
        TimeSpan delay,
        in TEvent payload,
        EventPriority priority = EventPriority.Normal,
        CancellationToken cancellationToken = default)
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        long dueTicks = AddClamped(now, delay.Ticks > 0 ? delay.Ticks : 0);
        return CreateTimerOrThrow(dueTicks, intervalTicks: 0, maxTicks: 0, in payload, priority, cancellationToken);
    }

    /// <summary>Schedules a one-shot timer at an absolute instant; past instants fire on the next advance.</summary>
    /// <param name="dueAt">Absolute deadline carried by the configured clock.</param>
    /// <param name="payload">Payload emitted when the timer fires.</param>
    /// <param name="priority">Lane priority used when the timer fires.</param>
    /// <param name="cancellationToken">Cancels the timer and returns an inactive handle.</param>
    public EventTimerHandle? TryScheduleAt(
        DateTimeOffset dueAt,
        in TEvent payload,
        EventPriority priority = EventPriority.Normal,
        CancellationToken cancellationToken = default)
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        long dueTicks = dueAt.UtcTicks;
        if (dueTicks < now)
        {
            dueTicks = now;
        }

        return TryCreateTimer(dueTicks, intervalTicks: 0, maxTicks: 0, in payload, priority, cancellationToken, out _);
    }

    /// <summary>Schedules a one-shot timer, throwing when completed or the timer table is full.</summary>
    /// <param name="dueAt">Absolute deadline carried by the configured clock.</param>
    /// <param name="payload">Payload emitted when the timer fires.</param>
    /// <param name="priority">Lane priority used when the timer fires.</param>
    /// <param name="cancellationToken">Cancels the timer and returns an inactive handle.</param>
    public EventTimerHandle ScheduleAt(
        DateTimeOffset dueAt,
        in TEvent payload,
        EventPriority priority = EventPriority.Normal,
        CancellationToken cancellationToken = default)
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        long dueTicks = dueAt.UtcTicks;
        if (dueTicks < now)
        {
            dueTicks = now;
        }

        return CreateTimerOrThrow(dueTicks, intervalTicks: 0, maxTicks: 0, in payload, priority, cancellationToken);
    }

    /// <summary>Schedules a fixed-rate recurring timer; missed intervals are emitted on advance.</summary>
    /// <param name="interval">Recurring interval; must be positive.</param>
    /// <param name="payload">Payload emitted on every tick.</param>
    /// <param name="maxTicks">Tick cap; zero or negative means unlimited.</param>
    /// <param name="priority">Lane priority used when tick events fire.</param>
    /// <param name="cancellationToken">Cancels the timer and returns an inactive handle.</param>
    public EventTimerHandle? TryScheduleRecurring(
        TimeSpan interval,
        in TEvent payload,
        int maxTicks = 0,
        EventPriority priority = EventPriority.Normal,
        CancellationToken cancellationToken = default)
    {
        if (interval <= TimeSpan.Zero)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(interval), "Interval must be positive.");
        }

        long now = _timeProvider.GetUtcNow().UtcTicks;
        long dueTicks = AddClamped(now, interval.Ticks);
        return TryCreateTimer(dueTicks, interval.Ticks, maxTicks, in payload, priority, cancellationToken, out _);
    }

    /// <summary>Schedules a fixed-rate recurring timer, throwing when completed or the timer table is full.</summary>
    /// <param name="interval">Recurring interval; must be positive.</param>
    /// <param name="payload">Payload emitted on every tick.</param>
    /// <param name="maxTicks">Tick cap; zero or negative means unlimited.</param>
    /// <param name="priority">Lane priority used when tick events fire.</param>
    /// <param name="cancellationToken">Cancels the timer and returns an inactive handle.</param>
    public EventTimerHandle ScheduleRecurring(
        TimeSpan interval,
        in TEvent payload,
        int maxTicks = 0,
        EventPriority priority = EventPriority.Normal,
        CancellationToken cancellationToken = default)
    {
        if (interval <= TimeSpan.Zero)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(interval), "Interval must be positive.");
        }

        long now = _timeProvider.GetUtcNow().UtcTicks;
        long dueTicks = AddClamped(now, interval.Ticks);
        return CreateTimerOrThrow(dueTicks, interval.Ticks, maxTicks, in payload, priority, cancellationToken);
    }

    /// <summary>
    /// Moves every timer due at the current clock instant into its priority lane. Stops when the
    /// next due timer targets a full lane, leaving it pending instead of dropping it.
    /// </summary>
    /// <returns>Number of timer ticks moved into lanes.</returns>
    public int AdvanceDueTimers()
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        List<CancellationTokenRegistration>? released = null;
        int fired = 0;

        lock (_gate)
        {
            while (_timers.TryPeek(out TimerEntry? top, out _))
            {
                if (top.DueTicks > now)
                {
                    break;
                }

                if (_laneCounts[(int)top.Priority] >= _capacity)
                {
                    break;
                }

                _timers.Dequeue();
                TryEnqueueLocked(StampPayload(top.Payload), top.Priority);
                top.FiredCount++;
                _firedTimerTicks++;
                fired++;

                if (top.IntervalTicks > 0)
                {
                    if (top.RemainingLeft > 0)
                    {
                        top.RemainingLeft--;
                    }

                    if (top.RemainingLeft == 0)
                    {
                        TerminateTimerLocked(top, ref released);
                    }
                    else
                    {
                        long nextDue = AddClamped(top.DueTicks, top.IntervalTicks);
                        if (nextDue <= top.DueTicks)
                        {
                            TerminateTimerLocked(top, ref released);
                        }
                        else
                        {
                            top.DueTicks = nextDue;
                            ScheduleTimerLocked(top);
                        }
                    }
                }
                else
                {
                    TerminateTimerLocked(top, ref released);
                }
            }
        }

        ReleaseRegistrations(released);
        return fired;
    }

    /// <summary>Pulls the next envelope in High, Normal, Low order.</summary>
    /// <param name="item">Dequeued item.</param>
    /// <returns>False when every lane is empty.</returns>
    public bool TryDequeue(out ScheduledEvent<TEvent> item)
    {
        lock (_gate)
        {
            if (!_queue.TryDequeue(out item, out _))
            {
                item = default;
                return false;
            }

            _laneCounts[(int)item.Priority]--;
            _dequeued++;
            return true;
        }
    }

    /// <summary>Pulls and dispatches queued envelopes in priority order.</summary>
    /// <typeparam name="TDispatcher">Caller-supplied dispatcher.</typeparam>
    /// <param name="dispatcher">Dispatcher invoked for every dequeued item.</param>
    /// <param name="maxItems">Upper bound for this pass; must not be negative.</param>
    /// <returns>Number of dispatched envelopes.</returns>
    public int Drain<TDispatcher>(ref TDispatcher dispatcher, int maxItems = int.MaxValue)
        where TDispatcher : struct, IEventDispatcher<TEvent>
    {
        if (maxItems < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(maxItems));
        }

        int dispatched = 0;
        while (dispatched < maxItems && TryDequeue(out ScheduledEvent<TEvent> item))
        {
            dispatcher.Dispatch(in item);
            dispatched++;
        }

        return dispatched;
    }

    /// <summary>
    /// Drains every queued envelope on the caller thread. Returns zero when another dispatch is
    /// already in progress, so a dispatcher that publishes recursively cannot re-enter.
    /// </summary>
    /// <typeparam name="TDispatcher">Caller-supplied dispatcher.</typeparam>
    /// <param name="dispatcher">Dispatcher invoked for every dequeued item.</param>
    /// <returns>Number of dispatched envelopes.</returns>
    public int DispatchImmediate<TDispatcher>(ref TDispatcher dispatcher)
        where TDispatcher : struct, IEventDispatcher<TEvent>
    {
        if (Interlocked.CompareExchange(ref _dispatching, 1, 0) != 0)
        {
            return 0;
        }

        try
        {
            return Drain(ref dispatcher);
        }
        finally
        {
            Volatile.Write(ref _dispatching, 0);
        }
    }

    /// <summary>Stops accepting envelopes and cancels every pending timer; queued work remains drainable.</summary>
    public void Complete()
    {
        if (Interlocked.Exchange(ref _completed, 1) != 0)
        {
            return;
        }

        List<CancellationTokenRegistration>? released;
        lock (_gate)
        {
            ClearTimersLocked(out released);
        }

        ReleaseRegistrations(released);
    }

    /// <summary>Discards every queued envelope.</summary>
    /// <returns>Number of discarded envelopes.</returns>
    public int Clear()
    {
        lock (_gate)
        {
            int cleared = _queue.Count;
            _queue.Clear();
            Array.Clear(_laneCounts);
            return cleared;
        }
    }

    /// <summary>Discards every pending timer, active or paused.</summary>
    /// <returns>Number of discarded timers.</returns>
    public int ClearTimers()
    {
        List<CancellationTokenRegistration>? released;
        int cleared;
        lock (_gate)
        {
            cleared = ClearTimersLocked(out released);
        }

        ReleaseRegistrations(released);
        return cleared;
    }

    [SuppressMessage(
        "Reliability",
        "CA2000:Dispose objects before losing scope",
        Justification = "A created handle is returned to the caller; failed creations return no object.")]
    private EventTimerHandle CreateTimerOrThrow(
        long dueTicks,
        long intervalTicks,
        int maxTicks,
        in TEvent payload,
        EventPriority priority,
        CancellationToken cancellationToken)
    {
        EventTimerHandle? handle = TryCreateTimer(
            dueTicks,
            intervalTicks,
            maxTicks,
            in payload,
            priority,
            cancellationToken,
            out TimerScheduleStatus status);

        if (handle is not null)
        {
            return handle;
        }

        switch (status)
        {
            case TimerScheduleStatus.Cancelled:
                return EventTimerHandle.Inactive;
            case TimerScheduleStatus.Completed:
                ThrowHelper.ThrowEngineTerminated();
                break;
            default:
                ThrowHelper.ThrowTimerCapacity(priority, _maxTimers);
                break;
        }

        return EventTimerHandle.Inactive;
    }

    private EventTimerHandle? TryCreateTimer(
        long dueTicks,
        long intervalTicks,
        int maxTicks,
        in TEvent payload,
        EventPriority priority,
        CancellationToken cancellationToken,
        out TimerScheduleStatus status)
    {
        EventPriorityGuard.Validate(priority);

        if (cancellationToken.IsCancellationRequested)
        {
            status = TimerScheduleStatus.Cancelled;
            return null;
        }

        if (Volatile.Read(ref _completed) != 0)
        {
            status = TimerScheduleStatus.Completed;
            return null;
        }

        TimerEntry entry;
        lock (_gate)
        {
            if (Volatile.Read(ref _completed) != 0)
            {
                status = TimerScheduleStatus.Completed;
                return null;
            }

            if (_timerCount >= _maxTimers)
            {
                status = TimerScheduleStatus.Capacity;
                return null;
            }

            entry = new TimerEntry(
                this,
                payload,
                priority,
                ++_timerSequence,
                dueTicks,
                intervalTicks,
                intervalTicks > 0 && maxTicks > 0 ? maxTicks : intervalTicks > 0 ? -1 : 0);
            ScheduleTimerLocked(entry);
            _timerCount++;
        }

        if (cancellationToken.CanBeCanceled)
        {
            entry.Registration = cancellationToken.Register(
                static state => ((TimerEntry)state!).CancelFromToken(),
                entry);
        }

        status = TimerScheduleStatus.Success;
        return new EventTimerHandle(entry);
    }

    private void PauseTimer(TimerEntry entry)
    {
        lock (_gate)
        {
            if (Volatile.Read(ref entry.State) != TimerStateActive)
            {
                return;
            }

            RemoveTimerLocked(entry);
            entry.PausedAtTicks = _timeProvider.GetUtcNow().UtcTicks;
            Volatile.Write(ref entry.State, TimerStatePaused);
            _paused.Add(entry);
        }
    }

    private void ResumeTimer(TimerEntry entry)
    {
        lock (_gate)
        {
            if (Volatile.Read(ref entry.State) != TimerStatePaused)
            {
                return;
            }

            _paused.Remove(entry);

            long now = _timeProvider.GetUtcNow().UtcTicks;
            long pausedTicks = now - entry.PausedAtTicks;
            if (pausedTicks > 0)
            {
                entry.DueTicks = AddClamped(entry.DueTicks, pausedTicks);
            }

            Volatile.Write(ref entry.State, TimerStateActive);
            ScheduleTimerLocked(entry);
        }
    }

    private void CancelTimer(TimerEntry entry)
    {
        CancellationTokenRegistration registration;
        lock (_gate)
        {
            int state = Volatile.Read(ref entry.State);
            if (state == TimerStateTerminal)
            {
                return;
            }

            if (state == TimerStateActive)
            {
                RemoveTimerLocked(entry);
            }
            else
            {
                _paused.Remove(entry);
            }

            Volatile.Write(ref entry.State, TimerStateTerminal);
            _timerCount--;
            registration = entry.Registration;
            entry.Registration = default;
        }

        registration.Unregister();
    }

    private void CancelTimerFromToken(TimerEntry entry)
    {
        CancellationTokenRegistration registration;
        lock (_gate)
        {
            int state = Volatile.Read(ref entry.State);
            if (state == TimerStateTerminal)
            {
                return;
            }

            if (state == TimerStateActive)
            {
                RemoveTimerLocked(entry);
            }
            else
            {
                _paused.Remove(entry);
            }

            Volatile.Write(ref entry.State, TimerStateTerminal);
            _timerCount--;
            registration = entry.Registration;
            entry.Registration = default;
        }

        registration.Unregister();
    }

    private int ClearTimersLocked(out List<CancellationTokenRegistration>? released)
    {
        int cleared = _timerCount;
        released = null;
        foreach ((TimerEntry entry, _) in _timers.UnorderedItems)
        {
            Volatile.Write(ref entry.State, TimerStateTerminal);
            if (entry.Registration != default)
            {
                (released ??= new List<CancellationTokenRegistration>()).Add(entry.Registration);
                entry.Registration = default;
            }
        }

        foreach (TimerEntry entry in _paused)
        {
            Volatile.Write(ref entry.State, TimerStateTerminal);
            if (entry.Registration != default)
            {
                (released ??= new List<CancellationTokenRegistration>()).Add(entry.Registration);
                entry.Registration = default;
            }
        }

        _timers.Clear();
        _paused.Clear();
        _timerCount = 0;
        return cleared;
    }

    private EventEnvelope<TEvent> StampPayload(in TEvent payload)
    {
        Guid id = Guid.NewGuid();
        return new EventEnvelope<TEvent>(
            new EventMetadata(
                id,
                id,
                Guid.Empty,
                Interlocked.Increment(ref _stampSequence),
                1,
                0,
                Stopwatch.GetTimestamp()),
            payload);
    }

    private bool TryEnqueueLocked(in EventEnvelope<TEvent> envelope, EventPriority priority)
    {
        int lane = (int)priority;
        if (_laneCounts[lane] >= _capacity)
        {
            return false;
        }

        long sequence = ++_sequence;
        _queue.Enqueue(new ScheduledEvent<TEvent>(envelope, priority, sequence), (priority, sequence));
        _laneCounts[lane]++;
        _scheduled++;
        return true;
    }

    private void ScheduleTimerLocked(TimerEntry entry) =>
        _timers.Enqueue(entry, (entry.DueTicks, entry.Priority, entry.Sequence));

    /// <summary>
    /// Removes a live timer from the heap. The BCL queue has no removal, so the heap is rebuilt;
    /// pause and cancel are cold paths while advance stays O(log n).
    /// </summary>
    private void RemoveTimerLocked(TimerEntry entry)
    {
        var survivours = new List<(TimerEntry Entry, (long, EventPriority, long) Priority)>(_timers.Count);
        while (_timers.TryDequeue(out TimerEntry? candidate, out (long, EventPriority, long) priority))
        {
            if (!ReferenceEquals(candidate, entry))
            {
                survivours.Add((candidate, priority));
            }
        }

        foreach ((TimerEntry survivor, (long, EventPriority, long) priority) in survivours)
        {
            _timers.Enqueue(survivor, priority);
        }
    }

    private void TerminateTimerLocked(TimerEntry entry, ref List<CancellationTokenRegistration>? released)
    {
        Volatile.Write(ref entry.State, TimerStateTerminal);
        _timerCount--;
        if (entry.Registration != default)
        {
            (released ??= new List<CancellationTokenRegistration>()).Add(entry.Registration);
            entry.Registration = default;
        }
    }

    private static void ReleaseRegistrations(List<CancellationTokenRegistration>? registrations)
    {
        if (registrations is null)
        {
            return;
        }

        for (int i = 0; i < registrations.Count; i++)
        {
            registrations[i].Unregister();
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static long AddClamped(long ticks, long delta)
    {
        if (delta <= 0 || ticks >= MaxUtcTicks)
        {
            return ticks;
        }

        return delta > MaxUtcTicks - ticks ? MaxUtcTicks : ticks + delta;
    }

    private enum TimerScheduleStatus
    {
        Success = 0,
        Completed = 1,
        Capacity = 2,
        Cancelled = 3
    }

    private sealed class TimerEntry : IEventTimerControl
    {
        private readonly EventScheduler<TEvent> _owner;
        private readonly long _intervalTicks;
        private readonly EventPriority _priority;
        private readonly long _sequence;
        private readonly TEvent _payload;
        private readonly Guid _id;

        internal long DueTicks;
        internal long PausedAtTicks;
        internal int RemainingLeft;
        internal int FiredCount;
        internal int State;
        internal CancellationTokenRegistration Registration;

        public TimerEntry(
            EventScheduler<TEvent> owner,
            TEvent payload,
            EventPriority priority,
            long sequence,
            long dueTicks,
            long intervalTicks,
            int remainingTicks)
        {
            _owner = owner;
            _payload = payload;
            _priority = priority;
            _sequence = sequence;
            _id = Guid.NewGuid();
            DueTicks = dueTicks;
            _intervalTicks = intervalTicks;
            RemainingLeft = remainingTicks;
            FiredCount = 0;
            State = TimerStateActive;
        }

        internal TEvent Payload => _payload;

        internal EventPriority Priority => _priority;

        internal long Sequence => _sequence;

        internal long IntervalTicks => _intervalTicks;

        public Guid Id => _id;

        public bool IsActive => Volatile.Read(ref State) != TimerStateTerminal;

        public bool IsPaused => Volatile.Read(ref State) == TimerStatePaused;

        public DateTimeOffset DueAt => new(Volatile.Read(ref DueTicks), TimeSpan.Zero);

        public TimeSpan Interval => new(_intervalTicks);

        public int RemainingTicks => Volatile.Read(ref RemainingLeft);

        public int FiredTicks => Volatile.Read(ref FiredCount);

        public void Pause() => _owner.PauseTimer(this);

        public void Resume() => _owner.ResumeTimer(this);

        public void Cancel() => _owner.CancelTimer(this);

        internal void CancelFromToken() => _owner.CancelTimerFromToken(this);
    }
}
