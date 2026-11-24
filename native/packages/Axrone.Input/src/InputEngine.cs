namespace Axrone.Input;

/// <summary>
/// Typed action engine: owns contexts, users, action definitions and
/// per-frame evaluation over a debounced snapshot. Part 1 covers the
/// registry (contexts, users, definitions) plus frame stores.
/// </summary>
/// <typeparam name="TSchema">Action enum.</typeparam>
public sealed partial class InputEngine<TSchema> : IDisposable where TSchema : unmanaged, Enum
{
    private readonly int _actionCount;
    private readonly ActionKind[] _kinds;
    private readonly InputButtonActionDefinition?[] _buttonDefs;
    private readonly InputAxisActionDefinition?[] _axisDefs;
    private readonly InputVector2ActionDefinition?[] _vectorDefs;
    private readonly List<ContextEntry> _contexts = new();
    private readonly Dictionary<UserId, InputUserDefinition> _users = new();
    private readonly Dictionary<
        Action<InputActionCallbackContext<TSchema>>,
        List<Axrone.Event.Hub.SubscriptionToken>> _tokens = new();
    private readonly Axrone.Event.Hub.EventHub<
        InputActionCallbackContext<TSchema>,
        Axrone.Utility.Backoff.SpinPolicies.AdaptiveSpinBackoff,
        Axrone.Event.Hub.NullMetricsSink> _hub;
    private readonly ConsumedControls _consumed = new();
    private readonly List<InputTextEntry> _text = new();
    private InputSnapshot _snapshot;
    private InputCompositionState _composition;
    private bool _focused = true;
    private int _disposed;
    private readonly Lock _tokenGate = new();
    private ulong _sequence;
    private ulong _frame;

    /// <summary>Creates an engine for the given action set.</summary>
    public InputEngine()
    {
        _actionCount = Enum.GetValues<TSchema>().Length;
        _kinds = new ActionKind[_actionCount];
        _buttonDefs = new InputButtonActionDefinition?[_actionCount];
        _axisDefs = new InputAxisActionDefinition?[_actionCount];
        _vectorDefs = new InputVector2ActionDefinition?[_actionCount];
        _hub = new Axrone.Event.Hub.EventHub<
            InputActionCallbackContext<TSchema>,
            Axrone.Utility.Backoff.SpinPolicies.AdaptiveSpinBackoff,
            Axrone.Event.Hub.NullMetricsSink>(new Axrone.Event.Hub.EventHubOptions
            {
                MaxSubscribers = 32,
                WaiterPoolCapacity = 8,
            });
    }

    /// <summary>Whether the window is focused.</summary>
    public bool Focused => _focused;

    /// <summary>Evaluated frame count.</summary>
    public ulong Frame => _frame;

    /// <summary>Pending typed text this frame.</summary>
    public IReadOnlyList<InputTextEntry> Text => _text;

    /// <summary>Current IME composition.</summary>
    public InputCompositionState Composition => _composition;

    /// <summary>Registers button tuning for an action.</summary>
    /// <param name="action">Action to tune.</param>
    /// <param name="definition">Button tuning.</param>
    public void SetButtonDefinition(TSchema action, InputButtonActionDefinition definition)
    {
        ThrowIfDisposed();
        int index = ToIndex(action);
        _kinds[index] = ActionKind.Button;
        _buttonDefs[index] = definition;
        foreach (ContextEntry context in _contexts)
        {
            context.EnsureSlot(index, ActionKind.Button, definition, null, null);
        }
    }

    /// <summary>Registers axis tuning for an action.</summary>
    /// <param name="action">Action to tune.</param>
    /// <param name="definition">Axis tuning.</param>
    public void SetAxisDefinition(TSchema action, InputAxisActionDefinition definition)
    {
        ThrowIfDisposed();
        int index = ToIndex(action);
        _kinds[index] = ActionKind.Axis;
        _axisDefs[index] = definition;
        foreach (ContextEntry context in _contexts)
        {
            context.EnsureSlot(index, ActionKind.Axis, null, definition, null);
        }
    }

    /// <summary>Registers vector tuning for an action.</summary>
    /// <param name="action">Action to tune.</param>
    /// <param name="definition">Vector tuning.</param>
    public void SetVector2Definition(TSchema action, InputVector2ActionDefinition definition)
    {
        ThrowIfDisposed();
        int index = ToIndex(action);
        _kinds[index] = ActionKind.Vector2;
        _vectorDefs[index] = definition;
        foreach (ContextEntry context in _contexts)
        {
            context.EnsureSlot(index, ActionKind.Vector2, null, null, definition);
        }
    }

    /// <summary>Registers an action map.</summary>
    /// <param name="definition">Context registration.</param>
    public void RegisterContext(InputContextDefinition<TSchema> definition)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(definition);
        if (FindContext(definition.Id) is not null)
        {
            ThrowHelper.ThrowContextError("input.context.duplicate", "A context with the same id is already registered.");
        }

        var entry = new ContextEntry(definition.Id, definition.Priority, definition.Enabled, definition.UserId, definition.Capture, _actionCount);
        entry.Sequence = _sequence++;
        for (int i = 0; i < _actionCount; i++)
        {
            entry.EnsureSlot(i, _kinds[i], _buttonDefs[i], _axisDefs[i], _vectorDefs[i]);
            if (i < definition.BindingsByAction.Length)
            {
                ValidateAll(_kinds[i], definition.BindingsByAction[i]);
                entry.SetBindings(i, definition.BindingsByAction[i]);
            }
        }

        _contexts.Add(entry);
        entry.CaptureDefaults();
        SortContexts();
    }

    /// <summary>Registers a user.</summary>
    /// <param name="definition">User registration.</param>
    public void RegisterUser(InputUserDefinition definition)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(definition);
        _users[definition.Id] = definition;
    }

    /// <summary>Replaces the debounced frame state.</summary>
    /// <param name="snapshot">Coordinator snapshot.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetSnapshot(in InputSnapshot snapshot) => _snapshot = snapshot;

    /// <summary>Handles window focus changes; loss resets gestures.</summary>
    /// <param name="focused">Whether the window is focused.</param>
    public void SetFocus(bool focused)
    {
        ThrowIfDisposed();
        _focused = focused;
        if (!focused)
        {
            _snapshot = default;
            ResetAll();
        }
    }

    /// <summary>Queues typed text.</summary>
    /// <param name="entry">Text entry.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void PushText(InputTextEntry entry)
    {
        ThrowIfDisposed();
        _text.Add(entry);
    }

    /// <summary>Stores IME composition.</summary>
    /// <param name="state">Composition state.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void PushComposition(InputCompositionState state)
    {
        ThrowIfDisposed();
        _composition = state;
    }

    /// <summary>Clears per-frame text.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ClearFrameText() => _text.Clear();

    /// <summary>Subscribes to committed action transitions.</summary>
    /// <param name="callback">Callback invoked on non-none phases.</param>
    public void Subscribe(Action<InputActionCallbackContext<TSchema>> callback)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(callback);
        AddSubscription(callback, null, null);
    }

    /// <summary>Subscribes to one action's transitions.</summary>
    /// <param name="callback">Callback to invoke.</param>
    /// <param name="action">Action to listen to.</param>
    public void Subscribe(Action<InputActionCallbackContext<TSchema>> callback, TSchema action)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(callback);
        AddSubscription(callback, action, null);
    }

    /// <summary>Subscribes to selected phases.</summary>
    /// <param name="callback">Callback to invoke.</param>
    /// <param name="phases">Phases to listen to.</param>
    public void Subscribe(Action<InputActionCallbackContext<TSchema>> callback, params InputActionPhase[] phases)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(callback);
        AddSubscription(callback, null, phases);
    }

    /// <summary>Subscribes to one action's selected phases.</summary>
    /// <param name="callback">Callback to invoke.</param>
    /// <param name="action">Action to listen to.</param>
    /// <param name="phases">Phases to listen to.</param>
    public void Subscribe(Action<InputActionCallbackContext<TSchema>> callback, TSchema action, params InputActionPhase[] phases)
    {
        ThrowIfDisposed();
        ArgumentNullException.ThrowIfNull(callback);
        AddSubscription(callback, action, phases);
    }

    /// <summary>Registers a hub subscription and tracks its token.</summary>
    /// <param name="callback">Callback to invoke.</param>
    /// <param name="action">Action filter, or any action when null.</param>
    /// <param name="phases">Phase filter, or all phases when null.</param>
    private void AddSubscription(
        Action<InputActionCallbackContext<TSchema>> callback,
        TSchema? action,
        InputActionPhase[]? phases)
    {
        Axrone.Event.Hub.SubscriptionToken token =
            _hub.Subscribe(new InputActionDispatch<TSchema>(callback, action, phases));
        lock (_tokenGate)
        {
            if (Volatile.Read(ref _disposed) != 0)
            {
                _hub.Unsubscribe(token);
                ThrowIfDisposed();
            }

            if (!_tokens.TryGetValue(callback, out List<Axrone.Event.Hub.SubscriptionToken>? tokens))
            {
                tokens = new List<Axrone.Event.Hub.SubscriptionToken>();
                _tokens[callback] = tokens;
            }

            tokens.Add(token);
        }
    }

    /// <summary>Unsubscribes a callback.</summary>
    /// <param name="callback">Callback to remove.</param>
    public void Unsubscribe(Action<InputActionCallbackContext<TSchema>> callback)
    {
        ThrowIfDisposed();
        List<Axrone.Event.Hub.SubscriptionToken>? tokens;
        lock (_tokenGate)
        {
            if (!_tokens.Remove(callback, out tokens))
            {
                return;
            }
        }

        for (int i = 0; i < tokens.Count; i++)
        {
            _hub.Unsubscribe(tokens[i]);
        }
    }

    /// <summary>Releases engine state.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _rebind?.Cancel(RebindCancelReason.Disposed);
        _rebind = null;
        lock (_tokenGate)
        {
            _tokens.Clear();
        }

        _hub.Dispose();
        _contexts.Clear();
        _users.Clear();
        _text.Clear();
    }

    /// <summary>Maps an action to a slot index.</summary>
    /// <param name="action">Action value.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int ToIndex(TSchema action)
    {
        int index = ((IConvertible)action).ToInt32(System.Globalization.CultureInfo.InvariantCulture);
        if ((uint)index >= (uint)_actionCount)
        {
            ThrowHelper.ThrowConfigError("input.action.range", "Action value is outside the schema range.");
        }

        return index;
    }

    /// <summary>Validates every binding or throws.</summary>
    /// <param name="kind">Action value shape.</param>
    /// <param name="bindings">Bindings to validate.</param>
    private static void ValidateAll(ActionKind kind, InputBinding[] bindings)
    {
        for (int i = 0; i < bindings.Length; i++)
        {
            if (!InputBindingValidator.TryValidate(kind, bindings[i], out string? error))
            {
                ThrowHelper.ThrowConfigError("input.invalid-binding", error ?? "Invalid binding.");
            }
        }
    }

    /// <summary>Finds a context by id.</summary>
    /// <param name="id">Context identity.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private ContextEntry? FindContext(ContextId id)
    {
        for (int i = 0; i < _contexts.Count; i++)
        {
            if (_contexts[i].Id.Equals(id))
            {
                return _contexts[i];
            }
        }

        return null;
    }

    /// <summary>Clears every gesture.</summary>
    private void ResetAll()
    {
        for (int i = 0; i < _contexts.Count; i++)
        {
            _contexts[i].ResetAll();
        }

        _consumed.Clear();
        _text.Clear();
    }

    /// <summary>Throws when used after disposal.</summary>
    private void ThrowIfDisposed()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            ThrowHelper.ThrowDisposed();
        }
    }
}
