namespace Axrone.Ui.Text;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiCmapUvsRange(uint Start, uint AdditionalCount);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly record struct UiCmapUvsMapping(uint CodePoint, uint GlyphId);

internal sealed class UiCmapVariation
{
    public UiCmapVariation(uint selector, UiCmapUvsRange[] ranges, UiCmapUvsMapping[] mappings)
    {
        Selector = selector;
        Ranges = ranges;
        Mappings = mappings;
    }

    public uint Selector { get; }

    public UiCmapUvsRange[] Ranges { get; }

    public UiCmapUvsMapping[] Mappings { get; }
}

internal sealed class UiCmapData
{
    public int Format { get; set; }

    public UiCmapSegment[] Segments { get; set; } = [];

    public UiCmapGroup[] Groups { get; set; } = [];

    public int FirstCode { get; set; }

    public int EntryCount { get; set; }

    public int GlyphArrayOffset { get; set; }

    public UiCmapVariation[] Variations { get; set; } = [];
}

internal static class UiCmapParser
{
    private const int MaxRecords = 64;
    private const int MaxSegments = 4096;
    private const int MaxGroups = 65_536;
    private const int MaxVariations = 64;
    private const int MaxUvsRanges = 8192;
    private const int MaxUvsMappings = 8192;

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int cmapOffset,
        int cmapLength,
        int glyphCount,
        out UiCmapData? cmap,
        out UiFontError error)
    {
        cmap = null;
        error = UiFontError.None;

        if (cmapLength < 4 || UiFontFace.ReadU16(data, cmapOffset) != 0)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, cmapOffset, "cmap header is invalid.");
        }

        int recordCount = UiFontFace.ReadU16(data, cmapOffset + 2);
        if (recordCount == 0 || recordCount > MaxRecords || 4 + (recordCount * 8) > cmapLength)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, cmapOffset, "cmap encoding records are invalid.");
        }

        int cmapEnd = cmapOffset + cmapLength;
        int bestScore = -1;
        int bestSubtable = -1;
        int bestFormat = 0;
        var variationSubtables = new List<int>(4);

        for (int i = 0; i < recordCount; i++)
        {
            int record = cmapOffset + 4 + (i * 8);
            int platform = UiFontFace.ReadU16(data, record);
            int encoding = UiFontFace.ReadU16(data, record + 2);
            int subOffset = UiFontFace.ReadI32(data, record + 4);
            if (subOffset < 0 || (long)cmapOffset + subOffset + 4 > cmapEnd)
            {
                return Fail(out error, UiFontErrorCode.InvalidCmap, record, "cmap subtable offset is out of range.");
            }

            int subtable = cmapOffset + subOffset;
            int subFormat = UiFontFace.ReadU16(data, subtable);
            if (subFormat == 14)
            {
                variationSubtables.Add(subtable);
                continue;
            }

            int score = Score(platform, encoding, subFormat);
            if (score > bestScore)
            {
                bestScore = score;
                bestSubtable = subtable;
                bestFormat = subFormat;
            }
        }

        if (bestScore <= 0 || bestSubtable < 0)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, cmapOffset, "No supported Unicode cmap subtable was found.");
        }

        var result = new UiCmapData { Format = bestFormat };
        bool parsed = bestFormat switch
        {
            0 => TryParseFormat0(data, bestSubtable, cmapEnd, out result, out error),
            4 => TryParseFormat4(data, bestSubtable, cmapEnd, out result, out error),
            6 => TryParseFormat6(data, bestSubtable, cmapEnd, out result, out error),
            12 => TryParseGroups(data, bestSubtable, cmapEnd, glyphCount, constant: false, out result, out error),
            13 => TryParseGroups(data, bestSubtable, cmapEnd, glyphCount, constant: true, out result, out error),
            _ => Fail(out error, UiFontErrorCode.InvalidCmap, bestSubtable, "The cmap format is not supported."),
        };

        if (!parsed)
        {
            return false;
        }

        if (variationSubtables.Count > 0)
        {
            if (!TryParseVariations(data, variationSubtables, cmapEnd, glyphCount, out UiCmapVariation[] variations, out error))
            {
                return false;
            }

            result.Variations = variations;
        }

        cmap = result;
        return true;
    }

    private static bool TryParseFormat0(ReadOnlySpan<byte> data, int subtable, int cmapEnd, out UiCmapData cmap, out UiFontError error)
    {
        cmap = null!;
        error = UiFontError.None;
        int length = UiFontFace.ReadU16(data, subtable + 2);
        if (length < 262 || (long)subtable + length > cmapEnd)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 0 length is invalid.");
        }

        cmap = new UiCmapData
        {
            Format = 0,
            GlyphArrayOffset = subtable + 6,
            EntryCount = 256,
        };
        return true;
    }

    private static bool TryParseFormat6(ReadOnlySpan<byte> data, int subtable, int cmapEnd, out UiCmapData cmap, out UiFontError error)
    {
        cmap = null!;
        error = UiFontError.None;
        int length = UiFontFace.ReadU16(data, subtable + 2);
        int firstCode = UiFontFace.ReadU16(data, subtable + 6);
        int entryCount = UiFontFace.ReadU16(data, subtable + 8);
        if (length < 10 || (long)subtable + length > cmapEnd || 10 + (entryCount * 2) > length)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 6 length is invalid.");
        }

        cmap = new UiCmapData
        {
            Format = 6,
            FirstCode = firstCode,
            EntryCount = entryCount,
            GlyphArrayOffset = subtable + 10,
        };
        return true;
    }

    private static bool TryParseFormat4(ReadOnlySpan<byte> data, int subtable, int cmapEnd, out UiCmapData cmap, out UiFontError error)
    {
        cmap = null!;
        error = UiFontError.None;
        int length = UiFontFace.ReadU16(data, subtable + 2);
        if (length < 16 || (long)subtable + length > cmapEnd)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 4 length is invalid.");
        }

        int segmentCountX2 = UiFontFace.ReadU16(data, subtable + 6);
        if (segmentCountX2 == 0 || (segmentCountX2 & 1) != 0)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 4 segment count is invalid.");
        }

        int segmentCount = segmentCountX2 / 2;
        if (segmentCount > MaxSegments)
        {
            return Fail(out error, UiFontErrorCode.ResourceLimit, subtable, "cmap format 4 segment count exceeds the limit.");
        }

        int arraysEnd = 16 + (4 * segmentCountX2);
        if (length < arraysEnd)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 4 arrays exceed the subtable.");
        }

        int endCodes = subtable + 14;
        int startCodes = subtable + 16 + segmentCountX2;
        int deltas = subtable + 16 + (2 * segmentCountX2);
        int rangeOffsets = subtable + 16 + (3 * segmentCountX2);
        int subtableEnd = subtable + length;
        var segments = new UiCmapSegment[segmentCount];
        int previousEnd = -1;

        for (int i = 0; i < segmentCount; i++)
        {
            int start = UiFontFace.ReadU16(data, startCodes + (i * 2));
            int end = UiFontFace.ReadU16(data, endCodes + (i * 2));
            if (start > end || end < previousEnd)
            {
                return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 4 segments are not sorted.");
            }

            previousEnd = end;
            int delta = UiFontFace.ReadI16(data, deltas + (i * 2));
            int rangeOffset = UiFontFace.ReadU16(data, rangeOffsets + (i * 2));
            int glyphArrayBase = -1;
            if (rangeOffset != 0)
            {
                glyphArrayBase = rangeOffsets + (i * 2) + rangeOffset;
                int last = glyphArrayBase + ((end - start) * 2);
                if (last < subtable || last + 2 > subtableEnd)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 4 glyph array is out of range.");
                }
            }

            segments[i] = new UiCmapSegment((ushort)start, (ushort)end, (short)delta, glyphArrayBase);
        }

        cmap = new UiCmapData { Format = 4, Segments = segments };
        return true;
    }

    private static bool TryParseGroups(
        ReadOnlySpan<byte> data,
        int subtable,
        int cmapEnd,
        int glyphCount,
        bool constant,
        out UiCmapData cmap,
        out UiFontError error)
    {
        cmap = null!;
        error = UiFontError.None;
        uint length = UiFontFace.ReadU32(data, subtable + 4);
        if (length < 16 || (long)subtable + length > cmapEnd)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap group length is invalid.");
        }

        uint groupCount = UiFontFace.ReadU32(data, subtable + 12);
        if (groupCount == 0 || groupCount > MaxGroups)
        {
            return Fail(out error, UiFontErrorCode.ResourceLimit, subtable, "cmap group count is invalid.");
        }

        long groupsEnd = 16L + (12L * groupCount);
        if (groupsEnd > length)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap groups exceed the subtable.");
        }

        var groups = new UiCmapGroup[(int)groupCount];
        uint previousEnd = 0;
        for (int i = 0; i < groups.Length; i++)
        {
            int group = subtable + 16 + (i * 12);
            uint start = UiFontFace.ReadU32(data, group);
            uint end = UiFontFace.ReadU32(data, group + 4);
            uint startGlyph = UiFontFace.ReadU32(data, group + 8);
            if (start > end || end > 0x10FFFF || (i > 0 && start <= previousEnd))
            {
                return Fail(out error, UiFontErrorCode.InvalidCmap, group, "cmap groups are invalid.");
            }

            ulong lastGlyph = constant ? startGlyph : (ulong)startGlyph + (end - start);
            if (lastGlyph >= (ulong)glyphCount)
            {
                return Fail(out error, UiFontErrorCode.InvalidCmap, group, "cmap glyph id is out of range.");
            }

            groups[i] = new UiCmapGroup(start, end, startGlyph);
            previousEnd = end;
        }

        cmap = new UiCmapData { Format = constant ? 13 : 12, Groups = groups };
        return true;
    }

    private static bool TryParseVariations(
        ReadOnlySpan<byte> data,
        List<int> subtables,
        int cmapEnd,
        int glyphCount,
        out UiCmapVariation[] variations,
        out UiFontError error)
    {
        variations = [];
        error = UiFontError.None;
        var result = new List<UiCmapVariation>(Math.Min(subtables.Count, MaxVariations));

        for (int s = 0; s < subtables.Count; s++)
        {
            if (result.Count >= MaxVariations)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, subtables[s], "cmap variation selector count exceeds the limit.");
            }

            int subtable = subtables[s];
            uint length = UiFontFace.ReadU32(data, subtable + 2);
            if (length < 10 || (long)subtable + length > cmapEnd)
            {
                return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 14 length is invalid.");
            }

            uint recordCount = UiFontFace.ReadU32(data, subtable + 6);
            if (recordCount == 0 || 10L + (recordCount * 11L) > length)
            {
                return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 14 records are invalid.");
            }

            int subtableEnd = subtable + (int)length;
            for (int i = 0; i < recordCount; i++)
            {
                int record = subtable + 10 + (i * 11);
                uint selector = ReadU24(data, record);
                uint defaultOffset = UiFontFace.ReadU32(data, record + 3);
                uint nonDefaultOffset = UiFontFace.ReadU32(data, record + 7);
                if (result.Count >= MaxVariations)
                {
                    return Fail(out error, UiFontErrorCode.ResourceLimit, record, "cmap variation selector count exceeds the limit.");
                }

                if (defaultOffset >= (uint)length || nonDefaultOffset >= (uint)length)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCmap, record, "cmap format 14 offsets are invalid.");
                }

                UiCmapUvsRange[] ranges = [];
                if (defaultOffset != 0 &&
                    !TryParseUvsRanges(data, subtable, subtableEnd, defaultOffset, out ranges))
                {
                    return Fail(out error, UiFontErrorCode.InvalidCmap, record, "cmap format 14 default ranges are invalid.");
                }

                UiCmapUvsMapping[] mappings = [];
                if (nonDefaultOffset != 0 &&
                    !TryParseUvsMappings(data, subtable, subtableEnd, nonDefaultOffset, glyphCount, out mappings))
                {
                    return Fail(out error, UiFontErrorCode.InvalidCmap, record, "cmap format 14 mappings are invalid.");
                }

                result.Add(new UiCmapVariation(selector, ranges, mappings));
            }
        }

        result.Sort(static (left, right) => left.Selector.CompareTo(right.Selector));
        variations = [.. result];
        return true;
    }

    private static bool TryParseUvsRanges(
        ReadOnlySpan<byte> data,
        int subtable,
        int subtableEnd,
        uint offset,
        out UiCmapUvsRange[] ranges)
    {
        ranges = [];
        int position = subtable + (int)offset;
        if (position < subtable || position + 4 > subtableEnd)
        {
            return false;
        }

        uint count = UiFontFace.ReadU32(data, position);
        if (count == 0)
        {
            return true;
        }

        if (count > MaxUvsRanges || position + 4L + (count * 4L) > subtableEnd)
        {
            return false;
        }

        var result = new UiCmapUvsRange[count];
        uint previous = 0;
        for (int i = 0; i < result.Length; i++)
        {
            int entry = position + 4 + (i * 4);
            uint start = ReadU24(data, entry);
            uint additional = data[entry + 3];
            uint end = start + additional;
            if (end > 0x10FFFF || (i > 0 && start <= previous))
            {
                return false;
            }

            result[i] = new UiCmapUvsRange(start, additional);
            previous = end;
        }

        ranges = result;
        return true;
    }

    private static bool TryParseUvsMappings(
        ReadOnlySpan<byte> data,
        int subtable,
        int subtableEnd,
        uint offset,
        int glyphCount,
        out UiCmapUvsMapping[] mappings)
    {
        mappings = [];
        int position = subtable + (int)offset;
        if (position < subtable || position + 4 > subtableEnd)
        {
            return false;
        }

        uint count = UiFontFace.ReadU32(data, position);
        if (count == 0)
        {
            return true;
        }

        if (count > MaxUvsMappings || position + 4L + (count * 5L) > subtableEnd)
        {
            return false;
        }

        var result = new UiCmapUvsMapping[count];
        uint previous = 0;
        for (int i = 0; i < result.Length; i++)
        {
            int entry = position + 4 + (i * 5);
            uint codePoint = ReadU24(data, entry);
            uint glyph = UiFontFace.ReadU16(data, entry + 3);
            if (codePoint > 0x10FFFF || glyph >= (uint)glyphCount || (i > 0 && codePoint <= previous))
            {
                return false;
            }

            result[i] = new UiCmapUvsMapping(codePoint, glyph);
            previous = codePoint;
        }

        mappings = result;
        return true;
    }

    private static uint ReadU24(ReadOnlySpan<byte> data, int offset) =>
        (uint)((data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]);

    private static int Score(int platform, int encoding, int format)
    {
        int baseScore = format switch
        {
            12 => 60,
            4 => 50,
            13 => 40,
            6 => 30,
            0 => 20,
            _ => 0,
        };
        if (baseScore == 0)
        {
            return 0;
        }

        bool unicode = platform == 0 ||
            (platform == 3 && (encoding == 0 || encoding == 1 || encoding == 10));
        return baseScore + (unicode ? 5 : 0);
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }
}
