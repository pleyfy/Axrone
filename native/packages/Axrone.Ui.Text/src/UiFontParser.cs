namespace Axrone.Ui.Text;

internal static class UiFontParser
{
    private const int MaxTables = 512;
    private const uint TagHead = 0x68656164;
    private const uint TagHhea = 0x68686561;
    private const uint TagMaxp = 0x6D617870;
    private const uint TagHmtx = 0x686D7478;
    private const uint TagCmap = 0x636D6170;
    private const uint TagLoca = 0x6C6F6361;
    private const uint TagGlyf = 0x676C7966;
    private const uint TagKern = 0x6B65726E;
    private const uint TagGsub = 0x47535542;
    private const uint TagGpos = 0x47504F53;
    private const uint TagCff = 0x43464620;
    private const uint TagCff2 = 0x43464632;
    private const uint TagFvar = 0x66766172;
    private const uint TagGvar = 0x67766172;
    private const uint TagAvar = 0x61766172;
    private const uint TagHvar = 0x48564152;
    private const uint TagMvar = 0x4D564152;
    private const uint TagColr = 0x434F4C52;
    private const uint TagCpal = 0x4350414C;
    private const uint TagFpgm = 0x6670676D;
    private const uint TagPrep = 0x70726570;
    private const uint TagCvt = 0x63767420;
    private const uint SfntTrueType = 0x00010000;
    private const uint SfntOtto = 0x4F54544F;
    private const uint SfntTrue = 0x74727565;
    private const uint WholeFontChecksum = 0xB1B0AFBA;

    public static bool TryParse(
        UiFontBuffer buffer,
        UiFontFamilyId family,
        string familyName,
        UiFontWeight weight,
        UiFontStyle style,
        out UiFontFace? face,
        out UiFontError error)
    {
        ArgumentNullException.ThrowIfNull(buffer);
        ArgumentException.ThrowIfNullOrEmpty(familyName);
        face = null;
        error = UiFontError.None;

        ReadOnlySpan<byte> data = buffer.Span;
        if (data.Length < 12)
        {
            return Fail(out error, UiFontErrorCode.Truncated, 0, "Font payload is shorter than the sfnt header.");
        }

        uint sfntVersion = UiFontFace.ReadU32(data, 0);
        bool cffContainer = sfntVersion == SfntOtto;
        if (sfntVersion != SfntTrueType && sfntVersion != SfntOtto && sfntVersion != SfntTrue)
        {
            return Fail(out error, UiFontErrorCode.UnsupportedSfntVersion, 0, "sfnt version is not supported.");
        }

        int tableCount = UiFontFace.ReadU16(data, 4);
        if (tableCount == 0 || tableCount > MaxTables)
        {
            return Fail(out error, UiFontErrorCode.MalformedContainer, 4, "Table count is invalid.");
        }

        long directoryEnd = 12L + (tableCount * 16L);
        if (directoryEnd > data.Length)
        {
            return Fail(out error, UiFontErrorCode.Truncated, 12, "Table directory is truncated.");
        }

        int headOffset = -1;
        int headLength = 0;
        int hheaOffset = -1;
        int hheaLength = 0;
        int maxpOffset = -1;
        int maxpLength = 0;
        int hmtxOffset = -1;
        int hmtxLength = 0;
        int cmapOffset = -1;
        int cmapLength = 0;
        int locaOffset = -1;
        int locaLength = 0;
        int glyfOffset = -1;
        int glyfLength = 0;
        int kernOffset = -1;
        int kernLength = 0;
        int cffOffset = -1;
        int cffLength = 0;
        int gsubOffset = -1;
        int gsubLength = 0;
        int gposOffset = -1;
        int gposLength = 0;
        int cff2Offset = -1;
        int cff2Length = 0;
        int fvarOffset = -1;
        int fvarLength = 0;
        int gvarOffset = -1;
        int gvarLength = 0;
        int avarOffset = -1;
        int avarLength = 0;
        int hvarOffset = -1;
        int hvarLength = 0;
        int mvarOffset = -1;
        int mvarLength = 0;
        int colrOffset = -1;
        int colrLength = 0;
        int cpalOffset = -1;
        int cpalLength = 0;
        int fpgmOffset = -1;
        int fpgmLength = 0;
        int prepOffset = -1;
        int prepLength = 0;
        int cvtOffset = -1;
        int cvtLength = 0;

        for (int i = 0; i < tableCount; i++)
        {
            int record = 12 + (i * 16);
            uint tag = UiFontFace.ReadU32(data, record);
            uint offset = UiFontFace.ReadU32(data, record + 8);
            uint length = UiFontFace.ReadU32(data, record + 12);
            if (offset > (uint)data.Length || length > (uint)data.Length - offset)
            {
                return Fail(out error, UiFontErrorCode.InvalidTableRange, record, "Table range is outside the font buffer.");
            }

            int tableOffset = (int)offset;
            int tableLength = (int)length;
            switch (tag)
            {
                case TagHead when headOffset < 0:
                    headOffset = tableOffset;
                    headLength = tableLength;
                    break;
                case TagHhea when hheaOffset < 0:
                    hheaOffset = tableOffset;
                    hheaLength = tableLength;
                    break;
                case TagMaxp when maxpOffset < 0:
                    maxpOffset = tableOffset;
                    maxpLength = tableLength;
                    break;
                case TagHmtx when hmtxOffset < 0:
                    hmtxOffset = tableOffset;
                    hmtxLength = tableLength;
                    break;
                case TagCmap when cmapOffset < 0:
                    cmapOffset = tableOffset;
                    cmapLength = tableLength;
                    break;
                case TagLoca when locaOffset < 0:
                    locaOffset = tableOffset;
                    locaLength = tableLength;
                    break;
                case TagGlyf when glyfOffset < 0:
                    glyfOffset = tableOffset;
                    glyfLength = tableLength;
                    break;
                case TagKern when kernOffset < 0:
                    kernOffset = tableOffset;
                    kernLength = tableLength;
                    break;
                case TagCff when cffOffset < 0:
                    cffOffset = tableOffset;
                    cffLength = tableLength;
                    break;
                case TagGsub when gsubOffset < 0:
                    gsubOffset = tableOffset;
                    gsubLength = tableLength;
                    break;
                case TagGpos when gposOffset < 0:
                    gposOffset = tableOffset;
                    gposLength = tableLength;
                    break;
                case TagCff2 when cff2Offset < 0:
                    cff2Offset = tableOffset;
                    cff2Length = tableLength;
                    break;
                case TagFvar when fvarOffset < 0:
                    fvarOffset = tableOffset;
                    fvarLength = tableLength;
                    break;
                case TagGvar when gvarOffset < 0:
                    gvarOffset = tableOffset;
                    gvarLength = tableLength;
                    break;
                case TagAvar when avarOffset < 0:
                    avarOffset = tableOffset;
                    avarLength = tableLength;
                    break;
                case TagHvar when hvarOffset < 0:
                    hvarOffset = tableOffset;
                    hvarLength = tableLength;
                    break;
                case TagMvar when mvarOffset < 0:
                    mvarOffset = tableOffset;
                    mvarLength = tableLength;
                    break;
                case TagColr when colrOffset < 0:
                    colrOffset = tableOffset;
                    colrLength = tableLength;
                    break;
                case TagCpal when cpalOffset < 0:
                    cpalOffset = tableOffset;
                    cpalLength = tableLength;
                    break;
                case TagFpgm when fpgmOffset < 0:
                    fpgmOffset = tableOffset;
                    fpgmLength = tableLength;
                    break;
                case TagPrep when prepOffset < 0:
                    prepOffset = tableOffset;
                    prepLength = tableLength;
                    break;
                case TagCvt when cvtOffset < 0:
                    cvtOffset = tableOffset;
                    cvtLength = tableLength;
                    break;
            }
        }

        if (headOffset < 0 || hheaOffset < 0 || maxpOffset < 0 || hmtxOffset < 0 || cmapOffset < 0)
        {
            return Fail(out error, UiFontErrorCode.MissingTable, 12, "A required sfnt table is missing.");
        }

        if (headLength < 54)
        {
            return Fail(out error, UiFontErrorCode.InvalidHead, headOffset, "head table is truncated.");
        }

        if (UiFontFace.ReadU32(data, headOffset) != 0x00010000 ||
            UiFontFace.ReadU32(data, headOffset + 12) != 0x5F0F3CF5)
        {
            return Fail(out error, UiFontErrorCode.InvalidHead, headOffset, "head version or magic is invalid.");
        }

        int unitsPerEm = UiFontFace.ReadU16(data, headOffset + 18);
        if (unitsPerEm < 16 || unitsPerEm > 16384)
        {
            return Fail(out error, UiFontErrorCode.InvalidHead, headOffset + 18, "unitsPerEm is outside the supported range.");
        }

        int locaFormat = UiFontFace.ReadI16(data, headOffset + 50);
        if (locaFormat != 0 && locaFormat != 1)
        {
            return Fail(out error, UiFontErrorCode.InvalidLoca, headOffset + 50, "indexToLocFormat is invalid.");
        }

        if (maxpLength < 6)
        {
            return Fail(out error, UiFontErrorCode.InvalidMaxp, maxpOffset, "maxp table is truncated.");
        }

        uint maxpVersion = UiFontFace.ReadU32(data, maxpOffset);
        if (maxpVersion != 0x00010000 && maxpVersion != 0x00005000)
        {
            return Fail(out error, UiFontErrorCode.InvalidMaxp, maxpOffset, "maxp version is not supported.");
        }

        int glyphCount = UiFontFace.ReadU16(data, maxpOffset + 4);
        if (glyphCount == 0)
        {
            return Fail(out error, UiFontErrorCode.InvalidMaxp, maxpOffset + 4, "Font declares no glyphs.");
        }

        if (hheaLength < 36)
        {
            return Fail(out error, UiFontErrorCode.InvalidHhea, hheaOffset, "hhea table is truncated.");
        }

        if (UiFontFace.ReadU32(data, hheaOffset) != 0x00010000)
        {
            return Fail(out error, UiFontErrorCode.InvalidHhea, hheaOffset, "hhea version is not supported.");
        }

        int ascender = UiFontFace.ReadI16(data, hheaOffset + 4);
        int descender = UiFontFace.ReadI16(data, hheaOffset + 6);
        int lineGap = UiFontFace.ReadI16(data, hheaOffset + 8);
        int numberOfHMetrics = UiFontFace.ReadU16(data, hheaOffset + 34);
        if (numberOfHMetrics == 0 || numberOfHMetrics > glyphCount)
        {
            return Fail(out error, UiFontErrorCode.InvalidHhea, hheaOffset + 34, "numberOfHMetrics is invalid.");
        }

        long hmtxRequired = (numberOfHMetrics * 4L) + ((glyphCount - numberOfHMetrics) * 2L);
        if (hmtxLength < hmtxRequired)
        {
            return Fail(out error, UiFontErrorCode.InvalidHmtx, hmtxOffset, "hmtx table is truncated.");
        }

        if (!UiCmapParser.TryParse(
                data,
                cmapOffset,
                cmapLength,
                glyphCount,
                out UiCmapData? cmapData,
                out error))
        {
            return false;
        }

        UiFontOutlineFormat outlineFormat;
        bool longLoca = locaFormat == 1;
        UiCffParsed? cff = null;
        if (cffContainer)
        {
            if (cffOffset < 0)
            {
                if (cff2Offset >= 0)
                {
                    return Fail(out error, UiFontErrorCode.UnsupportedOutlineFormat, cff2Offset, "CFF2 outlines are not supported.");
                }

                return Fail(out error, UiFontErrorCode.MissingTable, 12, "CFF table is missing from an OTTO container.");
            }

            if (gvarOffset >= 0 || fvarOffset >= 0)
            {
                return Fail(out error, UiFontErrorCode.InvalidVariation, gvarOffset >= 0 ? gvarOffset : fvarOffset, "gvar and fvar require TrueType outlines.");
            }

            if (!UiCffParser.TryParse(data, cffOffset, cffLength, glyphCount, out cff, out error))
            {
                return false;
            }

            outlineFormat = UiFontOutlineFormat.Cff;
        }
        else
        {
            if (locaOffset < 0 || glyfOffset < 0)
            {
                return Fail(out error, UiFontErrorCode.MissingTable, 12, "TrueType outlines require loca and glyf tables.");
            }

            int entrySize = longLoca ? 4 : 2;
            long locaRequired = (glyphCount + 1L) * entrySize;
            if (locaLength < locaRequired)
            {
                return Fail(out error, UiFontErrorCode.InvalidLoca, locaOffset, "loca table is truncated.");
            }

            int previous = 0;
            for (int glyph = 0; glyph <= glyphCount; glyph++)
            {
                int value = longLoca
                    ? UiFontFace.ReadI32(data, locaOffset + (glyph * 4))
                    : UiFontFace.ReadU16(data, locaOffset + (glyph * 2)) * 2;
                if (value < previous || value > glyfLength)
                {
                    return Fail(out error, UiFontErrorCode.InvalidLoca, locaOffset + (glyph * entrySize), "loca offsets are not monotonic or exceed glyf.");
                }

                previous = value;
            }

            outlineFormat = UiFontOutlineFormat.TrueType;
        }

        if (!UiKernParser.TryParse(data, kernOffset, kernLength, out int kernPairsOffset, out int kernPairCount, out error))
        {
            return false;
        }

        UiGsubData? gsub = null;
        if (gsubOffset >= 0 &&
            !UiOpenTypeLayoutParser.TryParseGsub(data, gsubOffset, gsubLength, glyphCount, out gsub, out error))
        {
            return false;
        }

        UiGposData? gpos = null;
        if (gposOffset >= 0 &&
            !UiOpenTypeLayoutParser.TryParseGpos(data, gposOffset, gposLength, glyphCount, out gpos, out error))
        {
            return false;
        }

        if (!UiVariationParser.TryParse(
                data,
                fvarOffset,
                fvarLength,
                gvarOffset,
                gvarLength,
                avarOffset,
                avarLength,
                hvarOffset,
                hvarLength,
                mvarOffset,
                mvarLength,
                glyphCount,
                out UiVariationData? variation,
                out error))
        {
            return false;
        }

        if (!UiColorData.TryParse(
                data,
                colrOffset,
                colrLength,
                cpalOffset,
                cpalLength,
                out UiColorData? color,
                out error))
        {
            return false;
        }

        UiTrueTypeHintData? hints = null;
        if (fpgmOffset >= 0 || prepOffset >= 0 || cvtOffset >= 0)
        {
            if (cvtOffset >= 0 && (cvtLength & 1) != 0)
            {
                return Fail(out error, UiFontErrorCode.InvalidHinting, cvtOffset, "The cvt table length is not even.");
            }

            hints = new UiTrueTypeHintData(
                fpgmOffset < 0 ? 0 : fpgmOffset,
                fpgmOffset < 0 ? 0 : fpgmLength,
                prepOffset < 0 ? 0 : prepOffset,
                prepOffset < 0 ? 0 : prepLength,
                cvtOffset < 0 ? 0 : cvtOffset,
                cvtOffset < 0 ? 0 : cvtLength / 2);
        }

        if (!TryValidateChecksums(data, tableCount, out error))
        {
            return false;
        }

        face = new UiFontFace(
            buffer,
            family,
            familyName,
            weight,
            style,
            unitsPerEm,
            glyphCount,
            ascender,
            descender,
            lineGap,
            outlineFormat,
            cmapData!,
            cff,
            gsub,
            gpos,
            variation,
            color,
            hints,
            hmtxOffset,
            numberOfHMetrics,
            kernPairsOffset,
            kernPairCount,
            locaOffset,
            longLoca,
            glyfOffset,
            glyfLength);
        return true;
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }

    private static bool TryValidateChecksums(ReadOnlySpan<byte> data, int tableCount, out UiFontError error)
    {
        error = UiFontError.None;
        for (int i = 0; i < tableCount; i++)
        {
            int record = 12 + (i * 16);
            uint tag = UiFontFace.ReadU32(data, record);
            uint expected = UiFontFace.ReadU32(data, record + 4);
            int offset = (int)UiFontFace.ReadU32(data, record + 8);
            int length = (int)UiFontFace.ReadU32(data, record + 12);
            ReadOnlySpan<byte> table = data.Slice(offset, length);
            uint actual = tag == TagHead && length >= 12
                ? Checksum(table[..8]) + Checksum(table[12..])
                : Checksum(table);
            if (actual != expected)
            {
                return Fail(out error, UiFontErrorCode.ChecksumMismatch, record, "A table checksum does not match the directory.");
            }
        }

        if (Checksum(data) != WholeFontChecksum)
        {
            return Fail(out error, UiFontErrorCode.ChecksumMismatch, 0, "The whole-font checksum is invalid.");
        }

        return true;
    }

    private static uint Checksum(ReadOnlySpan<byte> data)
    {
        uint sum = 0;
        int index = 0;
        for (; index + 4 <= data.Length; index += 4)
        {
            sum += (uint)((data[index] << 24) | (data[index + 1] << 16) | (data[index + 2] << 8) | data[index + 3]);
        }

        if (index < data.Length)
        {
            uint last = 0;
            int shift = 24;
            for (; index < data.Length; index++)
            {
                last |= (uint)data[index] << shift;
                shift -= 8;
            }

            sum += last;
        }

        return sum;
    }
}
