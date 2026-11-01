namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Virtualized single-column list over an item-count source.</summary>
internal sealed class ListViewBehavior : ControlBehavior
{
    private const float WheelStep = 20.0f;

    public override ControlKind Kind => ControlKind.ListView;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(200.0f),
        };

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);

    public override bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        if (binding.Part != ControlPart.Primary)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        switch (args.Phase)
        {
            case UiPointerPhase.Enter:
                runtime.SetPointerInside(index, true);
                return false;
            case UiPointerPhase.Leave:
                runtime.SetPointerInside(index, false);
                return false;
            case UiPointerPhase.Down:
                if (args.Button != 0)
                {
                    return false;
                }

                runtime.SetPressed(index, true);
                SelectAt(runtime, index, args.Position.Y);
                return true;
            case UiPointerPhase.Move:
                return false;
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (wasPressed)
                    {
                        runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
                    }

                    return wasPressed;
                }

            case UiPointerPhase.Wheel:
                return ScrollBy(runtime, index, -args.Delta.Y * WheelStep);
            case UiPointerPhase.Cancel:
                runtime.SetPressed(index, false);
                return true;
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        switch (args.KeyCode)
        {
            case ControlKeys.Up:
                return Move(runtime, index, -1);
            case ControlKeys.Down:
                return Move(runtime, index, 1);
            case ControlKeys.Home:
                return MoveTo(runtime, index, 0);
            case ControlKeys.End:
                return MoveTo(runtime, index, (entry.Items?.Count ?? 0) - 1);
            case ControlKeys.Enter:
                runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
                return true;
            default:
                return false;
        }
    }

    private static void SelectAt(UiControlRuntime runtime, int index, float pointerY)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.Items?.Count ?? 0;
        if (count == 0 || !runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return;
        }

        float rowHeight = runtime.RowHeight();
        if (rowHeight <= 0.0f)
        {
            return;
        }

        int row = Math.Clamp((int)MathF.Floor((pointerY - box.Y + entry.ScrollOffset) / rowHeight), 0, count - 1);
        MoveTo(runtime, index, row);
    }

    private static bool Move(UiControlRuntime runtime, int index, int delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        return MoveTo(runtime, index, entry.Index + delta);
    }

    private static bool MoveTo(UiControlRuntime runtime, int index, int target)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.Items?.Count ?? 0;
        if (count == 0)
        {
            return false;
        }

        int next = Math.Clamp(target, 0, count - 1);
        if (next != entry.Index)
        {
            entry.Index = next;
            runtime.ApplySelection(index);
        }

        EnsureVisible(runtime, index);
        return true;
    }

    private static void EnsureVisible(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return;
        }

        float rowHeight = runtime.RowHeight();
        float top = entry.Index * rowHeight;
        float bottom = top + rowHeight;
        float next = entry.ScrollOffset;
        if (top < entry.ScrollOffset)
        {
            next = top;
        }
        else if (bottom > entry.ScrollOffset + box.Height)
        {
            next = bottom - box.Height;
        }

        if (next != entry.ScrollOffset)
        {
            entry.ScrollOffset = MathF.Max(0.0f, next);
            runtime.Emit(index, UiControlEventKind.ScrollChanged, entry.ScrollOffset, entry.Checked, entry.Index, null);
            runtime.InvalidateVisual(index);
        }
    }

    private static bool ScrollBy(UiControlRuntime runtime, int index, float delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.Items?.Count ?? 0;
        if (count == 0 || !runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return false;
        }

        float maximum = MathF.Max(0.0f, (count * runtime.RowHeight()) - box.Height);
        float next = Math.Clamp(entry.ScrollOffset + delta, 0.0f, maximum);
        if (next == entry.ScrollOffset)
        {
            return false;
        }

        entry.ScrollOffset = next;
        runtime.Emit(index, UiControlEventKind.ScrollChanged, next, entry.Checked, entry.Index, null);
        runtime.InvalidateVisual(index);
        return true;
    }
}

/// <summary>Hierarchical list with expand/collapse rows and virtualization.</summary>
internal sealed class TreeViewBehavior : ControlBehavior
{
    private const float WheelStep = 20.0f;
    private const float DisclosureWidth = 20.0f;
    private const int MaxNodeId = 4096;

    public override ControlKind Kind => ControlKind.TreeView;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(200.0f),
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        runtime.Entry(index).Expanded = new bool[16];
        runtime.RebuildVisibleRows(index, -1);
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);

    public override bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        if (binding.Part != ControlPart.Primary)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        switch (args.Phase)
        {
            case UiPointerPhase.Enter:
                runtime.SetPointerInside(index, true);
                return false;
            case UiPointerPhase.Leave:
                runtime.SetPointerInside(index, false);
                return false;
            case UiPointerPhase.Down:
                if (args.Button != 0 || !runtime.TryGetBounds(entry.Node, out Rect box))
                {
                    return false;
                }

                runtime.SetPressed(index, true);
                if (args.Position.X - box.X < DisclosureWidth)
                {
                    ToggleExpand(runtime, index);
                }
                else
                {
                    SelectAt(runtime, index, args.Position.Y);
                }

                return true;
            case UiPointerPhase.Up:
                return runtime.SetPressed(index, false);
            case UiPointerPhase.Wheel:
                return ScrollBy(runtime, index, -args.Delta.Y * WheelStep);
            case UiPointerPhase.Cancel:
                runtime.SetPressed(index, false);
                return true;
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.VisibleRows?.Length ?? 0;
        switch (args.KeyCode)
        {
            case ControlKeys.Up:
                return Move(runtime, index, -1);
            case ControlKeys.Down:
                return Move(runtime, index, 1);
            case ControlKeys.Right:
                return Expand(runtime, index);
            case ControlKeys.Left:
                return Collapse(runtime, index);
            case ControlKeys.Enter:
                runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
                return true;
            case ControlKeys.Home:
                return count > 0 && MoveTo(runtime, index, 0);
            case ControlKeys.End:
                return count > 0 && MoveTo(runtime, index, count - 1);
            default:
                return false;
        }
    }

    private static void SelectAt(UiControlRuntime runtime, int index, float pointerY)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.VisibleRows?.Length ?? 0;
        if (count == 0 || !runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return;
        }

        float rowHeight = runtime.RowHeight();
        if (rowHeight <= 0.0f)
        {
            return;
        }

        int row = Math.Clamp((int)MathF.Floor((pointerY - box.Y + entry.ScrollOffset) / rowHeight), 0, count - 1);
        MoveTo(runtime, index, row);
    }

    private static bool Move(UiControlRuntime runtime, int index, int delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if ((entry.VisibleRows?.Length ?? 0) == 0)
        {
            return false;
        }

        return MoveTo(runtime, index, entry.Index + delta);
    }

    private static bool MoveTo(UiControlRuntime runtime, int index, int target)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.VisibleRows?.Length ?? 0;
        if (count == 0)
        {
            return false;
        }

        int next = Math.Clamp(target, 0, count - 1);
        if (next != entry.Index)
        {
            entry.Index = next;
            runtime.ApplySelection(index);
        }

        EnsureVisible(runtime, index);
        return true;
    }

    private static bool Expand(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Tree is not IUiTreeSource tree || entry.VisibleRows is not { Length: > 0 } rows)
        {
            return false;
        }

        int node = rows[entry.Index];
        if (node < 0 || node > MaxNodeId || tree.GetChildCount(node) == 0)
        {
            return false;
        }

        EnsureExpanded(ref entry, node);
        if (entry.Expanded![node])
        {
            return false;
        }

        entry.Expanded[node] = true;
        runtime.RebuildVisibleRows(index, node);
        runtime.InvalidateVisual(index);
        return true;
    }

    private static bool Collapse(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Tree is not IUiTreeSource tree || entry.VisibleRows is not { Length: > 0 } rows)
        {
            return false;
        }

        int node = rows[entry.Index];
        if (node < 0 || node > MaxNodeId || entry.Expanded is null || node >= entry.Expanded.Length || !entry.Expanded[node])
        {
            return false;
        }

        entry.Expanded[node] = false;
        runtime.RebuildVisibleRows(index, node);
        runtime.InvalidateVisual(index);
        return true;
    }

    private static void ToggleExpand(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Tree is not IUiTreeSource tree || entry.VisibleRows is not { Length: > 0 } rows)
        {
            return;
        }

        int node = rows[entry.Index];
        if (node < 0 || node > MaxNodeId || tree.GetChildCount(node) == 0)
        {
            return;
        }

        EnsureExpanded(ref entry, node);
        entry.Expanded![node] = !entry.Expanded[node];
        runtime.RebuildVisibleRows(index, node);
        runtime.InvalidateVisual(index);
    }

    private static void EnsureExpanded(ref ControlEntry entry, int node)
    {
        if (entry.Expanded is null)
        {
            entry.Expanded = new bool[Math.Max(16, node + 1)];
            return;
        }

        if (node >= entry.Expanded.Length)
        {
            Array.Resize(ref entry.Expanded, Math.Max(node + 1, entry.Expanded.Length * 2));
        }
    }

    private static void EnsureVisible(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return;
        }

        float rowHeight = runtime.RowHeight();
        float top = entry.Index * rowHeight;
        float bottom = top + rowHeight;
        float next = entry.ScrollOffset;
        if (top < entry.ScrollOffset)
        {
            next = top;
        }
        else if (bottom > entry.ScrollOffset + box.Height)
        {
            next = bottom - box.Height;
        }

        if (next != entry.ScrollOffset)
        {
            entry.ScrollOffset = MathF.Max(0.0f, next);
            runtime.Emit(index, UiControlEventKind.ScrollChanged, entry.ScrollOffset, entry.Checked, entry.Index, null);
        }
    }

    private static bool ScrollBy(UiControlRuntime runtime, int index, float delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.VisibleRows?.Length ?? 0;
        if (count == 0 || !runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return false;
        }

        float maximum = MathF.Max(0.0f, (count * runtime.RowHeight()) - box.Height);
        float next = Math.Clamp(entry.ScrollOffset + delta, 0.0f, maximum);
        if (next == entry.ScrollOffset)
        {
            return false;
        }

        entry.ScrollOffset = next;
        runtime.Emit(index, UiControlEventKind.ScrollChanged, next, entry.Checked, entry.Index, null);
        runtime.InvalidateVisual(index);
        return true;
    }
}
