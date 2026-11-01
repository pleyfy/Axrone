namespace Axrone.Event;

/// <summary>
/// Typed publish/subscribe façade over per-type routers. Routers are created on first use with
/// the bus-wide transport capacity; <see cref="Router{TEvent}"/> exposes the router for
/// non-blocking publishes, filters, and observability.
/// </summary>
public sealed class EventBus : IEventBus, IDisposable, IAsyncDisposable
{
    private readonly ConcurrentDictionary<Type, object> _routers = new();
    private readonly Lock _gate = new();
    private readonly RouterOptions _options;
    private int _disposed;

    /// <summary>Creates a bus; every per-type router gets the same transport capacity.</summary>
    /// <param name="capacityPerRouter">Ring capacity per event type; must be a power of two.</param>
    public EventBus(int capacityPerRouter = 65536)
        : this(RouterOptions.Default with { Capacity = capacityPerRouter })
    {
    }

    /// <summary>Creates a bus; every per-type router gets the same options.</summary>
    public EventBus(RouterOptions options)
    {
        _options = options;
    }

    /// <inheritdoc/>
    public void Publish<TEvent>(in TEvent message) => Router<TEvent>().Publish(in message);

    /// <inheritdoc/>
    public void PublishEnvelope<TEvent>(in EventEnvelope<TEvent> envelope) => Router<TEvent>().PublishEnvelope(in envelope);

    /// <summary>Dispatches synchronously on the caller thread through the event-type router.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="message">Payload to dispatch.</param>
    /// <returns>Active subscriptions invoked.</returns>
    public int PublishImmediate<TEvent>(in TEvent message) => Router<TEvent>().PublishImmediate(in message);

    /// <summary>Non-blocking immediate dispatch through the event-type router.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="message">Payload to dispatch.</param>
    /// <returns>Active subscriptions invoked; zero when completed or reentrant.</returns>
    public int TryPublishImmediate<TEvent>(in TEvent message) => Router<TEvent>().TryPublishImmediate(in message);

    /// <inheritdoc/>
    public int PublishBatch<TEvent>(ReadOnlySpan<TEvent> items) => Router<TEvent>().PublishBatch(items);

    /// <inheritdoc/>
    public IEventSubscription Subscribe<TEvent>(Action<EventEnvelope<TEvent>, CancellationToken> handler) =>
        Router<TEvent>().Subscribe(handler);

    /// <summary>Subscribes a synchronous handler with an explicit dispatch priority.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="handler">Handler to invoke.</param>
    /// <param name="priority">Dispatch priority.</param>
    public IEventSubscription Subscribe<TEvent>(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        EventPriority priority) =>
        Router<TEvent>().Subscribe(handler, priority);

    /// <inheritdoc/>
    public IEventSubscription SubscribeAsync<TEvent>(Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler) =>
        Router<TEvent>().SubscribeAsync(handler);

    /// <summary>Subscribes an asynchronous handler with an explicit dispatch priority.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="handler">Handler to invoke.</param>
    /// <param name="priority">Dispatch priority.</param>
    public IEventSubscription SubscribeAsync<TEvent>(
        Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler,
        EventPriority priority) =>
        Router<TEvent>().SubscribeAsync(handler, priority);

    /// <summary>Returns the router for the event type, creating it on first use.</summary>
    public EventRouter<TEvent> Router<TEvent>()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            ThrowHelper.ThrowObjectDisposed(nameof(EventBus));
        }

        if (_routers.TryGetValue(typeof(TEvent), out object? existing))
        {
            return Unsafe.As<EventRouter<TEvent>>(existing);
        }

        return CreateRouterSlow<TEvent>();
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private EventRouter<TEvent> CreateRouterSlow<TEvent>()
    {
        lock (_gate)
        {
            if (_routers.TryGetValue(typeof(TEvent), out object? existing))
            {
                return Unsafe.As<EventRouter<TEvent>>(existing);
            }

            var router = new EventRouter<TEvent>(_options);
            _routers[typeof(TEvent)] = router;
            return router;
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        lock (_gate)
        {
            foreach (object router in _routers.Values)
            {
                ((IDisposable)router).Dispose();
            }

            _routers.Clear();
        }
    }

    /// <inheritdoc/>
    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        List<object> routers;
        lock (_gate)
        {
            routers = new List<object>(_routers.Values);
            _routers.Clear();
        }

        foreach (object router in routers)
        {
            await ((IAsyncDisposable)router).DisposeAsync().ConfigureAwait(false);
        }
    }
}
