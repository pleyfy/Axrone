namespace Axrone.Scene;

using System.Runtime.ExceptionServices;

/// <summary>
/// Authoritative scene store: generational actors, unmanaged data columns,
/// managed behaviours, hierarchy links and transform world-matrix caches.
/// </summary>
/// <remarks>
/// The world is loop-thread confined. Structural mutation while actors are
/// being visited is rejected; use <see cref="BeginStructuralBatch"/> outside
/// traversal to group changes.
/// </remarks>
public sealed class SceneWorld : IDisposable, ISceneHierarchyObserver, ISceneBehaviourHost
{
    private readonly SceneComponentRegistry _registry;
    private readonly SceneNameTable _names;
    private readonly ISceneDiagnosticsSink _diagnostics;
    private readonly SceneActorTable _actors;
    private readonly SceneComponentColumnSet _columns;
    private readonly SceneBehaviourTable _behaviours;
    private readonly SceneHierarchy _hierarchy;
    private readonly SceneChangeJournal _changes = new();
    private readonly SceneTransform3DStore? _transform3D;
    private readonly SceneTransform2DStore? _transform2D;
    private readonly SceneStringId _defaultName;
    private readonly SceneStringId _defaultTag;
    private readonly SceneWorldErrorPolicy _errorPolicy;

    private DisposalTracker _disposeTracker;
    private int _iterationDepth;
    private int _structuralDepth;
    private int _activeActorCount;
    private bool _started;
    private readonly List<SceneActor> _pendingDestroys = [];
    private readonly HashSet<SceneActor> _pendingDestroySet = [];

    /// <summary>Creates a world with default options.</summary>
    public SceneWorld(SceneComponentRegistry registry, ISceneDiagnosticsSink? diagnostics = null)
        : this(registry, diagnostics, new SceneWorldOptions())
    {
    }

    /// <summary>Creates a world with explicit options.</summary>
    public SceneWorld(
        SceneComponentRegistry registry,
        ISceneDiagnosticsSink? diagnostics,
        SceneWorldOptions options)
    {
        ArgumentNullException.ThrowIfNull(registry);

        if (options.InitialCapacity <= 0)
        {
            SceneThrowHelper.ThrowInvalidCapacity(options.InitialCapacity);
        }

        registry.Seal();

        _registry = registry;
        _names = registry.Names;
        _diagnostics = diagnostics ?? NullSceneDiagnosticsSink.Instance;
        _errorPolicy = options.ErrorPolicy;
        _actors = new SceneActorTable(options.InitialCapacity);
        _columns = new SceneComponentColumnSet();
        _hierarchy = new SceneHierarchy(_actors, this);
        _behaviours = new SceneBehaviourTable(_actors, _registry, this, _changes);
        _defaultName = _names.Intern("Actor");
        _defaultTag = _names.Intern("Default");

        if (registry.TryGetByName(SceneBuiltInNames.Transform3D, out SceneComponentDescriptor? descriptor3D) &&
            descriptor3D is SceneDataComponentDescriptor data3D)
        {
            _transform3D = new SceneTransform3DStore(
                _actors,
                _columns.GetOrCreate<SceneTransform3D>(data3D, _actors.Capacity));
        }

        if (registry.TryGetByName(SceneBuiltInNames.Transform2D, out SceneComponentDescriptor? descriptor2D) &&
            descriptor2D is SceneDataComponentDescriptor data2D)
        {
            _transform2D = new SceneTransform2DStore(
                _actors,
                _columns.GetOrCreate<SceneTransform2D>(data2D, _actors.Capacity));
        }
    }

    /// <summary>Component registry backing this world.</summary>
    public SceneComponentRegistry Registry => _registry;

    /// <summary>Name table backing this world.</summary>
    public SceneNameTable Names => _names;

    /// <summary>Hierarchy traversal and structural API.</summary>
    public SceneHierarchy Hierarchy => _hierarchy;

    /// <summary>Mutation journal drained once per frame by the host or a reactive bridge.</summary>
    public SceneChangeJournal Changes => _changes;

    /// <summary>Whether lifecycle start has run.</summary>
    public bool IsStarted
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Volatile.Read(ref _started);
    }

    /// <summary>Whether the world has been disposed.</summary>
    public bool IsDisposed => _disposeTracker.IsDisposed;

    /// <summary>Whether a structural batch is currently open.</summary>
    public bool IsInStructuralBatch => _structuralDepth > 0;

    /// <summary>Number of live actors.</summary>
    public int ActorCount => _actors.LiveCount;

    /// <summary>Allocated actor slot capacity.</summary>
    public int Capacity => _actors.Capacity;

    /// <summary>Number of actors active in hierarchy.</summary>
    public int ActiveActorCount => _activeActorCount;

    /// <summary>Number of attached managed behaviours.</summary>
    public int BehaviourCount => _behaviours.Count;

    /// <summary>Fault policy for managed behaviours.</summary>
    public SceneWorldErrorPolicy ErrorPolicy => _errorPolicy;

    /// <summary>Allocation-free enumerable over live actors.</summary>
    public SceneActorEnumerable Actors => new(_actors);

    /// <summary>Creates an actor with explicit settings.</summary>
    public SceneActor CreateActor(in SceneActorConfig config)
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(CreateActor));

        SceneStringId name = config.Name is null ? _defaultName : _names.Intern(config.Name);
        SceneStringId tag = config.Tag is null ? _defaultTag : _names.Intern(config.Tag);

        SceneActor actor = _actors.Allocate(
            name,
            tag,
            config.Layer,
            config.Active,
            config.Persistent,
            config.Pooled);

        EnsureStoreCapacity();
        InitializeActorComponents(actor.Slot);

        if (config.Active)
        {
            _activeActorCount++;
        }

        _changes.Write(SceneChange.ActorCreated(actor));
        return actor;
    }

    /// <summary>Creates an actor with convenience settings.</summary>
    public SceneActor CreateActor(
        string? name = null,
        string? tag = null,
        ushort layer = 0,
        bool active = true) =>
        CreateActor(new SceneActorConfig(name, tag, layer, active));

    /// <summary>Destroys one actor and detaches its children.</summary>
    /// <remarks>
    /// Destruction requested while behaviours are iterating is deferred until
    /// the current phase ends, so gameplay code can despawn actors safely from
    /// Update/FixedUpdate without a manual command buffer.
    /// </remarks>
    public bool DestroyActor(SceneActor actor)
    {
        ThrowIfDisposed();

        if (!_actors.TryResolve(actor, out int slot))
        {
            return false;
        }

        if ((_actors.RecordAt(slot).Meta.Flags & SceneActorFlags.Destroying) != 0)
        {
            return false;
        }

        if (_iterationDepth > 0)
        {
            if (!_pendingDestroySet.Add(actor))
            {
                return false;
            }

            _pendingDestroys.Add(actor);
            return true;
        }

        return DestroyActorCore(actor, slot);
    }

    private bool DestroyActorCore(SceneActor actor, int slot)
    {
        ref SceneActorRecord record = ref _actors.RecordAt(slot);
        if ((record.Meta.Flags & SceneActorFlags.Destroying) != 0)
        {
            return false;
        }

        record.Meta.Flags |= SceneActorFlags.Destroying;

        _behaviours.RemoveAllOnActor(actor);

        while (true)
        {
            int childSlot = _actors.RecordAt(slot).FirstChild;
            if (childSlot < 0)
            {
                break;
            }

            SceneActor child = SceneActor.FromEntity(_actors.RecordAt(childSlot).Entity);
            _hierarchy.SetParent(child, SceneActor.Null);
        }

        bool wasActive = (_actors.RecordAt(slot).Meta.Flags & SceneActorFlags.ActiveInHierarchy) != 0;
        _columns.ClearSlot(slot);
        _transform3D?.ClearSlot(slot);
        _transform2D?.ClearSlot(slot);

        if (wasActive)
        {
            _activeActorCount--;
        }

        _changes.Write(SceneChange.ActorDestroyed(actor));
        _actors.Free(slot);
        return true;
    }

    /// <summary>Destroys every actor.</summary>
    public void DestroyAllActors()
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(DestroyAllActors));

        FlushPendingDestroys();

        for (int slot = 0; slot < _actors.Capacity; slot++)
        {
            ref SceneActorRecord record = ref _actors.RecordAt(slot);
            if ((record.Meta.Flags & SceneActorFlags.IsFree) == 0)
            {
                DestroyActor(SceneActor.FromEntity(record.Entity));
            }
        }
    }

    /// <summary>Starts lifecycle dispatch and runs every pending Start.</summary>
    public void Start()
    {
        ThrowIfDisposed();
        if (IsStarted)
        {
            return;
        }

        Volatile.Write(ref _started, true);

        try
        {
            _behaviours.StartAll();
        }
        catch (Exception)
        {
            Volatile.Write(ref _started, false);
            throw;
        }
    }

    /// <summary>Stops lifecycle dispatch and reverts all behaviours to Loaded.</summary>
    public void Stop()
    {
        ThrowIfDisposed();
        Volatile.Write(ref _started, false);
        _behaviours.ResetAll();
    }

    /// <summary>Runs fixed update for enabled behaviours.</summary>
    public void FixedUpdate(float deltaSeconds)
    {
        ThrowIfDisposed();
        if (!IsStarted)
        {
            return;
        }

        _iterationDepth++;
        try
        {
            _behaviours.FixedUpdateAll(deltaSeconds);
        }
        finally
        {
            EndIteration();
        }
    }

    /// <summary>Runs frame update for enabled behaviours.</summary>
    public void Update(float deltaSeconds)
    {
        ThrowIfDisposed();
        if (!IsStarted)
        {
            return;
        }

        _iterationDepth++;
        try
        {
            _behaviours.UpdateAll(deltaSeconds);
        }
        finally
        {
            EndIteration();
        }
    }

    /// <summary>Runs late update for enabled behaviours.</summary>
    public void LateUpdate(float deltaSeconds)
    {
        ThrowIfDisposed();
        if (!IsStarted)
        {
            return;
        }

        _iterationDepth++;
        try
        {
            _behaviours.LateUpdateAll(deltaSeconds);
        }
        finally
        {
            EndIteration();
        }
    }

    /// <summary>Rebuilds dirty local and world transform matrices.</summary>
    public void UpdateTransforms()
    {
        ThrowIfDisposed();
        _transform3D?.UpdateWorldMatrices();
        _transform2D?.UpdateWorldMatrices();
    }

    /// <summary>Resolves a handle to a live actor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetActor(SceneActor actor, out SceneActor resolved)
    {
        if (_actors.TryResolve(actor, out _))
        {
            resolved = actor;
            return true;
        }

        resolved = SceneActor.Null;
        return false;
    }

    /// <summary>Returns the interned name of an actor.</summary>
    public SceneStringId NameOf(SceneActor actor) =>
        _actors.RecordAt(_actors.Resolve(actor)).Name;

    /// <summary>Returns the interned tag of an actor.</summary>
    public SceneStringId TagOf(SceneActor actor) =>
        _actors.RecordAt(_actors.Resolve(actor)).Tag;

    /// <summary>Returns the actor layer.</summary>
    public ushort LayerOf(SceneActor actor) =>
        _actors.RecordAt(_actors.Resolve(actor)).Meta.Layer;

    /// <summary>Whether the actor is marked persistent.</summary>
    public bool IsPersistent(SceneActor actor) =>
        (_actors.RecordAt(_actors.Resolve(actor)).Meta.Flags & SceneActorFlags.Persistent) != 0;

    /// <summary>Whether the actor participates in pooling.</summary>
    public bool IsPooled(SceneActor actor) =>
        (_actors.RecordAt(_actors.Resolve(actor)).Meta.Flags & SceneActorFlags.Pooled) != 0;

    /// <summary>Resolves the actor name to its original string.</summary>
    public string GetName(SceneActor actor) => _names.Resolve(NameOf(actor));

    /// <summary>Resolves the actor tag to its original string.</summary>
    public string GetTag(SceneActor actor) => _names.Resolve(TagOf(actor));

    /// <summary>Sets the actor name.</summary>
    public void SetName(SceneActor actor, string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        ThrowIfDisposed();
        int slot = _actors.Resolve(actor);
        _actors.RecordAt(slot).Name = _names.Intern(name);
    }

    /// <summary>Sets the actor tag.</summary>
    public void SetTag(SceneActor actor, string tag)
    {
        ArgumentNullException.ThrowIfNull(tag);
        ThrowIfDisposed();
        int slot = _actors.Resolve(actor);
        _actors.RecordAt(slot).Tag = _names.Intern(tag);
    }

    /// <summary>Sets the actor layer.</summary>
    public void SetLayer(SceneActor actor, ushort layer)
    {
        ThrowIfDisposed();
        int slot = _actors.Resolve(actor);
        _actors.RecordAt(slot).Meta.Layer = layer;
    }

    /// <summary>Whether the actor is active locally.</summary>
    public bool IsActiveSelf(SceneActor actor) => _hierarchy.IsActiveSelf(actor);

    /// <summary>Whether the actor is active after its ancestor chain is applied.</summary>
    public bool IsActiveInHierarchy(SceneActor actor) => _hierarchy.IsActiveInHierarchy(actor);

    /// <summary>Sets the local active flag.</summary>
    public void SetActive(SceneActor actor, bool active) => _hierarchy.SetActiveSelf(actor, active);

    /// <summary>Adds or replaces a data component payload.</summary>
    public ref T AddData<T>(SceneActor actor, in T value)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(AddData));

        int slot = _actors.Resolve(actor);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        SceneComponentColumn<T> column = _columns.GetOrCreate<T>(descriptor, _actors.Capacity);
        ref SceneActorRecord record = ref _actors.RecordAt(slot);

        if (record.Mask.IsSet(descriptor.TypeId))
        {
            SceneThrowHelper.ThrowComponentDuplicate(in actor, descriptor.ComponentType.Name);
        }

        column.Set(slot, in value);
        record.Mask = record.Mask.With(descriptor.TypeId);
        _changes.Write(SceneChange.ComponentAdded(actor, descriptor.TypeId));
        return ref column.Get(slot);
    }

    /// <summary>References a data component payload.</summary>
    public ref T GetData<T>(SceneActor actor)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();

        int slot = _actors.Resolve(actor);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        ref SceneActorRecord record = ref _actors.RecordAt(slot);

        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            SceneThrowHelper.ThrowComponentMissing(in actor, descriptor.ComponentType.Name);
        }

        return ref _columns.Get<T>(descriptor.TypeId).Get(slot);
    }

    /// <summary>Copies a data component payload when present.</summary>
    public bool TryGetData<T>(SceneActor actor, out T value)
        where T : unmanaged, ISceneDataComponent
    {
        value = default;

        if (!_actors.TryResolve(actor, out int slot) ||
            !_registry.TryGetDataByType(typeof(T), out SceneDataComponentDescriptor? descriptor))
        {
            return false;
        }

        ref SceneActorRecord record = ref _actors.RecordAt(slot);
        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            return false;
        }

        value = _columns.Get<T>(descriptor.TypeId).Get(slot);
        return true;
    }

    /// <summary>Whether the actor carries a data component type.</summary>
    public bool HasData<T>(SceneActor actor)
        where T : unmanaged, ISceneDataComponent
    {
        if (!_actors.TryResolve(actor, out int slot) ||
            !_registry.TryGetDataByType(typeof(T), out SceneDataComponentDescriptor? descriptor))
        {
            return false;
        }

        return _actors.RecordAt(slot).Mask.IsSet(descriptor.TypeId);
    }

    /// <summary>Removes a data component payload.</summary>
    public bool RemoveData<T>(SceneActor actor)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(RemoveData));

        int slot = _actors.Resolve(actor);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        ref SceneActorRecord record = ref _actors.RecordAt(slot);

        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            return false;
        }

        if ((_transform3D is not null && descriptor.TypeId == _transform3D.TypeId) ||
            (_transform2D is not null && descriptor.TypeId == _transform2D.TypeId))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Transform components are owned by the actor lifecycle and cannot be removed.");
        }

        _columns.Get<T>(descriptor.TypeId).ClearSlot(slot);
        record.Mask = record.Mask.Without(descriptor.TypeId);
        _changes.Write(SceneChange.ComponentRemoved(actor, descriptor.TypeId));
        return true;
    }

    /// <summary>Writes a data component value and records a change.</summary>
    public void SetData<T>(SceneActor actor, in T value)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();

        int slot = _actors.Resolve(actor);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        ref SceneActorRecord record = ref _actors.RecordAt(slot);

        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            SceneThrowHelper.ThrowComponentMissing(in actor, descriptor.ComponentType.Name);
        }

        _columns.Get<T>(descriptor.TypeId).Set(slot, in value);
        _changes.Write(SceneChange.ComponentChanged(actor, descriptor.TypeId));
    }

    /// <summary>
    /// Records an in-place mutation made through <see cref="GetData{T}"/>'s by-reference result.
    /// The journal cannot observe direct writes, so callers must mark the component after mutating.
    /// </summary>
    public void MarkChanged<T>(SceneActor actor)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();

        int slot = _actors.Resolve(actor);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        ref SceneActorRecord record = ref _actors.RecordAt(slot);

        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            SceneThrowHelper.ThrowComponentMissing(in actor, descriptor.ComponentType.Name);
        }

        _changes.Write(SceneChange.ComponentChanged(actor, descriptor.TypeId));
    }

    /// <summary>Returns the actor's data component presence mask.</summary>
    public SceneComponentMask GetComponentMask(SceneActor actor) =>
        _actors.RecordAt(_actors.Resolve(actor)).Mask;

    /// <summary>Creates and attaches a managed behaviour through its factory.</summary>
    public T AddBehaviour<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(AddBehaviour));
        return _behaviours.Add<T>(actor);
    }

    /// <summary>Attaches a preconstructed managed behaviour.</summary>
    public T AddBehaviour<T>(SceneActor actor, T behaviour)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(AddBehaviour));
        return _behaviours.Add(actor, behaviour);
    }

    /// <summary>Creates and attaches a behaviour from a descriptor.</summary>
    public ISceneBehaviour AddBehaviour(SceneActor actor, SceneBehaviourDescriptor descriptor)
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(AddBehaviour));
        return _behaviours.Add(actor, descriptor);
    }

    /// <summary>Returns the attachment context of the first behaviour of a type on an actor.</summary>
    public SceneBehaviourContext? GetBehaviourContext<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        return _behaviours.GetContext<T>(actor);
    }

    /// <summary>Enables or disables the first behaviour of a type on an actor.</summary>
    /// <returns><see langword="false"/> when the actor has no behaviour of that type.</returns>
    public bool SetBehaviourEnabled<T>(SceneActor actor, bool enabled)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(SetBehaviourEnabled));
        SceneBehaviourContext? context = _behaviours.GetContext<T>(actor);
        if (context is null)
        {
            return false;
        }

        context.Enabled = enabled;
        return true;
    }

    /// <summary>Whether the first behaviour of a type on an actor is enabled.</summary>
    public bool IsBehaviourEnabled<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        return _behaviours.GetContext<T>(actor)?.Enabled == true;
    }

    /// <summary>Removes a specific behaviour instance.</summary>
    public bool RemoveBehaviour(ISceneBehaviour behaviour)
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(RemoveBehaviour));
        return _behaviours.Remove(behaviour);
    }

    /// <summary>Removes the first behaviour of a type from an actor.</summary>
    public bool RemoveBehaviour<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(RemoveBehaviour));
        return _behaviours.Remove<T>(actor);
    }

    /// <summary>Returns the first behaviour of a type on an actor.</summary>
    public T? GetBehaviour<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        return _behaviours.Get<T>(actor);
    }

    /// <summary>Whether an actor carries a behaviour of a type.</summary>
    public bool HasBehaviour<T>(SceneActor actor)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        return _behaviours.Has<T>(actor);
    }

    /// <summary>Whether the profile provides a 3D transform store.</summary>
    public bool HasTransform3D => _transform3D is not null;

    /// <summary>Whether the profile provides a 2D transform store.</summary>
    public bool HasTransform2D => _transform2D is not null;

    /// <summary>References an actor's 3D local transform.</summary>
    public ref SceneTransform3D GetTransform3D(SceneActor actor)
    {
        ThrowIfDisposed();
        if (_transform3D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform3D), "the active profile has no 3D transform.");
        }

        return ref _transform3D.Get(_actors.Resolve(actor));
    }

    /// <summary>References an actor's cached 3D world matrix.</summary>
    public ref readonly Mat4 GetWorldMatrix3D(SceneActor actor)
    {
        ThrowIfDisposed();
        if (_transform3D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform3D), "the active profile has no 3D transform.");
        }

        return ref _transform3D.GetWorldMatrix(_actors.Resolve(actor));
    }

    /// <summary>References an actor's cached 3D world rotation.</summary>
    public ref readonly Quat GetWorldRotation3D(SceneActor actor)
    {
        ThrowIfDisposed();
        if (_transform3D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform3D), "the active profile has no 3D transform.");
        }

        return ref _transform3D.GetWorldRotation(_actors.Resolve(actor));
    }

    /// <summary>Reads an actor's cached 3D world position.</summary>
    public Vec3 GetWorldPosition3D(SceneActor actor)
    {
        ThrowIfDisposed();
        if (_transform3D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform3D), "the active profile has no 3D transform.");
        }

        return _transform3D.GetWorldPosition(_actors.Resolve(actor));
    }

    /// <summary>References an actor's 2D local transform.</summary>
    public ref SceneTransform2D GetTransform2D(SceneActor actor)
    {
        ThrowIfDisposed();
        if (_transform2D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform2D), "the active profile has no 2D transform.");
        }

        return ref _transform2D.Get(_actors.Resolve(actor));
    }

    /// <summary>References an actor's cached 2D world matrix.</summary>
    public ref readonly Mat3 GetWorldMatrix2D(SceneActor actor)
    {
        ThrowIfDisposed();
        if (_transform2D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform2D), "the active profile has no 2D transform.");
        }

        return ref _transform2D.GetWorldMatrix(_actors.Resolve(actor));
    }

    /// <summary>Reads an actor's cached 2D world position.</summary>
    public Vec2 GetWorldPosition2D(SceneActor actor)
    {
        ThrowIfDisposed();
        if (_transform2D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform2D), "the active profile has no 2D transform.");
        }

        return _transform2D.GetWorldPosition(_actors.Resolve(actor));
    }

    /// <summary>Visits every live actor in slot order.</summary>
    public bool VisitActors<TVisitor, TContext>(scoped ref TVisitor visitor, scoped ref TContext context)
        where TVisitor : ISceneActorVisitor<TContext>, allows ref struct
        where TContext : allows ref struct
    {
        ThrowIfDisposed();
        _iterationDepth++;

        try
        {
            for (int slot = 0; slot < _actors.Capacity; slot++)
            {
                ref SceneActorRecord record = ref _actors.RecordAt(slot);
                if ((record.Meta.Flags & SceneActorFlags.IsFree) != 0)
                {
                    continue;
                }

                if (!visitor.Visit(SceneActor.FromEntity(record.Entity), ref context))
                {
                    return false;
                }
            }

            return true;
        }
        finally
        {
            EndIteration();
        }
    }

    /// <summary>Opens a grouped structural-mutation scope.</summary>
    public SceneStructuralScope BeginStructuralBatch()
    {
        ThrowIfDisposed();
        _structuralDepth++;
        return new SceneStructuralScope(this);
    }

    /// <summary>Closes a structural batch opened by <see cref="BeginStructuralBatch"/>.</summary>
    internal void EndStructuralBatch()
    {
        if (_structuralDepth <= 0)
        {
            throw new SceneLifecycleException("Structural batch disposal is unbalanced.");
        }

        _structuralDepth--;
    }

    /// <summary>Disposes the world, its behaviours and its actor storage.</summary>
    public void Dispose()
    {
        if (!_disposeTracker.TryDispose())
        {
            return;
        }

        _behaviours.Clear();
        _pendingDestroys.Clear();
        _pendingDestroySet.Clear();
        _transform3D?.ClearAll();
        _transform2D?.ClearAll();
        _columns.ClearAll();
        _actors.Clear();
        _activeActorCount = 0;
        _structuralDepth = 0;
        _iterationDepth = 0;
        Volatile.Write(ref _started, false);
    }

    void ISceneHierarchyObserver.BeforeStructuralChange(string operation) =>
        ThrowIfIterating(operation);

    void ISceneHierarchyObserver.OnParentChanged(
        in SceneActor child,
        in SceneActor oldParent,
        in SceneActor newParent)
    {
        if (!_actors.TryResolve(child, out int slot))
        {
            return;
        }

        _transform3D?.MarkWorldDirtySubtree(slot);
        _transform2D?.MarkWorldDirtySubtree(slot);
        _changes.Write(SceneChange.ParentChanged(child));
    }

    void ISceneHierarchyObserver.OnActiveInHierarchyChanged(in SceneActor actor, bool active)
    {
        if (active)
        {
            _activeActorCount++;
        }
        else
        {
            _activeActorCount--;
        }

        _changes.Write(SceneChange.ActiveInHierarchyChanged(actor));
        _behaviours.SetActiveInHierarchy(in actor, active);
    }

    SceneWorld ISceneBehaviourHost.World => this;

    void ISceneBehaviourHost.ReportBehaviourFault(
        ISceneBehaviour behaviour,
        SceneActor actor,
        int slot,
        Exception exception)
    {
        _ = behaviour;
        SceneDiagnostic diagnostic = SceneDiagnostic.ForActor(
            SceneDiagnosticSeverity.Error,
            SceneDiagnosticCodes.BehaviourFaulted,
            in actor,
            numeric: slot);
        _diagnostics.Report(in diagnostic);

        if (_errorPolicy == SceneWorldErrorPolicy.FailFast)
        {
            ExceptionDispatchInfo.Capture(exception).Throw();
        }
    }

    private void InitializeActorComponents(int slot)
    {
        ref SceneActorRecord record = ref _actors.RecordAt(slot);

        if (_transform3D is not null)
        {
            _transform3D.Initialize(slot);
            record.Mask = record.Mask.With(_transform3D.TypeId);
        }

        if (_transform2D is not null)
        {
            _transform2D.Initialize(slot);
            record.Mask = record.Mask.With(_transform2D.TypeId);
        }
    }

    private void EnsureStoreCapacity()
    {
        int capacity = _actors.Capacity;
        _columns.EnsureCapacity(capacity);
        _transform3D?.EnsureCapacity(capacity);
        _transform2D?.EnsureCapacity(capacity);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ThrowIfIterating(string operation)
    {
        if (_iterationDepth > 0)
        {
            SceneThrowHelper.ThrowStructuralMutation(operation);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void EndIteration()
    {
        _iterationDepth--;

        if (_iterationDepth == 0)
        {
            FlushPendingDestroys();
        }
    }

    /// <summary>
    /// Destroys actors queued during iteration. Runs once the outermost
    /// iteration completes, so component columns are never mutated while a
    /// phase is traversing them.
    /// </summary>
    private void FlushPendingDestroys()
    {
        if (_pendingDestroys.Count == 0)
        {
            return;
        }

        int count = _pendingDestroys.Count;
        for (int i = 0; i < count; i++)
        {
            SceneActor actor = _pendingDestroys[i];
            if (_actors.TryResolve(actor, out int slot))
            {
                _ = DestroyActorCore(actor, slot);
            }
        }

        _pendingDestroys.RemoveRange(0, count);
        _pendingDestroySet.Clear();
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ThrowIfDisposed()
    {
        if (_disposeTracker.IsDisposed)
        {
            SceneThrowHelper.ThrowObjectDisposed(nameof(SceneWorld));
        }
    }
}
