namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>
/// Select list whose open option rows extend the control's hit area below the header.
/// Rows are resolved from the pointer's Y; no extra popup node is needed.
/// </summary>
internal sealed class DropdownBehavior : InteractiveBehavior
{
    public override ControlKind Kind => ControlKind.Dropdown;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
            Padding = new UiEdgeInsets(4.0f, 10.0f, 4.0f, 10.0f),
            AlignItems = UiAlign.Center,
            ZIndex = 10,
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

        if (args.Phase == UiPointerPhase.Down && args.Button == 0 && runtime.Entry(index).Open &&
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

/// <summary>Exclusive option group rendered as one interactive row per option.</summary>
internal sealed class RadioGroupBehavior : InteractiveBehavior
{
    public override ControlKind Kind => ControlKind.RadioGroup;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Direction = UiAxis.Column,
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Auto,
            AlignItems = UiAlign.Stretch,
            Gap = 2.0f,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        string[] labels = SelectorText.Split(definition.Text);
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Options = labels;
        entry.Index = labels.Length == 0 ? 0 : Math.Clamp(definition.SelectedIndex, 0, labels.Length - 1);
        UiNodeId[] nodes = labels.Length == 0 ? [] : new UiNodeId[labels.Length];
        entry.OptionNodes = nodes;
        UiTextStyle textStyle = entry.TextStyle;
        int selected = entry.Index;
        for (int i = 0; i < labels.Length; i++)
        {
            UiNodeId option = runtime.CreateChildNode(
                index,
                UiNodeKind.Container,
                UiNodeFlags.Visible | UiNodeFlags.Enabled | UiNodeFlags.Interactive | UiNodeFlags.Focusable,
                ControlPart.Option,
                i);
            nodes[i] = option;
            runtime.SetNodeText(option, labels[i], in textStyle);
            runtime.SetNodeLayoutStyle(
                option,
                UiLayoutStyle.Default with
                {
                    Width = UiLength.Stretch(1.0f),
                    Height = UiLength.Auto,
                    Padding = new UiEdgeInsets(4.0f, 8.0f, 4.0f, 8.0f),
                });
            runtime.SetNodePatch(option, OptionPatch(runtime, i == selected, entry.Disabled));
        }
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Text(in style, in entry);

    public override void RefreshSecondary(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (entry.OptionNodes is not UiNodeId[] nodes)
        {
            return;
        }

        for (int i = 0; i < nodes.Length; i++)
        {
            runtime.SetNodePatch(nodes[i], OptionPatch(runtime, i == entry.Index, entry.Disabled));
        }
    }

    public override bool IsSecondaryHitTestable(in ControlStyleContext style, in ControlEntry entry, ControlPart part, int option) =>
        part == ControlPart.Option && (uint)option < (uint)(entry.OptionNodes?.Length ?? 0);

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down)
        {
            return false;
        }

        return args.KeyCode switch
        {
            ControlKeys.Up or ControlKeys.Left => Select(runtime, index, -1),
            ControlKeys.Down or ControlKeys.Right => Select(runtime, index, 1),
            ControlKeys.Space or ControlKeys.Enter => Commit(runtime, index),
            _ => false,
        };
    }

    protected override bool OnSecondaryPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        if (binding.Part != ControlPart.Option)
        {
            return false;
        }

        if (args.Phase == UiPointerPhase.Down && args.Button == 0)
        {
            SelectTo(runtime, index, binding.Option);
            return true;
        }

        return args.Phase is UiPointerPhase.Up or UiPointerPhase.Cancel;
    }

    private static bool Select(UiControlRuntime runtime, int index, int delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        return SelectTo(runtime, index, entry.Index + delta);
    }

    private static bool SelectTo(UiControlRuntime runtime, int index, int target)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        int count = entry.Options?.Length ?? 0;
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

        return true;
    }

    private static bool Commit(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        runtime.Emit(index, UiControlEventKind.SelectionChanged, entry.Value, entry.Checked, entry.Index, null);
        return true;
    }

    private static UiStylePatch OptionPatch(UiControlRuntime runtime, bool selected, bool disabled)
    {
        UiControlTheme tokens = runtime.ThemeTokens;
        ControlStyleContext style = runtime.Style;
        UiColor background = selected && !disabled
            ? style.Color(tokens.Accent, new UiColor(0.15f, 0.39f, 0.92f, 1.0f))
            : UiColor.Transparent;
        return new UiStylePatch
        {
            Visible = true,
            Background = background,
            Radius = ControlStyles.Radius(in style),
            TextColor = disabled
                ? style.Color(tokens.TextColorDisabled, new UiColor(0.55f, 0.62f, 0.72f, 1.0f))
                : style.Color(tokens.TextColor, UiColor.White),
        };
    }
}

/// <summary>Newline option-list parsing shared by selector controls.</summary>
internal static class SelectorText
{
    internal static string[] Split(string? text) =>
        string.IsNullOrEmpty(text) ? [] : text.Split('\n');
}
