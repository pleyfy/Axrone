namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Multi-line text editor with caret navigation and vertical scrolling.</summary>
internal sealed class TextAreaBehavior : ControlBehavior
{
    private const float PaddingTop = 6.0f;
    private const float PaddingLeft = 8.0f;

    public override ControlKind Kind => ControlKind.TextArea;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(120.0f),
            Padding = new UiEdgeInsets(PaddingTop, PaddingLeft, PaddingTop, PaddingLeft),
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

        Insert(runtime, index, args.Text);
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
            case ControlKeys.Enter:
                Insert(runtime, index, "\n");
                return true;
            case ControlKeys.Escape:
                runtime.Emit(index, UiControlEventKind.TextCommitted, entry.Value, entry.Checked, entry.Index, entry.Text);
                return true;
            case ControlKeys.Backspace:
                if (entry.Caret > 0)
                {
                    entry.Text = entry.Text.Remove(entry.Caret - 1, 1);
                    entry.Caret--;
                    AfterEdit(runtime, index);
                }

                return true;
            case ControlKeys.Delete:
                if (entry.Caret < entry.Text.Length)
                {
                    entry.Text = entry.Text.Remove(entry.Caret, 1);
                    AfterEdit(runtime, index);
                }

                return true;
            case ControlKeys.Left:
                MoveCaret(runtime, index, -1);
                return true;
            case ControlKeys.Right:
                MoveCaret(runtime, index, 1);
                return true;
            case ControlKeys.Up:
                MoveLine(runtime, index, -1);
                return true;
            case ControlKeys.Down:
                MoveLine(runtime, index, 1);
                return true;
            case ControlKeys.Home:
                SetCaret(runtime, index, LineStart(entry.Text, LineOf(entry.Text, entry.Caret)));
                return true;
            case ControlKeys.End:
                SetCaret(runtime, index, LineEnd(entry.Text, LineOf(entry.Text, entry.Caret)));
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
                PlaceCaret(runtime, index, args.Position.X, args.Position.Y);
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

    private static void Insert(UiControlRuntime runtime, int index, string value)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Text = entry.Text.Insert(entry.Caret, value);
        entry.Caret += value.Length;
        AfterEdit(runtime, index);
    }

    private static void AfterEdit(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        runtime.ApplyText(index);
        EnsureCaretVisible(runtime, index);
        runtime.Emit(index, UiControlEventKind.TextChanged, entry.Value, entry.Checked, entry.Index, entry.Text);
    }

    private static void MoveCaret(UiControlRuntime runtime, int index, int delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        SetCaret(runtime, index, entry.Caret + delta);
    }

    private static void SetCaret(UiControlRuntime runtime, int index, int caret)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Caret = Math.Clamp(caret, 0, entry.Text.Length);
        EnsureCaretVisible(runtime, index);
    }

    private static void MoveLine(UiControlRuntime runtime, int index, int delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        string text = entry.Text;
        int line = LineOf(text, entry.Caret);
        int column = entry.Caret - LineStart(text, line);
        int target = Math.Clamp(line + delta, 0, LineOf(text, text.Length));
        int start = LineStart(text, target);
        int end = LineEnd(text, target);
        SetCaret(runtime, index, Math.Min(start + column, end));
    }

    private static void PlaceCaret(UiControlRuntime runtime, int index, float pointerX, float pointerY)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return;
        }

        float lineHeight = UiControlRuntime.TextLineHeight(in entry.TextStyle);
        float charWidth = runtime.MeasureTextWidth("A", in entry.TextStyle);
        if (charWidth <= 0.0f)
        {
            charWidth = 8.0f;
        }

        string text = entry.Text;
        int lines = LineOf(text, text.Length);
        int line = Math.Clamp(
            (int)MathF.Floor((pointerY - box.Y - PaddingTop + entry.ScrollOffset) / lineHeight),
            0,
            lines);
        int start = LineStart(text, line);
        int end = LineEnd(text, line);
        int column = Math.Clamp((int)MathF.Round((pointerX - box.X - PaddingLeft) / charWidth), 0, end - start);
        SetCaret(runtime, index, start + column);
    }

    private static void EnsureCaretVisible(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect box))
        {
            return;
        }

        float lineHeight = UiControlRuntime.TextLineHeight(in entry.TextStyle);
        float viewport = MathF.Max(0.0f, box.Height - (PaddingTop * 2.0f));
        float top = LineOf(entry.Text, entry.Caret) * lineHeight;
        float bottom = top + lineHeight;
        float next = entry.ScrollOffset;
        if (top < entry.ScrollOffset)
        {
            next = top;
        }
        else if (bottom > entry.ScrollOffset + viewport)
        {
            next = bottom - viewport;
        }

        if (next != entry.ScrollOffset)
        {
            entry.ScrollOffset = MathF.Max(0.0f, next);
            runtime.InvalidateVisual(index);
        }
    }

    private static int LineOf(string text, int caret)
    {
        int line = 0;
        int limit = Math.Min(caret, text.Length);
        for (int i = 0; i < limit; i++)
        {
            if (text[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    private static int LineStart(string text, int line)
    {
        if (line <= 0)
        {
            return 0;
        }

        int current = 0;
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] == '\n' && ++current == line)
            {
                return i + 1;
            }
        }

        return text.Length;
    }

    private static int LineEnd(string text, int line)
    {
        int start = LineStart(text, line);
        int end = text.IndexOf('\n', start);
        return end < 0 ? text.Length : end;
    }
}

/// <summary>Equal-width exclusive segment strip.</summary>
internal sealed class SegmentedControlBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.SegmentedControl;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Px(style.Number(style.Tokens.Height, 36.0f)),
            Padding = new UiEdgeInsets(2.0f, 2.0f, 2.0f, 2.0f),
            Direction = UiAxis.Row,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        string[] labels = SelectorText.Split(definition.Text);
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Options = labels;
        entry.Index = labels.Length == 0 ? 0 : Math.Clamp(definition.SelectedIndex, 0, labels.Length - 1);
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
        int count = entry.Options?.Length ?? 0;
        if (count == 0 || !runtime.TryGetBounds(entry.Node, out Rect box) || box.Width <= 0.0f)
        {
            return;
        }

        float segment = box.Width / count;
        SelectTo(runtime, index, Math.Clamp((int)MathF.Floor((pointerX - box.X) / segment), 0, count - 1));
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

/// <summary>Numeric stepper with decrement/increment halves.</summary>
internal sealed class StepperBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Stepper;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Px(120.0f),
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
                return true;
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (!wasPressed || !runtime.TryGetBounds(entry.Node, out Rect box))
                    {
                        return wasPressed;
                    }

                    bool increase = args.Position.X >= box.X + (box.Width * 0.5f);
                    Nudge(runtime, index, increase ? entry.Step : -entry.Step);
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

        if (Nudge(runtime, index, target - entry.Value))
        {
            runtime.Emit(index, UiControlEventKind.ValueCommitted, entry.Value, entry.Checked, entry.Index, null);
        }

        return true;
    }

    private static bool Nudge(UiControlRuntime runtime, int index, float delta)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        float next = MathF.Round(Math.Clamp(entry.Value + delta, entry.MinValue, entry.MaxValue), 4);
        if (next == entry.Value)
        {
            return false;
        }

        entry.Value = next;
        runtime.InvalidateVisual(index);
        runtime.Emit(index, UiControlEventKind.ValueChanged, next, entry.Checked, entry.Index, null);
        return true;
    }
}

/// <summary>Star rating from zero to the configured maximum.</summary>
internal sealed class RatingBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Rating;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Px(120.0f),
            Height = UiLength.Px(24.0f),
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.MinValue = 0.0f;
        entry.MaxValue = MathF.Max(1.0f, definition.MaxValue);
        entry.Value = Math.Clamp(definition.Value, 0.0f, entry.MaxValue);
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
                SetFromPointer(runtime, index, args.Position.X);
                return true;
            case UiPointerPhase.Up:
                {
                    bool wasPressed = runtime.SetPressed(index, false);
                    if (wasPressed)
                    {
                        runtime.Emit(index, UiControlEventKind.ValueCommitted, runtime.Entry(index).Value, false, -1, null);
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

        ref ControlEntry entry = ref runtime.Entry(index);
        float target = args.KeyCode switch
        {
            ControlKeys.Left => entry.Value - 1.0f,
            ControlKeys.Right => entry.Value + 1.0f,
            ControlKeys.Home => 0.0f,
            ControlKeys.End => entry.MaxValue,
            _ => -1.0f,
        };
        if (target < 0.0f && args.KeyCode != ControlKeys.Home)
        {
            return false;
        }

        if (SetValue(runtime, index, target))
        {
            runtime.Emit(index, UiControlEventKind.ValueCommitted, runtime.Entry(index).Value, false, -1, null);
        }

        return true;
    }

    private static void SetFromPointer(UiControlRuntime runtime, int index, float pointerX)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        if (!runtime.TryGetBounds(entry.Node, out Rect box) || box.Width <= 0.0f || entry.MaxValue < 1.0f)
        {
            return;
        }

        float starWidth = box.Width / entry.MaxValue;
        float star = MathF.Floor((pointerX - box.X) / starWidth) + 1.0f;
        SetValue(runtime, index, Math.Clamp(star, 1.0f, entry.MaxValue));
    }

    private static bool SetValue(UiControlRuntime runtime, int index, float value)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        float next = Math.Clamp(MathF.Round(value), 0.0f, entry.MaxValue);
        if (next == entry.Value)
        {
            return false;
        }

        entry.Value = next;
        runtime.InvalidateVisual(index);
        runtime.Emit(index, UiControlEventKind.ValueChanged, next, entry.Checked, entry.Index, null);
        return true;
    }
}
