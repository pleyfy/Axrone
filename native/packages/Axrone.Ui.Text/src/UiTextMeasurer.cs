namespace Axrone.Ui.Text;

public sealed class UiTextMeasurer : IUiTextMeasurer
{
    private const int InitialGlyphCapacity = 16;
    private const int InitialLineCapacity = 8;

    private readonly UiFontProvider _provider;
    private readonly UiTextShaper _shaper;
    private UiShapedGlyph[] _glyphs = GC.AllocateArray<UiShapedGlyph>(InitialGlyphCapacity, pinned: true);
    private UiTextLine[] _lines = GC.AllocateArray<UiTextLine>(InitialLineCapacity, pinned: true);
    private int _glyphCount;
    private int _lineCount;
    private UiTextMetrics _metrics;

    public UiTextMeasurer(UiFontProvider provider)
    {
        ArgumentNullException.ThrowIfNull(provider);
        _provider = provider;
        _shaper = new UiTextShaper(provider);
    }

    internal ReadOnlySpan<UiShapedGlyph> ShapedGlyphs => _glyphs.AsSpan(0, _glyphCount);

    internal ReadOnlySpan<UiTextLine> Lines => _lines.AsSpan(0, _lineCount);

    public UiTextMetrics Measure(ReadOnlySpan<char> text, in UiTextStyle style, in UiMeasureConstraints constraints)
    {
        return MeasureDetailed(text, in style, in constraints);
    }

    internal UiTextMetrics MeasureDetailed(
        ReadOnlySpan<char> text,
        in UiTextStyle style,
        in UiMeasureConstraints constraints)
    {
        _glyphCount = 0;
        _lineCount = 0;
        _metrics = default;

        if (!_provider.TryGetFace(style.Face, out UiFontFace? face) || style.Size <= 0.0f)
        {
            return _metrics;
        }

        float scale = style.Size / face.UnitsPerEm;
        float lineHeight = ResolveLineHeight(style, face, scale);
        float baseline = Math.Max(0.0f, face.Ascender * scale);
        if (text.IsEmpty)
        {
            _metrics = new UiTextMetrics(0.0f, 0.0f, lineHeight, baseline, 0, false);
            return _metrics;
        }

        EnsureGlyphCapacity(text.Length);
        _glyphCount = _shaper.Shape(text, in style, _glyphs);
        if (_glyphCount == 0)
        {
            _metrics = new UiTextMetrics(0.0f, 0.0f, lineHeight, baseline, 0, false);
            return _metrics;
        }

        return MeasureShaped(in style, in constraints, face, scale, lineHeight, baseline);
    }

    private UiTextMetrics MeasureShaped(
        in UiTextStyle style,
        in UiMeasureConstraints constraints,
        UiFontFace face,
        float scale,
        float lineHeight,
        float baseline)
    {
        float wrapWidth = float.IsFinite(constraints.MaxWidth) && constraints.MaxWidth > 0.0f
            ? constraints.MaxWidth
            : float.PositiveInfinity;
        int maxLines = style.MaxLines > 0 ? style.MaxLines : int.MaxValue;
        EnsureLineCapacity(_glyphCount + 1);

        int lineStart = 0;
        float lineStartX = _glyphs[0].X;
        float lineEnd = 0.0f;
        int lastBreak = -1;
        float widthAtBreak = 0.0f;
        bool truncated = false;
        bool stopped = false;

        for (int i = 0; i < _glyphCount; i++)
        {
            UiShapedGlyph glyph = _glyphs[i];
            int codePoint = glyph.CodePoint;
            if (codePoint == '\r')
            {
                continue;
            }

            if (codePoint == '\n')
            {
                if (!AppendLine(lineStart, i, lineStartX, lineEnd))
                {
                    truncated = true;
                    stopped = true;
                    break;
                }

                lineStart = i + 1;
                lineStartX = lineStart < _glyphCount ? _glyphs[lineStart].X : 0.0f;
                lineEnd = 0.0f;
                lastBreak = -1;
                if (_lineCount >= maxLines)
                {
                    truncated |= i + 1 < _glyphCount;
                    stopped = true;
                    break;
                }

                continue;
            }

            bool isSpace = IsSpace(codePoint);
            if (isSpace && style.Wrap == UiTextWrap.Word)
            {
                lastBreak = i;
                widthAtBreak = lineEnd - lineStartX;
                continue;
            }

            if (style.Wrap != UiTextWrap.None &&
                float.IsFinite(wrapWidth) &&
                i > lineStart)
            {
                float candidateEnd = Math.Max(lineEnd, glyph.X + glyph.Advance);
                if (candidateEnd - lineStartX > wrapWidth)
                {
                    if (style.Wrap == UiTextWrap.Word && lastBreak > lineStart)
                    {
                        if (!AppendLine(lineStart, lastBreak, lineStartX, widthAtBreak))
                        {
                            truncated = true;
                            stopped = true;
                            break;
                        }

                        lineStart = lastBreak + 1;
                        lineStartX = lineStart < _glyphCount ? _glyphs[lineStart].X : 0.0f;
                        lineEnd = 0.0f;
                        for (int j = lineStart; j < i; j++)
                        {
                            lineEnd = Math.Max(lineEnd, _glyphs[j].X + _glyphs[j].Advance);
                        }

                        lastBreak = -1;
                        widthAtBreak = 0.0f;
                    }
                    else
                    {
                        if (!AppendLine(lineStart, i, lineStartX, lineEnd))
                        {
                            truncated = true;
                            stopped = true;
                            break;
                        }

                        lineStart = i;
                        lineStartX = glyph.X;
                        lineEnd = 0.0f;
                        lastBreak = -1;
                        widthAtBreak = 0.0f;
                    }

                    if (_lineCount >= maxLines)
                    {
                        truncated = true;
                        stopped = true;
                        break;
                    }
                }
            }

            _ = isSpace;
            lineEnd = Math.Max(lineEnd, glyph.X + glyph.Advance);
        }

        if (!stopped && lineStart < _glyphCount)
        {
            if (!AppendLine(lineStart, _glyphCount, lineStartX, lineEnd))
            {
                truncated = true;
            }
        }

        int lineCount = _lineCount;
        if (float.IsFinite(constraints.MaxHeight) && lineHeight > 0.0f)
        {
            int allowed = (int)MathF.Floor(Math.Max(0.0f, constraints.MaxHeight) / lineHeight);
            if (allowed < lineCount)
            {
                lineCount = Math.Max(0, allowed);
                truncated = true;
            }
        }

        float maxLineWidth = 0.0f;
        for (int i = 0; i < lineCount; i++)
        {
            maxLineWidth = Math.Max(maxLineWidth, _lines[i].Width);
        }

        if (float.IsFinite(wrapWidth) && maxLineWidth > wrapWidth)
        {
            truncated = true;
        }

        if (truncated && style.Overflow == UiTextOverflow.Ellipsis && lineCount > 0)
        {
            float ellipsis = MeasureEllipsis(style, scale);
            if (ellipsis > 0.0f)
            {
                UiTextLine last = _lines[lineCount - 1];
                float target = last.Width + ellipsis;
                if (float.IsFinite(wrapWidth))
                {
                    target = Math.Min(wrapWidth, target);
                }

                _lines[lineCount - 1] = last with { Width = target };
                maxLineWidth = Math.Max(maxLineWidth, target);
            }
        }

        if (float.IsFinite(wrapWidth) && truncated)
        {
            maxLineWidth = Math.Min(maxLineWidth, wrapWidth);
        }

        _lineCount = lineCount;
        _metrics = new UiTextMetrics(
            maxLineWidth,
            lineCount * lineHeight,
            lineHeight,
            baseline,
            lineCount,
            truncated);
        return _metrics;
    }

    private bool AppendLine(int start, int end, float startX, float lineEnd)
    {
        if (_lineCount >= _lines.Length)
        {
            return false;
        }

        float width = end > start ? Math.Max(0.0f, lineEnd - startX) : 0.0f;
        _lines[_lineCount] = new UiTextLine(start, end - start, startX, width);
        _lineCount++;
        return true;
    }

    private float MeasureEllipsis(in UiTextStyle style, float scale)
    {
        if (_provider.TryResolveGlyph(style.Face, 0x2026, out _, out UiGlyphMetrics metrics))
        {
            return Math.Max(0.0f, (metrics.Advance * scale) + style.LetterSpacing);
        }

        if (_provider.TryResolveGlyph(style.Face, 0x2E, out _, out metrics))
        {
            return Math.Max(0.0f, ((metrics.Advance * scale) + style.LetterSpacing) * 3.0f);
        }

        return 0.0f;
    }

    private static float ResolveLineHeight(in UiTextStyle style, UiFontFace face, float scale)
    {
        if (style.LineHeight > 0.0f)
        {
            return style.LineHeight;
        }

        float natural = (face.Ascender - face.Descender + face.LineGap) * scale;
        return natural > 0.0f ? natural : style.Size * 1.2f;
    }

    private static bool IsSpace(int codePoint) =>
        codePoint != '\n' && codePoint != '\r' && Rune.IsWhiteSpace(new Rune(codePoint));

    private void EnsureGlyphCapacity(int required)
    {
        if (_glyphs.Length >= required)
        {
            return;
        }

        int capacity = _glyphs.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        _glyphs = GC.AllocateArray<UiShapedGlyph>(capacity, pinned: true);
    }

    private void EnsureLineCapacity(int required)
    {
        if (_lines.Length >= required)
        {
            return;
        }

        int capacity = _lines.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        _lines = GC.AllocateArray<UiTextLine>(capacity, pinned: true);
    }
}
