namespace Axrone.Ui.Text;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiTextLine(int StartGlyph, int GlyphCount, float StartX, float Width);
