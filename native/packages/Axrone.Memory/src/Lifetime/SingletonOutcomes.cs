namespace Axrone.Memory.Lifetime;

/// <summary>
/// Describes the outcome of an attempt to acquire a lease on a singleton engine.
/// </summary>
public enum LeaseAcquisitionStatus : byte
{
    /// <summary>A lease was successfully acquired.</summary>
    Success = 0,

    /// <summary>The engine has not been initialized and no instance exists yet.</summary>
    NotInitialized = 1,

    /// <summary>The engine previously faulted and can no longer serve leases.</summary>
    Faulted = 2,

    /// <summary>The engine has been disposed.</summary>
    Disposed = 3,

    /// <summary>The engine is completing or draining and no longer accepts new leases.</summary>
    Complete = 4,

    /// <summary>The engine is draining held leases and no longer accepts new leases.</summary>
    Draining = 5
}

/// <summary>
/// The result of a lease acquisition attempt, carrying either the acquired lease
/// or the status describing why acquisition failed.
/// </summary>
/// <typeparam name="TLease">The concrete lease type produced by the engine.</typeparam>
/// <param name="Status">The outcome status of the acquisition attempt.</param>
/// <param name="Lease">The acquired lease when <see cref="Status"/> is <see cref="LeaseAcquisitionStatus.Success"/>; otherwise default.</param>
[StructLayout(LayoutKind.Sequential)]
public readonly record struct LeaseAcquisitionResult<TLease>(LeaseAcquisitionStatus Status, TLease Lease)
    where TLease : struct
{
    /// <summary>Determines whether the acquisition produced a usable lease.</summary>
    public bool HasLease => Status == LeaseAcquisitionStatus.Success;

    /// <summary>Gets the acquired lease, or throws when the acquisition failed.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public TLease LeaseOrThrow()
    {
        if (HasLease)
        {
            return Lease;
        }

        return SingletonThrowHelper.ThrowLeaseAcquisitionFailed<TLease>(Status);
    }

    /// <summary>
    /// Invokes the success callback when a lease was acquired, otherwise invokes the
    /// failure callback with the acquisition status.
    /// </summary>
    /// <param name="onSuccess">Callback invoked with the acquired lease on success.</param>
    /// <param name="onFailure">Callback invoked with the acquisition status on failure.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Switch(Action<TLease> onSuccess, Action<LeaseAcquisitionStatus> onFailure)
    {
        if (HasLease)
        {
            onSuccess(Lease);
        }
        else
        {
            onFailure(Status);
        }
    }

    /// <summary>
    /// Invokes the success callback when a lease was acquired, otherwise invokes the
    /// failure callback with the acquisition status, returning the selected value.
    /// </summary>
    /// <typeparam name="TResult">The type of value produced by the callbacks.</typeparam>
    /// <param name="onSuccess">Callback invoked with the acquired lease on success.</param>
    /// <param name="onFailure">Callback invoked with the acquisition status on failure.</param>
    /// <returns>The value produced by the selected callback.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public TResult Switch<TResult>(Func<TLease, TResult> onSuccess, Func<LeaseAcquisitionStatus, TResult> onFailure)
    {
        return HasLease ? onSuccess(Lease) : onFailure(Status);
    }
}

/// <summary>
/// Describes the outcome of a drain attempt on a singleton engine.
/// </summary>
public enum DrainStatus : byte
{
    /// <summary>The drain completed and the instance was torn down.</summary>
    Completed = 0,

    /// <summary>The drain timed out while leases were still held.</summary>
    TimedOut = 1,

    /// <summary>The engine was not in a drainable phase when the drain was requested.</summary>
    NotApplicable = 2,

    /// <summary>The engine had already been disposed.</summary>
    Disposed = 3,

    /// <summary>The engine was faulted and cannot be drained into service.</summary>
    Faulted = 4
}

/// <summary>
/// The result of a drain attempt, describing the final status, the number of leases
/// that remained when the attempt ended, and the time the attempt consumed.
/// </summary>
/// <param name="Status">The outcome status of the drain attempt.</param>
/// <param name="RemainingLeases">The number of leases still held when the attempt ended.</param>
/// <param name="Elapsed">The time consumed by the drain attempt.</param>
[StructLayout(LayoutKind.Sequential)]
public readonly record struct DrainResult(DrainStatus Status, LeaseCount RemainingLeases, TimeSpan Elapsed)
{
    /// <summary>Determines whether the drain completed successfully.</summary>
    public bool IsCompleted => Status == DrainStatus.Completed;
}
