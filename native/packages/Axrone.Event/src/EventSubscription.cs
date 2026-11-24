namespace Axrone.Event;

/// <summary>
/// Registry-backed subscription; dispatch honors <see cref="IsActive"/> and
/// <see cref="Priority"/>, dispose unsubscribes.
/// </summary>
/// <remarks>
/// Lifecycle is an explicit three-state machine: <c>Active → Paused → Active</c> and
/// <c>Active/Paused → Disposed</c>. Dispose always runs the removal callback exactly once,
/// including when the subscription is currently paused, so pausing can never strand a registry
/// entry.
/// </remarks>
/// <typeparam name="TEvent">Payload type.</typeparam>
public sealed class EventSubscription<TEvent> : IEventSubscription
{
    private const int StateActive = 1;
    private const int StatePaused = 2;
    private const int StateDisposed = 3;

    private readonly Func<EventEnvelope<TEvent>, CancellationToken, ValueTask> _handler;
    private readonly Action<Guid> _onDispose;
    private readonly bool _once;
    private int _state = StateActive;
    private int _claimed;

    public Guid SubscriptionId { get; }

    public bool IsActive => Volatile.Read(ref _state) == StateActive;

    /// <summary>Whether delivery is temporarily suspended without unsubscribing.</summary>
    public bool IsPaused => Volatile.Read(ref _state) == StatePaused;

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
    public void Pause() => Interlocked.CompareExchange(ref _state, StatePaused, StateActive);

    /// <inheritdoc/>
    public void Resume() => Interlocked.CompareExchange(ref _state, StateActive, StatePaused);

    /// <inheritdoc/>
    public void Dispose() => Release();

    /// <summary>
    /// Transitions to <see cref="StateDisposed"/> and runs the removal callback exactly once.
    /// </summary>
    /// <returns>
    /// True when the subscription was still registered (active or paused); false when it had
    /// already been released.
    /// </returns>
    internal bool Release()
    {
        int previous = Interlocked.Exchange(ref _state, StateDisposed);
        if (previous == StateDisposed)
        {
            return false;
        }

        _onDispose(SubscriptionId);
        return true;
    }

    /// <inheritdoc/>
    public ValueTask DisposeAsync()
    {
        Dispose();
        return ValueTask.CompletedTask;
    }
}
