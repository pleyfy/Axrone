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

    /// <summary>Virtualized row/column grid.</summary>
    DataGrid = 24,

    /// <summary>Calendar date selector.</summary>
    DatePicker = 25,

    /// <summary>HSV/alpha color selector.</summary>
    ColorPicker = 26,

    /// <summary>Bar with a title and a back zone.</summary>
    NavigationBar = 27,

    /// <summary>Page container with a back stack.</summary>
    PageStack = 28,

    /// <summary>Horizontal pager over page controls.</summary>
    PageView = 29,

    /// <summary>Anchored popup container closed on Escape or outside clicks.</summary>
    Popup = 30,

    /// <summary>Clickable image surface.</summary>
    ImageFace = 31,

    /// <summary>Horizontal menu title strip.</summary>
    MenuBar = 32,

    /// <summary>Collapsible header and content section.</summary>
    Accordion = 33,

    /// <summary>Clickable path segments.</summary>
    Breadcrumb = 34,

    /// <summary>Removable tag.</summary>
    Chip = 35,

    /// <summary>Non-interactive status marker.</summary>
    Badge = 36,

    /// <summary>Indeterminate activity indicator advanced by the host tick.</summary>
    Spinner = 37,

    /// <summary>
    /// Externally registered widget dispatched through <see cref="UiWidgetRegistry"/>.
    /// Sentinel kind: it is intentionally absent from <see cref="ControlCatalog"/>;
    /// built-in kinds and their serialized values are frozen.
    /// </summary>
    Custom = 38,
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

    /// <summary>Back navigation requested.</summary>
    Back = 10,
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
/// <param name="Grid">Row/column source for <see cref="ControlKind.DataGrid"/>.</param>
/// <param name="Widget">Registry handle for <see cref="ControlKind.Custom"/> creation; default elsewhere.</param>
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
    IUiTreeSource? Tree = null,
    IUiGridSource? Grid = null,
    UiWidgetHandle Widget = default);

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
    string? Text)
{
    /// <summary>Gets the selected column of a data grid.</summary>
    public int Column { get; init; }

    /// <summary>Gets the horizontal scroll offset of a data grid.</summary>
    public float HorizontalOffset { get; init; }
}

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

/// <summary>Row/column source for <see cref="ControlKind.DataGrid"/>.</summary>
public interface IUiGridSource
{
    /// <summary>Gets the row count.</summary>
    int RowCount { get; }

    /// <summary>Gets the column count.</summary>
    int ColumnCount { get; }

    /// <summary>Gets the pixel width of a column.</summary>
    float GetColumnWidth(int column);
}

/// <summary>Packs 8-bit RGBA channels into the integer carried by color controls.</summary>
public static class UiColorCodec
{
    /// <summary>Packs four channels into one integer.</summary>
    public static int Pack(byte r, byte g, byte b, byte a) =>
        (r << 24) | (g << 16) | (b << 8) | a;

    /// <summary>Unpacks one integer into four channels.</summary>
    public static void Unpack(int packed, out byte r, out byte g, out byte b, out byte a)
    {
        r = (byte)(packed >> 24);
        g = (byte)(packed >> 16);
        b = (byte)(packed >> 8);
        a = (byte)packed;
    }
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
/// <param name="Widgets">Widget registry enabling <see cref="ControlKind.Custom"/> creation; <see langword="null"/> disables it.</param>
public readonly record struct UiControlRuntimeOptions(
    IUiTextMeasurer? TextMeasurer = null,
    IUiControlEventSink? Events = null,
    IUiImageMetrics? Images = null,
    IUiTheme? Theme = null,
    UiControlTheme? ThemeTokens = null,
    UiTextStyle DefaultTextStyle = default,
    UiViewport Viewport = default,
    UiWidgetRegistry? Widgets = null);
