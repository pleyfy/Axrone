namespace Axrone.Ui.Text;

/// <summary>One measured line: a glyph range in the shaped buffer plus its extent.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiTextLine(int StartGlyph, int GlyphCount, float StartX, float Width);
