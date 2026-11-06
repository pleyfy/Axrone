namespace Axrone.Ecs;

/// <summary>
/// Component-type indexed singleton slots: one owner entity per component id, zero
/// meaning unregistered. The value itself stays in archetype storage, so queries,
/// change ticks and snapshots keep seeing one source of truth.
/// </summary>
internal sealed class EcsSingletonTable
{
    private readonly long[] _owners = GC.AllocateArray<long>(256, pinned: true);

    internal int Count;

    internal bool TryGet(ComponentId id, out Entity owner)
    {
        long packed = Volatile.Read(ref _owners[id.Value]);
        if (packed == 0L)
        {
            owner = Entity.Null;
            return false;
        }

        owner = Unpack(packed);
        return true;
    }

    internal void Set(ComponentId id, in Entity owner)
    {
        long previous = Interlocked.Exchange(ref _owners[id.Value], Pack(in owner));
        if (previous == 0L)
        {
            Interlocked.Increment(ref Count);
        }
    }

    internal bool Clear(ComponentId id, in Entity owner)
    {
        long packed = Pack(in owner);
        if (Interlocked.CompareExchange(ref _owners[id.Value], 0L, packed) != packed)
        {
            return false;
        }

        _ = Interlocked.Decrement(ref Count);
        return true;
    }

    /// <summary>Releases every claim owned by an entity, walking only the components it carries.</summary>
    internal void ClearEntity(in Entity owner, in ComponentMask mask)
    {
        long packed = Pack(in owner);
        ReleaseBits(mask.B0, 0, packed);
        ReleaseBits(mask.B1, 64, packed);
        ReleaseBits(mask.B2, 128, packed);
        ReleaseBits(mask.B3, 192, packed);
    }

    private void ReleaseBits(ulong bits, int baseIndex, long packed)
    {
        while (bits != 0UL)
        {
            int value = baseIndex + BitOperations.TrailingZeroCount(bits);
            bits &= bits - 1UL;
            if (Interlocked.CompareExchange(ref _owners[value], 0L, packed) == packed)
            {
                _ = Interlocked.Decrement(ref Count);
            }
        }
    }

    internal void ClearAll()
    {
        Array.Clear(_owners);
        Volatile.Write(ref Count, 0);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static long Pack(in Entity owner) => ((long)owner.Version.Value << 32) | (uint)owner.Id.Value;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Entity Unpack(long packed) =>
        new(new EntityId(unchecked((int)packed)), new EntityVersion(unchecked((int)(packed >> 32))));
}

/// <summary>
/// World singleton component surface: one instance of a component type per world,
/// addressed by type. Mirrors the reference getSingletonComponent/getSingletonEntity pair
/// with <c>bool Try…</c> outcomes instead of <c>undefined</c>.
/// </summary>
public sealed partial class World
{
    private readonly EcsSingletonTable _singletons = new();

    /// <summary>Registered singleton count.</summary>
    public int SingletonCount => _singletons.Count;

    /// <summary>
    /// Claims the singleton slot for <typeparamref name="T"/> on
    /// <paramref name="entity"/> and writes the value. Re-registering the same entity
    /// replaces the value; a different entity is rejected with
    /// <see cref="EcsSingletonConflictException"/>, matching the reference runtime.
    /// </summary>
    /// <param name="entity">Owner entity.</param>
    /// <param name="value">Component value.</param>
    /// <typeparam name="T">Unmanaged component type.</typeparam>
    public void SetSingleton<T>(scoped in Entity entity, scoped in T value) where T : unmanaged
    {
        ValidateWorldOpen(nameof(SetSingleton));
        ComponentId id = ComponentType<T>.Id;
        if (_singletons.TryGet(id, out Entity owner) && owner != entity)
        {
            if (_entities.Resolve(owner).Kind == EntityLookupResultKind.Found)
            {
                EcsThrowHelper.ThrowSingletonConflict(id, owner, entity);
            }

            _singletons.Clear(id, in owner);
        }

        AddComponent(entity, value);
        _singletons.Set(id, in entity);
    }

    /// <summary>Reads the singleton instance of a component type.</summary>
    /// <param name="value">Component value when registered and live.</param>
    /// <typeparam name="T">Unmanaged component type.</typeparam>
    /// <returns>False when nothing owns the slot or the owner is gone.</returns>
    public bool TryGetSingleton<T>(out T value) where T : unmanaged
    {
        if (!TryGetSingletonEntity<T>(out Entity entity))
        {
            value = default;
            return false;
        }

        value = GetComponent<T>(entity);
        return true;
    }

    /// <summary>Reads the entity that owns the singleton instance of a component type.</summary>
    /// <param name="entity">Owner entity when registered and live.</param>
    /// <typeparam name="T">Unmanaged component type.</typeparam>
    /// <returns>False when nothing owns the slot or the owner is gone.</returns>
    public bool TryGetSingletonEntity<T>(out Entity entity) where T : unmanaged
    {
        ComponentId id = ComponentType<T>.Id;
        if (!_singletons.TryGet(id, out Entity owner))
        {
            entity = Entity.Null;
            return false;
        }

        EntityLookupResult loc = _entities.Resolve(owner);
        if (loc.Kind != EntityLookupResultKind.Found ||
            !_archetypes.GetArchetype(loc.ArchetypeId).Mask.IsSet(id))
        {
            _singletons.Clear(id, in owner);
            entity = Entity.Null;
            return false;
        }

        entity = owner;
        return true;
    }

    /// <summary>Whether a component type currently has a live singleton.</summary>
    /// <typeparam name="T">Unmanaged component type.</typeparam>
    public bool HasSingleton<T>() where T : unmanaged => TryGetSingletonEntity<T>(out _);

    /// <summary>
    /// Releases the singleton slot and removes the component from its owner.
    /// </summary>
    /// <typeparam name="T">Unmanaged component type.</typeparam>
    /// <returns>False when the slot was already free.</returns>
    public bool RemoveSingleton<T>() where T : unmanaged
    {
        if (!TryGetSingletonEntity<T>(out Entity entity))
        {
            return false;
        }

        RemoveComponent<T>(entity);
        return true;
    }

    /// <summary>Drops a singleton claim when its component leaves the owner entity.</summary>
    internal void OnSingletonComponentRemoved(ComponentId id, in Entity owner) => _singletons.Clear(id, in owner);

    /// <summary>Drops every singleton claim owned by a freed entity.</summary>
    internal void OnSingletonEntityFreed(in Entity owner, in ComponentMask mask) => _singletons.ClearEntity(owner, mask);
}
