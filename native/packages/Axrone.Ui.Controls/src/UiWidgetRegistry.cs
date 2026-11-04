namespace Axrone.Ui.Controls;

/// <summary>Stable identity of one registered widget; stale after removal.</summary>
/// <param name="Slot">Registry slot backing the widget.</param>
/// <param name="Generation">Change counter distinguishing reused slots.</param>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiWidgetHandle(int Slot, uint Generation)
{
    /// <summary>Gets the invalid handle.</summary>
    public static UiWidgetHandle Invalid => new(-1, 0u);

    /// <summary>Gets whether the handle names a registered slot.</summary>
    public bool IsValid => Slot >= 0;
}

/// <summary>
/// Open widget registry: third-party code adds <see cref="IUiWidgetBehavior"/>
/// instances by name and creates controls through the returned
/// <see cref="UiWidgetHandle"/> without extending <see cref="ControlKind"/>.
/// Dispatch is an array load plus virtual call, identical in cost to built-in
/// controls; no reflection is involved and registration never runs per frame.
/// </summary>
/// <remarks>
/// Single-threaded, like the runtimes that consume it. A registry may be shared
/// by several runtimes; runtimes resolve behaviors live, so widgets registered
/// after a runtime was created are usable immediately.
/// </remarks>
public sealed class UiWidgetRegistry
{
    private const int InitialCapacity = 8;

    private Entry[] _slots = new Entry[InitialCapacity];
    private int[] _free = new int[InitialCapacity];
    private Dictionary<string, int>? _index;
    private int _slotCount;
    private int _liveCount;
    private int _freeCount;
    private uint _nextGeneration = 1;

    /// <summary>Gets the number of registered widgets.</summary>
    public int Count => _liveCount;

    /// <summary>
    /// Registers a widget under a unique name. Mirrors the TypeScript
    /// <c>WidgetRegistry.register</c> contract: duplicate names throw.
    /// </summary>
    /// <param name="name">Widget type name; must be non-empty and unique.</param>
    /// <param name="behavior">Stateless behavior singleton for the widget.</param>
    /// <returns>Handle for <see cref="UiControlRuntime.CreateControl(UiWidgetHandle, in UiControlDefinition)"/>.</returns>
    /// <exception cref="ArgumentNullException"><paramref name="name"/> or <paramref name="behavior"/> is null.</exception>
    /// <exception cref="ArgumentException"><paramref name="name"/> is empty.</exception>
    /// <exception cref="InvalidOperationException">A widget with the same name is registered.</exception>
    public UiWidgetHandle Register(string name, IUiWidgetBehavior behavior)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(behavior);
        if (name.Length == 0)
        {
            throw new ArgumentException("Widget name must not be empty.", nameof(name));
        }

        _index ??= new Dictionary<string, int>(StringComparer.Ordinal);
        if (_index.ContainsKey(name))
        {
            ControlThrowHelper.ThrowDuplicateWidget(name);
        }

        int slot = TakeSlot();
        uint generation = _nextGeneration++;
        _slots[slot] = new Entry(behavior, new ExternalWidgetBehavior(behavior), name, generation);
        _index.Add(name, slot);
        _liveCount++;
        return new UiWidgetHandle(slot, generation);
    }

    /// <summary>
    /// Registers or replaces a widget under the same name. Mirrors the
    /// TypeScript <c>WidgetRegistry.replace</c> contract: controls created with
    /// an earlier handle for the same name keep working but stop dispatching
    /// (their generation is stale), while new controls use the new behavior.
    /// </summary>
    /// <param name="name">Widget type name.</param>
    /// <param name="behavior">Stateless behavior singleton for the widget.</param>
    /// <returns>Handle for the (possibly reused) slot.</returns>
    public UiWidgetHandle Replace(string name, IUiWidgetBehavior behavior)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(behavior);
        if (name.Length == 0)
        {
            throw new ArgumentException("Widget name must not be empty.", nameof(name));
        }

        _index ??= new Dictionary<string, int>(StringComparer.Ordinal);
        if (_index.TryGetValue(name, out int slot))
        {
            uint generation = _nextGeneration++;
            _slots[slot] = new Entry(behavior, new ExternalWidgetBehavior(behavior), name, generation);
            return new UiWidgetHandle(slot, generation);
        }

        return Register(name, behavior);
    }

    /// <summary>Resolves a registered widget by name.</summary>
    /// <param name="name">Widget type name; null or empty resolves to nothing.</param>
    /// <param name="handle">Handle of the registered widget, when found.</param>
    /// <returns>Whether the name is registered.</returns>
    public bool TryResolve(string? name, out UiWidgetHandle handle)
    {
        handle = UiWidgetHandle.Invalid;
        if (name is null || name.Length == 0 || _index is null)
        {
            return false;
        }

        if (_index.TryGetValue(name, out int slot))
        {
            handle = new UiWidgetHandle(slot, _slots[slot].Generation);
            return true;
        }

        return false;
    }

    /// <summary>Gets whether a name is registered.</summary>
    /// <param name="name">Widget type name.</param>
    /// <returns>Whether the registry contains the name.</returns>
    public bool Contains(string? name) => name is not null && _index?.ContainsKey(name) == true;

    /// <summary>Removes a widget; live handles become stale and dispatch to the inert behavior.</summary>
    /// <param name="name">Widget type name.</param>
    /// <returns>Whether the widget was registered and removed.</returns>
    public bool Remove(string? name)
    {
        if (name is null || _index is null || !_index.TryGetValue(name, out int slot))
        {
            return false;
        }

        _index.Remove(name);
        ReleaseSlot(slot);
        _liveCount--;
        return true;
    }

    /// <summary>Removes every widget; all live handles become stale.</summary>
    public void Clear()
    {
        for (int slot = 0; slot < _slotCount; slot++)
        {
            if (_slots[slot].Behavior is not null)
            {
                ReleaseSlot(slot);
            }
        }

        _index?.Clear();
        _liveCount = 0;
    }

    /// <summary>Gets the dispatch behavior behind a valid handle.</summary>
    internal bool TryGetHandle(UiWidgetHandle handle, out ControlBehavior dispatch)
    {
        if (handle.IsValid && (uint)handle.Slot < (uint)_slotCount)
        {
            ref readonly Entry entry = ref _slots[handle.Slot];
            if (entry.Behavior is not null && entry.Generation == handle.Generation)
            {
                dispatch = entry.Dispatch;
                return true;
            }
        }

        dispatch = InertWidgetBehavior.Instance;
        return false;
    }

    /// <summary>Resolves dispatch for a live entry; returns the inert behavior when the handle is stale.</summary>
    internal ControlBehavior ResolveForDispatch(int slot, uint generation)
    {
        if ((uint)slot < (uint)_slotCount)
        {
            ref readonly Entry entry = ref _slots[slot];
            if (entry.Behavior is not null && entry.Generation == generation)
            {
                return entry.Dispatch;
            }
        }

        return InertWidgetBehavior.Instance;
    }

    private int TakeSlot()
    {
        if (_freeCount > 0)
        {
            return _free[--_freeCount];
        }

        if (_slotCount == _slots.Length)
        {
            Array.Resize(ref _slots, _slots.Length * 2);
        }

        return _slotCount++;
    }

    private void ReleaseSlot(int slot)
    {
        _slots[slot] = default;
        if (_freeCount == _free.Length)
        {
            Array.Resize(ref _free, _free.Length * 2);
        }

        _free[_freeCount++] = slot;
    }

    private readonly record struct Entry(
        IUiWidgetBehavior? Behavior,
        ControlBehavior Dispatch,
        string? Name,
        uint Generation);
}
