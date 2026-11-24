namespace Axrone.Scene;

using System.Runtime.ExceptionServices;

/// <summary>
/// Authoritative scene store: generational entities, unmanaged data columns,
/// managed behaviours, hierarchy links and transform world-matrix caches.
/// </summary>
/// <remarks>
/// The world is loop-thread confined. Structural mutation while entities are
/// being visited is rejected; use <see cref="BeginStructuralBatch"/> outside
/// traversal to group changes.
/// </remarks>
public sealed class SceneWorld : IDisposable, ISceneHierarchyObserver, ISceneBehaviourHost
{
    private readonly SceneComponentRegistry _registry;
    private readonly SceneNameTable _names;
    private readonly ISceneDiagnosticsSink _diagnostics;
    private readonly SceneEntityTable _entities;
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
    private int _activeEntityCount;
    private bool _started;
    private readonly List<SceneEntity> _pendingDestroys = [];
    private readonly HashSet<SceneEntity> _pendingDestroySet = [];

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
        _entities = new SceneEntityTable(options.InitialCapacity);
        _columns = new SceneComponentColumnSet();
        _hierarchy = new SceneHierarchy(_entities, this);
        _behaviours = new SceneBehaviourTable(_entities, _registry, this, _changes);
        _defaultName = _names.Intern("Entity");
        _defaultTag = _names.Intern("Default");

        if (registry.TryGetByName(SceneBuiltInNames.Transform3D, out SceneComponentDescriptor? descriptor3D) &&
            descriptor3D is SceneDataComponentDescriptor data3D)
        {
            _transform3D = new SceneTransform3DStore(
                _entities,
                _columns.GetOrCreate<SceneTransform3D>(data3D, _entities.Capacity));
        }

        if (registry.TryGetByName(SceneBuiltInNames.Transform2D, out SceneComponentDescriptor? descriptor2D) &&
            descriptor2D is SceneDataComponentDescriptor data2D)
        {
            _transform2D = new SceneTransform2DStore(
                _entities,
                _columns.GetOrCreate<SceneTransform2D>(data2D, _entities.Capacity));
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

    /// <summary>Number of live entities.</summary>
    public int EntityCount => _entities.LiveCount;

    /// <summary>Allocated entity slot capacity.</summary>
    public int Capacity => _entities.Capacity;

    /// <summary>Number of entities active in hierarchy.</summary>
    public int ActiveEntityCount => _activeEntityCount;

    /// <summary>Number of attached managed behaviours.</summary>
    public int BehaviourCount => _behaviours.Count;

    /// <summary>Fault policy for managed behaviours.</summary>
    public SceneWorldErrorPolicy ErrorPolicy => _errorPolicy;

    /// <summary>Allocation-free enumerable over live entities.</summary>
    public SceneEntityEnumerable Entities => new(_entities);

    /// <summary>Creates an entity with explicit settings.</summary>
    public SceneEntity CreateEntity(in SceneEntityConfig config)
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(CreateEntity));

        SceneStringId name = config.Name is null ? _defaultName : _names.Intern(config.Name);
        SceneStringId tag = config.Tag is null ? _defaultTag : _names.Intern(config.Tag);

        SceneEntity entity = _entities.Allocate(
            name,
            tag,
            config.Layer,
            config.Active,
            config.Persistent,
            config.Pooled);

        EnsureStoreCapacity();
        InitializeEntityComponents(entity.Slot);

        if (config.Active)
        {
            _activeEntityCount++;
        }

        _changes.Write(SceneChange.EntityCreated(entity));
        return entity;
    }

    /// <summary>Creates an entity with convenience settings.</summary>
    public SceneEntity CreateEntity(
        string? name = null,
        string? tag = null,
        ushort layer = 0,
        bool active = true) =>
        CreateEntity(new SceneEntityConfig(name, tag, layer, active));

    /// <summary>Destroys one entity and detaches its children.</summary>
    /// <remarks>
    /// Destruction requested while behaviours are iterating is deferred until
    /// the current phase ends, so gameplay code can despawn entities safely from
    /// Update/FixedUpdate without a manual command buffer.
    /// </remarks>
    public bool DestroyEntity(SceneEntity entity)
    {
        ThrowIfDisposed();

        if (!_entities.TryResolve(entity, out int slot))
        {
            return false;
        }

        if ((_entities.RecordAt(slot).Meta.Flags & SceneEntityFlags.Destroying) != 0)
        {
            return false;
        }

        if (_iterationDepth > 0)
        {
            if (!_pendingDestroySet.Add(entity))
            {
                return false;
            }

            _pendingDestroys.Add(entity);
            return true;
        }

        return DestroyEntityCore(entity, slot);
    }

    private bool DestroyEntityCore(SceneEntity entity, int slot)
    {
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);
        if ((record.Meta.Flags & SceneEntityFlags.Destroying) != 0)
        {
            return false;
        }

        record.Meta.Flags |= SceneEntityFlags.Destroying;

        _behaviours.RemoveAllOnEntity(entity);

        while (true)
        {
            int childSlot = _entities.RecordAt(slot).FirstChild;
            if (childSlot < 0)
            {
                break;
            }

            SceneEntity child = SceneEntity.FromEntity(_entities.RecordAt(childSlot).Entity);
            _hierarchy.SetParent(child, SceneEntity.Null);
        }

        bool wasActive = (_entities.RecordAt(slot).Meta.Flags & SceneEntityFlags.ActiveInHierarchy) != 0;
        _columns.ClearSlot(slot);
        _transform3D?.ClearSlot(slot);
        _transform2D?.ClearSlot(slot);

        if (wasActive)
        {
            _activeEntityCount--;
        }

        _changes.Write(SceneChange.EntityDestroyed(entity));
        _entities.Free(slot);
        return true;
    }

    /// <summary>Destroys every entity.</summary>
    public void DestroyAllEntities()
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(DestroyAllEntities));

        FlushPendingDestroys();

        for (int slot = 0; slot < _entities.Capacity; slot++)
        {
            ref SceneEntityRecord record = ref _entities.RecordAt(slot);
            if ((record.Meta.Flags & SceneEntityFlags.IsFree) == 0)
            {
                DestroyEntity(SceneEntity.FromEntity(record.Entity));
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

    /// <summary>Resolves a handle to a live entity.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryGetEntity(SceneEntity entity, out SceneEntity resolved)
    {
        if (_entities.TryResolve(entity, out _))
        {
            resolved = entity;
            return true;
        }

        resolved = SceneEntity.Null;
        return false;
    }

    /// <summary>Returns the interned name of an entity.</summary>
    public SceneStringId NameOf(SceneEntity entity) =>
        _entities.RecordAt(_entities.Resolve(entity)).Name;

    /// <summary>Returns the interned tag of an entity.</summary>
    public SceneStringId TagOf(SceneEntity entity) =>
        _entities.RecordAt(_entities.Resolve(entity)).Tag;

    /// <summary>Returns the entity layer.</summary>
    public ushort LayerOf(SceneEntity entity) =>
        _entities.RecordAt(_entities.Resolve(entity)).Meta.Layer;

    /// <summary>Whether the entity is marked persistent.</summary>
    public bool IsPersistent(SceneEntity entity) =>
        (_entities.RecordAt(_entities.Resolve(entity)).Meta.Flags & SceneEntityFlags.Persistent) != 0;

    /// <summary>Whether the entity participates in pooling.</summary>
    public bool IsPooled(SceneEntity entity) =>
        (_entities.RecordAt(_entities.Resolve(entity)).Meta.Flags & SceneEntityFlags.Pooled) != 0;

    /// <summary>Resolves the entity name to its original string.</summary>
    public string GetName(SceneEntity entity) => _names.Resolve(NameOf(entity));

    /// <summary>Resolves the entity tag to its original string.</summary>
    public string GetTag(SceneEntity entity) => _names.Resolve(TagOf(entity));

    /// <summary>Sets the entity name.</summary>
    public void SetName(SceneEntity entity, string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        ThrowIfDisposed();
        int slot = _entities.Resolve(entity);
        _entities.RecordAt(slot).Name = _names.Intern(name);
    }

    /// <summary>Sets the entity tag.</summary>
    public void SetTag(SceneEntity entity, string tag)
    {
        ArgumentNullException.ThrowIfNull(tag);
        ThrowIfDisposed();
        int slot = _entities.Resolve(entity);
        _entities.RecordAt(slot).Tag = _names.Intern(tag);
    }

    /// <summary>Sets the entity layer.</summary>
    public void SetLayer(SceneEntity entity, ushort layer)
    {
        ThrowIfDisposed();
        int slot = _entities.Resolve(entity);
        _entities.RecordAt(slot).Meta.Layer = layer;
    }

    /// <summary>Whether the entity is active locally.</summary>
    public bool IsActiveSelf(SceneEntity entity) => _hierarchy.IsActiveSelf(entity);

    /// <summary>Whether the entity is active after its ancestor chain is applied.</summary>
    public bool IsActiveInHierarchy(SceneEntity entity) => _hierarchy.IsActiveInHierarchy(entity);

    /// <summary>Sets the local active flag.</summary>
    public void SetActive(SceneEntity entity, bool active) => _hierarchy.SetActiveSelf(entity, active);

    /// <summary>Adds or replaces a data component payload.</summary>
    public ref T AddData<T>(SceneEntity entity, in T value)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(AddData));

        int slot = _entities.Resolve(entity);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        SceneComponentColumn<T> column = _columns.GetOrCreate<T>(descriptor, _entities.Capacity);
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);

        if (record.Mask.IsSet(descriptor.TypeId))
        {
            SceneThrowHelper.ThrowComponentDuplicate(in entity, descriptor.ComponentType.Name);
        }

        column.Set(slot, in value);
        record.Mask = record.Mask.With(descriptor.TypeId);
        _changes.Write(SceneChange.ComponentAdded(entity, descriptor.TypeId));
        return ref column.Get(slot);
    }

    /// <summary>References a data component payload.</summary>
    public ref T GetData<T>(SceneEntity entity)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();

        int slot = _entities.Resolve(entity);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);

        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            SceneThrowHelper.ThrowComponentMissing(in entity, descriptor.ComponentType.Name);
        }

        return ref _columns.Get<T>(descriptor.TypeId).Get(slot);
    }

    /// <summary>Copies a data component payload when present.</summary>
    public bool TryGetData<T>(SceneEntity entity, out T value)
        where T : unmanaged, ISceneDataComponent
    {
        value = default;

        if (!_entities.TryResolve(entity, out int slot) ||
            !_registry.TryGetDataByType(typeof(T), out SceneDataComponentDescriptor? descriptor))
        {
            return false;
        }

        ref SceneEntityRecord record = ref _entities.RecordAt(slot);
        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            return false;
        }

        value = _columns.Get<T>(descriptor.TypeId).Get(slot);
        return true;
    }

    /// <summary>Whether the entity carries a data component type.</summary>
    public bool HasData<T>(SceneEntity entity)
        where T : unmanaged, ISceneDataComponent
    {
        if (!_entities.TryResolve(entity, out int slot) ||
            !_registry.TryGetDataByType(typeof(T), out SceneDataComponentDescriptor? descriptor))
        {
            return false;
        }

        return _entities.RecordAt(slot).Mask.IsSet(descriptor.TypeId);
    }

    /// <summary>Removes a data component payload.</summary>
    public bool RemoveData<T>(SceneEntity entity)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(RemoveData));

        int slot = _entities.Resolve(entity);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);

        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            return false;
        }

        if ((_transform3D is not null && descriptor.TypeId == _transform3D.TypeId) ||
            (_transform2D is not null && descriptor.TypeId == _transform2D.TypeId))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Transform components are owned by the entity lifecycle and cannot be removed.");
        }

        _columns.Get<T>(descriptor.TypeId).ClearSlot(slot);
        record.Mask = record.Mask.Without(descriptor.TypeId);
        _changes.Write(SceneChange.ComponentRemoved(entity, descriptor.TypeId));
        return true;
    }

    /// <summary>Writes a data component value and records a change.</summary>
    public void SetData<T>(SceneEntity entity, in T value)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();

        int slot = _entities.Resolve(entity);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);

        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            SceneThrowHelper.ThrowComponentMissing(in entity, descriptor.ComponentType.Name);
        }

        _columns.Get<T>(descriptor.TypeId).Set(slot, in value);
        _changes.Write(SceneChange.ComponentChanged(entity, descriptor.TypeId));
    }

    /// <summary>
    /// Records an in-place mutation made through <see cref="GetData{T}"/>'s by-reference result.
    /// The journal cannot observe direct writes, so callers must mark the component after mutating.
    /// </summary>
    public void MarkChanged<T>(SceneEntity entity)
        where T : unmanaged, ISceneDataComponent
    {
        ThrowIfDisposed();

        int slot = _entities.Resolve(entity);
        SceneDataComponentDescriptor descriptor = _registry.GetDataByType(typeof(T));
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);

        if (!record.Mask.IsSet(descriptor.TypeId))
        {
            SceneThrowHelper.ThrowComponentMissing(in entity, descriptor.ComponentType.Name);
        }

        _changes.Write(SceneChange.ComponentChanged(entity, descriptor.TypeId));
    }

    /// <summary>Returns the entity's data component presence mask.</summary>
    public SceneComponentMask GetComponentMask(SceneEntity entity) =>
        _entities.RecordAt(_entities.Resolve(entity)).Mask;

    /// <summary>Creates and attaches a managed behaviour through its factory.</summary>
    public T AddBehaviour<T>(SceneEntity entity)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(AddBehaviour));
        return _behaviours.Add<T>(entity);
    }

    /// <summary>Attaches a preconstructed managed behaviour.</summary>
    public T AddBehaviour<T>(SceneEntity entity, T behaviour)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(AddBehaviour));
        return _behaviours.Add(entity, behaviour);
    }

    /// <summary>Creates and attaches a behaviour from a descriptor.</summary>
    public ISceneBehaviour AddBehaviour(SceneEntity entity, SceneBehaviourDescriptor descriptor)
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(AddBehaviour));
        return _behaviours.Add(entity, descriptor);
    }

    /// <summary>Returns the attachment context of the first behaviour of a type on an entity.</summary>
    public SceneBehaviourContext? GetBehaviourContext<T>(SceneEntity entity)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        return _behaviours.GetContext<T>(entity);
    }

    /// <summary>Enables or disables the first behaviour of a type on an entity.</summary>
    /// <returns><see langword="false"/> when the entity has no behaviour of that type.</returns>
    public bool SetBehaviourEnabled<T>(SceneEntity entity, bool enabled)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(SetBehaviourEnabled));
        SceneBehaviourContext? context = _behaviours.GetContext<T>(entity);
        if (context is null)
        {
            return false;
        }

        context.Enabled = enabled;
        return true;
    }

    /// <summary>Whether the first behaviour of a type on an entity is enabled.</summary>
    public bool IsBehaviourEnabled<T>(SceneEntity entity)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        return _behaviours.GetContext<T>(entity)?.Enabled == true;
    }

    /// <summary>Removes a specific behaviour instance.</summary>
    public bool RemoveBehaviour(ISceneBehaviour behaviour)
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(RemoveBehaviour));
        return _behaviours.Remove(behaviour);
    }

    /// <summary>Removes the first behaviour of a type from an entity.</summary>
    public bool RemoveBehaviour<T>(SceneEntity entity)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        ThrowIfIterating(nameof(RemoveBehaviour));
        return _behaviours.Remove<T>(entity);
    }

    /// <summary>Returns the first behaviour of a type on an entity.</summary>
    public T? GetBehaviour<T>(SceneEntity entity)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        return _behaviours.Get<T>(entity);
    }

    /// <summary>Whether an entity carries a behaviour of a type.</summary>
    public bool HasBehaviour<T>(SceneEntity entity)
        where T : class, ISceneBehaviour
    {
        ThrowIfDisposed();
        return _behaviours.Has<T>(entity);
    }

    /// <summary>Whether the profile provides a 3D transform store.</summary>
    public bool HasTransform3D => _transform3D is not null;

    /// <summary>Whether the profile provides a 2D transform store.</summary>
    public bool HasTransform2D => _transform2D is not null;

    /// <summary>References an entity's 3D local transform.</summary>
    public ref SceneTransform3D GetTransform3D(SceneEntity entity)
    {
        ThrowIfDisposed();
        if (_transform3D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform3D), "the active profile has no 3D transform.");
        }

        return ref _transform3D.Get(_entities.Resolve(entity));
    }

    /// <summary>References an entity's cached 3D world matrix.</summary>
    public ref readonly Mat4 GetWorldMatrix3D(SceneEntity entity)
    {
        ThrowIfDisposed();
        if (_transform3D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform3D), "the active profile has no 3D transform.");
        }

        return ref _transform3D.GetWorldMatrix(_entities.Resolve(entity));
    }

    /// <summary>References an entity's cached 3D world rotation.</summary>
    public ref readonly Quat GetWorldRotation3D(SceneEntity entity)
    {
        ThrowIfDisposed();
        if (_transform3D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform3D), "the active profile has no 3D transform.");
        }

        return ref _transform3D.GetWorldRotation(_entities.Resolve(entity));
    }

    /// <summary>Reads an entity's cached 3D world position.</summary>
    public Vec3 GetWorldPosition3D(SceneEntity entity)
    {
        ThrowIfDisposed();
        if (_transform3D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform3D), "the active profile has no 3D transform.");
        }

        return _transform3D.GetWorldPosition(_entities.Resolve(entity));
    }

    /// <summary>References an entity's 2D local transform.</summary>
    public ref SceneTransform2D GetTransform2D(SceneEntity entity)
    {
        ThrowIfDisposed();
        if (_transform2D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform2D), "the active profile has no 2D transform.");
        }

        return ref _transform2D.Get(_entities.Resolve(entity));
    }

    /// <summary>References an entity's cached 2D world matrix.</summary>
    public ref readonly Mat3 GetWorldMatrix2D(SceneEntity entity)
    {
        ThrowIfDisposed();
        if (_transform2D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform2D), "the active profile has no 2D transform.");
        }

        return ref _transform2D.GetWorldMatrix(_entities.Resolve(entity));
    }

    /// <summary>Reads an entity's cached 2D world position.</summary>
    public Vec2 GetWorldPosition2D(SceneEntity entity)
    {
        ThrowIfDisposed();
        if (_transform2D is null)
        {
            throw new SceneCapabilityException(nameof(SceneTransform2D), "the active profile has no 2D transform.");
        }

        return _transform2D.GetWorldPosition(_entities.Resolve(entity));
    }

    /// <summary>Visits every live entity in slot order.</summary>
    public bool VisitEntities<TVisitor, TContext>(scoped ref TVisitor visitor, scoped ref TContext context)
        where TVisitor : ISceneEntityVisitor<TContext>, allows ref struct
        where TContext : allows ref struct
    {
        ThrowIfDisposed();
        _iterationDepth++;

        try
        {
            for (int slot = 0; slot < _entities.Capacity; slot++)
            {
                ref SceneEntityRecord record = ref _entities.RecordAt(slot);
                if ((record.Meta.Flags & SceneEntityFlags.IsFree) != 0)
                {
                    continue;
                }

                if (!visitor.Visit(SceneEntity.FromEntity(record.Entity), ref context))
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

    /// <summary>Disposes the world, its behaviours and its entity storage.</summary>
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
        _entities.Clear();
        _activeEntityCount = 0;
        _structuralDepth = 0;
        _iterationDepth = 0;
        Volatile.Write(ref _started, false);
    }

    void ISceneHierarchyObserver.BeforeStructuralChange(string operation) =>
        ThrowIfIterating(operation);

    void ISceneHierarchyObserver.OnParentChanged(
        in SceneEntity child,
        in SceneEntity oldParent,
        in SceneEntity newParent)
    {
        if (!_entities.TryResolve(child, out int slot))
        {
            return;
        }

        _transform3D?.MarkWorldDirtySubtree(slot);
        _transform2D?.MarkWorldDirtySubtree(slot);
        _changes.Write(SceneChange.ParentChanged(child));
    }

    void ISceneHierarchyObserver.OnActiveInHierarchyChanged(in SceneEntity entity, bool active)
    {
        if (active)
        {
            _activeEntityCount++;
        }
        else
        {
            _activeEntityCount--;
        }

        _changes.Write(SceneChange.ActiveInHierarchyChanged(entity));
        _behaviours.SetActiveInHierarchy(in entity, active);
    }

    SceneWorld ISceneBehaviourHost.World => this;

    void ISceneBehaviourHost.ReportBehaviourFault(
        ISceneBehaviour behaviour,
        SceneEntity entity,
        int slot,
        Exception exception)
    {
        _ = behaviour;
        SceneDiagnostic diagnostic = SceneDiagnostic.ForEntity(
            SceneDiagnosticSeverity.Error,
            SceneDiagnosticCodes.BehaviourFaulted,
            in entity,
            numeric: slot);
        _diagnostics.Report(in diagnostic);

        if (_errorPolicy == SceneWorldErrorPolicy.FailFast)
        {
            ExceptionDispatchInfo.Capture(exception).Throw();
        }
    }

    private void InitializeEntityComponents(int slot)
    {
        ref SceneEntityRecord record = ref _entities.RecordAt(slot);

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
        int capacity = _entities.Capacity;
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
    /// Destroys entities queued during iteration. Runs once the outermost
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
            SceneEntity entity = _pendingDestroys[i];
            if (_entities.TryResolve(entity, out int slot))
            {
                _ = DestroyEntityCore(entity, slot);
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
