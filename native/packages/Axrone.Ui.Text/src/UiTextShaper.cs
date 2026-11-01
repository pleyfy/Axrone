namespace Axrone.Ui.Text;

public sealed class UiTextShaper : IUiTextShaper
{
    private const int MaxLigatureLookahead = 8;

    private readonly UiFontProvider _provider;
    private UiGlyphRun[] _runs = GC.AllocateArray<UiGlyphRun>(16, pinned: true);
    private int[] _bidiCodepoints = GC.AllocateArray<int>(16, pinned: true);
    private int[] _bidiClusters = GC.AllocateArray<int>(16, pinned: true);
    private int[] _arabicForms = GC.AllocateArray<int>(16, pinned: true);
    private byte[] _bidiLevels = new byte[16];
    private UiBidiClass[] _bidiTypes = new UiBidiClass[16];

    public UiTextShaper(UiFontProvider provider)
    {
        ArgumentNullException.ThrowIfNull(provider);
        _provider = provider;
    }

    public int Shape(ReadOnlySpan<char> text, in UiTextStyle style, Span<UiShapedGlyph> destination)
    {
        int count = ShapeIntoRuns(text, in style);
        int written = Math.Min(count, destination.Length);
        for (int i = 0; i < written; i++)
        {
            UiGlyphRun run = _runs[i];
            destination[i] = new UiShapedGlyph(run.CodePoint, run.Cluster, run.X, run.Y, run.Advance, run.SpanIndex);
        }

        return written;
    }

    public int ShapeGlyphs(ReadOnlySpan<char> text, in UiTextStyle style, Span<UiGlyphRun> destination)
    {
        int count = ShapeIntoRuns(text, in style);
        int written = Math.Min(count, destination.Length);
        _runs.AsSpan(0, written).CopyTo(destination);
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

    private int ShapeIntoRuns(ReadOnlySpan<char> text, in UiTextStyle style)
    {
        if (text.IsEmpty || style.Size <= 0.0f)
        {
            return 0;
        }

        if (!_provider.TryGetFace(style.Face, out UiFontFace? primary))
        {
            return 0;
        }

        EnsureRunCapacity(text.Length);
        EnsureBidiCapacity(text.Length);
        Span<int> codepoints = _bidiCodepoints;
        Span<int> clusters = _bidiClusters;
        Span<byte> levels = _bidiLevels;
        Span<UiBidiClass> types = _bidiTypes;

        int count = 0;
        int position = 0;
        while (position < text.Length)
        {
            OperationStatus status = Rune.DecodeFromUtf16(text[position..], out Rune rune, out int consumed);
            if (status != OperationStatus.Done)
            {
                position++;
                continue;
            }

            codepoints[count] = rune.Value;
            clusters[count] = position;
            count++;
            position += consumed;
        }

        if (count == 0)
        {
            return 0;
        }

        byte baseLevel = UiBidi.ResolveBaseLevel(style.Direction, codepoints[..count]);
        for (int i = 0; i < count; i++)
        {
            _arabicForms[i] = UiArabicJoining.TryGetForm(codepoints[..count], i, out int form) &&
                _provider.TryResolveGlyph(primary.Id, form, out _, out _)
                ? form
                : 0;
        }

        for (int i = 0; i < count; i++)
        {
            if (_arabicForms[i] != 0)
            {
                codepoints[i] = _arabicForms[i];
            }
        }

        UiBidi.ResolveLevels(codepoints[..count], types[..count], levels[..count], baseLevel);
        for (int i = 0; i < count; i++)
        {
            if ((levels[i] & 1) != 0)
            {
                codepoints[i] = UiBidi.Mirror(codepoints[i]);
            }
        }

        UiBidi.Reorder(codepoints[..count], clusters[..count], levels[..count]);

        int written = 0;
        int index = 0;
        float pen = 0.0f;
        UiFontFaceId previousFace = UiFontFaceId.Invalid;
        int previousGlyph = 0;
        int previousCodePoint = -1;
        int previousRun = -1;
        bool previousIsBase = false;
        Span<int> following = stackalloc int[MaxLigatureLookahead];

        while (index < count)
        {
            int codePoint = codepoints[index];
            int cluster = clusters[index];
            index++;

            bool hasGlyph = _provider.TryResolveGlyph(primary.Id, codePoint, out UiFontFaceId resolvedFaceId, out UiGlyphMetrics metrics);
            UiFontFace? resolvedFace = null;
            int glyphId = 0;
            if (hasGlyph)
            {
                _provider.TryGetFace(resolvedFaceId, out resolvedFace);
                if (resolvedFace is null || !resolvedFace.TryGetGlyph(codePoint, out glyphId))
                {
                    hasGlyph = false;
                }
            }

            if (hasGlyph && resolvedFace!.Gsub is { IsEmpty: false } gsub)
            {
                int followCount = 0;
                int look = index;
                while (followCount < MaxLigatureLookahead && look < count)
                {
                    if (!resolvedFace.TryGetGlyph(codepoints[look], out int lookGlyph))
                    {
                        break;
                    }

                    following[followCount] = lookGlyph;
                    followCount++;
                    look++;
                }

                if (gsub.TryMatch(glyphId, following[..followCount], out int ligatureGlyph, out int components))
                {
                    int ligatureCodePoint = resolvedFace.GetCanonicalCodePoint(ligatureGlyph);
                    if (ligatureCodePoint < 0)
                    {
                        ligatureCodePoint = codePoint;
                    }

                    float ligatureScale = style.Size / resolvedFace.UnitsPerEm;
                    float advance = Math.Max(0.0f, (resolvedFace.ReadAdvance(resolvedFace.Buffer.Span, ligatureGlyph) * ligatureScale) + style.LetterSpacing);
                    _runs[written] = new UiGlyphRun(ligatureGlyph, ligatureCodePoint, cluster, pen, 0.0f, advance, 0, resolvedFaceId);
                    previousRun = written;
                    written++;
                    pen += advance;
                    index += components - 1;
                    previousFace = resolvedFaceId;
                    previousGlyph = ligatureGlyph;
                    previousCodePoint = ligatureCodePoint;
                    previousIsBase = true;
                    continue;
                }
            }

            bool hasGsub = resolvedFace?.Gsub is { IsEmpty: false };
            if (hasGlyph && !hasGsub && codePoint == 0x66 &&
                TryMatchLigature(codepoints[..count], index, out int builtInCodePoint, out int builtInExtra))
            {
                if (_provider.TryResolveGlyph(primary.Id, builtInCodePoint, out UiFontFaceId builtInFaceId, out UiGlyphMetrics builtInMetrics) &&
                    _provider.TryGetFace(builtInFaceId, out UiFontFace? builtInFace) &&
                    builtInFace.TryGetGlyph(builtInCodePoint, out int builtInGlyph))
                {
                    float builtInScale = style.Size / builtInFace.UnitsPerEm;
                    float advance = Math.Max(0.0f, (builtInMetrics.Advance * builtInScale) + style.LetterSpacing);
                    _runs[written] = new UiGlyphRun(builtInGlyph, builtInCodePoint, cluster, pen, 0.0f, advance, 0, builtInFaceId);
                    previousRun = written;
                    written++;
                    pen += advance;
                    index += builtInExtra;
                    previousFace = builtInFaceId;
                    previousGlyph = builtInGlyph;
                    previousCodePoint = builtInCodePoint;
                    previousIsBase = true;
                    continue;
                }
            }

            if (IsCombiningMark(codePoint))
            {
                if (hasGlyph && previousIsBase && previousRun >= 0)
                {
                    UiGlyphRun baseRun = _runs[previousRun];
                    float markScale = style.Size / resolvedFace!.UnitsPerEm;
                    float markAdvance = metrics.Advance * markScale;
                    float markX = baseRun.X + Math.Max(0.0f, ((baseRun.Advance - style.LetterSpacing) - markAdvance) * 0.5f);
                    _runs[written] = new UiGlyphRun(glyphId, codePoint, cluster, markX, 0.0f, 0.0f, 0, resolvedFaceId);
                    written++;
                }

                continue;
            }

            if (!hasGlyph)
            {
                _runs[written] = new UiGlyphRun(0, codePoint, cluster, pen, 0.0f, 0.0f, 0, UiFontFaceId.Invalid);
                written++;
                previousFace = UiFontFaceId.Invalid;
                previousCodePoint = -1;
                previousGlyph = 0;
                previousIsBase = false;
                previousRun = -1;
                continue;
            }

            float scale = style.Size / resolvedFace!.UnitsPerEm;
            if (previousIsBase && previousFace == resolvedFaceId)
            {
                if (resolvedFace.Gpos is { HasPairs: true } gpos)
                {
                    pen += gpos.GetKerning(resolvedFace.Buffer.Span, previousGlyph, glyphId) * scale;
                }
                else
                {
                    pen += resolvedFace.GetKerning(previousCodePoint, codePoint) * scale;
                }
            }

            if (pen < 0.0f)
            {
                pen = 0.0f;
            }

            float glyphAdvance = Math.Max(0.0f, (metrics.Advance * scale) + style.LetterSpacing);
            _runs[written] = new UiGlyphRun(glyphId, codePoint, cluster, pen, 0.0f, glyphAdvance, 0, resolvedFaceId);
            previousRun = written;
            written++;
            pen += glyphAdvance;
            previousFace = resolvedFaceId;
            previousGlyph = glyphId;
            previousCodePoint = codePoint;
            previousIsBase = true;
        }

        return written;
    }

    private void EnsureRunCapacity(int required)
    {
        if (_runs.Length >= required)
        {
            return;
        }

        int capacity = _runs.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        _runs = GC.AllocateArray<UiGlyphRun>(capacity, pinned: true);
    }

    private void EnsureBidiCapacity(int required)
    {
        if (_bidiCodepoints.Length >= required)
        {
            return;
        }

        int capacity = _bidiCodepoints.Length;
        while (capacity < required)
        {
            capacity = capacity <= int.MaxValue / 2 ? capacity * 2 : required;
        }

        _bidiCodepoints = GC.AllocateArray<int>(capacity, pinned: true);
        _bidiClusters = GC.AllocateArray<int>(capacity, pinned: true);
        _arabicForms = GC.AllocateArray<int>(capacity, pinned: true);
        _bidiLevels = new byte[capacity];
        _bidiTypes = new UiBidiClass[capacity];
    }

    private static bool TryMatchLigature(
        ReadOnlySpan<int> codepoints,
        int next,
        out int ligatureCodePoint,
        out int extraCodePoints)
    {
        ligatureCodePoint = 0;
        extraCodePoints = 0;
        if (next >= codepoints.Length)
        {
            return false;
        }

        int first = codepoints[next];
        if (first == 'f')
        {
            if (next + 1 < codepoints.Length)
            {
                int second = codepoints[next + 1];
                if (second == 'i')
                {
                    ligatureCodePoint = 0xFB03;
                    extraCodePoints = 2;
                    return true;
                }

                if (second == 'l')
                {
                    ligatureCodePoint = 0xFB04;
                    extraCodePoints = 2;
                    return true;
                }
            }

            ligatureCodePoint = 0xFB00;
            extraCodePoints = 1;
            return true;
        }

        if (first == 'i')
        {
            ligatureCodePoint = 0xFB01;
            extraCodePoints = 1;
            return true;
        }

        if (first == 'l')
        {
            ligatureCodePoint = 0xFB02;
            extraCodePoints = 1;
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
}
