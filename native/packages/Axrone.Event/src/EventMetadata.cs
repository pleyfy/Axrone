namespace Axrone.Event;

/// <summary>
/// Identity and tracing stamp carried by every envelope.
/// </summary>
/// <remarks>
/// The bus stamps <see cref="EventId"/> and <see cref="Sequence"/> at the publish edge; a
/// default-constructed value is explicitly <em>unstamped</em> (empty IDs, zero sequence) and must
/// never be dispatched as-is. No GUID is generated on the write path — generation happens once
/// per publish, not once per item. <see cref="Timestamp"/> carries raw
/// <see cref="Stopwatch"/> ticks; zero means unstamped.
/// </remarks>
public readonly record struct EventMetadata(
    Guid EventId,
    Guid CorrelationId,
    Guid CausationId,
    long Sequence,
    int Version,
    int Flags,
    long Timestamp)
{
    /// <summary>Whether the bus stamped identity onto this metadata.</summary>
    public bool IsStamped => EventId != Guid.Empty;

    /// <summary>Number of forwarding hops already applied to this envelope.</summary>
    public int ForwardCount { get; init; }

    /// <summary>Returns a copy with the sequence assigned.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public EventMetadata WithSequence(long sequence) => this with { Sequence = sequence };

    /// <summary>Returns a copy with identity assigned.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public EventMetadata WithIdentity(Guid eventId, Guid correlationId) =>
        this with { EventId = eventId, CorrelationId = correlationId };

    /// <summary>Returns a copy marked as forwarded once more.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public EventMetadata WithForwarded() => this with { ForwardCount = ForwardCount + 1 };
}
