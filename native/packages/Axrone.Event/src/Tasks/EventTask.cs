namespace Axrone.Event;

/// <summary>Opaque scheduler-owned task identity; zero-valued ids are never issued.</summary>
/// <param name="value">Packed slot index and generation; positive for issued ids.</param>
public readonly struct EventTaskId(long value) : IEquatable<EventTaskId>
{
    /// <summary>Packed slot index and issue generation.</summary>
    public long Value { get; } = value;

    /// <summary>Whether the id was issued by a scheduler.</summary>
    public bool IsValid => Value > 0;

    internal static EventTaskId Create(int slot, long generation)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(slot);
        return new EventTaskId((generation << 32) | (uint)slot);
    }

    internal static int SlotOf(EventTaskId id) => (int)(uint)id.Value;

    /// <inheritdoc/>
    public bool Equals(EventTaskId other) => Value == other.Value;

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is EventTaskId other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => Value.GetHashCode();

    /// <inheritdoc/>
    public override string ToString() => IsValid ? $"task:{Value}" : "task:<invalid>";

    /// <summary>Equality operator.</summary>
    public static bool operator ==(EventTaskId left, EventTaskId right) => left.Equals(right);

    /// <summary>Inequality operator.</summary>
    public static bool operator !=(EventTaskId left, EventTaskId right) => !left.Equals(right);
}

/// <summary>
/// Task queue priority. Lower values leave the queue first; ties inside a lane run in submit
/// order. Steps match the TypeScript scheduler: IMMEDIATE, HIGH, NORMAL, LOW, IDLE.
/// </summary>
public enum EventTaskPriority : byte
{
    /// <summary>Runs before every other lane.</summary>
    Immediate = 0,

    /// <summary>Runs after immediate and before normal.</summary>
    High = 1,

    /// <summary>Default priority.</summary>
    Normal = 2,

    /// <summary>Runs after normal and before idle.</summary>
    Low = 3,

    /// <summary>Runs only when no higher lane holds work.</summary>
    Idle = 4
}

/// <summary>Validates task priority values crossing the public API.</summary>
internal static class EventTaskPriorityGuard
{
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Validate(EventTaskPriority priority)
    {
        if ((uint)priority > (uint)EventTaskPriority.Idle)
        {
            ThrowHelper.ThrowArgumentOutOfRange(
                nameof(priority),
                "Priority must be Immediate, High, Normal, Low or Idle.");
        }
    }
}

/// <summary>
/// Task lifecycle states. Allowed transitions: PENDING→RUNNING, PENDING→CANCELLED,
/// RUNNING→COMPLETED, RUNNING→FAILED, RUNNING→TIMEOUT, RUNNING→PENDING (retry),
/// RUNNING→CANCELLED; close cancels every non-terminal task. Terminal states never leave.
/// </summary>
public enum EventTaskState : byte
{
    /// <summary>Accepted and waiting for a concurrency slot.</summary>
    Pending = 0,

    /// <summary>Body executing.</summary>
    Running = 1,

    /// <summary>Body finished without failure.</summary>
    Completed = 2,

    /// <summary>Body failed and the retry budget is exhausted.</summary>
    Failed = 3,

    /// <summary>Cancel requested and applied.</summary>
    Cancelled = 4,

    /// <summary>Deadline from the task timeout elapsed; counted as a failure.</summary>
    Timeout = 5
}

/// <summary>Snapshot of one task's lifecycle timings and counters.</summary>
/// <param name="Id">Task identity.</param>
/// <param name="Priority">Queue lane of the task.</param>
/// <param name="State">Observed lifecycle state.</param>
/// <param name="QueuedAtTicks">Queue instant in UTC ticks of the scheduler clock.</param>
/// <param name="StartedAtTicks">First start instant in UTC ticks; zero before the first start.</param>
/// <param name="CompletedAtTicks">Terminal instant in UTC ticks; zero while non-terminal.</param>
/// <param name="ExecutionTimeMs">Last body execution in milliseconds; zero before the first start.</param>
/// <param name="RetryCount">Retries consumed so far.</param>
public readonly record struct EventTaskMetrics(
    EventTaskId Id,
    EventTaskPriority Priority,
    EventTaskState State,
    long QueuedAtTicks,
    long StartedAtTicks,
    long CompletedAtTicks,
    double ExecutionTimeMs,
    int RetryCount)
{
    /// <summary>Milliseconds between queueing and the last body start.</summary>
    public double WaitTimeMs => StartedAtTicks > 0 ? (StartedAtTicks - QueuedAtTicks) / 10_000d : 0d;
}

/// <summary>Point-in-time scheduler counters.</summary>
/// <param name="Name">Scheduler name.</param>
/// <param name="ActiveCount">Tasks whose body has been started and not yet finished.</param>
/// <param name="QueuedCount">Tasks waiting in lanes.</param>
/// <param name="DelayedRetryCount">Retries waiting for their backoff instant.</param>
/// <param name="CompletedCount">Tasks completed since the last metrics clear.</param>
/// <param name="FailedCount">Tasks failed or timed out since the last metrics clear.</param>
/// <param name="TotalProcessed">Completed plus failed.</param>
/// <param name="AverageExecutionTimeMs">Mean body execution over all measured bodies.</param>
/// <param name="ThroughputPerSecond">Bodies finished per second over the throughput window.</param>
/// <param name="EstimatedMemoryBytes">Fixed slot table plus working task objects.</param>
public readonly record struct EventTaskStats(
    string Name,
    int ActiveCount,
    int QueuedCount,
    int DelayedRetryCount,
    int CompletedCount,
    int FailedCount,
    int TotalProcessed,
    double AverageExecutionTimeMs,
    double ThroughputPerSecond,
    long EstimatedMemoryBytes);

/// <summary>Handle returned by <see cref="EventTaskScheduler"/> submissions.</summary>
public readonly struct EventTaskHandle
{
    private readonly EventTaskScheduler? _scheduler;
    private readonly EventTaskScheduler.TaskEntryBase? _entry;

    internal EventTaskHandle(EventTaskScheduler scheduler, EventTaskScheduler.TaskEntryBase entry)
    {
        _scheduler = scheduler;
        _entry = entry;
    }

    /// <summary>Task identity; zero-valued for handles of rejected submissions.</summary>
    public EventTaskId Id => _entry?.Id ?? default;

    /// <summary>Whether the handle owns a slot.</summary>
    public bool IsValid => _entry is not null;

    /// <summary>Current lifecycle state of the task; cancelled for invalid handles.</summary>
    public EventTaskState State => _entry?.State ?? EventTaskState.Cancelled;

    /// <summary>Cancellation token observed by the running body.</summary>
    public CancellationToken CancellationToken => _entry?.Token ?? default;

    /// <summary>Awaitable completion with the typed result.</summary>
    /// <typeparam name="TResult">Result type the task was submitted with.</typeparam>
    /// <exception cref="InvalidCastException">The task was submitted with another result type.</exception>
    /// <exception cref="InvalidOperationException">The handle is invalid.</exception>
    public ValueTask<TResult> AwaitAsync<TResult>()
    {
        if (_entry is null)
        {
            ThrowHelper.ThrowInvalidTaskHandle();
        }

        return new ValueTask<TResult>(_entry.Typed<TResult>().CompletionTask);
    }

    /// <summary>Awaitable completion signal; result values are discarded.</summary>
    /// <exception cref="InvalidOperationException">The handle is invalid.</exception>
    public ValueTask AwaitAsync()
    {
        if (_entry is null)
        {
            ThrowHelper.ThrowInvalidTaskHandle();
        }

        return _entry.UntypedCompletion;
    }

    /// <summary>Cancels the task through the owning scheduler.</summary>
    /// <returns>True when cancellation was applied by this call; false for invalid handles.</returns>
    public bool Cancel() => _entry is not null && _scheduler is not null && _scheduler.Cancel(_entry.Id);
}
