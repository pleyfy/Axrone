namespace Axrone.Ui;

/// <summary>Canvas scaling policy used by a UI document.</summary>
public enum UiCanvasScaleMode
{
    /// <summary>Match the reference width.</summary>
    MatchWidth,

    /// <summary>Match the reference height.</summary>
    MatchHeight,

    /// <summary>Blend width and height matching.</summary>
    MatchWidthOrHeight,

    /// <summary>Fill the viewport non-uniformly.</summary>
    Fill,

    /// <summary>Use one-to-one pixels and letterbox.</summary>
    Fixed,
}

/// <summary>Reference resolution, scaling policy and safe area of a UI document.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiCanvasConfig(
    float ReferenceWidth,
    float ReferenceHeight,
    UiCanvasScaleMode ScaleMode,
    float MatchBias,
    UiEdgeInsets SafeArea);

/// <summary>Structural node kind.</summary>
public enum UiNodeKind
{
    /// <summary>Document root.</summary>
    Root,

    /// <summary>Generic container.</summary>
    Container,

    /// <summary>Text-only node.</summary>
    Text,

    /// <summary>Image node.</summary>
    Image,

    /// <summary>Button-like interactive node.</summary>
    Button,

    /// <summary>Text input node.</summary>
    Input,

    /// <summary>Application-defined node.</summary>
    Custom,
}

/// <summary>Compact node presence and interaction flags.</summary>
[Flags]
public enum UiNodeFlags
{
    /// <summary>No flags.</summary>
    None = 0,

    /// <summary>Node participates in rendering and hit testing.</summary>
    Visible = 1 << 0,

    /// <summary>Node accepts interaction.</summary>
    Enabled = 1 << 1,

    /// <summary>Node receives pointer/key events.</summary>
    Interactive = 1 << 2,

    /// <summary>Node can take focus.</summary>
    Focusable = 1 << 3,

    /// <summary>Node clips descendants to its content box.</summary>
    Clip = 1 << 4,

    /// <summary>Node begins a focus scope.</summary>
    FocusScope = 1 << 5,
}

/// <summary>Compact linked-node record; child order follows the sibling links.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiNodeRecord(
    UiNodeId Id,
    UiNodeId Parent,
    UiNodeId FirstChild,
    UiNodeId NextSibling,
    UiNodeKind Kind,
    UiNodeFlags Flags);

/// <summary>Read-only document tree contract.</summary>
public interface IUiNodeTree
{
    /// <summary>Gets the addressed node count.</summary>
    int Count { get; }

    /// <summary>Gets the root node.</summary>
    UiNodeId Root { get; }

    /// <summary>Looks up one node record.</summary>
    bool TryGetNode(UiNodeId id, out UiNodeRecord record);

    /// <summary>Gets the immutable child list of one node.</summary>
    ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id);
}

/// <summary>Document metadata and canvas configuration.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiDocumentInfo(
    UiDocumentId Id,
    string Name,
    int Version,
    UiCanvasConfig Canvas);

/// <summary>One UI document: metadata plus its node tree.</summary>
public interface IUiDocument
{
    /// <summary>Gets document metadata.</summary>
    UiDocumentInfo Info { get; }

    /// <summary>Gets the node tree.</summary>
    IUiNodeTree Nodes { get; }
}

/// <summary>Builder contract for constructing documents outside the core package.</summary>
public interface IUiDocumentBuilder
{
    /// <summary>Creates a node and returns its identity.</summary>
    UiNodeId CreateNode(UiNodeKind kind, UiNodeFlags flags);

    /// <summary>Appends a child to a parent.</summary>
    bool TryAppendChild(UiNodeId parent, UiNodeId child);

    /// <summary>Removes a node and its subtree.</summary>
    bool TryRemoveNode(UiNodeId node);

    /// <summary>Builds an immutable document over the current tree.</summary>
    IUiDocument Build(in UiDocumentInfo info);
}
