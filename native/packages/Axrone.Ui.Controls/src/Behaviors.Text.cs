namespace Axrone.Ui.Controls;

using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Single-line text input with caret editing and commit-on-blur.</summary>
internal sealed class TextInputBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.TextInput;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
            Padding = new UiEdgeInsets(6.0f, 8.0f, 6.0f, 8.0f),
            AlignItems = UiAlign.Center,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        runtime.Entry(index).Caret = runtime.Entry(index).Text.Length;
        runtime.ApplyText(index);
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Interactive(in style, in entry, accentWhenChecked: false);

    public override bool OnText(UiControlRuntime runtime, int index, in UiTextInputEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Composing || args.Text.Length == 0)
        {
            return false;
        }

        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Text = entry.Text.Insert(entry.Caret, args.Text);
        entry.Caret += args.Text.Length;
        runtime.ApplyText(index);
        runtime.Emit(index, UiControlEventKind.TextChanged, entry.Value, entry.Checked, entry.Index, entry.Text);
        return true;
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
            case ControlKeys.Backspace:
                if (entry.Caret == 0)
                {
                    return true;
                }

                entry.Text = entry.Text.Remove(entry.Caret - 1, 1);
                entry.Caret--;
                CommitEdit(runtime, index);
                return true;
            case ControlKeys.Delete:
                if (entry.Caret >= entry.Text.Length)
                {
                    return true;
                }

                entry.Text = entry.Text.Remove(entry.Caret, 1);
                CommitEdit(runtime, index);
                return true;
            case ControlKeys.Left:
                entry.Caret = Math.Max(0, entry.Caret - 1);
                return true;
            case ControlKeys.Right:
                entry.Caret = Math.Min(entry.Text.Length, entry.Caret + 1);
                return true;
            case ControlKeys.Home:
                entry.Caret = 0;
                return true;
            case ControlKeys.End:
                entry.Caret = entry.Text.Length;
                return true;
            case ControlKeys.Enter:
                runtime.Emit(index, UiControlEventKind.TextCommitted, entry.Value, entry.Checked, entry.Index, entry.Text);
                return true;
            default:
                return false;
        }
    }

    public override void OnFocusChanged(UiControlRuntime runtime, int index, bool focused)
    {
        if (!focused)
        {
            ref ControlEntry entry = ref runtime.Entry(index);
            runtime.Emit(index, UiControlEventKind.TextCommitted, entry.Value, entry.Checked, entry.Index, entry.Text);
        }
    }

    private static void CommitEdit(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        runtime.ApplyText(index);
        runtime.Emit(index, UiControlEventKind.TextChanged, entry.Value, entry.Checked, entry.Index, entry.Text);
    }
}
