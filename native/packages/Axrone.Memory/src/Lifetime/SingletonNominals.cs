namespace Axrone.Memory.Lifetime;

/// <summary>
/// Strongly-typed count of leases currently held against a singleton instance.
/// Nominal typing prevents raw integers from being passed where a lease count is required.
/// </summary>
/// <param name="Value">The number of currently held leases.</param>
[StructLayout(LayoutKind.Sequential)]
public readonly record struct LeaseCount(int Value)
{
    /// <summary>Gets the zero lease count.</summary>
    public static LeaseCount Zero => new(0);

    /// <summary>Converts a lease count to its underlying integer value.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator int(LeaseCount count) => count.Value;

    /// <summary>Creates a lease count from a raw integer value.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator LeaseCount(int value) => new(value);

    /// <summary>Adds two lease counts together.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static LeaseCount operator +(LeaseCount left, LeaseCount right) => new(left.Value + right.Value);

    /// <summary>Subtracts one lease count from another.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static LeaseCount operator -(LeaseCount left, LeaseCount right) => new(left.Value - right.Value);

    /// <summary>Increments a lease count by one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static LeaseCount operator ++(LeaseCount count) => new(count.Value + 1);

    /// <summary>Decrements a lease count by one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static LeaseCount operator --(LeaseCount count) => new(count.Value - 1);

    /// <summary>Determines whether one lease count is greater than another.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(LeaseCount left, LeaseCount right) => left.Value > right.Value;

    /// <summary>Determines whether one lease count is less than another.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(LeaseCount left, LeaseCount right) => left.Value < right.Value;

    /// <summary>Determines whether one lease count is greater than or equal to another.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(LeaseCount left, LeaseCount right) => left.Value >= right.Value;

    /// <summary>Determines whether one lease count is less than or equal to another.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(LeaseCount left, LeaseCount right) => left.Value <= right.Value;

    /// <summary>Returns a string representation of the lease count.</summary>
    public override string ToString() => Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
}

/// <summary>
/// Strongly-typed monotonic timestamp captured from <see cref="Stopwatch"/> at the moment
/// a lifecycle transition occurred. Nominal typing keeps lifecycle timestamps distinct
/// from raw tick values.
/// </summary>
/// <param name="Ticks">The timestamp value from <see cref="Stopwatch.GetTimestamp"/>.</param>
[StructLayout(LayoutKind.Sequential)]
public readonly record struct EpochTimestamp(long Ticks)
{
    /// <summary>Captures the current monotonic timestamp.</summary>
    public static EpochTimestamp Now => new(Stopwatch.GetTimestamp());

    /// <summary>Computes the elapsed time between two timestamps.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static TimeSpan operator -(EpochTimestamp later, EpochTimestamp earlier) =>
        Stopwatch.GetElapsedTime(earlier.Ticks, later.Ticks);

    /// <summary>Converts the timestamp to its underlying tick value.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator long(EpochTimestamp timestamp) => timestamp.Ticks;

    /// <summary>Returns a string representation of the timestamp.</summary>
    public override string ToString() => Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture);
}

/// <summary>
/// Strongly-typed monotonic iteration counter. Each lease acquisition, release, or lifecycle
/// transition advances the iteration so that observers can order events without relying on
/// wall-clock timing.
/// </summary>
/// <param name="Value">The current iteration value.</param>
[StructLayout(LayoutKind.Sequential)]
public readonly record struct Iteration(long Value)
{
    /// <summary>Gets the initial iteration value.</summary>
    public static Iteration Initial => new(0);

    /// <summary>Advances the iteration by one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Iteration operator ++(Iteration iteration) => new(iteration.Value + 1);

    /// <summary>Converts the iteration to its underlying integer value.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static implicit operator long(Iteration iteration) => iteration.Value;

    /// <summary>Returns a string representation of the iteration.</summary>
    public override string ToString() => Value.ToString(System.Globalization.CultureInfo.InvariantCulture);
}

/// <summary>
/// Describes the lifecycle phase of a singleton engine.
/// </summary>
public enum LifecycleStatus : byte
{
    /// <summary>The engine has been created but no instance has been produced yet.</summary>
    Uninitialized = 0,

    /// <summary>The factory is currently producing the instance.</summary>
    Initializing = 1,

    /// <summary>The instance is published and leases can be acquired.</summary>
    Initialized = 2,

    /// <summary>The engine has stopped accepting new leases and is waiting for held leases to release.</summary>
    Complete = 3,

    /// <summary>The factory failed; the engine is permanently faulted.</summary>
    Faulted = 4,

    /// <summary>The engine is draining held leases before teardown.</summary>
    Draining = 5,

    /// <summary>All leases released and the instance was torn down.</summary>
    Drained = 6,

    /// <summary>The engine has been disposed.</summary>
    Disposed = 7
}

/// <summary>
/// Immutable snapshot of the lifecycle status together with the timestamp and iteration
/// at which the observed status was current.
/// </summary>
/// <param name="Status">The observed lifecycle status.</param>
/// <param name="Timestamp">The monotonic timestamp of the observation.</param>
/// <param name="Iteration">The monotonic iteration of the observation.</param>
[StructLayout(LayoutKind.Sequential)]
public readonly record struct LifecycleState(LifecycleStatus Status, EpochTimestamp Timestamp, Iteration Iteration)
{
    /// <summary>Determines whether the state represents a status that can serve instances.</summary>
    public bool IsServeable => Status is LifecycleStatus.Initialized or LifecycleStatus.Complete;
}

/// <summary>
/// Strongly-typed name identifying a singleton registration. Used for diagnostics and
/// metric correlation so that log output can distinguish between registrations of the
/// same instance type.
/// </summary>
/// <param name="Value">The registration name; may be empty when unspecified.</param>
[StructLayout(LayoutKind.Sequential)]
public readonly record struct InstanceName(string Value)
{
    /// <summary>Gets the default (empty) instance name.</summary>
    public static InstanceName Empty => new(string.Empty);

    /// <summary>Determines whether the name is unspecified (null or empty).</summary>
    public bool IsEmpty => string.IsNullOrEmpty(Value);

    /// <summary>Returns the underlying name string.</summary>
    public override string ToString() => Value;
}

/// <summary>
/// Immutable metadata snapshot describing a singleton engine's registration, lifecycle
/// status, active lease count, and metric volume at the time of the observation.
/// </summary>
/// <param name="Name">The registration name of the engine.</param>
/// <param name="Status">The lifecycle status at the time of the observation.</param>
/// <param name="ActiveLeases">The number of leases currently held.</param>
/// <param name="CreatedAt">The monotonic timestamp at which the instance was published.</param>
/// <param name="Iteration">The monotonic iteration at the time of the observation.</param>
/// <param name="MetricCount">The number of metric records currently retained.</param>
[StructLayout(LayoutKind.Sequential)]
public readonly record struct SingletonMetadata(
    InstanceName Name,
    LifecycleStatus Status,
    LeaseCount ActiveLeases,
    EpochTimestamp CreatedAt,
    Iteration Iteration,
    int MetricCount)
{
    /// <summary>Determines whether the engine can currently serve instances.</summary>
    public bool IsServeable => Status is LifecycleStatus.Initialized or LifecycleStatus.Complete;
}
