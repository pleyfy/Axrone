namespace Axrone.Ecs;

/// <summary>
/// Entity identity stored by the world registry: interned name, optional tag and a layer.
/// </summary>
/// <param name="Entity">Owning entity handle.</param>
/// <param name="Name">Interned entity name.</param>
/// <param name="Tag">Interned tag, or <see cref="EcsEntityTag.Empty"/>.</param>
/// <param name="Layer">Layer used for bulk filtering.</param>
public readonly record struct EcsEntityInfo(Entity Entity, EcsEntityName Name, EcsEntityTag Tag, int Layer);

/// <summary>
/// One registry slot: entity generation plus identity and the dense-list position.
/// </summary>
internal struct EcsEntityEntry
{
    internal int Version;
    internal int NameId;
    internal int TagId;
    internal int Layer;
    internal int DenseIndex;
    internal bool Active;
}

/// <summary>
/// Entity-keyed entity identity registry: direct-address slots by entity index, a dense
/// list for iteration and name/tag/layer indexes for lookups. Registration is a setup
/// operation; index maintenance and iteration share one gate, and query fills write into
/// caller-owned spans so no query allocates.
/// </summary>
internal sealed class EcsEntityRegistry
{
    private const int InitialSlots = 1024;

    private readonly Dictionary<int, int> _byName = new();
    private readonly Dictionary<int, List<int>> _byTag = new();
    private readonly Dictionary<int, List<int>> _byLayer = new();
    private readonly Lock _gate = new();
    private EcsEntityEntry[] _entries = GC.AllocateArray<EcsEntityEntry>(InitialSlots, pinned: true);
    private int[] _dense = GC.AllocateArray<int>(InitialSlots, pinned: true);
    private int _count;

    internal int Count => Volatile.Read(ref _count);

    internal void Register(in Entity entity, in EcsEntityInfo info)
    {
        int slot = entity.Id.Value;
        lock (_gate)
        {
            EnsureSlot(slot);
            if (_byName.TryGetValue(info.Name.Value, out int owner) && owner != slot && _entries[owner].Active)
            {
                EcsThrowHelper.ThrowEntityNameConflict(info.Name, HandleOf(owner), entity);
            }

            ref EcsEntityEntry entry = ref _entries[slot];
            if (entry.Active)
            {
                Unindex(slot, in entry);
            }
            else
            {
                _dense[_count] = slot;
                entry.DenseIndex = _count;
                Volatile.Write(ref _count, _count + 1);
            }

            entry.Version = entity.Version.Value;
            entry.NameId = info.Name.Value;
            entry.TagId = info.Tag.Value;
            entry.Layer = info.Layer;
            entry.Active = true;
            Index(slot, in entry);
        }
    }

    internal bool Unregister(in Entity entity)
    {
        int slot = entity.Id.Value;
        lock (_gate)
        {
            if ((uint)slot >= (uint)_entries.Length)
            {
                return false;
            }

            ref EcsEntityEntry entry = ref _entries[slot];
            if (!entry.Active || entry.Version != entity.Version.Value)
            {
                return false;
            }

            Unindex(slot, in entry);
            RemoveFromDense(slot, entry.DenseIndex);
            entry = default;
            return true;
        }
    }

    internal bool TryGet(in Entity entity, out EcsEntityInfo info)
    {
        int slot = entity.Id.Value;
        EcsEntityEntry[] entries = Volatile.Read(ref _entries);
        if ((uint)slot < (uint)entries.Length)
        {
            ref EcsEntityEntry entry = ref entries[slot];
            if (entry.Active && entry.Version == entity.Version.Value)
            {
                info = new EcsEntityInfo(entity, new EcsEntityName(entry.NameId), new EcsEntityTag(entry.TagId), entry.Layer);
                return true;
            }
        }

        info = default;
        return false;
    }

    internal bool TryFind(in EcsEntityName name, out Entity entity)
    {
        lock (_gate)
        {
            if (_byName.TryGetValue(name.Value, out int slot))
            {
                entity = HandleOf(slot);
                return true;
            }
        }

        entity = Entity.Null;
        return false;
    }

    internal int FillByTag(in EcsEntityTag tag, Span<Entity> results)
    {
        if (tag.Value < 1)
        {
            return 0;
        }

        lock (_gate)
        {
            return _byTag.TryGetValue(tag.Value, out List<int>? slots)
                ? Fill(slots, _entries, results)
                : 0;
        }
    }

    internal int FillByLayer(int layer, Span<Entity> results)
    {
        lock (_gate)
        {
            return _byLayer.TryGetValue(layer, out List<int>? slots)
                ? Fill(slots, _entries, results)
                : 0;
        }
    }

    internal int FillAll(Span<Entity> results)
    {
        lock (_gate)
        {
            int written = 0;
            int count = _count;
            EcsEntityEntry[] entries = _entries;
            int[] dense = _dense;
            for (int i = 0; i < count && written < results.Length; i++)
            {
                int slot = dense[i];
                ref EcsEntityEntry entry = ref entries[slot];
                if (entry.Active)
                {
                    results[written++] = HandleOf(in entry, slot);
                }
            }

            return written;
        }
    }

    internal void Clear()
    {
        lock (_gate)
        {
            Array.Clear(_entries);
            Array.Clear(_dense);
            _byName.Clear();
            _byTag.Clear();
            _byLayer.Clear();
            Volatile.Write(ref _count, 0);
        }
    }

    private static Entity HandleOf(in EcsEntityEntry entry, int slot) =>
        new(new EntityId(slot), new EntityVersion(entry.Version));

    private Entity HandleOf(int slot)
    {
        ref EcsEntityEntry entry = ref _entries[slot];
        return HandleOf(in entry, slot);
    }

    private static int Fill(List<int> slots, EcsEntityEntry[] entries, Span<Entity> results)
    {
        int written = 0;
        for (int i = 0; i < slots.Count && written < results.Length; i++)
        {
            int slot = slots[i];
            results[written++] = HandleOf(in entries[slot], slot);
        }

        return written;
    }

    private void Index(int slot, in EcsEntityEntry entry)
    {
        _byName[entry.NameId] = slot;
        if (entry.TagId > 0)
        {
            AddTo(_byTag, entry.TagId, slot);
        }

        AddTo(_byLayer, entry.Layer, slot);
    }

    private void Unindex(int slot, in EcsEntityEntry entry)
    {
        if (_byName.TryGetValue(entry.NameId, out int owner) && owner == slot)
        {
            _ = _byName.Remove(entry.NameId);
        }

        if (entry.TagId > 0)
        {
            RemoveFrom(_byTag, entry.TagId, slot);
        }

        _ = RemoveFrom(_byLayer, entry.Layer, slot);
    }

    private static void AddTo(Dictionary<int, List<int>> index, int key, int slot)
    {
        if (!index.TryGetValue(key, out List<int>? slots))
        {
            slots = [];
            index[key] = slots;
        }

        slots.Add(slot);
    }

    private static bool RemoveFrom(Dictionary<int, List<int>> index, int key, int slot)
    {
        if (!index.TryGetValue(key, out List<int>? slots))
        {
            return false;
        }

        _ = slots.Remove(slot);
        if (slots.Count == 0)
        {
            _ = index.Remove(key);
        }

        return true;
    }

    private void RemoveFromDense(int slot, int denseIndex)
    {
        int last = --_count;
        if (denseIndex != last)
        {
            int moved = _dense[last];
            _dense[denseIndex] = moved;
            _entries[moved].DenseIndex = denseIndex;
        }

        _dense[last] = 0;
    }

    private void EnsureSlot(int slot)
    {
        if ((uint)slot < (uint)_entries.Length)
        {
            return;
        }

        int capacity = _entries.Length;
        while ((uint)slot >= (uint)capacity)
        {
            capacity *= 2;
        }

        EcsEntityEntry[] entries = GC.AllocateArray<EcsEntityEntry>(capacity, pinned: true);
        Array.Copy(_entries, entries, _entries.Length);
        int[] dense = GC.AllocateArray<int>(capacity, pinned: true);
        Array.Copy(_dense, dense, _dense.Length);
        Volatile.Write(ref _dense, dense);
        Volatile.Write(ref _entries, entries);
    }
}

/// <summary>
/// World entity identity surface: registration, name resolution and tag/layer filtering.
/// </summary>
public sealed partial class World
{
    private readonly EcsEntityRegistry _entityRegistry = new();

    /// <summary>Registered entity count.</summary>
    public int RegisteredEntityCount => _entityRegistry.Count;

    /// <summary>
    /// Registers entity identity for an entity. Re-registering the same entity replaces the
    /// identity and moves the tag/layer indexes; claiming a name another live entity owns is
    /// rejected with <see cref="EcsEntityNameConflictException"/>.
    /// </summary>
    /// <param name="entity">Live entity.</param>
    /// <param name="name">Interned entity name.</param>
    /// <param name="tag">Interned tag; <see cref="EcsEntityTag.Empty"/> keeps the entity untagged.</param>
    /// <param name="layer">Layer used by <see cref="GetEntitiesByLayer"/>.</param>
    public void RegisterEntity(in Entity entity, in EcsEntityName name, in EcsEntityTag tag = default, int layer = 0)
    {
        ValidateWorldOpen(nameof(RegisterEntity));
        if (name.Value < 1)
        {
            EcsThrowHelper.ThrowInvalidEntityName(nameof(RegisterEntity));
        }

        // Structural gate keeps liveness and identity registration atomic against DestroyEntity,
        // which takes the same gate before clearing registry records.
        using (_structuralSync.EnterScope())
        {
            if (_entities.Resolve(entity).Kind != EntityLookupResultKind.Found)
            {
                EcsThrowHelper.ThrowEntityNotFound(in entity);
            }

            _entityRegistry.Register(in entity, new EcsEntityInfo(entity, name, tag, layer));
        }
    }

    /// <summary>Drops entity identity; false when the entity has none or the handle is stale.</summary>
    /// <param name="entity">Entity handle.</param>
    /// <returns>Whether an identity was removed.</returns>
    public bool UnregisterEntity(in Entity entity) => _entityRegistry.Unregister(in entity);

    /// <summary>Reads entity identity for an entity.</summary>
    /// <param name="entity">Entity handle.</param>
    /// <param name="info">Identity when the entity has a live entity registration.</param>
    /// <returns>False for unknown, stale or unregistered entities.</returns>
    public bool TryGetEntity(in Entity entity, out EcsEntityInfo info) => _entityRegistry.TryGet(in entity, out info);

    /// <summary>Resolves an entity name to its owning entity.</summary>
    /// <param name="name">Interned entity name.</param>
    /// <param name="entity">Owning entity handle.</param>
    /// <returns>False when no live entity carries the name.</returns>
    public bool TryFindEntity(in EcsEntityName name, out Entity entity) => _entityRegistry.TryFind(in name, out entity);

    /// <summary>Collects entities carrying a tag.</summary>
    /// <param name="tag">Interned tag.</param>
    /// <param name="results">Destination view; the copy stops at the smaller length.</param>
    /// <returns>Entities written.</returns>
    public int GetEntitiesByTag(in EcsEntityTag tag, Span<Entity> results)
    {
        ValidateWorldOpen(nameof(GetEntitiesByTag));
        return _entityRegistry.FillByTag(in tag, results);
    }

    /// <summary>Collects entities on a layer.</summary>
    /// <param name="layer">Layer value.</param>
    /// <param name="results">Destination view; the copy stops at the smaller length.</param>
    /// <returns>Entities written.</returns>
    public int GetEntitiesByLayer(int layer, Span<Entity> results)
    {
        ValidateWorldOpen(nameof(GetEntitiesByLayer));
        return _entityRegistry.FillByLayer(layer, results);
    }

    /// <summary>Collects every registered entity.</summary>
    /// <param name="results">Destination view; the copy stops at the smaller length.</param>
    /// <returns>Entities written.</returns>
    public int GetRegisteredEntities(Span<Entity> results)
    {
        ValidateWorldOpen(nameof(GetRegisteredEntities));
        return _entityRegistry.FillAll(results);
    }
}
