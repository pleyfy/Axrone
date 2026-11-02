namespace Axrone.Batching;

/// <summary>
/// Outcome of a single time-sliced batch execution pass.
/// </summary>
/// <remarks>
/// <see cref="Empty"/> is deliberately zero so that a default-initialised
/// <see cref="SliceResult"/> reads as "nothing happened". Making success the zero value would let
/// an accidental <c>default(SliceResult)</c> return masquerade as a completed batch.
/// </remarks>
public enum FrameBudgetStatus
{
    /// <summary>No work was available to process.</summary>
    Empty = 0,

    /// <summary>The batch was fully processed within the budget.</summary>
    Completed = 1,

    /// <summary>Work remained when the budget ran out; resume from where this pass stopped.</summary>
    BudgetExceeded = 2,
}

/// <summary>
/// A wall-clock deadline for one slice of work, measured against <see cref="Stopwatch.Frequency"/>.
/// </summary>
/// <remarks>
/// <para>
/// Constructing a budget starts the clock. Because the deadline is captured as two ticks values, a
/// budget is a value type that can be passed by value into a slice loop without aliasing.
/// </para>
/// <para>
/// <see cref="IsExpired"/> and the millisecond properties each read the clock. In a hot chunk loop
/// that is one <see cref="Stopwatch.GetTimestamp"/> call per check; use the <c>*At</c> overloads to
/// reuse a timestamp the loop already took.
/// </para>
/// </remarks>
public readonly struct FrameBudget
{
    /// <summary>Deadline used by <see cref="Infinite"/>, chosen so no realistic timestamp reaches it.</summary>
    private const long NeverDeadline = long.MaxValue;

    /// <summary>Ticks at which this budget started.</summary>
    public long StartTicks { get; }

    /// <summary>Ticks at which this budget expires.</summary>
    public long DeadlineTicks { get; }

    /// <summary>A budget that never expires, for runs that should not slice.</summary>
    public static FrameBudget Infinite => new(Stopwatch.GetTimestamp(), NeverDeadline);

    /// <summary>
    /// Creates a budget from explicit timestamp ticks. Used by deterministic tests that drive the
    /// pipeline through an injected timestamp source.
    /// </summary>
    internal FrameBudget(long startTicks, long deadlineTicks)
    {
        StartTicks = startTicks;
        DeadlineTicks = deadlineTicks;
    }

    /// <summary>Starts a budget of <paramref name="budget"/> from now.</summary>
    /// <param name="budget">How long the slice may run. Zero is legal and expires immediately.</param>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="budget"/> is negative.</exception>
    public FrameBudget(TimeSpan budget)
    {
        if (budget < TimeSpan.Zero)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(budget));
        }

        StartTicks = Stopwatch.GetTimestamp();
        DeadlineTicks = StartTicks + (long)(budget.TotalSeconds * Stopwatch.Frequency);
    }

    /// <summary>Starts a budget of <paramref name="milliseconds"/> from now.</summary>
    /// <param name="milliseconds">How long the slice may run. Zero is legal and expires immediately.</param>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="milliseconds"/> is negative.</exception>
    public FrameBudget(double milliseconds)
    {
        if (milliseconds < 0d)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(milliseconds));
        }

        StartTicks = Stopwatch.GetTimestamp();
        DeadlineTicks = StartTicks + (long)(milliseconds * (Stopwatch.Frequency / 1000d));
    }

    /// <summary>Whether the budget has run out as of now.</summary>
    public bool IsExpired
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => IsExpiredAt(Stopwatch.GetTimestamp());
    }

    /// <summary>Whether the budget had run out as of <paramref name="timestamp"/>.</summary>
    /// <param name="timestamp">A value previously returned by <see cref="Stopwatch.GetTimestamp"/>.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsExpiredAt(long timestamp) => timestamp >= DeadlineTicks;

    /// <summary>Ticks left before expiry as of now, clamped at zero.</summary>
    public long RemainingTicks
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => RemainingTicksAt(Stopwatch.GetTimestamp());
    }

    /// <summary>Ticks left before expiry as of <paramref name="timestamp"/>, clamped at zero.</summary>
    /// <param name="timestamp">A value previously returned by <see cref="Stopwatch.GetTimestamp"/>.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public long RemainingTicksAt(long timestamp)
    {
        var remaining = DeadlineTicks - timestamp;
        return remaining > 0 ? remaining : 0;
    }

    /// <summary>Milliseconds elapsed since the budget started.</summary>
    public double ElapsedMilliseconds
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => ElapsedMillisecondsAt(Stopwatch.GetTimestamp());
    }

    /// <summary>Milliseconds elapsed since the budget started, as of <paramref name="timestamp"/>.</summary>
    /// <param name="timestamp">A value previously returned by <see cref="Stopwatch.GetTimestamp"/>.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public double ElapsedMillisecondsAt(long timestamp) =>
        (timestamp - StartTicks) * 1000d / Stopwatch.Frequency;

    /// <summary>Milliseconds until expiry, clamped at zero.</summary>
    public double RemainingMilliseconds
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => RemainingTicksAt(Stopwatch.GetTimestamp()) * 1000d / Stopwatch.Frequency;
    }
}

/// <summary>
/// Result of one time-sliced execution pass over a batch.
/// </summary>
public readonly struct SliceResult
{
    /// <summary>How the pass ended.</summary>
    public FrameBudgetStatus Status { get; }

    /// <summary>Elements processed by this pass.</summary>
    public int ProcessedCount { get; }

    /// <summary>Elements left unprocessed; zero unless <see cref="Status"/> is <see cref="FrameBudgetStatus.BudgetExceeded"/>.</summary>
    public int RemainingCount { get; }

    /// <summary>Wall-clock milliseconds the pass spent.</summary>
    public double ElapsedMilliseconds { get; }

    private SliceResult(FrameBudgetStatus status, int processedCount, int remainingCount, double elapsedMilliseconds)
    {
        Status = status;
        ProcessedCount = processedCount;
        RemainingCount = remainingCount;
        ElapsedMilliseconds = elapsedMilliseconds;
    }

    /// <summary>Creates a result reporting that no work was available.</summary>
    /// <param name="elapsedMilliseconds">Time the caller spent discovering there was nothing to do.</param>
    public static SliceResult Empty(double elapsedMilliseconds) =>
        new(FrameBudgetStatus.Empty, 0, 0, elapsedMilliseconds);

    /// <summary>Creates a result reporting that the whole batch was consumed.</summary>
    /// <param name="processedCount">Elements processed.</param>
    /// <param name="elapsedMilliseconds">Time the pass spent.</param>
    public static SliceResult Completed(int processedCount, double elapsedMilliseconds) =>
        new(FrameBudgetStatus.Completed, processedCount, 0, elapsedMilliseconds);

    /// <summary>Creates a result reporting that the budget ran out mid-batch.</summary>
    /// <param name="processedCount">Elements processed before the deadline.</param>
    /// <param name="remainingCount">Elements left for the next pass.</param>
    /// <param name="elapsedMilliseconds">Time the pass spent.</param>
    public static SliceResult BudgetExceeded(int processedCount, int remainingCount, double elapsedMilliseconds) =>
        new(FrameBudgetStatus.BudgetExceeded, processedCount, remainingCount, elapsedMilliseconds);
}
