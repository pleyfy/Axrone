namespace Axrone.Event;

/// <summary>
/// Typed publish/subscribe façade over per-type routers. Routers are created on first use with
/// the bus-wide transport capacity; <see cref="Router{TEvent}"/> exposes the router for
/// non-blocking publishes, filters, and observability.
/// </summary>
/// <remarks>
/// The bus owns exactly one <see cref="EventDispatcher"/> worker for all of its event types, so the
/// thread count stays flat as routers are added. Disposing the bus drains every router and stops
/// the worker deterministically.
/// </remarks>
public sealed class EventBus : IEventBus, IDisposable, IAsyncDisposable
{
    private readonly ConcurrentDictionary<Type, object> _routers = new();
    private readonly Lock _gate = new();
    private readonly EventDispatcher _dispatcher;
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
        : this(options, EventDispatchMode.Background)
    {
    }

    /// <summary>Creates a bus with an explicit dispatch mode.</summary>
    /// <param name="options">Options applied to every per-type router.</param>
    /// <param name="mode">
    /// Background starts one worker thread. FrameDriven creates no thread and requires the owner
    /// to call <see cref="Pump(int)"/>.
    /// </param>
    public EventBus(RouterOptions options, EventDispatchMode mode)
    {
        _options = options;
        _dispatcher = new EventDispatcher(mode);
    }

    /// <summary>
    /// Advances frame-driven dispatch. Each pass visits every router once; further passes repeat
    /// until no router had work or <paramref name="maxBatches"/> is reached.
    /// </summary>
    /// <param name="maxBatches">Maximum passes for this frame.</param>
    /// <returns>Passes that drained work.</returns>
    /// <exception cref="InvalidOperationException">The bus runs in background mode.</exception>
    public int Pump(int maxBatches = 1) => _dispatcher.Pump(maxBatches);

    /// <summary>
    /// Advances frame-driven dispatch until no router has work or the time budget
    /// is exhausted. Useful when the owner has a per-frame millisecond budget.
    /// </summary>
    public int Pump(TimeSpan maxDuration, int maxBatches = int.MaxValue) =>
        _dispatcher.Pump(maxDuration, maxBatches);

    /// <inheritdoc/>
    public void Publish<TEvent>(in TEvent message) => Router<TEvent>().Publish(in message);

    /// <summary>
    /// Non-blocking publish that reports whether the payload was accepted,
    /// buffered, filtered or backpressured.
    /// </summary>
    public EventPublishResult TryPublishWithResult<TEvent>(in TEvent message) =>
        Router<TEvent>().TryPublishWithResult(in message);

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

    /// <summary>Event types with a live router on this bus. The typed analogue of enumerating event names.</summary>
    public Type[] EventTypes()
    {
        var types = new List<Type>(_routers.Count);
        foreach (Type type in _routers.Keys)
        {
            types.Add(type);
        }

        return types.ToArray();
    }

    /// <summary>Forwards every payload of the type to another bus through an EventForwarder.</summary>
    /// <typeparam name="TSource">Source payload type.</typeparam>
    /// <typeparam name="TTarget">Destination payload type.</typeparam>
    /// <param name="target">Destination bus.</param>
    /// <param name="transform">Payload transform.</param>
    /// <param name="filter">Optional source-side filter.</param>
    /// <param name="options">Optional forwarding bounds.</param>
    public EventForwarder<TSource, TTarget> Pipe<TSource, TTarget>(
        EventBus target,
        Func<TSource, TTarget> transform,
        IEventFilter<TSource>? filter = null,
        EventForwardingOptions? options = null) =>
        new(this, target, transform, filter, options);

    /// <summary>Forwards every payload of the type to another bus through an EventForwarder.</summary>
    /// <typeparam name="TEvent">Payload type.</typeparam>
    /// <param name="target">Destination bus.</param>
    /// <param name="filter">Optional source-side filter.</param>
    /// <param name="options">Optional forwarding bounds.</param>
    public EventForwarder<TEvent> Pipe<TEvent>(
        EventBus target,
        IEventFilter<TEvent>? filter = null,
        EventForwardingOptions? options = null) =>
        new(this, target, filter, options);

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
            if (Volatile.Read(ref _disposed) != 0)
            {
                ThrowHelper.ThrowObjectDisposed(nameof(EventBus));
            }

            if (_routers.TryGetValue(typeof(TEvent), out object? existing))
            {
                return Unsafe.As<EventRouter<TEvent>>(existing);
            }

            var router = new EventRouter<TEvent>(_options, _dispatcher);
            _routers[typeof(TEvent)] = router;
            return router;
        }
    }

    /// <summary>Dispatcher shared by every router owned by this bus.</summary>
    internal EventDispatcher Dispatcher => _dispatcher;

    /// <inheritdoc/>
    public void Dispose()
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
            ((IDisposable)router).Dispose();
        }

        _dispatcher.Dispose();
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

        await _dispatcher.DisposeAsync().ConfigureAwait(false);
    }
}
