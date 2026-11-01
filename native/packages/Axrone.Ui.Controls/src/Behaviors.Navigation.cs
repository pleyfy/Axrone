namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Bar with a title and a left back zone.</summary>
internal sealed class NavigationBarBehavior : InteractiveBehavior
{
    private const float BackZoneWidth = 48.0f;

    public override ControlKind Kind => ControlKind.NavigationBar;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Direction = UiAxis.Row,
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
            Padding = new UiEdgeInsets(4.0f, 8.0f, 4.0f, 8.0f),
            ZIndex = 10,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

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

                entry.CrossOffset = args.Position.X;
                runtime.SetPressed(index, true);
                return true;
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (wasPressed && runtime.TryGetBounds(entry.Node, out Rect box) &&
                        entry.CrossOffset - box.X <= BackZoneWidth)
                    {
                        runtime.Emit(index, UiControlEventKind.Back, entry.Value, entry.Checked, entry.Index, null);
                    }

                    return wasPressed;
                }

            case UiPointerPhase.Cancel:
                runtime.SetPressed(index, false);
                return true;
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down ||
            args.KeyCode is not (ControlKeys.Backspace or ControlKeys.Escape))
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        runtime.Emit(index, UiControlEventKind.Back, entry.Value, entry.Checked, entry.Index, null);
        return true;
    }
}

/// <summary>Page container with push/pop history and one visible page.</summary>
internal sealed class PageStackBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.PageStack;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Stretch(1.0f),
        };

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);

    public override void OnSelectionApplied(UiControlRuntime runtime, int index) => ApplyPages(runtime, index);

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

        switch (args.Phase)
        {
            case UiPointerPhase.Enter:
                runtime.SetPointerInside(index, true);
                return false;
            case UiPointerPhase.Leave:
                runtime.SetPointerInside(index, false);
                return false;
            case UiPointerPhase.Down:
                runtime.SetPressed(index, true);
                return true;
            case UiPointerPhase.Up:
                return runtime.SetPressed(index, false);
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down ||
            args.KeyCode is not (ControlKeys.Backspace or ControlKeys.Escape))
        {
            return false;
        }

        return runtime.PopPageByIndex(index);
    }

    private static void ApplyPages(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Pages is not UiControl[] pages)
        {
            return;
        }

        for (int i = 0; i < entry.PageCount; i++)
        {
            if (pages[i].IsValid)
            {
                _ = runtime.SetVisible(pages[i], i == entry.Index);
            }
        }
    }
}

/// <summary>Horizontal pager over page controls with swipe and keyboard paging.</summary>
internal sealed class PageViewBehavior : ControlBehavior
{
    private const float SwipeThreshold = 40.0f;

    public override ControlKind Kind => ControlKind.PageView;

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

    public override void OnSelectionApplied(UiControlRuntime runtime, int index) => ApplyPages(runtime, index);

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

                entry.CrossOffset = args.Position.X;
                runtime.SetPressed(index, true);
                return true;
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (!wasPressed)
                    {
                        return false;
                    }

                    float delta = args.Position.X - entry.CrossOffset;
                    if (delta <= -SwipeThreshold)
                    {
                        SelectTo(runtime, index, entry.Index + 1);
                    }
                    else if (delta >= SwipeThreshold)
                    {
                        SelectTo(runtime, index, entry.Index - 1);
                    }

                    return true;
                }

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
        int next = args.KeyCode switch
        {
            ControlKeys.Left => entry.Index - 1,
            ControlKeys.Right => entry.Index + 1,
            ControlKeys.Home => 0,
            ControlKeys.End => entry.PageCount - 1,
            _ => int.MinValue,
        };
        if (next == int.MinValue)
        {
            return false;
        }

        return SelectTo(runtime, index, next);
    }

    private static bool SelectTo(UiControlRuntime runtime, int index, int value)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.PageCount == 0)
        {
            return false;
        }

        int next = Math.Clamp(value, 0, entry.PageCount - 1);
        if (next == entry.Index)
        {
            return false;
        }

        entry.Index = next;
        runtime.ApplySelection(index);
        return true;
    }

    private static void ApplyPages(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Pages is not UiControl[] pages)
        {
            return;
        }

        for (int i = 0; i < entry.PageCount; i++)
        {
            if (pages[i].IsValid)
            {
                _ = runtime.SetVisible(pages[i], i == entry.Index);
            }
        }
    }
}

/// <summary>Shared measured-width segment strip.</summary>
internal abstract class SegmentStripBehavior : ControlBehavior
{
    /// <summary>Gets the strip height.</summary>
    protected abstract float StripHeight(in ControlStyleContext style);

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Direction = UiAxis.Row,
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(StripHeight(in style)),
            Padding = new UiEdgeInsets(2.0f, 4.0f, 2.0f, 4.0f),
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        string[] labels = SelectorText.Split(definition.Text);
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Options = labels;
        entry.Index = labels.Length == 0 ? 0 : Math.Clamp(definition.SelectedIndex, 0, labels.Length - 1);
        entry.Metrics = new float[labels.Length];
        for (int i = 0; i < labels.Length; i++)
        {
            entry.Metrics[i] = MathF.Max(24.0f, runtime.MeasureTextWidth(labels[i], in entry.TextStyle) + 16.0f);
        }
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
                SelectAt(runtime, index, args.Position.X);
                return true;
            case UiPointerPhase.Up:
                return runtime.SetPressed(index, false);
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
        int count = entry.Options?.Length ?? 0;
        if (count == 0)
        {
            return false;
        }

        int next = args.KeyCode switch
        {
            ControlKeys.Left => entry.Index - 1,
            ControlKeys.Right => entry.Index + 1,
            ControlKeys.Home => 0,
            ControlKeys.End => count - 1,
            _ => -1,
        };
        if (next < 0)
        {
            return false;
        }

        SelectTo(runtime, index, Math.Clamp(next, 0, count - 1));
        return true;
    }

    private static void SelectAt(UiControlRuntime runtime, int index, float pointerX)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Metrics is not { Length: > 0 } metrics || !runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return;
        }

        float x = pointerX - box.X - 4.0f;
        float accumulated = 0.0f;
        int segment = metrics.Length - 1;
        for (int i = 0; i < metrics.Length; i++)
        {
            accumulated += metrics[i];
            if (x < accumulated)
            {
                segment = i;
                break;
            }
        }

        SelectTo(runtime, index, segment);
    }

    private static void SelectTo(UiControlRuntime runtime, int index, int value)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Index == value)
        {
            return;
        }

        entry.Index = value;
        runtime.ApplySelection(index);
    }
}

/// <summary>Horizontal menu title strip.</summary>
internal sealed class MenuBarBehavior : SegmentStripBehavior
{
    public override ControlKind Kind => ControlKind.MenuBar;

    protected override float StripHeight(in ControlStyleContext style) =>
        style.Number(style.Tokens.Height, 36.0f);
}

/// <summary>Clickable breadcrumb path.</summary>
internal sealed class BreadcrumbBehavior : SegmentStripBehavior
{
    public override ControlKind Kind => ControlKind.Breadcrumb;

    protected override float StripHeight(in ControlStyleContext style) =>
        style.Number(style.Tokens.RowHeight, 28.0f);
}
