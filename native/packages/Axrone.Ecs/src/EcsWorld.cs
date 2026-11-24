namespace Axrone.Ecs;

/// <summary>
/// Root world orchestrator: owns the archetype graph, the entity store and
/// diagnostics. Structural operations serialize on one gate; component reads
/// go straight to columns.
/// </summary>
public sealed partial class World : IDisposable
{
    private readonly ArchetypeGraph _archetypes = new();
    private readonly EntityStore _entities;
    private IDiagnosticsSink _diagnostics;
    private readonly ArchetypeQueryCache _queryCache = new();
    private readonly RemovalJournal _removals = new();
    private readonly Lock _structuralSync = new();
    private long _frameCount;
    private int _tick;
    private int _renderRevision;
    private bool _closed;

    /// <summary>Whether <see cref="Dispose"/> has run.</summary>
    public bool IsClosed => Volatile.Read(ref _closed);

    /// <summary>Archetype graph.</summary>
    public ArchetypeGraph Archetypes => _archetypes;

    internal ArchetypeQueryCache QueryCache => _queryCache;

    /// <summary>Entity store.</summary>
    public EntityStore Entities => _entities;

    /// <summary>Diagnostics sink.</summary>
    public IDiagnosticsSink Diagnostics => _diagnostics;

    /// <summary>
    /// Replaces the diagnostics sink. Call before structural operations begin; the bridge
    /// package uses this to install a lifecycle-recording wrapper.
    /// </summary>
    public void SetDiagnosticsSink(IDiagnosticsSink sink)
    {
        ArgumentNullException.ThrowIfNull(sink);
        _diagnostics = sink;
    }

    /// <summary>Stepped frame count.</summary>
    public long FrameCount => Volatile.Read(ref _frameCount);

    /// <summary>Current change tick, advanced by <see cref="Step"/>.</summary>
    public int Tick => Volatile.Read(ref _tick);

    /// <summary>Retained component-removal count.</summary>
    public int RemovalCount => _removals.Count;

    /// <summary>Removals lost because the removal ring was full.</summary>
    public long DroppedRemovals => _removals.DroppedCount;

    /// <summary>
    /// Monotonic render-mutation revision: advanced by every entity or component mutation,
    /// wrapping at uint range. It signals "revalidate", never what changed.
    /// </summary>
    public uint RenderRevision => unchecked((uint)Volatile.Read(ref _renderRevision));

    /// <summary>Throws when an API is used against a disposed world.</summary>
    /// <param name="operation">API name that was rejected.</param>
    internal void ValidateWorldOpen(string operation)
    {
        if (Volatile.Read(ref _closed))
        {
            EcsThrowHelper.ThrowWorldClosed(operation);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void BumpRenderRevision() => Interlocked.Increment(ref _renderRevision);

    /// <summary>Creates a world.</summary>
    public World(int initialCapacity = 4096, IDiagnosticsSink? diagnostics = null, int workerCount = 0)
    {
        _entities = new EntityStore(initialCapacity);
        _diagnostics = diagnostics ?? NullDiagnosticsSink.Instance;
        _requestedWorkerCount = workerCount > 0 ? workerCount : Math.Max(1, Environment.ProcessorCount);
    }

    /// <summary>Begins a draft entity in the root archetype.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public EntityTransaction<DraftState> BeginEntity()
    {
        Entity entity;
        using (_structuralSync.EnterScope())
        {
            Archetype root = _archetypes.GetArchetype(new ArchetypeId(0));
            int row = root.AllocateRow(Entity.Null);
            entity = _entities.Allocate(root.Id, row);
            root.SetEntityRow(row, in entity);
            _diagnostics.OnEntityCreated(entity);
            BumpRenderRevision();
        }

        return new EntityTransaction<DraftState>(this, entity);
    }

    /// <summary>Adds or replaces a component, moving archetypes as needed.</summary>
    public void AddComponent<T>(scoped in Entity entity, scoped in T component) where T : unmanaged
    {
        using (_structuralSync.EnterScope())
        {
            EntityLookupResult loc = _entities.Resolve(entity);
            if (loc.Kind != EntityLookupResultKind.Found)
            {
                EcsThrowHelper.ThrowEntityNotFound(entity);
            }

            Archetype currentArch = _archetypes.GetArchetype(loc.ArchetypeId);
            ComponentId compId = ComponentType<T>.Id;

            if (currentArch.Mask.IsSet(compId))
            {
                ComponentColumn<T> column = currentArch.GetColumn<T>()!;
                column.Set(loc.Row, in component);
                column.MarkChanged(loc.Row, Tick);
                BumpRenderRevision();
                return;
            }

            int nextArchId = Volatile.Read(ref currentArch.TransitionsAdd[compId.Value]);
            Archetype nextArch;

            if (nextArchId >= 0)
            {
                nextArch = _archetypes.GetArchetype(new ArchetypeId(nextArchId));
            }
            else
            {
                ComponentMask nextMask = currentArch.Mask.With(compId);
                nextArch = _archetypes.GetOrCreate(nextMask, CreateColumnsForMask);
                currentArch.TransitionsAdd[compId.Value] = nextArch.Id.Value;
                nextArch.TransitionsRemove[compId.Value] = currentArch.Id.Value;
            }

            int newRow = nextArch.AllocateRow(entity);

            for (ushort c = 0; c < 256; c++)
            {
                if (c == compId.Value)
                {
                    continue;
                }

                ComponentId cid = new(c);
                if (currentArch.Mask.IsSet(cid))
                {
                    IComponentColumn srcCol = currentArch.GetColumn(cid)!;
                    IComponentColumn dstCol = nextArch.GetColumn(cid)!;
                    srcCol.CopyTo(loc.Row, dstCol, newRow);
                }
            }

            nextArch.GetColumn<T>()!.Set(newRow, in component);
            nextArch.GetColumn<T>()!.MarkAdded(newRow, Tick);

            if (currentArch.RemoveRow(loc.Row, out Entity movedEntity))
            {
                _entities.UpdateRecord(movedEntity.Id, currentArch.Id, loc.Row);
            }

            _entities.UpdateRecord(entity.Id, nextArch.Id, newRow);
            BumpRenderRevision();
        }
    }

    /// <summary>Removes a component, moving archetypes as needed.</summary>
    public void RemoveComponent<T>(scoped in Entity entity) where T : unmanaged
    {
        using (_structuralSync.EnterScope())
        {
            EntityLookupResult loc = _entities.Resolve(entity);
            if (loc.Kind != EntityLookupResultKind.Found)
            {
                EcsThrowHelper.ThrowEntityNotFound(entity);
            }

            Archetype currentArch = _archetypes.GetArchetype(loc.ArchetypeId);
            ComponentId compId = ComponentType<T>.Id;

            if (!currentArch.Mask.IsSet(compId))
            {
                return;
            }

            int nextArchId = Volatile.Read(ref currentArch.TransitionsRemove[compId.Value]);
            Archetype nextArch;

            if (nextArchId >= 0)
            {
                nextArch = _archetypes.GetArchetype(new ArchetypeId(nextArchId));
            }
            else
            {
                ComponentMask nextMask = currentArch.Mask.Without(compId);
                nextArch = _archetypes.GetOrCreate(nextMask, CreateColumnsForMask);
                currentArch.TransitionsRemove[compId.Value] = nextArch.Id.Value;
                nextArch.TransitionsAdd[compId.Value] = currentArch.Id.Value;
            }

            int newRow = nextArch.AllocateRow(entity);

            for (ushort c = 0; c < 256; c++)
            {
                if (c == compId.Value)
                {
                    continue;
                }

                ComponentId cid = new(c);
                if (nextArch.Mask.IsSet(cid))
                {
                    IComponentColumn srcCol = currentArch.GetColumn(cid)!;
                    IComponentColumn dstCol = nextArch.GetColumn(cid)!;
                    srcCol.CopyTo(loc.Row, dstCol, newRow);
                }
            }

            if (currentArch.RemoveRow(loc.Row, out Entity movedEntity))
            {
                _entities.UpdateRecord(movedEntity.Id, currentArch.Id, loc.Row);
            }

            _entities.UpdateRecord(entity.Id, nextArch.Id, newRow);
            _removals.Record(entity, compId, Tick);
            OnSingletonComponentRemoved(compId, in entity);
            BumpRenderRevision();
        }
    }

    /// <summary>
    /// Overwrites an existing component and marks it changed. Use this instead of writing
    /// through <see cref="GetComponent{T}"/> when change detection matters.
    /// </summary>
    public void SetComponent<T>(scoped in Entity entity, scoped in T component) where T : unmanaged
    {
        using (_structuralSync.EnterScope())
        {
            EntityLookupResult loc = _entities.Resolve(entity);
            if (loc.Kind != EntityLookupResultKind.Found)
            {
                EcsThrowHelper.ThrowEntityNotFound(entity);
            }

            Archetype arch = _archetypes.GetArchetype(loc.ArchetypeId);
            ComponentColumn<T>? column = arch.GetColumn<T>();
            if (column == null)
            {
                EcsThrowHelper.ThrowComponentNotFound(typeof(T).Name);
            }

            column.Set(loc.Row, in component);
            column.MarkChanged(loc.Row, Tick);
            BumpRenderRevision();
        }
    }

    /// <summary>Collects entities that lost a component after <paramref name="sinceTick"/>.</summary>
    public int GetRemoved<T>(int sinceTick, Span<Entity> results) where T : unmanaged =>
        _removals.GetRemoved(ComponentType<T>.Id, sinceTick, results);

    /// <summary>
    /// Collects entities that lost a component after <paramref name="sinceTick"/>, alongside
    /// the removal tick for each entry.
    /// </summary>
    public int GetRemoved<T>(int sinceTick, Span<Entity> results, Span<int> ticks) where T : unmanaged =>
        _removals.GetRemoved(ComponentType<T>.Id, sinceTick, results, ticks);

    /// <summary>Whether an entity lost a component after <paramref name="sinceTick"/>.</summary>
    public bool WasRemoved<T>(scoped in Entity entity, int sinceTick) where T : unmanaged =>
        _removals.WasRemoved(in entity, ComponentType<T>.Id, sinceTick);

    /// <summary>
    /// References a component for direct mutation. Writes through the returned reference
    /// are not change-tracked; call <see cref="SetComponent{T}"/> when a changed tick is
    /// required.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref T GetComponent<T>(scoped in Entity entity) where T : unmanaged
    {
        EntityLookupResult loc = _entities.Resolve(entity);
        if (loc.Kind != EntityLookupResultKind.Found)
        {
            EcsThrowHelper.ThrowEntityNotFound(entity);
        }

        Archetype arch = _archetypes.GetArchetype(loc.ArchetypeId);
        ComponentColumn<T>? col = arch.GetColumn<T>();
        if (col == null)
        {
            EcsThrowHelper.ThrowComponentNotFound(typeof(T).Name);
        }

        return ref col.Get(loc.Row);
    }

    /// <summary>Whether an entity carries a component.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool HasComponent<T>(scoped in Entity entity) where T : unmanaged
    {
        EntityLookupResult loc = _entities.Resolve(entity);
        if (loc.Kind != EntityLookupResultKind.Found)
        {
            return false;
        }

        return _archetypes.GetArchetype(loc.ArchetypeId).Mask.IsSet(ComponentType<T>.Id);
    }

    /// <summary>Destroys an entity; unknown handles are ignored.</summary>
    public void DestroyEntity(scoped in Entity entity)
    {
        using (_structuralSync.EnterScope())
        {
            if (_entities.TryFree(entity, out EntityRecord record))
            {
                Archetype arch = _archetypes.GetArchetype(record.ArchetypeId);
                ComponentMask mask = arch.Mask;
                for (ushort value = 0; value < 256; value++)
                {
                    ComponentId componentId = new(value);
                    if (mask.IsSet(componentId))
                    {
                        _removals.Record(entity, componentId, Tick);
                    }
                }

                if (arch.RemoveRow(record.Row, out Entity movedEntity))
                {
                    _entities.UpdateRecord(movedEntity.Id, arch.Id, record.Row);
                }

                _actors.Unregister(entity);
                OnSingletonEntityFreed(entity, in mask);

                _diagnostics.OnEntityDestroyed(entity);
                BumpRenderRevision();
            }
        }
    }

    /// <summary>Advances the frame counter and the change tick.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Step()
    {
        Interlocked.Increment(ref _frameCount);
        Interlocked.Increment(ref _tick);
    }

    /// <summary>Restores the change tick from a snapshot.</summary>
    internal void RestoreTick(int tick) => Volatile.Write(ref _tick, tick);

    /// <summary>Opens a single-component query.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Query1<T1> Query<T1>() where T1 : unmanaged => new(this);

    /// <summary>Opens a two-component query.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Query2<T1, T2> Query<T1, T2>() where T1 : unmanaged where T2 : unmanaged => new(this);

    /// <summary>Opens a three-component query.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Query3<T1, T2, T3> Query<T1, T2, T3>()
        where T1 : unmanaged
        where T2 : unmanaged
        where T3 : unmanaged => new(this);

    /// <summary>Opens a four-component query.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Query4<T1, T2, T3, T4> Query<T1, T2, T3, T4>()
        where T1 : unmanaged
        where T2 : unmanaged
        where T3 : unmanaged
        where T4 : unmanaged => new(this);

    /// <inheritdoc/>
    public void Dispose()
    {
        Volatile.Write(ref _closed, true);
        _actors.Clear();
        _singletons.ClearAll();
        DisposeParallelInfrastructure();
        _archetypes.Dispose();
    }

    private static IComponentColumn[] CreateColumnsForMask(ComponentMask mask)
    {
        int count = 0;
        for (ushort i = 0; i < 256; i++)
        {
            if (mask.IsSet(new ComponentId(i)))
            {
                count++;
            }
        }

        IComponentColumn[] columns = new IComponentColumn[count];
        int idx = 0;

        for (ushort i = 0; i < 256; i++)
        {
            ComponentId cid = new(i);
            if (!mask.IsSet(cid))
            {
                continue;
            }

            columns[idx++] = ComponentRegistry.Create(cid, 32);
        }

        return columns;
    }
}
