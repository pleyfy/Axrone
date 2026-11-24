namespace Axrone.Scene;

/// <summary>
/// World-matrix cache over the 3D transform column. Local and world matrices
/// are separate arrays so a parent move only rewrites dirty subtrees.
/// </summary>
internal sealed class SceneTransform3DStore
{
    private readonly SceneEntityTable _entities;
    private readonly SceneComponentColumn<SceneTransform3D> _column;
    private Mat4[] _localMatrices;
    private Mat4[] _worldMatrices;
    private Quat[] _worldRotations;

    public SceneTransform3DStore(
        SceneEntityTable entities,
        SceneComponentColumn<SceneTransform3D> column)
    {
        ArgumentNullException.ThrowIfNull(entities);
        ArgumentNullException.ThrowIfNull(column);

        _entities = entities;
        _column = column;
        _localMatrices = new Mat4[column.Capacity];
        _worldMatrices = new Mat4[column.Capacity];
        _worldRotations = new Quat[column.Capacity];
    }

    /// <summary>Component type id backing this store.</summary>
    public SceneComponentTypeId TypeId => _column.TypeId;

    /// <summary>Grows the column and matrix caches together.</summary>
    public void EnsureCapacity(int required)
    {
        _column.EnsureCapacity(required);
        EnsureArrayCapacity(ref _localMatrices, required);
        EnsureArrayCapacity(ref _worldMatrices, required);
        EnsureArrayCapacity(ref _worldRotations, required);
    }

    /// <summary>Initializes a slot to identity with clean matrices.</summary>
    public void Initialize(int slot)
    {
        SceneTransform3D transform = SceneTransform3D.Identity;
        transform.ClearLocalDirty();
        transform.ClearWorldDirty();
        _column.Set(slot, in transform);
        _localMatrices[slot] = Mat4.Identity;
        _worldMatrices[slot] = Mat4.Identity;
        _worldRotations[slot] = Quat.Identity;
    }

    /// <summary>Clears one slot.</summary>
    public void ClearSlot(int slot)
    {
        _column.ClearSlot(slot);
        _localMatrices[slot] = default;
        _worldMatrices[slot] = default;
        _worldRotations[slot] = Quat.Identity;
    }

    /// <summary>References the local transform payload.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref SceneTransform3D Get(int slot) => ref _column.Get(slot);

    /// <summary>References the cached world matrix.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref readonly Mat4 GetWorldMatrix(int slot) => ref _worldMatrices[slot];

    /// <summary>References the cached world rotation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref readonly Quat GetWorldRotation(int slot) => ref _worldRotations[slot];

    /// <summary>Reads the cached world position.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec3 GetWorldPosition(int slot)
    {
        ref readonly Mat4 matrix = ref _worldMatrices[slot];
        return new Vec3(matrix.M41, matrix.M42, matrix.M43);
    }

    /// <summary>Clears every transform and cached matrix.</summary>
    public void ClearAll()
    {
        _column.ClearAll();
        Array.Clear(_localMatrices);
        Array.Clear(_worldMatrices);
        Array.Clear(_worldRotations);
    }

    /// <summary>Marks a subtree's world matrices stale without touching local data.</summary>
    public void MarkWorldDirtySubtree(int slot)
    {
        _column.Get(slot).MarkWorldDirty();

        int child = _entities.RecordAt(slot).FirstChild;
        while (child >= 0)
        {
            int next = _entities.RecordAt(child).NextSibling;
            MarkWorldDirtySubtree(child);
            child = next;
        }
    }

    /// <summary>Rebuilds dirty local/world matrices in hierarchy order.</summary>
    public void UpdateWorldMatrices()
    {
        int capacity = _entities.Capacity;
        Mat4 identity = Mat4.Identity;
        Quat identityRotation = Quat.Identity;

        for (int slot = 0; slot < capacity; slot++)
        {
            ref SceneEntityRecord record = ref _entities.RecordAt(slot);
            if ((record.Meta.Flags & SceneEntityFlags.IsFree) != 0 || record.Parent >= 0)
            {
                continue;
            }

            UpdateRecursive(slot, in identity, in identityRotation, parentChanged: false);
        }
    }

    private void UpdateRecursive(
        int slot,
        in Mat4 parentWorld,
        in Quat parentRotation,
        bool parentChanged)
    {
        ref SceneTransform3D transform = ref _column.Get(slot);
        bool localChanged = transform.IsLocalDirty;
        if (localChanged)
        {
            transform.ComposeLocalMatrix(out _localMatrices[slot]);
            transform.ClearLocalDirty();
        }

        bool worldChanged = false;
        if (transform.IsWorldDirty || parentChanged || localChanged)
        {
            int parent = _entities.RecordAt(slot).Parent;
            if (parent < 0)
            {
                _worldMatrices[slot] = _localMatrices[slot];
            }
            else
            {
                Mat4.Multiply(in _localMatrices[slot], in parentWorld, out _worldMatrices[slot]);
            }

            transform.ClearWorldDirty();
            worldChanged = true;
        }

        bool rotationChanged = worldChanged;
        Quat worldRotation = _worldRotations[slot];
        if (rotationChanged)
        {
            worldRotation = Quat.Multiply(transform.Rotation, parentRotation);
            _worldRotations[slot] = worldRotation;
        }

        bool childParentChanged = parentChanged || worldChanged;
        int child = _entities.RecordAt(slot).FirstChild;
        while (child >= 0)
        {
            ref SceneEntityRecord childRecord = ref _entities.RecordAt(child);
            int next = childRecord.NextSibling;
            if ((childRecord.Meta.Flags & SceneEntityFlags.IsFree) == 0)
            {
                UpdateRecursive(
                    child,
                    in _worldMatrices[slot],
                    in worldRotation,
                    childParentChanged);
            }

            child = next;
        }
    }

    internal static void EnsureArrayCapacity<T>(ref T[] array, int required)
    {
        if (required <= array.Length)
        {
            return;
        }

        int capacity = array.Length;
        while (capacity < required)
        {
            if (capacity > int.MaxValue / 2)
            {
                throw new SceneConfigurationException("Transform cache capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref array, capacity);
    }
}

/// <summary>
/// World-matrix cache over the 2D transform column, mirroring the 3D store.
/// </summary>
internal sealed class SceneTransform2DStore
{
    private readonly SceneEntityTable _entities;
    private readonly SceneComponentColumn<SceneTransform2D> _column;
    private Mat3[] _localMatrices;
    private Mat3[] _worldMatrices;

    public SceneTransform2DStore(
        SceneEntityTable entities,
        SceneComponentColumn<SceneTransform2D> column)
    {
        ArgumentNullException.ThrowIfNull(entities);
        ArgumentNullException.ThrowIfNull(column);

        _entities = entities;
        _column = column;
        _localMatrices = new Mat3[column.Capacity];
        _worldMatrices = new Mat3[column.Capacity];
    }

    /// <summary>Component type id backing this store.</summary>
    public SceneComponentTypeId TypeId => _column.TypeId;

    /// <summary>Grows the column and matrix caches together.</summary>
    public void EnsureCapacity(int required)
    {
        _column.EnsureCapacity(required);
        SceneTransform3DStore.EnsureArrayCapacity(ref _localMatrices, required);
        SceneTransform3DStore.EnsureArrayCapacity(ref _worldMatrices, required);
    }

    /// <summary>Initializes a slot to identity with clean matrices.</summary>
    public void Initialize(int slot)
    {
        SceneTransform2D transform = SceneTransform2D.Identity;
        transform.ClearLocalDirty();
        transform.ClearWorldDirty();
        _column.Set(slot, in transform);
        _localMatrices[slot] = Mat3.Identity;
        _worldMatrices[slot] = Mat3.Identity;
    }

    /// <summary>Clears one slot.</summary>
    public void ClearSlot(int slot)
    {
        _column.ClearSlot(slot);
        _localMatrices[slot] = default;
        _worldMatrices[slot] = default;
    }

    /// <summary>References the local transform payload.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref SceneTransform2D Get(int slot) => ref _column.Get(slot);

    /// <summary>References the cached world matrix.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref readonly Mat3 GetWorldMatrix(int slot) => ref _worldMatrices[slot];

    /// <summary>Reads the cached world position.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Vec2 GetWorldPosition(int slot)
    {
        ref readonly Mat3 matrix = ref _worldMatrices[slot];
        return new Vec2(matrix.M31, matrix.M32);
    }

    /// <summary>Clears every transform and cached matrix.</summary>
    public void ClearAll()
    {
        _column.ClearAll();
        Array.Clear(_localMatrices);
        Array.Clear(_worldMatrices);
    }

    /// <summary>Marks a subtree's world matrices stale without touching local data.</summary>
    public void MarkWorldDirtySubtree(int slot)
    {
        _column.Get(slot).MarkWorldDirty();

        int child = _entities.RecordAt(slot).FirstChild;
        while (child >= 0)
        {
            int next = _entities.RecordAt(child).NextSibling;
            MarkWorldDirtySubtree(child);
            child = next;
        }
    }

    /// <summary>Rebuilds dirty local/world matrices in hierarchy order.</summary>
    public void UpdateWorldMatrices()
    {
        int capacity = _entities.Capacity;
        Mat3 identity = Mat3.Identity;

        for (int slot = 0; slot < capacity; slot++)
        {
            ref SceneEntityRecord record = ref _entities.RecordAt(slot);
            if ((record.Meta.Flags & SceneEntityFlags.IsFree) != 0 || record.Parent >= 0)
            {
                continue;
            }

            UpdateRecursive(slot, in identity, parentChanged: false);
        }
    }

    private void UpdateRecursive(int slot, in Mat3 parentWorld, bool parentChanged)
    {
        ref SceneTransform2D transform = ref _column.Get(slot);
        bool localChanged = transform.IsLocalDirty;
        if (localChanged)
        {
            transform.ComposeLocalMatrix(out _localMatrices[slot]);
            transform.ClearLocalDirty();
        }

        bool worldChanged = false;
        if (transform.IsWorldDirty || parentChanged || localChanged)
        {
            int parent = _entities.RecordAt(slot).Parent;
            if (parent < 0)
            {
                _worldMatrices[slot] = _localMatrices[slot];
            }
            else
            {
                Mat3.Multiply(in _localMatrices[slot], in parentWorld, out _worldMatrices[slot]);
            }

            transform.ClearWorldDirty();
            worldChanged = true;
        }

        bool childParentChanged = parentChanged || worldChanged;
        int child = _entities.RecordAt(slot).FirstChild;
        while (child >= 0)
        {
            ref SceneEntityRecord childRecord = ref _entities.RecordAt(child);
            int next = childRecord.NextSibling;
            if ((childRecord.Meta.Flags & SceneEntityFlags.IsFree) == 0)
            {
                UpdateRecursive(child, in _worldMatrices[slot], childParentChanged);
            }

            child = next;
        }
    }
}
