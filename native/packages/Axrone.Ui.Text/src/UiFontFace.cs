namespace Axrone.Ui.Text;

/// <summary>Outline container supported by a face.</summary>
public enum UiFontOutlineFormat
{
    /// <summary>TrueType quadratic outlines in glyf/loca.</summary>
    TrueType,

    /// <summary>PostScript Type 2 charstrings in CFF.</summary>
    Cff,
}

/// <summary>One format-4 cmap segment with a precomputed glyph-array address.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiCmapSegment(ushort Start, ushort End, short Delta, int GlyphArrayBase);

/// <summary>One format-12 cmap group.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiCmapGroup(uint Start, uint End, uint StartGlyph);

/// <summary>
/// Parsed font face. All lookup paths read directly from the immutable font
/// buffer; metrics are in font units and the caller scales by size / unitsPerEm.
/// </summary>
public sealed class UiFontFace
{
    private readonly UiFontBuffer _buffer;
    private readonly UiCmapSegment[] _segments;
    private readonly UiCmapGroup[] _groups;
    private readonly int _cmapFormat;
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
        int cmapFormat,
        UiCmapSegment[] segments,
        UiCmapGroup[] groups,
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
        _cmapFormat = cmapFormat;
        _segments = segments;
        _groups = groups;
        _hmtxOffset = hmtxOffset;
        _numberOfHMetrics = numberOfHMetrics;
        _kernPairsOffset = kernPairsOffset;
        _kernPairCount = kernPairCount;
        _locaOffset = locaOffset;
        _longLoca = longLoca;
        _glyfOffset = glyfOffset;
        _glyfLength = glyfLength;
    }

    /// <summary>Gets the registry-assigned face identity.</summary>
    public UiFontFaceId Id { get; internal set; }

    /// <summary>Gets the family identity.</summary>
    public UiFontFamilyId Family { get; }

    /// <summary>Gets the authored family name.</summary>
    public string FamilyName { get; }

    /// <summary>Gets the face weight.</summary>
    public UiFontWeight Weight { get; }

    /// <summary>Gets the face slant.</summary>
    public UiFontStyle Style { get; }

    /// <summary>Gets design units per em.</summary>
    public int UnitsPerEm { get; }

    /// <summary>Gets the glyph count including .notdef.</summary>
    public int GlyphCount { get; }

    /// <summary>Gets the typographic ascender in font units.</summary>
    public int Ascender { get; }

    /// <summary>Gets the typographic descender in font units.</summary>
    public int Descender { get; }

    /// <summary>Gets the line gap in font units.</summary>
    public int LineGap { get; }

    /// <summary>Gets the outline format.</summary>
    public UiFontOutlineFormat OutlineFormat { get; }

    internal UiFontBuffer Buffer => _buffer;

    internal int LocaOffset => _locaOffset;

    internal bool LongLoca => _longLoca;

    internal int GlyfOffset => _glyfOffset;

    internal int GlyfLength => _glyfLength;

    /// <summary>Maps a code point to a non-zero glyph id.</summary>
    public bool TryGetGlyph(int codePoint, out int glyphId)
    {
        glyphId = 0;
        if (codePoint < 0)
        {
            return false;
        }

        ReadOnlySpan<byte> data = _buffer.Span;
        uint id;
        switch (_cmapFormat)
        {
            case 4:
                if (codePoint > 0xFFFF || !TryLookupFormat4(data, (ushort)codePoint, out id))
                {
                    return false;
                }

                break;
            case 12:
                if (!TryLookupFormat12((uint)codePoint, out id))
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

    /// <summary>Reads font-unit metrics for a code point.</summary>
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

    /// <summary>Reads the font-unit kerning adjustment for a code point pair.</summary>
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

    /// <summary>Gets the byte range of a glyph outline inside glyf.</summary>
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

    private bool TryLookupFormat4(ReadOnlySpan<byte> data, ushort codePoint, out uint glyphId)
    {
        glyphId = 0;
        int low = 0;
        int high = _segments.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            if (_segments[middle].End < codePoint)
            {
                low = middle + 1;
            }
            else
            {
                high = middle - 1;
            }
        }

        if ((uint)low >= (uint)_segments.Length)
        {
            return false;
        }

        UiCmapSegment segment = _segments[low];
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

    private bool TryLookupFormat12(uint codePoint, out uint glyphId)
    {
        glyphId = 0;
        int low = 0;
        int high = _groups.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            UiCmapGroup group = _groups[middle];
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
                glyphId = group.StartGlyph + (codePoint - group.Start);
                return glyphId != 0;
            }
        }

        return false;
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
