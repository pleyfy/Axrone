namespace Axrone.Ui;

/// <summary>Font weight. <see cref="Default"/> inherits the style source default.</summary>
public enum UiFontWeight
{
    /// <summary>Inherit the default weight.</summary>
    Default = 0,

    /// <summary>Thin (100).</summary>
    Thin = 100,

    /// <summary>Extra light (200).</summary>
    ExtraLight = 200,

    /// <summary>Light (300).</summary>
    Light = 300,

    /// <summary>Normal (400).</summary>
    Normal = 400,

    /// <summary>Medium (500).</summary>
    Medium = 500,

    /// <summary>Semi bold (600).</summary>
    SemiBold = 600,

    /// <summary>Bold (700).</summary>
    Bold = 700,

    /// <summary>Extra bold (800).</summary>
    ExtraBold = 800,

    /// <summary>Black (900).</summary>
    Black = 900,
}

/// <summary>Font slant.</summary>
public enum UiFontStyle
{
    /// <summary>Upright.</summary>
    Normal,

    /// <summary>Italic.</summary>
    Italic,

    /// <summary>Oblique.</summary>
    Oblique,
}

/// <summary>Text wrapping mode.</summary>
public enum UiTextWrap
{
    /// <summary>No wrapping.</summary>
    None,

    /// <summary>Wrap at word boundaries.</summary>
    Word,

    /// <summary>Wrap at grapheme boundaries.</summary>
    Grapheme,
}

/// <summary>Overflow handling once text exceeds the available box.</summary>
public enum UiTextOverflow
{
    /// <summary>Clip the text.</summary>
    Clip,

    /// <summary>Append an ellipsis.</summary>
    Ellipsis,
}

/// <summary>Horizontal text alignment.</summary>
public enum UiTextAlign
{
    /// <summary>Start edge.</summary>
    Start,

    /// <summary>Center.</summary>
    Center,

    /// <summary>End edge.</summary>
    End,

    /// <summary>Justify wrapped lines.</summary>
    Justify,
}

/// <summary>Requested/resolved text direction.</summary>
public enum UiTextDirection
{
    /// <summary>Detect or inherit.</summary>
    Auto,

    /// <summary>Left to right.</summary>
    Ltr,

    /// <summary>Right to left.</summary>
    Rtl,
}

/// <summary>Resolved font query.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontQuery(
    UiFontFamilyId Family,
    UiFontWeight Weight,
    UiFontStyle Style,
    string Locale);

/// <summary>One glyph metric in font units or UI pixels, as reported by the provider.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiGlyphMetrics(
    int CodePoint,
    float Advance,
    float BearingX,
    float BearingY,
    float Width,
    float Height);

/// <summary>Font face resolution and glyph metric contract.</summary>
public interface IUiFontProvider
{
    /// <summary>Resolves a face for a query.</summary>
    bool TryGetFace(in UiFontQuery query, out UiFontFaceId face);

    /// <summary>Looks up one glyph metric.</summary>
    bool TryMeasureGlyph(UiFontFaceId face, int codePoint, out UiGlyphMetrics metrics);

    /// <summary>Gets the kerning adjustment between two code points; zero when unpaired.</summary>
    float GetKerning(UiFontFaceId face, int left, int right);
}

/// <summary>Text auto-sizing mode, mirroring TypeScript <c>autoSize</c>.</summary>
public enum UiTextAutoSize
{
    /// <summary>Fixed font size (default).</summary>
    None = 0,

    /// <summary>Shrink the font size until the layout fits the measured box.</summary>
    ShrinkToFit = 1,
}

/// <summary>Resolved text style used for measurement and shaping.</summary>
/// <param name="Face">Resolved font face.</param>
/// <param name="Size">Requested font size; the upper bound for shrink-to-fit.</param>
/// <param name="LineHeight">Line height in pixels; non-positive derives from the face.</param>
/// <param name="LetterSpacing">Extra letter spacing in pixels.</param>
/// <param name="Wrap">Wrapping mode.</param>
/// <param name="Overflow">Overflow handling.</param>
/// <param name="Align">Horizontal alignment.</param>
/// <param name="Direction">Requested direction.</param>
/// <param name="MaxLines">Maximum line count; non-positive means unlimited.</param>
/// <param name="AutoSize">Auto-sizing mode; <see cref="UiTextAutoSize.None"/> keeps the size fixed.</param>
/// <param name="MinFontSize">Smallest shrink-to-fit size; non-positive selects the default of 6.</param>
/// <param name="MaxFontSize">Largest shrink-to-fit size; non-positive selects the requested <paramref name="Size"/>.</param>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiTextStyle(
    UiFontFaceId Face,
    float Size,
    float LineHeight,
    float LetterSpacing,
    UiTextWrap Wrap,
    UiTextOverflow Overflow,
    UiTextAlign Align,
    UiTextDirection Direction,
    int MaxLines,
    UiTextAutoSize AutoSize = UiTextAutoSize.None,
    float MinFontSize = 0.0f,
    float MaxFontSize = 0.0f);

/// <summary>Measured text block extents.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiTextMetrics(
    float Width,
    float Height,
    float LineHeight,
    float Baseline,
    int LineCount,
    bool Truncated);

/// <summary>Text measurement contract.</summary>
public interface IUiTextMeasurer
{
    /// <summary>Measures a text block under the given style and constraints.</summary>
    UiTextMetrics Measure(
        ReadOnlySpan<char> text,
        in UiTextStyle style,
        in UiMeasureConstraints constraints);
}

/// <summary>One shaped glyph emitted by a text shaper.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiShapedGlyph(
    int CodePoint,
    int Cluster,
    float X,
    float Y,
    float Advance,
    int SpanIndex);

/// <summary>Text shaping contract writing into a caller-owned glyph span.</summary>
public interface IUiTextShaper
{
    /// <summary>Shapes text into the destination span and returns the glyph count.</summary>
    int Shape(ReadOnlySpan<char> text, in UiTextStyle style, Span<UiShapedGlyph> destination);
}

/// <summary>Immutable layout produced from a text block.</summary>
public interface IUiTextLayout
{
    /// <summary>Gets the layout identity.</summary>
    UiTextLayoutId Id { get; }

    /// <summary>Gets the measured size.</summary>
    UiSize Size { get; }

    /// <summary>Gets the metrics snapshot.</summary>
    UiTextMetrics Metrics { get; }

    /// <summary>Gets the shaped glyphs.</summary>
    ReadOnlySpan<UiShapedGlyph> Glyphs { get; }
}
