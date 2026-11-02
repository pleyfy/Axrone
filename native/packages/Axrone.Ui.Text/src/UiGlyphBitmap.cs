namespace Axrone.Ui.Text;

public enum UiGlyphBitmapFormat
{
    Coverage,

    Sdf,
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiSdfOptions(float Spread, int Resolution)
{
    public static UiSdfOptions Default => new(4.0f, 1);
}

public readonly ref struct UiGlyphBitmap
{
    private readonly ReadOnlySpan<byte> _alpha;

    public UiGlyphBitmap(
        int width,
        int height,
        int bearingX,
        int bearingY,
        float advance,
        ReadOnlySpan<byte> alpha,
        UiGlyphBitmapFormat format = UiGlyphBitmapFormat.Coverage)
    {
        Width = width;
        Height = height;
        BearingX = bearingX;
        BearingY = bearingY;
        Advance = advance;
        Format = format;
        _alpha = alpha;
    }

    public int Width { get; }

    public int Height { get; }

    public int BearingX { get; }

    public int BearingY { get; }

    public float Advance { get; }

    public UiGlyphBitmapFormat Format { get; }

    public ReadOnlySpan<byte> Alpha => _alpha;

    public bool IsEmpty => Width <= 0 || Height <= 0;
}

public interface IUiGlyphRasterizer
{
    bool TryRasterize(UiFontFaceId face, int codePoint, float pixelSize, out UiGlyphBitmap bitmap, out UiFontError failure);
}
