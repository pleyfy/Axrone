namespace Axrone.Ui.Controls;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;

/// <summary>Hit information for one pointer event addressed to a widget-owned node.</summary>
/// <param name="Node">The node the event was routed to.</param>
/// <param name="IsPrimary">Whether the node is the widget's primary node.</param>
/// <param name="ChildIndex">The index of the child node within its owning widget.</param>
public readonly record struct UiWidgetPointerHit(UiNodeId Node, bool IsPrimary, int ChildIndex);

/// <summary>Theme token lookup surface handed to widget behaviors.</summary>
public readonly struct UiWidgetThemeContext
{
    private readonly IUiTheme? _theme;

    internal UiWidgetThemeContext(IUiTheme? theme, in UiControlTheme tokens)
    {
        _theme = theme;
        Tokens = tokens;
    }

    /// <summary>Gets the token identity map in use.</summary>
    public UiControlTheme Tokens { get; }

    /// <summary>Resolves a color token or returns the fallback.</summary>
    public UiColor Color(UiThemeTokenId token, UiColor fallback) =>
        _theme is not null && _theme.TryGetColor(token, out UiColor value) ? value : fallback;

    /// <summary>Resolves a numeric token or returns the fallback.</summary>
    public float Number(UiThemeTokenId token, float fallback) =>
        _theme is not null && _theme.TryGetNumber(token, out float value) ? value : fallback;

    internal IUiTheme? Theme => _theme;
}

/// <summary>State snapshot handed to widget style projection.</summary>
public readonly record struct UiWidgetVisualContext
{
    /// <summary>Gets the resolved interaction state.</summary>
    public required UiControlState State { get; init; }

    /// <summary>Gets whether the primary node has focus.</summary>
    public required bool Focused { get; init; }

    /// <summary>Gets the checked flag.</summary>
    public required bool Checked { get; init; }

    /// <summary>Gets the open flag.</summary>
    public required bool Open { get; init; }

    /// <summary>Gets the current value.</summary>
    public required float Value { get; init; }

    /// <summary>Gets the current selection index.</summary>
    public required int Index { get; init; }

    /// <summary>Gets the control text.</summary>
    public required string Text { get; init; }

    /// <summary>Gets the theme lookup context.</summary>
    public required UiWidgetThemeContext Theme { get; init; }
}

/// <summary>Runtime handle a widget behavior uses to mutate its control.</summary>
public readonly record struct UiWidgetSession(UiControlRuntime Runtime, UiControl Control)
{
    /// <summary>Replaces the primary node's layout style.</summary>
    public bool SetLayoutStyle(in UiLayoutStyle style) => Runtime.SetLayoutStyle(Control, in style);

    /// <summary>Replaces the control text.</summary>
    public bool SetText(string text) => Runtime.SetText(Control, text);

    /// <summary>Sets the control value, clamped to the control's min/max range.</summary>
    public bool SetValue(float value) => Runtime.SetValue(Control, value);

    /// <summary>Sets the checked flag.</summary>
    public bool SetChecked(bool value) => Runtime.SetChecked(Control, value);

    /// <summary>Sets the open flag.</summary>
    public bool SetOpen(bool open) => Runtime.SetOpen(Control, open);

    /// <summary>Sets the selection index.</summary>
    public bool SetSelectedIndex(int index) => Runtime.SetSelectedIndex(Control, index);

    /// <summary>Marks whether the pointer is inside the control for widget-driven state machines.</summary>
    public bool SetPointerInside(bool inside) => Runtime.SetPointerInside(Control, inside);

    /// <summary>Marks whether the control is pressed for widget-driven state machines.</summary>
    public bool SetPressed(bool pressed) => Runtime.SetPressed(Control, pressed);

    /// <summary>Reads the control's current snapshot.</summary>
    public bool TryGetSnapshot(out UiControlSnapshot snapshot) => Runtime.TryGetSnapshot(Control, out snapshot);

    /// <summary>Re-reads the style patch of the control and refreshes dependents.</summary>
    public bool Refresh() => Runtime.RefreshControl(Control);

    /// <summary>Creates a child node owned by the control at the given child index.</summary>
    public UiNodeId AddChildNode(int childIndex) => Runtime.AddControlChildNode(Control, childIndex);

    /// <summary>Removes a child node owned by the control.</summary>
    public bool RemoveChildNode(UiNodeId node) => Runtime.RemoveControlChildNode(Control, node);

    /// <summary>Replaces the layout style of a control-owned node.</summary>
    public bool SetChildLayoutStyle(UiNodeId node, in UiLayoutStyle style) => Runtime.SetControlNodeLayoutStyle(Control, node, in style);

    /// <summary>Replaces the style patch of a control-owned node.</summary>
    public bool SetChildStyle(UiNodeId node, in UiStylePatch patch) => Runtime.SetControlNodeStyle(Control, node, in patch);

    /// <summary>Registers text on a control-owned node for measurement and rendering.</summary>
    public bool SetChildText(UiNodeId node, string text) => Runtime.SetControlNodeText(Control, node, text);

    /// <summary>Gets the laid-out bounds of a node.</summary>
    public bool TryGetBounds(UiNodeId node, out Axrone.Numeric.Rect bounds) => Runtime.TryGetBounds(node, out bounds);

    /// <summary>Emits an observable control outcome.</summary>
    public void Emit(UiControlEventKind kind, float value, bool checkedFlag, int index, string? text) =>
        Runtime.EmitControlEvent(Control, kind, value, checkedFlag, index, text);
}

/// <summary>
/// Third-party widget contract resolved through <see cref="UiWidgetRegistry"/>.
/// Implementations are stateless singletons; per-instance data lives in the
/// control entry and is read through <see cref="UiWidgetVisualContext"/> or
/// <see cref="UiWidgetSession.TryGetSnapshot(out UiControlSnapshot)"/>.
/// </summary>
public interface IUiWidgetBehavior
{
    /// <summary>Gets whether the widget's primary node receives pointer and key events.</summary>
    bool IsInteractive => false;

    /// <summary>Gets whether the widget can take focus.</summary>
    bool IsFocusable => false;

    /// <summary>Gets the base layout style of the primary node.</summary>
    UiLayoutStyle CreateLayoutStyle(in UiWidgetThemeContext theme);

    /// <summary>Builds the state-dependent style patch of the primary node.</summary>
    UiStylePatch CreateStylePatch(in UiWidgetVisualContext context);

    /// <summary>Runs once after the control is created.</summary>
    void OnInitialize(UiWidgetSession session, in UiControlDefinition definition)
    {
    }

    /// <summary>Handles a pointer event addressed to a widget-owned node.</summary>
    bool OnPointer(UiWidgetSession session, in UiWidgetPointerHit hit, in UiPointerEvent args, UiRoutingPhase phase) => false;

    /// <summary>Handles a key event addressed to the primary node.</summary>
    bool OnKey(UiWidgetSession session, in UiKeyEvent args, UiRoutingPhase phase) => false;

    /// <summary>Handles committed text addressed to the primary node.</summary>
    bool OnText(UiWidgetSession session, in UiTextInputEvent args, UiRoutingPhase phase) => false;

    /// <summary>Observes focus transitions of the primary node.</summary>
    void OnFocusChanged(UiWidgetSession session, bool focused)
    {
    }

    /// <summary>Gets whether the child at the given index is hit-testable.</summary>
    bool IsChildHitTestable(in UiWidgetVisualContext context, int childIndex) => false;
}
