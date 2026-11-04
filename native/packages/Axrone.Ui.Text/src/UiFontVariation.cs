namespace Axrone.Ui.Text;

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontAxisTag(uint Value)
{
    public bool IsValid => Value != 0;

    public static UiFontAxisTag FromFourCc(ReadOnlySpan<char> tag)
    {
        if (tag.Length != 4)
        {
            return default;
        }

        uint value = 0;
        for (int i = 0; i < 4; i++)
        {
            char character = tag[i];
            if (character == '\0' || character > 0x7F)
            {
                return default;
            }

            value = (value << 8) | character;
        }

        return new UiFontAxisTag(value);
    }

    public override string ToString()
    {
        if (Value == 0)
        {
            return string.Empty;
        }

        return string.Create(4, Value, static (span, value) =>
        {
            span[0] = (char)((value >> 24) & 0xFF);
            span[1] = (char)((value >> 16) & 0xFF);
            span[2] = (char)((value >> 8) & 0xFF);
            span[3] = (char)(value & 0xFF);
        });
    }
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontAxis(UiFontAxisTag Tag, float MinValue, float DefaultValue, float MaxValue);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiFontAxisValue(UiFontAxisTag Tag, float Value);

internal static class UiVariationMath
{
    /// <summary>
    /// Triplet sanity for one axis of a variation region: the cut ordering must hold and the
    /// region must not straddle the default instance. A peak of zero marks an axis the region
    /// ignores, so any cut pair is acceptable there. Store parsing rejects malformed regions;
    /// evaluators keep the same predicate as a last line of defence.
    /// </summary>
    public static bool IsTripletValid(float start, float peak, float end) =>
        peak == 0.0f || !(start > peak || peak > end || (start < 0.0f && end > 0.0f));

    /// <summary>
    /// Axis factor of a region at <paramref name="coordinate"/>. False with a zero factor when
    /// the coordinate is outside the region or the triplet is malformed: an unusable region
    /// contributes nothing instead of applying its full delta.
    /// </summary>
    public static bool TryAxisFactor(float coordinate, float start, float peak, float end, out float factor)
    {
        if (peak == 0.0f)
        {
            factor = 1.0f;
            return true;
        }

        if (!IsTripletValid(start, peak, end))
        {
            factor = 0.0f;
            return false;
        }

        factor = 0.0f;
        if (coordinate == peak)
        {
            factor = 1.0f;
            return true;
        }

        if (coordinate <= start || end <= coordinate)
        {
            return false;
        }

        factor = coordinate < peak
            ? (coordinate - start) / (peak - start)
            : (coordinate - end) / (peak - end);
        return true;
    }
}

internal sealed class UiVariationData
{
    public UiVariationData(
        UiFontAxis[] axes,
        UiAvarData? avar,
        UiGvarData? gvar,
        UiHvarData? hvar,
        UiMvarData? mvar)
    {
        Axes = axes;
        Avar = avar;
        Gvar = gvar;
        Hvar = hvar;
        Mvar = mvar;
    }

    public UiFontAxis[] Axes { get; }

    public UiAvarData? Avar { get; }

    public UiGvarData? Gvar { get; }

    public UiHvarData? Hvar { get; }

    public UiMvarData? Mvar { get; }
}

internal sealed class UiAvarData
{
    private readonly int[] _starts;
    private readonly int[] _counts;
    private readonly float[] _positions;

    private UiAvarData(int[] starts, int[] counts, float[] positions)
    {
        _starts = starts;
        _counts = counts;
        _positions = positions;
    }

    public float Map(int axis, float value)
    {
        int start = _starts[axis];
        int count = _counts[axis];
        if (count <= 0)
        {
            return value;
        }

        int first = start * 2;
        if (value <= _positions[first])
        {
            return _positions[first + 1];
        }

        int last = (start + count - 1) * 2;
        if (value >= _positions[last])
        {
            return _positions[last + 1];
        }

        for (int i = 0; i < count - 1; i++)
        {
            int low = (start + i) * 2;
            int high = low + 2;
            float from = _positions[low];
            float to = _positions[high];
            if (value <= to)
            {
                float span = to - from;
                if (span <= 0.0f)
                {
                    return _positions[high + 1];
                }

                float t = (value - from) / span;
                return _positions[low + 1] + (t * (_positions[high + 1] - _positions[low + 1]));
            }
        }

        return value;
    }

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        int axisCount,
        out UiAvarData? avar,
        out UiFontError error)
    {
        avar = null;
        error = UiFontError.None;
        if (offset < 0 || length < 8)
        {
            return Fail(out error, offset, "avar table is truncated.");
        }

        int end = offset + length;
        if (UiFontFace.ReadU16(data, offset) != 1 || UiFontFace.ReadU16(data, offset + 2) != 0)
        {
            return Fail(out error, offset, "avar version is not supported.");
        }

        int declaredAxes = UiFontFace.ReadU16(data, offset + 6);
        if (declaredAxes != axisCount || declaredAxes == 0)
        {
            return Fail(out error, offset + 6, "avar axis count does not match fvar.");
        }

        var starts = new int[axisCount];
        var counts = new int[axisCount];
        var positions = new List<float>();
        int cursor = offset + 8;
        for (int axis = 0; axis < axisCount; axis++)
        {
            if (cursor + 2 > end)
            {
                return Fail(out error, cursor, "avar segment map count is truncated.");
            }

            int segmentCount = UiFontFace.ReadU16(data, cursor);
            cursor += 2;
            if (segmentCount < 2 || segmentCount > 0x1000 || cursor + (segmentCount * 4) > end)
            {
                return Fail(out error, cursor, "avar segment map is invalid.");
            }

            starts[axis] = positions.Count;
            counts[axis] = segmentCount;
            float previousFrom = -2.0f;
            for (int segment = 0; segment < segmentCount; segment++)
            {
                float from = F2Dot14(UiFontFace.ReadI16(data, cursor));
                float to = F2Dot14(UiFontFace.ReadI16(data, cursor + 2));
                cursor += 4;
                if (from < -1.0f || from > 1.0f || to < -1.0f || to > 1.0f || from <= previousFrom)
                {
                    return Fail(out error, cursor - 4, "avar segment map is not monotonic.");
                }

                previousFrom = from;
                positions.Add(from);
                positions.Add(to);
            }
        }

        for (int axis = 0; axis < axisCount; axis++)
        {
            if (counts[axis] == 0)
            {
                return Fail(out error, offset + 8, "avar segment map is missing.");
            }
        }

        avar = new UiAvarData(starts, counts, [.. positions]);
        return true;
    }

    private static bool Fail(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidVariation, offset, message);
        return false;
    }

    private static float F2Dot14(short value) => value / 16384.0f;
}

internal static class UiVariationParser
{
    public const int MaxAxes = 64;

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int fvarOffset,
        int fvarLength,
        int gvarOffset,
        int gvarLength,
        int avarOffset,
        int avarLength,
        int hvarOffset,
        int hvarLength,
        int mvarOffset,
        int mvarLength,
        int glyphCount,
        out UiVariationData? variation,
        out UiFontError error)
    {
        variation = null;
        error = UiFontError.None;
        if (fvarOffset < 0 && gvarOffset < 0 && avarOffset < 0 && hvarOffset < 0 && mvarOffset < 0)
        {
            return true;
        }

        if (fvarOffset < 0)
        {
            return Fail(out error, 0, "Variation tables require an fvar table.");
        }

        if (!TryParseFvar(data, fvarOffset, fvarLength, out UiFontAxis[]? axes, out error))
        {
            return false;
        }

        UiAvarData? avar = null;
        if (avarOffset >= 0 &&
            !UiAvarData.TryParse(data, avarOffset, avarLength, axes!.Length, out avar, out error))
        {
            return false;
        }

        UiGvarData? gvar = null;
        if (gvarOffset >= 0 &&
            !UiGvarData.TryParse(data, gvarOffset, gvarLength, glyphCount, axes!.Length, out gvar, out error))
        {
            return false;
        }

        UiHvarData? hvar = null;
        if (hvarOffset >= 0 &&
            !UiHvarData.TryParse(data, hvarOffset, hvarLength, axes!.Length, glyphCount, out hvar, out error))
        {
            return false;
        }

        UiMvarData? mvar = null;
        if (mvarOffset >= 0 &&
            !UiMvarData.TryParse(data, mvarOffset, mvarLength, axes!.Length, out mvar, out error))
        {
            return false;
        }

        variation = new UiVariationData(axes!, avar, gvar, hvar, mvar);
        return true;
    }

    private static bool TryParseFvar(
        ReadOnlySpan<byte> data,
        int offset,
        int length,
        out UiFontAxis[]? axes,
        out UiFontError error)
    {
        axes = null;
        error = UiFontError.None;
        if (offset < 0 || length < 16)
        {
            return Fail(out error, offset, "fvar table is truncated.");
        }

        if (UiFontFace.ReadU16(data, offset) != 1)
        {
            return Fail(out error, offset, "fvar version is not supported.");
        }

        int axesOffset = UiFontFace.ReadU16(data, offset + 4);
        int axisCount = UiFontFace.ReadU16(data, offset + 8);
        int axisSize = UiFontFace.ReadU16(data, offset + 10);
        int instanceCount = UiFontFace.ReadU16(data, offset + 12);
        int instanceSize = UiFontFace.ReadU16(data, offset + 14);
        if (axisCount == 0 || axisCount > MaxAxes)
        {
            return Fail(out error, offset + 8, "fvar axis count is invalid.");
        }

        if (axisSize < 20)
        {
            return Fail(out error, offset + 10, "fvar axis record size is invalid.");
        }

        long axesEnd = axesOffset + ((long)axisCount * axisSize);
        if (axesOffset < 16 || axesEnd > length)
        {
            return Fail(out error, offset + 4, "fvar axis records exceed the table.");
        }

        if (instanceCount > 0 && (instanceSize < 4 || axesEnd + ((long)instanceCount * instanceSize) > length))
        {
            return Fail(out error, offset + 14, "fvar instances exceed the table.");
        }

        var parsed = new UiFontAxis[axisCount];
        for (int axis = 0; axis < axisCount; axis++)
        {
            int record = offset + axesOffset + (axis * axisSize);
            uint tag = UiFontFace.ReadU32(data, record);
            float min = Fixed(UiFontFace.ReadI32(data, record + 4));
            float defaultValue = Fixed(UiFontFace.ReadI32(data, record + 8));
            float max = Fixed(UiFontFace.ReadI32(data, record + 12));
            if (tag == 0 ||
                !float.IsFinite(min) ||
                !float.IsFinite(defaultValue) ||
                !float.IsFinite(max) ||
                min > defaultValue ||
                defaultValue > max)
            {
                return Fail(out error, record, "fvar axis record is invalid.");
            }

            for (int previous = 0; previous < axis; previous++)
            {
                if (parsed[previous].Tag.Value == tag)
                {
                    return Fail(out error, record, "fvar axis tags must be unique.");
                }
            }

            parsed[axis] = new UiFontAxis(new UiFontAxisTag(tag), min, defaultValue, max);
        }

        axes = parsed;
        return true;
    }

    private static bool Fail(out UiFontError error, int offset, string message)
    {
        error = UiFontError.At(UiFontErrorCode.InvalidVariation, offset, message);
        return false;
    }

    private static float Fixed(int value) => value / 65536.0f;
}
