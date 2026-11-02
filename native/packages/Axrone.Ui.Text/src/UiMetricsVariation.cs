namespace Axrone.Ui.Text;

internal sealed class UiItemVariationStore
{
    private const int HeaderSize = 8;

    private readonly int _offset;
    private readonly int _axisCount;
    private readonly int _regionListOffset;
    private readonly int _regionCount;
    private readonly int _itemDataCount;
    private readonly int _itemDataOffsetsOffset;

    private UiItemVariationStore(
        int offset,
        int axisCount,
        int regionListOffset,
        int regionCount,
        int itemDataCount,
        int itemDataOffsetsOffset)
    {
        _offset = offset;
        _axisCount = axisCount;
        _regionListOffset = regionListOffset;
        _regionCount = regionCount;
        _itemDataCount = itemDataCount;
        _itemDataOffsetsOffset = itemDataOffsetsOffset;
    }

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        int axisCount,
        out UiItemVariationStore? store,
        out UiFontError error)
    {
        store = null;
        error = UiFontError.None;
        if (offset < 0 || length < HeaderSize)
        {
            return Fail(out error, offset, "Item variation store is truncated.");
        }

        if (UiFontFace.ReadU16(data, offset) != 1)
        {
            return Fail(out error, offset, "Item variation store format is not supported.");
        }

        int regionListOffset = (int)UiFontFace.ReadU32(data, offset + 2);
        int itemDataCount = UiFontFace.ReadU16(data, offset + 6);
        long offsetsEnd = HeaderSize + ((long)itemDataCount * 4);
        if (offsetsEnd > length)
        {
            return Fail(out error, offset + 6, "Item variation data offsets exceed the store.");
        }

        if (regionListOffset < HeaderSize || regionListOffset + 4L > length)
        {
            return Fail(out error, offset + 2, "Variation region list offset is invalid.");
        }

        int regionAxisCount = UiFontFace.ReadU16(data, offset + regionListOffset);
        int regionCount = UiFontFace.ReadU16(data, offset + regionListOffset + 2);
        if (regionAxisCount != axisCount)
        {
            return Fail(out error, offset + regionListOffset, "Variation region axis count does not match fvar.");
        }

        long regionEnd = regionListOffset + 4L + ((long)regionCount * axisCount * 6);
        if (regionEnd > length)
        {
            return Fail(out error, offset + regionListOffset, "Variation regions exceed the store.");
        }

        for (int item = 0; item < itemDataCount; item++)
        {
            int relative = (int)UiFontFace.ReadU32(data, offset + HeaderSize + (item * 4));
            if (relative < HeaderSize || relative + 6L > length)
            {
                return Fail(out error, offset + HeaderSize + (item * 4), "Item variation data offset is invalid.");
            }

            int itemOffset = offset + relative;
            int itemCount = UiFontFace.ReadU16(data, itemOffset);
            int wordFlags = UiFontFace.ReadU16(data, itemOffset + 2);
            int regionIndexCount = UiFontFace.ReadU16(data, itemOffset + 4);
            long regionIndexesEnd = relative + 6L + ((long)regionIndexCount * 2);
            if (regionIndexesEnd > length)
            {
                return Fail(out error, itemOffset + 4, "Item variation region indexes exceed the store.");
            }

            for (int index = 0; index < regionIndexCount; index++)
            {
                int regionIndex = UiFontFace.ReadU16(data, itemOffset + 6 + (index * 2));
                if (regionIndex >= regionCount)
                {
                    return Fail(out error, itemOffset + 6 + (index * 2), "Item variation region index is outside the region list.");
                }
            }

            bool longWords = (wordFlags & 0x8000) != 0;
            int wordCount = wordFlags & 0x7FFF;
            if (wordCount > regionIndexCount)
            {
                return Fail(out error, itemOffset + 2, "Item variation word delta count is invalid.");
            }

            long rowBytes = (wordCount * (longWords ? 4L : 2L)) +
                ((regionIndexCount - wordCount) * (longWords ? 2L : 1L));
            long deltaEnd = regionIndexesEnd + (itemCount * rowBytes);
            if (deltaEnd > length)
            {
                return Fail(out error, itemOffset, "Item variation deltas exceed the store.");
            }
        }

        store = new UiItemVariationStore(
            offset,
            axisCount,
            regionListOffset,
            regionCount,
            itemDataCount,
            itemDataOffsetsOffset: HeaderSize);
        return true;
    }

    public bool IsValidIndex(ReadOnlySpan<byte> data, int outer, int inner)
    {
        if ((uint)outer >= (uint)_itemDataCount)
        {
            return false;
        }

        int itemOffset = _offset + (int)UiFontFace.ReadU32(data, _offset + _itemDataOffsetsOffset + (outer * 4));
        int itemCount = UiFontFace.ReadU16(data, itemOffset);
        return (uint)inner < (uint)itemCount;
    }

    public bool TryGetDelta(
        ReadOnlySpan<byte> data,
        int outer,
        int inner,
        ReadOnlySpan<float> coordinates,
        out float delta,
        out UiFontError error)
    {
        delta = 0.0f;
        error = UiFontError.None;
        if ((uint)outer >= (uint)_itemDataCount)
        {
            return Fail(out error, _offset, "Item variation outer index is outside the store.");
        }

        int itemOffset = _offset + (int)UiFontFace.ReadU32(data, _offset + _itemDataOffsetsOffset + (outer * 4));
        int itemCount = UiFontFace.ReadU16(data, itemOffset);
        if ((uint)inner >= (uint)itemCount)
        {
            return Fail(out error, itemOffset, "Item variation inner index is outside the data.");
        }

        int wordFlags = UiFontFace.ReadU16(data, itemOffset + 2);
        int regionIndexCount = UiFontFace.ReadU16(data, itemOffset + 4);
        bool longWords = (wordFlags & 0x8000) != 0;
        int wordCount = wordFlags & 0x7FFF;
        long rowBytes = (wordCount * (longWords ? 4L : 2L)) +
            ((regionIndexCount - wordCount) * (longWords ? 2L : 1L));
        int row = itemOffset + 6 + (regionIndexCount * 2) + (int)(inner * rowBytes);
        for (int index = 0; index < regionIndexCount; index++)
        {
            int regionIndex = UiFontFace.ReadU16(data, itemOffset + 6 + (index * 2));
            float scalar = ComputeRegionScalar(data, regionIndex, coordinates);
            int raw;
            if (index < wordCount)
            {
                raw = longWords
                    ? UiFontFace.ReadI32(data, row)
                    : UiFontFace.ReadI16(data, row);
                row += longWords ? 4 : 2;
            }
            else
            {
                raw = longWords ? UiFontFace.ReadI16(data, row) : (sbyte)data[row];
                row += longWords ? 2 : 1;
            }

            delta += scalar * raw;
        }

        return true;
    }

    private float ComputeRegionScalar(ReadOnlySpan<byte> data, int regionIndex, ReadOnlySpan<float> coordinates)
    {
        int region = _offset + _regionListOffset + 4 + (regionIndex * _axisCount * 6);
        float scalar = 1.0f;
        for (int axis = 0; axis < _axisCount; axis++)
        {
            float start = F2Dot14(UiFontFace.ReadI16(data, region));
            float peak = F2Dot14(UiFontFace.ReadI16(data, region + 2));
            float end = F2Dot14(UiFontFace.ReadI16(data, region + 4));
            region += 6;
            float coordinate = axis < coordinates.Length ? coordinates[axis] : 0.0f;
            if (!UiVariationMath.TryAxisFactor(coordinate, start, peak, end, out float factor))
            {
                return 0.0f;
            }

            scalar *= factor;
        }

        return scalar;
    }

    private static bool Fail(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidVariation, offset, message);
        return false;
    }

    private static float F2Dot14(short value) => value / 16384.0f;
}

internal sealed class UiDeltaSetIndexMap
{
    private readonly int _offset;
    private readonly int _entrySize;
    private readonly int _innerBits;
    private readonly int _count;

    private UiDeltaSetIndexMap(int offset, int entrySize, int innerBits, int count)
    {
        _offset = offset;
        _entrySize = entrySize;
        _innerBits = innerBits;
        _count = count;
    }

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        out UiDeltaSetIndexMap? map,
        out UiFontError error)
    {
        map = null;
        error = UiFontError.None;
        if (offset < 0 || length < 4)
        {
            return Fail(out error, offset, "Delta set index map is truncated.");
        }

        int format = data[offset];
        if (format > 1)
        {
            return Fail(out error, offset, "Delta set index map format is not supported.");
        }

        int entryFormat = data[offset + 1];
        if ((entryFormat & 0xC0) != 0)
        {
            return Fail(out error, offset + 1, "Delta set index map entry format is invalid.");
        }

        int entrySize = ((entryFormat >> 4) & 0x03) + 1;
        int innerBits = (entryFormat & 0x0F) + 1;
        int headerSize = format == 0 ? 4 : 6;
        uint declaredCount = format == 0
            ? UiFontFace.ReadU16(data, offset + 2)
            : UiFontFace.ReadU32(data, offset + 2);
        if (declaredCount > int.MaxValue ||
            headerSize + ((long)declaredCount * entrySize) > length)
        {
            return Fail(out error, offset, "Delta set index map entries exceed the table.");
        }

        int count = (int)declaredCount;
        map = new UiDeltaSetIndexMap(offset, entrySize, innerBits, count);
        return true;
    }

    public bool TryLookup(ReadOnlySpan<byte> data, int index, out int outer, out int inner)
    {
        if (_count == 0)
        {
            outer = 0;
            inner = 0;
            return true;
        }

        int entry = index < 0 ? 0 : Math.Min(index, _count - 1);
        int position = _offset + (data[_offset] == 0 ? 4 : 6) + (entry * _entrySize);
        uint value = 0;
        for (int i = 0; i < _entrySize; i++)
        {
            value = (value << 8) | data[position + i];
        }

        uint mask = (1u << _innerBits) - 1u;
        inner = (int)(value & mask);
        outer = (int)(value >> _innerBits);
        return true;
    }

    private static bool Fail(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidVariation, offset, message);
        return false;
    }
}

internal sealed class UiHvarData
{
    private readonly UiItemVariationStore _store;
    private readonly UiDeltaSetIndexMap? _advanceMap;
    private readonly UiDeltaSetIndexMap? _lsbMap;

    private UiHvarData(UiItemVariationStore store, UiDeltaSetIndexMap? advanceMap, UiDeltaSetIndexMap? lsbMap)
    {
        _store = store;
        _advanceMap = advanceMap;
        _lsbMap = lsbMap;
    }

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        int axisCount,
        out UiHvarData? hvar,
        out UiFontError error)
    {
        hvar = null;
        error = UiFontError.None;
        if (offset < 0 || length < 20)
        {
            return Fail(out error, offset, "HVAR table is truncated.");
        }

        if (UiFontFace.ReadU16(data, offset) != 1 || UiFontFace.ReadU16(data, offset + 2) > 1)
        {
            return Fail(out error, offset, "HVAR version is not supported.");
        }

        int storeOffset = (int)UiFontFace.ReadU32(data, offset + 4);
        int advanceMapOffset = (int)UiFontFace.ReadU32(data, offset + 8);
        int lsbMapOffset = (int)UiFontFace.ReadU32(data, offset + 12);
        int rsbMapOffset = (int)UiFontFace.ReadU32(data, offset + 16);
        if (storeOffset < 20 || storeOffset >= length)
        {
            return Fail(out error, offset + 4, "HVAR item variation store offset is invalid.");
        }

        if (!UiItemVariationStore.TryParse(
                data,
                offset + storeOffset,
                length - storeOffset,
                axisCount,
                out UiItemVariationStore? store,
                out error))
        {
            return false;
        }

        if (!TryParseMap(data, offset, length, advanceMapOffset, out UiDeltaSetIndexMap? advanceMap, out error) ||
            !TryParseMap(data, offset, length, lsbMapOffset, out UiDeltaSetIndexMap? lsbMap, out error))
        {
            return false;
        }

        if (rsbMapOffset != 0 && (rsbMapOffset < 20 || rsbMapOffset >= length))
        {
            return Fail(out error, offset + 16, "HVAR right side bearing map offset is invalid.");
        }

        hvar = new UiHvarData(store!, advanceMap, lsbMap);
        return true;
    }

    public int GetAdvanceDelta(ReadOnlySpan<byte> data, int glyphId, ReadOnlySpan<float> coordinates) =>
        GetDelta(data, _advanceMap, glyphId, coordinates);

    public int GetLsbDelta(ReadOnlySpan<byte> data, int glyphId, ReadOnlySpan<float> coordinates) =>
        GetDelta(data, _lsbMap, glyphId, coordinates);

    private int GetDelta(
        ReadOnlySpan<byte> data,
        UiDeltaSetIndexMap? map,
        int glyphId,
        ReadOnlySpan<float> coordinates)
    {
        int outer;
        int inner;
        if (map is null)
        {
            outer = glyphId;
            inner = 0;
        }
        else if (!map.TryLookup(data, glyphId, out outer, out inner))
        {
            return 0;
        }

        return _store.TryGetDelta(data, outer, inner, coordinates, out float delta, out _)
            ? (int)MathF.Round(delta, MidpointRounding.AwayFromZero)
            : 0;
    }

    private static bool TryParseMap(
        ReadOnlySpan<byte> data,
        int tableOffset,
        int tableLength,
        int mapOffset,
        out UiDeltaSetIndexMap? map,
        out UiFontError error)
    {
        map = null;
        error = UiFontError.None;
        if (mapOffset == 0)
        {
            return true;
        }

        if (mapOffset < 20 || mapOffset >= tableLength)
        {
            return Fail(out error, tableOffset + tableLength, "HVAR delta set index map offset is invalid.");
        }

        return UiDeltaSetIndexMap.TryParse(data, tableOffset + mapOffset, tableLength - mapOffset, out map, out error);
    }

    private static bool Fail(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidVariation, offset, message);
        return false;
    }
}

internal sealed class UiMvarData
{
    private const uint TagAscender = 0x68617363;
    private const uint TagDescender = 0x68647363;
    private const uint TagLineGap = 0x686C6770;

    private readonly UiItemVariationStore _store;
    private readonly int _ascenderOuter;
    private readonly int _ascenderInner;
    private readonly int _descenderOuter;
    private readonly int _descenderInner;
    private readonly int _lineGapOuter;
    private readonly int _lineGapInner;

    private UiMvarData(
        UiItemVariationStore store,
        int ascenderOuter,
        int ascenderInner,
        int descenderOuter,
        int descenderInner,
        int lineGapOuter,
        int lineGapInner)
    {
        _store = store;
        _ascenderOuter = ascenderOuter;
        _ascenderInner = ascenderInner;
        _descenderOuter = descenderOuter;
        _descenderInner = descenderInner;
        _lineGapOuter = lineGapOuter;
        _lineGapInner = lineGapInner;
    }

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        int axisCount,
        out UiMvarData? mvar,
        out UiFontError error)
    {
        mvar = null;
        error = UiFontError.None;
        if (offset < 0 || length < 14)
        {
            return Fail(out error, offset, "MVAR table is truncated.");
        }

        if (UiFontFace.ReadU16(data, offset) != 1 || UiFontFace.ReadU16(data, offset + 2) > 1)
        {
            return Fail(out error, offset, "MVAR version is not supported.");
        }

        int recordSize = UiFontFace.ReadU16(data, offset + 6);
        int recordCount = UiFontFace.ReadU16(data, offset + 8);
        int storeOffset = (int)UiFontFace.ReadU32(data, offset + 10);
        if (recordSize < 8 || 14L + ((long)recordCount * recordSize) > length)
        {
            return Fail(out error, offset + 6, "MVAR value records exceed the table.");
        }

        if (storeOffset < 14 || storeOffset >= length)
        {
            return Fail(out error, offset + 10, "MVAR item variation store offset is invalid.");
        }

        if (!UiItemVariationStore.TryParse(
                data,
                offset + storeOffset,
                length - storeOffset,
                axisCount,
                out UiItemVariationStore? store,
                out error))
        {
            return false;
        }

        int ascenderOuter = -1;
        int ascenderInner = -1;
        int descenderOuter = -1;
        int descenderInner = -1;
        int lineGapOuter = -1;
        int lineGapInner = -1;
        for (int record = 0; record < recordCount; record++)
        {
            int position = offset + 14 + (record * recordSize);
            uint tag = UiFontFace.ReadU32(data, position);
            int outer = UiFontFace.ReadU16(data, position + 4);
            int inner = UiFontFace.ReadU16(data, position + 6);
            if (tag is not (TagAscender or TagDescender or TagLineGap))
            {
                continue;
            }

            if (!store!.IsValidIndex(data, outer, inner))
            {
                return Fail(out error, position, "MVAR metric variation index is invalid.");
            }

            if (tag == TagAscender)
            {
                ascenderOuter = outer;
                ascenderInner = inner;
            }
            else if (tag == TagDescender)
            {
                descenderOuter = outer;
                descenderInner = inner;
            }
            else
            {
                lineGapOuter = outer;
                lineGapInner = inner;
            }
        }

        mvar = new UiMvarData(
            store!,
            ascenderOuter,
            ascenderInner,
            descenderOuter,
            descenderInner,
            lineGapOuter,
            lineGapInner);
        return true;
    }

    public int GetAscenderDelta(ReadOnlySpan<byte> data, ReadOnlySpan<float> coordinates) =>
        GetDelta(data, _ascenderOuter, _ascenderInner, coordinates);

    public int GetDescenderDelta(ReadOnlySpan<byte> data, ReadOnlySpan<float> coordinates) =>
        GetDelta(data, _descenderOuter, _descenderInner, coordinates);

    public int GetLineGapDelta(ReadOnlySpan<byte> data, ReadOnlySpan<float> coordinates) =>
        GetDelta(data, _lineGapOuter, _lineGapInner, coordinates);

    private int GetDelta(
        ReadOnlySpan<byte> data,
        int outer,
        int inner,
        ReadOnlySpan<float> coordinates)
    {
        if (outer < 0)
        {
            return 0;
        }

        return _store.TryGetDelta(data, outer, inner, coordinates, out float delta, out _)
            ? (int)MathF.Round(delta, MidpointRounding.AwayFromZero)
            : 0;
    }

    private static bool Fail(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidVariation, offset, message);
        return false;
    }
}
