namespace Axrone.Event;

/// <summary>
/// Named convenience surface over one router: on/once/off/emit/emitSync naming with no allocation
/// and no hidden state.
/// </summary>
/// <typeparam name="TEvent">Payload type.</typeparam>
public readonly struct EventHooks<TEvent>
{
    private readonly EventRouter<TEvent> _router;

    /// <summary>Wraps an existing router.</summary>
    /// <param name="router">Router to expose.</param>
    public EventHooks(EventRouter<TEvent> router)
    {
        ArgumentNullException.ThrowIfNull(router);
        _router = router;
    }

    /// <summary>Subscribes a handler.</summary>
    /// <param name="handler">Handler to invoke.</param>
    /// <param name="priority">Dispatch priority.</param>
    public IEventSubscription On(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority = EventPriority.Normal) =>
        _router.Subscribe(handler, priority);

    /// <summary>Subscribes a handler for one delivery.</summary>
    /// <param name="handler">Handler to invoke once.</param>
    /// <param name="priority">Dispatch priority.</param>
    public IEventSubscription Once(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority = EventPriority.Normal) =>
        _router.SubscribeOnce(handler, priority);

    /// <summary>Releases a subscription by identity.</summary>
    /// <param name="subscriptionId">Identity to release.</param>
    public bool Off(Guid subscriptionId) => _router.Unsubscribe(subscriptionId);

    /// <summary>Publishes through the transport.</summary>
    /// <param name="message">Payload to publish.</param>
    public void Emit(in TEvent message) => _router.Publish(in message);

    /// <summary>Publishes without blocking; false when backpressured or terminated.</summary>
    /// <param name="message">Payload to publish.</param>
    public bool TryEmit(in TEvent message) => _router.TryPublish(in message);

    /// <summary>Dispatches immediately on the caller thread.</summary>
    /// <param name="message">Payload to dispatch.</param>
    /// <returns>Active subscriptions invoked.</returns>
    public int EmitSync(in TEvent message) => _router.PublishImmediate(in message);

    /// <summary>Returns the wrapped router.</summary>
    public EventRouter<TEvent> UseEmitter() => _router;
}
