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
    /// <summary>1k slots per lane.</summary>
    public static EventSchedulerOptions Default => new(1024);
}

/// <summary>Raised by <see cref="EventScheduler{TEvent}.Schedule(in EventEnvelope{TEvent}, EventPriority)"/> when a lane is full.</summary>
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

    /// <summary>Configured capacity of the rejecting lane.</summary>
    public int Capacity { get; }
}

/// <summary>
/// Bounded three-lane priority scheduler with deterministic FIFO order inside each lane.
/// <see cref="Drain{TDispatcher}"/> pulls in High, Normal, Low order; <see cref="DispatchImmediate{TDispatcher}"/>
/// drains the same way on the caller thread. Steady-state enqueue/dequeue allocates nothing.
/// </summary>
/// <remarks>
/// The scheduler transports already stamped envelopes; it never rewrites metadata. Enqueue is
/// lock-guarded and bounded per lane, so backpressure is explicit through
/// <see cref="TrySchedule(in EventEnvelope{TEvent}, EventPriority)"/>. Dispatchers may schedule more work
/// while draining: the outer drain loop observes it, and a nested
/// <see cref="DispatchImmediate{TDispatcher}"/> returns zero instead of recursing.
/// </remarks>
/// <typeparam name="TEvent">Payload type.</typeparam>
public sealed class EventScheduler<TEvent>
{
    private const int LaneCount = 3;

    private readonly ScheduledEvent<TEvent>[][] _lanes;
    private readonly int[] _heads;
    private readonly int[] _tails;
    private readonly int[] _counts;
    private readonly int _capacity;
    private readonly Lock _gate = new();

    private long _sequence;
    private long _scheduled;
    private long _dequeued;
    private int _completed;
    private int _dispatching;

    /// <summary>Creates a scheduler with the given per-lane capacity.</summary>
    /// <param name="capacity">Slots per priority lane; must be positive.</param>
    public EventScheduler(int capacity = 1024)
        : this(new EventSchedulerOptions(capacity))
    {
    }

    /// <summary>Creates a scheduler from options.</summary>
    /// <param name="options">Scheduler bounds.</param>
    public EventScheduler(EventSchedulerOptions options)
    {
        if (options.Capacity < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "Capacity must be positive.");
        }

        _capacity = options.Capacity;
        _lanes = new ScheduledEvent<TEvent>[LaneCount][];
        for (int lane = 0; lane < LaneCount; lane++)
        {
            _lanes[lane] = new ScheduledEvent<TEvent>[_capacity];
        }

        _heads = new int[LaneCount];
        _tails = new int[LaneCount];
        _counts = new int[LaneCount];
    }

    /// <summary>Slots available per priority lane.</summary>
    public int Capacity => _capacity;

    /// <summary>Queued envelopes across all lanes.</summary>
    public int Count
    {
        get
        {
            int total = 0;
            for (int lane = 0; lane < LaneCount; lane++)
            {
                total += Volatile.Read(ref _counts[lane]);
            }

            return total;
        }
    }

    /// <summary>Whether <see cref="Complete"/> stopped further enqueues.</summary>
    public bool IsCompleted => Volatile.Read(ref _completed) != 0;

    /// <summary>Total envelopes accepted since construction.</summary>
    public long ScheduledCount => Interlocked.Read(ref _scheduled);

    /// <summary>Total envelopes pulled since construction.</summary>
    public long DequeuedCount => Interlocked.Read(ref _dequeued);

    /// <summary>Queued envelopes in one priority lane.</summary>
    /// <param name="priority">Lane priority.</param>
    public int CountInLane(EventPriority priority)
    {
        EventPriorityGuard.Validate(priority);
        return Volatile.Read(ref _counts[(int)priority]);
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

        int lane = (int)priority;
        lock (_gate)
        {
            if (Volatile.Read(ref _completed) != 0)
            {
                return false;
            }

            int count = _counts[lane];
            if (count >= _capacity)
            {
                return false;
            }

            long sequence = ++_sequence;
            _lanes[lane][_tails[lane]] = new ScheduledEvent<TEvent>(envelope, priority, sequence);
            _tails[lane] = NextIndex(_tails[lane]);
            _counts[lane] = count + 1;
            _scheduled++;
            return true;
        }
    }

    /// <summary>Wraps an unstamped payload and attempts to enqueue it.</summary>
    /// <param name="payload">Payload to queue.</param>
    /// <param name="priority">Lane priority.</param>
    public bool TrySchedule(in TEvent payload, EventPriority priority = EventPriority.Normal) =>
        TrySchedule(new EventEnvelope<TEvent>(payload), priority);

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

    /// <summary>Pulls the next envelope in High, Normal, Low order.</summary>
    /// <param name="item">Dequeued item.</param>
    /// <returns>False when every lane is empty.</returns>
    public bool TryDequeue(out ScheduledEvent<TEvent> item)
    {
        lock (_gate)
        {
            for (int lane = 0; lane < LaneCount; lane++)
            {
                if (_counts[lane] == 0)
                {
                    continue;
                }

                int head = _heads[lane];
                item = _lanes[lane][head];
                _lanes[lane][head] = default;
                _heads[lane] = NextIndex(head);
                _counts[lane]--;
                _dequeued++;
                return true;
            }
        }

        item = default;
        return false;
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

    /// <summary>Stops accepting envelopes; queued work remains available to drain.</summary>
    public void Complete() => Volatile.Write(ref _completed, 1);

    /// <summary>Discards every queued envelope.</summary>
    /// <returns>Number of discarded envelopes.</returns>
    public int Clear()
    {
        lock (_gate)
        {
            int cleared = 0;
            for (int lane = 0; lane < LaneCount; lane++)
            {
                int count = _counts[lane];
                if (count == 0)
                {
                    continue;
                }

                Array.Clear(_lanes[lane], 0, _capacity);
                _heads[lane] = 0;
                _tails[lane] = 0;
                _counts[lane] = 0;
                cleared += count;
            }

            return cleared;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int NextIndex(int index) => index + 1 == _capacity ? 0 : index + 1;
}
