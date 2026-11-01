namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Continuous value slider with pointer drag and keyboard stepping.</summary>
internal sealed class SliderBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Slider;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
        };

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Interactive(in style, in entry, accentWhenChecked: false);

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
                UpdateFromPointer(runtime, index, args.Position.X);
                return true;
            case UiPointerPhase.Move:
                return entry.Pressed && UpdateFromPointer(runtime, index, args.Position.X);
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (!wasPressed)
                    {
                        return false;
                    }

                    UpdateFromPointer(runtime, index, args.Position.X);
                    runtime.Emit(index, UiControlEventKind.ValueCommitted, entry.Value, entry.Checked, entry.Index, null);
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
        float target;
        switch (args.KeyCode)
        {
            case ControlKeys.Left:
            case ControlKeys.Down:
                target = entry.Value - entry.Step;
                break;
            case ControlKeys.Right:
            case ControlKeys.Up:
                target = entry.Value + entry.Step;
                break;
            case ControlKeys.Home:
                target = entry.MinValue;
                break;
            case ControlKeys.End:
                target = entry.MaxValue;
                break;
            default:
                return false;
        }

        if (SetValue(runtime, index, target))
        {
            runtime.Emit(index, UiControlEventKind.ValueCommitted, entry.Value, entry.Checked, entry.Index, null);
        }

        return true;
    }

    private static bool UpdateFromPointer(UiControlRuntime runtime, int index, float pointerX)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect bounds) || bounds.Width <= 0.0f)
        {
            return false;
        }

        float fraction = Math.Clamp((pointerX - bounds.X) / bounds.Width, 0.0f, 1.0f);
        float raw = entry.MinValue + (fraction * (entry.MaxValue - entry.MinValue));
        float snapped = entry.Step > 0.0f
            ? entry.MinValue + (MathF.Round((raw - entry.MinValue) / entry.Step) * entry.Step)
            : raw;
        return SetValue(runtime, index, snapped);
    }

    private static bool SetValue(UiControlRuntime runtime, int index, float value)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        float clamped = Math.Clamp(value, entry.MinValue, entry.MaxValue);
        clamped = MathF.Round(clamped, 4);
        if (clamped == entry.Value)
        {
            return false;
        }

        entry.Value = clamped;
        runtime.InvalidateVisual(index);
        runtime.Emit(index, UiControlEventKind.ValueChanged, clamped, entry.Checked, entry.Index, null);
        return true;
    }
}

/// <summary>Clipping scroll container; children are offset in the layout sink.</summary>
internal sealed class ScrollViewBehavior : InteractiveBehavior
{
    private const float WheelStep = 20.0f;
    private const float KeyStep = 32.0f;

    public override ControlKind Kind => ControlKind.ScrollView;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(120.0f),
            AlignItems = UiAlign.Stretch,
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
        if (binding.Part == ControlPart.Primary && args.Phase == UiPointerPhase.Wheel)
        {
            return ScrollBy(runtime, index, -args.Delta.Y * WheelStep);
        }

        return base.OnPointer(runtime, index, in binding, in args, phase);
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down)
        {
            return false;
        }

        float delta = args.KeyCode switch
        {
            ControlKeys.Up => -KeyStep,
            ControlKeys.Down => KeyStep,
            ControlKeys.Home => -float.MaxValue,
            ControlKeys.End => float.MaxValue,
            _ => 0.0f,
        };
        if (delta == 0.0f)
        {
            return false;
        }

        return ScrollBy(runtime, index, delta);
    }

    private static bool ScrollBy(UiControlRuntime runtime, int index, float delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        float maximum = MaxOffset(runtime, in entry);
        float next = Math.Clamp(entry.ScrollOffset + delta, 0.0f, maximum);
        if (next == entry.ScrollOffset)
        {
            return false;
        }

        entry.ScrollOffset = next;
        runtime.Emit(index, UiControlEventKind.ScrollChanged, next, entry.Checked, entry.Index, null);
        runtime.InvalidateLayout(entry.Node);
        return true;
    }

    private static float MaxOffset(UiControlRuntime runtime, in ControlEntry entry)
    {
        if (!runtime.TryGetBounds(entry.Node, out Rect bounds))
        {
            return 0.0f;
        }

        float bottom = bounds.Y;
        ReadOnlySpan<UiNodeId> children = runtime.Tree.GetChildren(entry.Node);
        for (int i = 0; i < children.Length; i++)
        {
            if (runtime.TryGetBounds(children[i], out Rect child))
            {
                bottom = MathF.Max(bottom, child.Y + child.Height);
            }
        }

        float contentHeight = bottom + entry.ScrollOffset - bounds.Y;
        return MathF.Max(0.0f, contentHeight - bounds.Height);
    }
}
