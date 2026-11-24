namespace Axrone.Scene;

/// <summary>Host services the behaviour table needs from the owning world.</summary>
internal interface ISceneBehaviourHost
{
    /// <summary>Owning world, exposed to behaviours for sibling component access.</summary>
    SceneWorld World { get; }

    bool IsStarted { get; }

    bool IsActiveInHierarchy(SceneActor actor);

    void ReportBehaviourFault(ISceneBehaviour behaviour, SceneActor actor, int slot, Exception exception);
}

/// <summary>One managed behaviour slot; <see cref="Next"/> links the actor list.</summary>
internal struct SceneBehaviourSlot
{
    public ISceneBehaviour? Behaviour;
    public SceneBehaviourContext? Context;
    public int ActorSlot;
    public int Next;
    public Action? Start;
    public Action? Enable;
    public Action? Disable;
    public Action? Detach;
    public Action<float>? FixedUpdate;
    public Action<float>? Update;
    public Action<float>? LateUpdate;
    public List<IDisposable>? Subscriptions;
}

/// <summary>
/// Managed behaviour storage and priority-ordered phase dispatch. Slots are dense and reused
/// through a free list; callbacks are stored per slot, so only the phases a behaviour actually
/// registered are dispatched. The phase order array is rebuilt only on structural changes.
/// </summary>
internal sealed class SceneBehaviourTable
{
    private const int MinimumCapacity = 16;

    private readonly SceneActorTable _actors;
    private readonly SceneComponentRegistry _registry;
    private readonly ISceneBehaviourHost _host;
    private readonly SceneChangeJournal _changes;
    private readonly Dictionary<ISceneBehaviour, int> _slotByBehaviour = new(ReferenceEqualityComparer.Instance);

    private SceneBehaviourSlot[] _slots;
    private int[] _order;
    private int _slotCount;
    private int _freeHead;
    private int _count;
    private int _orderCount;

    public SceneBehaviourTable(
        SceneActorTable actors,
        SceneComponentRegistry registry,
        ISceneBehaviourHost host,
        SceneChangeJournal changes,
        int initialCapacity = 32)
    {
        ArgumentNullException.ThrowIfNull(actors);
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(host);
        ArgumentNullException.ThrowIfNull(changes);

        if (initialCapacity <= 0)
        {
            SceneThrowHelper.ThrowInvalidCapacity(initialCapacity);
        }

        int capacity = Math.Max(initialCapacity, MinimumCapacity);
        _actors = actors;
        _registry = registry;
        _host = host;
        _changes = changes;
        _slots = new SceneBehaviourSlot[capacity];
        _order = new int[capacity];
        _freeHead = -1;
        InitializeFreeSlots(0, capacity);
        _slotCount = capacity;
    }

    /// <summary>Number of attached behaviours.</summary>
    public int Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _count;
    }

    /// <summary>Number of entries in the phase order.</summary>
    public int OrderCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _orderCount;
    }

    /// <summary>Whether the owning world has started.</summary>
    public bool IsStarted => _host.IsStarted;

    /// <summary>Creates and attaches a behaviour through its registered descriptor.</summary>
    public T Add<T>(SceneActor actor, T behaviour)
        where T : class, ISceneBehaviour
    {
        ArgumentNullException.ThrowIfNull(behaviour);
        SceneBehaviourDescriptor descriptor = _registry.GetBehaviourByType(typeof(T));
        AddCore(actor, descriptor, behaviour);
        return behaviour;
    }

    /// <summary>Creates a behaviour from its descriptor and attaches it.</summary>
    public ISceneBehaviour Add(SceneActor actor, SceneBehaviourDescriptor descriptor)
    {
        ArgumentNullException.ThrowIfNull(descriptor);
        ISceneBehaviour behaviour = descriptor.Create();
        AddCore(actor, descriptor, behaviour);
        return behaviour;
    }

    /// <summary>Creates and attaches a behaviour using its registered factory.</summary>
    public T Add<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        SceneBehaviourDescriptor descriptor = _registry.GetBehaviourByType(typeof(T));
        if (descriptor.Create() is not T behaviour)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Behaviour factory for '{descriptor.Name}' did not produce {typeof(T).Name}.");
        }

        AddCore(actor, descriptor, behaviour);
        return behaviour;
    }

    /// <summary>Removes every behaviour attached to an actor.</summary>
    public void RemoveAllOnActor(SceneActor actor)
    {
        int actorSlot = _actors.Resolve(actor);
        int slot = _actors.BehaviourHeadAt(actorSlot);
        while (slot >= 0)
        {
            int next = _slots[slot].Next;
            if (_slots[slot].Behaviour is { } behaviour)
            {
                Remove(behaviour);
            }

            slot = next;
        }
    }

    /// <summary>Returns the first behaviour of a type on an actor.</summary>
    public ISceneBehaviour? Get(SceneActor actor, SceneBehaviourTypeId typeId)
    {
        int actorSlot = _actors.Resolve(actor);
        int slot = Find(actorSlot, typeId);
        return slot < 0 ? null : _slots[slot].Behaviour;
    }

    /// <summary>Returns the first behaviour of <typeparamref name="T"/> on an actor.</summary>
    public T? Get<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        SceneBehaviourDescriptor descriptor = _registry.GetBehaviourByType(typeof(T));
        return Get(actor, descriptor.TypeId) as T;
    }

    /// <summary>Returns the attachment context of the first behaviour of a type on an actor.</summary>
    public SceneBehaviourContext? GetContext(SceneActor actor, SceneBehaviourTypeId typeId)
    {
        int actorSlot = _actors.Resolve(actor);
        int slot = Find(actorSlot, typeId);
        return slot < 0 ? null : _slots[slot].Context;
    }

    /// <summary>Returns the attachment context of the first behaviour of <typeparamref name="T"/>.</summary>
    public SceneBehaviourContext? GetContext<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        SceneBehaviourDescriptor descriptor = _registry.GetBehaviourByType(typeof(T));
        return GetContext(actor, descriptor.TypeId);
    }

    /// <summary>Whether an actor carries a behaviour of <typeparamref name="T"/>.</summary>
    public bool Has<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        SceneBehaviourDescriptor descriptor = _registry.GetBehaviourByType(typeof(T));
        int actorSlot = _actors.Resolve(actor);
        return Find(actorSlot, descriptor.TypeId) >= 0;
    }

    /// <summary>Removes a specific behaviour instance.</summary>
    public bool Remove(ISceneBehaviour behaviour)
    {
        ArgumentNullException.ThrowIfNull(behaviour);

        if (!_slotByBehaviour.TryGetValue(behaviour, out int slot) ||
            (uint)slot >= (uint)_slotCount ||
            !ReferenceEquals(_slots[slot].Behaviour, behaviour))
        {
            return false;
        }

        SceneBehaviourContext context = _slots[slot].Context!;
        int actorSlot = _slots[slot].ActorSlot;
        SceneActor actor = context.Actor;
        SceneBehaviourTypeId typeId = context.TypeId;
        Unlink(actorSlot, slot);

        TeardownSlot(slot, reportFaults: true);
        RebuildOrder();
        _changes.Write(SceneChange.BehaviourRemoved(actor, typeId));
        return true;
    }

    /// <summary>Removes the first behaviour of <typeparamref name="T"/> from an actor.</summary>
    public bool Remove<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        SceneBehaviourDescriptor descriptor = _registry.GetBehaviourByType(typeof(T));
        int actorSlot = _actors.Resolve(actor);
        int slot = Find(actorSlot, descriptor.TypeId);
        if (slot < 0)
        {
            return false;
        }

        return Remove(_slots[slot].Behaviour!);
    }

    /// <summary>Starts every behaviour still in the loaded state.</summary>
    public void StartAll()
    {
        for (int i = 0; i < _orderCount; i++)
        {
            int slot = _order[i];
            ISceneBehaviour? behaviour = _slots[slot].Behaviour;
            if (behaviour is null)
            {
                continue;
            }

            try
            {
                StartCore(slot);
            }
            catch (Exception exception)
            {
                ReportFault(slot, behaviour, exception);
            }
        }
    }

    /// <summary>Reverts every started behaviour back to loaded so the next start re-runs it.</summary>
    public void ResetAll()
    {
        for (int i = 0; i < _orderCount; i++)
        {
            int slot = _order[i];
            ISceneBehaviour? behaviour = _slots[slot].Behaviour;
            if (behaviour is null)
            {
                continue;
            }

            try
            {
                ResetCore(slot);
            }
            catch (Exception exception)
            {
                ReportFault(slot, behaviour, exception);
            }
        }
    }

    /// <summary>Applies hierarchy activation to every behaviour on an actor.</summary>
    public void SetActiveInHierarchy(in SceneActor actor, bool active)
    {
        int actorSlot = _actors.Resolve(actor);
        int slot = _actors.BehaviourHeadAt(actorSlot);

        while (slot >= 0)
        {
            SceneBehaviourSlot entry = _slots[slot];
            int next = entry.Next;

            if (entry.Behaviour is { } behaviour)
            {
                try
                {
                    entry.Context!.ActiveInHierarchyFlag = active;
                    RefreshDispatchState(slot);
                }
                catch (Exception exception)
                {
                    ReportFault(slot, behaviour, exception);
                }
            }

            slot = next;
        }
    }

    /// <summary>Dispatches one fixed update in priority order.</summary>
    public void FixedUpdateAll(float deltaSeconds)
    {
        for (int i = 0; i < _orderCount; i++)
        {
            int slot = _order[i];
            ref SceneBehaviourSlot entry = ref _slots[slot];
            if (entry.Context!.LifecycleState != SceneBehaviourState.Enabled)
            {
                continue;
            }

            InvokePhase(slot, entry.FixedUpdate, deltaSeconds);
        }
    }

    /// <summary>Dispatches one frame update in priority order.</summary>
    public void UpdateAll(float deltaSeconds)
    {
        for (int i = 0; i < _orderCount; i++)
        {
            int slot = _order[i];
            ref SceneBehaviourSlot entry = ref _slots[slot];
            if (entry.Context!.LifecycleState != SceneBehaviourState.Enabled)
            {
                continue;
            }

            InvokePhase(slot, entry.Update, deltaSeconds);
        }
    }

    /// <summary>Dispatches one late update in priority order.</summary>
    public void LateUpdateAll(float deltaSeconds)
    {
        for (int i = 0; i < _orderCount; i++)
        {
            int slot = _order[i];
            ref SceneBehaviourSlot entry = ref _slots[slot];
            if (entry.Context!.LifecycleState != SceneBehaviourState.Enabled)
            {
                continue;
            }

            InvokePhase(slot, entry.LateUpdate, deltaSeconds);
        }
    }

    /// <summary>Destroys every behaviour and resets the table.</summary>
    public void Clear()
    {
        for (int slot = 0; slot < _slotCount; slot++)
        {
            if (_slots[slot].Behaviour is not null)
            {
                TeardownSlot(slot, reportFaults: true);
            }
        }

        _slotByBehaviour.Clear();
        _count = 0;
        _orderCount = 0;
    }

    internal void SetEnabled(SceneBehaviourContext context, bool value)
    {
        ValidateContext(context);
        if (context.EnabledFlag == value)
        {
            return;
        }

        context.EnabledFlag = value;
        RefreshDispatchState(context.Slot);
    }

    internal void RegisterStart(SceneBehaviourContext context, Action callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        ValidateContext(context);
        ref SceneBehaviourSlot entry = ref _slots[context.Slot];
        ThrowIfRegistered(entry.Start, context, "start");
        entry.Start = callback;
    }

    internal void RegisterEnable(SceneBehaviourContext context, Action callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        ValidateContext(context);
        ref SceneBehaviourSlot entry = ref _slots[context.Slot];
        ThrowIfRegistered(entry.Enable, context, "enable");
        entry.Enable = callback;
    }

    internal void RegisterDisable(SceneBehaviourContext context, Action callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        ValidateContext(context);
        ref SceneBehaviourSlot entry = ref _slots[context.Slot];
        ThrowIfRegistered(entry.Disable, context, "disable");
        entry.Disable = callback;
    }

    internal void RegisterDetach(SceneBehaviourContext context, Action callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        ValidateContext(context);
        ref SceneBehaviourSlot entry = ref _slots[context.Slot];
        ThrowIfRegistered(entry.Detach, context, "detach");
        entry.Detach = callback;
    }

    internal void RegisterFixedUpdate(SceneBehaviourContext context, Action<float> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        ValidateContext(context);
        ref SceneBehaviourSlot entry = ref _slots[context.Slot];
        ThrowIfRegistered(entry.FixedUpdate, context, "fixed update");
        entry.FixedUpdate = callback;
    }

    internal void RegisterUpdate(SceneBehaviourContext context, Action<float> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        ValidateContext(context);
        ref SceneBehaviourSlot entry = ref _slots[context.Slot];
        ThrowIfRegistered(entry.Update, context, "update");
        entry.Update = callback;
    }

    internal void RegisterLateUpdate(SceneBehaviourContext context, Action<float> callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        ValidateContext(context);
        ref SceneBehaviourSlot entry = ref _slots[context.Slot];
        ThrowIfRegistered(entry.LateUpdate, context, "late update");
        entry.LateUpdate = callback;
    }

    internal void Track(SceneBehaviourContext context, IDisposable subscription)
    {
        ValidateContext(context);
        ref SceneBehaviourSlot entry = ref _slots[context.Slot];
        (entry.Subscriptions ??= []).Add(subscription);
    }

    private void AddCore(SceneActor actor, SceneBehaviourDescriptor descriptor, ISceneBehaviour behaviour)
    {
        if (!descriptor.ComponentType.IsInstanceOfType(behaviour))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Behaviour {behaviour.GetType().Name} does not match descriptor '{descriptor.Name}'.");
        }

        if (_slotByBehaviour.ContainsKey(behaviour))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"{behaviour.GetType().Name} is already attached to an actor.");
        }

        int actorSlot = _actors.Resolve(actor);

        if (descriptor.IsSingleton && Find(actorSlot, descriptor.TypeId) >= 0)
        {
            SceneThrowHelper.ThrowComponentDuplicate(in actor, descriptor.ComponentType.Name);
        }

        int slot = AllocateSlot();
        var context = new SceneBehaviourContext(
            this,
            slot,
            actor,
            _host.World,
            descriptor.TypeId,
            descriptor.Priority);
        context.ActiveInHierarchyFlag = _host.IsActiveInHierarchy(actor);

        ref SceneBehaviourSlot entry = ref _slots[slot];
        entry.Behaviour = behaviour;
        entry.Context = context;
        entry.ActorSlot = actorSlot;
        entry.Next = _actors.BehaviourHeadAt(actorSlot);
        _actors.BehaviourHeadAt(actorSlot) = slot;
        _slotByBehaviour.Add(behaviour, slot);
        _count++;

        try
        {
            behaviour.OnAttach(context);
            context.LifecycleState = SceneBehaviourState.Loaded;
            if (_host.IsStarted)
            {
                StartCore(slot);
            }
        }
        catch (Exception)
        {
            Unlink(actorSlot, slot);
            TeardownSlot(slot, reportFaults: false);
            throw;
        }

        RebuildOrder();
        _changes.Write(SceneChange.BehaviourAdded(actor, descriptor.TypeId));
    }

    private void StartCore(int slot)
    {
        ref SceneBehaviourSlot entry = ref _slots[slot];
        SceneBehaviourContext context = entry.Context!;
        if (context.LifecycleState != SceneBehaviourState.Loaded)
        {
            return;
        }

        entry.Start?.Invoke();
        context.LifecycleState = SceneBehaviourState.Started;

        bool shouldDispatch = context.EnabledFlag && context.ActiveInHierarchyFlag;
        context.LifecycleState = shouldDispatch
            ? SceneBehaviourState.Enabled
            : SceneBehaviourState.Disabled;
        _changes.Write(shouldDispatch
            ? SceneChange.BehaviourEnabled(context.Actor, context.TypeId)
            : SceneChange.BehaviourDisabled(context.Actor, context.TypeId));

        if (shouldDispatch)
        {
            entry.Enable?.Invoke();
        }
    }

    private void ResetCore(int slot)
    {
        ref SceneBehaviourSlot entry = ref _slots[slot];
        SceneBehaviourContext context = entry.Context!;
        if (context.LifecycleState == SceneBehaviourState.Enabled)
        {
            entry.Disable?.Invoke();
        }

        if (context.LifecycleState is SceneBehaviourState.Started or
            SceneBehaviourState.Enabled or
            SceneBehaviourState.Disabled)
        {
            context.LifecycleState = SceneBehaviourState.Loaded;
        }
    }

    private void RefreshDispatchState(int slot)
    {
        ref SceneBehaviourSlot entry = ref _slots[slot];
        SceneBehaviourContext context = entry.Context!;
        if (context.LifecycleState is not (SceneBehaviourState.Enabled or SceneBehaviourState.Disabled))
        {
            return;
        }

        bool shouldDispatch = context.EnabledFlag && context.ActiveInHierarchyFlag;
        if (shouldDispatch && context.LifecycleState == SceneBehaviourState.Disabled)
        {
            context.LifecycleState = SceneBehaviourState.Enabled;
            _changes.Write(SceneChange.BehaviourEnabled(context.Actor, context.TypeId));
            entry.Enable?.Invoke();
        }
        else if (!shouldDispatch && context.LifecycleState == SceneBehaviourState.Enabled)
        {
            context.LifecycleState = SceneBehaviourState.Disabled;
            _changes.Write(SceneChange.BehaviourDisabled(context.Actor, context.TypeId));
            entry.Disable?.Invoke();
        }
    }

    private void InvokePhase(int slot, Action<float>? callback, float deltaSeconds)
    {
        if (callback is null)
        {
            return;
        }

        try
        {
            callback(deltaSeconds);
        }
        catch (Exception exception)
        {
            ReportFault(slot, _slots[slot].Behaviour!, exception);
        }
    }

    private static void ThrowIfRegistered(object? existing, SceneBehaviourContext context, string phase)
    {
        if (existing is not null)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"{context.TypeId} already registered a '{phase}' callback.");
        }
    }

    private void TeardownSlot(int slot, bool reportFaults)
    {
        ref SceneBehaviourSlot entry = ref _slots[slot];
        ISceneBehaviour? behaviour = entry.Behaviour;
        SceneBehaviourContext? context = entry.Context;
        if (behaviour is null || context is null)
        {
            return;
        }

        SceneActor actor = context.Actor;
        Exception? fault = null;

        if (context.LifecycleState == SceneBehaviourState.Enabled)
        {
            InvokeAndCapture(entry.Disable, ref fault);
        }

        InvokeAndCapture(entry.Detach, ref fault);
        DisposeSubscriptions(entry.Subscriptions);
        context.MarkDetached();

        entry.Start = null;
        entry.Enable = null;
        entry.Disable = null;
        entry.Detach = null;
        entry.FixedUpdate = null;
        entry.Update = null;
        entry.LateUpdate = null;
        entry.Subscriptions = null;
        entry.Behaviour = null;
        entry.Context = null;
        entry.ActorSlot = -1;
        entry.Next = _freeHead;
        _freeHead = slot;
        _slotByBehaviour.Remove(behaviour);
        _count--;

        if (fault is not null && reportFaults)
        {
            _host.ReportBehaviourFault(behaviour, actor, slot, fault);
        }
    }

    private static void InvokeAndCapture(Action? callback, ref Exception? fault)
    {
        if (callback is null)
        {
            return;
        }

        try
        {
            callback();
        }
        catch (Exception exception)
        {
            fault ??= exception;
        }
    }

    private static void DisposeSubscriptions(List<IDisposable>? subscriptions)
    {
        if (subscriptions is null)
        {
            return;
        }

        for (int index = subscriptions.Count - 1; index >= 0; index--)
        {
            try
            {
                subscriptions[index].Dispose();
            }
            catch (Exception)
            {
                // Teardown must finish even when a subscription's dispose misbehaves.
            }
        }

        subscriptions.Clear();
    }

    private void ReportFault(int slot, ISceneBehaviour behaviour, Exception exception) =>
        _host.ReportBehaviourFault(behaviour, _slots[slot].Context!.Actor, slot, exception);

    private void ValidateContext(SceneBehaviourContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        int slot = context.Slot;
        if ((uint)slot >= (uint)_slotCount || !ReferenceEquals(_slots[slot].Context, context))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "The behaviour context is no longer attached.");
        }
    }

    private int AllocateSlot()
    {
        if (_freeHead < 0)
        {
            Grow();
        }

        int slot = _freeHead;
        _freeHead = _slots[slot].Next;
        return slot;
    }

    private void Grow()
    {
        int oldCapacity = _slots.Length;
        if (oldCapacity > int.MaxValue / 2)
        {
            throw new SceneConfigurationException("Behaviour table capacity overflow.");
        }

        int newCapacity = oldCapacity * 2;
        Array.Resize(ref _slots, newCapacity);
        Array.Resize(ref _order, newCapacity);
        InitializeFreeSlots(oldCapacity, newCapacity);
        _slotCount = newCapacity;
    }

    private void InitializeFreeSlots(int start, int end)
    {
        for (int slot = start; slot < end; slot++)
        {
            ref SceneBehaviourSlot entry = ref _slots[slot];
            entry.Behaviour = null;
            entry.Context = null;
            entry.ActorSlot = -1;
            entry.Next = _freeHead;
            _freeHead = slot;
        }
    }

    private int Find(int actorSlot, SceneBehaviourTypeId typeId)
    {
        for (int slot = _actors.BehaviourHeadAt(actorSlot); slot >= 0; slot = _slots[slot].Next)
        {
            if (_slots[slot].Context?.TypeId == typeId)
            {
                return slot;
            }
        }

        return -1;
    }

    private void Unlink(int actorSlot, int slot)
    {
        if ((uint)actorSlot >= (uint)_actors.Capacity)
        {
            return;
        }

        ref SceneActorRecord actor = ref _actors.RecordAt(actorSlot);
        if ((actor.Meta.Flags & SceneActorFlags.IsFree) != 0)
        {
            return;
        }

        ref int head = ref _actors.BehaviourHeadAt(actorSlot);
        if (head == slot)
        {
            head = _slots[slot].Next;
            return;
        }

        int current = head;
        while (current >= 0)
        {
            ref SceneBehaviourSlot entry = ref _slots[current];
            if (entry.Next == slot)
            {
                entry.Next = _slots[slot].Next;
                return;
            }

            current = entry.Next;
        }
    }

    private void RebuildOrder()
    {
        int count = 0;
        for (int slot = 0; slot < _slotCount; slot++)
        {
            if (_slots[slot].Behaviour is not null)
            {
                _order[count++] = slot;
            }
        }

        for (int i = 1; i < count; i++)
        {
            int key = _order[i];
            int keyPriority = _slots[key].Context!.Priority;
            int j = i - 1;

            while (j >= 0 &&
                (_slots[_order[j]].Context!.Priority < keyPriority ||
                 (_slots[_order[j]].Context!.Priority == keyPriority && _order[j] > key)))
            {
                _order[j + 1] = _order[j];
                j--;
            }

            _order[j + 1] = key;
        }

        _orderCount = count;
    }
}
