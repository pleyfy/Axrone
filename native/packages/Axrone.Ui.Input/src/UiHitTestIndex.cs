namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>
/// Flat structure-of-arrays hit-test index. Nodes are scanned in a single linear pass;
/// the topmost candidate wins by <c>zIndex</c> first, then by insertion order. Ancestor
/// clipping is delegated to an optional <see cref="IUiClipResolver"/>; a node inserted
/// with <c>clips</c> reports its own box as the applied clip.
/// </summary>
/// <remarks>
/// Node identity maps to its slot through an open-addressing table, so insert, update and
/// remove are amortized O(1) and a full rebuild of <c>n</c> nodes is O(n). Structural
/// operations may grow the backing arrays; <see cref="TryHitTest(Vec2, out UiHitResult)"/>
/// only reads the slot arrays, never throws, and is allocation-free once capacity is warm.
/// </remarks>
public sealed class UiHitTestIndex : IUiHitTestIndex
{
    private const byte ClipsBit = 1;
    private const int Tombstone = -1;

    private readonly IUiClipResolver? _clipResolver;
    private UiNodeId[] _nodes;
    private Aabb2D[] _bounds;
    private int[] _zIndex;
    private uint[] _order;
    private byte[] _flags;
    private int[] _table;
    private int _tableMask;
    private int _tableUsed;
    private int _count;
    private uint _nextOrder;
    private long _probeCount;

    /// <summary>Creates an index with an initial capacity and an optional clip resolver.</summary>
    /// <param name="capacity">Initial slot count; must be positive.</param>
    /// <param name="clipResolver">Ancestor clip source, or <see langword="null"/> to skip clip exclusion.</param>
    public UiHitTestIndex(int capacity = 32, IUiClipResolver? clipResolver = null)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(capacity, 1);
        _clipResolver = clipResolver;
        _nodes = new UiNodeId[capacity];
        _bounds = new Aabb2D[capacity];
        _zIndex = new int[capacity];
        _order = new uint[capacity];
        _flags = new byte[capacity];
        _table = new int[TableSizeFor(capacity)];
        _tableMask = _table.Length - 1;
    }

    /// <inheritdoc/>
    public int Count => _count;

    /// <summary>Gets the cumulative number of hash probes performed by structural lookups.</summary>
    internal long ProbeCount => _probeCount;

    /// <inheritdoc/>
    public void Insert(UiNodeId node, in Aabb2D bounds, int zIndex, bool clips)
    {
        if (!node.IsValid)
        {
            return;
        }

        int slot = FindSlot(node, out _);
        if (slot >= 0)
        {
            _bounds[slot] = bounds;
            _zIndex[slot] = zIndex;
            _flags[slot] = clips ? ClipsBit : (byte)0;
            return;
        }

        EnsureCapacity(_count + 1);
        int index = _count;
        _nodes[index] = node;
        _bounds[index] = bounds;
        _zIndex[index] = zIndex;
        _order[index] = _nextOrder++;
        _flags[index] = clips ? ClipsBit : (byte)0;
        AddEntry(node, index);
        _count++;
    }

    /// <inheritdoc/>
    public bool Update(UiNodeId node, in Aabb2D bounds)
    {
        int slot = FindSlot(node, out _);
        if (slot < 0)
        {
            return false;
        }

        _bounds[slot] = bounds;
        return true;
    }

    /// <inheritdoc/>
    public bool Remove(UiNodeId node)
    {
        int slot = FindSlot(node, out int entry);
        if (slot < 0)
        {
            return false;
        }

        _table[entry] = Tombstone;
        int last = _count - 1;
        if (slot != last)
        {
            UiNodeId moved = _nodes[last];
            _nodes[slot] = moved;
            _bounds[slot] = _bounds[last];
            _zIndex[slot] = _zIndex[last];
            _order[slot] = _order[last];
            _flags[slot] = _flags[last];
            Repoint(moved, slot);
        }

        _nodes[last] = UiNodeId.Invalid;
        _count = last;
        return true;
    }

    /// <inheritdoc/>
    public void Clear()
    {
        _nodes.AsSpan(0, _count).Clear();
        Array.Clear(_table);
        _tableUsed = 0;
        _count = 0;
        _nextOrder = 0;
    }

    /// <inheritdoc/>
    public bool TryHitTest(Vec2 point, out UiHitResult result)
    {
        int best = -1;
        Aabb2D bestClip = default;
        bool bestHasClip = false;

        for (int i = 0; i < _count; i++)
        {
            if (!_bounds[i].Contains(point))
            {
                continue;
            }

            if (best >= 0 && !IsAbove(i, best))
            {
                continue;
            }

            bool hasClip = (_flags[i] & ClipsBit) != 0;
            Aabb2D clip = hasClip ? _bounds[i] : default;

            if (_clipResolver is not null)
            {
                if (_clipResolver.TryGetClip(_nodes[i], out Aabb2D ancestorClip))
                {
                    if (hasClip)
                    {
                        clip = Intersect(clip, ancestorClip);
                        if (IsEmpty(clip))
                        {
                            continue;
                        }
                    }
                    else
                    {
                        clip = ancestorClip;
                        hasClip = true;
                    }
                }

                if (hasClip && !clip.Contains(point))
                {
                    continue;
                }
            }

            best = i;
            bestClip = clip;
            bestHasClip = hasClip;
        }

        if (best < 0)
        {
            result = default;
            return false;
        }

        Aabb2D bounds = _bounds[best];
        var rect = new Rect(
            bestClip.Min.X,
            bestClip.Min.Y,
            bestClip.Max.X - bestClip.Min.X,
            bestClip.Max.Y - bestClip.Min.Y);
        result = new UiHitResult(
            _nodes[best],
            new Vec2(point.X - bounds.Min.X, point.Y - bounds.Min.Y),
            _zIndex[best],
            bestHasClip,
            rect);
        return true;
    }

    private bool IsAbove(int candidate, int current) =>
        _zIndex[candidate] > _zIndex[current] ||
        (_zIndex[candidate] == _zIndex[current] && _order[candidate] > _order[current]);

    private int FindSlot(UiNodeId node, out int entry)
    {
        int index = (int)(Hash(node) & (uint)_tableMask);
        while (true)
        {
            int current = _table[index];
            _probeCount++;
            if (current == 0)
            {
                entry = -1;
                return -1;
            }

            if (current > 0 && _nodes[current - 1] == node)
            {
                entry = index;
                return current - 1;
            }

            index = (index + 1) & _tableMask;
        }
    }

    private void AddEntry(UiNodeId node, int slot)
    {
        int index = (int)(Hash(node) & (uint)_tableMask);
        while (true)
        {
            int current = _table[index];
            if (current == 0)
            {
                _table[index] = slot + 1;
                _tableUsed++;
                return;
            }

            if (current == Tombstone)
            {
                _table[index] = slot + 1;
                return;
            }

            index = (index + 1) & _tableMask;
        }
    }

    private void Repoint(UiNodeId node, int slot)
    {
        int index = (int)(Hash(node) & (uint)_tableMask);
        while (true)
        {
            int current = _table[index];
            if (current == 0)
            {
                return;
            }

            if (current > 0 && _nodes[current - 1] == node)
            {
                _table[index] = slot + 1;
                return;
            }

            index = (index + 1) & _tableMask;
        }
    }

    private void EnsureCapacity(int minimum)
    {
        if (minimum > _nodes.Length)
        {
            int capacity = _nodes.Length;
            while (capacity < minimum)
            {
                capacity *= 2;
            }

            Array.Resize(ref _nodes, capacity);
            Array.Resize(ref _bounds, capacity);
            Array.Resize(ref _zIndex, capacity);
            Array.Resize(ref _order, capacity);
            Array.Resize(ref _flags, capacity);
        }

        if ((_tableUsed + 1) * 2 > _table.Length)
        {
            Rehash(_table.Length * 2);
        }
    }

    private void Rehash(int tableSize)
    {
        _table = new int[tableSize];
        _tableMask = tableSize - 1;
        _tableUsed = 0;
        for (int slot = 0; slot < _count; slot++)
        {
            AddEntry(_nodes[slot], slot);
        }
    }

    private static int TableSizeFor(int capacity)
    {
        int size = 16;
        int required = capacity * 2;
        while (size < required)
        {
            size *= 2;
        }

        return size;
    }

    private static uint Hash(UiNodeId node) => (node.Value * 2654435761u) >> 16;

    private static Aabb2D Intersect(in Aabb2D left, in Aabb2D right) =>
        new(Vec2.Max(left.Min, right.Min), Vec2.Min(left.Max, right.Max));

    private static bool IsEmpty(in Aabb2D box) =>
        box.Max.X < box.Min.X || box.Max.Y < box.Min.Y;
}
