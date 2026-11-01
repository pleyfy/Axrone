namespace Axrone.Ui.Text;

public sealed class UiTextLayoutBuffer : IUiTextLayout
{
    private static int s_nextId;

    private readonly UiTextMeasurer _measurer;
    private UiShapedGlyph[] _glyphs;
    private int _glyphCount;
    private UiTextMetrics _metrics;
    private UiSize _size;

    public UiTextLayoutBuffer(UiFontProvider provider, int glyphCapacity = 64)
    {
        ArgumentNullException.ThrowIfNull(provider);
        _measurer = new UiTextMeasurer(provider);
        _glyphs = GC.AllocateArray<UiShapedGlyph>(Math.Max(4, glyphCapacity), pinned: true);
        int id = Interlocked.Increment(ref s_nextId);
        Id = new UiTextLayoutId((uint)(id <= 0 ? 1 : id));
    }

    public UiTextLayoutId Id { get; }

    public UiSize Size => _size;

    public UiTextMetrics Metrics => _metrics;

    public ReadOnlySpan<UiShapedGlyph> Glyphs => _glyphs.AsSpan(0, _glyphCount);

    public bool TryLayout(ReadOnlySpan<char> text, in UiTextStyle style, in UiMeasureConstraints constraints)
    {
        _metrics = _measurer.MeasureDetailed(text, in style, in constraints);
        _glyphCount = 0;
        _size = default;
        if (_metrics.LineHeight <= 0.0f)
        {
            return false;
        }

        ReadOnlySpan<UiShapedGlyph> shaped = _measurer.ShapedGlyphs;
        ReadOnlySpan<UiTextLine> lines = _measurer.Lines;
        if (shaped.Length > _glyphs.Length)
        {
            Grow(shaped.Length);
        }

        float available = float.IsFinite(constraints.MaxWidth) && constraints.MaxWidth > 0.0f
            ? constraints.MaxWidth
            : _metrics.Width;
        int written = 0;
        for (int lineIndex = 0; lineIndex < lines.Length; lineIndex++)
        {
            UiTextLine line = lines[lineIndex];
            if (line.GlyphCount <= 0)
            {
                continue;
            }

            bool justify = style.Align == UiTextAlign.Justify &&
                lineIndex < lines.Length - 1 &&
                line.GlyphCount > 1 &&
                available > line.Width;
            int spaceCount = 0;
            if (justify)
            {
                for (int glyphIndex = 0; glyphIndex < line.GlyphCount; glyphIndex++)
                {
                    if (shaped[line.StartGlyph + glyphIndex].CodePoint == 0x20)
                    {
                        spaceCount++;
                    }
                }
            }

            float remaining = justify ? available - line.Width : 0.0f;
            float perSpace = justify && spaceCount > 0 ? remaining / spaceCount : 0.0f;
            float perGlyph = justify && spaceCount == 0 ? remaining / (line.GlyphCount - 1) : 0.0f;
            float offset = justify ? 0.0f : AlignmentOffset(style.Align, available, line.Width);
            float extraSoFar = 0.0f;
            float y = lineIndex * _metrics.LineHeight;

            for (int glyphIndex = 0; glyphIndex < line.GlyphCount; glyphIndex++)
            {
                UiShapedGlyph glyph = shaped[line.StartGlyph + glyphIndex];
                float x = (glyph.X - line.StartX) + offset + extraSoFar;
                _glyphs[written] = new UiShapedGlyph(glyph.CodePoint, glyph.Cluster, x, y, glyph.Advance, glyph.SpanIndex);
                written++;
                if (justify)
                {
                    extraSoFar += spaceCount > 0
                        ? (glyph.CodePoint == 0x20 ? perSpace : 0.0f)
                        : perGlyph;
                }
            }
        }

        _glyphCount = written;
        _size = new UiSize(_metrics.Width, _metrics.Height);
        return true;
    }

    private static float AlignmentOffset(UiTextAlign align, float available, float width) => align switch
    {
        UiTextAlign.Center => Math.Max(0.0f, (available - width) * 0.5f),
        UiTextAlign.End => Math.Max(0.0f, available - width),
        _ => 0.0f,
    };

    private void Grow(int required)
    {
        int capacity = _glyphs.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        _glyphs = GC.AllocateArray<UiShapedGlyph>(capacity, pinned: true);
    }
}
