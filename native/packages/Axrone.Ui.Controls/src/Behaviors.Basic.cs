namespace Axrone.Ui.Controls;

using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Plain flow container.</summary>
internal sealed class PanelBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Panel;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Display = UiDisplayMode.Stack,
            Direction = UiAxis.Column,
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Auto,
            AlignItems = UiAlign.Stretch,
            Gap = 4.0f,
            Padding = new UiEdgeInsets(8.0f, 8.0f, 8.0f, 8.0f),
        };

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);
}

/// <summary>Static text label.</summary>
internal sealed class LabelBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Label;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Auto,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Text(in style, in entry);
}

/// <summary>Intrinsic-size image.</summary>
internal sealed class ImageBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Image;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Auto,
            Height = UiLength.Auto,
        };

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        new() { Visible = true, Background = UiColor.Transparent };
}

/// <summary>Non-interactive progress indicator; the value is a 0..1 fill fraction.</summary>
internal sealed class ProgressBarBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.ProgressBar;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
        };

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Accent(in style, in entry);
}

/// <summary>Clickable button with text.</summary>
internal sealed class ButtonBehavior : InteractiveBehavior
{
    public override ControlKind Kind => ControlKind.Button;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Auto,
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
            Padding = new UiEdgeInsets(4.0f, 12.0f, 4.0f, 12.0f),
            AlignItems = UiAlign.Center,
            JustifyContent = UiJustify.Center,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase == UiRoutingPhase.Target &&
            args.Phase == UiKeyPhase.Down &&
            args.KeyCode is ControlKeys.Space or ControlKeys.Enter)
        {
            runtime.Emit(index, UiControlEventKind.Click, runtime.Entry(index).Value, false, -1, null);
            return true;
        }

        return false;
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Interactive(in style, in entry, accentWhenChecked: false);

    protected override void Activate(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
    }
}
