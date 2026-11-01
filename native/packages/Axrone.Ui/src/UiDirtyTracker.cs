namespace Axrone.Ui;

/// <summary>
/// Per-node invalidation tracker. It is both the sink that content/style/input
/// layers write into and the dirty-state view frame orchestration reads from.
/// </summary>
/// <remarks>
/// Flags are OR-ed per node; layout/structure counters are maintained
/// incrementally so <see cref="LayoutDirty"/> and <see cref="StructureDirty"/>
/// are O(1). Single-threaded.
/// </remarks>
public sealed class UiDirtyTracker : IUiInvalidationSink, IUiDirtyState
{
    private readonly Dictionary<UiNodeId, UiInvalidationFlags> _flags = new();
    private UiNodeId[] _stack = new UiNodeId[16];
    private int _layoutCount;
    private int _structureCount;

    /// <inheritdoc/>
    public bool LayoutDirty => _layoutCount > 0;

    /// <inheritdoc/>
    public bool StructureDirty => _structureCount > 0;

    /// <inheritdoc/>
    public int DirtyNodeCount => _flags.Count;

    /// <summary>Gets the number of nodes dirty for the layout channel.</summary>
    public int LayoutDirtyNodeCount => _layoutCount;

    /// <inheritdoc/>
    public void Invalidate(in UiInvalidation invalidation)
    {
        if (!invalidation.Node.IsValid || invalidation.Flags == UiInvalidationFlags.None)
        {
            return;
        }

        _flags.TryGetValue(invalidation.Node, out UiInvalidationFlags existing);
        UiInvalidationFlags updated = existing | invalidation.Flags;
        _flags[invalidation.Node] = updated;
        AdjustCounters(existing, updated);
    }

    /// <summary>
    /// Marks a node and every descendant dirty for the given channels, using the
    /// supplied tree to walk children. Used for structural changes.
    /// </summary>
    public void InvalidateSubtree(IUiNodeTree tree, UiNodeId node, UiInvalidationFlags flags)
    {
        ArgumentNullException.ThrowIfNull(tree);
        if (!node.IsValid || flags == UiInvalidationFlags.None)
        {
            return;
        }

        int stackCount = 0;
        Push(ref stackCount, node);
        while (stackCount > 0)
        {
            UiNodeId current = _stack[--stackCount];
            Invalidate(new UiInvalidation(current, flags));

            ReadOnlySpan<UiNodeId> children = tree.GetChildren(current);
            for (int i = 0; i < children.Length; i++)
            {
                Push(ref stackCount, children[i]);
            }
        }
    }

    /// <summary>Gets the accumulated flags of one node; <see cref="UiInvalidationFlags.None"/> when clean.</summary>
    public UiInvalidationFlags GetFlags(UiNodeId node) =>
        _flags.TryGetValue(node, out UiInvalidationFlags flags) ? flags : UiInvalidationFlags.None;

    /// <inheritdoc/>
    public bool IsDirty(UiNodeId node, UiInvalidationFlags flags) =>
        _flags.TryGetValue(node, out UiInvalidationFlags existing) && (existing & flags) != 0;

    /// <summary>Clears the layout bit of one node, keeping its other channels.</summary>
    public void ClearLayout(UiNodeId node) => ClearChannel(node, UiInvalidationFlags.Layout);

    /// <summary>Clears the structure bit of one node, keeping its other channels.</summary>
    public void ClearStructure(UiNodeId node) => ClearChannel(node, UiInvalidationFlags.Structure);

    /// <summary>
    /// Copies the identifiers currently dirty for layout into a caller span.
    /// Returns the number written; the span must hold
    /// <see cref="LayoutDirtyNodeCount"/> entries.
    /// </summary>
    public int CopyLayoutDirtyNodes(Span<UiNodeId> destination)
    {
        int cursor = 0;
        foreach (KeyValuePair<UiNodeId, UiInvalidationFlags> entry in _flags)
        {
            if ((entry.Value & UiInvalidationFlags.Layout) != 0 && cursor < destination.Length)
            {
                destination[cursor++] = entry.Key;
            }
        }

        return cursor;
    }

    /// <inheritdoc/>
    public void Clear()
    {
        _flags.Clear();
        _layoutCount = 0;
        _structureCount = 0;
    }

    private void ClearChannel(UiNodeId node, UiInvalidationFlags channel)
    {
        if (!_flags.TryGetValue(node, out UiInvalidationFlags existing) || (existing & channel) == 0)
        {
            return;
        }

        UiInvalidationFlags updated = existing & ~channel;
        if (updated == UiInvalidationFlags.None)
        {
            _flags.Remove(node);
        }
        else
        {
            _flags[node] = updated;
        }

        AdjustCounters(existing, updated);
    }

    private void AdjustCounters(UiInvalidationFlags before, UiInvalidationFlags after)
    {
        bool layoutBefore = (before & UiInvalidationFlags.Layout) != 0;
        bool layoutAfter = (after & UiInvalidationFlags.Layout) != 0;
        if (layoutBefore != layoutAfter)
        {
            _layoutCount += layoutAfter ? 1 : -1;
        }

        bool structureBefore = (before & UiInvalidationFlags.Structure) != 0;
        bool structureAfter = (after & UiInvalidationFlags.Structure) != 0;
        if (structureBefore != structureAfter)
        {
            _structureCount += structureAfter ? 1 : -1;
        }
    }

    private void Push(ref int stackCount, UiNodeId node)
    {
        if (stackCount == _stack.Length)
        {
            Array.Resize(ref _stack, _stack.Length * 2);
        }

        _stack[stackCount++] = node;
    }
}
