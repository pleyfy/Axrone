namespace Axrone.Scene;

using Axrone.Ecs;

/// <summary>Entity state bits stored in the compact entity record.</summary>
[Flags]
internal enum SceneEntityFlags : byte
{
    None = 0,
    ActiveSelf = 1 << 0,
    ActiveInHierarchy = 1 << 1,
    Persistent = 1 << 2,
    Pooled = 1 << 3,
    Destroying = 1 << 4,
    IsFree = 1 << 5,
    Initialized = 1 << 6
}

/// <summary>Entity layer and state bits packed into four bytes.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 2)]
internal struct SceneEntityMeta
{
    public ushort Layer;
    public SceneEntityFlags Flags;
    public byte Depth;
}

/// <summary>
/// 64-byte entity record: identity, interned metadata, presence mask, hierarchy
/// links and the hierarchy version consumed by dirty traversal.
/// </summary>
/// <remarks>
/// The free-list link reuses <see cref="Parent"/> while
/// <see cref="SceneEntityFlags.IsFree"/> is set. Behaviour heads live in a
/// parallel array so the hot entity record stays at one cache line.
/// </remarks>
[StructLayout(LayoutKind.Sequential)]
internal struct SceneEntityRecord
{
    public Entity Entity;
    public SceneStringId Name;
    public SceneStringId Tag;
    public SceneComponentMask Mask;
    public int Parent;
    public int FirstChild;
    public int NextSibling;
    public int PrevSibling;
    public uint HierarchyVersion;
    public SceneEntityMeta Meta;
}

/// <summary>
/// Generational entity slot table. Allocation and release are O(1); every
/// release bumps the slot generation so stale handles can never alias a
/// recycled entity.
/// </summary>
internal sealed class SceneEntityTable
{
    private const int MinimumCapacity = 16;

    private SceneEntityRecord[] _records;
    private int[] _behaviourHeads;
    private int _freeHead;
    private int _liveCount;

    public SceneEntityTable(int initialCapacity = 64)
    {
        if (initialCapacity <= 0)
        {
            SceneThrowHelper.ThrowInvalidCapacity(initialCapacity);
        }

        int capacity = Math.Max(initialCapacity, MinimumCapacity);
        _records = new SceneEntityRecord[capacity];
        _behaviourHeads = new int[capacity];
        _freeHead = -1;
        InitializeFreeSlots(0, capacity);
    }

    /// <summary>Current slot capacity.</summary>
    public int Capacity
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _records.Length;
    }

    /// <summary>High-water mark of addressable slots.</summary>
    public int SlotCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _records.Length;
    }

    /// <summary>Number of live entities.</summary>
    public int LiveCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _liveCount;
    }

    /// <summary>Allocates a live entity slot.</summary>
    public SceneEntity Allocate(
        SceneStringId name,
        SceneStringId tag,
        ushort layer,
        bool active,
        bool persistent,
        bool pooled)
    {
        if (_freeHead < 0)
        {
            Grow();
        }

        int slot = _freeHead;
        ref SceneEntityRecord record = ref _records[slot];
        _freeHead = record.Parent;

        record.Parent = -1;
        record.FirstChild = -1;
        record.NextSibling = -1;
        record.PrevSibling = -1;
        record.Name = name;
        record.Tag = tag;
        record.Mask = SceneComponentMask.Empty;
        record.HierarchyVersion = 1;
        record.Meta.Layer = layer;
        record.Meta.Depth = 0;
        record.Meta.Flags =
            SceneEntityFlags.Initialized |
            (active ? SceneEntityFlags.ActiveSelf | SceneEntityFlags.ActiveInHierarchy : SceneEntityFlags.None) |
            (persistent ? SceneEntityFlags.Persistent : SceneEntityFlags.None) |
            (pooled ? SceneEntityFlags.Pooled : SceneEntityFlags.None);

        _behaviourHeads[slot] = -1;
        _liveCount++;

        return SceneEntity.FromEntity(record.Entity);
    }

    /// <summary>Resolves a handle to its live slot.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool TryResolve(in SceneEntity entity, out int slot)
    {
        slot = entity.Slot;
        if ((uint)slot >= (uint)_records.Length)
        {
            return false;
        }

        ref SceneEntityRecord record = ref _records[slot];
        return (record.Meta.Flags & SceneEntityFlags.IsFree) == 0 &&
               record.Entity.Version.Value == entity.Entity.Version.Value;
    }

    /// <summary>Resolves a handle, throwing when it is stale or unknown.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int Resolve(in SceneEntity entity)
    {
        if (!TryResolve(in entity, out int slot))
        {
            SceneThrowHelper.ThrowStaleEntity(in entity);
        }

        return slot;
    }

    /// <summary>References a live record by slot; callers must resolve the slot first.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref SceneEntityRecord RecordAt(int slot) => ref _records[slot];

    /// <summary>References the behaviour head of a live slot.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref int BehaviourHeadAt(int slot) => ref _behaviourHeads[slot];

    /// <summary>Releases a slot and invalidates its generation.</summary>
    public void Free(int slot)
    {
        if ((uint)slot >= (uint)_records.Length)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Entity slot {slot} is outside the table capacity {_records.Length}.");
        }

        ref SceneEntityRecord record = ref _records[slot];
        if ((record.Meta.Flags & SceneEntityFlags.IsFree) != 0)
        {
            return;
        }

        int nextVersion = NextVersion(record.Entity.Version.Value);
        record.Entity = new Entity(record.Entity.Id, new EntityVersion(nextVersion));
        record.Name = SceneStringId.Invalid;
        record.Tag = SceneStringId.Invalid;
        record.Mask = SceneComponentMask.Empty;
        record.FirstChild = -1;
        record.NextSibling = -1;
        record.PrevSibling = -1;
        record.HierarchyVersion++;
        record.Meta.Layer = 0;
        record.Meta.Depth = 0;
        record.Meta.Flags = SceneEntityFlags.IsFree;
        record.Parent = _freeHead;
        _behaviourHeads[slot] = -1;
        _freeHead = slot;
        _liveCount--;
    }

    /// <summary>Releases every slot, invalidating all outstanding handles.</summary>
    public void Clear()
    {
        _freeHead = -1;
        for (int slot = 0; slot < _records.Length; slot++)
        {
            ref SceneEntityRecord record = ref _records[slot];
            int nextVersion = NextVersion(record.Entity.Version.Value);
            record.Entity = new Entity(record.Entity.Id, new EntityVersion(nextVersion));
            record.Name = SceneStringId.Invalid;
            record.Tag = SceneStringId.Invalid;
            record.Mask = SceneComponentMask.Empty;
            record.Parent = _freeHead;
            record.FirstChild = -1;
            record.NextSibling = -1;
            record.PrevSibling = -1;
            record.HierarchyVersion++;
            record.Meta.Layer = 0;
            record.Meta.Depth = 0;
            record.Meta.Flags = SceneEntityFlags.IsFree;
            _behaviourHeads[slot] = -1;
            _freeHead = slot;
        }

        _liveCount = 0;
    }

    private void Grow()
    {
        int oldCapacity = _records.Length;
        if (oldCapacity > int.MaxValue / 2)
        {
            throw new SceneConfigurationException("Entity table capacity overflow.");
        }

        int newCapacity = oldCapacity * 2;
        Array.Resize(ref _records, newCapacity);
        Array.Resize(ref _behaviourHeads, newCapacity);
        InitializeFreeSlots(oldCapacity, newCapacity);
    }

    private void InitializeFreeSlots(int start, int end)
    {
        for (int slot = end - 1; slot >= start; slot--)
        {
            ref SceneEntityRecord record = ref _records[slot];
            record.Entity = new Entity(
                new EntityId(slot + 1),
                new EntityVersion(1));
            record.Name = SceneStringId.Invalid;
            record.Tag = SceneStringId.Invalid;
            record.Mask = SceneComponentMask.Empty;
            record.Parent = _freeHead;
            record.FirstChild = -1;
            record.NextSibling = -1;
            record.PrevSibling = -1;
            record.HierarchyVersion = 1;
            record.Meta.Layer = 0;
            record.Meta.Depth = 0;
            record.Meta.Flags = SceneEntityFlags.IsFree;
            _behaviourHeads[slot] = -1;
            _freeHead = slot;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static int NextVersion(int current)
    {
        int next = current + 1;
        return next <= 0 ? 1 : next;
    }
}
