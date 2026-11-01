namespace Axrone.Ui.Text;

/// <summary>
/// Alpha-coverage bitmap of one rasterized glyph. Rows are stored top-down,
/// one byte per pixel; <see cref="BearingX"/> and <see cref="BearingY"/> place
/// the bitmap relative to the pen and baseline. The span aliases the
/// rasterizer's buffer and is valid until the next rasterization.
/// </summary>
public readonly ref struct UiGlyphBitmap
{
    private readonly ReadOnlySpan<byte> _alpha;

    /// <summary>Creates a bitmap view.</summary>
    public UiGlyphBitmap(int width, int height, int bearingX, int bearingY, float advance, ReadOnlySpan<byte> alpha)
    {
        Width = width;
        Height = height;
        BearingX = bearingX;
        BearingY = bearingY;
        Advance = advance;
        _alpha = alpha;
    }

    /// <summary>Gets the bitmap width in pixels.</summary>
    public int Width { get; }

    /// <summary>Gets the bitmap height in pixels.</summary>
    public int Height { get; }

    /// <summary>Gets the horizontal offset from the pen to the bitmap's left edge.</summary>
    public int BearingX { get; }

    /// <summary>Gets the vertical offset from the baseline to the bitmap's top edge.</summary>
    public int BearingY { get; }

    /// <summary>Gets the horizontal advance in pixels.</summary>
    public float Advance { get; }

    /// <summary>Gets the row-major alpha coverage.</summary>
    public ReadOnlySpan<byte> Alpha => _alpha;

    /// <summary>Gets whether the bitmap has no pixels.</summary>
    public bool IsEmpty => Width <= 0 || Height <= 0;
}

/// <summary>Rasterizes one code point into an alpha coverage bitmap.</summary>
public interface IUiGlyphRasterizer
{
    /// <summary>Rasterizes a code point at a pixel size.</summary>
    bool TryRasterize(UiFontFaceId face, int codePoint, float pixelSize, out UiGlyphBitmap bitmap, out UiFontError failure);
}
