namespace Axrone.Ui.Text;

public enum UiColorPaintKind
{
    Solid,
    LinearGradient,
    RadialGradient,
    Glyph,
    ColrGlyph,
    ColrLayers,
    Transform,
    Composite,
}

public enum UiColorExtendMode
{
    Pad,
    Repeat,
    Reflect,
}

public enum UiColorCompositeMode
{
    Clear,
    Source,
    Destination,
    SourceOver,
    DestinationOver,
    SourceIn,
    DestinationIn,
    SourceOut,
    DestinationOut,
    SourceAtop,
    DestinationAtop,
    Xor,
    Plus,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Multiply,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiColorAffine(float XX, float YX, float XY, float YY, float DX, float DY)
{
    public static UiColorAffine Identity => new(1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f);
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiColorPaint(UiColorPaintKind Kind, int Index)
{
    public bool IsValid => Index >= 0;
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiColorGradient(int Index)
{
    public bool IsValid => Index >= 0;
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiColorGradientStop(float Offset, int PaletteIndex, float Alpha);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiColorLinearGradient(
    UiColorExtendMode Extend,
    float X0,
    float Y0,
    float X1,
    float Y1,
    float X2,
    float Y2);

[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiColorRadialGradient(
    UiColorExtendMode Extend,
    float X0,
    float Y0,
    float R0,
    float X1,
    float Y1,
    float R1);

internal struct UiColorPaintNode
{
    public UiColorPaintKind Kind;
    public int ChildStart;
    public int ChildCount;
    public int GlyphId;
    public int PaletteIndex;
    public int GradientIndex;
    public int CompositeMode;
    public float Alpha;
    public UiColorAffine Transform;
}

internal struct UiColorGradientRecord
{
    public UiColorPaintKind Kind;
    public UiColorExtendMode Extend;
    public float X0;
    public float Y0;
    public float R0;
    public float X1;
    public float Y1;
    public float X2;
    public float Y2;
    public float R1;
    public int StopStart;
    public int StopCount;
}

internal sealed class UiColorPaintData
{
    private readonly UiColorPaintNode[] _nodes;
    private readonly int[] _children;
    private readonly UiColorGradientRecord[] _gradients;
    private readonly UiColorGradientStop[] _stops;
    private readonly int[] _baseGlyphs;
    private readonly int[] _baseRoots;

    private UiColorPaintData(
        UiColorPaintNode[] nodes,
        int[] children,
        UiColorGradientRecord[] gradients,
        UiColorGradientStop[] stops,
        int[] baseGlyphs,
        int[] baseRoots)
    {
        _nodes = nodes;
        _children = children;
        _gradients = gradients;
        _stops = stops;
        _baseGlyphs = baseGlyphs;
        _baseRoots = baseRoots;
    }

    public int RootCount => _baseGlyphs.Length;

    public static bool TryParse(
        ReadOnlySpan<byte> data,
        int colrOffset,
        int colrLength,
        int baseGlyphListOffset,
        int layerListOffset,
        int clipListOffset,
        int varIndexMapOffset,
        int varStoreOffset,
        int paletteCount,
        out UiColorPaintData? paintGraph,
        out UiFontError error)
    {
        paintGraph = null;
        error = UiFontError.None;
        if (clipListOffset != 0 || varIndexMapOffset != 0 || varStoreOffset != 0)
        {
            error = UiFontError.At(
                UiFontErrorCode.UnsupportedColorFormat,
                colrOffset,
                "COLR v1 clips and paint variations are not supported.");
            return false;
        }

        if (baseGlyphListOffset != 0 &&
            (baseGlyphListOffset < 34 || baseGlyphListOffset >= colrLength))
        {
            error = UiFontError.At(UiFontErrorCode.InvalidColor, colrOffset + 14, "COLR base glyph list offset is invalid.");
            return false;
        }

        if (layerListOffset != 0 &&
            (layerListOffset < 34 || layerListOffset >= colrLength))
        {
            error = UiFontError.At(UiFontErrorCode.InvalidColor, colrOffset + 18, "COLR layer list offset is invalid.");
            return false;
        }

        if (baseGlyphListOffset == 0)
        {
            paintGraph = new UiColorPaintData([], [], [], [], [], []);
            return true;
        }

        var parser = new Parser(
            data,
            colrOffset,
            colrLength,
            layerListOffset,
            paletteCount);
        if (!parser.TryParse(baseGlyphListOffset, out error))
        {
            return false;
        }

        paintGraph = parser.Build();
        return true;
    }

    public bool TryGetRoot(int glyphId, out int nodeIndex)
    {
        int low = 0;
        int high = _baseGlyphs.Length - 1;
        while (low <= high)
        {
            int middle = low + ((high - low) >> 1);
            int glyph = _baseGlyphs[middle];
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
                nodeIndex = _baseRoots[middle];
                return true;
            }
        }

        nodeIndex = -1;
        return false;
    }

    public bool TryGetNode(int nodeIndex, out UiColorPaintNode node)
    {
        if ((uint)nodeIndex >= (uint)_nodes.Length)
        {
            node = default;
            return false;
        }

        node = _nodes[nodeIndex];
        return true;
    }

    public bool TryGetChildCount(int nodeIndex, out int count)
    {
        if ((uint)nodeIndex >= (uint)_nodes.Length)
        {
            count = 0;
            return false;
        }

        count = _nodes[nodeIndex].ChildCount;
        return true;
    }

    public bool TryGetChild(int nodeIndex, int childIndex, out int childNode)
    {
        childNode = -1;
        if ((uint)nodeIndex >= (uint)_nodes.Length)
        {
            return false;
        }

        UiColorPaintNode node = _nodes[nodeIndex];
        if ((uint)childIndex >= (uint)node.ChildCount)
        {
            return false;
        }

        childNode = _children[node.ChildStart + childIndex];
        return true;
    }

    public bool TryGetGradient(int gradientIndex, out UiColorGradientRecord gradient)
    {
        if ((uint)gradientIndex >= (uint)_gradients.Length)
        {
            gradient = default;
            return false;
        }

        gradient = _gradients[gradientIndex];
        return true;
    }

    public bool TryGetStop(int gradientIndex, int stopIndex, out UiColorGradientStop stop)
    {
        stop = default;
        if ((uint)gradientIndex >= (uint)_gradients.Length)
        {
            return false;
        }

        UiColorGradientRecord gradient = _gradients[gradientIndex];
        if ((uint)stopIndex >= (uint)gradient.StopCount)
        {
            return false;
        }

        stop = _stops[gradient.StopStart + stopIndex];
        return true;
    }

    private ref struct Parser
    {
        private const int MaxNodes = 65_536;
        private const int MaxChildren = 65_536;
        private const int MaxGradients = 16_384;
        private const int MaxStops = 65_536;
        private const int MaxDepth = 64;
        private const int MaxBaseGlyphs = 65_536;

        private readonly ReadOnlySpan<byte> _data;
        private readonly int _colrOffset;
        private readonly int _colrLength;
        private readonly int _layerListOffset;
        private readonly int _layerCount;
        private readonly int _paletteCount;
        private readonly List<UiColorPaintNode> _nodes = [];
        private readonly List<int> _children = [];
        private readonly List<UiColorGradientRecord> _gradients = [];
        private readonly List<UiColorGradientStop> _stops = [];
        private int[] _baseGlyphs = [];
        private int[] _paintOffsets = [];
        private int[] _states = [];
        private int[] _roots = [];
        private bool _limitExceeded;

        public Parser(
            ReadOnlySpan<byte> data,
            int colrOffset,
            int colrLength,
            int layerListOffset,
            int paletteCount)
        {
            _data = data;
            _colrOffset = colrOffset;
            _colrLength = colrLength;
            _paletteCount = paletteCount;
            _layerListOffset = layerListOffset;
            _layerCount = ReadLayerCount();
        }

        public bool TryParse(int baseGlyphListOffset, out UiFontError error)
        {
            error = UiFontError.None;
            if (!IsRange(baseGlyphListOffset + _colrOffset, 4))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, baseGlyphListOffset, "COLR base glyph list is outside the table.");
            }

            uint count = UiFontFace.ReadU32(_data, _colrOffset + baseGlyphListOffset);
            if (count > MaxBaseGlyphs)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, baseGlyphListOffset, "COLR base glyph list exceeds the limit.");
            }

            int baseCount = (int)count;
            int recordsStart = _colrOffset + baseGlyphListOffset + 4;
            if (!IsRange(recordsStart, baseCount * 6))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, baseGlyphListOffset, "COLR base glyph records exceed the table.");
            }

            _baseGlyphs = new int[baseCount];
            _paintOffsets = new int[baseCount];
            _states = new int[baseCount];
            _roots = new int[baseCount];
            Array.Fill(_roots, -1);
            int previous = -1;
            for (int i = 0; i < baseCount; i++)
            {
                int record = recordsStart + (i * 6);
                int glyph = UiFontFace.ReadU16(_data, record);
                int paintOffset = (int)UiFontFace.ReadU32(_data, record + 2);
                if (glyph <= previous)
                {
                    return Fail(out error, UiFontErrorCode.InvalidColor, record, "COLR base glyph records are not sorted.");
                }

                previous = glyph;
                _baseGlyphs[i] = glyph;
                _paintOffsets[i] = record + paintOffset;
                if (!IsRange(_paintOffsets[i], 1))
                {
                    return Fail(out error, UiFontErrorCode.InvalidColor, record + 2, "COLR base glyph paint offset is outside the table.");
                }
            }

            for (int i = 0; i < baseCount; i++)
            {
                if (!TryParseBase(i, 0, out error))
                {
                    return false;
                }
            }

            if (_limitExceeded)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, _colrOffset, "COLR paint graph exceeds the node limit.");
            }

            return true;
        }

        public UiColorPaintData Build() => new(
            [.. _nodes],
            [.. _children],
            [.. _gradients],
            [.. _stops],
            _baseGlyphs,
            _roots);

        private bool TryParseBase(int baseIndex, int depth, out UiFontError error)
        {
            error = UiFontError.None;
            if (_states[baseIndex] == 2)
            {
                return true;
            }

            if (_states[baseIndex] == 1)
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, _paintOffsets[baseIndex], "COLR paint graph contains a cycle.");
            }

            _states[baseIndex] = 1;
            if (!TryParsePaint(_paintOffsets[baseIndex], depth, out int root, out error))
            {
                return false;
            }

            _roots[baseIndex] = root;
            _states[baseIndex] = 2;
            return true;
        }

        private bool TryParsePaint(int offset, int depth, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (depth > MaxDepth)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, offset, "COLR paint graph depth exceeds the limit.");
            }

            if (!IsRange(offset, 1))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR paint offset is outside the table.");
            }

            int format = _data[offset];
            switch (format)
            {
                case 1:
                    return TryParseLayers(offset, depth, out nodeIndex, out error);
                case 2:
                    return TryParseSolid(offset, out nodeIndex, out error);
                case 4:
                    return TryParseLinearGradient(offset, out nodeIndex, out error);
                case 6:
                    return TryParseRadialGradient(offset, out nodeIndex, out error);
                case 10:
                    return TryParseGlyph(offset, depth, out nodeIndex, out error);
                case 11:
                    return TryParseColrGlyph(offset, depth, out nodeIndex, out error);
                case 12:
                    return TryParseTransform(offset, depth, out nodeIndex, out error);
                case 14:
                    return TryParseTranslate(offset, depth, out nodeIndex, out error);
                case 16:
                    return TryParseScale(offset, depth, false, false, out nodeIndex, out error);
                case 18:
                    return TryParseScale(offset, depth, false, true, out nodeIndex, out error);
                case 20:
                    return TryParseScale(offset, depth, true, false, out nodeIndex, out error);
                case 22:
                    return TryParseScale(offset, depth, true, true, out nodeIndex, out error);
                case 24:
                    return TryParseRotate(offset, depth, false, out nodeIndex, out error);
                case 26:
                    return TryParseRotate(offset, depth, true, out nodeIndex, out error);
                case 28:
                    return TryParseSkew(offset, depth, false, out nodeIndex, out error);
                case 30:
                    return TryParseSkew(offset, depth, true, out nodeIndex, out error);
                case 32:
                    return TryParseComposite(offset, depth, out nodeIndex, out error);
                default:
                    return Fail(
                        out error,
                        UiFontErrorCode.UnsupportedColorFormat,
                        offset,
                        "COLR paint format is not supported.");
            }
        }

        private bool TryParseLayers(int offset, int depth, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 5))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR layer paint is truncated.");
            }

            int count = _data[offset + 1];
            uint first = UiFontFace.ReadU32(_data, offset + 2);
            if (_layerListOffset == 0 || first > (uint)_layerCount || count > _layerCount - (int)first)
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset + 2, "COLR layer index is outside the layer list.");
            }

            var children = new List<int>(count);
            for (int i = 0; i < count; i++)
            {
                int layerRecord = _layerListOffset + _colrOffset + 4 + (((int)first + i) * 4);
                if (!IsRange(layerRecord, 4))
                {
                    return Fail(out error, UiFontErrorCode.InvalidColor, layerRecord, "COLR layer offset is outside the table.");
                }

                int childOffset = _layerListOffset + _colrOffset + (int)UiFontFace.ReadU32(_data, layerRecord);
                if (!TryParsePaint(childOffset, depth + 1, out int child, out error))
                {
                    return false;
                }

                children.Add(child);
            }

            nodeIndex = AddNode(
                UiColorPaintKind.ColrLayers,
                children.ToArray(),
                glyphId: -1,
                paletteIndex: -1,
                gradientIndex: -1,
                compositeMode: -1,
                alpha: 1.0f,
                UiColorAffine.Identity);
            return true;
        }

        private bool TryParseSolid(int offset, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 4))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR solid paint is truncated.");
            }

            int palette = UiFontFace.ReadU16(_data, offset + 1);
            float alpha = F2Dot14(UiFontFace.ReadI16(_data, offset + 3));
            if (!ValidatePalette(palette, out int resolved) || !ValidateAlpha(alpha, out error, offset + 3))
            {
                if (!error.HasError)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidColor, offset + 1, "COLR solid palette index is invalid.");
                }

                return false;
            }

            nodeIndex = AddNode(
                UiColorPaintKind.Solid,
                [],
                glyphId: -1,
                paletteIndex: resolved,
                gradientIndex: -1,
                compositeMode: -1,
                alpha,
                UiColorAffine.Identity);
            return true;
        }

        private bool TryParseLinearGradient(int offset, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 15))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR linear gradient is truncated.");
            }

            int colorLineOffset = offset + ReadU24(offset + 1);
            if (!TryParseColorLine(colorLineOffset, UiColorPaintKind.LinearGradient, out int gradient, out error))
            {
                return false;
            }

            _gradients[gradient] = new UiColorGradientRecord
            {
                Kind = UiColorPaintKind.LinearGradient,
                Extend = _gradients[gradient].Extend,
                X0 = UiFontFace.ReadI16(_data, offset + 4),
                Y0 = UiFontFace.ReadI16(_data, offset + 6),
                X1 = UiFontFace.ReadI16(_data, offset + 8),
                Y1 = UiFontFace.ReadI16(_data, offset + 10),
                X2 = UiFontFace.ReadI16(_data, offset + 12),
                Y2 = UiFontFace.ReadI16(_data, offset + 14),
                StopStart = _gradients[gradient].StopStart,
                StopCount = _gradients[gradient].StopCount,
            };
            nodeIndex = AddNode(
                UiColorPaintKind.LinearGradient,
                [],
                glyphId: -1,
                paletteIndex: -1,
                gradientIndex: gradient,
                compositeMode: -1,
                alpha: 1.0f,
                UiColorAffine.Identity);
            return true;
        }

        private bool TryParseRadialGradient(int offset, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 15))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR radial gradient is truncated.");
            }

            int colorLineOffset = offset + ReadU24(offset + 1);
            if (!TryParseColorLine(colorLineOffset, UiColorPaintKind.RadialGradient, out int gradient, out error))
            {
                return false;
            }

            _gradients[gradient] = new UiColorGradientRecord
            {
                Kind = UiColorPaintKind.RadialGradient,
                Extend = _gradients[gradient].Extend,
                X0 = UiFontFace.ReadI16(_data, offset + 4),
                Y0 = UiFontFace.ReadI16(_data, offset + 6),
                R0 = UiFontFace.ReadU16(_data, offset + 8),
                X1 = UiFontFace.ReadI16(_data, offset + 10),
                Y1 = UiFontFace.ReadI16(_data, offset + 12),
                R1 = UiFontFace.ReadU16(_data, offset + 14),
                StopStart = _gradients[gradient].StopStart,
                StopCount = _gradients[gradient].StopCount,
            };
            nodeIndex = AddNode(
                UiColorPaintKind.RadialGradient,
                [],
                glyphId: -1,
                paletteIndex: -1,
                gradientIndex: gradient,
                compositeMode: -1,
                alpha: 1.0f,
                UiColorAffine.Identity);
            return true;
        }

        private bool TryParseColorLine(
            int offset,
            UiColorPaintKind kind,
            out int gradientIndex,
            out UiFontError error)
        {
            gradientIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset, 3))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR color line is truncated.");
            }

            int extend = _data[offset];
            int count = UiFontFace.ReadU16(_data, offset + 1);
            if (extend > 2 || count < 2 || count > MaxStops || !IsRange(offset + 3, count * 6))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR color line is invalid.");
            }

            if (_stops.Count + count > MaxStops)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, offset, "COLR gradient stops exceed the limit.");
            }

            int stopStart = _stops.Count;
            float previous = -1.0f;
            for (int i = 0; i < count; i++)
            {
                int stopOffset = offset + 3 + (i * 6);
                float position = F2Dot14(UiFontFace.ReadI16(_data, stopOffset));
                int palette = UiFontFace.ReadU16(_data, stopOffset + 2);
                float alpha = F2Dot14(UiFontFace.ReadI16(_data, stopOffset + 4));
                if (position < 0.0f || position > 1.0f || position < previous ||
                    !ValidatePalette(palette, out int resolved) ||
                    !ValidateAlpha(alpha, out error, stopOffset + 4))
                {
                    if (!error.HasError)
                    {
                        error = UiFontError.At(UiFontErrorCode.InvalidColor, stopOffset, "COLR gradient stop is invalid.");
                    }

                    return false;
                }

                previous = position;
                _stops.Add(new UiColorGradientStop(position, resolved, alpha));
            }

            if (_gradients.Count >= MaxGradients)
            {
                return Fail(out error, UiFontErrorCode.ResourceLimit, offset, "COLR gradients exceed the limit.");
            }

            gradientIndex = _gradients.Count;
            _gradients.Add(new UiColorGradientRecord
            {
                Kind = kind,
                Extend = (UiColorExtendMode)extend,
                StopStart = stopStart,
                StopCount = count,
            });
            return true;
        }

        private bool TryParseGlyph(int offset, int depth, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 5))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR glyph paint is truncated.");
            }

            int childOffset = offset + ReadU24(offset + 1);
            int glyph = UiFontFace.ReadU16(_data, offset + 4);
            if (!TryParsePaint(childOffset, depth + 1, out int child, out error))
            {
                return false;
            }

            nodeIndex = AddNode(
                UiColorPaintKind.Glyph,
                [child],
                glyph,
                paletteIndex: -1,
                gradientIndex: -1,
                compositeMode: -1,
                alpha: 1.0f,
                UiColorAffine.Identity);
            return true;
        }

        private bool TryParseColrGlyph(int offset, int depth, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 2))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR colr glyph paint is truncated.");
            }

            int glyph = UiFontFace.ReadU16(_data, offset + 1);
            int baseIndex = FindBaseGlyph(glyph);
            if (baseIndex < 0)
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset + 1, "COLR colr glyph has no base glyph record.");
            }

            if (!TryParseBase(baseIndex, depth + 1, out error))
            {
                return false;
            }

            nodeIndex = AddNode(
                UiColorPaintKind.ColrGlyph,
                [_roots[baseIndex]],
                glyph,
                paletteIndex: -1,
                gradientIndex: -1,
                compositeMode: -1,
                alpha: 1.0f,
                UiColorAffine.Identity);
            return true;
        }

        private bool TryParseTransform(int offset, int depth, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 6))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR transform paint is truncated.");
            }

            int childOffset = offset + ReadU24(offset + 1);
            int matrixOffset = offset + ReadU24(offset + 4);
            if (!IsRange(matrixOffset, 24))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, matrixOffset, "COLR affine matrix is outside the table.");
            }

            var transform = new UiColorAffine(
                Fixed(UiFontFace.ReadI32(_data, matrixOffset)),
                Fixed(UiFontFace.ReadI32(_data, matrixOffset + 4)),
                Fixed(UiFontFace.ReadI32(_data, matrixOffset + 8)),
                Fixed(UiFontFace.ReadI32(_data, matrixOffset + 12)),
                Fixed(UiFontFace.ReadI32(_data, matrixOffset + 16)),
                Fixed(UiFontFace.ReadI32(_data, matrixOffset + 20)));
            return TryAddTransform(offset, depth, transform, out nodeIndex, out error);
        }

        private bool TryParseTranslate(int offset, int depth, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 7))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR translate paint is truncated.");
            }

            int childOffset = offset + ReadU24(offset + 1);
            var transform = new UiColorAffine(
                1.0f,
                0.0f,
                0.0f,
                1.0f,
                UiFontFace.ReadI16(_data, offset + 4),
                UiFontFace.ReadI16(_data, offset + 6));
            return TryAddTransform(offset, depth, transform, out nodeIndex, out error);
        }

        private bool TryParseScale(int offset, int depth, bool uniform, bool aroundCenter, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            int size = uniform ? (aroundCenter ? 10 : 6) : (aroundCenter ? 12 : 8);
            if (!IsRange(offset + 1, size - 1))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR scale paint is truncated.");
            }

            int childOffset = offset + ReadU24(offset + 1);
            float scaleX = F2Dot14(UiFontFace.ReadI16(_data, offset + 4));
            float scaleY = uniform ? scaleX : F2Dot14(UiFontFace.ReadI16(_data, offset + 6));
            int centerPosition = uniform ? 6 : 8;
            float centerX = aroundCenter ? UiFontFace.ReadI16(_data, offset + centerPosition) : 0.0f;
            float centerY = aroundCenter ? UiFontFace.ReadI16(_data, offset + centerPosition + 2) : 0.0f;
            var transform = Compose(
                new UiColorAffine(1.0f, 0.0f, 0.0f, 1.0f, centerX, centerY),
                new UiColorAffine(scaleX, 0.0f, 0.0f, scaleY, 0.0f, 0.0f),
                new UiColorAffine(1.0f, 0.0f, 0.0f, 1.0f, -centerX, -centerY));
            return TryAddTransform(offset, depth, transform, out nodeIndex, out error);
        }

        private bool TryParseRotate(int offset, int depth, bool aroundCenter, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            int size = aroundCenter ? 10 : 6;
            if (!IsRange(offset + 1, size - 1))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR rotate paint is truncated.");
            }

            int childOffset = offset + ReadU24(offset + 1);
            float angle = F2Dot14(UiFontFace.ReadI16(_data, offset + 4)) * (MathF.PI / 180.0f);
            float cosine = MathF.Cos(angle);
            float sine = MathF.Sin(angle);
            float centerX = aroundCenter ? UiFontFace.ReadI16(_data, offset + 6) : 0.0f;
            float centerY = aroundCenter ? UiFontFace.ReadI16(_data, offset + 8) : 0.0f;
            var transform = Compose(
                new UiColorAffine(1.0f, 0.0f, 0.0f, 1.0f, centerX, centerY),
                new UiColorAffine(cosine, sine, -sine, cosine, 0.0f, 0.0f),
                new UiColorAffine(1.0f, 0.0f, 0.0f, 1.0f, -centerX, -centerY));
            return TryAddTransform(offset, depth, transform, out nodeIndex, out error);
        }

        private bool TryParseSkew(int offset, int depth, bool aroundCenter, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            int size = aroundCenter ? 12 : 8;
            if (!IsRange(offset + 1, size - 1))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR skew paint is truncated.");
            }

            int childOffset = offset + ReadU24(offset + 1);
            float xSkew = MathF.Tan(F2Dot14(UiFontFace.ReadI16(_data, offset + 4)) * (MathF.PI / 180.0f));
            float ySkew = MathF.Tan(F2Dot14(UiFontFace.ReadI16(_data, offset + 6)) * (MathF.PI / 180.0f));
            float centerX = aroundCenter ? UiFontFace.ReadI16(_data, offset + 8) : 0.0f;
            float centerY = aroundCenter ? UiFontFace.ReadI16(_data, offset + 10) : 0.0f;
            var transform = Compose(
                new UiColorAffine(1.0f, 0.0f, 0.0f, 1.0f, centerX, centerY),
                new UiColorAffine(1.0f, ySkew, xSkew, 1.0f, 0.0f, 0.0f),
                new UiColorAffine(1.0f, 0.0f, 0.0f, 1.0f, -centerX, -centerY));
            return TryAddTransform(offset, depth, transform, out nodeIndex, out error);
        }

        private bool TryAddTransform(
            int offset,
            int depth,
            UiColorAffine transform,
            out int nodeIndex,
            out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            int childOffset = offset + ReadU24(offset + 1);
            if (!TryParsePaint(childOffset, depth + 1, out int child, out error))
            {
                return false;
            }

            nodeIndex = AddNode(
                UiColorPaintKind.Transform,
                [child],
                glyphId: -1,
                paletteIndex: -1,
                gradientIndex: -1,
                compositeMode: -1,
                alpha: 1.0f,
                transform);
            return true;
        }

        private bool TryParseComposite(int offset, int depth, out int nodeIndex, out UiFontError error)
        {
            nodeIndex = -1;
            error = UiFontError.None;
            if (!IsRange(offset + 1, 8))
            {
                return Fail(out error, UiFontErrorCode.InvalidColor, offset, "COLR composite paint is truncated.");
            }

            int sourceOffset = offset + ReadU24(offset + 1);
            int mode = _data[offset + 4];
            int backdropOffset = offset + ReadU24(offset + 5);
            if (mode >= (int)UiColorCompositeMode.Luminosity + 1)
            {
                return Fail(out error, UiFontErrorCode.UnsupportedColorFormat, offset + 4, "COLR composite mode is not supported.");
            }

            if (!TryParsePaint(sourceOffset, depth + 1, out int source, out error) ||
                !TryParsePaint(backdropOffset, depth + 1, out int backdrop, out error))
            {
                return false;
            }

            nodeIndex = AddNode(
                UiColorPaintKind.Composite,
                [source, backdrop],
                glyphId: -1,
                paletteIndex: -1,
                gradientIndex: -1,
                compositeMode: mode,
                alpha: 1.0f,
                UiColorAffine.Identity);
            return true;
        }

        private int AddNode(
            UiColorPaintKind kind,
            int[] children,
            int glyphId,
            int paletteIndex,
            int gradientIndex,
            int compositeMode,
            float alpha,
            UiColorAffine transform)
        {
            if (_nodes.Count >= MaxNodes || _children.Count + children.Length > MaxChildren)
            {
                _limitExceeded = true;
                return -1;
            }

            int childStart = _children.Count;
            for (int i = 0; i < children.Length; i++)
            {
                _children.Add(children[i]);
            }

            int index = _nodes.Count;
            _nodes.Add(new UiColorPaintNode
            {
                Kind = kind,
                ChildStart = childStart,
                ChildCount = children.Length,
                GlyphId = glyphId,
                PaletteIndex = paletteIndex,
                GradientIndex = gradientIndex,
                CompositeMode = compositeMode,
                Alpha = alpha,
                Transform = transform,
            });
            return index;
        }

        private int ReadLayerCount()
        {
            if (_layerListOffset <= 0 || !IsRange(_layerListOffset + _colrOffset, 4))
            {
                return 0;
            }

            uint count = UiFontFace.ReadU32(_data, _colrOffset + _layerListOffset);
            if (count > 65_536 || !IsRange(_layerListOffset + _colrOffset + 4, (int)count * 4))
            {
                return 0;
            }

            return (int)count;
        }

        private int FindBaseGlyph(int glyphId)
        {
            int low = 0;
            int high = _baseGlyphs.Length - 1;
            while (low <= high)
            {
                int middle = low + ((high - low) >> 1);
                int glyph = _baseGlyphs[middle];
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
                    return middle;
                }
            }

            return -1;
        }

        private bool ValidatePalette(int paletteIndex, out int resolved)
        {
            if (paletteIndex == 0xFFFF)
            {
                resolved = -1;
                return true;
            }

            resolved = paletteIndex;
            return paletteIndex < _paletteCount;
        }

        private static bool ValidateAlpha(float alpha, out UiFontError error, int offset)
        {
            error = UiFontError.None;
            if (alpha < 0.0f || alpha > 1.0f)
            {
                error = UiFontError.At(UiFontErrorCode.InvalidColor, offset, "COLR paint alpha is outside the valid range.");
                return false;
            }

            return true;
        }

        private bool IsRange(int absoluteOffset, int size)
        {
            long end = (long)absoluteOffset + size;
            return absoluteOffset >= _colrOffset && end <= _colrOffset + _colrLength;
        }

        private int ReadU24(int position)
        {
            return (_data[position] << 16) | (_data[position + 1] << 8) | _data[position + 2];
        }

        private static float F2Dot14(short value) => value / 16384.0f;

        private static float Fixed(int value) => value / 65536.0f;

        private static UiColorAffine Compose(UiColorAffine first, UiColorAffine second, UiColorAffine third)
        {
            UiColorAffine result = Multiply(first, second);
            return Multiply(result, third);
        }

        private static UiColorAffine Multiply(UiColorAffine left, UiColorAffine right) => new(
            (left.XX * right.XX) + (left.XY * right.YX),
            (left.YX * right.XX) + (left.YY * right.YX),
            (left.XX * right.XY) + (left.XY * right.YY),
            (left.YX * right.XY) + (left.YY * right.YY),
            (left.XX * right.DX) + (left.XY * right.DY) + left.DX,
            (left.YX * right.DX) + (left.YY * right.DY) + left.DY);

        private static bool Fail(out UiFontError error, UiFontErrorCode code, int offset, string message)
        {
            error = UiFontError.At(code, offset, message);
            return false;
        }
    }
}
