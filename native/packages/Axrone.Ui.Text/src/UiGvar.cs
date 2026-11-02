namespace Axrone.Ui.Text;

internal sealed class UiGvarData
{
    private const int SharedPointFlag = 0x8000;
    private const int TupleCountMask = 0x0FFF;
    private const int EmbeddedPeakTuple = 0x8000;
    private const int IntermediateRegion = 0x4000;
    private const int PrivatePointNumbers = 0x2000;
    private const int TupleIndexMask = 0x0FFF;
    private const int PhantomPointCount = 4;

    private readonly int _tableOffset;
    private readonly int _tableLength;
    private readonly int _axisCount;
    private readonly int _glyphCount;
    private readonly int _sharedTupleCount;
    private readonly int _sharedTuplesOffset;
    private readonly int _glyphDataOffset;
    private readonly int _offsetsOffset;
    private readonly bool _longOffsets;

    private UiGvarData(
        int tableOffset,
        int tableLength,
        int axisCount,
        int glyphCount,
        int sharedTupleCount,
        int sharedTuplesOffset,
        int glyphDataOffset,
        int offsetsOffset,
        bool longOffsets)
    {
        _tableOffset = tableOffset;
        _tableLength = tableLength;
        _axisCount = axisCount;
        _glyphCount = glyphCount;
        _sharedTupleCount = sharedTupleCount;
        _sharedTuplesOffset = sharedTuplesOffset;
        _glyphDataOffset = glyphDataOffset;
        _offsetsOffset = offsetsOffset;
        _longOffsets = longOffsets;
    }

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        int glyphCount,
        int axisCount,
        out UiGvarData? gvar,
        out UiFontError error)
    {
        gvar = null;
        error = UiFontError.None;
        if (offset < 0 || length < 20)
        {
            return Fail(out error, offset, "gvar table is truncated.");
        }

        if (UiFontFace.ReadU16(data, offset) != 1 || UiFontFace.ReadU16(data, offset + 2) != 0)
        {
            return Fail(out error, offset, "gvar version is not supported.");
        }

        int declaredAxisCount = UiFontFace.ReadU16(data, offset + 4);
        int sharedTupleCount = UiFontFace.ReadU16(data, offset + 6);
        int sharedTuplesOffset = (int)UiFontFace.ReadU32(data, offset + 8);
        int declaredGlyphs = UiFontFace.ReadU16(data, offset + 12);
        int flags = UiFontFace.ReadU16(data, offset + 14);
        int glyphDataOffset = (int)UiFontFace.ReadU32(data, offset + 16);
        if (declaredAxisCount != axisCount || declaredGlyphs != glyphCount)
        {
            return Fail(out error, offset, "gvar axis or glyph count does not match the face.");
        }

        if ((flags & 0xFFFE) != 0)
        {
            return Fail(out error, offset + 14, "gvar flags are not supported.");
        }

        bool longOffsets = (flags & 1) != 0;
        int entrySize = longOffsets ? 4 : 2;
        long offsetsEnd = 20L + ((glyphCount + 1L) * entrySize);
        if (offsetsEnd > length)
        {
            return Fail(out error, offset, "gvar offset array exceeds the table.");
        }

        long sharedTuplesEnd = sharedTuplesOffset + ((long)sharedTupleCount * axisCount * 2L);
        if (sharedTuplesOffset < offsetsEnd || sharedTuplesEnd > length)
        {
            return Fail(out error, offset + 8, "gvar shared tuples exceed the table.");
        }

        if (glyphDataOffset < offsetsEnd || glyphDataOffset > length)
        {
            return Fail(out error, offset + 16, "gvar glyph data offset is invalid.");
        }

        int previous = 0;
        int glyphDataLength = length - glyphDataOffset;
        for (int glyph = 0; glyph <= glyphCount; glyph++)
        {
            int record = offset + 20 + (glyph * entrySize);
            int value = longOffsets
                ? (int)UiFontFace.ReadU32(data, record)
                : UiFontFace.ReadU16(data, record);
            if (value < previous || value > glyphDataLength)
            {
                return Fail(out error, record, "gvar glyph offsets are not monotonic.");
            }

            previous = value;
        }

        gvar = new UiGvarData(
            offset,
            length,
            axisCount,
            glyphCount,
            sharedTupleCount,
            sharedTuplesOffset,
            glyphDataOffset,
            offsetsOffset: 20,
            longOffsets);
        return true;
    }

    public bool TryApplyGlyph(
        ReadOnlySpan<byte> data,
        int glyphId,
        ReadOnlySpan<float> coordinates,
        Span<float> deltaX,
        Span<float> deltaY,
        Span<int> points,
        Span<float> scratchX,
        Span<float> scratchY,
        int actualPointCount,
        out UiFontError error)
    {
        error = UiFontError.None;
        if ((uint)glyphId >= (uint)_glyphCount || actualPointCount < 0)
        {
            return Fail(out error, _tableOffset, "The glyph variation request is outside the table.");
        }

        int totalPoints = actualPointCount + PhantomPointCount;
        if (deltaX.Length < actualPointCount ||
            deltaY.Length < actualPointCount ||
            points.Length < totalPoints ||
            scratchX.Length < totalPoints ||
            scratchY.Length < totalPoints)
        {
            return Fail(out error, _tableOffset, "The glyph variation buffers are too small.");
        }

        deltaX[..actualPointCount].Clear();
        deltaY[..actualPointCount].Clear();
        if (actualPointCount == 0)
        {
            return true;
        }

        ReadOnlySpan<byte> table = data.Slice(_tableOffset, _tableLength);
        int glyphStart = ReadOffset(table, glyphId);
        int glyphEnd = ReadOffset(table, glyphId + 1);
        if (glyphStart == glyphEnd)
        {
            return true;
        }

        if (glyphEnd < glyphStart || glyphEnd > table.Length || glyphEnd - glyphStart < 6)
        {
            return Fail(out error, _tableOffset + glyphStart, "The glyph variation data is truncated.");
        }

        int tupleCount = UiFontFace.ReadU16(table, glyphStart) & TupleCountMask;
        bool hasSharedPoints = (UiFontFace.ReadU16(table, glyphStart) & SharedPointFlag) != 0;
        int dataOffset = _longOffsets
            ? (int)UiFontFace.ReadU32(table, glyphStart + 2)
            : UiFontFace.ReadU16(table, glyphStart + 2);
        int dataPosition = glyphStart + dataOffset;
        if (dataPosition < glyphStart + 6 || dataPosition > glyphEnd)
        {
            return Fail(out error, _tableOffset + glyphStart, "The glyph variation data offset is invalid.");
        }

        Span<float> peak = stackalloc float[_axisCount];
        Span<float> start = stackalloc float[_axisCount];
        Span<float> end = stackalloc float[_axisCount];
        int sharedCount = 0;
        bool sharedAll = false;
        if (hasSharedPoints &&
            !TryDecodePoints(table, ref dataPosition, glyphEnd, totalPoints, points, out sharedCount, out sharedAll, out error))
        {
            return false;
        }

        int headerPosition = glyphStart + 2 + (_longOffsets ? 4 : 2);
        for (int tuple = 0; tuple < tupleCount; tuple++)
        {
            if (headerPosition + 4 > glyphEnd)
            {
                return Fail(out error, _tableOffset + headerPosition, "The tuple variation header is truncated.");
            }

            int dataSize = UiFontFace.ReadU16(table, headerPosition);
            int tupleIndex = UiFontFace.ReadU16(table, headerPosition + 2);
            headerPosition += 4;
            if ((tupleIndex & EmbeddedPeakTuple) != 0)
            {
                if (headerPosition + (_axisCount * 2) > glyphEnd)
                {
                    return Fail(out error, _tableOffset + headerPosition, "The embedded peak tuple is truncated.");
                }

                for (int axis = 0; axis < _axisCount; axis++)
                {
                    peak[axis] = F2Dot14(UiFontFace.ReadI16(table, headerPosition));
                    headerPosition += 2;
                }
            }
            else if (!TryReadSharedTuple(table, tupleIndex & TupleIndexMask, peak, out error))
            {
                return false;
            }

            if ((tupleIndex & IntermediateRegion) != 0)
            {
                if (headerPosition + (_axisCount * 4) > glyphEnd)
                {
                    return Fail(out error, _tableOffset + headerPosition, "The intermediate region is truncated.");
                }

                for (int axis = 0; axis < _axisCount; axis++)
                {
                    start[axis] = F2Dot14(UiFontFace.ReadI16(table, headerPosition));
                    end[axis] = F2Dot14(UiFontFace.ReadI16(table, headerPosition + (_axisCount * 2)));
                    headerPosition += 2;
                }

                headerPosition += _axisCount * 2;
            }
            else
            {
                for (int axis = 0; axis < _axisCount; axis++)
                {
                    start[axis] = MathF.Min(peak[axis], 0.0f);
                    end[axis] = MathF.Max(peak[axis], 0.0f);
                }
            }

            int tupleStart = dataPosition;
            int tupleEnd = tupleStart + dataSize;
            if (tupleEnd < tupleStart || tupleEnd > glyphEnd)
            {
                return Fail(out error, _tableOffset + tupleStart, "The tuple variation data exceeds the glyph record.");
            }

            float scalar = ComputeScalar(coordinates, peak, start, end);
            if (scalar != 0.0f)
            {
                int pointPosition = tupleStart;
                int deltaCount;
                bool allPoints;
                if ((tupleIndex & PrivatePointNumbers) != 0)
                {
                    if (!TryDecodePoints(
                            table,
                            ref pointPosition,
                            tupleEnd,
                            totalPoints,
                            points,
                            out deltaCount,
                            out allPoints,
                            out error))
                    {
                        return false;
                    }
                }
                else if (hasSharedPoints)
                {
                    deltaCount = sharedAll ? totalPoints : sharedCount;
                    allPoints = sharedAll;
                }
                else
                {
                    deltaCount = totalPoints;
                    allPoints = true;
                }

                if (deltaCount < 0 || deltaCount > totalPoints)
                {
                    return Fail(out error, _tableOffset + pointPosition, "The tuple point count is invalid.");
                }

                if (!TryDecodeDeltas(table, ref pointPosition, tupleEnd, deltaCount, scratchX, out error) ||
                    !TryDecodeDeltas(table, ref pointPosition, tupleEnd, deltaCount, scratchY, out error))
                {
                    return false;
                }

                for (int i = 0; i < deltaCount; i++)
                {
                    int point = allPoints ? i : points[i];
                    if ((uint)point < (uint)actualPointCount)
                    {
                        deltaX[point] += scalar * scratchX[i];
                        deltaY[point] += scalar * scratchY[i];
                    }
                }
            }

            dataPosition = tupleEnd;
        }

        return true;
    }

    private bool TryReadSharedTuple(ReadOnlySpan<byte> table, int index, Span<float> peak, out UiFontError error)
    {
        error = UiFontError.None;
        if ((uint)index >= (uint)_sharedTupleCount)
        {
            return Fail(out error, _tableOffset + _sharedTuplesOffset, "The shared tuple index is outside the table.");
        }

        int record = _sharedTuplesOffset + (index * _axisCount * 2);
        for (int axis = 0; axis < _axisCount; axis++)
        {
            peak[axis] = F2Dot14(UiFontFace.ReadI16(table, record));
            record += 2;
        }

        return true;
    }

    private int ReadOffset(ReadOnlySpan<byte> table, int glyphId)
    {
        int record = _offsetsOffset + (glyphId * (_longOffsets ? 4 : 2));
        int relative = _longOffsets
            ? (int)UiFontFace.ReadU32(table, record)
            : UiFontFace.ReadU16(table, record);
        return _glyphDataOffset + relative;
    }

    private static float ComputeScalar(
        ReadOnlySpan<float> coordinates,
        ReadOnlySpan<float> peak,
        ReadOnlySpan<float> start,
        ReadOnlySpan<float> end)
    {
        float scalar = 1.0f;
        for (int axis = 0; axis < peak.Length; axis++)
        {
            float peakValue = peak[axis];
            float lower = start[axis];
            float upper = end[axis];
            if (peakValue == 0.0f || lower > peakValue || peakValue > upper || (lower < 0.0f && upper > 0.0f))
            {
                continue;
            }

            float value = axis < coordinates.Length ? coordinates[axis] : 0.0f;
            if (value == peakValue)
            {
                continue;
            }

            if (value <= lower || upper <= value)
            {
                return 0.0f;
            }

            scalar *= value < peakValue
                ? (value - lower) / (peakValue - lower)
                : (value - upper) / (peakValue - upper);
        }

        return scalar;
    }

    private static bool TryDecodePoints(
        ReadOnlySpan<byte> table,
        ref int position,
        int end,
        int totalPoints,
        Span<int> points,
        out int count,
        out bool allPoints,
        out UiFontError error)
    {
        count = 0;
        allPoints = false;
        error = UiFontError.None;
        if (position >= end)
        {
            return Fail(out error, position, "The tuple point numbers are missing.");
        }

        int header = table[position++];
        int declared = header & 0x7F;
        if ((header & 0x80) != 0)
        {
            if (position >= end)
            {
                return Fail(out error, position, "The tuple point number count is truncated.");
            }

            declared = (declared << 8) | table[position++];
        }

        if (declared == 0)
        {
            allPoints = true;
            count = totalPoints;
            return true;
        }

        if (declared > totalPoints || declared > points.Length)
        {
            return Fail(out error, position, "The tuple point number count is invalid.");
        }

        int produced = 0;
        int current = 0;
        while (produced < declared)
        {
            if (position >= end)
            {
                return Fail(out error, position, "The tuple point number runs are truncated.");
            }

            int run = table[position++];
            int runCount = (run & 0x7F) + 1;
            bool words = (run & 0x80) != 0;
            if (produced + runCount > declared)
            {
                return Fail(out error, position, "The tuple point number runs exceed the count.");
            }

            for (int i = 0; i < runCount; i++)
            {
                int value;
                if (words)
                {
                    if (position + 2 > end)
                    {
                        return Fail(out error, position, "The tuple point numbers are truncated.");
                    }

                    value = UiFontFace.ReadU16(table, position);
                    position += 2;
                }
                else
                {
                    if (position >= end)
                    {
                        return Fail(out error, position, "The tuple point numbers are truncated.");
                    }

                    value = table[position++];
                }

                current += value;
                points[produced++] = current;
            }
        }

        count = declared;
        return true;
    }

    private static bool TryDecodeDeltas(
        ReadOnlySpan<byte> table,
        ref int position,
        int end,
        int count,
        Span<float> destination,
        out UiFontError error)
    {
        error = UiFontError.None;
        int produced = 0;
        while (produced < count)
        {
            if (position >= end)
            {
                return Fail(out error, position, "The tuple deltas are truncated.");
            }

            int run = table[position++];
            int runCount = (run & 0x3F) + 1;
            int kind = run & 0xC0;
            if (produced + runCount > count)
            {
                return Fail(out error, position, "The tuple delta runs exceed the point count.");
            }

            if (kind == 0x80)
            {
                destination.Slice(produced, runCount).Clear();
                produced += runCount;
                continue;
            }

            for (int i = 0; i < runCount; i++)
            {
                int value;
                if (kind == 0xC0)
                {
                    if (position + 4 > end)
                    {
                        return Fail(out error, position, "The tuple deltas are truncated.");
                    }

                    value = UiFontFace.ReadI32(table, position);
                    position += 4;
                }
                else if (kind == 0x40)
                {
                    if (position + 2 > end)
                    {
                        return Fail(out error, position, "The tuple deltas are truncated.");
                    }

                    value = UiFontFace.ReadI16(table, position);
                    position += 2;
                }
                else
                {
                    if (position >= end)
                    {
                        return Fail(out error, position, "The tuple deltas are truncated.");
                    }

                    value = (sbyte)table[position++];
                }

                destination[produced++] = value;
            }
        }

        return true;
    }

    private static bool Fail(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidVariation, offset, message);
        return false;
    }

    private static float F2Dot14(short value) => value / 16384.0f;
}
