namespace Axrone.Ui.Controls;

using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>
/// Stateless control behavior. One singleton instance per <see cref="ControlKind"/>
/// owns measure, input and style logic; per-instance data lives in
/// <see cref="ControlEntry"/>. Virtual dispatch replaces reflection so the catalog
/// stays NativeAOT-safe.
/// </summary>
internal abstract class ControlBehavior
{
    /// <summary>Gets the kind this behavior implements.</summary>
    public abstract ControlKind Kind { get; }

    /// <summary>Gets whether the node accepts pointer/key events.</summary>
    public virtual bool Interactive => false;

    /// <summary>Gets whether the node can take focus.</summary>
    public virtual bool Focusable => false;

    /// <summary>Initializes a freshly created control entry.</summary>
    public virtual void Initialize(UiControlRuntime runtime, int index, in UiControlDefinition definition)
    {
    }

    /// <summary>Gets the control's base layout style.</summary>
    public virtual UiLayoutStyle CreateLayoutStyle(in ControlStyleContext style) => UiLayoutStyle.Default;

    /// <summary>Handles a pointer event addressed to one of the control's nodes.</summary>
    public virtual bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase) => false;

    /// <summary>Handles a key event addressed to the control's primary node.</summary>
    public virtual bool OnKey(UiControlRuntime runtime, int index, in UiKeyEvent args, UiRoutingPhase phase) => false;

    /// <summary>Handles committed text addressed to the control's primary node.</summary>
    public virtual bool OnText(UiControlRuntime runtime, int index, in UiTextInputEvent args, UiRoutingPhase phase) => false;

    /// <summary>Observes focus transitions of the control's primary node.</summary>
    public virtual void OnFocusChanged(UiControlRuntime runtime, int index, bool focused)
    {
    }

    /// <summary>Runs after a selection change has been applied to the entry.</summary>
    public virtual void OnSelectionApplied(UiControlRuntime runtime, int index)
    {
    }

    /// <summary>Runs after a value change has been applied through the runtime API.</summary>
    public virtual void OnValueApplied(UiControlRuntime runtime, int index)
    {
    }

    /// <summary>Builds the state-dependent style patch of the primary node.</summary>
    public virtual UiStylePatch CreateStylePatch(in ControlStyleContext style, in ControlEntry entry) => default;

    /// <summary>Refreshes secondary node styles (popup and option rows).</summary>
    public virtual void RefreshSecondary(UiControlRuntime runtime, int index)
    {
    }

    /// <summary>Gets whether a secondary node of this control is hit-testable.</summary>
    public virtual bool IsSecondaryHitTestable(in ControlStyleContext style, in ControlEntry entry, ControlPart part, int option) => false;
}

/// <summary>
/// Shared pointer state machine for hover/press/activate controls: enter/leave
/// maintain hover, down/up maintain press, and release inside activates.
/// </summary>
internal abstract class InteractiveBehavior : ControlBehavior
{
    /// <inheritdoc/>
    public override bool Interactive => true;

    /// <inheritdoc/>
    public override bool Focusable => true;

    /// <inheritdoc/>
    public override bool OnPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase)
    {
        if (binding.Part != ControlPart.Primary)
        {
            return OnSecondaryPointer(runtime, index, in binding, in args, phase);
        }

        return args.Phase switch
        {
            UiPointerPhase.Enter => Enter(runtime, index),
            UiPointerPhase.Leave => Leave(runtime, index),
            UiPointerPhase.Down => Down(runtime, index, in args),
            UiPointerPhase.Up => Up(runtime, index, in args),
            UiPointerPhase.Cancel => Cancel(runtime, index),
            _ => false,
        };
    }

    /// <summary>Handles pointer events on popup/option nodes.</summary>
    protected virtual bool OnSecondaryPointer(
        UiControlRuntime runtime,
        int index,
        in ControlNodeBinding binding,
        in UiPointerEvent args,
        UiRoutingPhase phase) => false;

    /// <summary>Runs when the pressed pointer is released over the control.</summary>
    protected virtual void Activate(UiControlRuntime runtime, int index)
    {
    }

    private static bool Enter(UiControlRuntime runtime, int index)
    {
        runtime.SetPointerInside(index, true);
        return false;
    }

    private static bool Leave(UiControlRuntime runtime, int index)
    {
        runtime.SetPointerInside(index, false);
        return false;
    }

    private static bool Down(UiControlRuntime runtime, int index, in UiPointerEvent args)
    {
        if (args.Button != 0)
        {
            return false;
        }

        runtime.SetPressed(index, true);
        return true;
    }

    private bool Up(UiControlRuntime runtime, int index, in UiPointerEvent args)
    {
        bool wasPressed = runtime.SetPressed(index, false);
        if (!wasPressed)
        {
            return false;
        }

        Activate(runtime, index);
        return true;
    }

    private static bool Cancel(UiControlRuntime runtime, int index)
    {
        runtime.SetPressed(index, false);
        return true;
    }
}

/// <summary>Built-in control catalog. Behavior lookup is a bounds-checked array index.</summary>
public static class ControlCatalog
{
    private static readonly ControlBehavior[] Behaviors =
    [
        new PanelBehavior(),
        new LabelBehavior(),
        new ImageBehavior(),
        new ButtonBehavior(),
        new CheckboxBehavior(),
        new ToggleBehavior(),
        new SliderBehavior(),
        new TextInputBehavior(),
        new ScrollViewBehavior(),
        new DropdownBehavior(),
        new ProgressBarBehavior(),
        new RadioGroupBehavior(),
        new TextAreaBehavior(),
        new TabViewBehavior(),
        new ListViewBehavior(),
        new TreeViewBehavior(),
        new MenuBehavior(),
        new TooltipBehavior(),
        new DialogBehavior(),
        new ToastBehavior(),
        new SegmentedControlBehavior(),
        new StepperBehavior(),
        new RatingBehavior(),
        new SplitPaneBehavior(),
        new DataGridBehavior(),
        new DatePickerBehavior(),
        new ColorPickerBehavior(),
        new NavigationBarBehavior(),
        new PageStackBehavior(),
        new PageViewBehavior(),
        new PopupBehavior(),
        new ImageFaceBehavior(),
        new MenuBarBehavior(),
        new AccordionBehavior(),
        new BreadcrumbBehavior(),
        new ChipBehavior(),
        new BadgeBehavior(),
        new SpinnerBehavior(),
    ];

    /// <summary>Gets the number of registered control kinds.</summary>
    public static int Count => Behaviors.Length;

    /// <summary>Gets whether a kind is registered.</summary>
    public static bool Contains(ControlKind kind) => (uint)kind < (uint)Behaviors.Length;

    /// <summary>Gets the kind registered at an index.</summary>
    public static ControlKind GetKind(int index) => (ControlKind)index;

    internal static ControlBehavior Get(ControlKind kind) => Behaviors[(int)kind];

    internal static bool TryGet(ControlKind kind, out ControlBehavior behavior)
    {
        uint index = (uint)kind;
        if (index < (uint)Behaviors.Length)
        {
            behavior = Behaviors[index];
            return true;
        }

        behavior = Behaviors[0];
        return false;
    }
}
