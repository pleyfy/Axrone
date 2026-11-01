namespace Axrone.Ui.Controls;

using System.Runtime.InteropServices;
using Axrone.Ui;

/// <summary>Role of a node inside its owning control.</summary>
internal enum ControlPart : byte
{
    /// <summary>The control's own node.</summary>
    Primary = 0,

    /// <summary>One radio option row.</summary>
    Option = 1,
}

/// <summary>Owner of a node: control slot plus its part role.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct ControlNodeBinding(int Control, ControlPart Part, int Option);

/// <summary>Packs a slot index and a generation into one node identity.</summary>
internal static class ControlNodeIdCodec
{
    private const int IndexBits = 20;
    private const uint IndexMask = (1u << IndexBits) - 1;

    internal const uint MaxGeneration = 0xFFF;

    internal static UiNodeId Create(int index, uint generation) =>
        new(((generation & MaxGeneration) << IndexBits) | (uint)(index + 1));

    internal static int GetIndex(UiNodeId id) => (int)((id.Value & IndexMask) - 1);

    internal static uint GetGeneration(UiNodeId id) => id.Value >> IndexBits;
}

/// <summary>
/// Mutable retained node tree owned by the control runtime. Nodes live in
/// generation-checked slots with linked sibling order and a per-slot control
/// binding; <see cref="IUiNodeTree.GetChildren"/> is a span over the slot's
/// child list, so layout passes do not allocate.
/// </summary>
internal sealed class ControlNodeTree : IUiNodeTree
{
    private const int InitialCapacity = 16;
    private const int MaxDepth = 512;

    private int[] _parent;
    private int[] _firstChild;
    private int[] _lastChild;
    private int[] _nextSibling;
    private int[] _prevSibling;
    private List<UiNodeId>?[] _children;
    private UiNodeKind[] _kind;
    private UiNodeFlags[] _flags;
    private ControlNodeBinding[] _binding;
    private bool[] _alive;
    private uint[] _generation;
    private int[] _freeSlots;
    private int[] _removalStack;
    private int _slotCount;
    private int _freeCount;
    private int _nodeCount;

    public ControlNodeTree()
    {
        _parent = new int[InitialCapacity];
        _firstChild = new int[InitialCapacity];
        _lastChild = new int[InitialCapacity];
        _nextSibling = new int[InitialCapacity];
        _prevSibling = new int[InitialCapacity];
        _children = new List<UiNodeId>?[InitialCapacity];
        _kind = new UiNodeKind[InitialCapacity];
        _flags = new UiNodeFlags[InitialCapacity];
        _binding = new ControlNodeBinding[InitialCapacity];
        _alive = new bool[InitialCapacity];
        _generation = new uint[InitialCapacity];
        _freeSlots = new int[InitialCapacity];
        _removalStack = new int[InitialCapacity];
        _parent.AsSpan().Fill(-1);
        _firstChild.AsSpan().Fill(-1);
        _lastChild.AsSpan().Fill(-1);
        _nextSibling.AsSpan().Fill(-1);
        _prevSibling.AsSpan().Fill(-1);

        Root = CreateNode(UiNodeKind.Root, UiNodeFlags.Visible | UiNodeFlags.Enabled, new ControlNodeBinding(-1, ControlPart.Primary, 0));
    }

    public int Count => _nodeCount;

    public UiNodeId Root { get; }

    public bool TryGetNode(UiNodeId id, out UiNodeRecord record)
    {
        if (!TryResolve(id, out int slot))
        {
            record = default;
            return false;
        }

        record = new UiNodeRecord(
            id,
            IdOf(_parent[slot]),
            IdOf(_firstChild[slot]),
            IdOf(_nextSibling[slot]),
            _kind[slot],
            _flags[slot]);
        return true;
    }

    public ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id)
    {
        if (!TryResolve(id, out int slot) || _children[slot] is not List<UiNodeId> list)
        {
            return ReadOnlySpan<UiNodeId>.Empty;
        }

        return CollectionsMarshal.AsSpan(list);
    }

    internal UiNodeId CreateNode(UiNodeKind kind, UiNodeFlags flags, in ControlNodeBinding binding)
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
        _children[slot]?.Clear();
        _kind[slot] = kind;
        _flags[slot] = flags;
        _binding[slot] = binding;
        _nodeCount++;
        return ControlNodeIdCodec.Create(slot, _generation[slot]);
    }

    internal bool AppendChild(UiNodeId parent, UiNodeId child)
    {
        if (!TryResolve(parent, out int parentSlot) || !TryResolve(child, out int childSlot))
        {
            return false;
        }

        if (parentSlot == childSlot || _parent[childSlot] >= 0)
        {
            return false;
        }

        int cursor = parentSlot;
        for (int depth = 0; cursor >= 0 && depth < MaxDepth; depth++)
        {
            if (cursor == childSlot)
            {
                return false;
            }

            cursor = _parent[cursor];
        }

        List<UiNodeId> list = _children[parentSlot] ??= [];
        int previousLast = _lastChild[parentSlot];
        list.Add(child);
        _parent[childSlot] = parentSlot;
        _prevSibling[childSlot] = previousLast;
        _nextSibling[childSlot] = -1;
        if (previousLast < 0)
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

    internal bool RemoveNode(UiNodeId node)
    {
        if (!TryResolve(node, out int slot))
        {
            return false;
        }

        Detach(slot);

        int stackCount = 0;
        Push(ref stackCount, slot);
        while (stackCount > 0)
        {
            int current = _removalStack[--stackCount];
            if (_children[current] is List<UiNodeId> children)
            {
                for (int i = 0; i < children.Count; i++)
                {
                    if (TryResolve(children[i], out int childSlot))
                    {
                        Push(ref stackCount, childSlot);
                    }
                }

                children.Clear();
            }

            _alive[current] = false;
            _parent[current] = -1;
            _firstChild[current] = -1;
            _lastChild[current] = -1;
            _nextSibling[current] = -1;
            _prevSibling[current] = -1;
            _kind[current] = default;
            _flags[current] = default;
            _binding[current] = default;
            _nodeCount--;

            uint generation = _generation[current] + 1;
            _generation[current] = generation;
            if (generation <= ControlNodeIdCodec.MaxGeneration)
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

    internal void SetFlags(UiNodeId node, UiNodeFlags flags)
    {
        if (TryResolve(node, out int slot))
        {
            _flags[slot] = flags;
        }
    }

    internal UiNodeFlags GetFlags(UiNodeId node) =>
        TryResolve(node, out int slot) ? _flags[slot] : UiNodeFlags.None;

    internal bool TryGetBinding(UiNodeId node, out ControlNodeBinding binding)
    {
        if (TryResolve(node, out int slot))
        {
            binding = _binding[slot];
            return true;
        }

        binding = default;
        return false;
    }

    internal bool TryGetParent(UiNodeId node, out UiNodeId parent)
    {
        if (TryResolve(node, out int slot) && _parent[slot] >= 0)
        {
            parent = IdOf(_parent[slot]);
            return true;
        }

        parent = UiNodeId.Invalid;
        return false;
    }

    private void Detach(int slot)
    {
        int parent = _parent[slot];
        if (parent < 0)
        {
            return;
        }

        if (_children[parent] is List<UiNodeId> list)
        {
            list.Remove(ItemOf(slot));
            Relink(parent);
        }

        _parent[slot] = -1;
        _prevSibling[slot] = -1;
        _nextSibling[slot] = -1;
    }

    private void Relink(int parent)
    {
        _firstChild[parent] = -1;
        _lastChild[parent] = -1;
        if (_children[parent] is not List<UiNodeId> list)
        {
            return;
        }

        int previous = -1;
        for (int i = 0; i < list.Count; i++)
        {
            int childSlot = ControlNodeIdCodec.GetIndex(list[i]);
            _prevSibling[childSlot] = previous;
            _nextSibling[childSlot] = -1;
            if (previous < 0)
            {
                _firstChild[parent] = childSlot;
            }
            else
            {
                _nextSibling[previous] = childSlot;
            }

            previous = childSlot;
        }

        _lastChild[parent] = previous;
    }

    private bool TryResolve(UiNodeId id, out int slot)
    {
        slot = ControlNodeIdCodec.GetIndex(id);
        return id.IsValid &&
            (uint)slot < (uint)_slotCount &&
            _alive[slot] &&
            _generation[slot] == ControlNodeIdCodec.GetGeneration(id);
    }

    private UiNodeId IdOf(int slot) =>
        slot < 0 ? UiNodeId.Invalid : ControlNodeIdCodec.Create(slot, _generation[slot]);

    private UiNodeId ItemOf(int slot) => ControlNodeIdCodec.Create(slot, _generation[slot]);

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
        Array.Resize(ref _children, capacity);
        Array.Resize(ref _kind, capacity);
        Array.Resize(ref _flags, capacity);
        Array.Resize(ref _binding, capacity);
        Array.Resize(ref _alive, capacity);
        Array.Resize(ref _generation, capacity);
        _parent.AsSpan(_slotCount).Fill(-1);
        _firstChild.AsSpan(_slotCount).Fill(-1);
        _lastChild.AsSpan(_slotCount).Fill(-1);
        _nextSibling.AsSpan(_slotCount).Fill(-1);
        _prevSibling.AsSpan(_slotCount).Fill(-1);
    }
}
