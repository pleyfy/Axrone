namespace Axrone.Ui.Input;

using Axrone.Ui;

/// <summary>
/// Synchronous UI event router. Pointer events hit-test (or follow pointer capture),
/// then travel tunnel → target → bubble; key and text events start at the focused node;
/// focus transitions go to their target only. The first receiver that returns
/// <see langword="true"/> consumes the event and stops propagation.
/// </summary>
/// <remarks>
/// The parent chain and hover transitions are buffered in reusable arrays, so a routed
/// event allocates nothing after warm-up. Chains deeper than <see cref="MaxRouteDepth"/>
/// are truncated instead of throwing on the hot path.
/// </remarks>
public sealed class UiInputRouter : IUiInputRouter
{
    /// <summary>Maximum ancestor walk; deeper chains are truncated.</summary>
    public const int MaxRouteDepth = 128;

    private readonly IUiRouteGraph _graph;
    private readonly IUiHitTestIndex _hitTest;
    private readonly UiFocusManager _focus;
    private readonly UiPointerCapture _capture;
    private readonly IUiInputReceiverResolver _receivers;
    private readonly UiTextComposition? _composition;

    private UiNodeId[] _ancestors = new UiNodeId[16];
    private int _ancestorCount;
    private UiNodeId[] _entered = new UiNodeId[16];
    private int _enteredCount;
    private UiNodeId _hovered = UiNodeId.Invalid;

    /// <summary>Creates a router over its collaborators.</summary>
    public UiInputRouter(
        IUiRouteGraph graph,
        IUiHitTestIndex hitTest,
        UiFocusManager focus,
        UiPointerCapture capture,
        IUiInputReceiverResolver receivers,
        UiTextComposition? composition = null)
    {
        ArgumentNullException.ThrowIfNull(graph);
        ArgumentNullException.ThrowIfNull(hitTest);
        ArgumentNullException.ThrowIfNull(focus);
        ArgumentNullException.ThrowIfNull(capture);
        ArgumentNullException.ThrowIfNull(receivers);
        _graph = graph;
        _hitTest = hitTest;
        _focus = focus;
        _capture = capture;
        _receivers = receivers;
        _composition = composition;
    }

    /// <summary>Gets the node currently hovered by the pointer, or <see cref="UiNodeId.Invalid"/>.</summary>
    public UiNodeId Hovered => _hovered;

    /// <inheritdoc/>
    public UiInputDispatchResult Route(in UiPointerEvent args)
    {
        UiNodeId target = _capture.GetCaptured(args.PointerId);
        if (!target.IsValid && _hitTest.TryHitTest(args.Position, out UiHitResult hit))
        {
            target = hit.Node;
        }

        switch (args.Phase)
        {
            case UiPointerPhase.Move:
                UpdateHover(target, in args);
                return RoutePointer(target, in args);
            case UiPointerPhase.Down:
                if (target.IsValid)
                {
                    _focus.TryFocus(target, UiFocusReason.PointerInput);
                    _capture.TryCapture(args.PointerId, target);
                }

                return RoutePointer(target, in args);
            case UiPointerPhase.Up:
            case UiPointerPhase.Cancel:
                {
                    UiInputDispatchResult result = RoutePointer(target, in args);
                    _capture.Release(args.PointerId);
                    _focus.ValidateFocus();
                    return result with { Canceled = args.Phase == UiPointerPhase.Cancel || result.Canceled };
                }

            case UiPointerPhase.Enter:
            case UiPointerPhase.Leave:
                return RouteBoundary(args.Target, in args);
            default:
                return RoutePointer(target, in args);
        }
    }

    /// <inheritdoc/>
    public UiInputDispatchResult Route(in UiKeyEvent args)
    {
        UiNodeId target = _focus.Focused;
        if (!target.IsValid)
        {
            return Unhandled();
        }

        int count = BuildAncestors(target);
        for (int i = 0; i < count; i++)
        {
            if (InvokeKey(_ancestors[i], in args, UiRoutingPhase.Tunnel))
            {
                return new UiInputDispatchResult(true, target, UiRoutingPhase.Tunnel, false);
            }
        }

        if (InvokeKey(target, in args, UiRoutingPhase.Target))
        {
            return new UiInputDispatchResult(true, target, UiRoutingPhase.Target, false);
        }

        for (int i = count - 1; i >= 0; i--)
        {
            if (InvokeKey(_ancestors[i], in args, UiRoutingPhase.Bubble))
            {
                return new UiInputDispatchResult(true, target, UiRoutingPhase.Bubble, false);
            }
        }

        return new UiInputDispatchResult(false, target, UiRoutingPhase.Target, false);
    }

    /// <inheritdoc/>
    public UiInputDispatchResult Route(in UiTextInputEvent args)
    {
        UiNodeId target = _focus.Focused;
        if (!target.IsValid)
        {
            return Unhandled();
        }

        DriveComposition(target, in args);
        int count = BuildAncestors(target);
        for (int i = 0; i < count; i++)
        {
            if (InvokeText(_ancestors[i], in args, UiRoutingPhase.Tunnel))
            {
                return new UiInputDispatchResult(true, target, UiRoutingPhase.Tunnel, false);
            }
        }

        if (InvokeText(target, in args, UiRoutingPhase.Target))
        {
            return new UiInputDispatchResult(true, target, UiRoutingPhase.Target, false);
        }

        for (int i = count - 1; i >= 0; i--)
        {
            if (InvokeText(_ancestors[i], in args, UiRoutingPhase.Bubble))
            {
                return new UiInputDispatchResult(true, target, UiRoutingPhase.Bubble, false);
            }
        }

        return new UiInputDispatchResult(false, target, UiRoutingPhase.Target, false);
    }

    /// <inheritdoc/>
    public UiInputDispatchResult Route(in UiFocusChangeEvent args)
    {
        if (!args.Target.IsValid)
        {
            return Unhandled();
        }

        bool handled = _receivers.TryResolve(args.Target, out IUiInputReceiver receiver) &&
                       receiver.OnFocus(in args, UiRoutingPhase.Target);
        return new UiInputDispatchResult(handled, args.Target, UiRoutingPhase.Target, false);
    }

    /// <summary>
    /// Handles an OS window focus transition: losing focus cancels composition, releases
    /// every captured pointer and clears widget focus.
    /// </summary>
    public UiInputDispatchResult HandleWindowFocus(in UiWindowFocusEvent args)
    {
        if (args.Focused)
        {
            return new UiInputDispatchResult(false, UiNodeId.Invalid, UiRoutingPhase.Target, false);
        }

        _composition?.Cancel();
        _capture.ReleaseAll();
        _focus.ClearFocus(UiFocusReason.Window);
        return new UiInputDispatchResult(false, UiNodeId.Invalid, UiRoutingPhase.Target, true);
    }

    private void DriveComposition(UiNodeId target, in UiTextInputEvent args) =>
        _composition?.Feed(target, in args);

    private UiInputDispatchResult RoutePointer(UiNodeId target, in UiPointerEvent args)
    {
        if (!target.IsValid)
        {
            return new UiInputDispatchResult(false, UiNodeId.Invalid, UiRoutingPhase.Target, args.Phase == UiPointerPhase.Cancel);
        }

        int count = BuildAncestors(target);
        for (int i = 0; i < count; i++)
        {
            if (InvokePointer(_ancestors[i], in args, UiRoutingPhase.Tunnel))
            {
                return new UiInputDispatchResult(true, target, UiRoutingPhase.Tunnel, args.Phase == UiPointerPhase.Cancel);
            }
        }

        if (InvokePointer(target, in args, UiRoutingPhase.Target))
        {
            return new UiInputDispatchResult(true, target, UiRoutingPhase.Target, args.Phase == UiPointerPhase.Cancel);
        }

        for (int i = count - 1; i >= 0; i--)
        {
            if (InvokePointer(_ancestors[i], in args, UiRoutingPhase.Bubble))
            {
                return new UiInputDispatchResult(true, target, UiRoutingPhase.Bubble, args.Phase == UiPointerPhase.Cancel);
            }
        }

        return new UiInputDispatchResult(false, target, UiRoutingPhase.Target, args.Phase == UiPointerPhase.Cancel);
    }

    private void UpdateHover(UiNodeId target, in UiPointerEvent args)
    {
        UiNodeId previous = _hovered;
        if (previous == target)
        {
            return;
        }

        _hovered = target;
        UiNodeId common = FindCommonAncestor(previous, target);

        UiNodeId node = previous;
        for (int guard = 0; node.IsValid && node != common && guard < MaxRouteDepth; guard++)
        {
            var leave = args with { Target = node, Phase = UiPointerPhase.Leave };
            RouteBoundary(node, in leave);
            if (!_graph.TryGetParent(node, out UiNodeId parent))
            {
                break;
            }

            node = parent;
        }

        _enteredCount = 0;
        node = target;
        for (int guard = 0; node.IsValid && node != common && guard < MaxRouteDepth; guard++)
        {
            AppendEntered(node);
            if (!_graph.TryGetParent(node, out UiNodeId parent))
            {
                break;
            }

            node = parent;
        }

        for (int i = _enteredCount - 1; i >= 0; i--)
        {
            var enter = args with { Target = _entered[i], Phase = UiPointerPhase.Enter };
            RouteBoundary(_entered[i], in enter);
        }
    }

    private UiInputDispatchResult RouteBoundary(UiNodeId node, in UiPointerEvent args)
    {
        if (!node.IsValid)
        {
            return Unhandled();
        }

        bool handled = _receivers.TryResolve(node, out IUiInputReceiver receiver) &&
                       receiver.OnPointer(in args, UiRoutingPhase.Target);
        return new UiInputDispatchResult(handled, node, UiRoutingPhase.Target, false);
    }

    private UiNodeId FindCommonAncestor(UiNodeId left, UiNodeId right)
    {
        if (!left.IsValid || !right.IsValid)
        {
            return UiNodeId.Invalid;
        }

        UiNodeId candidate = left;
        for (int guard = 0; candidate.IsValid && guard < MaxRouteDepth; guard++)
        {
            if (IsSelfOrAncestorOf(candidate, right))
            {
                return candidate;
            }

            if (!_graph.TryGetParent(candidate, out UiNodeId parent))
            {
                return UiNodeId.Invalid;
            }

            candidate = parent;
        }

        return UiNodeId.Invalid;
    }

    private bool IsSelfOrAncestorOf(UiNodeId ancestor, UiNodeId node)
    {
        UiNodeId current = node;
        for (int guard = 0; current.IsValid && guard < MaxRouteDepth; guard++)
        {
            if (current == ancestor)
            {
                return true;
            }

            if (!_graph.TryGetParent(current, out UiNodeId parent))
            {
                return false;
            }

            current = parent;
        }

        return false;
    }

    private int BuildAncestors(UiNodeId target)
    {
        _ancestorCount = 0;
        UiNodeId current = target;
        for (int guard = 0; guard < MaxRouteDepth; guard++)
        {
            if (!_graph.TryGetParent(current, out UiNodeId parent))
            {
                break;
            }

            AppendAncestor(parent);
            current = parent;
        }

        _ancestors.AsSpan(0, _ancestorCount).Reverse();
        return _ancestorCount;
    }

    private void AppendAncestor(UiNodeId node)
    {
        if (_ancestorCount == _ancestors.Length)
        {
            Array.Resize(ref _ancestors, _ancestors.Length * 2);
        }

        _ancestors[_ancestorCount++] = node;
    }

    private void AppendEntered(UiNodeId node)
    {
        if (_enteredCount == _entered.Length)
        {
            Array.Resize(ref _entered, _entered.Length * 2);
        }

        _entered[_enteredCount++] = node;
    }

    private bool InvokePointer(UiNodeId node, in UiPointerEvent args, UiRoutingPhase phase) =>
        _receivers.TryResolve(node, out IUiInputReceiver receiver) && receiver.OnPointer(in args, phase);

    private bool InvokeKey(UiNodeId node, in UiKeyEvent args, UiRoutingPhase phase) =>
        _receivers.TryResolve(node, out IUiInputReceiver receiver) && receiver.OnKey(in args, phase);

    private bool InvokeText(UiNodeId node, in UiTextInputEvent args, UiRoutingPhase phase) =>
        _receivers.TryResolve(node, out IUiInputReceiver receiver) && receiver.OnText(in args, phase);

    private static UiInputDispatchResult Unhandled() =>
        new(false, UiNodeId.Invalid, UiRoutingPhase.Target, false);
}
