namespace Axrone.Ui.Text;

internal static class UiCmapParser
{
    private const int MaxRecords = 64;
    private const int MaxSegments = 4096;
    private const int MaxGroups = 65_536;

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int cmapOffset,
        int cmapLength,
        int glyphCount,
        out int format,
        out UiCmapSegment[] segments,
        out UiCmapGroup[] groups,
        out UiFontError error)
    {
        format = 0;
        segments = [];
        groups = [];
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

        format = bestFormat;
        return bestFormat == 4
            ? TryParseFormat4(data, bestSubtable, cmapEnd, out segments, out error)
            : TryParseFormat12(data, bestSubtable, cmapEnd, glyphCount, out groups, out error);
    }

    private static bool TryParseFormat4(
        ReadOnlySpan<byte> data,
        int subtable,
        int cmapEnd,
        out UiCmapSegment[] segments,
        out UiFontError error)
    {
        segments = [];
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
        var result = new UiCmapSegment[segmentCount];
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

            result[i] = new UiCmapSegment((ushort)start, (ushort)end, (short)delta, glyphArrayBase);
        }

        segments = result;
        return true;
    }

    private static bool TryParseFormat12(
        ReadOnlySpan<byte> data,
        int subtable,
        int cmapEnd,
        int glyphCount,
        out UiCmapGroup[] groups,
        out UiFontError error)
    {
        groups = [];
        error = UiFontError.None;

        uint length = UiFontFace.ReadU32(data, subtable + 4);
        if (length < 16 || (long)subtable + length > cmapEnd)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 12 length is invalid.");
        }

        uint groupCount = UiFontFace.ReadU32(data, subtable + 12);
        if (groupCount == 0 || groupCount > MaxGroups)
        {
            return Fail(out error, UiFontErrorCode.ResourceLimit, subtable, "cmap format 12 group count is invalid.");
        }

        long groupsEnd = 16L + (12L * groupCount);
        if (groupsEnd > length)
        {
            return Fail(out error, UiFontErrorCode.InvalidCmap, subtable, "cmap format 12 groups exceed the subtable.");
        }

        var result = new UiCmapGroup[(int)groupCount];
        uint previousEnd = 0;
        for (int i = 0; i < result.Length; i++)
        {
            int group = subtable + 16 + (i * 12);
            uint start = UiFontFace.ReadU32(data, group);
            uint end = UiFontFace.ReadU32(data, group + 4);
            uint startGlyph = UiFontFace.ReadU32(data, group + 8);
            if (start > end || end > 0x10FFFF || (i > 0 && start <= previousEnd))
            {
                return Fail(out error, UiFontErrorCode.InvalidCmap, group, "cmap format 12 groups are invalid.");
            }

            ulong lastGlyph = (ulong)startGlyph + (end - start);
            if (lastGlyph >= (ulong)glyphCount)
            {
                return Fail(out error, UiFontErrorCode.InvalidCmap, group, "cmap format 12 glyph id is out of range.");
            }

            result[i] = new UiCmapGroup(start, end, startGlyph);
            previousEnd = end;
        }

        groups = result;
        return true;
    }

    private static int Score(int platform, int encoding, int format)
    {
        if (format == 12)
        {
            if ((platform == 3 && encoding == 10) || (platform == 0 && (encoding == 4 || encoding == 6)))
            {
                return 5;
            }

            return 3;
        }

        if (format == 4)
        {
            if ((platform == 3 && encoding == 1) || (platform == 0 && encoding == 3))
            {
                return 4;
            }

            return 2;
        }

        return 0;
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }
}
