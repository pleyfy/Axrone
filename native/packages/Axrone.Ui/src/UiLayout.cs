namespace Axrone.Ui;

/// <summary>Primary flow axis.</summary>
public enum UiAxis
{
    /// <summary>Horizontal flow.</summary>
    Row,

    /// <summary>Vertical flow.</summary>
    Column,
}

/// <summary>Whether children flow or overlay.</summary>
public enum UiDisplayMode
{
    /// <summary>Children flow through the layout policy.</summary>
    Stack,

    /// <summary>Children overlay the parent content box.</summary>
    Overlay,
}

/// <summary>Whether a node participates in flow or is absolutely positioned.</summary>
public enum UiPositionMode
{
    /// <summary>Participates in the parent flow.</summary>
    Flow,

    /// <summary>Positioned from inset/anchor values.</summary>
    Absolute,
}

/// <summary>Cross-axis alignment.</summary>
public enum UiAlign
{
    /// <summary>Align to the start edge.</summary>
    Start,

    /// <summary>Center on the cross axis.</summary>
    Center,

    /// <summary>Align to the end edge.</summary>
    End,

    /// <summary>Stretch to the cross-axis extent.</summary>
    Stretch,
}

/// <summary>Per-child cross-axis alignment override.</summary>
public enum UiAlignSelf
{
    /// <summary>Inherit the parent alignment.</summary>
    Auto,

    /// <summary>Align to the start edge.</summary>
    Start,

    /// <summary>Center on the cross axis.</summary>
    Center,

    /// <summary>Align to the end edge.</summary>
    End,

    /// <summary>Stretch to the cross-axis extent.</summary>
    Stretch,
}

/// <summary>Main-axis distribution.</summary>
public enum UiJustify
{
    /// <summary>Pack at the start.</summary>
    Start,

    /// <summary>Center the group.</summary>
    Center,

    /// <summary>Pack at the end.</summary>
    End,

    /// <summary>Equal spaces between children.</summary>
    SpaceBetween,

    /// <summary>Equal space around each child.</summary>
    SpaceAround,

    /// <summary>Equal space between and at the edges.</summary>
    SpaceEvenly,
}

/// <summary>How a length value is interpreted.</summary>
public enum UiLengthKind
{
    /// <summary>Intrinsic or parent-driven.</summary>
    Auto,

    /// <summary>Absolute UI pixels.</summary>
    Px,

    /// <summary>Percentage of the available extent.</summary>
    Percent,

    /// <summary>Intrinsic content size.</summary>
    Content,

    /// <summary>Stretch to the available extent.</summary>
    Stretch,

    /// <summary>Percentage of the viewport extent.</summary>
    Viewport,
}

/// <summary>Flex wrapping behavior.</summary>
public enum UiFlexWrap
{
    /// <summary>Single line.</summary>
    NoWrap,

    /// <summary>Wrap onto following lines.</summary>
    Wrap,

    /// <summary>Wrap onto preceding lines.</summary>
    WrapReverse,
}

/// <summary>Discriminated length value.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiLength(UiLengthKind Kind, float Value)
{
    /// <summary>Automatic length.</summary>
    public static UiLength Auto => new(UiLengthKind.Auto, 0.0f);

    /// <summary>Intrinsic content length.</summary>
    public static UiLength Content => new(UiLengthKind.Content, 0.0f);

    /// <summary>Absolute pixel length.</summary>
    public static UiLength Px(float value) => new(UiLengthKind.Px, value);

    /// <summary>Percentage of the available extent, expressed in 0..100.</summary>
    public static UiLength Percent(float value) => new(UiLengthKind.Percent, value);

    /// <summary>Stretch length with a relative weight.</summary>
    public static UiLength Stretch(float weight) => new(UiLengthKind.Stretch, weight);

    /// <summary>Percentage of the viewport extent, expressed in 0..100.</summary>
    public static UiLength Viewport(float value) => new(UiLengthKind.Viewport, value);
}

/// <summary>Resolved layout style for one node.</summary>
public readonly record struct UiLayoutStyle
{
    /// <summary>Flow/overlay mode.</summary>
    public UiDisplayMode Display { get; init; }

    /// <summary>Primary flow axis.</summary>
    public UiAxis Direction { get; init; }

    /// <summary>Gap between children.</summary>
    public float Gap { get; init; }

    /// <summary>Inner padding.</summary>
    public UiEdgeInsets Padding { get; init; }

    /// <summary>Outer margin.</summary>
    public UiEdgeInsets Margin { get; init; }

    /// <summary>Preferred width.</summary>
    public UiLength Width { get; init; }

    /// <summary>Preferred height.</summary>
    public UiLength Height { get; init; }

    /// <summary>Minimum width.</summary>
    public float MinWidth { get; init; }

    /// <summary>Minimum height.</summary>
    public float MinHeight { get; init; }

    /// <summary>Maximum width.</summary>
    public float MaxWidth { get; init; }

    /// <summary>Maximum height.</summary>
    public float MaxHeight { get; init; }

    /// <summary>Flex grow weight.</summary>
    public float Grow { get; init; }

    /// <summary>Flex shrink weight.</summary>
    public float Shrink { get; init; }

    /// <summary>Flex basis.</summary>
    public UiLength Basis { get; init; }

    /// <summary>Cross-axis child alignment.</summary>
    public UiAlign AlignItems { get; init; }

    /// <summary>Per-node cross-axis alignment override.</summary>
    public UiAlignSelf AlignSelf { get; init; }

    /// <summary>Main-axis distribution.</summary>
    public UiJustify JustifyContent { get; init; }

    /// <summary>Flex wrapping mode.</summary>
    public UiFlexWrap FlexWrap { get; init; }

    /// <summary>Flow/absolute position mode.</summary>
    public UiPositionMode Position { get; init; }

    /// <summary>Absolute top inset; <see cref="UiLength.Auto"/> when unset.</summary>
    public UiLength InsetTop { get; init; }

    /// <summary>Absolute right inset; <see cref="UiLength.Auto"/> when unset.</summary>
    public UiLength InsetRight { get; init; }

    /// <summary>Absolute bottom inset; <see cref="UiLength.Auto"/> when unset.</summary>
    public UiLength InsetBottom { get; init; }

    /// <summary>Absolute left inset; <see cref="UiLength.Auto"/> when unset.</summary>
    public UiLength InsetLeft { get; init; }

    /// <summary>Aspect ratio (width / height), zero for unset.</summary>
    public float AspectRatio { get; init; }

    /// <summary>Draw ordering hint inside the parent.</summary>
    public int ZIndex { get; init; }

    /// <summary>Gets the neutral style.</summary>
    public static UiLayoutStyle Default => new()
    {
        Display = UiDisplayMode.Stack,
        Direction = UiAxis.Column,
        Padding = UiEdgeInsets.Zero,
        Margin = UiEdgeInsets.Zero,
        Width = UiLength.Auto,
        Height = UiLength.Auto,
        MinWidth = 0.0f,
        MinHeight = 0.0f,
        MaxWidth = float.PositiveInfinity,
        MaxHeight = float.PositiveInfinity,
        Grow = 0.0f,
        Shrink = 1.0f,
        Basis = UiLength.Auto,
        AlignItems = UiAlign.Stretch,
        AlignSelf = UiAlignSelf.Auto,
        JustifyContent = UiJustify.Start,
        FlexWrap = UiFlexWrap.NoWrap,
        Position = UiPositionMode.Flow,
        InsetTop = UiLength.Auto,
        InsetRight = UiLength.Auto,
        InsetBottom = UiLength.Auto,
        InsetLeft = UiLength.Auto,
        AspectRatio = 0.0f,
        ZIndex = 0,
    };
}

/// <summary>Measure bounds passed down the layout tree.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiMeasureConstraints(float MinWidth, float MinHeight, float MaxWidth, float MaxHeight)
{
    /// <summary>Unbounded constraints.</summary>
    public static UiMeasureConstraints Unbounded =>
        new(0.0f, 0.0f, float.PositiveInfinity, float.PositiveInfinity);
}

/// <summary>Measured size plus optional baseline.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiMeasureResult(UiSize Size, float Baseline, bool HasBaseline);

/// <summary>Laid-out bounds and content box of one node.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiLayoutBox(UiNodeId Node, Rect Bounds, Rect Content);

/// <summary>One child measurement supplied to a layout policy.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiChildMeasurement(UiNodeId Node, UiSize Size, UiEdgeInsets Margin);

/// <summary>Read-only context passed to a measure/arrange policy.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiLayoutContext(
    UiNodeId Node,
    UiViewport Viewport,
    UiMeasureConstraints Constraints);

/// <summary>Adapter contract for one node in a layout tree.</summary>
public interface IUiLayoutNode
{
    /// <summary>Gets the node identity.</summary>
    UiNodeId Id { get; }

    /// <summary>Gets the resolved layout style.</summary>
    UiLayoutStyle Style { get; }

    /// <summary>Gets the immutable child list.</summary>
    ReadOnlySpan<UiNodeId> Children { get; }

    /// <summary>Measures leaf content (text, image, custom) for the given constraints.</summary>
    UiSize MeasureContent(in UiMeasureConstraints constraints);
}

/// <summary>Adapter contract for the document tree consumed by a layout engine.</summary>
public interface IUiLayoutTree
{
    /// <summary>Looks up one layout node.</summary>
    bool TryGetNode(UiNodeId id, out IUiLayoutNode? node);
}

/// <summary>Sink receiving arranged bounds for each node.</summary>
public interface IUiLayoutSink
{
    /// <summary>Writes the border and content boxes of one node.</summary>
    void SetBox(UiNodeId node, in Rect bounds, in Rect content);
}

/// <summary>
/// Monomorphized layout policy. Implementations replace the virtual dispatch of
/// per-node layout with static specialization while the engine drives traversal.
/// </summary>
/// <typeparam name="TSelf">Concrete policy type.</typeparam>
public interface IUiLayoutPolicy<TSelf> where TSelf : struct, IUiLayoutPolicy<TSelf>
{
    /// <summary>Measures a node from its style and already-measured children.</summary>
    static abstract UiMeasureResult Measure(
        in UiLayoutContext context,
        in UiLayoutStyle style,
        ReadOnlySpan<UiChildMeasurement> children);

    /// <summary>Arranges children inside the node's content box.</summary>
    static abstract void Arrange(
        in UiLayoutContext context,
        in UiLayoutStyle style,
        ReadOnlySpan<UiChildMeasurement> children,
        Span<Rect> childBounds);
}

/// <summary>Engine contract for measuring and arranging a UI layout tree.</summary>
public interface IUiLayoutEngine
{
    /// <summary>Measures one node subtree.</summary>
    UiMeasureResult Measure(IUiLayoutTree tree, UiNodeId node, in UiMeasureConstraints constraints);

    /// <summary>Arranges one node subtree and writes every node box to the sink.</summary>
    void Arrange(IUiLayoutTree tree, UiNodeId node, in Rect bounds, IUiLayoutSink sink);
}
