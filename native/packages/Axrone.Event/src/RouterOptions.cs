namespace Axrone.Event;

/// <summary>
/// Immutable router configuration: transport capacity, dispatch batching, and dead-letter bound.
/// </summary>
/// <param name="Capacity">Ring slots per event type; must be a power of two.</param>
/// <param name="DispatchBatchSize">Envelopes per dispatch iteration; 1..4096.</param>
/// <param name="DeadLetterCapacity">Retained failures; oldest drop first when full.</param>
/// <param name="MeterName">OpenTelemetry meter name.</param>
public readonly record struct RouterOptions(int Capacity, int DispatchBatchSize, int DeadLetterCapacity, string MeterName)
{
    /// <summary>
    /// Subscription bound per router; zero disables the bound. Defaults to 10, matching the
    /// TypeScript contract, so the leak detector is armed unless explicitly disabled.
    /// </summary>
    public int MaxListeners { get; init; } = 10;

    /// <summary>Reaction when <see cref="MaxListeners"/> is exceeded.</summary>
    public MaxListenersPolicy MaxListenersPolicy { get; init; } = MaxListenersPolicy.Warn;

    /// <summary>Slots in the pause buffer; allocated on first pause.</summary>
    public int PausedBufferCapacity { get; init; } = 1024;

    /// <summary>
    /// Upper bound a publisher waits for transport space, in milliseconds; zero waits
    /// indefinitely. Re-entrant publishes from a dispatch handler never wait: they fail fast,
    /// because the only thread that could free a slot is the one currently blocked in that
    /// handler.
    /// </summary>
    public int MaxQueueWaitMs { get; init; } = 2000;

    /// <summary>
    /// Maximum consecutive self-publishes from a dispatch handler before the re-entrant guard
    /// fails the chain. Bounds feedback loops that would otherwise burn CPU invisibly.
    /// </summary>
    public int MaxReentrantDepth { get; init; } = 32;

    /// <summary>House tuning: 64k ring, 256-wide dispatch batches, 1k dead letters.</summary>
    public static RouterOptions Default => new(65536, 256, 1024, "Axrone.Event");
}
