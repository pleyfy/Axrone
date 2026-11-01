namespace Axrone.Ui.Text;

public enum UiFontOutlineFormat
{
    TrueType,

    Cff,
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiCmapSegment(ushort Start, ushort End, short Delta, int GlyphArrayBase);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiCmapGroup(uint Start, uint End, uint StartGlyph);

public sealed class UiFontFace
{
    private readonly UiFontBuffer _buffer;
    private readonly UiCmapData _cmap;
    private readonly int[] _reverseCodePoints;
    private readonly int _hmtxOffset;
    private readonly int _numberOfHMetrics;
    private readonly int _kernPairsOffset;
    private readonly int _kernPairCount;
    private readonly int _locaOffset;
    private readonly bool _longLoca;
    private readonly int _glyfOffset;
    private readonly int _glyfLength;

    internal UiFontFace(
        UiFontBuffer buffer,
        UiFontFamilyId family,
        string familyName,
        UiFontWeight weight,
        UiFontStyle style,
        int unitsPerEm,
        int glyphCount,
        int ascender,
        int descender,
        int lineGap,
        UiFontOutlineFormat outlineFormat,
        UiCmapData cmap,
        int hmtxOffset,
        int numberOfHMetrics,
        int kernPairsOffset,
        int kernPairCount,
        int locaOffset,
        bool longLoca,
        int glyfOffset,
        int glyfLength)
    {
        _buffer = buffer;
        Family = family;
        FamilyName = familyName;
        Weight = weight;
        Style = style;
        UnitsPerEm = unitsPerEm;
        GlyphCount = glyphCount;
        Ascender = ascender;
        Descender = descender;
        LineGap = lineGap;
        OutlineFormat = outlineFormat;
        _cmap = cmap;
        _hmtxOffset = hmtxOffset;
        _numberOfHMetrics = numberOfHMetrics;
        _kernPairsOffset = kernPairsOffset;
        _kernPairCount = kernPairCount;
        _locaOffset = locaOffset;
        _longLoca = longLoca;
        _glyfOffset = glyfOffset;
        _glyfLength = glyfLength;
        _reverseCodePoints = new int[glyphCount];
        Array.Fill(_reverseCodePoints, -1);
        BuildReverseMap();
    }

    public UiFontFaceId Id { get; internal set; }

    public UiFontFamilyId Family { get; }

    public string FamilyName { get; }

    public UiFontWeight Weight { get; }

    public UiFontStyle Style { get; }

    public int UnitsPerEm { get; }

    public int GlyphCount { get; }

    public int Ascender { get; }

    public int Descender { get; }

    public int LineGap { get; }

    public UiFontOutlineFormat OutlineFormat { get; }

    internal UiFontBuffer Buffer => _buffer;

    internal int LocaOffset => _locaOffset;

    internal bool LongLoca => _longLoca;

    internal int GlyfOffset => _glyfOffset;

    internal int GlyfLength => _glyfLength;

    public bool TryGetGlyph(int codePoint, out int glyphId) => TryGetBaseGlyph(codePoint, out glyphId);

    public bool TryGetGlyph(int codePoint, int variationSelector, out int glyphId)
    {
        if (variationSelector == 0)
        {
            return TryGetBaseGlyph(codePoint, out glyphId);
        }

        if (TryGetVariationGlyph(codePoint, variationSelector, out glyphId, out _))
        {
            return true;
        }

        return TryGetBaseGlyph(codePoint, out glyphId);
    }

    public bool TryGetVariationGlyph(int codePoint, int variationSelector, out int glyphId, out bool isDefault)
    {
        glyphId = 0;
        isDefault = false;
        if (codePoint < 0 || variationSelector <= 0)
        {
            return false;
        }

        UiCmapVariation[] variations = _cmap.Variations;
        int low = 0;
        int high = variations.Length - 1;
        UiCmapVariation? variation = null;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            UiCmapVariation candidate = variations[middle];
            if (candidate.Selector < (uint)variationSelector)
            {
                low = middle + 1;
            }
            else if (candidate.Selector > (uint)variationSelector)
            {
                high = middle - 1;
            }
            else
            {
                variation = candidate;
                break;
            }
        }

        if (variation is null)
        {
            return false;
        }

        UiCmapUvsMapping[] mappings = variation.Mappings;
        low = 0;
        high = mappings.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            UiCmapUvsMapping mapping = mappings[middle];
            if (mapping.CodePoint < (uint)codePoint)
            {
                low = middle + 1;
            }
            else if (mapping.CodePoint > (uint)codePoint)
            {
                high = middle - 1;
            }
            else
            {
                if (mapping.GlyphId == 0 || mapping.GlyphId >= (uint)GlyphCount)
                {
                    return false;
                }

                glyphId = (int)mapping.GlyphId;
                return true;
            }
        }

        UiCmapUvsRange[] ranges = variation.Ranges;
        low = 0;
        high = ranges.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            UiCmapUvsRange range = ranges[middle];
            if ((uint)codePoint < range.Start)
            {
                high = middle - 1;
            }
            else if ((uint)codePoint > range.Start + range.AdditionalCount)
            {
                low = middle + 1;
            }
            else
            {
                isDefault = true;
                return TryGetBaseGlyph(codePoint, out glyphId);
            }
        }

        return false;
    }

    public int GetCanonicalCodePoint(int glyphId)
    {
        if ((uint)glyphId >= (uint)GlyphCount)
        {
            return -1;
        }

        return _reverseCodePoints[glyphId];
    }

    public bool TryGetGlyphMetrics(int codePoint, out UiGlyphMetrics metrics)
    {
        metrics = default;
        if (!TryGetGlyph(codePoint, out int glyphId))
        {
            return false;
        }

        ReadOnlySpan<byte> data = _buffer.Span;
        int advance = ReadAdvance(data, glyphId);
        int bearingX = ReadLeftSideBearing(data, glyphId);
        int bearingY = 0;
        int width = 0;
        int height = 0;

        if (OutlineFormat == UiFontOutlineFormat.TrueType &&
            TryGetGlyphRange(glyphId, out int glyphOffset, out int glyphLength) &&
            glyphLength >= 10)
        {
            int xMin = ReadI16(data, glyphOffset + 2);
            int yMin = ReadI16(data, glyphOffset + 4);
            int xMax = ReadI16(data, glyphOffset + 6);
            int yMax = ReadI16(data, glyphOffset + 8);
            bearingX = xMin;
            bearingY = yMax;
            width = Math.Max(0, xMax - xMin);
            height = Math.Max(0, yMax - yMin);
        }

        metrics = new UiGlyphMetrics(codePoint, advance, bearingX, bearingY, width, height);
        return true;
    }

    public float GetKerning(int leftCodePoint, int rightCodePoint)
    {
        if (_kernPairCount == 0 ||
            !TryGetGlyph(leftCodePoint, out int left) ||
            !TryGetGlyph(rightCodePoint, out int right))
        {
            return 0.0f;
        }

        uint key = ((uint)left << 16) | (uint)right;
        ReadOnlySpan<byte> data = _buffer.Span;
        int low = 0;
        int high = _kernPairCount - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            int entry = _kernPairsOffset + (middle * 6);
            uint candidate = ReadU32(data, entry);
            if (candidate == key)
            {
                return ReadI16(data, entry + 4);
            }

            if (candidate < key)
            {
                low = middle + 1;
            }
            else
            {
                high = middle - 1;
            }
        }

        return 0.0f;
    }

    internal bool TryGetGlyphRange(int glyphId, out int offset, out int length)
    {
        offset = 0;
        length = 0;
        if (OutlineFormat != UiFontOutlineFormat.TrueType ||
            glyphId < 0 ||
            glyphId >= GlyphCount)
        {
            return false;
        }

        ReadOnlySpan<byte> data = _buffer.Span;
        int start = ReadLocaOffset(data, glyphId);
        int end = ReadLocaOffset(data, glyphId + 1);
        if (end < start || end > _glyfLength)
        {
            return false;
        }

        offset = _glyfOffset + start;
        length = end - start;
        return true;
    }

    internal int ReadLocaOffset(ReadOnlySpan<byte> data, int glyphIndex) =>
        _longLoca
            ? ReadI32(data, _locaOffset + (glyphIndex * 4))
            : ReadU16(data, _locaOffset + (glyphIndex * 2)) * 2;

    internal int ReadAdvance(ReadOnlySpan<byte> data, int glyphId)
    {
        int index = Math.Min(glyphId, _numberOfHMetrics - 1);
        return ReadU16(data, _hmtxOffset + (index * 4));
    }

    internal int ReadLeftSideBearing(ReadOnlySpan<byte> data, int glyphId)
    {
        int offset = glyphId < _numberOfHMetrics
            ? _hmtxOffset + (glyphId * 4) + 2
            : _hmtxOffset + (_numberOfHMetrics * 4) + ((glyphId - _numberOfHMetrics) * 2);
        return ReadI16(data, offset);
    }

    private bool TryGetBaseGlyph(int codePoint, out int glyphId)
    {
        glyphId = 0;
        if (codePoint < 0)
        {
            return false;
        }

        ReadOnlySpan<byte> data = _buffer.Span;
        uint id;
        switch (_cmap.Format)
        {
            case 0:
                if (codePoint >= 256)
                {
                    return false;
                }

                id = data[_cmap.GlyphArrayOffset + codePoint];
                break;
            case 4:
                if (codePoint > 0xFFFF || !TryLookupFormat4(data, (ushort)codePoint, out id))
                {
                    return false;
                }

                break;
            case 6:
                int index = codePoint - _cmap.FirstCode;
                if ((uint)index >= (uint)_cmap.EntryCount)
                {
                    return false;
                }

                id = ReadU16(data, _cmap.GlyphArrayOffset + (index * 2));
                break;
            case 12:
                if (!TryLookupGroups((uint)codePoint, constant: false, out id))
                {
                    return false;
                }

                break;
            case 13:
                if (!TryLookupGroups((uint)codePoint, constant: true, out id))
                {
                    return false;
                }

                break;
            default:
                return false;
        }

        if (id == 0U || id >= (uint)GlyphCount)
        {
            return false;
        }

        glyphId = (int)id;
        return true;
    }

    private bool TryLookupFormat4(ReadOnlySpan<byte> data, ushort codePoint, out uint glyphId)
    {
        glyphId = 0;
        UiCmapSegment[] segments = _cmap.Segments;
        int low = 0;
        int high = segments.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            if (segments[middle].End < codePoint)
            {
                low = middle + 1;
            }
            else
            {
                high = middle - 1;
            }
        }

        if ((uint)low >= (uint)segments.Length)
        {
            return false;
        }

        UiCmapSegment segment = segments[low];
        if (codePoint < segment.Start)
        {
            return false;
        }

        if (segment.GlyphArrayBase < 0)
        {
            glyphId = (uint)((codePoint + segment.Delta) & 0xFFFF);
            return glyphId != 0;
        }

        int address = segment.GlyphArrayBase + ((codePoint - segment.Start) * 2);
        uint mapped = ReadU16(data, address);
        glyphId = mapped == 0 ? 0U : (uint)((mapped + segment.Delta) & 0xFFFF);
        return glyphId != 0;
    }

    private bool TryLookupGroups(uint codePoint, bool constant, out uint glyphId)
    {
        glyphId = 0;
        UiCmapGroup[] groups = _cmap.Groups;
        int low = 0;
        int high = groups.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            UiCmapGroup group = groups[middle];
            if (codePoint < group.Start)
            {
                high = middle - 1;
            }
            else if (codePoint > group.End)
            {
                low = middle + 1;
            }
            else
            {
                glyphId = constant ? group.StartGlyph : group.StartGlyph + (codePoint - group.Start);
                return glyphId != 0;
            }
        }

        return false;
    }

    private void BuildReverseMap()
    {
        switch (_cmap.Format)
        {
            case 0:
                for (int codePoint = 0; codePoint < 256; codePoint++)
                {
                    SetReverse(codePoint);
                }

                break;
            case 4:
                for (int codePoint = 0; codePoint <= 0xFFFF; codePoint++)
                {
                    SetReverse(codePoint);
                }

                break;
            case 6:
                for (int i = 0; i < _cmap.EntryCount; i++)
                {
                    SetReverse(_cmap.FirstCode + i);
                }

                break;
            case 12:
                long budget = 1_000_000;
                UiCmapGroup[] groups = _cmap.Groups;
                for (int g = 0; g < groups.Length && budget > 0; g++)
                {
                    UiCmapGroup group = groups[g];
                    int count = (int)Math.Min(group.End - group.Start + 1, (uint)budget);
                    for (int i = 0; i < count; i++)
                    {
                        int glyph = (int)(group.StartGlyph + (uint)i);
                        if ((uint)glyph < (uint)GlyphCount && _reverseCodePoints[glyph] < 0)
                        {
                            _reverseCodePoints[glyph] = (int)(group.Start + (uint)i);
                        }
                    }

                    budget -= count;
                }

                break;
            case 13:
                foreach (UiCmapGroup group in _cmap.Groups)
                {
                    if ((uint)group.StartGlyph < (uint)GlyphCount &&
                        _reverseCodePoints[group.StartGlyph] < 0)
                    {
                        _reverseCodePoints[group.StartGlyph] = (int)group.Start;
                    }
                }

                break;
        }

        for (int v = 0; v < _cmap.Variations.Length; v++)
        {
            UiCmapUvsMapping[] mappings = _cmap.Variations[v].Mappings;
            for (int i = 0; i < mappings.Length; i++)
            {
                UiCmapUvsMapping mapping = mappings[i];
                if ((uint)mapping.GlyphId < (uint)GlyphCount &&
                    _reverseCodePoints[mapping.GlyphId] < 0)
                {
                    _reverseCodePoints[mapping.GlyphId] = (int)mapping.CodePoint;
                }
            }
        }
    }

    private void SetReverse(int codePoint)
    {
        if (TryGetBaseGlyph(codePoint, out int glyph) && _reverseCodePoints[glyph] < 0)
        {
            _reverseCodePoints[glyph] = codePoint;
        }
    }

    internal static ushort ReadU16(ReadOnlySpan<byte> data, int offset) =>
        (ushort)((data[offset] << 8) | data[offset + 1]);

    internal static short ReadI16(ReadOnlySpan<byte> data, int offset) =>
        (short)((data[offset] << 8) | data[offset + 1]);

    internal static int ReadI32(ReadOnlySpan<byte> data, int offset) =>
        (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];

    internal static uint ReadU32(ReadOnlySpan<byte> data, int offset) =>
        (uint)((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]);
}
