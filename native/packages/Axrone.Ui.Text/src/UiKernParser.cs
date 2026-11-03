namespace Axrone.Ui.Text;

internal static class UiKernParser
{
    private const int MaxPairs = 65_536;

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int kernOffset,
        int kernLength,
        out int pairsOffset,
        out int pairCount,
        out UiFontError error)
    {
        pairsOffset = -1;
        pairCount = 0;
        error = UiFontError.None;
        if (kernOffset < 0)
        {
            return true;
        }

        if (kernLength < 4)
        {
            return Fail(out error, UiFontErrorCode.InvalidKern, kernOffset, "kern table is truncated.");
        }

        if (UiFontFace.ReadU16(data, kernOffset) != 0)
        {
            return Fail(
                out error,
                UiFontErrorCode.UnsupportedKernVersion,
                kernOffset,
                "kern table version is not supported.");
        }

        int subtableCount = UiFontFace.ReadU16(data, kernOffset + 2);
        int cursor = kernOffset + 4;
        int tableEnd = kernOffset + kernLength;
        for (int i = 0; i < subtableCount; i++)
        {
            if (cursor + 6 > tableEnd)
            {
                return Fail(out error, UiFontErrorCode.InvalidKern, cursor, "kern subtable header is truncated.");
            }

            int version = UiFontFace.ReadU16(data, cursor);
            int length = UiFontFace.ReadU16(data, cursor + 2);
            int coverage = UiFontFace.ReadU16(data, cursor + 4);
            if (version != 0 || length < 6 || (long)cursor + length > tableEnd)
            {
                return Fail(out error, UiFontErrorCode.InvalidKern, cursor, "kern subtable header is invalid.");
            }

            int format = coverage >> 8;
            bool horizontal = (coverage & 1) != 0;
            if (format == 0 && horizontal)
            {
                if (length < 14)
                {
                    return Fail(out error, UiFontErrorCode.InvalidKern, cursor, "kern format 0 header is truncated.");
                }

                int count = UiFontFace.ReadU16(data, cursor + 6);
                if (count > MaxPairs || 14 + (count * 6) > length)
                {
                    return Fail(out error, UiFontErrorCode.ResourceLimit, cursor, "kern pair count exceeds the subtable.");
                }

                int firstPair = cursor + 14;
                uint previous = 0;
                for (int pair = 0; pair < count; pair++)
                {
                    uint key = UiFontFace.ReadU32(data, firstPair + (pair * 6));
                    if (pair > 0 && key <= previous)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidKern, firstPair, "kern pairs are not sorted.");
                    }

                    previous = key;
                }

                pairsOffset = firstPair;
                pairCount = count;
                return true;
            }

            cursor += length;
        }

        return true;
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }
}
