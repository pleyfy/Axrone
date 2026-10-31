namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>Receives focus transitions produced by <see cref="UiFocusManager"/>.</summary>
public interface IUiFocusEventSink
{
    /// <summary>Called for the losing node and then the gaining node of one transition.</summary>
    void OnFocusChanged(in UiFocusChangeEvent args);
}

/// <summary>
/// Focus ownership, tab order and directional navigation over a node tree.
/// </summary>
/// <remarks>
/// Tab order is document pre-order over focusable, enabled and visible nodes. The
/// order buffer is rebuilt only when marked dirty, so steady-state navigation does not
/// allocate. Directional moves require an <see cref="IUiNodeBounds"/> source and score
/// candidates by distance in the requested half-plane; equal scores keep document order.
/// </remarks>
public sealed class UiFocusManager : IUiFocusManager
{
    private readonly IUiNodeTree _tree;
    private readonly IUiNodeBounds? _bounds;
    private readonly IUiFocusEventSink? _events;
    private readonly IUiInvalidationSink? _invalidations;

    private UiNodeId[] _order = new UiNodeId[16];
    private int _orderCount;
    private UiNodeId[] _walk = new UiNodeId[16];
    private int _walkCount;
    private UiNodeId[] _scoped = new UiNodeId[16];
    private int _scopedCount;
    private bool _orderDirty = true;
    private UiNodeId _focused = UiNodeId.Invalid;

    /// <summary>Creates a focus manager over a tree.</summary>
    public UiFocusManager(
        IUiNodeTree tree,
        IUiNodeBounds? bounds = null,
        IUiFocusEventSink? events = null,
        IUiInvalidationSink? invalidations = null)
    {
        ArgumentNullException.ThrowIfNull(tree);
        _tree = tree;
        _bounds = bounds;
        _events = events;
        _invalidations = invalidations;
    }

    /// <inheritdoc/>
    public UiNodeId Focused => _focused;

    /// <summary>Marks the tab order stale after a structural or flag change.</summary>
    public void MarkOrderDirty() => _orderDirty = true;

    /// <inheritdoc/>
    public bool TryFocus(UiNodeId node, UiFocusReason reason)
    {
        if (!node.IsValid || !UiTreeQuery.IsFocusable(_tree, node))
        {
            return false;
        }

        if (_focused == node)
        {
            return true;
        }

        UiNodeId previous = _focused;
        _focused = node;
        if (previous.IsValid)
        {
            Notify(previous, focused: false, reason);
            _invalidations?.Invalidate(new UiInvalidation(previous, UiInvalidationFlags.Focus));
        }

        Notify(node, focused: true, reason);
        _invalidations?.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Focus));
        return true;
    }

    /// <inheritdoc/>
    public void ClearFocus(UiFocusReason reason)
    {
        UiNodeId previous = _focused;
        if (!previous.IsValid)
        {
            return;
        }

        _focused = UiNodeId.Invalid;
        Notify(previous, focused: false, reason);
        _invalidations?.Invalidate(new UiInvalidation(previous, UiInvalidationFlags.Focus));
    }

    /// <summary>Clears focus when the focused node is no longer focusable or visible.</summary>
    public void ValidateFocus()
    {
        if (_focused.IsValid && !UiTreeQuery.IsFocusable(_tree, _focused))
        {
            ClearFocus(UiFocusReason.Window);
        }
    }

    /// <inheritdoc/>
    public bool TryMoveFocus(UiFocusMoveDirection direction)
    {
        if (direction is UiFocusMoveDirection.Forward or UiFocusMoveDirection.Backward)
        {
            return MoveLinear(direction);
        }

        return MoveDirectional(direction);
    }

    private bool MoveLinear(UiFocusMoveDirection direction)
    {
        UiNodeId scope = ResolveScope(_focused);
        CollectScoped(scope);
        if (_scopedCount == 0)
        {
            return false;
        }

        bool forward = direction == UiFocusMoveDirection.Forward;
        int current = IndexInScoped(_focused);
        int next;
        if (current < 0)
        {
            next = forward ? 0 : _scopedCount - 1;
        }
        else
        {
            next = forward ? current + 1 : current - 1;
            if ((uint)next >= (uint)_scopedCount)
            {
                if (!IsScopeBoundary(scope))
                {
                    return false;
                }

                next = forward ? 0 : _scopedCount - 1;
            }
        }

        return TryFocus(_scoped[next], UiFocusReason.Navigation);
    }

    private bool MoveDirectional(UiFocusMoveDirection direction)
    {
        if (_bounds is null)
        {
            return false;
        }

        UiNodeId scope = ResolveScope(_focused);
        CollectScoped(scope);
        if (_scopedCount == 0)
        {
            return false;
        }

        if (!_focused.IsValid)
        {
            return TryFocus(_scoped[0], UiFocusReason.Navigation);
        }

        if (!_bounds.TryGetBounds(_focused, out Aabb2D originBox))
        {
            return false;
        }

        Vec2 origin = originBox.Center;
        int best = -1;
        float bestPrimary = float.MaxValue;
        float bestSecondary = float.MaxValue;
        for (int i = 0; i < _scopedCount; i++)
        {
            UiNodeId candidate = _scoped[i];
            if (candidate == _focused || !_bounds.TryGetBounds(candidate, out Aabb2D box))
            {
                continue;
            }

            Vec2 center = box.Center;
            float deltaX = center.X - origin.X;
            float deltaY = center.Y - origin.Y;
            float primary = direction switch
            {
                UiFocusMoveDirection.Left => -deltaX,
                UiFocusMoveDirection.Right => deltaX,
                UiFocusMoveDirection.Up => -deltaY,
                _ => deltaY,
            };
            if (primary <= 0.0f)
            {
                continue;
            }

            float secondary = direction is UiFocusMoveDirection.Left or UiFocusMoveDirection.Right
                ? MathF.Abs(deltaY)
                : MathF.Abs(deltaX);
            if (primary > bestPrimary || (primary == bestPrimary && secondary >= bestSecondary))
            {
                continue;
            }

            best = i;
            bestPrimary = primary;
            bestSecondary = secondary;
        }

        return best >= 0 && TryFocus(_scoped[best], UiFocusReason.Navigation);
    }

    private void CollectScoped(UiNodeId scope)
    {
        EnsureOrder();
        _scopedCount = 0;
        for (int i = 0; i < _orderCount; i++)
        {
            UiNodeId candidate = _order[i];
            if (scope == _tree.Root || IsWithin(candidate, scope))
            {
                AppendScoped(candidate);
            }
        }
    }

    private int IndexInScoped(UiNodeId node)
    {
        for (int i = 0; i < _scopedCount; i++)
        {
            if (_scoped[i] == node)
            {
                return i;
            }
        }

        return -1;
    }

    private UiNodeId ResolveScope(UiNodeId node)
    {
        UiNodeId current = node;
        while (current.IsValid && _tree.TryGetNode(current, out UiNodeRecord record))
        {
            if ((record.Flags & UiNodeFlags.FocusScope) != 0)
            {
                return current;
            }

            current = record.Parent;
        }

        return _tree.Root;
    }

    private bool IsScopeBoundary(UiNodeId scope) =>
        scope.IsValid &&
        scope != _tree.Root &&
        _tree.TryGetNode(scope, out UiNodeRecord record) &&
        (record.Flags & UiNodeFlags.FocusScope) != 0;

    private bool IsWithin(UiNodeId node, UiNodeId scope)
    {
        UiNodeId current = node;
        while (current.IsValid && _tree.TryGetNode(current, out UiNodeRecord record))
        {
            if (current == scope)
            {
                return true;
            }

            current = record.Parent;
        }

        return false;
    }

    private void EnsureOrder()
    {
        if (!_orderDirty)
        {
            return;
        }

        _orderCount = 0;
        _walkCount = 0;
        Push(_tree.Root);
        while (_walkCount > 0)
        {
            UiNodeId node = _walk[--_walkCount];
            if (!_tree.TryGetNode(node, out UiNodeRecord record) || (record.Flags & UiNodeFlags.Visible) == 0)
            {
                continue;
            }

            if ((record.Flags & UiNodeFlags.Enabled) != 0 && (record.Flags & UiNodeFlags.Focusable) != 0)
            {
                AppendOrder(node);
            }

            ReadOnlySpan<UiNodeId> children = _tree.GetChildren(node);
            for (int i = children.Length - 1; i >= 0; i--)
            {
                Push(children[i]);
            }
        }

        _orderDirty = false;
    }

    private void Push(UiNodeId node)
    {
        if (_walkCount == _walk.Length)
        {
            Array.Resize(ref _walk, _walk.Length * 2);
        }

        _walk[_walkCount++] = node;
    }

    private void AppendOrder(UiNodeId node)
    {
        if (_orderCount == _order.Length)
        {
            Array.Resize(ref _order, _order.Length * 2);
        }

        _order[_orderCount++] = node;
    }

    private void AppendScoped(UiNodeId node)
    {
        if (_scopedCount == _scoped.Length)
        {
            Array.Resize(ref _scoped, _scoped.Length * 2);
        }

        _scoped[_scopedCount++] = node;
    }

    private void Notify(UiNodeId node, bool focused, UiFocusReason reason)
    {
        if (_events is not null)
        {
            var args = new UiFocusChangeEvent(node, focused, reason);
            _events.OnFocusChanged(in args);
        }
    }
}
