namespace Axrone.Ui.Rendering;

/// <summary>Storage format of one rasterized glyph.</summary>
public enum UiGlyphFormat
{
    /// <summary>Single-channel coverage.</summary>
    Alpha8,

    /// <summary>Four-channel premultiplied color.</summary>
    Rgba32,

    /// <summary>Single-channel signed distance field.</summary>
    Sdf,

    /// <summary>Multi-channel signed distance field.</summary>
    Msdf,
}

/// <summary>
/// Placement of one glyph inside an atlas page. UVs are normalized; the
/// origin offsets are pixels from the bitmap's left/top edge to the pen origin.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiGlyphAtlasEntry(
    UiFontFaceId Face,
    int CodePoint,
    UiGlyphAtlasPageId Page,
    UiResourceId Texture,
    Rect UvRect,
    float Width,
    float Height,
    float OriginX,
    float OriginY,
    float Advance,
    UiGlyphFormat Format);

/// <summary>Allocation state of one atlas page.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiGlyphAtlasPageInfo(
    UiGlyphAtlasPageId Id,
    UiResourceId Texture,
    int Width,
    int Height,
    int AllocatedGlyphs,
    UiGlyphFormat Format);

/// <summary>
/// Glyph residency contract. The renderer resolves a shaped glyph's face and
/// code point to a page placement here; a miss means the glyph is not resident
/// yet and must be rasterized before the batch is submitted.
/// </summary>
public interface IUiGlyphAtlas
{
    /// <summary>Gets the allocated page count.</summary>
    int PageCount { get; }

    /// <summary>Gets the allocated page identifiers in creation order.</summary>
    ReadOnlySpan<UiGlyphAtlasPageId> Pages { get; }

    /// <summary>Looks up one page's allocation state.</summary>
    bool TryGetPage(UiGlyphAtlasPageId page, out UiGlyphAtlasPageInfo info);

    /// <summary>Looks up the placement of one glyph.</summary>
    bool TryGetEntry(UiFontFaceId face, int codePoint, out UiGlyphAtlasEntry entry);
}
