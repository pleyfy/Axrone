namespace Axrone.Event;

/// <summary>
/// Non-generic emitter surface shared by every router instance. Enables discovery and uniform
/// introspection across event types without reflection.
/// </summary>
public interface IEventEmitter
{
    /// <summary>Event type routed by the emitter.</summary>
    Type EventType { get; }

    /// <summary>Registered subscriptions.</summary>
    int SubscriberCount { get; }

    /// <summary>Whether publishes are buffered instead of dispatched.</summary>
    bool IsPaused { get; }

    /// <summary>Subscription bound; zero means unlimited.</summary>
    int MaxListeners { get; }

    /// <summary>Registrations that exceeded the subscription bound.</summary>
    long MaxListenersExceededCount { get; }
}

/// <summary>Typed emitter factory and emitter probing.</summary>
public static class EventEmitters
{
    /// <summary>Creates a standalone emitter for the event type.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="capacity">Ring capacity; must be a power of two.</param>
    public static EventRouter<TEvent> Create<TEvent>(int capacity = 65536) => new(capacity);

    /// <summary>Creates a standalone emitter for the event type from options.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="options">Router options.</param>
    public static EventRouter<TEvent> Create<TEvent>(RouterOptions options) => new(options);

    /// <summary>Whether the value exposes the emitter surface. The typed analogue of a duck-type check.</summary>
    /// <param name="value">Candidate value.</param>
    public static bool IsEmitter(object? value) => value is IEventEmitter;
}
