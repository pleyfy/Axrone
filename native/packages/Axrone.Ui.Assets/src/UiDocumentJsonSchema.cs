namespace Axrone.Ui.Assets;

/// <summary>Wire constants and enum mappings shared by the reader and writer.</summary>
internal static class UiDocumentJsonSchema
{
    public const string FormatId = "axrone.ui.json";
    public const int Version = 1;
    public const int MaxNodes = 262_144;
    public const int MaxBindings = 65_536;
    public const int MaxStringBytes = 1_048_576;
    public const int MaxNodeDepth = 128;
    public const int MaxJsonDepth = 256;

    public const UiNodeFlags DefaultFlags =
        UiNodeFlags.Visible | UiNodeFlags.Enabled | UiNodeFlags.Interactive;

    public static UiNodeKind KindFromRole(ReadOnlySpan<byte> role)
    {
        if (role.SequenceEqual("root"u8))
        {
            return UiNodeKind.Root;
        }

        if (role.SequenceEqual("container"u8) || role.SequenceEqual("panel"u8))
        {
            return UiNodeKind.Container;
        }

        if (role.SequenceEqual("text"u8))
        {
            return UiNodeKind.Text;
        }

        if (role.SequenceEqual("image"u8))
        {
            return UiNodeKind.Image;
        }

        if (role.SequenceEqual("button"u8))
        {
            return UiNodeKind.Button;
        }

        if (role.SequenceEqual("input"u8))
        {
            return UiNodeKind.Input;
        }

        return UiNodeKind.Custom;
    }

    public static ReadOnlySpan<byte> RoleFromKind(UiNodeKind kind) => kind switch
    {
        UiNodeKind.Root => "root"u8,
        UiNodeKind.Container => "container"u8,
        UiNodeKind.Text => "text"u8,
        UiNodeKind.Image => "image"u8,
        UiNodeKind.Button => "button"u8,
        UiNodeKind.Input => "input"u8,
        _ => "custom"u8,
    };

    public static ReadOnlySpan<byte> ScaleMode(UiCanvasScaleMode mode) => mode switch
    {
        UiCanvasScaleMode.MatchWidth => "match-width"u8,
        UiCanvasScaleMode.MatchHeight => "match-height"u8,
        UiCanvasScaleMode.Fill => "fill"u8,
        UiCanvasScaleMode.Fixed => "fixed"u8,
        _ => "match-width-or-height"u8,
    };

    public static bool TryParseScaleMode(ref Utf8JsonReader reader, out UiCanvasScaleMode mode)
    {
        if (reader.TokenType != JsonTokenType.String)
        {
            mode = default;
            return false;
        }

        if (reader.ValueTextEquals("match-width"u8))
        {
            mode = UiCanvasScaleMode.MatchWidth;
        }
        else if (reader.ValueTextEquals("match-height"u8))
        {
            mode = UiCanvasScaleMode.MatchHeight;
        }
        else if (reader.ValueTextEquals("match-width-or-height"u8))
        {
            mode = UiCanvasScaleMode.MatchWidthOrHeight;
        }
        else if (reader.ValueTextEquals("fill"u8))
        {
            mode = UiCanvasScaleMode.Fill;
        }
        else if (reader.ValueTextEquals("fixed"u8))
        {
            mode = UiCanvasScaleMode.Fixed;
        }
        else
        {
            mode = default;
            return false;
        }

        return true;
    }

    public static ReadOnlySpan<byte> Display(UiDisplayMode mode) =>
        mode == UiDisplayMode.Overlay ? "overlay"u8 : "stack"u8;

    public static ReadOnlySpan<byte> Axis(UiAxis axis) =>
        axis == UiAxis.Row ? "row"u8 : "column"u8;

    public static ReadOnlySpan<byte> Align(UiAlign align) => align switch
    {
        UiAlign.Center => "center"u8,
        UiAlign.End => "end"u8,
        UiAlign.Stretch => "stretch"u8,
        _ => "start"u8,
    };

    public static ReadOnlySpan<byte> AlignSelf(UiAlignSelf align) => align switch
    {
        UiAlignSelf.Center => "center"u8,
        UiAlignSelf.End => "end"u8,
        UiAlignSelf.Stretch => "stretch"u8,
        UiAlignSelf.Start => "start"u8,
        _ => "auto"u8,
    };

    public static ReadOnlySpan<byte> Justify(UiJustify justify) => justify switch
    {
        UiJustify.Center => "center"u8,
        UiJustify.End => "end"u8,
        UiJustify.SpaceBetween => "space-between"u8,
        UiJustify.SpaceAround => "space-around"u8,
        UiJustify.SpaceEvenly => "space-evenly"u8,
        _ => "start"u8,
    };

    public static ReadOnlySpan<byte> FlexWrap(UiFlexWrap wrap) => wrap switch
    {
        UiFlexWrap.Wrap => "wrap"u8,
        UiFlexWrap.WrapReverse => "wrap-reverse"u8,
        _ => "no-wrap"u8,
    };

    public static ReadOnlySpan<byte> Position(UiPositionMode position) =>
        position == UiPositionMode.Absolute ? "absolute"u8 : "flow"u8;

    public static ReadOnlySpan<byte> FontStyle(UiFontStyle style) => style switch
    {
        UiFontStyle.Italic => "italic"u8,
        UiFontStyle.Oblique => "oblique"u8,
        _ => "normal"u8,
    };

    public static ReadOnlySpan<byte> TextWrap(UiTextWrap wrap) => wrap switch
    {
        UiTextWrap.None => "none"u8,
        UiTextWrap.Grapheme => "grapheme"u8,
        _ => "word"u8,
    };

    public static ReadOnlySpan<byte> TextOverflow(UiTextOverflow overflow) =>
        overflow == UiTextOverflow.Ellipsis ? "ellipsis"u8 : "clip"u8;

    public static ReadOnlySpan<byte> TextAlign(UiTextAlign align) => align switch
    {
        UiTextAlign.Center => "center"u8,
        UiTextAlign.End => "end"u8,
        UiTextAlign.Justify => "justify"u8,
        _ => "start"u8,
    };

    public static ReadOnlySpan<byte> TextDirection(UiTextDirection direction) => direction switch
    {
        UiTextDirection.Ltr => "ltr"u8,
        UiTextDirection.Rtl => "rtl"u8,
        _ => "auto"u8,
    };

    public static ReadOnlySpan<byte> TextAutoSize(UiTextAutoSize autoSize) =>
        autoSize == UiTextAutoSize.ShrinkToFit ? "shrink-to-fit"u8 : "none"u8;

    public static ReadOnlySpan<byte> ImageFit(UiImageFit fit) => fit switch
    {
        UiImageFit.Contain => "contain"u8,
        UiImageFit.Cover => "cover"u8,
        UiImageFit.None => "none"u8,
        UiImageFit.ScaleDown => "scale-down"u8,
        _ => "fill"u8,
    };

    public static ReadOnlySpan<byte> ImageSourceKind(UiImageSourceKind kind) =>
        kind == UiImageSourceKind.Material ? "material"u8 : "texture"u8;
}
