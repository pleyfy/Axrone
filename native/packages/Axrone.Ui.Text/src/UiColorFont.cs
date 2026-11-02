namespace Axrone.Ui.Text;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiColorLayer(int GlyphId, int PaletteIndex);

internal sealed class UiColorData
{
    private const int ForegroundPalette = 0xFFFF;
    private const int BaseRecordSize = 6;
    private const int LayerRecordSize = 4;
    private const int ColorRecordSize = 4;

    private readonly int _colrOffset;
    private readonly int _colrLength;
    private readonly int _baseOffset;
    private readonly int _baseCount;
    private readonly int _layerOffset;
    private readonly int _layerCount;
    private readonly int _cpalOffset;
    private readonly int _paletteEntries;
    private readonly int _paletteCount;
    private readonly int _paletteIndicesOffset;
    private readonly int _colorRecordsOffset;
    private readonly int _colorRecordCount;
    private readonly UiColorPaintData? _paintGraph;

    private UiColorData(
        int colrOffset,
        int colrLength,
        int baseOffset,
        int baseCount,
        int layerOffset,
        int layerCount,
        int cpalOffset,
        int paletteEntries,
        int paletteCount,
        int paletteIndicesOffset,
        int colorRecordsOffset,
        int colorRecordCount,
        UiColorPaintData? paintGraph)
    {
        _colrOffset = colrOffset;
        _colrLength = colrLength;
        _baseOffset = baseOffset;
        _baseCount = baseCount;
        _layerOffset = layerOffset;
        _layerCount = layerCount;
        _cpalOffset = cpalOffset;
        _paletteEntries = paletteEntries;
        _paletteCount = paletteCount;
        _paletteIndicesOffset = paletteIndicesOffset;
        _colorRecordsOffset = colorRecordsOffset;
        _colorRecordCount = colorRecordCount;
        _paintGraph = paintGraph;
    }

    public int PaletteCount => _paletteCount;

    public int PaletteEntryCount => _paletteEntries;

    public UiColorPaintData? PaintGraph => _paintGraph;

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int colrOffset,
        int colrLength,
        int cpalOffset,
        int cpalLength,
        out UiColorData? color,
        out UiFontError error)
    {
        color = null;
        error = UiFontError.None;
        if (colrOffset < 0 && cpalOffset < 0)
        {
            return true;
        }

        if (colrOffset < 0 || cpalOffset < 0)
        {
            return Fail(out error, colrOffset < 0 ? cpalOffset : colrOffset, "COLR and CPAL must be present together.");
        }

        if (colrLength < 14 || cpalLength < 12)
        {
            return Fail(out error, colrOffset < cpalOffset ? colrOffset : cpalOffset, "A color table is truncated.");
        }

        int version = UiFontFace.ReadU16(data, colrOffset);
        int baseCount = UiFontFace.ReadU16(data, colrOffset + 2);
        int baseOffset = (int)UiFontFace.ReadU32(data, colrOffset + 4);
        int layerOffset = (int)UiFontFace.ReadU32(data, colrOffset + 8);
        int layerCount = UiFontFace.ReadU16(data, colrOffset + 12);
        if (version > 1)
        {
            return Fail(out error, UiFontErrorCode.InvalidColor, colrOffset, "COLR version is not supported.");
        }

        int baseGlyphListOffset = 0;
        int paintLayerListOffset = 0;
        int clipListOffset = 0;
        int varIndexMapOffset = 0;
        int varStoreOffset = 0;
        if (version == 1)
        {
            if (colrLength < 34)
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, colrOffset, "COLR v1 header is truncated.");
            }

            baseGlyphListOffset = (int)UiFontFace.ReadU32(data, colrOffset + 14);
            paintLayerListOffset = (int)UiFontFace.ReadU32(data, colrOffset + 18);
            clipListOffset = (int)UiFontFace.ReadU32(data, colrOffset + 22);
            varIndexMapOffset = (int)UiFontFace.ReadU32(data, colrOffset + 26);
            varStoreOffset = (int)UiFontFace.ReadU32(data, colrOffset + 30);
        }

        long baseEnd = baseOffset + ((long)baseCount * BaseRecordSize);
        long layerEnd = layerOffset + ((long)layerCount * LayerRecordSize);
        if (baseCount > 0 && (baseOffset < 14 || baseEnd > colrLength))
        {
            return Fail(out error, colrOffset + 4, "COLR base glyph records exceed the table.");
        }

        if (layerCount > 0 && (layerOffset < 14 || layerEnd > colrLength))
        {
            return Fail(out error, colrOffset + 8, "COLR layer records exceed the table.");
        }

        int previousGlyph = -1;
        for (int i = 0; i < baseCount; i++)
        {
            int record = colrOffset + baseOffset + (i * BaseRecordSize);
            int glyph = UiFontFace.ReadU16(data, record);
            int firstLayer = UiFontFace.ReadU16(data, record + 2);
            int layerCountForGlyph = UiFontFace.ReadU16(data, record + 4);
            if (glyph <= previousGlyph || firstLayer + layerCountForGlyph > layerCount)
            {
                return Fail(out error, record, "COLR base glyph records are invalid.");
            }

            previousGlyph = glyph;
        }

        int cpalVersion = UiFontFace.ReadU16(data, cpalOffset);
        int paletteEntries = UiFontFace.ReadU16(data, cpalOffset + 2);
        int paletteCount = UiFontFace.ReadU16(data, cpalOffset + 4);
        int colorRecordCount = UiFontFace.ReadU16(data, cpalOffset + 6);
        int colorRecordsOffset = (int)UiFontFace.ReadU32(data, cpalOffset + 8);
        if (cpalVersion > 1)
        {
            return Fail(out error, UiFontErrorCode.InvalidColor, cpalOffset, "CPAL version is not supported.");
        }

        long paletteIndicesEnd = 12L + (paletteCount * 2L);
        long colorRecordsEnd = colorRecordsOffset + ((long)colorRecordCount * ColorRecordSize);
        if (paletteCount > 0 && (paletteEntries == 0 || paletteIndicesEnd > cpalLength))
        {
            return Fail(out error, cpalOffset + 4, "CPAL palette headers exceed the table.");
        }

        if (colorRecordCount > 0 && (colorRecordsOffset < paletteIndicesEnd || colorRecordsEnd > cpalLength))
        {
            return Fail(out error, cpalOffset + 8, "CPAL color records exceed the table.");
        }

        for (int palette = 0; palette < paletteCount; palette++)
        {
            int firstRecord = UiFontFace.ReadU16(data, cpalOffset + 12 + (palette * 2));
            if (firstRecord + paletteEntries > colorRecordCount)
            {
                return Fail(out error, cpalOffset + 12 + (palette * 2), "CPAL palette index exceeds the color records.");
            }
        }

        UiColorPaintData? paintGraph = null;
        if (version == 1 &&
            (baseGlyphListOffset != 0 || paintLayerListOffset != 0 || clipListOffset != 0 ||
             varIndexMapOffset != 0 || varStoreOffset != 0))
        {
            if (!UiColorPaintData.TryParse(
                    data,
                    colrOffset,
                    colrLength,
                    baseGlyphListOffset,
                    paintLayerListOffset,
                    clipListOffset,
                    varIndexMapOffset,
                    varStoreOffset,
                    paletteCount,
                    out paintGraph,
                    out error))
            {
                return false;
            }
        }

        color = new UiColorData(
            colrOffset,
            colrLength,
            baseOffset,
            baseCount,
            layerOffset,
            layerCount,
            cpalOffset,
            paletteEntries,
            paletteCount,
            paletteIndicesOffset: 12,
            colorRecordsOffset,
            colorRecordCount,
            paintGraph);
        return true;
    }

    public int GetLayers(ReadOnlySpan<byte> data, int glyphId, Span<UiColorLayer> destination)
    {
        ReadOnlySpan<byte> table = data.Slice(_colrOffset, _colrLength);
        int low = 0;
        int high = _baseCount - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            int record = _baseOffset + (middle * BaseRecordSize);
            int glyph = UiFontFace.ReadU16(table, record);
            if (glyph < glyphId)
            {
                low = middle + 1;
            }
            else if (glyph > glyphId)
            {
                high = middle - 1;
            }
            else
            {
                int firstLayer = UiFontFace.ReadU16(table, record + 2);
                int count = UiFontFace.ReadU16(table, record + 4);
                int written = Math.Min(count, destination.Length);
                for (int i = 0; i < written; i++)
                {
                    int layerRecord = _layerOffset + ((firstLayer + i) * LayerRecordSize);
                    int layerGlyph = UiFontFace.ReadU16(table, layerRecord);
                    int paletteIndex = UiFontFace.ReadU16(table, layerRecord + 2);
                    destination[i] = new UiColorLayer(
                        layerGlyph,
                        paletteIndex == ForegroundPalette ? -1 : paletteIndex);
                }

                return count;
            }
        }

        return 0;
    }

    public bool TryGetPaletteColor(
        ReadOnlySpan<byte> data,
        int paletteIndex,
        int colorIndex,
        out uint color)
    {
        color = 0;
        if (paletteIndex < 0 || paletteIndex >= _paletteCount ||
            colorIndex < 0 || colorIndex >= _paletteEntries)
        {
            return false;
        }

        ReadOnlySpan<byte> table = data.Slice(_cpalOffset);
        int firstRecord = UiFontFace.ReadU16(table, _paletteIndicesOffset + (paletteIndex * 2));
        int absoluteRecord = firstRecord + colorIndex;
        if (absoluteRecord >= _colorRecordCount)
        {
            return false;
        }

        int record = _colorRecordsOffset + (absoluteRecord * ColorRecordSize);
        int blue = table[record];
        int green = table[record + 1];
        int red = table[record + 2];
        int alpha = table[record + 3];
        color = ((uint)alpha << 24) | ((uint)red << 16) | ((uint)green << 8) | (uint)blue;
        return true;
    }

    private static bool Fail(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidColor, offset, message);
        return false;
    }

    private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
    {
        error = UiFontError.At(code, offset, message);
        return false;
    }
}
