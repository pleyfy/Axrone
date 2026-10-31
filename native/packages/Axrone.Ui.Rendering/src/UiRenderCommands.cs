namespace Axrone.Ui.Rendering;

/// <summary>Draw-list command discriminant.</summary>
public enum UiRenderCommandKind
{
    /// <summary>Solid/rounded quad.</summary>
    Quad,

    /// <summary>Textured or material image.</summary>
    Image,

    /// <summary>Pre-shaped text layout.</summary>
    Text,

    /// <summary>Vector stroke payload.</summary>
    Stroke,

    /// <summary>Application-defined command.</summary>
    Custom,
}

/// <summary>Image fit policy inside the destination box.</summary>
public enum UiImageFit
{
    /// <summary>Stretch to fill.</summary>
    Fill,

    /// <summary>Preserve aspect ratio and fit inside.</summary>
    Contain,

    /// <summary>Preserve aspect ratio and cover.</summary>
    Cover,

    /// <summary>Use the source size.</summary>
    None,

    /// <summary>Contain, but never upscale.</summary>
    ScaleDown,
}

/// <summary>Image sampling mode.</summary>
public enum UiImageSampling
{
    /// <summary>Linear filtering.</summary>
    Linear,

    /// <summary>Nearest filtering.</summary>
    Nearest,
}

/// <summary>Blend mode for UI batches.</summary>
public enum UiBlendMode
{
    /// <summary>Opaque.</summary>
    Opaque,

    /// <summary>Alpha blending.</summary>
    Alpha,

    /// <summary>Additive.</summary>
    Additive,

    /// <summary>Multiplicative.</summary>
    Multiply,
}

/// <summary>Per-command flags.</summary>
[Flags]
public enum UiRenderFlags
{
    /// <summary>No flags.</summary>
    None = 0,

    /// <summary>A clip rectangle is present.</summary>
    Clip = 1 << 0,

    /// <summary>Mirror horizontally.</summary>
    FlipX = 1 << 1,

    /// <summary>Mirror vertically.</summary>
    FlipY = 1 << 2,

    /// <summary>The image is nine-sliced using the slice border.</summary>
    NineSlice = 1 << 3,
}

/// <summary>
/// Backend-agnostic draw command. One tagged payload carries the superset of
/// quad, image, text, stroke and custom fields; consumers switch on
/// <see cref="Kind"/> and read only the relevant members.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiRenderCommand
{
    /// <summary>Gets the command kind.</summary>
    public UiRenderCommandKind Kind { get; init; }

    /// <summary>Gets the source node.</summary>
    public UiNodeId Node { get; init; }

    /// <summary>Gets the destination rectangle.</summary>
    public Rect Bounds { get; init; }

    /// <summary>Gets the clip rectangle when <see cref="UiRenderFlags.Clip"/> is set.</summary>
    public Rect Clip { get; init; }

    /// <summary>Gets the fill/tint/text color.</summary>
    public UiColor Color { get; init; }

    /// <summary>Gets the border color.</summary>
    public UiColor BorderColor { get; init; }

    /// <summary>Gets the border width.</summary>
    public float BorderWidth { get; init; }

    /// <summary>Gets the corner radii.</summary>
    public UiCornerRadii Radius { get; init; }

    /// <summary>Gets the opacity multiplier.</summary>
    public float Opacity { get; init; }

    /// <summary>Gets the draw order inside the frame.</summary>
    public int ZIndex { get; init; }

    /// <summary>Gets the texture/material/payload resource.</summary>
    public UiResourceId Resource { get; init; }

    /// <summary>Gets the normalized source UV rectangle.</summary>
    public Rect UvRect { get; init; }

    /// <summary>Gets the pre-shaped text layout.</summary>
    public UiTextLayoutId TextLayout { get; init; }

    /// <summary>Gets the image fit policy.</summary>
    public UiImageFit Fit { get; init; }

    /// <summary>Gets the image sampling mode.</summary>
    public UiImageSampling Sampling { get; init; }

    /// <summary>Gets the nine-slice border insets.</summary>
    public UiEdgeInsets SliceBorder { get; init; }

    /// <summary>Gets the command flags.</summary>
    public UiRenderFlags Flags { get; init; }

    /// <summary>Creates a quad command.</summary>
    public static UiRenderCommand Quad(
        UiNodeId node,
        in Rect bounds,
        in UiColor color,
        int zIndex,
        float opacity = 1.0f) =>
        new()
        {
            Kind = UiRenderCommandKind.Quad,
            Node = node,
            Bounds = bounds,
            Color = color,
            ZIndex = zIndex,
            Opacity = opacity,
        };

    /// <summary>Creates an image command.</summary>
    public static UiRenderCommand Image(
        UiNodeId node,
        in Rect bounds,
        UiResourceId resource,
        in Rect uvRect,
        in UiColor tint,
        int zIndex,
        float opacity = 1.0f,
        UiImageFit fit = UiImageFit.Fill,
        UiImageSampling sampling = UiImageSampling.Linear) =>
        new()
        {
            Kind = UiRenderCommandKind.Image,
            Node = node,
            Bounds = bounds,
            Color = tint,
            ZIndex = zIndex,
            Opacity = opacity,
            Resource = resource,
            UvRect = uvRect,
            Fit = fit,
            Sampling = sampling,
        };

    /// <summary>Creates a text command.</summary>
    public static UiRenderCommand Text(
        UiNodeId node,
        in Rect bounds,
        UiTextLayoutId layout,
        in UiColor color,
        int zIndex,
        float opacity = 1.0f) =>
        new()
        {
            Kind = UiRenderCommandKind.Text,
            Node = node,
            Bounds = bounds,
            Color = color,
            ZIndex = zIndex,
            Opacity = opacity,
            TextLayout = layout,
        };

    /// <summary>Creates a stroke command.</summary>
    public static UiRenderCommand Stroke(
        UiNodeId node,
        UiResourceId payload,
        int zIndex,
        float opacity = 1.0f) =>
        new()
        {
            Kind = UiRenderCommandKind.Stroke,
            Node = node,
            ZIndex = zIndex,
            Opacity = opacity,
            Resource = payload,
        };

    /// <summary>Creates a custom command.</summary>
    public static UiRenderCommand Custom(
        UiNodeId node,
        UiResourceId payload,
        int zIndex,
        float opacity = 1.0f) =>
        new()
        {
            Kind = UiRenderCommandKind.Custom,
            Node = node,
            ZIndex = zIndex,
            Opacity = opacity,
            Resource = payload,
        };

    /// <summary>Returns a copy clipped to the given rectangle.</summary>
    public UiRenderCommand WithClip(in Rect clip) =>
        this with
        {
            Clip = clip,
            Flags = Flags | UiRenderFlags.Clip,
        };

    /// <summary>Returns a copy using the given nine-slice border.</summary>
    public UiRenderCommand WithSliceBorder(in UiEdgeInsets border) =>
        this with
        {
            SliceBorder = border,
            Flags = Flags | UiRenderFlags.NineSlice,
        };
}

/// <summary>Per-frame draw list statistics.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFrameMetrics(
    int WidgetCount,
    int VisibleWidgetCount,
    int RenderCount,
    int CustomCommandCount,
    int ImageCommandCount,
    int TextCommandCount,
    int StrokeCommandCount,
    int GlyphCount,
    int LayoutPasses);

/// <summary>One immutable UI frame submitted to a backend.</summary>
public interface IUiFrame
{
    /// <summary>Gets the viewport the frame was built for.</summary>
    UiViewport Viewport { get; }

    /// <summary>Gets the frame statistics.</summary>
    UiFrameMetrics Metrics { get; }

    /// <summary>Gets the ordered draw commands.</summary>
    ReadOnlySpan<UiRenderCommand> Commands { get; }
}

/// <summary>Mutable draw-list contract used by the frame builder.</summary>
public interface IUiDrawList
{
    /// <summary>Gets the command count.</summary>
    int Count { get; }

    /// <summary>Gets the ordered command view.</summary>
    ReadOnlySpan<UiRenderCommand> Commands { get; }

    /// <summary>Appends one command.</summary>
    void Add(in UiRenderCommand command);

    /// <summary>Clears the list for reuse.</summary>
    void Clear();
}
