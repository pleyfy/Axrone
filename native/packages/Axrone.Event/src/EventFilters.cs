namespace Axrone.Event;

/// <summary>
/// Payload-gate factories for <see cref="EventRouter{TEvent}.AddFilter"/>. Event sets are types
/// in C#, so include/exclude narrows payloads instead of event names.
/// </summary>
public static class EventFilters
{
    /// <summary>Accepts envelopes whose payload satisfies the predicate.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="predicate">Inclusion predicate.</param>
    public static IEventFilter<TEvent> Include<TEvent>(Func<TEvent, bool> predicate)
    {
        ArgumentNullException.ThrowIfNull(predicate);
        return new PredicateFilter<TEvent>(predicate, invert: false);
    }

    /// <summary>Rejects envelopes whose payload satisfies the predicate.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="predicate">Exclusion predicate.</param>
    public static IEventFilter<TEvent> Exclude<TEvent>(Func<TEvent, bool> predicate)
    {
        ArgumentNullException.ThrowIfNull(predicate);
        return new PredicateFilter<TEvent>(predicate, invert: true);
    }

    private sealed class PredicateFilter<TEvent>(Func<TEvent, bool> predicate, bool invert) : IEventFilter<TEvent>
    {
        public bool ShouldProcess(in EventEnvelope<TEvent> envelope) => predicate(envelope.Payload) != invert;
    }
}
