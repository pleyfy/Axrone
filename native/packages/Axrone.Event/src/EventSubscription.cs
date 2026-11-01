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
    private int _state = 1;

    public Guid SubscriptionId { get; }

    public bool IsActive => Volatile.Read(ref _state) == 1;

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
        EventPriority priority)
    {
        ArgumentNullException.ThrowIfNull(handler);
        EventPriorityGuard.Validate(priority);

        SubscriptionId = Guid.NewGuid();
        Priority = priority;
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
        EventPriority priority)
    {
        ArgumentNullException.ThrowIfNull(handler);
        EventPriorityGuard.Validate(priority);

        SubscriptionId = Guid.NewGuid();
        Priority = priority;
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
