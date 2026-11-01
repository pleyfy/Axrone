namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Menu button whose open items extend the hit area below the header.</summary>
internal sealed class MenuBehavior : InteractiveBehavior
{
    public override ControlKind Kind => ControlKind.Menu;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Auto,
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
            Padding = new UiEdgeInsets(4.0f, 12.0f, 4.0f, 12.0f),
            AlignItems = UiAlign.Center,
            AlignSelf = UiAlignSelf.Start,
            ZIndex = 20,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        string[] labels = SelectorText.Split(definition.Text);
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Options = labels;
        entry.Index = labels.Length == 0 ? 0 : Math.Clamp(definition.SelectedIndex, 0, labels.Length - 1);
        entry.Text = UiControlRuntime.OptionLabel(in entry, entry.Index);
        runtime.ApplyText(index);
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Interactive(in style, in entry, accentWhenChecked: false);

    public override void OnSelectionApplied(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Text = UiControlRuntime.OptionLabel(in entry, entry.Index);
        runtime.ApplyText(index);
    }

    public override bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        if (binding.Part == ControlPart.Primary &&
            args.Phase == UiPointerPhase.Down &&
            args.Button == 0 &&
            runtime.Entry(index).Open &&
            TrySelectRow(runtime, index, args.Position.Y))
        {
            return true;
        }

        return base.OnPointer(runtime, index, in binding, in args, phase);
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
            case ControlKeys.Space:
            case ControlKeys.Enter:
                if (entry.Open)
                {
                    Close(runtime, index);
                }
                else
                {
                    Open(runtime, index);
                }

                return true;
            case ControlKeys.Up:
                return Move(runtime, index, -1);
            case ControlKeys.Down:
                return Move(runtime, index, 1);
            case ControlKeys.Escape:
                if (!entry.Open)
                {
                    return false;
                }

                Close(runtime, index);
                return true;
            default:
                return false;
        }
    }

    protected override void Activate(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Open)
        {
            Close(runtime, index);
        }
        else
        {
            Open(runtime, index);
        }
    }

    private static bool TrySelectRow(UiControlRuntime runtime, int index, float pointerY)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect header) || entry.Options is not { Length: > 0 } options)
        {
            return false;
        }

        float rowHeight = runtime.Style.Number(runtime.Style.Tokens.RowHeight, 28.0f);
        float firstRowY = header.Y + header.Height;
        if (rowHeight <= 0.0f || pointerY < firstRowY)
        {
            return false;
        }

        int row = (int)MathF.Floor((pointerY - firstRowY) / rowHeight);
        if ((uint)row >= (uint)options.Length)
        {
            return false;
        }

        if (row != entry.Index)
        {
            entry.Index = row;
            runtime.ApplySelection(index);
        }

        Close(runtime, index);
        runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
        return true;
    }

    private static bool Move(UiControlRuntime runtime, int index, int delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.Options?.Length ?? 0;
        if (count == 0)
        {
            return false;
        }

        int next = Math.Clamp(entry.Index + delta, 0, count - 1);
        if (next == entry.Index)
        {
            return true;
        }

        entry.Index = next;
        runtime.ApplySelection(index);
        return true;
    }

    private static void Open(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.Open)
        {
            return;
        }

        entry.Open = true;
        runtime.RequestHitSync();
        runtime.Emit(index, UiControlEventKind.OpenChanged, entry.Value, true, entry.Index, null);
    }

    private static void Close(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!entry.Open)
        {
            return;
        }

        entry.Open = false;
        runtime.RequestHitSync();
        runtime.Emit(index, UiControlEventKind.OpenChanged, entry.Value, false, entry.Index, null);
    }
}

/// <summary>Non-interactive text overlay positioned by its layout style.</summary>
internal sealed class TooltipBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Tooltip;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Position = UiPositionMode.Absolute,
            InsetLeft = UiLength.Px(0.0f),
            InsetTop = UiLength.Px(0.0f),
            Width = UiLength.Auto,
            Height = UiLength.Auto,
            Padding = new UiEdgeInsets(6.0f, 10.0f, 6.0f, 10.0f),
            ZIndex = 300,
            AlignSelf = UiAlignSelf.Start,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);
}

/// <summary>Timed transient overlay; the host ticks it through <see cref="UiControlRuntime.Update"/>.</summary>
internal sealed class ToastBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Toast;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Position = UiPositionMode.Absolute,
            InsetLeft = UiLength.Px(16.0f),
            InsetTop = UiLength.Px(16.0f),
            Width = UiLength.Auto,
            Height = UiLength.Auto,
            Padding = new UiEdgeInsets(8.0f, 12.0f, 8.0f, 12.0f),
            ZIndex = 300,
            AlignSelf = UiAlignSelf.Start,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Accent(in style, in entry);
}

/// <summary>Modal content container; Escape closes it and it blocks hit testing below.</summary>
internal sealed class DialogBehavior : InteractiveBehavior
{
    public override ControlKind Kind => ControlKind.Dialog;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Direction = UiAxis.Column,
            Position = UiPositionMode.Absolute,
            InsetLeft = UiLength.Px(40.0f),
            InsetTop = UiLength.Px(40.0f),
            Width = UiLength.Px(320.0f),
            Height = UiLength.Px(240.0f),
            Padding = new UiEdgeInsets(12.0f, 12.0f, 12.0f, 12.0f),
            AlignItems = UiAlign.Stretch,
            Gap = 8.0f,
            ZIndex = 200,
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
            case UiPointerPhase.Cancel:
                runtime.SetPressed(index, false);
                return true;
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down || args.KeyCode != ControlKeys.Escape)
        {
            return false;
        }

        return runtime.Entry(index).Open && runtime.SetOpenByIndex(index, false);
    }
}
