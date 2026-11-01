namespace Axrone.Ui.Text;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiGlyphRun(
    int GlyphId,
    int CodePoint,
    int Cluster,
    float X,
    float Y,
    float Advance,
    int SpanIndex,
    UiFontFaceId Face);
