namespace Axrone.Ui;

/// <summary>Outcome of one auto-size measurement.</summary>
/// <param name="Metrics">Measured extents at the resolved font size.</param>
/// <param name="ResolvedSize">Font size the layout was measured at.</param>
/// <param name="MarkedFixedSize">
/// Set when the block was clamped to the minimum size and should keep the fixed
/// size afterwards, mirroring TypeScript marking the block <c>autoSize: 'none'</c>.
/// </param>
public readonly record struct UiAutoSizeResult(UiTextMetrics Metrics, float ResolvedSize, bool MarkedFixedSize);

/// <summary>
/// Shrink-to-fit text measurement with a bounded LRU cache, ported from the
/// TypeScript <c>AutoSizeService</c>. Non-shrink styles pass straight through to
/// the measurer; bounded constraints resolve the largest fitting size with at
/// most four measures and cache the result.
/// </summary>
/// <remarks>
/// <para>
/// Cache key: (text, face, size, min, max, line height, letter spacing, wrap,
/// overflow, align, direction, max lines, quantized width, quantized height).
/// TypeScript adds family/locale because its face ids do not encode them;
/// <see cref="UiFontFaceId"/> is the resolved face here, so the fields collapse
/// into the face identity. Constraint sizes are quantized to
/// <see cref="ConstraintQuantum"/> pixels so sub-pixel layout jitter reuses
/// entries instead of thrashing the cache.</para>
/// <para>
/// Single-threaded. Hit lookups and eviction allocate zero bytes; storing a new
/// entry copies the text string once (bounded by <see cref="Capacity"/>).</para>
/// </remarks>
public sealed class UiAutoSizeService
{
    /// <summary>Gets the constraint quantization step in pixels used by the cache key.</summary>
    public const float ConstraintQuantum = 0.25f;

    /// <summary>Gets the minimum font size applied when a style leaves it unset.</summary>
    public const float DefaultMinFontSize = 6.0f;

    private const float SafetyFactor = 0.995f;
    private const float NudgeHeadroom = 1.001f;
    private const int TableEmpty = -1;

    private readonly Key[] _keys;
    private readonly string[] _texts;
    private readonly UiTextMetrics[] _metrics;
    private readonly float[] _sizes;
    private readonly bool[] _marked;
    private readonly int[] _hashes;
    private readonly int[] _prev;
    private readonly int[] _next;
    private readonly bool[] _live;
    private readonly int[] _table;
    private readonly int _tableMask;
    private int _count;
    private int _head;
    private int _tail;
    private long _hits;
    private long _misses;

    /// <summary>Creates an auto-size service with the TypeScript default capacity of 64 entries.</summary>
    /// <param name="capacity">Maximum cached measurements; clamped to at least 1.</param>
    public UiAutoSizeService(int capacity = 64)
    {
        int size = Math.Max(1, capacity);
        _keys = new Key[size];
        _texts = new string[size];
        _metrics = new UiTextMetrics[size];
        _sizes = new float[size];
        _marked = new bool[size];
        _hashes = new int[size];
        _prev = new int[size];
        _next = new int[size];
        _live = new bool[size];
        int tableSize = 2;
        while (tableSize < size * 4)
        {
            tableSize <<= 1;
        }

        _table = new int[tableSize];
        Array.Fill(_table, TableEmpty);
        _tableMask = tableSize - 1;
        _head = -1;
        _tail = -1;
        for (int i = 0; i < size; i++)
        {
            _prev[i] = -1;
            _next[i] = -1;
        }
    }

    /// <summary>Gets the maximum number of cached measurements.</summary>
    public int Capacity => _keys.Length;

    /// <summary>Gets the number of live cache entries.</summary>
    public int Count => _count;

    /// <summary>Gets the total hit count.</summary>
    public long HitCount => _hits;

    /// <summary>Gets the total miss count.</summary>
    public long MissCount => _misses;

    /// <summary>
    /// Measures text with auto-size support. Styles without
    /// <see cref="UiTextAutoSize.ShrinkToFit"/> and fully unbounded constraints
    /// delegate directly to the measurer, matching the TypeScript service.
    /// </summary>
    /// <param name="measurer">Backing text measurer.</param>
    /// <param name="text">Text to measure.</param>
    /// <param name="style">Resolved style carrying the auto-size parameters.</param>
    /// <param name="constraints">Measurement constraints.</param>
    /// <returns>The measurement result at the resolved font size.</returns>
    public UiAutoSizeResult Measure(
        IUiTextMeasurer measurer,
        ReadOnlySpan<char> text,
        in UiTextStyle style,
        in UiMeasureConstraints constraints)
    {
        ArgumentNullException.ThrowIfNull(measurer);
        if (style.AutoSize != UiTextAutoSize.ShrinkToFit)
        {
            return new UiAutoSizeResult(measurer.Measure(text, in style, in constraints), style.Size, false);
        }

        Key key = BuildKey(in style, in constraints);
        int hash = ComputeHash(in key, text);
        int slot = Find(hash, in key, text);
        if (slot >= 0)
        {
            _hits++;
            MoveToFront(slot);
            return new UiAutoSizeResult(_metrics[slot], _sizes[slot], _marked[slot]);
        }

        if (float.IsPositiveInfinity(constraints.MaxWidth) && float.IsPositiveInfinity(constraints.MaxHeight))
        {
            return new UiAutoSizeResult(measurer.Measure(text, in style, in constraints), style.Size, false);
        }

        _misses++;
        float maxSize = style.MaxFontSize > 0.0f ? MathF.Min(style.Size, style.MaxFontSize) : style.Size;
        float minSize = style.MinFontSize > 0.0f ? MathF.Max(1.0f, style.MinFontSize) : DefaultMinFontSize;
        if (minSize >= maxSize)
        {
            UiTextStyle clamped = style with { Size = minSize, AutoSize = UiTextAutoSize.None };
            UiAutoSizeResult result = new(measurer.Measure(text, in clamped, in constraints), minSize, true);
            Store(hash, in key, text, in result);
            return result;
        }

        UiAutoSizeResult resolved = ResolveShrinkToFit(measurer, text, in style, in constraints, minSize, maxSize);
        Store(hash, in key, text, in resolved);
        return resolved;
    }

    /// <summary>Drops every cached measurement (font table or measurer state changed).</summary>
    public void Invalidate()
    {
        Array.Fill(_live, false);
        Array.Fill(_table, TableEmpty);
        for (int i = 0; i < _keys.Length; i++)
        {
            _prev[i] = -1;
            _next[i] = -1;
        }

        _count = 0;
        _head = -1;
        _tail = -1;
    }

    private static Key BuildKey(in UiTextStyle style, in UiMeasureConstraints constraints)
    {
        Key key = default;
        key.FaceValue = style.Face.Value;
        key.SizeBits = BitConverter.SingleToInt32Bits(style.Size);
        key.MinBits = BitConverter.SingleToInt32Bits(style.MinFontSize);
        key.MaxBits = BitConverter.SingleToInt32Bits(style.MaxFontSize);
        key.LineHeightBits = BitConverter.SingleToInt32Bits(style.LineHeight);
        key.LetterSpacingBits = BitConverter.SingleToInt32Bits(style.LetterSpacing);
        key.Wrap = (byte)style.Wrap;
        key.Overflow = (byte)style.Overflow;
        key.Align = (byte)style.Align;
        key.Direction = (byte)style.Direction;
        key.MaxLines = style.MaxLines;
        key.WidthBits = Quantize(constraints.MaxWidth);
        key.HeightBits = Quantize(constraints.MaxHeight);
        return key;
    }

    private static int Quantize(float value)
    {
        if (!float.IsFinite(value))
        {
            return value > 0.0f ? int.MaxValue : 0;
        }

        int quantized = (int)(value / ConstraintQuantum);
        return quantized < 0 ? 0 : quantized;
    }

    private static int ComputeHash(in Key key, ReadOnlySpan<char> text)
    {
        uint hash = 2166136261U;
        hash = Mix(hash, key.FaceValue);
        hash = Mix(hash, unchecked((uint)key.SizeBits));
        hash = Mix(hash, unchecked((uint)key.MinBits));
        hash = Mix(hash, unchecked((uint)key.MaxBits));
        hash = Mix(hash, unchecked((uint)key.LineHeightBits));
        hash = Mix(hash, unchecked((uint)key.LetterSpacingBits));
        hash = Mix(hash, unchecked((uint)key.MaxLines));
        hash = Mix(hash, unchecked((uint)key.WidthBits));
        hash = Mix(hash, unchecked((uint)key.HeightBits));
        hash = Mix(hash, (uint)(key.Wrap | (key.Overflow << 2) | (key.Align << 4) | (key.Direction << 6)));
        foreach (char c in text)
        {
            hash = Mix(hash, c);
        }

        return unchecked((int)(hash & 0x7FFF_FFFFU));
    }

    private static uint Mix(uint hash, uint value)
    {
        hash ^= value;
        hash *= 16777619U;
        return hash;
    }

    private static bool KeyEquals(in Key left, in Key right) =>
        left.FaceValue == right.FaceValue &&
        left.SizeBits == right.SizeBits &&
        left.MinBits == right.MinBits &&
        left.MaxBits == right.MaxBits &&
        left.LineHeightBits == right.LineHeightBits &&
        left.LetterSpacingBits == right.LetterSpacingBits &&
        left.MaxLines == right.MaxLines &&
        left.WidthBits == right.WidthBits &&
        left.HeightBits == right.HeightBits &&
        left.Wrap == right.Wrap &&
        left.Overflow == right.Overflow &&
        left.Align == right.Align &&
        left.Direction == right.Direction;

    private static bool Fits(in UiTextMetrics metrics, float maxWidth, float maxHeight) =>
        !metrics.Truncated &&
        (!float.IsFinite(maxWidth) || metrics.Width <= maxWidth) &&
        (!float.IsFinite(maxHeight) || metrics.Height <= maxHeight);

    private static float ScaleRatio(in UiTextMetrics metrics, float maxWidth, float maxHeight)
    {
        float ratio = float.PositiveInfinity;
        if (float.IsFinite(maxWidth) && metrics.Width > 0.0f)
        {
            ratio = MathF.Min(ratio, maxWidth / metrics.Width);
        }

        if (float.IsFinite(maxHeight) && metrics.Height > 0.0f)
        {
            ratio = MathF.Min(ratio, maxHeight / metrics.Height);
        }

        return float.IsFinite(ratio) ? ratio : 1.0f;
    }

    /// <summary>
    /// Overflow ratio when the measurer clamps truncated extents to the box
    /// (the TypeScript engine reports natural widths directly; the C#
    /// <see cref="UiTextMetrics"/> contract clamps and flags truncation).
    /// Clamped dimensions fall back to the natural-size probe, scaled linearly
    /// with the current font size.
    /// </summary>
    private static float OverflowRatio(
        in UiTextMetrics layout,
        in NaturalExtents natural,
        float maxWidth,
        float maxHeight,
        float size,
        float maxSize)
    {
        float ratio = float.PositiveInfinity;
        if (float.IsFinite(maxWidth))
        {
            bool clamped = layout.Truncated && layout.Width >= maxWidth;
            float width = clamped && natural.Width > 0.0f
                ? natural.Width * size / maxSize
                : layout.Width;
            if (width > 0.0f)
            {
                ratio = MathF.Min(ratio, maxWidth / width);
            }
        }

        if (float.IsFinite(maxHeight))
        {
            bool clamped = layout.Truncated && layout.Height >= maxHeight;
            float height = clamped && natural.Height > 0.0f
                ? natural.Height * size / maxSize
                : layout.Height;
            if (height > 0.0f)
            {
                ratio = MathF.Min(ratio, maxHeight / height);
            }
        }

        return float.IsFinite(ratio) ? ratio : 1.0f;
    }

    private static UiTextMetrics MeasureAt(
        IUiTextMeasurer measurer,
        ReadOnlySpan<char> text,
        in UiTextStyle style,
        in UiMeasureConstraints constraints,
        float size)
    {
        UiTextStyle probe = style with { Size = size, AutoSize = UiTextAutoSize.None };
        return measurer.Measure(text, in probe, in constraints);
    }

    /// <summary>Unbounded natural extents at the maximum size, used to recover overflow ratios.</summary>
    private readonly struct NaturalExtents
    {
        public NaturalExtents(float width, float height)
        {
            Width = width;
            Height = height;
            Initialized = true;
        }

        public float Width { get; }

        public float Height { get; }

        public bool Initialized { get; }
    }

    private static NaturalExtents MeasureNatural(
        IUiTextMeasurer measurer,
        ReadOnlySpan<char> text,
        in UiTextStyle style,
        float maxWidth,
        float maxHeight,
        float maxSize)
    {
        UiTextStyle probe = style with { Size = maxSize, AutoSize = UiTextAutoSize.None, MaxLines = 0 };
        float naturalWidth = 0.0f;
        float naturalHeight = 0.0f;
        if (float.IsFinite(maxWidth))
        {
            naturalWidth = measurer.Measure(
                text,
                in probe,
                new UiMeasureConstraints(0.0f, 0.0f, float.PositiveInfinity, float.PositiveInfinity)).Width;
        }

        if (float.IsFinite(maxHeight))
        {
            naturalHeight = measurer.Measure(
                text,
                in probe,
                new UiMeasureConstraints(0.0f, 0.0f, maxWidth, float.PositiveInfinity)).Height;
        }

        return new NaturalExtents(naturalWidth, naturalHeight);
    }

    /// <summary>
    /// Analytical shrink resolution ported from TypeScript
    /// <c>resolveShrinkToFitLayout</c>: initial measure at max, at most two
    /// down-scale refinements (0.995 safety factor, 0.25px floor), bottom-out at
    /// min with the fixed-size mark, and one headroom nudge when re-wrapping
    /// left slack. At most four constrained measures run; truncated dimensions
    /// additionally consume up to two unbounded natural-size probes, which the
    /// TypeScript engine does not need because it reports unclamped widths.
    /// All probing happens once per cache miss; steady-state hits allocate zero.
    /// </summary>
    private static UiAutoSizeResult ResolveShrinkToFit(
        IUiTextMeasurer measurer,
        ReadOnlySpan<char> text,
        in UiTextStyle style,
        in UiMeasureConstraints constraints,
        float minSize,
        float maxSize)
    {
        float maxWidth = constraints.MaxWidth;
        float maxHeight = constraints.MaxHeight;
        float size = maxSize;
        UiTextMetrics layout = MeasureAt(measurer, text, in style, in constraints, size);
        if (Fits(layout, maxWidth, maxHeight))
        {
            return new UiAutoSizeResult(layout, size, false);
        }

        NaturalExtents natural = default;
        for (int refinement = 0; refinement < 2; refinement++)
        {
            if (!natural.Initialized && layout.Truncated)
            {
                natural = MeasureNatural(measurer, text, in style, maxWidth, maxHeight, maxSize);
            }

            float ratio = MathF.Min(1.0f, OverflowRatio(layout, natural, maxWidth, maxHeight, size, maxSize));
            if (ratio >= 1.0f)
            {
                break;
            }

            float estimated = size * ratio * SafetyFactor;
            float next = estimated >= size - 0.25f
                ? MathF.Max(minSize, size - 0.5f)
                : MathF.Max(minSize, estimated);
            if (next == size)
            {
                break;
            }

            size = next;
            layout = MeasureAt(measurer, text, in style, in constraints, size);
            if (Fits(layout, maxWidth, maxHeight))
            {
                break;
            }
        }

        if (!Fits(layout, maxWidth, maxHeight))
        {
            UiTextMetrics bottom = MeasureAt(measurer, text, in style, in constraints, minSize);
            return new UiAutoSizeResult(bottom, minSize, true);
        }

        if (size < maxSize)
        {
            float headroom = ScaleRatio(layout, maxWidth, maxHeight);
            if (headroom > NudgeHeadroom)
            {
                float nudged = MathF.Min(maxSize, size * headroom * SafetyFactor);
                if (nudged > size + 0.25f)
                {
                    UiTextMetrics nudgedLayout = MeasureAt(measurer, text, in style, in constraints, nudged);
                    if (Fits(nudgedLayout, maxWidth, maxHeight))
                    {
                        return new UiAutoSizeResult(nudgedLayout, nudged, false);
                    }
                }
            }
        }

        return new UiAutoSizeResult(layout, size, false);
    }

    private int Find(int hash, in Key key, ReadOnlySpan<char> text)
    {
        int index = hash & _tableMask;
        while (true)
        {
            int slot = _table[index];
            if (slot == TableEmpty)
            {
                return -1;
            }

            if (_live[slot] && _hashes[slot] == hash && KeyEquals(in _keys[slot], in key) &&
                _texts[slot].AsSpan().SequenceEqual(text))
            {
                return slot;
            }

            index = (index + 1) & _tableMask;
        }
    }

    private void MoveToFront(int slot)
    {
        if (_head == slot)
        {
            return;
        }

        Unlink(slot);
        LinkFront(slot);
    }

    private void Unlink(int slot)
    {
        int prev = _prev[slot];
        int next = _next[slot];
        if (prev >= 0)
        {
            _next[prev] = next;
        }
        else
        {
            _head = next;
        }

        if (next >= 0)
        {
            _prev[next] = prev;
        }
        else
        {
            _tail = prev;
        }

        _prev[slot] = -1;
        _next[slot] = -1;
    }

    private void LinkFront(int slot)
    {
        _prev[slot] = -1;
        _next[slot] = _head;
        if (_head >= 0)
        {
            _prev[_head] = slot;
        }
        else
        {
            _tail = slot;
        }

        _head = slot;
    }

    private void Store(int hash, in Key key, ReadOnlySpan<char> text, in UiAutoSizeResult result)
    {
        int slot;
        if (_count < _keys.Length)
        {
            slot = IndexOfFreeSlot();
            _live[slot] = true;
            _count++;
        }
        else
        {
            slot = _tail;
            Unlink(slot);
        }

        _keys[slot] = key;
        _texts[slot] = text.ToString();
        _hashes[slot] = hash;
        _metrics[slot] = result.Metrics;
        _sizes[slot] = result.ResolvedSize;
        _marked[slot] = result.MarkedFixedSize;
        LinkFront(slot);
        RebuildTable();
    }

    private int IndexOfFreeSlot()
    {
        for (int i = 0; i < _live.Length; i++)
        {
            if (!_live[i])
            {
                return i;
            }
        }

        return 0;
    }

    private void RebuildTable()
    {
        Array.Fill(_table, TableEmpty);
        for (int slot = 0; slot < _live.Length; slot++)
        {
            if (!_live[slot])
            {
                continue;
            }

            int index = _hashes[slot] & _tableMask;
            while (_table[index] != TableEmpty)
            {
                index = (index + 1) & _tableMask;
            }

            _table[index] = slot;
        }
    }

    private struct Key
    {
        internal uint FaceValue;
        internal int SizeBits;
        internal int MinBits;
        internal int MaxBits;
        internal int LineHeightBits;
        internal int LetterSpacingBits;
        internal int MaxLines;
        internal int WidthBits;
        internal int HeightBits;
        internal byte Wrap;
        internal byte Overflow;
        internal byte Align;
        internal byte Direction;
    }
}
