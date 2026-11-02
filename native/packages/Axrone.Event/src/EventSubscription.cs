namespace Axrone.Event;

/// <summary>
/// Registry-backed subscription; dispatch honors <see cref="IsActive"/> and
/// <see cref="Priority"/>, dispose unsubscribes.
/// </summary>
/// <typeparam name="TEvent">Payload type.</typeparam>
public sealed class EventSubscription<TEvent> : IEventSubscription
{
    private readonly Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> _handler;
    private readonly Action<Guid> _onDispose;
    private readonly bool _once;
    private int _state = 1;
    private int _claimed;

    public Guid SubscriptionId { get; }

    public bool IsActive => Volatile.Read(ref _state) == 1;

    /// <summary>Whether the subscription releases itself after the first delivered envelope.</summary>
    public bool IsOnce => _once;

    /// <summary>Dispatch priority within the owning router.</summary>
    public EventPriority Priority { get; }

    public EventSubscription(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        Action<Guid> onDispose)
        : this(handler, onDispose, EventPriority.Normal)
    {
    }

    public EventSubscription(
        Action<EventEnvelope<TEvent>, CancellationToken> handler,
        Action<Guid> onDispose,
        EventPriority priority,
        bool once = false)
    {
        ArgumentNullException.ThrowIfNull(handler);
        EventPriorityGuard.Validate(priority);

        SubscriptionId = Guid.NewGuid();
        Priority = priority;
        _once = once;
        _handler = (envelope, token) =>
        {
            handler(envelope, token);
            return ValueTask.CompletedTask;
        };
        _onDispose = onDispose;
    }

    public EventSubscription(
        Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler,
        Action<Guid> onDispose)
        : this(handler, onDispose, EventPriority.Normal)
    {
    }

    public EventSubscription(
        Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> handler,
        Action<Guid> onDispose,
        EventPriority priority,
        bool once = false)
    {
        ArgumentNullException.ThrowIfNull(handler);
        EventPriorityGuard.Validate(priority);

        SubscriptionId = Guid.NewGuid();
        Priority = priority;
        _once = once;
        _handler = handler;
        _onDispose = onDispose;
    }

    /// <summary>Invokes the handler when active; completed task otherwise.</summary>
    public ValueTask InvokeAsync(in EventEnvelope<TEvent> envelope, CancellationToken cancellationToken)
    {
        if (IsActive)
        {
            return _handler(envelope, cancellationToken);
        }

        return ValueTask.CompletedTask;
    }

    /// <summary>
    /// Claims the single delivery of a once subscription. Racing dispatchers see exactly one
    /// winner; non-once subscriptions always win.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal bool TryClaimOnce() => !_once || Interlocked.Exchange(ref _claimed, 1) == 0;

    /// <inheritdoc/>
    public void Pause() => Volatile.Write(ref _state, 0);

    /// <inheritdoc/>
    public void Resume() => Volatile.Write(ref _state, 1);

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _state, 0) == 1)
        {
            _onDispose(SubscriptionId);
        }
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }
}
