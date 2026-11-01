namespace Axrone.Ui.Controls;

using Axrone.Ui;

/// <summary>Lifecycle stage of a control.</summary>
internal enum ControlStatus : byte
{
    Created = 0,
    Mounted = 1,
    Disposed = 2,
}

/// <summary>
/// Mutable per-control record. Fields are grouped by consuming family: text
/// controls own <see cref="Text"/>/<see cref="TextStyle"/>/<see cref="Caret"/>,
/// selectors own <see cref="Options"/>/<see cref="Index"/>/<see cref="Open"/>/
/// <see cref="OptionNodes"/>, range controls own
/// <see cref="Value"/>/<see cref="MinValue"/>/<see cref="MaxValue"/>/
/// <see cref="Step"/>, and scroll views own <see cref="ScrollOffset"/>.
/// </summary>
internal struct ControlEntry
{
    public ControlKind Kind;
    public UiNodeId Node;
    public UiResourceId Image;
    public UiNodeId[]? OptionNodes;
    public string[]? Options;
    public UiTextStyle TextStyle;
    public string Text;
    public ControlStatus Status;
    public bool Disabled;
    public bool Visible;
    public bool PointerInside;
    public bool Pressed;
    public bool Focused;
    public bool Checked;
    public bool Open;
    public float Value;
    public float MinValue;
    public float MaxValue;
    public float Step;
    public int Index;
    public float ScrollOffset;
    public int Caret;
    public uint Generation;
}
