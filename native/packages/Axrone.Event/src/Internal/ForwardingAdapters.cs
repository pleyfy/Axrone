namespace Axrone.Event.Internal;

/// <summary>Subscribes a forwarder to a router or bus without exposing adapter types.</summary>
internal interface IEventSourceAdapter<TEvent>
{
    IEventSubscription Subscribe(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority);
}

/// <summary>Publishes forwarded envelopes and records forwarding failures.</summary>
internal interface IForwardTarget<TEvent>
{
    bool TryPublish(in EventEnvelope<TEvent> envelope);

    void DeadLetter(in EventEnvelope<TEvent> envelope, DeadLetterReason reason, string? error);
}

internal sealed class RouterSourceAdapter<TEvent> : IEventSourceAdapter<TEvent>
{
    private readonly EventRouter<TEvent> _router;

    public RouterSourceAdapter(EventRouter<TEvent> router)
    {
        ArgumentNullException.ThrowIfNull(router);
        _router = router;
    }

    public IEventSubscription Subscribe(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority) =>
        _router.Subscribe(handler, priority);
}

internal sealed class BusSourceAdapter<TEvent> : IEventSourceAdapter<TEvent>
{
    private readonly EventRouter<TEvent> _router;

    public BusSourceAdapter(EventBus bus)
    {
        ArgumentNullException.ThrowIfNull(bus);
        _router = bus.Router<TEvent>();
    }

    public IEventSubscription Subscribe(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority) =>
        _router.Subscribe(handler, priority);
}

internal sealed class RouterForwardTarget<TEvent> : IForwardTarget<TEvent>
{
    private readonly EventRouter<TEvent> _router;

    public RouterForwardTarget(EventRouter<TEvent> router)
    {
        ArgumentNullException.ThrowIfNull(router);
        _router = router;
    }

    public bool TryPublish(in EventEnvelope<TEvent> envelope) =>
        _router.TryPublishEnvelope(in envelope);

    public void DeadLetter(
        in EventEnvelope<TEvent> envelope,
        DeadLetterReason reason,
        string? error) =>
        _router.AddForwardingDeadLetter(in envelope, reason, error);
}

internal sealed class BusForwardTarget<TEvent> : IForwardTarget<TEvent>
{
    private readonly EventRouter<TEvent> _router;

    public BusForwardTarget(EventBus bus)
    {
        ArgumentNullException.ThrowIfNull(bus);
        _router = bus.Router<TEvent>();
    }

    public bool TryPublish(in EventEnvelope<TEvent> envelope) =>
        _router.TryPublishEnvelope(in envelope);

    public void DeadLetter(
        in EventEnvelope<TEvent> envelope,
        DeadLetterReason reason,
        string? error) =>
        _router.AddForwardingDeadLetter(in envelope, reason, error);
}
