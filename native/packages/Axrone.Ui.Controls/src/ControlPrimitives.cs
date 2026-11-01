namespace Axrone.Ui.Controls;

using Axrone.Ui;

/// <summary>Control kind identity; also the catalog index.</summary>
public enum ControlKind : byte
{
    /// <summary>Layout container.</summary>
    Panel = 0,

    /// <summary>Static text.</summary>
    Label = 1,

    /// <summary>Static image.</summary>
    Image = 2,

    /// <summary>Clickable button.</summary>
    Button = 3,

    /// <summary>Check box with label.</summary>
    Checkbox = 4,

    /// <summary>On/off switch.</summary>
    Toggle = 5,

    /// <summary>Continuous value slider.</summary>
    Slider = 6,

    /// <summary>Single-line text input.</summary>
    TextInput = 7,

    /// <summary>Clipping scroll container.</summary>
    ScrollView = 8,

    /// <summary>Select list.</summary>
    Dropdown = 9,

    /// <summary>Progress indicator.</summary>
    ProgressBar = 10,

    /// <summary>Exclusive option group.</summary>
    RadioGroup = 11,

    /// <summary>Multi-line text editor.</summary>
    TextArea = 12,

    /// <summary>Tab header strip bound to page controls.</summary>
    TabView = 13,

    /// <summary>Virtualized single-column list.</summary>
    ListView = 14,

    /// <summary>Hierarchical list with expand/collapse rows.</summary>
    TreeView = 15,

    /// <summary>Menu button with an open item list below the header.</summary>
    Menu = 16,

    /// <summary>Non-interactive text overlay shown on demand.</summary>
    Tooltip = 17,

    /// <summary>Modal content container closed with Escape.</summary>
    Dialog = 18,

    /// <summary>Timed transient text overlay.</summary>
    Toast = 19,

    /// <summary>Equal-width exclusive segment strip.</summary>
    SegmentedControl = 20,

    /// <summary>Numeric stepper with decrement/increment halves.</summary>
    Stepper = 21,

    /// <summary>Star rating selector.</summary>
    Rating = 22,

    /// <summary>Two panes separated by a draggable splitter.</summary>
    SplitPane = 23,
}

/// <summary>Resolved control interaction state.</summary>
public enum UiControlState : byte
{
    /// <summary>Idle.</summary>
    Normal = 0,

    /// <summary>Pointer is over the control.</summary>
    Hover = 1,

    /// <summary>Primary button is held on the control.</summary>
    Pressed = 2,

    /// <summary>Control rejects interaction.</summary>
    Disabled = 3,
}

/// <summary>Observable control outcomes.</summary>
public enum UiControlEventKind : byte
{
    /// <summary>Activation completed.</summary>
    Click = 0,

    /// <summary>Value changed during interaction.</summary>
    ValueChanged = 1,

    /// <summary>Value committed at the end of interaction.</summary>
    ValueCommitted = 2,

    /// <summary>Checked flag changed.</summary>
    CheckedChanged = 3,

    /// <summary>Selection index changed.</summary>
    SelectionChanged = 4,

    /// <summary>Text content changed.</summary>
    TextChanged = 5,

    /// <summary>Text editing committed.</summary>
    TextCommitted = 6,

    /// <summary>Scroll offset changed.</summary>
    ScrollChanged = 7,

    /// <summary>Popup opened or closed.</summary>
    OpenChanged = 8,

    /// <summary>Focus gained or lost.</summary>
    FocusChanged = 9,
}

/// <summary>Creation inputs for one control; each kind consumes the fields it needs.</summary>
/// <param name="Text">Initial text, or newline-separated option labels for selectors.</param>
/// <param name="Image">Image resource for <see cref="ControlKind.Image"/>.</param>
/// <param name="Value">Initial value for sliders and progress bars.</param>
/// <param name="Checked">Initial checked flag for checkboxes and toggles.</param>
/// <param name="SelectedIndex">Initial selection for dropdowns and radio groups.</param>
/// <param name="MinValue">Slider minimum.</param>
/// <param name="MaxValue">Slider maximum.</param>
/// <param name="Step">Slider keyboard/step increment.</param>
/// <param name="TextStyle">Text style override; an invalid face inherits the runtime default.</param>
/// <param name="Items">Row-count source for <see cref="ControlKind.ListView"/>.</param>
/// <param name="Tree">Node/child source for <see cref="ControlKind.TreeView"/>.</param>
public readonly record struct UiControlDefinition(
    string? Text = null,
    UiResourceId Image = default,
    float Value = 0.0f,
    bool Checked = false,
    int SelectedIndex = 0,
    float MinValue = 0.0f,
    float MaxValue = 1.0f,
    float Step = 0.1f,
    UiTextStyle TextStyle = default,
    IUiListItemSource? Items = null,
    IUiTreeSource? Tree = null);

/// <summary>Live handle to one control.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiControl(int Index, uint Generation, UiNodeId Node)
{
    /// <summary>Gets the invalid handle.</summary>
    public static UiControl Invalid => default;

    /// <summary>Gets whether the handle names a created control.</summary>
    public bool IsValid => Node.IsValid;
}

/// <summary>One observable control outcome.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiControlEvent(
    UiNodeId Node,
    ControlKind Kind,
    UiControlEventKind EventKind,
    float Value,
    bool Checked,
    int Index,
    string? Text);

/// <summary>Receives control outcomes synchronously.</summary>
public interface IUiControlEventSink
{
    /// <summary>Called for every control outcome.</summary>
    void OnControlEvent(in UiControlEvent args);
}

/// <summary>Read-only control state view.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiControlSnapshot(
    ControlKind Kind,
    UiControlState State,
    bool Focused,
    bool Checked,
    bool IsOpen,
    float Value,
    int Index,
    float ScrollOffset,
    string? Text);

/// <summary>Row-count source for <see cref="ControlKind.ListView"/>.</summary>
public interface IUiListItemSource
{
    /// <summary>Gets the number of rows.</summary>
    int Count { get; }
}

/// <summary>Hierarchy source for <see cref="ControlKind.TreeView"/>; node ids are provider handles.</summary>
public interface IUiTreeSource
{
    /// <summary>Gets the number of root nodes.</summary>
    int RootCount { get; }

    /// <summary>Gets a root node id by index.</summary>
    int GetRoot(int index);

    /// <summary>Gets the child count of a node.</summary>
    int GetChildCount(int node);

    /// <summary>Gets a child node id by index.</summary>
    int GetChild(int node, int childIndex);
}

/// <summary>Intrinsic image size source used by <see cref="ControlKind.Image"/> sizing.</summary>
public interface IUiImageMetrics
{
    /// <summary>Gets the intrinsic size of an image resource.</summary>
    bool TryGetSize(UiResourceId image, out UiSize size);
}

/// <summary>Runtime construction options.</summary>
/// <param name="TextMeasurer">Text metrics provider; text controls measure zero without one.</param>
/// <param name="Events">Control outcome sink.</param>
/// <param name="Images">Intrinsic image size provider.</param>
/// <param name="Theme">Theme token table consumed by control styles.</param>
/// <param name="ThemeTokens">Token identity map; <see langword="null"/> selects the default map.</param>
/// <param name="DefaultTextStyle">Text style inherited by text controls.</param>
/// <param name="Viewport">Initial viewport for viewport-relative layout lengths.</param>
public readonly record struct UiControlRuntimeOptions(
    IUiTextMeasurer? TextMeasurer = null,
    IUiControlEventSink? Events = null,
    IUiImageMetrics? Images = null,
    IUiTheme? Theme = null,
    UiControlTheme? ThemeTokens = null,
    UiTextStyle DefaultTextStyle = default,
    UiViewport Viewport = default);
