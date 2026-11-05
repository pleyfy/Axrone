namespace Axrone.Ui.Controls;

using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>
/// Adapter presenting a public <see cref="IUiWidgetBehavior"/> as an internal
/// <see cref="ControlBehavior"/>. One adapter instance is created per registry
/// slot at registration time; dispatch through it costs one array load plus a
/// virtual call, matching the built-in catalog path.
/// </summary>
internal sealed class ExternalWidgetBehavior(IUiWidgetBehavior widget) : ControlBehavior
{
    public override ControlKind Kind => ControlKind.Custom;

    public override bool Interactive => widget.IsInteractive;

    public override bool Focusable => widget.IsFocusable;

    public override void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition) =>
        widget.OnInitialize(runtime.Session(index), in definition);

    public override UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) =>
        widget.CreateLayoutStyle(style.WidgetContext());

    public override UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) =>
        widget.CreateStylePatch(BuildContext(in style, in entry));

    public override bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        ref ControlEntry entry = ref runtime.Entry(index);
        UiNodeId node = binding.Part == ControlPart.Primary
            ? entry.Node
            : ChildNodeOrPrimary(in entry, binding.Option);
        var hit = new UiWidgetPointerHit(node, binding.Part == ControlPart.Primary, binding.Option);
        return widget.OnPointer(runtime.Session(index), in hit, in args, phase);
    }

    public override bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase) =>
        widget.OnKey(runtime.Session(index), in args, phase);

    public override bool OnText(UiControlRuntime runtime, int index, in UiTextInputEvent args, UiRoutingPhase phase) =>
        widget.OnText(runtime.Session(index), in args, phase);

    public override void OnFocusChanged(UiControlRuntime runtime, int index, bool focused) =>
        widget.OnFocusChanged(runtime.Session(index), focused);

    public override bool IsSecondaryHitTestable(in ControlStyleContext style, in ControlEntry entry, ControlPart part, int option)
    {
        if (part != ControlPart.Option)
        {
            return false;
        }

        UiWidgetVisualContext context = BuildContext(in style, in entry);
        return widget.IsChildHitTestable(in context, option);
    }

    private static UiNodeId ChildNodeOrPrimary(in ControlEntry entry, int option) =>
        entry.OptionNodes is UiNodeId[] nodes && (uint)option < (uint)nodes.Length ? nodes[option] : entry.Node;

    private static UiWidgetVisualContext BuildContext(in ControlStyleContext style, in ControlEntry entry) => new()
    {
        State = ControlStyles.StateOf(in entry),
        Focused = entry.Focused,
        Checked = entry.Checked,
        Open = entry.Open,
        Value = entry.Value,
        Index = entry.Index,
        Text = entry.Text,
        Theme = style.WidgetContext(),
    };
}

/// <summary>Fallback behavior for controls whose registry handle went stale.</summary>
internal sealed class InertWidgetBehavior : ControlBehavior
{
    internal static readonly InertWidgetBehavior Instance = new();

    public override ControlKind Kind => ControlKind.Custom;
}
