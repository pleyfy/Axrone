namespace Axrone.Event;

/// <summary>Payload wrapper that partitions a payload type by a compile-time namespace marker.</summary>
/// <typeparam name="TNamespace">Namespace marker type; distinct markers route independently.</typeparam>
/// <typeparam name="TEvent">Payload type.</typeparam>
public readonly record struct NamespacedEvent<TNamespace, TEvent>(TEvent Payload);

/// <summary>
/// Typed namespace view over a bus. Distinct marker types create distinct routers, so two
/// subsystems can publish the same payload type without observing each other; the marker type is
/// the compile-time analogue of an event-name prefix.
/// </summary>
/// <typeparam name="TNamespace">Namespace marker type.</typeparam>
public sealed class EventNamespace<TNamespace>
{
    private readonly EventBus _bus;

    /// <summary>Creates a namespace view over the bus.</summary>
    /// <param name="bus">Owning bus; the view does not own or dispose it.</param>
    public EventNamespace(EventBus bus)
    {
        ArgumentNullException.ThrowIfNull(bus);
        _bus = bus;
    }

    /// <summary>Owning bus.</summary>
    public EventBus Bus => _bus;

    /// <summary>Router that carries this namespace's payloads.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    public EventRouter<NamespacedEvent<TNamespace, TEvent>> Router<TEvent>() =>
        _bus.Router<NamespacedEvent<TNamespace, TEvent>>();

    /// <summary>Publishes a payload inside the namespace.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="message">Payload to publish.</param>
    public void Publish<TEvent>(in TEvent message) =>
        _bus.Router<NamespacedEvent<TNamespace, TEvent>>().Publish(new NamespacedEvent<TNamespace, TEvent>(message));

    /// <summary>Non-blocking namespace publish.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="message">Payload to publish.</param>
    public bool TryPublish<TEvent>(in TEvent message) =>
        _bus.Router<NamespacedEvent<TNamespace, TEvent>>().TryPublish(new NamespacedEvent<TNamespace, TEvent>(message));

    /// <summary>Immediate namespace dispatch on the caller thread.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="message">Payload to dispatch.</param>
    public int PublishImmediate<TEvent>(in TEvent message) =>
        _bus.Router<NamespacedEvent<TNamespace, TEvent>>().PublishImmediate(new NamespacedEvent<TNamespace, TEvent>(message));

    /// <summary>Subscribes to namespace payloads with the wrapper stripped.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="handler">Handler receiving the original payload.</param>
    /// <param name="priority">Dispatch priority.</param>
    public IEventSubscription Subscribe<TEvent>(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority = EventPriority.Normal)
    {
        ArgumentNullException.ThrowIfNull(handler);
        return _bus.Router<NamespacedEvent<TNamespace, TEvent>>().Subscribe(
            (envelope, token) => handler(Unwrap<TEvent>(in envelope), token),
            priority);
    }

    /// <summary>Subscribes once to namespace payloads with the wrapper stripped.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="handler">Handler receiving the original payload.</param>
    /// <param name="priority">Dispatch priority.</param>
    public IEventSubscription SubscribeOnce<TEvent>(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority = EventPriority.Normal)
    {
        ArgumentNullException.ThrowIfNull(handler);
        return _bus.Router<NamespacedEvent<TNamespace, TEvent>>().SubscribeOnce(
            (envelope, token) => handler(Unwrap<TEvent>(in envelope), token),
            priority);
    }

    private static EventEnvelope<TEvent> Unwrap<TEvent>(in EventEnvelope<NamespacedEvent<TNamespace, TEvent>> envelope) =>
        new(envelope.Metadata, envelope.Payload.Payload);
}
