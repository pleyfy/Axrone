namespace Axrone.Event;

using Axrone.Utility.Builders;

/// <summary>
/// Mutable accumulator for <see cref="RouterOptionsBuilder"/>; materializes <see cref="RouterOptions"/>.
/// </summary>
/// <remarks>
/// All fields carry working defaults, so the required mask is empty and
/// <see cref="TryValidate"/> is the authoritative gate.
/// </remarks>
public struct RouterOptionsState : IAggregateDefinition<RouterOptionsState, RouterOptions>,
    IEquatable<RouterOptionsState>
{
    /// <summary>Working defaults matching <see cref="RouterOptions.Default"/>.</summary>
    public static RouterOptionsState Default => new()
    {
        Capacity = 65536,
        DispatchBatchSize = 256,
        DeadLetterCapacity = 1024,
        MeterName = "Axrone.Event",
        MaxListeners = 10,
        MaxListenersPolicy = MaxListenersPolicy.Warn,
        PausedBufferCapacity = 1024,
        MaxQueueWaitMs = 2000,
    };

    public int Capacity { get; set; }
    public int DispatchBatchSize { get; set; }
    public int DeadLetterCapacity { get; set; }
    public string MeterName { get; set; }
    public int MaxListeners { get; set; }
    public MaxListenersPolicy MaxListenersPolicy { get; set; }
    public int PausedBufferCapacity { get; set; }
    public int MaxQueueWaitMs { get; set; }

    /// <inheritdoc/>
    public static RouterOptions Materialize(in RouterOptionsState state) =>
        new(state.Capacity, state.DispatchBatchSize, state.DeadLetterCapacity, state.MeterName)
        {
            MaxListeners = state.MaxListeners,
            MaxListenersPolicy = state.MaxListenersPolicy,
            PausedBufferCapacity = state.PausedBufferCapacity,
            MaxQueueWaitMs = state.MaxQueueWaitMs,
        };

    /// <inheritdoc/>
    public static bool TryValidate(in RouterOptionsState state, out BuilderDiagnostic diagnostic)
    {
        if (state.Capacity < 2 || !uint.IsPow2((uint)state.Capacity))
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "Capacity must be a power of two >= 2.");
            return false;
        }

        if (state.DispatchBatchSize is < 1 or > 4096)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "DispatchBatchSize must be between 1 and 4096.");
            return false;
        }

        if (state.DeadLetterCapacity is < 1 or > 1048576)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "DeadLetterCapacity must be between 1 and 1048576.");
            return false;
        }

        if (string.IsNullOrEmpty(state.MeterName))
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "MeterName must be non-empty.");
            return false;
        }

        if (state.MaxListeners < 0)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "MaxListeners must be non-negative.");
            return false;
        }

        if ((uint)state.MaxListenersPolicy > (uint)MaxListenersPolicy.Throw)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "MaxListenersPolicy must be Warn or Throw.");
            return false;
        }

        if (state.PausedBufferCapacity is < 1 or > 1048576)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "PausedBufferCapacity must be between 1 and 1048576.");
            return false;
        }

        if (state.MaxQueueWaitMs < 0)
        {
            diagnostic = BuilderDiagnostic.Fail(BuilderStatusCode.ValidationFailed, "MaxQueueWaitMs must be non-negative.");
            return false;
        }

        diagnostic = BuilderDiagnostic.Ok;
        return true;
    }

    /// <inheritdoc/>
    public bool Equals(RouterOptionsState other) =>
        Capacity == other.Capacity &&
        DispatchBatchSize == other.DispatchBatchSize &&
        DeadLetterCapacity == other.DeadLetterCapacity &&
        MeterName == other.MeterName &&
        MaxListeners == other.MaxListeners &&
        MaxListenersPolicy == other.MaxListenersPolicy &&
        PausedBufferCapacity == other.PausedBufferCapacity &&
        MaxQueueWaitMs == other.MaxQueueWaitMs;

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is RouterOptionsState other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => HashCode.Combine(
        Capacity,
        DispatchBatchSize,
        DeadLetterCapacity,
        MeterName,
        HashCode.Combine(MaxListeners, MaxListenersPolicy, PausedBufferCapacity, MaxQueueWaitMs));

    public static bool operator ==(RouterOptionsState left, RouterOptionsState right) => left.Equals(right);

    public static bool operator !=(RouterOptionsState left, RouterOptionsState right) => !left.Equals(right);
}
