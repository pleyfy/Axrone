namespace Axrone.Ui;

/// <summary>
/// Drives partial relayout from dirty state. Only subtrees whose root is
/// layout-dirty are measured and arranged; when a dirty subtree changes size,
/// its parent is escalated and re-arranged so sibling flow stays correct.
/// </summary>
/// <remarks>
/// Boxes are recorded per node so a later dirty subtree can be re-arranged in
/// place. Work buffers, the bounds table and the engine caches are reused, so a
/// steady-state frame with no invalidation performs no allocation.
/// </remarks>
public sealed class UiLayoutRunner : IUiInvalidationSink
{
    private readonly IUiNodeTree _nodes;
    private readonly IUiLayoutTree _layoutTree;
    private readonly IUiLayoutEngine _engine;
    private readonly IUiLayoutSink _sink;
    private readonly UiDirtyTracker _dirty;
    private readonly Dictionary<UiNodeId, Rect> _bounds = new();
    private readonly SinkRelay _relay;
    private UiNodeId[] _work = new UiNodeId[16];
    private UiNodeId[] _next = new UiNodeId[16];
    private int _workCount;
    private int _nextCount;

    /// <summary>Creates a runner.</summary>
    /// <param name="nodes">Document node tree used for ancestor lookup.</param>
    /// <param name="layoutTree">Layout tree view passed to the engine.</param>
    /// <param name="engine">Layout engine.</param>
    /// <param name="sink">Consumer of arranged boxes.</param>
    /// <param name="dirty">Optional shared dirty tracker.</param>
    public UiLayoutRunner(
        IUiNodeTree nodes,
        IUiLayoutTree layoutTree,
        IUiLayoutEngine engine,
        IUiLayoutSink sink,
        UiDirtyTracker? dirty = null)
    {
        ArgumentNullException.ThrowIfNull(nodes);
        ArgumentNullException.ThrowIfNull(layoutTree);
        ArgumentNullException.ThrowIfNull(engine);
        ArgumentNullException.ThrowIfNull(sink);
        _nodes = nodes;
        _layoutTree = layoutTree;
        _engine = engine;
        _sink = sink;
        _dirty = dirty ?? new UiDirtyTracker();
        _relay = new SinkRelay(this);
    }

    /// <summary>Gets the dirty-state view shared with the rest of the UI runtime.</summary>
    public IUiDirtyState Dirty => _dirty;

    /// <summary>Gets the last arranged bounds of a node.</summary>
    public bool TryGetBounds(UiNodeId node, out Rect bounds) => _bounds.TryGetValue(node, out bounds);

    /// <inheritdoc/>
    public void Invalidate(in UiInvalidation invalidation)
    {
        if ((invalidation.Flags & UiInvalidationFlags.Structure) != 0)
        {
            _dirty.InvalidateSubtree(
                _nodes,
                invalidation.Node,
                invalidation.Flags | UiInvalidationFlags.Layout | UiInvalidationFlags.Render);
            return;
        }

        _dirty.Invalidate(in invalidation);
    }

    /// <summary>
    /// Lays out every dirty subtree for the given viewport and returns the
    /// number of roots that were measured and arranged.
    /// </summary>
    public int Run(in UiViewport viewport)
    {
        UiNodeId root = _nodes.Root;
        if (!root.IsValid)
        {
            return 0;
        }

        if (_bounds.Count == 0)
        {
            _dirty.Invalidate(new UiInvalidation(root, UiInvalidationFlags.Layout));
        }

        CollectDirtyRoots();
        if (_workCount == 0)
        {
            return 0;
        }

        Rect rootBounds = new(0.0f, 0.0f, viewport.Width, viewport.Height);
        int processed = 0;
        int iterations = 0;
        while (_workCount > 0 && iterations++ < 16)
        {
            _nextCount = 0;
            for (int i = 0; i < _workCount; i++)
            {
                UiNodeId id = _work[i];
                if (!_dirty.IsDirty(id, UiInvalidationFlags.Layout))
                {
                    continue;
                }

                _dirty.ClearLayout(id);
                Rect bounds = _bounds.TryGetValue(id, out Rect cached) ? cached : rootBounds;

                // Probe the natural size first: measuring against the old bounds
                // would clamp growth away and hide the change from its parent.
                if (id != root)
                {
                    UiMeasureResult probe = _engine.Measure(_layoutTree, id, UiMeasureConstraints.Unbounded);
                    bool sizeChanged =
                        probe.Size.Width != bounds.Width ||
                        probe.Size.Height != bounds.Height;
                    if (sizeChanged && _nodes.TryGetNode(id, out UiNodeRecord record) && record.Parent.IsValid)
                    {
                        QueueParent(in record);
                        continue;
                    }

                    // Unchanged: the probe already filled the measure cache, so
                    // arranging reuses it instead of measuring the subtree twice.
                    _engine.Arrange(_layoutTree, id, in bounds, _relay);
                    processed++;
                    continue;
                }

                _engine.Measure(
                    _layoutTree,
                    id,
                    new UiMeasureConstraints(0.0f, 0.0f, bounds.Width, bounds.Height));
                _engine.Arrange(_layoutTree, id, in bounds, _relay);
                processed++;
            }

            (_work, _next) = (_next, _work);
            _workCount = _nextCount;
        }

        return processed;
    }

    private void QueueParent(in UiNodeRecord record)
    {
        UiNodeId parent = record.Parent;
        bool alreadyQueued = _dirty.IsDirty(parent, UiInvalidationFlags.Layout) || Contains(_next, _nextCount, parent);
        if (alreadyQueued)
        {
            return;
        }

        _dirty.Invalidate(new UiInvalidation(parent, UiInvalidationFlags.Layout));
        EnsureNextCapacity(_nextCount + 1);
        _next[_nextCount++] = parent;
    }

    private void CollectDirtyRoots()
    {
        int count = _dirty.LayoutDirtyNodeCount;
        if (count == 0)
        {
            _workCount = 0;
            return;
        }

        if (_work.Length < count)
        {
            _work = new UiNodeId[count];
        }

        int written = _dirty.CopyLayoutDirtyNodes(_work.AsSpan(0, count));
        _work.AsSpan(0, written).Sort(static (left, right) => left.Value.CompareTo(right.Value));

        // Keep only top-most dirty nodes: an ancestor already covers its
        // descendants, so laying a child twice would be wasted work.
        int kept = 0;
        for (int i = 0; i < written; i++)
        {
            UiNodeId candidate = _work[i];
            if (HasDirtyAncestor(candidate))
            {
                continue;
            }

            _work[kept++] = candidate;
        }

        _workCount = kept;
    }

    private bool HasDirtyAncestor(UiNodeId node)
    {
        UiNodeId cursor = node;
        while (_nodes.TryGetNode(cursor, out UiNodeRecord record) && record.Parent.IsValid)
        {
            cursor = record.Parent;
            if (_dirty.IsDirty(cursor, UiInvalidationFlags.Layout))
            {
                return true;
            }
        }

        return false;
    }

    private static bool Contains(UiNodeId[] ids, int count, UiNodeId node)
    {
        for (int i = 0; i < count; i++)
        {
            if (ids[i] == node)
            {
                return true;
            }
        }

        return false;
    }

    private void EnsureNextCapacity(int needed)
    {
        if (needed > _next.Length)
        {
            Array.Resize(ref _next, Math.Max(needed, _next.Length * 2));
        }
    }

    private sealed class SinkRelay : IUiLayoutSink
    {
        private readonly UiLayoutRunner _owner;

        public SinkRelay(UiLayoutRunner owner) => _owner = owner;

        public void SetBox(UiNodeId node, in Rect bounds, in Rect content)
        {
            _owner._bounds[node] = bounds;
            _owner._sink.SetBox(node, in bounds, in content);
        }
    }
}
