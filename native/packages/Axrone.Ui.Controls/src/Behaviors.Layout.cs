namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Tab header strip that selects one of its bound page controls.</summary>
internal sealed class TabViewBehavior : ControlBehavior
{
    private const float SegmentPadding = 16.0f;

    public override ControlKind Kind => ControlKind.TabView;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(style.Number(style.Tokens.RowHeight, 28.0f) + 8.0f),
            Padding = new UiEdgeInsets(4.0f, 4.0f, 4.0f, 4.0f),
            Direction = UiAxis.Row,
            ZIndex = 5,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        string[] titles = SelectorText.Split(definition.Text);
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Options = titles;
        entry.Index = titles.Length == 0 ? 0 : Math.Clamp(definition.SelectedIndex, 0, titles.Length - 1);
        entry.Metrics = new float[titles.Length];
        for (int i = 0; i < titles.Length; i++)
        {
            entry.Metrics[i] = MathF.Max(24.0f, runtime.MeasureTextWidth(titles[i], in entry.TextStyle) + SegmentPadding);
        }
    }

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

/// <summary>Two panes separated by a draggable splitter; the ratio lives in the value.</summary>
internal sealed class SplitPaneBehavior : ControlBehavior
{
    private const float MinRatio = 0.15f;
    private const float MaxRatio = 0.85f;
    private const float SplitterGrip = 10.0f;
    private const float KeyStep = 0.02f;

    public override ControlKind Kind => ControlKind.SplitPane;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Direction = UiAxis.Row,
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(200.0f),
            AlignItems = UiAlign.Stretch,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        float ratio = definition.Value > 0.0f ? Math.Clamp(definition.Value, MinRatio, MaxRatio) : 0.5f;
        runtime.Entry(index).Value = ratio;
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);

    public override void RefreshSecondary(UiControlRuntime runtime, int index) => ApplyRatio(runtime, index);

    public override void OnValueApplied(UiControlRuntime runtime, int index) => ApplyRatio(runtime, index);

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
                if (args.Button != 0 || !NearSplitter(runtime, in entry, args.Position.X))
                {
                    return false;
                }

                runtime.SetPressed(index, true);
                UpdateRatio(runtime, index, args.Position.X);
                return true;
            case UiPointerPhase.Move:
                return entry.Pressed && UpdateRatio(runtime, index, args.Position.X);
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (wasPressed)
                    {
                        runtime.Emit(index, UiControlEventKind.ValueCommitted, entry.Value, entry.Checked, entry.Index, null);
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
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down)
        {
            return false;
        }

        float delta = args.KeyCode switch
        {
            ControlKeys.Left => -KeyStep,
            ControlKeys.Right => KeyStep,
            _ => 0.0f,
        };
        if (delta == 0.0f)
        {
            return false;
        }

        if (_SetRatio(runtime, index, runtime.Entry(index).Value + delta))
        {
            runtime.Emit(index, UiControlEventKind.ValueCommitted, runtime.Entry(index).Value, false, -1, null);
        }

        return true;
    }

    private static bool NearSplitter(UiControlRuntime runtime, in ControlEntry entry, float pointerX)
    {
        if (!runtime.TryGetBounds(entry.Node, out Rect box) || box.Width <= 0.0f)
        {
            return false;
        }

        float split = box.X + (box.Width * entry.Value);
        return MathF.Abs(pointerX - split) <= SplitterGrip;
    }

    private static bool UpdateRatio(UiControlRuntime runtime, int index, float pointerX)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect box) || box.Width <= 0.0f)
        {
            return false;
        }

        float ratio = Math.Clamp((pointerX - box.X) / box.Width, MinRatio, MaxRatio);
        return _SetRatio(runtime, index, ratio);
    }

    private static bool _SetRatio(UiControlRuntime runtime, int index, float ratio)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        float clamped = MathF.Round(Math.Clamp(ratio, MinRatio, MaxRatio), 4);
        if (clamped == entry.Value)
        {
            return false;
        }

        entry.Value = clamped;
        ApplyRatio(runtime, index);
        runtime.InvalidateVisual(index);
        runtime.Emit(index, UiControlEventKind.ValueChanged, clamped, entry.Checked, entry.Index, null);
        return true;
    }

    private static void ApplyRatio(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        ReadOnlySpan<UiNodeId> children = runtime.Tree.GetChildren(entry.Node);
        if (children.Length < 2)
        {
            return;
        }

        int percent = (int)(entry.Value * 100.0f);
        runtime.SetNodeLayoutStyle(
            children[0],
            UiLayoutStyle.Default with
            {
                Width = UiLength.Percent(percent),
                Height = UiLength.Stretch(1.0f),
                Shrink = 0.0f,
            });
        runtime.SetNodeLayoutStyle(
            children[1],
            UiLayoutStyle.Default with
            {
                Width = UiLength.Auto,
                Height = UiLength.Stretch(1.0f),
                Grow = 1.0f,
                Shrink = 0.0f,
            });
    }
}
