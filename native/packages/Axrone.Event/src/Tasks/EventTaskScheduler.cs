namespace Axrone.Event;

using System.Threading.Tasks.Sources;
using Axrone.Utility.Backoff;

/// <summary>
/// Id-addressable async task queue with priority lanes, a retry budget, per-task deadlines and
/// bounded concurrency. Submissions return an <see cref="EventTaskHandle"/> carrying an
/// <see cref="EventTaskId"/>; results are awaited through the handle. The scheduler never buys
/// OS threads: bodies run continuation-driven on the submitting thread, the shared thread pool,
/// or the completion thread of the body itself, and <see cref="ConcurrencyLimit"/> caps running
/// bodies, not threads.
/// </summary>
/// <remarks>
/// Every lifecycle change flows through one atomic compare-exchange per task
/// (<see cref="TaskEntryBase.TryTransition"/>), so a task reaches exactly one terminal state and
/// a second completion is impossible by construction. Time comes from an injectable
/// <see cref="TimeProvider"/>; deadlines and retry backoff are evaluated against it. A lazy
/// thread-pool timer only hints the pump when the earliest known due instant passes — all
/// decisions stay correct without it, which makes fake-clock tests deterministic via
/// <see cref="AdvanceDueWork"/>. Slot objects are pooled: once the working set is established,
/// submit→run→complete reuses slots without new slot allocations. Completion signals are
/// delivered outside the scheduler lock.
/// </remarks>
public sealed class EventTaskScheduler : IDisposable, IAsyncDisposable
{
    internal const int LaneCount = 5;
    internal const long NoTicks = long.MaxValue;

    private const int PumpIdle = 0;
    private const int PumpRunning = 1;
    private const int PumpDeferred = 2;
    private const int PassStartLimit = 256;
    private const int DrainWaiterCount = 64;
    private const long FixedSlotTableBytes = 64;
    private const long EstimatedEntryBytes = 256;
    private const long DefaultGcWindowTicks = TimeSpan.TicksPerMinute * 2;
    private const double MillisecondsPerTick = 1d / TimeSpan.TicksPerMillisecond;

    private static readonly TimerCallback S_OnDeadlineTick = OnDeadlineTick;
    private static readonly TimerCallback S_OnGcTick = OnGcTick;
    private static readonly WaitCallback S_OnDeferredPump = OnDeferredPump;
    private static readonly Action<Task, object?> S_OnBodyTaskContinuation = OnBodyTaskContinuation;

    [ThreadStatic]
    private static bool t_pumpActive;

    private readonly TaskEntryBase?[] _slots;
    private readonly TaskEntryBase[] _laneHeads;
    private readonly TaskEntryBase[] _laneTails;
    private readonly int[] _laneCounts;
    private readonly DrainWaiter[] _drainWaiters;
    private readonly TaskEntryBase?[] _deferredSignals;
    private readonly TaskEntryBase?[] _cancelSignals;
    private readonly Lock _signalGate = new();
    private readonly EventTaskSchedulerOptions _options;
    private readonly TimeProvider _timeProvider;
    private readonly Lock _gate = new();
    private readonly Timer _deadlineTimer;
    private readonly Timer? _gcTimer;
    private readonly long _gcWindowTicks;
    private readonly int _capacity;
    private readonly int _entryMaxRetries;
    private readonly long _defaultTimeoutTicks;

    private TaskEntryBase? _retryHead;
    private TaskEntryBase? _retryTail;
    private TaskEntryBase? _deadlineHead;
    private TaskEntryBase? _deadlineTail;
    private TaskEntryBase? _freeHead;
    private int _freeCount;
    private int _queuedCount;
    private int _delayedCount;
    private int _runningCount;
    private long _nextGeneration;
    private long _completedTicksSum;
    private int _completedBodies;
    private int _completedCount;
    private int _failedCount;
    private long _throughputAnchorTicks;
    private int _throughputAnchorBodies;
    private int _pumpState;
    private int _closed;
    private int _disposed;

    /// <summary>Creates a task scheduler from options using <see cref="TimeProvider.System"/>.</summary>
    /// <param name="options">Scheduler bounds.</param>
    public EventTaskScheduler(EventTaskSchedulerOptions? options = null)
        : this(options ?? EventTaskSchedulerOptions.Default, TimeProvider.System)
    {
    }

    /// <summary>Creates a task scheduler from options and an explicit clock.</summary>
    /// <param name="options">Scheduler bounds.</param>
    /// <param name="timeProvider">Clock used by deadlines, retry backoff and timings.</param>
    public EventTaskScheduler(EventTaskSchedulerOptions options, TimeProvider timeProvider)
    {
        ArgumentNullException.ThrowIfNull(timeProvider);
        if (options.ConcurrencyLimit < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "ConcurrencyLimit must be positive.");
        }

        if (options.MaxQueueSize < 1)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "MaxQueueSize must be positive.");
        }

        if (options.MaxRetries < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "MaxRetries must be non-negative.");
        }

        if (options.RetryDelay < TimeSpan.Zero || options.TaskTimeout < TimeSpan.Zero || options.GcInterval < TimeSpan.Zero)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "Durations must be non-negative.");
        }

        if (string.IsNullOrEmpty(options.Name))
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(options), "Name must be non-empty.");
        }

        _options = options;
        _timeProvider = timeProvider;
        _capacity = options.MaxQueueSize;
        _entryMaxRetries = options.EnableRetries ? options.MaxRetries : 0;
        _defaultTimeoutTicks = options.TaskTimeout <= TimeSpan.Zero
            ? 0
            : ClampTimeoutTicks(options.TaskTimeout.Ticks);
        _slots = new TaskEntryBase?[Math.Min(options.MaxQueueSize + 1024, 1_048_576)];
        _laneHeads = new TaskEntryBase[LaneCount];
        _laneTails = new TaskEntryBase[LaneCount];
        _laneCounts = new int[LaneCount];
        _deferredSignals = new TaskEntryBase?[_slots.Length];
        _cancelSignals = new TaskEntryBase?[_slots.Length];
        _drainWaiters = new DrainWaiter[DrainWaiterCount];
        for (int i = 0; i < DrainWaiterCount; i++)
        {
            _drainWaiters[i] = new DrainWaiter();
        }

        _throughputAnchorTicks = timeProvider.GetUtcNow().UtcTicks;
        _gcWindowTicks = options.GcInterval > TimeSpan.Zero ? options.GcInterval.Ticks : DefaultGcWindowTicks;
        _deadlineTimer = new Timer(S_OnDeadlineTick, this, Timeout.Infinite, Timeout.Infinite);
        if (options.GcInterval > TimeSpan.Zero)
        {
            _gcTimer = new Timer(S_OnGcTick, this, options.GcInterval, options.GcInterval);
        }
    }

    /// <summary>Scheduler name reported by stats.</summary>
    public string Name => _options.Name;

    /// <summary>Upper bound on concurrently running bodies.</summary>
    public int ConcurrencyLimit => _options.ConcurrencyLimit;

    /// <summary>Total lane capacity across all priorities.</summary>
    public int MaxQueueSize => _capacity;

    /// <summary>Tasks waiting in lanes.</summary>
    public int QueuedCount => Volatile.Read(ref _queuedCount);

    /// <summary>Bodies started and not yet finished.</summary>
    public int ActiveCount => Volatile.Read(ref _runningCount);

    /// <summary>Retries waiting for their backoff instant.</summary>
    public int DelayedRetryCount => Volatile.Read(ref _delayedCount);

    /// <summary>Whether <see cref="Complete"/> stopped further submissions.</summary>
    public bool IsClosed => Volatile.Read(ref _closed) != 0;

    /// <summary>Total ids issued since construction.</summary>
    public long TotalSubmitted => Volatile.Read(ref _nextGeneration);

    /// <summary>Whether no task is queued, delayed or running.</summary>
    public bool IsIdle =>
        Volatile.Read(ref _runningCount) == 0 &&
        Volatile.Read(ref _queuedCount) == 0 &&
        Volatile.Read(ref _delayedCount) == 0;

    /// <summary>Current instant of the scheduler clock in UTC ticks.</summary>
    public long ClockTicks => _timeProvider.GetUtcNow().UtcTicks;

    /// <summary>Submits a body and returns its handle.</summary>
    /// <typeparam name="TResult">Body result type.</typeparam>
    /// <param name="body">Async body observing the cancellation token.</param>
    /// <param name="priority">Queue lane.</param>
    /// <param name="timeout">Deadline override; zero disables the deadline and null uses the configured default.</param>
    /// <exception cref="EventQueueFullException">The lane capacity is exhausted.</exception>
    /// <exception cref="EventTaskSchedulerClosedException">The scheduler is closed.</exception>
    public EventTaskHandle Submit<TResult>(
        Func<CancellationToken, ValueTask<TResult>> body,
        EventTaskPriority priority = EventTaskPriority.Normal,
        TimeSpan? timeout = null)
    {
        if (TrySubmit(body, priority, timeout, out EventTaskHandle handle))
        {
            return handle;
        }

        if (Volatile.Read(ref _closed) != 0)
        {
            ThrowHelper.ThrowTaskSchedulerClosed(_options.Name);
        }

        ThrowHelper.ThrowQueueFull(priority, _capacity);
        return default;
    }

    /// <summary>Submits without throwing; false when closed or the lane is full.</summary>
    /// <typeparam name="TResult">Body result type.</typeparam>
    /// <param name="body">Async body observing the cancellation token.</param>
    /// <param name="priority">Queue lane.</param>
    /// <param name="timeout">Deadline override; zero disables the deadline and null uses the configured default.</param>
    /// <param name="handle">Issued handle when true.</param>
    public bool TrySubmit<TResult>(
        Func<CancellationToken, ValueTask<TResult>> body,
        EventTaskPriority priority,
        TimeSpan? timeout,
        out EventTaskHandle handle)
    {
        ArgumentNullException.ThrowIfNull(body);
        return TrySubmitCore<Func<CancellationToken, ValueTask<TResult>>, TResult>(BinderDirect<TResult>, body, priority, timeout, out handle);
    }

    /// <summary>
    /// Submits a pre-bound, closure-free body with an object state. With a hoisted delegate this
    /// is the zero-allocation steady-state submit surface: providers and slots are pooled and no
    /// wrapper is created per call.
    /// </summary>
    /// <typeparam name="TResult">Body result type.</typeparam>
    /// <param name="body">Pre-bound async body receiving the state.</param>
    /// <param name="state">State passed to the body.</param>
    /// <param name="priority">Queue lane.</param>
    /// <param name="timeout">Deadline override; zero disables the deadline and null uses the configured default.</param>
    public EventTaskHandle SubmitBound<TResult>(
        Func<object?, CancellationToken, ValueTask<TResult>> body,
        object? state,
        EventTaskPriority priority = EventTaskPriority.Normal,
        TimeSpan? timeout = null)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (TrySubmitCore<(Func<object?, CancellationToken, ValueTask<TResult>>, object?), TResult>(BinderBound<TResult>, (body, state), priority, timeout, out EventTaskHandle handle))
        {
            return handle;
        }

        if (Volatile.Read(ref _closed) != 0)
        {
            ThrowHelper.ThrowTaskSchedulerClosed(_options.Name);
        }

        ThrowHelper.ThrowQueueFull(priority, _capacity);
        return default;
    }

    /// <summary>Submits a pre-bound body without throwing.</summary>
    /// <typeparam name="TResult">Body result type.</typeparam>
    /// <param name="body">Pre-bound async body receiving the state.</param>
    /// <param name="state">State passed to the body.</param>
    /// <param name="priority">Queue lane.</param>
    /// <param name="timeout">Deadline override; zero disables the deadline and null uses the configured default.</param>
    /// <param name="handle">Issued handle when true.</param>
    public bool TrySubmitBound<TResult>(
        Func<object?, CancellationToken, ValueTask<TResult>> body,
        object? state,
        EventTaskPriority priority,
        TimeSpan? timeout,
        out EventTaskHandle handle)
    {
        ArgumentNullException.ThrowIfNull(body);
        return TrySubmitCore<(Func<object?, CancellationToken, ValueTask<TResult>>, object?), TResult>(BinderBound<TResult>, (body, state), priority, timeout, out handle);
    }

    private static void BinderDirect<TResult>(
        Entry<TResult> entry,
        Func<CancellationToken, ValueTask<TResult>> body)
    {
        entry.BindTyped(body);
    }

    private static void BinderVoid(
        Entry<object?> entry,
        Func<CancellationToken, ValueTask> body)
    {
        entry.BindBound((_, token) => InvokeVoidAsync(body, token), null);
    }

    private static void BinderBound<TResult>(
        Entry<TResult> entry,
        (Func<object?, CancellationToken, ValueTask<TResult>> Body, object? State) bound)
    {
        entry.BindBound(bound.Body, bound.State);
    }

    private static void BinderStateful<TState, TResult>(
        Entry<TResult> entry,
        (Func<TState, CancellationToken, ValueTask<TResult>> Body, TState State) bound)
    {
        if (RuntimeHelpers.IsReferenceOrContainsReferences<TState>())
        {
            entry.BindReference<TState>(bound.Body, bound.State);
            return;
        }

        Func<TState, CancellationToken, ValueTask<TResult>> body = bound.Body;
        entry.BindBound((boxed, token) => body((TState)boxed!, token), bound.State);
    }

    private static async ValueTask<object?> InvokeVoidAsync(Func<CancellationToken, ValueTask> body, CancellationToken token)
    {
        await body(token).ConfigureAwait(false);
        return null;
    }

    private bool TrySubmitCore<TArg, TResult>(
        Action<Entry<TResult>, TArg> bind,
        TArg argument,
        EventTaskPriority priority,
        TimeSpan? timeout,
        out EventTaskHandle handle)
    {
        EventTaskPriorityGuard.Validate(priority);
        handle = default;

        if (Volatile.Read(ref _closed) != 0)
        {
            return false;
        }

        long timeoutTicks = ResolveTimeoutTicks(timeout);
        lock (_gate)
        {
            if (_closed != 0 || _queuedCount + _delayedCount >= _capacity)
            {
                return false;
            }

            TaskEntryBase slot = AcquireLocked();
            Entry<TResult> provider = Entry<TResult>.Acquire(this);
            bind(provider, argument);
            slot.BeginSubmit(EventTaskId.Create(slot.SlotIndex, ++_nextGeneration), provider);
            slot.Setup(priority, _timeProvider.GetUtcNow().UtcTicks, timeoutTicks);
            EnqueueLaneLocked(slot);
            _queuedCount++;
            handle = new EventTaskHandle(this, slot);
        }

        ProducerSignalPump();
        return true;
    }

    /// <summary>
    /// Submits a result-less body and returns its handle. The adapter is cached per delegate
    /// type; steady-state zero-allocation paths use <see cref="SubmitBound{TResult}"/>.
    /// </summary>
    /// <param name="body">Async body observing the cancellation token.</param>
    /// <param name="priority">Queue lane.</param>
    /// <param name="timeout">Deadline override; zero disables the deadline and null uses the configured default.</param>
    public EventTaskHandle SubmitVoid(
        Func<CancellationToken, ValueTask> body,
        EventTaskPriority priority = EventTaskPriority.Normal,
        TimeSpan? timeout = null)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (TrySubmitCore<Func<CancellationToken, ValueTask>, object?>(BinderVoid, body, priority, timeout, out EventTaskHandle handle))
        {
            return handle;
        }

        if (Volatile.Read(ref _closed) != 0)
        {
            ThrowHelper.ThrowTaskSchedulerClosed(_options.Name);
        }

        ThrowHelper.ThrowQueueFull(priority, _capacity);
        return default;
    }

    /// <summary>
    /// Submits a closure-free body with explicit state; with a hoisted static body and a
    /// reference state, steady-state submits allocate nothing — slots and providers are pooled.
    /// </summary>
    /// <typeparam name="TState">Caller-owned state carried by the body.</typeparam>
    /// <typeparam name="TResult">Body result type.</typeparam>
    /// <param name="body">Static (closure-free) async body.</param>
    /// <param name="state">State passed to the body.</param>
    /// <param name="priority">Queue lane.</param>
    /// <param name="timeout">Deadline override; zero disables the deadline and null uses the configured default.</param>
    public EventTaskHandle Submit<TState, TResult>(
        Func<TState, CancellationToken, ValueTask<TResult>> body,
        TState state,
        EventTaskPriority priority = EventTaskPriority.Normal,
        TimeSpan? timeout = null)
    {
        ArgumentNullException.ThrowIfNull(body);
        if (TrySubmitCore<(Func<TState, CancellationToken, ValueTask<TResult>>, TState), TResult>(BinderStateful<TState, TResult>, (body, state), priority, timeout, out EventTaskHandle handle))
        {
            return handle;
        }

        if (Volatile.Read(ref _closed) != 0)
        {
            ThrowHelper.ThrowTaskSchedulerClosed(_options.Name);
        }

        ThrowHelper.ThrowQueueFull(priority, _capacity);
        return default;
    }

    /// <summary>Closure-free submit without throwing; false when closed or the lane is full.</summary>
    /// <typeparam name="TState">Caller-owned state carried by the body.</typeparam>
    /// <typeparam name="TResult">Body result type.</typeparam>
    /// <param name="body">Static (closure-free) async body.</param>
    /// <param name="state">State passed to the body.</param>
    /// <param name="priority">Queue lane.</param>
    /// <param name="timeout">Deadline override; zero disables the deadline and null uses the configured default.</param>
    /// <param name="handle">Issued handle when true.</param>
    public bool TrySubmit<TState, TResult>(
        Func<TState, CancellationToken, ValueTask<TResult>> body,
        TState state,
        EventTaskPriority priority,
        TimeSpan? timeout,
        out EventTaskHandle handle)
    {
        ArgumentNullException.ThrowIfNull(body);
        return TrySubmitCore<(Func<TState, CancellationToken, ValueTask<TResult>>, TState), TResult>(BinderStateful<TState, TResult>, (body, state), priority, timeout, out handle);
    }

    /// <summary>
    /// Cancels a task. Pending tasks transition to cancelled immediately; running bodies are
    /// signalled cooperatively and reach a terminal state when they observe the token. A running
    /// body that never observes cancellation keeps its running state until its deadline fires,
    /// mirroring the TypeScript scheduler.
    /// </summary>
    /// <param name="id">Task identity.</param>
    /// <returns>True when this call applied the cancellation or was the first cancel request on a running body.</returns>
    public bool Cancel(EventTaskId id)
    {
        TaskEntryBase? entry = SlotFor(id);
        if (entry is null || !entry.Matches(id))
        {
            return false;
        }

        if (entry.State == EventTaskState.Pending &&
            entry.TryTransition(EventTaskState.Pending, EventTaskState.Cancelled))
        {
            entry.MarkTerminal(ClockTicks);
            lock (_gate)
            {
                DetachLocked(entry);
            }

            entry.SignalPendingCancellation();
            return true;
        }

        return entry.SignalRunningCancel();
    }

    /// <summary>Cancels tasks in batch; running bodies are signalled cooperatively.</summary>
    /// <param name="ids">Task identities.</param>
    /// <returns>Tasks cancelled by this call (pending transitions).</returns>
    public int CancelBatch(ReadOnlySpan<EventTaskId> ids)
    {
        int cancelled = 0;
        for (int i = 0; i < ids.Length; i++)
        {
            if (Cancel(ids[i]))
            {
                cancelled++;
            }
        }

        return cancelled;
    }

    /// <summary>Cancels every live task; running bodies are signalled cooperatively.</summary>
    /// <returns>Tasks cancelled by this call (pending transitions).</returns>
    public int CancelAll()
    {
        int pendingSignals = 0;
        int runningSignals = 0;
        lock (_signalGate)
        {
            lock (_gate)
            {
                for (int i = 0; i < _slots.Length; i++)
                {
                    TaskEntryBase? entry = _slots[i];
                    if (entry is null || entry.IsFree || entry.State != EventTaskState.Pending)
                    {
                        continue;
                    }

                    if (entry.TryTransition(EventTaskState.Pending, EventTaskState.Cancelled))
                    {
                        entry.MarkTerminal(ClockTicks);
                        DetachLocked(entry);
                        _deferredSignals[pendingSignals++] = entry;
                    }
                }

                for (int i = 0; i < _slots.Length; i++)
                {
                    TaskEntryBase? entry = _slots[i];
                    if (entry is not null && !entry.IsFree && entry.State == EventTaskState.Running)
                    {
                        _cancelSignals[runningSignals++] = entry;
                    }
                }
            }

            for (int i = 0; i < runningSignals; i++)
            {
                TaskEntryBase? entry = _cancelSignals[i];
                _cancelSignals[i] = null;
                entry?.SignalRunningCancel();
            }

            for (int i = 0; i < pendingSignals; i++)
            {
                TaskEntryBase? entry = _deferredSignals[i];
                _deferredSignals[i] = null;
                entry?.SignalPendingCancellation();
            }
        }

        return pendingSignals;
    }

    /// <summary>
    /// Evaluates due retry backoffs and task deadlines against the current clock and runs one
    /// scheduling pass. Deterministic driver for fake-clock tests; the lazy hint timer serves
    /// production wakes.
    /// </summary>
    /// <returns>Tasks moved into lanes plus bodies signalled by a deadline.</returns>
    public int AdvanceDueWork()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            return 0;
        }

        int processed = CollectDueRetries() + SignalDueDeadlines();
        if (_options.EnableMetrics)
        {
            processed += RunGcPass();
        }

        ProducerSignalPump();
        return processed;
    }

    /// <summary>Waits until no task is queued, delayed or running.</summary>
    /// <param name="cancellationToken">Abandons waiting; does not cancel tasks.</param>
    public async ValueTask DrainAsync(CancellationToken cancellationToken = default)
    {
        while (!IsIdle)
        {
            DrainWaiter waiter = AcquireDrainWaiter();
            try
            {
                await waiter.Task.WaitAsync(cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                waiter.Release();
            }
        }
    }

    /// <summary>Stops accepting submissions, cancels everything still queued and signals running bodies.</summary>
    public void Complete()
    {
        if (Interlocked.Exchange(ref _closed, 1) != 0)
        {
            return;
        }

        int runningSignals;
        int pendingSignals;
        lock (_signalGate)
        {
            lock (_gate)
            {
                pendingSignals = CancelAllQueuedLocked();
                runningSignals = 0;
                for (int i = 0; i < _slots.Length; i++)
                {
                    TaskEntryBase? entry = _slots[i];
                    if (entry is not null && !entry.IsFree && entry.State == EventTaskState.Running)
                    {
                        _cancelSignals[runningSignals++] = entry;
                    }
                }
            }

            for (int i = 0; i < runningSignals; i++)
            {
                TaskEntryBase? entry = _cancelSignals[i];
                _cancelSignals[i] = null;
                entry?.SignalRunningCancel();
            }

            for (int i = 0; i < pendingSignals; i++)
            {
                TaskEntryBase? entry = _deferredSignals[i];
                _deferredSignals[i] = null;
                entry?.SignalPendingCancellation();
            }
        }

        ProducerSignalPump();
    }

    /// <summary>Metrics snapshot of one task; null when metrics are disabled or the id is unknown.</summary>
    /// <param name="id">Task identity.</param>
    public EventTaskMetrics? GetTaskMetrics(EventTaskId id)
    {
        if (!_options.EnableMetrics)
        {
            return null;
        }

        TaskEntryBase? entry = SlotFor(id);
        return entry is not null && entry.Matches(id) && entry.QueuedAtTicks != 0 ? entry.ToMetrics() : null;
    }

    /// <summary>Metrics snapshots of every live task, in slot order. Cold-path allocation.</summary>
    public List<EventTaskMetrics> GetAllTaskMetrics()
    {
        var result = new List<EventTaskMetrics>();
        if (!_options.EnableMetrics)
        {
            return result;
        }

        lock (_gate)
        {
            for (int i = 0; i < _slots.Length; i++)
            {
                TaskEntryBase? entry = _slots[i];
                if (entry is not null && entry.QueuedAtTicks != 0)
                {
                    result.Add(entry.ToMetrics());
                }
            }
        }

        return result;
    }

    /// <summary>Resets aggregate counters and per-task metrics.</summary>
    public void ClearMetrics()
    {
        lock (_gate)
        {
            _completedCount = 0;
            _failedCount = 0;
            _completedBodies = 0;
            _completedTicksSum = 0;
            _throughputAnchorBodies = 0;
            _throughputAnchorTicks = _timeProvider.GetUtcNow().UtcTicks;
            for (int i = 0; i < _slots.Length; i++)
            {
                _slots[i]?.ResetMetrics();
            }
        }
    }

    /// <summary>Prunes metrics of terminal tasks older than twice the gc window; returns pruned count.</summary>
    public int CollectGarbage() => RunGcPass();

    /// <summary>Point-in-time scheduler counters.</summary>
    public EventTaskStats GetStats()
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        int completedBodies = Volatile.Read(ref _completedBodies);
        long completedTicksSum = Interlocked.Read(ref _completedTicksSum);
        int completed = Volatile.Read(ref _completedCount);
        int failed = Volatile.Read(ref _failedCount);
        double average = completedBodies > 0 ? completedTicksSum * MillisecondsPerTick / completedBodies : 0d;
        double throughput = 0d;
        long memory = (long)_slots.Length * FixedSlotTableBytes;

        if (_options.EnableMetrics)
        {
            double windowSeconds = (now - Volatile.Read(ref _throughputAnchorTicks)) / (double)TimeSpan.TicksPerSecond;
            if (windowSeconds > 0d)
            {
                throughput = (completedBodies - Volatile.Read(ref _throughputAnchorBodies)) / windowSeconds;
            }

            if (windowSeconds >= 60d)
            {
                Volatile.Write(ref _throughputAnchorBodies, completedBodies);
                Volatile.Write(ref _throughputAnchorTicks, now);
            }

            lock (_gate)
            {
                int liveSlots = 0;
                for (int i = 0; i < _slots.Length; i++)
                {
                    if (_slots[i] is not null)
                    {
                        liveSlots++;
                    }
                }

                memory += liveSlots * EstimatedEntryBytes;
            }
        }

        return new EventTaskStats(
            Name,
            Volatile.Read(ref _runningCount),
            Volatile.Read(ref _queuedCount),
            Volatile.Read(ref _delayedCount),
            completed,
            failed,
            completed + failed,
            average,
            throughput,
            memory);
    }

    /// <summary>Closes the scheduler, releases both hint timers and joins in-flight timer callbacks.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Complete();
        DestroyTimers();
        GC.SuppressFinalize(this);
    }

    /// <summary>Closes the scheduler, waits for running bodies, then releases timers.</summary>
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        Complete();
        try
        {
            await DrainIdleAsync().ConfigureAwait(false);
        }
        finally
        {
            DestroyTimers();
        }

        GC.SuppressFinalize(this);
    }

    internal int EntryMaxRetries => _entryMaxRetries;

    private static void OnDeadlineTick(object? state) => ((EventTaskScheduler)state!).AdvanceDueWork();

    private static void OnGcTick(object? state) => _ = ((EventTaskScheduler)state!).RunGcPass();

    private static void OnDeferredPump(object? state) => ((EventTaskScheduler)state!).PumpCore(PassStartLimit);

    private static void OnBodyTaskContinuation(Task completed, object? state)
    {
        _ = completed;
        var entry = (TaskEntryBase)state!;
        entry.Owner.FinishBodyContinuation(entry);
    }

    private static long ClampTimeoutTicks(long ticks)
    {
        const long MaxSafe = TimeSpan.TicksPerDay - TimeSpan.TicksPerSecond;
        return ticks > MaxSafe ? MaxSafe : ticks;
    }

    private long ResolveTimeoutTicks(TimeSpan? timeout)
    {
        if (timeout is TimeSpan explicitTimeout)
        {
            if (explicitTimeout < TimeSpan.Zero)
            {
                ThrowHelper.ThrowArgumentOutOfRange(nameof(timeout), "Timeout must be non-negative.");
            }

            return explicitTimeout <= TimeSpan.Zero ? 0 : ClampTimeoutTicks(explicitTimeout.Ticks);
        }

        return _defaultTimeoutTicks;
    }

    private TaskEntryBase? SlotFor(EventTaskId id)
    {
        if (!id.IsValid)
        {
            return null;
        }

        int slot = EventTaskId.SlotOf(id);
        return slot >= 0 && slot < _slots.Length ? Volatile.Read(ref _slots[slot]) : null;
    }

    private TaskEntryBase AcquireLocked()
    {
        if (_freeHead is not null)
        {
            TaskEntryBase recycled = _freeHead;
            _freeHead = recycled.NextFree;
            recycled.NextFree = null;
            _freeCount--;
            return recycled;
        }

        for (int i = 0; i < _slots.Length; i++)
        {
            if (_slots[i] is null)
            {
                var created = new TaskEntryBase(this, i);
                _slots[i] = created;
                return created;
            }
        }

        ThrowHelper.ThrowQueueFull(EventTaskPriority.Normal, _slots.Length);
        return null!;
    }

    private void ReleaseLocked(TaskEntryBase entry)
    {
        if (_freeCount < _slots.Length && !entry.IsFree)
        {
            entry.MarkFree();
            entry.NextFree = _freeHead;
            _freeHead = entry;
            _freeCount++;
        }
    }

    private void EnqueueLaneLocked(TaskEntryBase entry)
    {
        int lane = entry.PriorityLane;
        entry.Queued = true;
        entry.Next = null;
        if (_laneCounts[lane] == 0)
        {
            _laneHeads[lane] = entry;
            _laneTails[lane] = entry;
        }
        else
        {
            _laneTails[lane].Next = entry;
            _laneTails[lane] = entry;
        }

        _laneCounts[lane]++;
    }

    private TaskEntryBase? DequeueLaneLocked(int lane)
    {
        if (_laneCounts[lane] == 0)
        {
            return null;
        }

        TaskEntryBase entry = _laneHeads[lane];
        _laneHeads[lane] = entry.Next!;
        entry.Next = null;
        _laneCounts[lane]--;
        if (_laneCounts[lane] == 0)
        {
            _laneTails[lane] = null!;
        }

        entry.Queued = false;
        return entry;
    }

    private TaskEntryBase? DequeueAnyLaneLocked()
    {
        for (int lane = 0; lane < LaneCount; lane++)
        {
            TaskEntryBase? entry = DequeueLaneLocked(lane);
            if (entry is not null)
            {
                return entry;
            }
        }

        return null;
    }

    private void RemoveFromLaneLocked(TaskEntryBase entry)
    {
        if (!entry.Queued)
        {
            return;
        }

        int lane = entry.PriorityLane;
        TaskEntryBase? previous = null;
        for (TaskEntryBase? current = _laneHeads[lane]; current is not null; current = current.Next)
        {
            if (ReferenceEquals(current, entry))
            {
                if (previous is null)
                {
                    _laneHeads[lane] = current.Next!;
                }
                else
                {
                    previous.Next = current.Next;
                }

                if (ReferenceEquals(current, _laneTails[lane]))
                {
                    _laneTails[lane] = previous!;
                }

                entry.Next = null;
                entry.Queued = false;
                _laneCounts[lane]--;
                return;
            }

            previous = current;
        }
    }

    private void AddRetryLocked(TaskEntryBase entry, long dueTicks)
    {
        entry.Delayed = true;
        entry.RetryDueTicks = dueTicks;
        entry.Next = null;
        if (_retryTail is null)
        {
            _retryHead = entry;
            _retryTail = entry;
        }
        else
        {
            _retryTail.Next = entry;
            _retryTail = entry;
        }

        _delayedCount++;
    }

    private void RemoveFromRetryLocked(TaskEntryBase entry)
    {
        if (!entry.Delayed)
        {
            return;
        }

        TaskEntryBase? previous = null;
        for (TaskEntryBase? current = _retryHead; current is not null; current = current.Next)
        {
            if (ReferenceEquals(current, entry))
            {
                if (previous is null)
                {
                    _retryHead = current.Next!;
                }
                else
                {
                    previous.Next = current.Next;
                }

                if (ReferenceEquals(current, _retryTail))
                {
                    _retryTail = previous!;
                }

                entry.Next = null;
                entry.Delayed = false;
                _delayedCount--;
                return;
            }

            previous = current;
        }
    }

    private bool DetachLocked(TaskEntryBase entry)
    {
        if (entry.Queued)
        {
            RemoveFromLaneLocked(entry);
            _queuedCount--;
            ReleaseLocked(entry);
            return true;
        }

        if (entry.Delayed)
        {
            RemoveFromRetryLocked(entry);
            ReleaseLocked(entry);
        }

        return false;
    }

    private void AddDeadlineLocked(TaskEntryBase entry)
    {
        entry.InDeadlineList = true;
        entry.NextDeadline = null;
        if (_deadlineTail is null)
        {
            _deadlineHead = entry;
            _deadlineTail = entry;
        }
        else
        {
            _deadlineTail.NextDeadline = entry;
            _deadlineTail = entry;
        }
    }

    private void RemoveDeadlineLocked(TaskEntryBase entry)
    {
        if (!entry.InDeadlineList)
        {
            return;
        }

        TaskEntryBase? previous = null;
        for (TaskEntryBase? current = _deadlineHead; current is not null; current = current.NextDeadline)
        {
            if (ReferenceEquals(current, entry))
            {
                if (previous is null)
                {
                    _deadlineHead = current.NextDeadline!;
                }
                else
                {
                    previous.NextDeadline = current.NextDeadline;
                }

                if (ReferenceEquals(current, _deadlineTail))
                {
                    _deadlineTail = previous!;
                }

                entry.NextDeadline = null;
                entry.InDeadlineList = false;
                return;
            }

            previous = current;
        }
    }

    private void RearmDeadlineTimerLocked()
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        long earliest = NoTicks;
        for (TaskEntryBase? current = _deadlineHead; current is not null; current = current.NextDeadline)
        {
            if (current.DeadlineTicks < earliest)
            {
                earliest = current.DeadlineTicks;
            }
        }

        if (earliest == NoTicks)
        {
            _deadlineTimer.Change(Timeout.Infinite, Timeout.Infinite);
            return;
        }

        long dueIn = earliest > now ? earliest - now : 1;
        _deadlineTimer.Change(dueIn > int.MaxValue ? Timeout.Infinite : dueIn, Timeout.Infinite);
    }

    private int CollectDueRetries()
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        int collected = 0;
        int overflowSignals = 0;
        lock (_signalGate)
        {
            lock (_gate)
            {
                TaskEntryBase? previous = null;
                TaskEntryBase? current = _retryHead;
                while (current is not null)
                {
                    TaskEntryBase? next = current.Next;
                    if (current.RetryDueTicks > now)
                    {
                        previous = current;
                        current = next;
                        continue;
                    }

                    if (previous is null)
                    {
                        _retryHead = next;
                    }
                    else
                    {
                        previous.Next = next;
                    }

                    if (next is null)
                    {
                        _retryTail = previous;
                    }

                    current.Next = null;
                    current.Delayed = false;
                    _delayedCount--;

                    if (current.State == EventTaskState.Pending)
                    {
                        if (_closed == 0 && _queuedCount + _delayedCount < _capacity)
                        {
                            EnqueueLaneLocked(current);
                            _queuedCount++;
                            collected++;
                        }
                        else if (current.TryTransition(EventTaskState.Pending, EventTaskState.Failed))
                        {
                            Interlocked.Increment(ref _failedCount);
                            current.MarkTerminal(now);
                            _deferredSignals[overflowSignals++] = current;
                            ReleaseLocked(current);
                        }
                    }

                    current = next;
                }
            }

            for (int i = 0; i < overflowSignals; i++)
            {
                TaskEntryBase? entry = _deferredSignals[i];
                _deferredSignals[i] = null;
                entry?.SignalOverflowFailure();
            }
        }

        return collected;
    }

    private int SignalDueDeadlines()
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        int signalled = 0;
        lock (_gate)
        {
            for (TaskEntryBase? current = _deadlineHead; current is not null; current = current.NextDeadline)
            {
                if (current.DeadlineTicks <= now &&
                    current.TryTransition(EventTaskState.Running, EventTaskState.Timeout))
                {
                    current.MarkDeadlineFired();
                    current.MarkTerminal(now);
                    Interlocked.Increment(ref _failedCount);
                    current.SignalTimeout();
                    signalled++;
                }
            }

            RearmDeadlineTimerLocked();
        }

        return signalled;
    }

    private void ProducerSignalPump()
    {
        if (t_pumpActive)
        {
            DeferredSignalPump();
            return;
        }

        if (Volatile.Read(ref _queuedCount) == 0 && Volatile.Read(ref _delayedCount) == 0)
        {
            TrySignalIdle();
            return;
        }

        if (Interlocked.CompareExchange(ref _pumpState, PumpRunning, PumpIdle) == PumpIdle)
        {
            PumpCore(0);
            return;
        }

        DeferredSignalPump();
    }

    private void DeferredSignalPump()
    {
        if (Volatile.Read(ref _queuedCount) == 0 && Volatile.Read(ref _delayedCount) == 0)
        {
            return;
        }

        if (Interlocked.CompareExchange(ref _pumpState, PumpDeferred, PumpIdle) == PumpIdle)
        {
            ThreadPool.UnsafeQueueUserWorkItem(S_OnDeferredPump, this);
        }
    }

    private void PumpCore(int budget)
    {
        t_pumpActive = true;
        int started = 0;
        try
        {
            while (budget == 0 || started < budget)
            {
                TaskEntryBase? entry = StartNextStep();
                if (entry is null)
                {
                    break;
                }

                started++;
            }
        }
        finally
        {
            t_pumpActive = false;
            Volatile.Write(ref _pumpState, PumpIdle);
            if (Volatile.Read(ref _queuedCount) > 0 || Volatile.Read(ref _delayedCount) > 0)
            {
                DeferredSignalPump();
            }
            else
            {
                TrySignalIdle();
            }
        }
    }

    private TaskEntryBase? StartNextStep()
    {
        TaskEntryBase entry;
        lock (_gate)
        {
            if (_closed != 0)
            {
                TaskEntryBase? stale = DequeueAnyLaneLocked();
                if (stale is null)
                {
                    return null;
                }

                _queuedCount--;
                if (stale.State == EventTaskState.Pending &&
                    stale.TryTransition(EventTaskState.Pending, EventTaskState.Cancelled))
                {
                    stale.MarkTerminal(ClockTicks);
                    stale.SignalPendingCancellation();
                    ReleaseLocked(stale);
                }

                return stale;
            }

            if (Volatile.Read(ref _runningCount) >= _options.ConcurrencyLimit)
            {
                return null;
            }

            TaskEntryBase? candidate = null;
            while (true)
            {
                TaskEntryBase? next = DequeueAnyLaneLocked();
                if (next is null)
                {
                    break;
                }

                _queuedCount--;
                if (next.State == EventTaskState.Pending &&
                    next.TryTransition(EventTaskState.Pending, EventTaskState.Running))
                {
                    candidate = next;
                    break;
                }

                ReleaseLocked(next);
            }

            if (candidate is null)
            {
                return null;
            }

            entry = candidate;
            entry.BeginBody(_timeProvider.GetUtcNow().UtcTicks);
            if (entry.TimeoutTicks != 0)
            {
                AddDeadlineLocked(entry);
            }

            RearmDeadlineTimerLocked();
            Interlocked.Increment(ref _runningCount);
        }

        entry.ExecuteBody();
        return entry;
    }

    internal void ExecuteBody(TaskEntryBase entry)
    {
        ValueTask pending;
        try
        {
            pending = entry.InvokeExecutor();
        }
        catch (Exception ex)
        {
            FinishBody(entry, succeeded: false, failure: ex);
            return;
        }

        if (pending.IsCompleted)
        {
            Exception? failure = entry.Provider?.TakePendingFailure();
            FinishBody(entry, succeeded: failure is null, failure);
            return;
        }

        pending.AsTask().ContinueWith(
            S_OnBodyTaskContinuation,
            entry,
            CancellationToken.None,
            TaskContinuationOptions.ExecuteSynchronously,
            TaskScheduler.Default);
    }

    internal void FinishBodyContinuation(TaskEntryBase entry)
    {
        Exception? failure = entry.Provider?.TakePendingFailure();
        FinishBody(entry, succeeded: failure is null, failure);
    }

    internal void FinishBody(TaskEntryBase entry, bool succeeded, Exception? failure)
    {
        long now = _timeProvider.GetUtcNow().UtcTicks;
        long executionTicks = Math.Max(0, now - entry.StartedAtTicks);
        entry.AddBodyChain(executionTicks);

        if (succeeded)
        {
            if (entry.TryTransition(EventTaskState.Running, EventTaskState.Completed))
            {
                entry.MarkTerminal(now);
                entry.SignalSuccess();
                Interlocked.Increment(ref _completedCount);
            }
        }
        else
        {
            HandleBodyFailure(entry, failure!, now);
        }

        lock (_gate)
        {
            if (!entry.IsFree && !entry.Delayed)
            {
                RemoveDeadlineLocked(entry);
                RearmDeadlineTimerLocked();
                ReleaseLocked(entry);
            }
        }

        if (Interlocked.Decrement(ref _runningCount) == 0)
        {
            TrySignalIdle();
        }

        if (Volatile.Read(ref _queuedCount) > 0 || Volatile.Read(ref _delayedCount) > 0)
        {
            if (t_pumpActive)
            {
                DeferredSignalPump();
            }
            else
            {
                ProducerSignalPump();
            }
        }
    }

    private void HandleBodyFailure(TaskEntryBase entry, Exception failure, long now)
    {
        if (entry.State is EventTaskState.Timeout or EventTaskState.Cancelled)
        {
            return;
        }

        if (failure is OperationCanceledException)
        {
            if (entry.DeadlineFired)
            {
                if (entry.TryTransition(EventTaskState.Running, EventTaskState.Timeout))
                {
                    entry.MarkTerminal(now);
                    entry.SignalTimeout();
                    Interlocked.Increment(ref _failedCount);
                }

                return;
            }

            if (entry.CancelRequested)
            {
                if (entry.TryTransition(EventTaskState.Running, EventTaskState.Cancelled))
                {
                    entry.MarkTerminal(now);
                    entry.SignalRunningOperationCanceled();
                }

                return;
            }
        }

        if (entry.RetryCount < _entryMaxRetries)
        {
            int attempt = entry.IncrementRetry();
            long dueTicks = ComputeRetryDue(attempt);
            entry.CaptureRetryFailure(failure);
            if (!entry.TryTransition(EventTaskState.Running, EventTaskState.Pending))
            {
                return;
            }

            entry.ResetBodyObservances();
            bool retrying;
            lock (_gate)
            {
                retrying = _closed == 0 && !entry.IsFree;
                if (retrying)
                {
                    AddRetryLocked(entry, dueTicks);
                }
            }

            if (retrying)
            {
                return;
            }

            if (entry.TryTransition(EventTaskState.Pending, EventTaskState.Cancelled))
            {
                entry.MarkTerminal(now);
                entry.SignalPendingCancellation();
            }

            return;
        }

        if (entry.TryTransition(EventTaskState.Running, EventTaskState.Failed))
        {
            entry.MarkTerminal(now);
            entry.SignalFailure(failure);
            Interlocked.Increment(ref _failedCount);
        }
    }

    private long ComputeRetryDue(int attempt)
    {
        TimeSpan delay = EventTaskSchedulerOptions.RetryDelayFor(_options.RetryDelay, _options.RetryBackoff, attempt);
        long now = _timeProvider.GetUtcNow().UtcTicks;
        if (delay == TimeSpan.MaxValue || delay.Ticks > NoTicks - now)
        {
            return NoTicks;
        }

        return now + delay.Ticks;
    }

    private void TrySignalIdle()
    {
        if (!IsIdle)
        {
            return;
        }

        for (int i = 0; i < DrainWaiterCount; i++)
        {
            _drainWaiters[i].ReleaseIfClaimed();
        }
    }

    private DrainWaiter AcquireDrainWaiter()
    {
        for (int attempt = 0; attempt < 8; attempt++)
        {
            for (int i = 0; i < DrainWaiterCount; i++)
            {
                DrainWaiter waiter = _drainWaiters[i];
                if (waiter.TryClaim())
                {
                    return waiter;
                }
            }

            new SpinWait().SpinOnce();
        }

        ThrowHelper.ThrowWaitCapacityExceeded();
        return null!;
    }

    private async ValueTask DrainIdleAsync()
    {
        while (!IsIdle)
        {
            DrainWaiter waiter = AcquireDrainWaiter();
            try
            {
                await waiter.Task.ConfigureAwait(false);
            }
            finally
            {
                waiter.Release();
            }
        }
    }

    private int RunGcPass()
    {
        if (!_options.EnableMetrics || Volatile.Read(ref _disposed) != 0)
        {
            return 0;
        }

        long cutoff = _timeProvider.GetUtcNow().UtcTicks - _gcWindowTicks * 2;
        int pruned = 0;
        lock (_gate)
        {
            for (int i = 0; i < _slots.Length; i++)
            {
                TaskEntryBase? entry = _slots[i];
                if (entry is not null &&
                    entry.IsFree &&
                    entry.CompletedAtTicks != 0 &&
                    entry.CompletedAtTicks < cutoff &&
                    entry.State is EventTaskState.Completed or EventTaskState.Failed or EventTaskState.Cancelled or EventTaskState.Timeout)
                {
                    entry.ResetMetrics();
                    pruned++;
                }
            }
        }

        return pruned;
    }

    private void DestroyTimers()
    {
        // Timer.Dispose(WaitHandle) only signals WaitHandle-compatible events;
        // ManualResetEventSlim.WaitHandle is never signalled by the timer infrastructure.
        using ManualResetEvent deadlineDone = new(false);
        _deadlineTimer.Dispose(deadlineDone);
        deadlineDone.WaitOne();
        _deadlineTimer.Dispose();
        if (_gcTimer is not null)
        {
            using ManualResetEvent gcDone = new(false);
            _gcTimer.Dispose(gcDone);
            gcDone.WaitOne();
            _gcTimer.Dispose();
        }

        lock (_gate)
        {
            for (int i = 0; i < _slots.Length; i++)
            {
                _slots[i]?.Dispose();
            }
        }
    }

    private int CancelAllQueuedLocked()
    {
        int pendingSignals = 0;
        while (true)
        {
            TaskEntryBase? entry = DequeueAnyLaneLocked();
            if (entry is null)
            {
                break;
            }

            _queuedCount--;
            if (entry.State == EventTaskState.Pending &&
                entry.TryTransition(EventTaskState.Pending, EventTaskState.Cancelled))
            {
                entry.MarkTerminal(ClockTicks);
                _deferredSignals[pendingSignals++] = entry;
                ReleaseLocked(entry);
            }
        }

        while (_retryHead is not null)
        {
            TaskEntryBase entry = _retryHead;
            _retryHead = entry.Next;
            entry.Next = null;
            entry.Delayed = false;
            _delayedCount--;
            if (entry.State == EventTaskState.Pending &&
                entry.TryTransition(EventTaskState.Pending, EventTaskState.Cancelled))
            {
                entry.MarkTerminal(ClockTicks);
                _deferredSignals[pendingSignals++] = entry;
                ReleaseLocked(entry);
            }
        }

        return pendingSignals;
    }

    private sealed class DrainWaiter
    {
        private readonly TaskCompletionSource<bool> _tcs = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _claimed;

        internal Task Task => _tcs.Task;

        internal bool TryClaim() => Interlocked.CompareExchange(ref _claimed, 1, 0) == 0;

        internal void ReleaseIfClaimed()
        {
            if (Volatile.Read(ref _claimed) == 1)
            {
                Release();
            }
        }

        internal void Release()
        {
            if (Interlocked.Exchange(ref _claimed, 0) == 1)
            {
                _tcs.TrySetResult(true);
            }
        }
    }

    internal sealed class TaskEntryBase : IDisposable
    {
        internal readonly EventTaskScheduler Owner;
        internal EventTaskId Id;
        internal int SlotIndex;
        internal int StateField;
        internal int PriorityLane;
        internal int Attempt;
        internal int CancelRequestedFlag;
        internal int FreeFlag;
        internal long QueuedAtTicks;
        internal long StartedAtTicks;
        internal long CompletedAtTicks;
        internal long TimeoutTicks;
        internal long RetryDueTicks;
        internal double ExecutionTimeMs;
        internal bool Queued;
        internal bool Delayed;
        internal bool InDeadlineList;
        internal bool DeadlineFired;
        internal Exception? LastRetryFailure;
        internal ProviderBase? Provider;
        internal TaskEntryBase? Next;
        internal TaskEntryBase? NextFree;
        internal TaskEntryBase? NextDeadline;

        private readonly CancellationTokenSource _cts;
        private readonly CancellationTokenRegistration _tokenRegistration;

        internal TaskEntryBase(EventTaskScheduler owner, int slotIndex)
        {
            Owner = owner;
            SlotIndex = slotIndex;
            _cts = new CancellationTokenSource();
            _tokenRegistration = _cts.Token.UnsafeRegister(static state => ((TaskEntryBase)state!).OnCancelSignal(), this);
        }

        internal EventTaskState State => (EventTaskState)Volatile.Read(ref StateField);

        internal bool IsFree => Volatile.Read(ref FreeFlag) != 0;

        internal bool CancelRequested => Volatile.Read(ref CancelRequestedFlag) != 0;

        internal int RetryCount => Volatile.Read(ref Attempt);

        internal CancellationToken Token
        {
            get
            {
                try
                {
                    return _cts.Token;
                }
                catch (ObjectDisposedException)
                {
                    return default;
                }
            }
        }

        internal long DeadlineTicks
        {
            get
            {
                long timeout = Volatile.Read(ref TimeoutTicks);
                long start = Volatile.Read(ref StartedAtTicks);
                return timeout == 0 || start == 0 ? NoTicks : Math.Min(NoTicks, start + timeout);
            }
        }

        internal ValueTask UntypedCompletion => Provider is null ? ValueTask.CompletedTask : Provider.CompletionSignal;

        internal Entry<TResult> Typed<TResult>()
        {
            if (Provider is Entry<TResult> typed)
            {
                return typed;
            }

            throw new InvalidCastException($"Task {Id.Value} was not submitted with result type {typeof(TResult).Name}.");
        }

        internal void SignalSuccess() => Provider?.SetStateResult(State, null, Token);

        internal void SignalTimeout() => Provider?.SetStateResult(State, new TimeoutException($"Task {Id.Value} timed out."), Token);

        internal void SignalPendingCancellation() => Provider?.SetStateResult(State, null, Token);

        internal void SignalRunningOperationCanceled() => Provider?.SetStateResult(State, null, Token);

        internal void SignalFailure(Exception failure) => Provider?.SetStateResult(State, failure, Token);

        internal void SignalOverflowFailure() => Provider?.SetStateResult(
            State,
            LastRetryFailure ?? new InvalidOperationException($"Task {Id.Value} lost its retry slot."),
            Token);

        internal bool TryTransition(EventTaskState expected, EventTaskState next) =>
            Interlocked.CompareExchange(ref StateField, (int)next, (int)expected) == (int)expected;

        internal bool Matches(EventTaskId id) => Id.Value == id.Value;

        internal void BeginSubmit(EventTaskId id, ProviderBase provider)
        {
            Provider?.Recycle();
            Id = id;
            Provider = provider;
            Interlocked.Exchange(ref StateField, (int)EventTaskState.Pending);
            Volatile.Write(ref FreeFlag, 0);
            Volatile.Write(ref CancelRequestedFlag, 0);
            Volatile.Write(ref Attempt, 0);
            Volatile.Write(ref DeadlineFired, false);
            Queued = false;
            Delayed = false;
            InDeadlineList = false;
            Next = null;
            NextDeadline = null;
            NextFree = null;
            CompletedAtTicks = 0;
            StartedAtTicks = 0;
            ExecutionTimeMs = 0;
            Volatile.Write(ref TimeoutTicks, 0);
            LastRetryFailure = null;
        }

        internal void Setup(EventTaskPriority priority, long queuedAtTicks, long timeoutTicks)
        {
            PriorityLane = (int)priority;
            QueuedAtTicks = queuedAtTicks;
            Volatile.Write(ref TimeoutTicks, timeoutTicks);
        }

        internal void BeginBody(long nowTicks) => StartedAtTicks = nowTicks;

        internal ValueTask InvokeExecutor()
        {
            if (Provider is null)
            {
                return ValueTask.FromException(new InvalidOperationException("The task body is detached."));
            }

            try
            {
                return Provider.Executor(_cts.Token);
            }
            catch (ObjectDisposedException)
            {
                return ValueTask.FromException(new ObjectDisposedException(nameof(CancellationTokenSource)));
            }
        }

        internal void MarkTerminal(long nowTicks) => Volatile.Write(ref CompletedAtTicks, nowTicks);

        internal void MarkDeadlineFired() => Volatile.Write(ref DeadlineFired, true);

        internal void MarkFree() => Volatile.Write(ref FreeFlag, 1);

        internal void AddBodyChain(long executionTicks)
        {
            ExecutionTimeMs = executionTicks * MillisecondsPerTick;
            Interlocked.Add(ref Owner._completedTicksSum, executionTicks);
            Interlocked.Increment(ref Owner._completedBodies);
        }

        internal void ResetBodyObservances()
        {
            Volatile.Write(ref CancelRequestedFlag, 0);
            Volatile.Write(ref DeadlineFired, false);
        }

        internal int IncrementRetry() => Interlocked.Increment(ref Attempt);

        internal void CaptureRetryFailure(Exception failure) => LastRetryFailure = failure;

        internal void ExecuteBody() => Owner.ExecuteBody(this);

        internal bool SignalRunningCancel()
        {
            if (State != EventTaskState.Running)
            {
                return false;
            }

            bool firstRequest = Interlocked.Exchange(ref CancelRequestedFlag, 1) == 0;
            try
            {
                _cts.Cancel();
            }
            catch (ObjectDisposedException)
            {
            }

            return firstRequest;
        }

        internal EventTaskMetrics ToMetrics() => new(
            Id,
            (EventTaskPriority)PriorityLane,
            State,
            QueuedAtTicks,
            StartedAtTicks,
            CompletedAtTicks,
            ExecutionTimeMs,
            RetryCount);

        internal void ResetMetrics()
        {
            Volatile.Write(ref Attempt, 0);
            QueuedAtTicks = 0;
            StartedAtTicks = 0;
            CompletedAtTicks = 0;
            ExecutionTimeMs = 0;
            Volatile.Write(ref DeadlineFired, false);
        }

        private void OnCancelSignal()
        {
            if (State == EventTaskState.Running)
            {
                Volatile.Write(ref CancelRequestedFlag, 1);
            }
        }

        public void Dispose()
        {
            CancellationTokenSource cts = _cts;
            CancellationTokenRegistration registration = _tokenRegistration;
            registration.Dispose();
            cts.Dispose();
        }
    }

    internal abstract class ProviderBase : IValueTaskSource
    {
        internal readonly EventTaskScheduler Owner;

        private ManualResetValueTaskSourceCore<object?> _untyped;
        private Func<CancellationToken, ValueTask>? _executor;
        private short _untypedToken;
        private Exception? _pendingFailure;

        protected ProviderBase(EventTaskScheduler owner)
        {
            Owner = owner;
            _untyped = new ManualResetValueTaskSourceCore<object?> { RunContinuationsAsynchronously = true };
        }

        internal Func<CancellationToken, ValueTask> Executor => _executor ??= Run;

        internal ValueTask UntypedSignal => new(this, _untypedToken);

        internal virtual ValueTask CompletionSignal => UntypedSignal;

        void IValueTaskSource.GetResult(short token) => _untyped.GetResult(token);

        ValueTaskSourceStatus IValueTaskSource.GetStatus(short token) => _untyped.GetStatus(token);

        void IValueTaskSource.OnCompleted(Action<object?> continuation, object? state, short token, ValueTaskSourceOnCompletedFlags flags) =>
            _untyped.OnCompleted(continuation, state, token, flags);

        internal Exception? TakePendingFailure()
        {
            Exception? failure = Volatile.Read(ref _pendingFailure);
            Volatile.Write(ref _pendingFailure, null);
            return failure;
        }

        internal void ResetCycle()
        {
            Volatile.Write(ref _pendingFailure, null);
            _untyped.Reset();
            _untypedToken = _untyped.Version;
        }

        internal void CompleteUntypedSuccess()
        {
            if (_untyped.GetStatus(_untypedToken) == ValueTaskSourceStatus.Pending)
            {
                _untyped.SetResult(null);
            }
        }

        internal void CompleteUntypedFailure(Exception failure)
        {
            Volatile.Write(ref _pendingFailure, failure);
            if (_untyped.GetStatus(_untypedToken) == ValueTaskSourceStatus.Pending)
            {
                _untyped.SetException(failure);
            }
        }

        internal virtual void Recycle()
        {
        }

        internal abstract void SetStateResult(EventTaskState state, Exception? failure, CancellationToken token);

        private static Exception? ConsumeCompleted(ValueTask started)
        {
            if (started.IsCompletedSuccessfully)
            {
                return null;
            }

            try
            {
                started.GetAwaiter().GetResult();
                return null;
            }
            catch (Exception ex)
            {
                return ex;
            }
        }

        protected abstract ValueTask InvokeTypedBody(CancellationToken token);

        private ValueTask Run(CancellationToken token)
        {
            ValueTask pending;
            try
            {
                pending = InvokeTypedBody(token);
            }
            catch (Exception ex)
            {
                CompleteUntypedFailure(ex);
                return default;
            }

            if (pending.IsCompleted)
            {
                if (ConsumeCompleted(pending) is { } completedFailure)
                {
                    CompleteUntypedFailure(completedFailure);
                }
                else
                {
                    CompleteUntypedSuccess();
                }

                return default;
            }

            return AwaitBody(pending);
        }

        private async ValueTask AwaitBody(ValueTask started)
        {
            try
            {
                await started.ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                CompleteUntypedFailure(ex);
                return;
            }

            CompleteUntypedSuccess();
        }
    }

    internal sealed class Entry<TResult> : ProviderBase, IValueTaskSource<TResult>
    {
        private static Entry<TResult>? s_pool;
        private static int s_poolCount;
        private const int MaxPoolCount = int.MaxValue;

        private ManualResetValueTaskSourceCore<TResult> _completion;
        private Entry<TResult>? _nextPooled;
        private Task<TResult>? _completionTask;
        private Func<object?, CancellationToken, ValueTask<TResult>>? _boundBody;
        private Func<CancellationToken, ValueTask<TResult>>? _typedBody;
        private object? _argument;
        private TResult _result = default!;
        private short _token;

        internal Entry(EventTaskScheduler owner)
            : base(owner)
        {
            _completion = new ManualResetValueTaskSourceCore<TResult> { RunContinuationsAsynchronously = true };
        }

        internal static Entry<TResult> Acquire(EventTaskScheduler owner)
        {
            Entry<TResult>? pooled = Volatile.Read(ref s_pool);
            if (pooled is not null)
            {
                Volatile.Write(ref s_pool, pooled._nextPooled);
                pooled._nextPooled = null;
                s_poolCount--;
                pooled.BeginCycle();
                return pooled;
            }

            var created = new Entry<TResult>(owner);
            created.BeginCycle();
            return created;
        }

        internal Task<TResult> CompletionTask
        {
            get
            {
                if (_completionTask is not null)
                {
                    return _completionTask;
                }

                if (_completion.GetStatus(_token) == ValueTaskSourceStatus.Pending)
                {
                    return _completionTask = new ValueTask<TResult>(this, _token).AsTask();
                }

                if (_completion.GetStatus(_token) == ValueTaskSourceStatus.Succeeded)
                {
                    return Task.FromResult(_completion.GetResult(_token));
                }

                try
                {
                    _completion.GetResult(_token);
                }
                catch (OperationCanceledException ex)
                {
                    return ex.CancellationToken.IsCancellationRequested
                        ? Task.FromCanceled<TResult>(ex.CancellationToken)
                        : Task.FromCanceled<TResult>(new CancellationToken(true));
                }
                catch (Exception ex)
                {
                    return Task.FromException<TResult>(ex);
                }

                return Task.FromResult(_result);
            }
        }

        TResult IValueTaskSource<TResult>.GetResult(short token) => _completion.GetResult(token);

        ValueTaskSourceStatus IValueTaskSource<TResult>.GetStatus(short token) => _completion.GetStatus(token);

        void IValueTaskSource<TResult>.OnCompleted(Action<object?> continuation, object? state, short token, ValueTaskSourceOnCompletedFlags flags) =>
            _completion.OnCompleted(continuation, state, token, flags);

        internal override ValueTask CompletionSignal => new(this, _token);

        internal void BindBound(Func<object?, CancellationToken, ValueTask<TResult>> body, object? state)
        {
            _boundBody = body;
            _typedBody = null;
            _argument = state;
        }

        internal void BindTyped(Func<CancellationToken, ValueTask<TResult>> body)
        {
            _typedBody = body;
            _boundBody = null;
            _argument = null;
        }

        internal void BindReference<TArg>(Func<TArg, CancellationToken, ValueTask<TResult>> body, TArg state)
        {
            _boundBody = (object? boxed, CancellationToken token) => body((TArg)boxed!, token);
            _typedBody = null;
            _argument = state;
        }

        internal override void SetStateResult(EventTaskState state, Exception? failure, CancellationToken token)
        {
            if (_completion.GetStatus(_token) != ValueTaskSourceStatus.Pending)
            {
                return;
            }

            switch (state)
            {
                case EventTaskState.Completed:
                    _completion.SetResult(_result);
                    break;
                case EventTaskState.Cancelled:
                    _completion.SetException(token.CanBeCanceled ? new OperationCanceledException(token) : new OperationCanceledException());
                    break;
                default:
                    _completion.SetException(failure!);
                    break;
            }
        }

        internal override void Recycle()
        {
            _boundBody = null;
            _typedBody = null;
            _argument = null;
            _completionTask = null;
            _result = default!;
            _completion.Reset();
            if (s_poolCount < MaxPoolCount)
            {
                _nextPooled = Volatile.Read(ref s_pool);
                Volatile.Write(ref s_pool, this);
                s_poolCount++;
            }
        }

        private void BeginCycle()
        {
            _result = default!;
            _completionTask = null;
            _completion.Reset();
            _token = _completion.Version;
            ResetCycle();
        }

        protected override ValueTask InvokeTypedBody(CancellationToken token)
        {
            if (_typedBody is { } typed)
            {
                ValueTask<TResult> typedPending = typed(token);
                if (typedPending.IsCompleted)
                {
                    _result = typedPending.GetAwaiter().GetResult();
                    return default;
                }

                return CaptureTypedAsync(typedPending);
            }

            ValueTask<TResult> pending = _boundBody!(_argument, token);
            if (pending.IsCompleted)
            {
                _result = pending.GetAwaiter().GetResult();
                return default;
            }

            return CaptureTypedAsync(pending);
        }

        private async ValueTask CaptureTypedAsync(ValueTask<TResult> pending)
        {
            _result = await pending.ConfigureAwait(false);
        }
    }
}
