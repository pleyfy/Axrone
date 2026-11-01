namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Anchored popup container; Escape or an outside click closes it.</summary>
internal sealed class PopupBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Popup;

    public override bool Interactive => true;

    public override bool Focusable => true;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Direction = UiAxis.Column,
            Position = UiPositionMode.Absolute,
            InsetLeft = UiLength.Px(40.0f),
            InsetTop = UiLength.Px(40.0f),
            Width = UiLength.Px(240.0f),
            Height = UiLength.Px(160.0f),
            Padding = new UiEdgeInsets(10.0f, 10.0f, 10.0f, 10.0f),
            AlignItems = UiAlign.Stretch,
            Gap = 6.0f,
            ZIndex = 250,
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

/// <summary>Clickable image surface sized from intrinsic metrics.</summary>
internal sealed class ImageFaceBehavior : InteractiveBehavior
{
    public override ControlKind Kind => ControlKind.ImageFace;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Auto,
            Height = UiLength.Auto,
        };

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        new() { Visible = true, Background = UiColor.Transparent };

    protected override void Activate(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, entry.Index, null);
    }
}

/// <summary>Collapsible header with one content child.</summary>
internal sealed class AccordionBehavior : InteractiveBehavior
{
    public override ControlKind Kind => ControlKind.Accordion;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Direction = UiAxis.Column,
            Width = UiLength.Stretch(1.0f),
            Height = UiLength.Auto,
            AlignItems = UiAlign.Stretch,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Surface(in style, in entry);

    public override void RefreshSecondary(UiControlRuntime runtime, int index) => ApplyContent(runtime, index);

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
                if (args.Button != 0 || !runtime.TryGetBounds(entry.Node, out Rect box) ||
                    args.Position.Y - box.Y > runtime.RowHeight())
                {
                    return false;
                }

                Toggle(runtime, index);
                return true;
            default:
                return false;
        }
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase)
    {
        if (phase != UiRoutingPhase.Target || args.Phase != UiKeyPhase.Down ||
            args.KeyCode is not (ControlKeys.Space or ControlKeys.Enter))
        {
            return false;
        }

        Toggle(runtime, index);
        return true;
    }

    private static void Toggle(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Open = !entry.Open;
        runtime.RefreshVisual(index);
        runtime.Emit(index, UiControlEventKind.OpenChanged, entry.Value, entry.Open, entry.Index, null);
    }

    private static void ApplyContent(UiControlRuntime runtime, int index)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        ReadOnlySpan<UiNodeId> children = runtime.Tree.GetChildren(entry.Node);
        if (children.Length == 0)
        {
            return;
        }

        UiNodeId content = children[0];
        runtime.SetNodeFlags(content, entry.Open ? UiNodeFlags.Visible | UiNodeFlags.Enabled : UiNodeFlags.Enabled);
        runtime.SetNodeLayoutStyle(
            content,
            UiLayoutStyle.Default with
            {
                Width = UiLength.Stretch(1.0f),
                Height = entry.Open ? UiLength.Auto : UiLength.Px(0.0f),
                Margin = new UiEdgeInsets(runtime.RowHeight(), 0.0f, 0.0f, 0.0f),
            });
    }
}

/// <summary>Removable tag with a close zone.</summary>
internal sealed class ChipBehavior : InteractiveBehavior
{
    private const float CloseZoneWidth = 20.0f;

    public override ControlKind Kind => ControlKind.Chip;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Auto,
            Height = UiLength.Px(24.0f),
            Padding = new UiEdgeInsets(2.0f, 8.0f, 2.0f, 8.0f),
            AlignItems = UiAlign.Center,
            AlignSelf = UiAlignSelf.Start,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

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

                    bool close = runtime.TryGetBounds(entry.Node, out Rect box) &&
                        args.Position.X >= box.X + box.Width - CloseZoneWidth;
                    runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, close ? 1 : 0, null);
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
        int zone = args.KeyCode switch
        {
            ControlKeys.Delete => 1,
            ControlKeys.Enter or ControlKeys.Space => 0,
            _ => -1,
        };
        if (zone < 0)
        {
            return false;
        }

        runtime.Emit(index, UiControlEventKind.Click, entry.Value, entry.Checked, zone, null);
        return true;
    }
}

/// <summary>Non-interactive status marker.</summary>
internal sealed class BadgeBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Badge;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Auto,
            Height = UiLength.Px(18.0f),
            Padding = new UiEdgeInsets(1.0f, 6.0f, 1.0f, 6.0f),
            AlignSelf = UiAlignSelf.Start,
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        runtime.ApplyText(index);

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Accent(in style, in entry);
}

/// <summary>Indeterminate activity indicator advanced by the host tick.</summary>
internal sealed class SpinnerBehavior : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Spinner;

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        UiLayoutStyle.Default with
        {
            Width = UiLength.Px(24.0f),
            Height = UiLength.Px(24.0f),
        };

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        entry.Value = 0.0f;
        entry.Open = false;
    }

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        ControlStyles.Accent(in style, in entry);
}
