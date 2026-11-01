namespace Axrone.Ui.Text;

using System.Numerics;

internal readonly record struct UiGsubLigatureSet(int FirstGlyph, int Start, int Count);

internal readonly record struct UiGsubLigature(int LigatureGlyph, int ComponentCount, int ComponentsOffset);

internal sealed class UiGsubData
{
    private readonly UiGsubLigatureSet[] _sets;
    private readonly UiGsubLigature[] _ligatures;
    private readonly int[] _components;

    public UiGsubData(UiGsubLigatureSet[] sets, UiGsubLigature[] ligatures, int[] components)
    {
        _sets = sets;
        _ligatures = ligatures;
        _components = components;
    }

    public bool IsEmpty => _ligatures.Length == 0;

    public bool TryMatch(int firstGlyph, ReadOnlySpan<int> following, out int ligatureGlyph, out int consumed)
    {
        ligatureGlyph = 0;
        consumed = 0;
        int low = 0;
        int high = _sets.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            UiGsubLigatureSet set = _sets[middle];
            if (set.FirstGlyph < firstGlyph)
            {
                low = middle + 1;
            }
            else if (set.FirstGlyph > firstGlyph)
            {
                high = middle - 1;
            }
            else
            {
                for (int i = 0; i < set.Count; i++)
                {
                    UiGsubLigature ligature = _ligatures[set.Start + i];
                    int componentCount = ligature.ComponentCount - 1;
                    if (componentCount > following.Length)
                    {
                        continue;
                    }

                    bool matches = true;
                    for (int component = 0; component < componentCount; component++)
                    {
                        if (_components[ligature.ComponentsOffset + component] != following[component])
                        {
                            matches = false;
                            break;
                        }
                    }

                    if (matches)
                    {
                        ligatureGlyph = ligature.LigatureGlyph;
                        consumed = ligature.ComponentCount;
                        return true;
                    }
                }

                return false;
            }
        }

        return false;
    }
}

internal readonly record struct UiGposPairSubtable(int Offset, int Format);

internal sealed class UiGposData
{
    private readonly UiGposPairSubtable[] _subtables;

    public UiGposData(UiGposPairSubtable[] subtables) => _subtables = subtables;

    public bool HasPairs => _subtables.Length > 0;

    public int GetKerning(ReadOnlySpan<byte> data, int left, int right)
    {
        int adjustment = 0;
        for (int i = 0; i < _subtables.Length; i++)
        {
            UiGposPairSubtable subtable = _subtables[i];
            int coverage = subtable.Offset + UiFontFace.ReadU16(data, subtable.Offset + 2);
            if (!UiOpenTypeLayout.TryGetCoverageIndex(data, coverage, left, out int index))
            {
                continue;
            }

            adjustment += subtable.Format == 1
                ? ReadPairFormat1(data, subtable.Offset, index, right)
                : ReadPairFormat2(data, subtable.Offset, left, right);
        }

        return adjustment;
    }

    private static int ReadPairFormat1(ReadOnlySpan<byte> data, int subtable, int coverageIndex, int right)
    {
        int valueFormat1 = UiFontFace.ReadU16(data, subtable + 4);
        int valueFormat2 = UiFontFace.ReadU16(data, subtable + 6);
        int pairSetCount = UiFontFace.ReadU16(data, subtable + 8);
        if ((uint)coverageIndex >= (uint)pairSetCount)
        {
            return 0;
        }

        int pairSet = subtable + UiFontFace.ReadU16(data, subtable + 10 + (coverageIndex * 2));
        int count = UiFontFace.ReadU16(data, pairSet);
        int valueSize1 = 2 * BitOperations.PopCount((uint)valueFormat1);
        int valueSize2 = 2 * BitOperations.PopCount((uint)valueFormat2);
        int recordSize = 2 + valueSize1 + valueSize2;
        int low = 0;
        int high = count - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            int record = pairSet + 2 + (middle * recordSize);
            int second = UiFontFace.ReadU16(data, record);
            if (second < right)
            {
                low = middle + 1;
            }
            else if (second > right)
            {
                high = middle - 1;
            }
            else
            {
                return ReadXAdvance(data, record + 2, valueFormat1);
            }
        }

        return 0;
    }

    private static int ReadPairFormat2(ReadOnlySpan<byte> data, int subtable, int left, int right)
    {
        int valueFormat1 = UiFontFace.ReadU16(data, subtable + 4);
        int classDef1 = subtable + UiFontFace.ReadU16(data, subtable + 8);
        int classDef2 = subtable + UiFontFace.ReadU16(data, subtable + 10);
        int class1Count = UiFontFace.ReadU16(data, subtable + 12);
        int class2Count = UiFontFace.ReadU16(data, subtable + 14);
        if (!UiOpenTypeLayout.TryGetClass(data, classDef1, left, out int class1) ||
            !UiOpenTypeLayout.TryGetClass(data, classDef2, right, out int class2))
        {
            return 0;
        }

        if ((uint)class1 >= (uint)class1Count || (uint)class2 >= (uint)class2Count)
        {
            return 0;
        }

        int valueSize = 2 * BitOperations.PopCount((uint)valueFormat1);
        int record = subtable + 16 + (((class1 * class2Count) + class2) * valueSize);
        return ReadXAdvance(data, record, valueFormat1);
    }

    private static int ReadXAdvance(ReadOnlySpan<byte> data, int valueRecord, int valueFormat)
    {
        if ((valueFormat & 0x0004) == 0)
        {
            return 0;
        }

        int offset = valueRecord + (2 * BitOperations.PopCount((uint)(valueFormat & 0x0003)));
        return UiFontFace.ReadI16(data, offset);
    }
}

internal static class UiOpenTypeLayout
{
    public static bool TryGetCoverageIndex(ReadOnlySpan<byte> data, int coverage, int glyph, out int index)
    {
        index = 0;
        int format = UiFontFace.ReadU16(data, coverage);
        if (format == 1)
        {
            int count = UiFontFace.ReadU16(data, coverage + 2);
            int low = 0;
            int high = count - 1;
            while (low <= high)
            {
                int middle = low + ((high - low) >> 1);
                int candidate = UiFontFace.ReadU16(data, coverage + 4 + (middle * 2));
                if (candidate < glyph)
                {
                    low = middle + 1;
                }
                else if (candidate > glyph)
                {
                    high = middle - 1;
                }
                else
                {
                    index = middle;
                    return true;
                }
            }

            return false;
        }

        if (format != 2)
        {
            return false;
        }

        int rangeCount = UiFontFace.ReadU16(data, coverage + 2);
        int ranges = coverage + 4;
        for (int i = 0; i < rangeCount; i++)
        {
            int range = ranges + (i * 6);
            int start = UiFontFace.ReadU16(data, range);
            int end = UiFontFace.ReadU16(data, range + 2);
            if (glyph < start || glyph > end)
            {
                continue;
            }

            index = UiFontFace.ReadU16(data, range + 4) + (glyph - start);
            return true;
        }

        return false;
    }

    public static bool TryGetCoverageGlyph(ReadOnlySpan<byte> data, int coverage, int index, out int glyph)
    {
        glyph = 0;
        int format = UiFontFace.ReadU16(data, coverage);
        if (format == 1)
        {
            int count = UiFontFace.ReadU16(data, coverage + 2);
            if ((uint)index >= (uint)count)
            {
                return false;
            }

            glyph = UiFontFace.ReadU16(data, coverage + 4 + (index * 2));
            return true;
        }

        if (format != 2)
        {
            return false;
        }

        int rangeCount = UiFontFace.ReadU16(data, coverage + 2);
        int ranges = coverage + 4;
        for (int i = 0; i < rangeCount; i++)
        {
            int range = ranges + (i * 6);
            int start = UiFontFace.ReadU16(data, range);
            int end = UiFontFace.ReadU16(data, range + 2);
            int startIndex = UiFontFace.ReadU16(data, range + 4);
            int length = end - start + 1;
            if (index >= startIndex && index < startIndex + length)
            {
                glyph = start + (index - startIndex);
                return true;
            }
        }

        return false;
    }

    public static bool TryGetClass(ReadOnlySpan<byte> data, int classDef, int glyph, out int glyphClass)
    {
        glyphClass = 0;
        int format = UiFontFace.ReadU16(data, classDef);
        if (format == 1)
        {
            int start = UiFontFace.ReadU16(data, classDef + 2);
            int count = UiFontFace.ReadU16(data, classDef + 4);
            if (glyph < start || glyph >= start + count)
            {
                return false;
            }

            glyphClass = UiFontFace.ReadU16(data, classDef + 6 + ((glyph - start) * 2));
            return true;
        }

        if (format != 2)
        {
            return false;
        }

        int rangeCount = UiFontFace.ReadU16(data, classDef + 2);
        for (int i = 0; i < rangeCount; i++)
        {
            int range = classDef + 4 + (i * 6);
            int start = UiFontFace.ReadU16(data, range);
            int end = UiFontFace.ReadU16(data, range + 2);
            if (glyph >= start && glyph <= end)
            {
                glyphClass = UiFontFace.ReadU16(data, range + 4);
                return true;
            }
        }

        return false;
    }

    public static bool TryValidateCoverage(ReadOnlySpan<byte> data, int coverage, int limit)
    {
        if (coverage < 0 || coverage + 4 > limit)
        {
            return false;
        }

        int format = UiFontFace.ReadU16(data, coverage);
        if (format == 1)
        {
            int count = UiFontFace.ReadU16(data, coverage + 2);
            return (long)coverage + 4 + (count * 2L) <= limit;
        }

        if (format != 2)
        {
            return false;
        }

        int rangeCount = UiFontFace.ReadU16(data, coverage + 2);
        return (long)coverage + 4 + (rangeCount * 6L) <= limit;
    }

    public static bool TryValidateClassDef(ReadOnlySpan<byte> data, int classDef, int limit)
    {
        if (classDef < 0 || classDef + 6 > limit)
        {
            return false;
        }

        int format = UiFontFace.ReadU16(data, classDef);
        if (format == 1)
        {
            int count = UiFontFace.ReadU16(data, classDef + 4);
            return (long)classDef + 6 + (count * 2L) <= limit;
        }

        if (format != 2)
        {
            return false;
        }

        int rangeCount = UiFontFace.ReadU16(data, classDef + 2);
        return (long)classDef + 4 + (rangeCount * 6L) <= limit;
    }
}

internal static class UiOpenTypeLayoutParser
{
    private const int MaxLookups = 4096;
    private const int MaxLigatures = 65_536;
    private const int MaxComponents = 32;

    public static bool TryParseGsub(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        int glyphCount,
        out UiGsubData? gsub,
        out UiFontError error)
    {
        gsub = null;
        error = UiFontError.None;
        if (!TryGetLookupList(data, offset, length, out int lookupList, out int end, out error))
        {
            return false;
        }

        var collected = new List<(int First, int Ligature, int[] Components)>();
        if (!TryCollectLookups(
                data,
                lookupList,
                end,
                glyphCount,
                isGsub: true,
                collected,
                out error))
        {
            return false;
        }

        collected.Sort(static (left, right) =>
        {
            int order = left.First.CompareTo(right.First);
            if (order != 0)
            {
                return order;
            }

            order = right.Components.Length.CompareTo(left.Components.Length);
            return order != 0 ? order : left.Ligature.CompareTo(right.Ligature);
        });

        var ligatures = new UiGsubLigature[collected.Count];
        var componentPool = new List<int>(collected.Count * 2);
        var sets = new List<UiGsubLigatureSet>();
        int cursor = 0;
        while (cursor < collected.Count)
        {
            int first = collected[cursor].First;
            int start = cursor;
            while (cursor < collected.Count && collected[cursor].First == first)
            {
                (int _, int ligature, int[] components) = collected[cursor];
                ligatures[cursor] = new UiGsubLigature(ligature, components.Length + 1, componentPool.Count);
                componentPool.AddRange(components);
                cursor++;
            }

            sets.Add(new UiGsubLigatureSet(first, start, cursor - start));
        }

        gsub = new UiGsubData([.. sets], ligatures, [.. componentPool]);
        return true;
    }

    public static bool TryParseGpos(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        int glyphCount,
        out UiGposData? gpos,
        out UiFontError error)
    {
        gpos = null;
        error = UiFontError.None;
        if (!TryGetLookupList(data, offset, length, out int lookupList, out int end, out error))
        {
            return false;
        }

        var subtables = new List<UiGposPairSubtable>();
        if (!TryCollectLookups(
                data,
                lookupList,
                end,
                glyphCount,
                isGsub: false,
                collected: null,
                pairSubtables: subtables,
                out error))
        {
            return false;
        }

        gpos = new UiGposData([.. subtables]);
        return true;
    }

    private static bool TryGetLookupList(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        out int lookupList,
        out int end,
        out UiFontError error)
    {
        lookupList = 0;
        end = 0;
        error = UiFontError.None;
        if (offset < 0 || length < 10 || (long)offset + length > data.Length)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, offset, "OpenType layout table range is invalid.");
        }

        end = offset + length;
        int major = UiFontFace.ReadU16(data, offset);
        if (major != 1)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, offset, "OpenType layout version is not supported.");
        }

        int lookupListOffset = UiFontFace.ReadU16(data, offset + 8);
        if (lookupListOffset <= 0 || (long)offset + lookupListOffset + 2 > end)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, offset + 8, "OpenType lookup list offset is invalid.");
        }

        lookupList = offset + lookupListOffset;
        return true;
    }

    private static bool TryCollectLookups(
        ReadOnlySpan<byte> data,
        int lookupList,
        int end,
        int glyphCount,
        bool isGsub,
        List<(int First, int Ligature, int[] Components)>? collected,
        out UiFontError error) => TryCollectLookups(data, lookupList, end, glyphCount, isGsub, collected, null, out error);

    private static bool TryCollectLookups(
        ReadOnlySpan<byte> data,
        int lookupList,
        int end,
        int glyphCount,
        bool isGsub,
        List<(int First, int Ligature, int[] Components)>? collected,
        List<UiGposPairSubtable>? pairSubtables,
        out UiFontError error)
    {
        error = UiFontError.None;
        int lookupCount = UiFontFace.ReadU16(data, lookupList);
        if (lookupCount > MaxLookups || (long)lookupList + 2 + (lookupCount * 2L) > end)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, lookupList, "OpenType lookup count is invalid.");
        }

        for (int i = 0; i < lookupCount; i++)
        {
            int lookup = lookupList + UiFontFace.ReadU16(data, lookupList + 2 + (i * 2));
            if (lookup + 6 > end)
            {
                return Fail(out error, UiFontErrorCode.InvalidLayout, lookup, "OpenType lookup is truncated.");
            }

            int type = UiFontFace.ReadU16(data, lookup);
            int subtableCount = UiFontFace.ReadU16(data, lookup + 4);
            if ((long)lookup + 6 + (subtableCount * 2L) > end)
            {
                return Fail(out error, UiFontErrorCode.InvalidLayout, lookup, "OpenType lookup subtables are truncated.");
            }

            for (int s = 0; s < subtableCount; s++)
            {
                int subtable = lookup + UiFontFace.ReadU16(data, lookup + 6 + (s * 2));
                int effectiveType = type;
                if (isGsub && type == 7)
                {
                    effectiveType = ReadExtensionType(data, subtable, end, out int extensionSubtable, out error);
                    if (error.HasError)
                    {
                        return false;
                    }

                    subtable = extensionSubtable;
                }
                else if (!isGsub && type == 9)
                {
                    effectiveType = ReadExtensionType(data, subtable, end, out int extensionSubtable, out error);
                    if (error.HasError)
                    {
                        return false;
                    }

                    subtable = extensionSubtable;
                }

                if (isGsub && effectiveType == 4)
                {
                    if (!TryParseLigatureSubtable(data, subtable, end, glyphCount, collected!, out error))
                    {
                        return false;
                    }
                }
                else if (!isGsub && effectiveType == 2)
                {
                    if (!TryParsePairSubtable(data, subtable, end, glyphCount, out int format, out error))
                    {
                        return false;
                    }

                    pairSubtables!.Add(new UiGposPairSubtable(subtable, format));
                }
            }
        }

        return true;
    }

    private static int ReadExtensionType(ReadOnlySpan<byte> data, int subtable, int end, out int extensionSubtable, out UiFontError error)
    {
        error = UiFontError.None;
        extensionSubtable = 0;
        if (subtable + 8 > end)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidLayout, subtable, "OpenType extension subtable is truncated.");
            return 0;
        }

        int type = UiFontFace.ReadU16(data, subtable);
        uint offset = UiFontFace.ReadU32(data, subtable + 2);
        if ((long)subtable + offset + 2 > end)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidLayout, subtable, "OpenType extension offset is invalid.");
            return 0;
        }

        extensionSubtable = subtable + (int)offset;
        return type;
    }

    private static bool TryParseLigatureSubtable(
        ReadOnlySpan<byte> data,
        int subtable,
        int end,
        int glyphCount,
        List<(int First, int Ligature, int[] Components)> collected,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (subtable + 6 > end || UiFontFace.ReadU16(data, subtable) != 1)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, subtable, "OpenType ligature subtable is invalid.");
        }

        int coverage = subtable + UiFontFace.ReadU16(data, subtable + 2);
        int setCount = UiFontFace.ReadU16(data, subtable + 4);
        if (!UiOpenTypeLayout.TryValidateCoverage(data, coverage, end))
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, coverage, "OpenType ligature coverage is invalid.");
        }

        if (collected.Count + setCount > MaxLigatures || (long)subtable + 6 + (setCount * 2L) > end)
        {
            return Fail(out error, UiFontErrorCode.ResourceLimit, subtable, "OpenType ligature set count exceeds the limit.");
        }

        for (int i = 0; i < setCount; i++)
        {
            if (!UiOpenTypeLayout.TryGetCoverageGlyph(data, coverage, i, out int firstGlyph))
            {
                return Fail(out error, UiFontErrorCode.InvalidLayout, coverage, "OpenType ligature coverage index is invalid.");
            }

            int ligatureSet = subtable + UiFontFace.ReadU16(data, subtable + 6 + (i * 2));
            if (ligatureSet + 2 > end)
            {
                return Fail(out error, UiFontErrorCode.InvalidLayout, ligatureSet, "OpenType ligature set is truncated.");
            }

            int ligatureCount = UiFontFace.ReadU16(data, ligatureSet);
            if ((long)ligatureSet + 2 + (ligatureCount * 2L) > end)
            {
                return Fail(out error, UiFontErrorCode.InvalidLayout, ligatureSet, "OpenType ligature offsets are truncated.");
            }

            for (int l = 0; l < ligatureCount; l++)
            {
                int ligature = ligatureSet + UiFontFace.ReadU16(data, ligatureSet + 2 + (l * 2));
                if (ligature + 4 > end)
                {
                    return Fail(out error, UiFontErrorCode.InvalidLayout, ligature, "OpenType ligature is truncated.");
                }

                int ligatureGlyph = UiFontFace.ReadU16(data, ligature);
                int componentCount = UiFontFace.ReadU16(data, ligature + 2);
                if (componentCount < 1 || componentCount > MaxComponents ||
                    (long)ligature + 4 + ((componentCount - 1) * 2L) > end ||
                    ligatureGlyph >= glyphCount)
                {
                    return Fail(out error, UiFontErrorCode.InvalidLayout, ligature, "OpenType ligature components are invalid.");
                }

                var components = new int[componentCount - 1];
                for (int c = 0; c < components.Length; c++)
                {
                    int component = UiFontFace.ReadU16(data, ligature + 4 + (c * 2));
                    if (component >= glyphCount)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidLayout, ligature, "OpenType ligature component glyph is invalid.");
                    }

                    components[c] = component;
                }

                collected.Add((firstGlyph, ligatureGlyph, components));
            }
        }

        return true;
    }

    private static bool TryParsePairSubtable(
        ReadOnlySpan<byte> data,
        int subtable,
        int end,
        int glyphCount,
        out int format,
        out UiFontError error)
    {
        format = 0;
        error = UiFontError.None;
        if (subtable + 10 > end)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, subtable, "OpenType pair subtable is truncated.");
        }

        format = UiFontFace.ReadU16(data, subtable);
        int coverage = subtable + UiFontFace.ReadU16(data, subtable + 2);
        int valueFormat1 = UiFontFace.ReadU16(data, subtable + 4);
        int valueFormat2 = UiFontFace.ReadU16(data, subtable + 6);
        if (!UiOpenTypeLayout.TryValidateCoverage(data, coverage, end))
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, coverage, "OpenType pair coverage is invalid.");
        }

        if (format == 1)
        {
            int pairSetCount = UiFontFace.ReadU16(data, subtable + 8);
            if ((long)subtable + 10 + (pairSetCount * 2L) > end)
            {
                return Fail(out error, UiFontErrorCode.InvalidLayout, subtable, "OpenType pair sets are truncated.");
            }

            int valueSize1 = 2 * BitOperations.PopCount((uint)valueFormat1);
            int valueSize2 = 2 * BitOperations.PopCount((uint)valueFormat2);
            int recordSize = 2 + valueSize1 + valueSize2;
            for (int i = 0; i < pairSetCount; i++)
            {
                int pairSet = subtable + UiFontFace.ReadU16(data, subtable + 10 + (i * 2));
                if (pairSet + 2 > end)
                {
                    return Fail(out error, UiFontErrorCode.InvalidLayout, pairSet, "OpenType pair set is truncated.");
                }

                int count = UiFontFace.ReadU16(data, pairSet);
                if ((long)pairSet + 2 + (count * (long)recordSize) > end)
                {
                    return Fail(out error, UiFontErrorCode.InvalidLayout, pairSet, "OpenType pair records are truncated.");
                }

                int previous = -1;
                for (int p = 0; p < count; p++)
                {
                    int second = UiFontFace.ReadU16(data, pairSet + 2 + (p * recordSize));
                    if (second <= previous || second >= glyphCount)
                    {
                        return Fail(out error, UiFontErrorCode.InvalidLayout, pairSet, "OpenType pair records are not sorted.");
                    }

                    previous = second;
                }
            }

            return true;
        }

        if (format != 2)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, subtable, "OpenType pair format is not supported.");
        }

        if (subtable + 16 > end)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, subtable, "OpenType pair format 2 is truncated.");
        }

        int classDef1 = subtable + UiFontFace.ReadU16(data, subtable + 8);
        int classDef2 = subtable + UiFontFace.ReadU16(data, subtable + 10);
        int class1Count = UiFontFace.ReadU16(data, subtable + 12);
        int class2Count = UiFontFace.ReadU16(data, subtable + 14);
        if (!UiOpenTypeLayout.TryValidateClassDef(data, classDef1, end) ||
            !UiOpenTypeLayout.TryValidateClassDef(data, classDef2, end))
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, subtable, "OpenType class definitions are invalid.");
        }

        int recordSize2 = 2 * BitOperations.PopCount((uint)valueFormat1);
        long recordsEnd = (long)subtable + 16 + ((long)class1Count * class2Count * recordSize2);
        if (recordsEnd > end)
        {
            return Fail(out error, UiFontErrorCode.InvalidLayout, subtable, "OpenType class records are truncated.");
        }

        return true;
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }
}
