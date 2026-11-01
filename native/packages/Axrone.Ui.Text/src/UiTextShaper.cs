namespace Axrone.Ui.Text;

public sealed class UiTextShaper : IUiTextShaper
{
    private readonly UiFontProvider _provider;

    public UiTextShaper(UiFontProvider provider)
    {
        ArgumentNullException.ThrowIfNull(provider);
        _provider = provider;
    }

    public int Shape(ReadOnlySpan<char> text, in UiTextStyle style, Span<UiShapedGlyph> destination)
    {
        if (text.IsEmpty || destination.IsEmpty || style.Size <= 0.0f)
        {
            return 0;
        }

        if (!_provider.TryGetFace(style.Face, out UiFontFace? primary))
        {
            return 0;
        }

        float scale = style.Size / primary.UnitsPerEm;
        UiTextDirection direction = ResolveDirection(style.Direction, text);
        int written = 0;
        int index = 0;
        float pen = 0.0f;
        UiFontFaceId previousFace = UiFontFaceId.Invalid;
        int previousCodePoint = -1;
        int previousGlyphIndex = -1;
        bool previousIsBase = false;

        while (index < text.Length)
        {
            OperationStatus status = Rune.DecodeFromUtf16(text[index..], out Rune rune, out int consumed);
            if (status != OperationStatus.Done)
            {
                index++;
                continue;
            }

            int codePoint = rune.Value;
            int cluster = index;
            index += consumed;

            if (codePoint == 0x66 &&
                TryMatchLigature(text, index, out int ligatureCodePoint, out int ligatureExtra))
            {
                if (_provider.TryResolveGlyph(primary.Id, ligatureCodePoint, out _, out UiGlyphMetrics ligatureMetrics))
                {
                    float ligatureAdvance = (ligatureMetrics.Advance * scale) + style.LetterSpacing;
                    if (written >= destination.Length)
                    {
                        return written;
                    }

                    destination[written] = new UiShapedGlyph(ligatureCodePoint, cluster, pen, 0.0f, Math.Max(0.0f, ligatureAdvance), 0);
                    previousGlyphIndex = written;
                    written++;
                    pen += Math.Max(0.0f, ligatureAdvance);
                    index += ligatureExtra;
                    previousFace = UiFontFaceId.Invalid;
                    previousCodePoint = -1;
                    previousIsBase = false;
                    continue;
                }
            }

            if (IsCombiningMark(codePoint))
            {
                if (previousIsBase &&
                    previousGlyphIndex >= 0 &&
                    written < destination.Length &&
                    _provider.TryResolveGlyph(primary.Id, codePoint, out _, out UiGlyphMetrics markMetrics))
                {
                    UiShapedGlyph baseGlyph = destination[previousGlyphIndex];
                    float markAdvance = markMetrics.Advance * scale;
                    float markX = baseGlyph.X + Math.Max(0.0f, ((baseGlyph.Advance - style.LetterSpacing) - markAdvance) * 0.5f);
                    destination[written] = new UiShapedGlyph(codePoint, cluster, markX, 0.0f, 0.0f, 0);
                    written++;
                }

                continue;
            }

            if (!_provider.TryResolveGlyph(primary.Id, codePoint, out UiFontFaceId resolvedFace, out UiGlyphMetrics metrics))
            {
                if (written >= destination.Length)
                {
                    return written;
                }

                destination[written] = new UiShapedGlyph(codePoint, cluster, pen, 0.0f, 0.0f, 0);
                written++;
                previousIsBase = false;
                previousCodePoint = -1;
                previousFace = UiFontFaceId.Invalid;
                continue;
            }

            if (previousIsBase && previousCodePoint >= 0)
            {
                pen += _provider.GetKerning(previousFace, previousCodePoint, codePoint) * scale;
            }

            if (pen < 0.0f)
            {
                pen = 0.0f;
            }

            float advance = Math.Max(0.0f, (metrics.Advance * scale) + style.LetterSpacing);
            if (written >= destination.Length)
            {
                return written;
            }

            destination[written] = new UiShapedGlyph(codePoint, cluster, pen, 0.0f, advance, 0);
            previousGlyphIndex = written;
            written++;
            pen += advance;
            previousFace = resolvedFace;
            previousCodePoint = codePoint;
            previousIsBase = true;
        }

        if (direction == UiTextDirection.Rtl && written > 1)
        {
            MirrorRun(destination, written);
        }

        return written;
    }

    public int ShapeRichText(
        ReadOnlySpan<char> text,
        ReadOnlySpan<UiRichTextRun> runs,
        in UiTextStyle baseStyle,
        UiFontFamilyId family,
        string? locale,
        IUiTheme? theme,
        Span<UiShapedGlyph> destination)
    {
        int written = 0;
        float pen = 0.0f;
        for (int r = 0; r < runs.Length; r++)
        {
            UiRichTextRun run = runs[r];
            if (run.Length <= 0 || run.Start < 0 || run.Start > text.Length - run.Length)
            {
                continue;
            }

            if (written >= destination.Length)
            {
                break;
            }

            UiRichTextStyle runOverrides = run.Style;
            _ = UiRichTextStyleResolver.TryResolve(
                _provider,
                family,
                locale,
                in baseStyle,
                in runOverrides,
                theme,
                out UiTextStyle runStyle,
                out _,
                out _);

            int count = Shape(text.Slice(run.Start, run.Length), in runStyle, destination[written..]);
            for (int i = 0; i < count; i++)
            {
                UiShapedGlyph glyph = destination[written + i];
                destination[written + i] = new UiShapedGlyph(
                    glyph.CodePoint,
                    glyph.Cluster + run.Start,
                    glyph.X + pen,
                    glyph.Y,
                    glyph.Advance,
                    run.SpanIndex);
            }

            if (count > 0)
            {
                UiShapedGlyph last = destination[written + count - 1];
                pen = last.X + last.Advance;
            }

            written += count;
        }

        return written;
    }

    private static void MirrorRun(Span<UiShapedGlyph> glyphs, int count)
    {
        for (int left = 0, right = count - 1; left < right; left++, right--)
        {
            (glyphs[left], glyphs[right]) = (glyphs[right], glyphs[left]);
        }

        float x = 0.0f;
        for (int i = 0; i < count; i++)
        {
            UiShapedGlyph glyph = glyphs[i];
            glyphs[i] = new UiShapedGlyph(glyph.CodePoint, glyph.Cluster, x, glyph.Y, glyph.Advance, glyph.SpanIndex);
            x += glyph.Advance;
        }
    }

    private static bool TryMatchLigature(
        ReadOnlySpan<char> text,
        int next,
        out int ligatureCodePoint,
        out int extraUnits)
    {
        ligatureCodePoint = 0;
        extraUnits = 0;
        if (next >= text.Length)
        {
            return false;
        }

        char first = text[next];
        if (first == 'f')
        {
            if (next + 1 < text.Length)
            {
                char second = text[next + 1];
                if (second == 'i')
                {
                    ligatureCodePoint = 0xFB03;
                    extraUnits = 2;
                    return true;
                }

                if (second == 'l')
                {
                    ligatureCodePoint = 0xFB04;
                    extraUnits = 2;
                    return true;
                }
            }

            ligatureCodePoint = 0xFB00;
            extraUnits = 1;
            return true;
        }

        if (first == 'i')
        {
            ligatureCodePoint = 0xFB01;
            extraUnits = 1;
            return true;
        }

        if (first == 'l')
        {
            ligatureCodePoint = 0xFB02;
            extraUnits = 1;
            return true;
        }

        return false;
    }

    private static bool IsCombiningMark(int codePoint) =>
        (codePoint >= 0x0300 && codePoint <= 0x036F) ||
        (codePoint >= 0x0483 && codePoint <= 0x0489) ||
        (codePoint >= 0x0591 && codePoint <= 0x05BD) ||
        (codePoint >= 0x0610 && codePoint <= 0x061A) ||
        (codePoint >= 0x064B && codePoint <= 0x065F) ||
        (codePoint >= 0x1AB0 && codePoint <= 0x1AFF) ||
        (codePoint >= 0x1DC0 && codePoint <= 0x1DFF) ||
        (codePoint >= 0x20D0 && codePoint <= 0x20FF) ||
        (codePoint >= 0xFE20 && codePoint <= 0xFE2F);

    private static UiTextDirection ResolveDirection(UiTextDirection requested, ReadOnlySpan<char> text)
    {
        if (requested != UiTextDirection.Auto)
        {
            return requested;
        }

        int index = 0;
        while (index < text.Length)
        {
            OperationStatus status = Rune.DecodeFromUtf16(text[index..], out Rune rune, out int consumed);
            if (status != OperationStatus.Done)
            {
                index++;
                continue;
            }

            int codePoint = rune.Value;
            if (IsRightToLeftStrong(codePoint))
            {
                return UiTextDirection.Rtl;
            }

            if (IsLeftToRightStrong(codePoint))
            {
                return UiTextDirection.Ltr;
            }

            index += consumed;
        }

        return UiTextDirection.Ltr;
    }

    private static bool IsRightToLeftStrong(int codePoint) =>
        (codePoint >= 0x0590 && codePoint <= 0x08FF) ||
        (codePoint >= 0xFB1D && codePoint <= 0xFDFF) ||
        (codePoint >= 0xFE70 && codePoint <= 0xFEFF) ||
        (codePoint >= 0x1EE00 && codePoint <= 0x1EEFF);

    private static bool IsLeftToRightStrong(int codePoint) =>
        (codePoint >= 'A' && codePoint <= 'Z') ||
        (codePoint >= 'a' && codePoint <= 'z') ||
        (codePoint >= 0x00C0 && codePoint <= 0x024F);
}
