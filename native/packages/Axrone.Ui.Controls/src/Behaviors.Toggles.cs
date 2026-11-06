namespace Axrone.Ui.Controls;

using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Shared checked/unchecked interaction for checkboxes and switches.</summary>
internal abstract class ToggleBehaviorBase : InteractiveBehavior
{
    /// <summary>Gets whether activation also raises a click event.</summary>
    protected abstract bool EmitsClick { get; }

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase == UiRoutingPhase.Target &&
            args.Phase == UiKeyPhase.Down &&
            args.KeyCode is ControlKeys.Space or ControlKeys.Enter)
        {
            Toggle(runtime, index);
            return true;
        }

        return false;
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Interactive(in style, in entry, accentWhenChecked: true);

    protected override void Activate(UiControlRuntime runtime, int index) => Toggle(runtime, index);

    private void Toggle(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Checked = !entry.Checked;
        runtime.RefreshVisual(index);
        runtime.Emit(index, UiControlEventKind.CheckedChanged, entry.Value, entry.Checked, entry.Index, null);
        if (EmitsClick)
        {
            runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
        }
    }
}

/// <summary>Check box with a text label.</summary>
internal sealed class CheckboxBehavior : ToggleBehaviorBase
{
    public override ControlKind Kind => ControlKind.Checkbox;

    protected override bool EmitsClick => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Auto,
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
            Padding = new UiEdgeInsets(4.0f, 10.0f, 4.0f, 10.0f),
            AlignItems = UiAlign.Center,
        };
}

/// <summary>On/off switch without a text label.</summary>
internal sealed class ToggleBehavior : ToggleBehaviorBase
{
    public override ControlKind Kind => ControlKind.Toggle;

    protected override bool EmitsClick => false;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style)
    {
        // Historical 44x24 switch geometry is the scale-1 reference; the theme
        // scale factor stretches it like TypeScript's toggle track sizing.
        float scale = style.Scale();
        return UiLayoutStyle.Default with
        {
            Width = UiLength.Px(44.0f * scale),
            Height = UiLength.Px(24.0f * scale),
        };
    }
}
