namespace Axrone.Ui;

/// <summary>
/// Mutable retained document builder. Nodes live in generation-checked slots;
/// removed subtrees free their slots for reuse with a bumped generation, so an
/// old <see cref="UiNodeId"/> can never address the recycled occupant.
/// </summary>
/// <remarks>
/// The builder is single-threaded. <see cref="Build"/> snapshots the live tree
/// into pinned immutable arrays; the resulting document never observes later
/// builder mutations.
/// </remarks>
public sealed class UiDocumentBuilder : IUiDocumentBuilder
{
    private const int InitialCapacity = 16;

    private int[] _parent;
    private int[] _firstChild;
    private int[] _lastChild;
    private int[] _nextSibling;
    private int[] _prevSibling;
    private uint[] _generation;
    private UiNodeKind[] _kind;
    private UiNodeFlags[] _flags;
    private bool[] _alive;
    private int[] _freeSlots;
    private int[] _removalStack;
    private int _slotCount;
    private int _freeCount;
    private int _nodeCount;

    /// <summary>Creates an empty builder.</summary>
    public UiDocumentBuilder()
    {
        _parent = new int[InitialCapacity];
        _firstChild = new int[InitialCapacity];
        _lastChild = new int[InitialCapacity];
        _nextSibling = new int[InitialCapacity];
        _prevSibling = new int[InitialCapacity];
        _generation = new uint[InitialCapacity];
        _kind = new UiNodeKind[InitialCapacity];
        _flags = new UiNodeFlags[InitialCapacity];
        _alive = new bool[InitialCapacity];
        _freeSlots = new int[InitialCapacity];
        _removalStack = new int[InitialCapacity];
        Fill(_parent, -1);
        Fill(_firstChild, -1);
        Fill(_lastChild, -1);
        Fill(_nextSibling, -1);
        Fill(_prevSibling, -1);
    }

    /// <summary>Gets the number of live nodes.</summary>
    public int LiveNodeCount => _nodeCount;

    /// <inheritdoc/>
    public UiNodeId CreateNode(UiNodeKind kind, UiNodeFlags flags)
    {
        int slot;
        if (_freeCount > 0)
        {
            slot = _freeSlots[--_freeCount];
        }
        else
        {
            if (_slotCount == _parent.Length)
            {
                Grow(_parent.Length * 2);
            }

            slot = _slotCount++;
            _generation[slot] = 0;
        }

        _alive[slot] = true;
        _parent[slot] = -1;
        _firstChild[slot] = -1;
        _lastChild[slot] = -1;
        _nextSibling[slot] = -1;
        _prevSibling[slot] = -1;
        _kind[slot] = kind;
        _flags[slot] = flags;
        _nodeCount++;
        return UiNodeIdCodec.Create(slot, _generation[slot]);
    }

    /// <inheritdoc/>
    public bool TryAppendChild(UiNodeId parent, UiNodeId child)
    {
        if (!TryResolve(parent, out int parentSlot) || !TryResolve(child, out int childSlot))
        {
            return false;
        }

        if (parentSlot == childSlot || _parent[childSlot] != -1)
        {
            return false;
        }

        // Walk the prospective parent chain: appending under one of its own
        // descendants would make the tree cyclic.
        int cursor = parentSlot;
        while (cursor != -1)
        {
            if (cursor == childSlot)
            {
                return false;
            }

            cursor = _parent[cursor];
        }

        int previousLast = _lastChild[parentSlot];
        _parent[childSlot] = parentSlot;
        _prevSibling[childSlot] = previousLast;
        _nextSibling[childSlot] = -1;

        if (previousLast == -1)
        {
            _firstChild[parentSlot] = childSlot;
        }
        else
        {
            _nextSibling[previousLast] = childSlot;
        }

        _lastChild[parentSlot] = childSlot;
        return true;
    }

    /// <inheritdoc/>
    public bool TryRemoveNode(UiNodeId node)
    {
        if (!TryResolve(node, out int slot))
        {
            return false;
        }

        UnlinkFromParent(slot);

        // Depth-first subtree release without recursion. Nodes are pushed and
        // then freed after their children are queued, so the stack never
        // exceeds the number of live nodes.
        int stackCount = 0;
        Push(ref stackCount, slot);
        while (stackCount > 0)
        {
            int current = _removalStack[--stackCount];

            int child = _firstChild[current];
            while (child != -1)
            {
                int next = _nextSibling[child];
                Push(ref stackCount, child);
                child = next;
            }

            _alive[current] = false;
            _parent[current] = -1;
            _firstChild[current] = -1;
            _lastChild[current] = -1;
            _nextSibling[current] = -1;
            _prevSibling[current] = -1;
            _kind[current] = default;
            _flags[current] = default;
            _nodeCount--;

            // A slot that exhausts its generation budget retires permanently;
            // reusing it would make stale handles alias a new generation.
            uint generation = _generation[current] + 1;
            _generation[current] = generation;
            if (generation <= UiNodeIdCodec.MaxGeneration)
            {
                if (_freeCount == _freeSlots.Length)
                {
                    Array.Resize(ref _freeSlots, _freeSlots.Length * 2);
                }

                _freeSlots[_freeCount++] = current;
            }
        }

        return true;
    }

    /// <inheritdoc/>
    public IUiDocument Build(in UiDocumentInfo info)
    {
        if (_nodeCount == 0)
        {
            UiThrowHelper.ThrowInvalidOperation("A UI document requires at least one root node.");
        }

        int rootSlot = -1;
        for (int slot = 0; slot < _slotCount; slot++)
        {
            if (!_alive[slot] || _parent[slot] != -1)
            {
                continue;
            }

            if (rootSlot != -1)
            {
                UiThrowHelper.ThrowInvalidOperation("A UI document must have exactly one root node.");
            }

            rootSlot = slot;
        }

        if (rootSlot == -1)
        {
            UiThrowHelper.ThrowInvalidOperation("A UI document must have exactly one root node.");
        }

        int totalChildren = 0;
        for (int slot = 0; slot < _slotCount; slot++)
        {
            if (!_alive[slot])
            {
                continue;
            }

            int child = _firstChild[slot];
            while (child != -1)
            {
                totalChildren++;
                child = _nextSibling[child];
            }
        }

        UiNodeRecord[] records = GC.AllocateArray<UiNodeRecord>(_slotCount, pinned: true);
        int[] childStart = GC.AllocateArray<int>(_slotCount, pinned: true);
        int[] childCount = GC.AllocateArray<int>(_slotCount, pinned: true);
        UiNodeId[] children = GC.AllocateArray<UiNodeId>(totalChildren, pinned: true);

        int childCursor = 0;
        for (int slot = 0; slot < _slotCount; slot++)
        {
            childStart[slot] = -1;
            if (!_alive[slot])
            {
                continue;
            }

            UiNodeId id = UiNodeIdCodec.Create(slot, _generation[slot]);
            int firstChild = _firstChild[slot];
            int nextSibling = _nextSibling[slot];
            UiNodeId parentId = _parent[slot] == -1
                ? UiNodeId.Invalid
                : UiNodeIdCodec.Create(_parent[slot], _generation[_parent[slot]]);
            UiNodeId firstChildId = firstChild == -1
                ? UiNodeId.Invalid
                : UiNodeIdCodec.Create(firstChild, _generation[firstChild]);
            UiNodeId nextSiblingId = nextSibling == -1
                ? UiNodeId.Invalid
                : UiNodeIdCodec.Create(nextSibling, _generation[nextSibling]);

            records[slot] = new UiNodeRecord(id, parentId, firstChildId, nextSiblingId, _kind[slot], _flags[slot]);
            childStart[slot] = childCursor;
            childCount[slot] = 0;

            int child = firstChild;
            while (child != -1)
            {
                children[childCursor++] = UiNodeIdCodec.Create(child, _generation[child]);
                childCount[slot]++;
                child = _nextSibling[child];
            }
        }

        UiNodeId root = UiNodeIdCodec.Create(rootSlot, _generation[rootSlot]);
        return new UiDocument(info, records, childStart, childCount, children, root, _nodeCount);
    }

    private bool TryResolve(UiNodeId id, out int slot)
    {
        slot = UiNodeIdCodec.GetIndex(id);
        return id.IsValid &&
            (uint)slot < (uint)_slotCount &&
            _alive[slot] &&
            _generation[slot] == UiNodeIdCodec.GetGeneration(id);
    }

    private void UnlinkFromParent(int slot)
    {
        int parent = _parent[slot];
        if (parent == -1)
        {
            return;
        }

        int previous = _prevSibling[slot];
        int next = _nextSibling[slot];

        if (previous == -1)
        {
            _firstChild[parent] = next;
        }
        else
        {
            _nextSibling[previous] = next;
        }

        if (next == -1)
        {
            _lastChild[parent] = previous;
        }
        else
        {
            _prevSibling[next] = previous;
        }
    }

    private void Push(ref int stackCount, int slot)
    {
        if (stackCount == _removalStack.Length)
        {
            Array.Resize(ref _removalStack, _removalStack.Length * 2);
        }

        _removalStack[stackCount++] = slot;
    }

    private void Grow(int capacity)
    {
        Array.Resize(ref _parent, capacity);
        Array.Resize(ref _firstChild, capacity);
        Array.Resize(ref _lastChild, capacity);
        Array.Resize(ref _nextSibling, capacity);
        Array.Resize(ref _prevSibling, capacity);
        Array.Resize(ref _generation, capacity);
        Array.Resize(ref _kind, capacity);
        Array.Resize(ref _flags, capacity);
        Array.Resize(ref _alive, capacity);

        // New slots must start unlinked; -1 is the null slot sentinel.
        _parent.AsSpan(_slotCount).Fill(-1);
        _firstChild.AsSpan(_slotCount).Fill(-1);
        _lastChild.AsSpan(_slotCount).Fill(-1);
        _nextSibling.AsSpan(_slotCount).Fill(-1);
        _prevSibling.AsSpan(_slotCount).Fill(-1);
    }

    private static void Fill(int[] values, int value)
    {
        for (int i = 0; i < values.Length; i++)
        {
            values[i] = value;
        }
    }
}
