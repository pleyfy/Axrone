namespace Axrone.Scene;

/// <summary>
/// Type-erased view over a data-component column so entity teardown and
/// capacity growth can operate without knowing the payload type.
/// </summary>
internal interface ISceneComponentColumn
{
    SceneComponentTypeId TypeId { get; }

    int Capacity { get; }

    void EnsureCapacity(int required);

    void ClearSlot(int slot);

    void ClearAll();
}

/// <summary>
/// Dense column of one unmanaged data component, indexed by entity slot.
/// </summary>
/// <typeparam name="T">Component payload.</typeparam>
internal sealed class SceneComponentColumn<T> : ISceneComponentColumn
    where T : unmanaged, ISceneDataComponent
{
    private const int MinimumCapacity = 16;

    private T[] _values;

    public SceneComponentColumn(SceneComponentTypeId typeId, int initialCapacity)
    {
        if (!typeId.IsValid)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Component columns require a valid type id.");
        }

        if (initialCapacity <= 0)
        {
            SceneThrowHelper.ThrowInvalidCapacity(initialCapacity);
        }

        TypeId = typeId;
        _values = new T[Math.Max(initialCapacity, MinimumCapacity)];
    }

    /// <inheritdoc/>
    public SceneComponentTypeId TypeId { get; }

    /// <inheritdoc/>
    public int Capacity
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _values.Length;
    }

    /// <summary>References the payload at <paramref name="slot"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref T Get(int slot) => ref _values[slot];

    /// <summary>References the payload without a bounds check.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ref T GetUnchecked(uint slot)
    {
        ref T first = ref MemoryMarshal.GetArrayDataReference(_values);
        return ref Unsafe.Add(ref first, (nuint)slot);
    }

    /// <summary>Writes the payload at <paramref name="slot"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Set(int slot, in T value) => _values[slot] = value;

    /// <inheritdoc/>
    public void EnsureCapacity(int required)
    {
        if (required <= _values.Length)
        {
            return;
        }

        if (required < 0)
        {
            throw new SceneConfigurationException(
                $"Component column capacity must not be negative; received {required}.");
        }

        int newCapacity = _values.Length;
        while (newCapacity < required)
        {
            if (newCapacity > int.MaxValue / 2)
            {
                throw new SceneConfigurationException("Component column capacity overflow.");
            }

            newCapacity *= 2;
        }

        Array.Resize(ref _values, newCapacity);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void ClearSlot(int slot) => _values[slot] = default;

    /// <inheritdoc/>
    public void ClearAll() => Array.Clear(_values);

    /// <summary>Writable view over the column's live slots.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Span<T> AsSpan(int length) => _values.AsSpan(0, length);
}

/// <summary>
/// Sparse set of typed columns addressed by data component id. The array is
/// fixed at the presence-mask capacity; only the active list is iterated for
/// lifecycle operations.
/// </summary>
internal sealed class SceneComponentColumnSet
{
    private readonly ISceneComponentColumn?[] _columns = new ISceneComponentColumn?[SceneComponentMask.Capacity];
    private readonly List<ISceneComponentColumn> _active = new();

    /// <summary>Number of materialized columns.</summary>
    public int Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _active.Count;
    }

    /// <summary>Gets or creates the column for <typeparamref name="T"/>.</summary>
    public SceneComponentColumn<T> GetOrCreate<T>(SceneDataComponentDescriptor descriptor, int entityCapacity)
        where T : unmanaged, ISceneDataComponent
    {
        ArgumentNullException.ThrowIfNull(descriptor);

        int index = descriptor.TypeId.Value;
        if ((uint)index >= (uint)_columns.Length)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ComponentLimit,
                $"Data component id {index} exceeds the column capacity {_columns.Length}.");
        }

        if (_columns[index] is SceneComponentColumn<T> existing)
        {
            existing.EnsureCapacity(entityCapacity);
            return existing;
        }

        if (_columns[index] is not null)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"Data component id {index} is already bound to a different payload type.");
        }

        var column = new SceneComponentColumn<T>(descriptor.TypeId, entityCapacity);
        _columns[index] = column;
        _active.Add(column);
        return column;
    }

    /// <summary>Gets the materialized column for <typeparamref name="T"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SceneComponentColumn<T> Get<T>(SceneComponentTypeId typeId)
        where T : unmanaged, ISceneDataComponent
    {
        uint index = typeId.Value;
        if (index >= (uint)_columns.Length || _columns[index] is not SceneComponentColumn<T> column)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                $"No materialized column exists for data component id {index}.");
        }

        return column;
    }

    /// <summary>Grows every materialized column to the entity capacity.</summary>
    public void EnsureCapacity(int required)
    {
        for (int i = 0; i < _active.Count; i++)
        {
            _active[i].EnsureCapacity(required);
        }
    }

    /// <summary>Clears every component stored on one entity slot.</summary>
    public void ClearSlot(int slot)
    {
        for (int i = 0; i < _active.Count; i++)
        {
            _active[i].ClearSlot(slot);
        }
    }

    /// <summary>Clears every component column.</summary>
    public void ClearAll()
    {
        for (int i = 0; i < _active.Count; i++)
        {
            _active[i].ClearAll();
        }
    }
}
