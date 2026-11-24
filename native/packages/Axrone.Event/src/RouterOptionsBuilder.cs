namespace Axrone.Event;

using Axrone.Utility.Builders;

/// <summary>
/// Fluent builder for <see cref="RouterOptions"/> over a mutable accumulator state.
/// </summary>
public sealed class RouterOptionsBuilder
    : AggregateBuilder<RouterOptionsBuilder, RouterOptionsState, RouterOptions>
{
    public RouterOptionsBuilder()
    {
        State = RouterOptionsState.Default;
    }

    protected override RouterOptionsBuilder Self => this;

    protected override PropertyBitmask64 RequiredMask => PropertyBitmask64.None;

    /// <summary>Sets ring slots per event type; must be a power of two.</summary>
    public RouterOptionsBuilder WithCapacity(int capacity)
    {
        State.Capacity = capacity;
        return this;
    }

    /// <summary>Sets envelopes per dispatch iteration; 1..4096.</summary>
    public RouterOptionsBuilder WithDispatchBatchSize(int batchSize)
    {
        State.DispatchBatchSize = batchSize;
        return this;
    }

    /// <summary>Sets retained failures; oldest drop first when full; 1..1048576.</summary>
    public RouterOptionsBuilder WithDeadLetterCapacity(int capacity)
    {
        State.DeadLetterCapacity = capacity;
        return this;
    }

    /// <summary>Sets the telemetry meter name.</summary>
    public RouterOptionsBuilder WithTelemetry(string meterName)
    {
        State.MeterName = meterName;
        return this;
    }

    /// <summary>Sets the subscription bound per router; zero disables the bound.</summary>
    public RouterOptionsBuilder WithMaxListeners(int maxListeners)
    {
        State.MaxListeners = maxListeners;
        return this;
    }

    /// <summary>Sets the reaction when the subscription bound is exceeded.</summary>
    public RouterOptionsBuilder WithMaxListenersPolicy(MaxListenersPolicy policy)
    {
        State.MaxListenersPolicy = policy;
        return this;
    }

    /// <summary>Sets the pause-buffer slot count.</summary>
    public RouterOptionsBuilder WithPausedBufferCapacity(int capacity)
    {
        State.PausedBufferCapacity = capacity;
        return this;
    }

    /// <summary>Sets how long a publisher waits for transport space; zero waits indefinitely.</summary>
    public RouterOptionsBuilder WithMaxQueueWaitMs(int maxQueueWaitMs)
    {
        State.MaxQueueWaitMs = maxQueueWaitMs;
        return this;
    }

    /// <inheritdoc/>
    public override void Reset() => State = RouterOptionsState.Default;

    /// <inheritdoc/>
    public override RouterOptionsBuilder Fork() => CopyTo(new RouterOptionsBuilder());
}
