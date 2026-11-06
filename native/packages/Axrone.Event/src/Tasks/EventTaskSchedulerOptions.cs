namespace Axrone.Event;

using Axrone.Utility.Backoff;
using Axrone.Utility.Builders;

/// <summary>
/// Bounds for <see cref="EventTaskScheduler"/>. Field defaults mirror the TypeScript scheduler
/// constructor; invalid or negative values are rejected by
/// <see cref="EventTaskSchedulerOptionsState.TryValidate"/>.
/// </summary>
/// <param name="Name">Scheduler name reported by stats.</param>
/// <param name="ConcurrencyLimit">Upper bound on concurrently running bodies; int.MaxValue is unbounded.</param>
/// <param name="MaxQueueSize">Total lane capacity across all priorities.</param>
/// <param name="EnableMetrics">Whether per-task metrics and throughput are recorded.</param>
/// <param name="EnableRetries">Whether failed bodies may consume the retry budget.</param>
/// <param name="MaxRetries">Retry attempts per task.</param>
/// <param name="RetryDelay">Base backoff delay between retries.</param>
/// <param name="RetryBackoff">Delay growth per consumed retry.</param>
/// <param name="TaskTimeout">Default deadline per task; zero disables deadlines.</param>
/// <param name="GcInterval">Period for pruning stale terminal metrics; zero disables the timer.</param>
public readonly record struct EventTaskSchedulerOptions(
    string Name,
    int ConcurrencyLimit,
    int MaxQueueSize,
    bool EnableMetrics,
    bool EnableRetries,
    int MaxRetries,
    TimeSpan RetryDelay,
    BackoffDuration RetryBackoff,
    TimeSpan TaskTimeout,
    TimeSpan GcInterval)
{
    /// <summary>Unbounded concurrency sentinel.</summary>
    public const int UnboundedConcurrency = int.MaxValue;

    private const long MaxTicks = TimeSpan.TicksPerDay;

    /// <summary>
    /// Delay before the given retry attempt (one-based): base delay per retry plus the additive
    /// backoff triangle, saturated at <see cref="TimeSpan.MaxValue"/>.
    /// </summary>
    /// <param name="retryDelay">Base delay per retry.</param>
    /// <param name="retryBackoff">Extra delay added on every consumed retry.</param>
    /// <param name="attempt">One-based retry index the delay is computed for.</param>
    public static TimeSpan RetryDelayFor(TimeSpan retryDelay, BackoffDuration retryBackoff, int attempt)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(attempt);
        long backoffTicks = retryBackoff.Nanoseconds / BackoffDuration.NanosecondsPerTick;
        long baseTicks = retryDelay.Ticks;
        long triangle = (long)attempt * (attempt - 1) / 2;

        if (baseTicks != 0 && attempt > MaxTicks / baseTicks)
        {
            return TimeSpan.MaxValue;
        }

        if (backoffTicks != 0 && triangle > MaxTicks / backoffTicks)
        {
            return TimeSpan.MaxValue;
        }

        long total = baseTicks * attempt + backoffTicks * triangle;
        return total is < 0 or > MaxTicks ? TimeSpan.MaxValue : new TimeSpan(total);
    }

    /// <summary>Defaults matching the TypeScript scheduler: unbounded, 10k queue, 30s timeout.</summary>
    public static EventTaskSchedulerOptions Default => new(
        Name: "EventTaskScheduler",
        ConcurrencyLimit: UnboundedConcurrency,
        MaxQueueSize: 10_000,
        EnableMetrics: false,
        EnableRetries: false,
        MaxRetries: 3,
        RetryDelay: TimeSpan.FromMilliseconds(1000),
        RetryBackoff: BackoffDuration.Zero,
        TaskTimeout: TimeSpan.FromMilliseconds(30_000),
        GcInterval: TimeSpan.Zero);
}

/// <summary>Mutable accumulator for <see cref="EventTaskSchedulerOptionsBuilder"/>.</summary>
public struct EventTaskSchedulerOptionsState : IAggregateDefinition<EventTaskSchedulerOptionsState, EventTaskSchedulerOptions>,
    IEquatable<EventTaskSchedulerOptionsState>
{
    /// <summary>Working defaults matching <see cref="EventTaskSchedulerOptions.Default"/>.</summary>
    public static EventTaskSchedulerOptionsState Default => new()
    {
        Name = "EventTaskScheduler",
        ConcurrencyLimit = EventTaskSchedulerOptions.UnboundedConcurrency,
        MaxQueueSize = 10_000,
        EnableMetrics = false,
        EnableRetries = false,
        MaxRetries = 3,
        RetryDelay = TimeSpan.FromMilliseconds(1000),
        RetryBackoff = BackoffDuration.Zero,
        TaskTimeout = TimeSpan.FromMilliseconds(30_000),
        GcInterval = TimeSpan.Zero,
    };

    public string Name { get; set; }
    public int ConcurrencyLimit { get; set; }
    public int MaxQueueSize { get; set; }
    public bool EnableMetrics { get; set; }
    public bool EnableRetries { get; set; }
    public int MaxRetries { get; set; }
    public TimeSpan RetryDelay { get; set; }
    public BackoffDuration RetryBackoff { get; set; }
    public TimeSpan TaskTimeout { get; set; }
    public TimeSpan GcInterval { get; set; }

    /// <inheritdoc/>
    public static EventTaskSchedulerOptions Materialize(in EventTaskSchedulerOptionsState state) => new(
        state.Name,
        state.ConcurrencyLimit,
        state.MaxQueueSize,
        state.EnableMetrics,
        state.EnableRetries,
        state.MaxRetries,
        state.RetryDelay,
        state.RetryBackoff,
        state.TaskTimeout,
        state.GcInterval);

    /// <inheritdoc/>
    public static bool TryValidate(in EventTaskSchedulerOptionsState state, out BuilderDiagnostic diagnostic)
    {
        if (string.IsNullOrEmpty(state.Name))
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "Name must be non-empty.");
            return false;
        }

        if (state.ConcurrencyLimit < 1)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "ConcurrencyLimit must be positive.");
            return false;
        }

        if (state.MaxQueueSize < 1)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "MaxQueueSize must be positive.");
            return false;
        }

        if (state.MaxRetries < 0)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "MaxRetries must be non-negative.");
            return false;
        }

        if (state.RetryDelay < TimeSpan.Zero || state.RetryDelay > TimeSpan.MaxValue)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "RetryDelay must be non-negative.");
            return false;
        }

        if (state.RetryBackoff.Nanoseconds < 0)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "RetryBackoff must be non-negative.");
            return false;
        }

        if (EventTaskSchedulerOptions.RetryDelayFor(state.RetryDelay, state.RetryBackoff, state.MaxRetries) == TimeSpan.MaxValue &&
            (state.RetryDelay != TimeSpan.Zero || state.RetryBackoff != BackoffDuration.Zero))
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "Retry delay exceeds TimeSpan range.");
            return false;
        }

        if (state.TaskTimeout < TimeSpan.Zero)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "TaskTimeout must be non-negative.");
            return false;
        }

        if (state.GcInterval < TimeSpan.Zero)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "GcInterval must be non-negative.");
            return false;
        }

        diagnostic = BuilderDiagnostic.Ok;
        return true;
    }

    /// <inheritdoc/>
    public bool Equals(EventTaskSchedulerOptionsState other) =>
        Name == other.Name &&
        ConcurrencyLimit == other.ConcurrencyLimit &&
        MaxQueueSize == other.MaxQueueSize &&
        EnableMetrics == other.EnableMetrics &&
        EnableRetries == other.EnableRetries &&
        MaxRetries == other.MaxRetries &&
        RetryDelay == other.RetryDelay &&
        RetryBackoff == other.RetryBackoff &&
        TaskTimeout == other.TaskTimeout &&
        GcInterval == other.GcInterval;

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is EventTaskSchedulerOptionsState other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => HashCode.Combine(
        Name,
        HashCode.Combine(ConcurrencyLimit, MaxQueueSize, EnableMetrics, EnableRetries, MaxRetries),
        HashCode.Combine(RetryDelay, RetryBackoff, TaskTimeout, GcInterval));

    public static bool operator ==(EventTaskSchedulerOptionsState left, EventTaskSchedulerOptionsState right) => left.Equals(right);

    public static bool operator !=(EventTaskSchedulerOptionsState left, EventTaskSchedulerOptionsState right) => !left.Equals(right);
}

/// <summary>Fluent builder for <see cref="EventTaskSchedulerOptions"/>.</summary>
public sealed class EventTaskSchedulerOptionsBuilder
    : AggregateBuilder<EventTaskSchedulerOptionsBuilder, EventTaskSchedulerOptionsState, EventTaskSchedulerOptions>
{
    public EventTaskSchedulerOptionsBuilder()
    {
        State = EventTaskSchedulerOptionsState.Default;
    }

    protected override EventTaskSchedulerOptionsBuilder Self => this;

    protected override PropertyBitmask64 RequiredMask => PropertyBitmask64.None;

    /// <summary>Sets the scheduler name reported by stats.</summary>
    public EventTaskSchedulerOptionsBuilder WithName(string name)
    {
        State.Name = name;
        return this;
    }

    /// <summary>Sets the upper bound of concurrently running bodies; zero means unbounded.</summary>
    public EventTaskSchedulerOptionsBuilder WithConcurrencyLimit(int concurrencyLimit)
    {
        State.ConcurrencyLimit = concurrencyLimit == 0
            ? EventTaskSchedulerOptions.UnboundedConcurrency
            : concurrencyLimit;
        return this;
    }

    /// <summary>Sets the total lane capacity across all priorities.</summary>
    public EventTaskSchedulerOptionsBuilder WithMaxQueueSize(int maxQueueSize)
    {
        State.MaxQueueSize = maxQueueSize;
        return this;
    }

    /// <summary>Enables per-task metrics, throughput and memory estimation.</summary>
    public EventTaskSchedulerOptionsBuilder WithMetrics(bool enabled = true)
    {
        State.EnableMetrics = enabled;
        return this;
    }

    /// <summary>Enables the retry budget with the given attempt cap.</summary>
    public EventTaskSchedulerOptionsBuilder WithRetries(int maxRetries = 3)
    {
        State.EnableRetries = true;
        State.MaxRetries = maxRetries;
        return this;
    }

    /// <summary>Sets the base retry delay.</summary>
    public EventTaskSchedulerOptionsBuilder WithRetryDelay(TimeSpan delay)
    {
        State.RetryDelay = delay;
        return this;
    }

    /// <summary>Sets additive backoff applied per consumed retry.</summary>
    public EventTaskSchedulerOptionsBuilder WithRetryBackoff(BackoffDuration backoff)
    {
        State.RetryBackoff = backoff;
        return this;
    }

    /// <summary>Sets the default per-task deadline; zero disables deadlines.</summary>
    public EventTaskSchedulerOptionsBuilder WithTaskTimeout(TimeSpan timeout)
    {
        State.TaskTimeout = timeout;
        return this;
    }

    /// <summary>Sets the stale-metrics prune period; zero disables the timer.</summary>
    public EventTaskSchedulerOptionsBuilder WithGcInterval(TimeSpan interval)
    {
        State.GcInterval = interval;
        return this;
    }

    /// <inheritdoc/>
    public override void Reset() => State = EventTaskSchedulerOptionsState.Default;

    /// <inheritdoc/>
    public override EventTaskSchedulerOptionsBuilder Fork() => CopyTo(new EventTaskSchedulerOptionsBuilder());
}
