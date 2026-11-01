namespace Axrone.Ui.Text;

internal static class UiCffParser
{
    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int cffOffset,
        int cffLength,
        int glyphCount,
        out UiCffParsed? cff,
        out UiFontError error)
    {
        cff = null;
        error = UiFontError.None;

        if (cffOffset < 0 || cffLength < 4 || (long)cffOffset + cffLength > data.Length)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, cffOffset, "CFF table range is invalid.");
        }

        int cffEnd = cffOffset + cffLength;
        if (data[cffOffset] != 1)
        {
            return Fail(out error, UiFontErrorCode.UnsupportedOutlineFormat, cffOffset, "Only CFF version 1 is supported.");
        }

        int headerSize = data[cffOffset + 2];
        int headerOffSize = data[cffOffset + 3];
        if (headerSize < 4 || headerSize > cffLength || headerOffSize < 1 || headerOffSize > 4)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, cffOffset + 2, "CFF header is invalid.");
        }

        int cursor = cffOffset + headerSize;
        if (!UiCffIndex.TryParse(data, cursor, cffEnd, out _, out int afterNames, out error))
        {
            return false;
        }

        if (!UiCffIndex.TryParse(data, afterNames, cffEnd, out UiCffIndex? topDicts, out int afterTop, out error))
        {
            return false;
        }

        if (topDicts is null || topDicts.Count == 0)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, afterNames, "CFF Top DICT is missing.");
        }

        if (!UiCffIndex.TryParse(data, afterTop, cffEnd, out _, out int afterStrings, out error))
        {
            return false;
        }

        if (!UiCffIndex.TryParse(data, afterStrings, cffEnd, out UiCffIndex? globalSubrs, out _, out error))
        {
            return false;
        }

        if (!TryParseTopDict(topDicts.Get(data, 0), out TopDict top, out error))
        {
            return false;
        }

        if (top.CharStrings <= 0 || (long)cffOffset + top.CharStrings >= cffEnd)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, cffOffset, "CFF CharStrings offset is invalid.");
        }

        if (!UiCffIndex.TryParse(data, cffOffset + top.CharStrings, cffEnd, out UiCffIndex? charStrings, out _, out error))
        {
            return false;
        }

        if (charStrings is null || charStrings.Count != glyphCount)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, cffOffset + top.CharStrings, "CFF CharStrings count does not match maxp.");
        }

        UiCffIndex localSubrs = UiCffIndex.Empty;
        UiCffIndex[]? fdLocalSubrs = null;
        byte[]? fdByGlyph = null;

        if (top.IsCid)
        {
            if (top.FdArray <= 0 || (long)cffOffset + top.FdArray >= cffEnd ||
                top.FdSelect <= 0 || (long)cffOffset + top.FdSelect >= cffEnd)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, cffOffset, "CFF CID offsets are invalid.");
            }

            if (!UiCffIndex.TryParse(data, cffOffset + top.FdArray, cffEnd, out UiCffIndex? fdDicts, out _, out error))
            {
                return false;
            }

            if (fdDicts is null || fdDicts.Count == 0)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, cffOffset + top.FdArray, "CFF FDArray is empty.");
            }

            fdLocalSubrs = new UiCffIndex[fdDicts.Count];
            for (int i = 0; i < fdDicts.Count; i++)
            {
                if (!TryParseFdDict(fdDicts.Get(data, i), out int privateSize, out int privateOffset, out error))
                {
                    return false;
                }

                fdLocalSubrs[i] = privateSize <= 0
                    ? UiCffIndex.Empty
                    : ParseLocalSubrs(data, cffOffset, privateOffset, privateSize, cffEnd, out error);

                if (error.HasError)
                {
                    return false;
                }
            }

            if (!TryParseFdSelect(
                    data,
                    cffOffset + top.FdSelect,
                    cffEnd,
                    glyphCount,
                    fdDicts.Count,
                    out fdByGlyph,
                    out error))
            {
                return false;
            }
        }
        else if (top.PrivateSize > 0)
        {
            localSubrs = ParseLocalSubrs(data, cffOffset, top.PrivateOffset, top.PrivateSize, cffEnd, out error);
            if (error.HasError)
            {
                return false;
            }
        }

        var bounds = new UiCffGlyphBounds[glyphCount];
        var path = new UiCffPath();
        for (int glyph = 0; glyph < glyphCount; glyph++)
        {
            if (!charStrings.TryGetRange(glyph, out int start, out int end))
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, cffOffset, "CFF charstring range is invalid.");
            }

            UiCffIndex subrs = fdByGlyph is null
                ? localSubrs
                : fdLocalSubrs![fdByGlyph[glyph]];
            path.Clear();
            if (!UiCffInterpreter.TryRun(data, start, end, globalSubrs ?? UiCffIndex.Empty, subrs, path, out error))
            {
                error = UiFontError.At(UiFontErrorCode.InvalidCff, error.Offset, $"CFF charstring for glyph {glyph} is invalid: {error.Message}");
                return false;
            }

            bounds[glyph] = UiCffInterpreter.Measure(path);
        }

        cff = new UiCffParsed(
            charStrings,
            globalSubrs ?? UiCffIndex.Empty,
            localSubrs,
            fdLocalSubrs,
            fdByGlyph,
            bounds);
        return true;
    }

    private static UiCffIndex ParseLocalSubrs(
        ReadOnlySpan<byte> data,
        int cffOffset,
        int privateOffset,
        int privateSize,
        int cffEnd,
        out UiFontError error)
    {
        error = UiFontError.None;
        long privateStart = (long)cffOffset + privateOffset;
        if (privateOffset <= 0 || privateSize <= 0 || privateStart + privateSize > cffEnd)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidCff, (int)privateStart, "CFF Private DICT range is invalid.");
            return UiCffIndex.Empty;
        }

        ReadOnlySpan<byte> privateDict = data.Slice((int)privateStart, privateSize);
        if (!TryParsePrivateDict(privateDict, out int subrsOffset, out error))
        {
            return UiCffIndex.Empty;
        }

        if (subrsOffset <= 0)
        {
            return UiCffIndex.Empty;
        }

        long subrsStart = privateStart + subrsOffset;
        if (subrsStart >= cffEnd)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidCff, (int)subrsStart, "CFF local subrs offset is invalid.");
            return UiCffIndex.Empty;
        }

        if (!UiCffIndex.TryParse(data, (int)subrsStart, cffEnd, out UiCffIndex? subrs, out _, out error))
        {
            return UiCffIndex.Empty;
        }

        return subrs ?? UiCffIndex.Empty;
    }

    private static bool TryParseTopDict(ReadOnlySpan<byte> dict, out TopDict top, out UiFontError error)
    {
        top = new TopDict
        {
            CharStrings = -1,
            PrivateSize = -1,
            PrivateOffset = -1,
            FdArray = -1,
            FdSelect = -1,
        };
        error = UiFontError.None;
        Span<double> stack = stackalloc double[48];
        int count = 0;
        int position = 0;

        while (position < dict.Length)
        {
            int b0 = dict[position++];
            if (b0 <= 21)
            {
                if (b0 == 12)
                {
                    if (position >= dict.Length)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF Top DICT escape is truncated.");
                    }

                    int b1 = dict[position++];
                    if (b1 == 30)
                    {
                        top.IsCid = true;
                    }
                    else if (b1 == 36)
                    {
                        if (count < 1)
                        {
                            return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF FDArray operand is missing.");
                        }

                        top.FdArray = (int)stack[count - 1];
                    }
                    else if (b1 == 37)
                    {
                        if (count < 1)
                        {
                            return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF FDSelect operand is missing.");
                        }

                        top.FdSelect = (int)stack[count - 1];
                    }
                }
                else if (b0 == 17)
                {
                    if (count < 1)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF CharStrings operand is missing.");
                    }

                    top.CharStrings = (int)stack[count - 1];
                }
                else if (b0 == 18)
                {
                    if (count < 2)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF Private operands are missing.");
                    }

                    top.PrivateSize = (int)stack[count - 2];
                    top.PrivateOffset = (int)stack[count - 1];
                }

                count = 0;
                continue;
            }

            if (!TryReadNumber(dict, ref position, b0, out double value, out error))
            {
                return false;
            }

            if (count >= stack.Length)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, position, "CFF Top DICT stack overflow.");
            }

            stack[count++] = value;
        }

        return true;
    }

    private static bool TryParsePrivateDict(ReadOnlySpan<byte> dict, out int subrsOffset, out UiFontError error)
    {
        subrsOffset = -1;
        error = UiFontError.None;
        Span<double> stack = stackalloc double[48];
        int count = 0;
        int position = 0;

        while (position < dict.Length)
        {
            int b0 = dict[position++];
            if (b0 <= 21)
            {
                if (b0 == 19)
                {
                    if (count < 1)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF Subrs operand is missing.");
                    }

                    subrsOffset = (int)stack[count - 1];
                }

                count = 0;
                continue;
            }

            if (!TryReadNumber(dict, ref position, b0, out double value, out error))
            {
                return false;
            }

            if (count >= stack.Length)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, position, "CFF Private DICT stack overflow.");
            }

            stack[count++] = value;
        }

        return true;
    }

    private static bool TryParseFdDict(
        ReadOnlySpan<byte> dict,
        out int privateSize,
        out int privateOffset,
        out UiFontError error)
    {
        privateSize = -1;
        privateOffset = -1;
        error = UiFontError.None;
        Span<double> stack = stackalloc double[48];
        int count = 0;
        int position = 0;

        while (position < dict.Length)
        {
            int b0 = dict[position++];
            if (b0 <= 21)
            {
                if (b0 == 18)
                {
                    if (count < 2)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF FD Private operands are missing.");
                    }

                    privateSize = (int)stack[count - 2];
                    privateOffset = (int)stack[count - 1];
                }

                count = 0;
                continue;
            }

            if (!TryReadNumber(dict, ref position, b0, out double value, out error))
            {
                return false;
            }

            if (count >= stack.Length)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, position, "CFF FD DICT stack overflow.");
            }

            stack[count++] = value;
        }

        return true;
    }

    private static bool TryParseFdSelect(
        ReadOnlySpan<byte> data,
        int offset,
        int limit,
        int glyphCount,
        int fdCount,
        out byte[]? map,
        out UiFontError error)
    {
        map = null;
        error = UiFontError.None;
        if (offset < 0 || offset >= limit)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, offset, "CFF FDSelect offset is invalid.");
        }

        int format = data[offset];
        if (format == 0)
        {
            if ((long)offset + 1 + glyphCount > limit)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, offset, "CFF FDSelect format 0 is truncated.");
            }

            map = new byte[glyphCount];
            for (int glyph = 0; glyph < glyphCount; glyph++)
            {
                int fd = data[offset + 1 + glyph];
                if (fd >= fdCount)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCff, offset + 1 + glyph, "CFF FDSelect face index is out of range.");
                }

                map[glyph] = (byte)fd;
            }

            return true;
        }

        if (format != 3)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, offset, "CFF FDSelect format is not supported.");
        }

        if ((long)offset + 5 > limit)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, offset, "CFF FDSelect format 3 is truncated.");
        }

        int rangeCount = UiFontFace.ReadU16(data, offset + 1);
        if (rangeCount == 0 || (long)offset + 7 + (rangeCount * 3L) > limit)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, offset, "CFF FDSelect range count is invalid.");
        }

        int ranges = offset + 3;
        int sentinel = UiFontFace.ReadU16(data, ranges + (rangeCount * 3));
        if (sentinel != glyphCount)
        {
            return Fail(out error, UiFontErrorCode.InvalidCff, ranges, "CFF FDSelect sentinel does not match the glyph count.");
        }

        map = new byte[glyphCount];
        int previousFirst = -1;
        for (int i = 0; i < rangeCount; i++)
        {
            int entry = ranges + (i * 3);
            int first = UiFontFace.ReadU16(data, entry);
            int fd = data[entry + 2];
            if (fd >= fdCount || first <= previousFirst || first >= glyphCount)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, entry, "CFF FDSelect range is invalid.");
            }

            if (i == 0 && first != 0)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, entry, "CFF FDSelect must start at glyph zero.");
            }

            int next = i + 1 < rangeCount ? UiFontFace.ReadU16(data, entry + 3) : sentinel;
            if (next <= first || next > glyphCount)
            {
                return Fail(out error, UiFontErrorCode.InvalidCff, entry, "CFF FDSelect range end is invalid.");
            }

            for (int glyph = first; glyph < next; glyph++)
            {
                map[glyph] = (byte)fd;
            }

            previousFirst = first;
        }

        return true;
    }

    private static bool TryReadNumber(
        ReadOnlySpan<byte> dict,
        ref int position,
        int b0,
        out double value,
        out UiFontError error)
    {
        value = 0.0;
        error = UiFontError.None;
        switch (b0)
        {
            case 28:
                if (position + 2 > dict.Length)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF DICT number is truncated.");
                }

                value = UiFontFace.ReadI16(dict, position);
                position += 2;
                return true;
            case 29:
                if (position + 4 > dict.Length)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF DICT number is truncated.");
                }

                value = UiFontFace.ReadI32(dict, position);
                position += 4;
                return true;
            case 30:
                while (position < dict.Length)
                {
                    int packed = dict[position++];
                    if ((packed >> 4) == 0x0F || (packed & 0x0F) == 0x0F)
                    {
                        break;
                    }
                }

                return true;
            case 255:
                if (position + 4 > dict.Length)
                {
                    return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF DICT fixed number is truncated.");
                }

                value = UiFontFace.ReadI32(dict, position) / 65536.0;
                position += 4;
                return true;
            default:
                if (b0 >= 32 && b0 <= 246)
                {
                    value = b0 - 139;
                    return true;
                }

                if (b0 >= 247 && b0 <= 250)
                {
                    if (position >= dict.Length)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF DICT number is truncated.");
                    }

                    value = ((b0 - 247) * 256) + dict[position++] + 108;
                    return true;
                }

                if (b0 >= 251 && b0 <= 254)
                {
                    if (position >= dict.Length)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF DICT number is truncated.");
                    }

                    value = -((b0 - 251) * 256) - dict[position++] - 108;
                    return true;
                }

                return Fail(out error, UiFontErrorCode.InvalidCff, position, "CFF DICT number encoding is invalid.");
        }
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }

    private struct TopDict
    {
        public int CharStrings;
        public int PrivateSize;
        public int PrivateOffset;
        public int FdArray;
        public int FdSelect;
        public bool IsCid;
    }
}
