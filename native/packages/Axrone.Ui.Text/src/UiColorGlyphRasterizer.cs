namespace Axrone.Ui.Text;

public readonly ref struct UiColorGlyphBitmap
{
    private readonly ReadOnlySpan<byte> _pixels;

    public UiColorGlyphBitmap(
        int width,
        int height,
        int bearingX,
        int bearingY,
        float advance,
        ReadOnlySpan<byte> pixels)
    {
        Width = width;
        Height = height;
        BearingX = bearingX;
        BearingY = bearingY;
        Advance = advance;
        _pixels = pixels;
    }

    public int Width { get; }

    public int Height { get; }

    public int BearingX { get; }

    public int BearingY { get; }

    public float Advance { get; }

    public ReadOnlySpan<byte> Pixels => _pixels;

    public bool IsEmpty => Width <= 0 || Height <= 0;
}

public sealed class UiColorGlyphRasterizer
{
    private const int MaxPaintDepth = 64;
    private const int MaxCompositeDepth = 4;
    private const float MaxPixelSize = 4096.0f;

    private readonly UiFontProvider _provider;
    private readonly int _maxDimension;
    private readonly long _maxPixels;
    private readonly UiGlyphRasterizer _maskRasterizer;
    private byte[] _rgba = [];
    private readonly byte[][] _masks = new byte[MaxPaintDepth][];
    private readonly byte[][] _compositeSource = new byte[MaxCompositeDepth][];
    private readonly byte[][] _compositeBackdrop = new byte[MaxCompositeDepth][];
    private uint[] _stopColors = new uint[16];
    private float[] _stopOffsets = new float[16];
    private UiFontFace? _face;
    private UiColorPaintData? _graph;
    private float _scale;
    private float _pixelSize;
    private int _left;
    private int _bottom;
    private int _width;
    private int _height;
    private int _pixels;

    public UiColorGlyphRasterizer(UiFontProvider provider, int maxDimension = 512)
    {
        ArgumentNullException.ThrowIfNull(provider);
        if (maxDimension < 1 || maxDimension > 4096)
        {
            throw new ArgumentOutOfRangeException(nameof(maxDimension), "Raster dimension must be between 1 and 4096.");
        }

        _provider = provider;
        _maxDimension = maxDimension;
        _maxPixels = (long)maxDimension * maxDimension;
        _maskRasterizer = new UiGlyphRasterizer(provider, maxDimension);
    }

    public int PaletteIndex { get; set; }

    public uint ForegroundColor { get; set; } = 0xFFFFFFFFu;

    public bool TryRasterize(
        UiFontFaceId face,
        int codePoint,
        float pixelSize,
        out UiColorGlyphBitmap bitmap,
        out UiFontError failure)
    {
        bitmap = default;
        failure = UiFontError.None;
        if (!ValidatePixelSize(pixelSize, out failure) ||
            !_provider.TryGetFace(face, out UiFontFace? fontFace))
        {
            if (!failure.HasError)
            {
                failure = UiFontError.At(UiFontErrorCode.FaceNotFound, 0, "The face identity is not registered.");
            }

            return false;
        }

        if (!fontFace.TryGetGlyph(codePoint, out int glyphId))
        {
            failure = UiFontError.At(UiFontErrorCode.GlyphNotFound, 0, "The code point has no glyph in the face.");
            return false;
        }

        return RasterizeGlyphCore(fontFace, glyphId, pixelSize, out bitmap, out failure);
    }

    public bool TryRasterizeGlyph(
        UiFontFaceId face,
        int glyphId,
        float pixelSize,
        out UiColorGlyphBitmap bitmap,
        out UiFontError failure)
    {
        bitmap = default;
        failure = UiFontError.None;
        if (!ValidatePixelSize(pixelSize, out failure) ||
            !_provider.TryGetFace(face, out UiFontFace? fontFace))
        {
            if (!failure.HasError)
            {
                failure = UiFontError.At(UiFontErrorCode.FaceNotFound, 0, "The face identity is not registered.");
            }

            return false;
        }

        if ((uint)glyphId >= (uint)fontFace.GlyphCount)
        {
            failure = UiFontError.At(UiFontErrorCode.GlyphNotFound, 0, "The glyph id is outside the face.");
            return false;
        }

        return RasterizeGlyphCore(fontFace, glyphId, pixelSize, out bitmap, out failure);
    }

    private static bool ValidatePixelSize(float pixelSize, out UiFontError failure)
    {
        failure = UiFontError.None;
        if (!float.IsFinite(pixelSize) || pixelSize <= 0.0f || pixelSize > MaxPixelSize)
        {
            failure = UiFontError.At(UiFontErrorCode.InvalidPixelSize, 0, "Pixel size must be finite, positive and within the limit.");
            return false;
        }

        return true;
    }

    private bool RasterizeGlyphCore(
        UiFontFace face,
        int glyphId,
        float pixelSize,
        out UiColorGlyphBitmap bitmap,
        out UiFontError failure)
    {
        bitmap = default;
        failure = UiFontError.None;
        if (face.ColorPaintGraph is not { RootCount: > 0 } graph ||
            !graph.TryGetRoot(glyphId, out int root))
        {
            failure = UiFontError.At(
                UiFontErrorCode.UnsupportedColorFormat,
                0,
                "Color rasterization requires a COLR v1 paint graph for the glyph.");
            return false;
        }

        _face = face;
        _graph = graph;
        _scale = pixelSize / face.UnitsPerEm;
        _pixelSize = pixelSize;
        float advance = face.ReadAdvance(face.Buffer.Span, glyphId) * _scale;
        float minX = float.MaxValue;
        float minY = float.MaxValue;
        float maxX = float.MinValue;
        float maxY = float.MinValue;
        bool hasBounds = false;
        if (face.TryGetGlyphBounds(glyphId, out int baseMinX, out int baseMinY, out int baseMaxX, out int baseMaxY))
        {
            AddBounds(UiColorAffine.Identity, baseMinX, baseMinY, baseMaxX, baseMaxY, ref minX, ref minY, ref maxX, ref maxY);
            hasBounds = true;
        }

        if (!AccumulateBounds(root, UiColorAffine.Identity, 0, ref minX, ref minY, ref maxX, ref maxY, ref hasBounds, out failure))
        {
            return false;
        }

        if (!hasBounds)
        {
            bitmap = new UiColorGlyphBitmap(0, 0, 0, 0, advance, ReadOnlySpan<byte>.Empty);
            return true;
        }

        _left = (int)MathF.Floor(minX * _scale) - 1;
        int right = (int)MathF.Ceiling(maxX * _scale) + 1;
        _bottom = (int)MathF.Floor(minY * _scale) - 1;
        int top = (int)MathF.Ceiling(maxY * _scale) + 1;
        _width = right - _left;
        _height = top - _bottom;
        _pixels = _width * _height;
        if (_width <= 0 || _height <= 0)
        {
            bitmap = new UiColorGlyphBitmap(0, 0, 0, 0, advance, ReadOnlySpan<byte>.Empty);
            return true;
        }

        if (_width > _maxDimension || _height > _maxDimension || _pixels > _maxPixels)
        {
            failure = UiFontError.At(UiFontErrorCode.RasterTooLarge, 0, "The color raster dimensions exceed the limit.");
            return false;
        }

        EnsureCanvas();
        if (!RenderPaint(root, UiColorAffine.Identity, ReadOnlySpan<byte>.Empty, 0, 0, _rgba.AsSpan(0, _pixels * 4), out failure))
        {
            return false;
        }

        bitmap = new UiColorGlyphBitmap(_width, _height, _left, top, advance, _rgba.AsSpan(0, _pixels * 4));
        return true;
    }

    private bool AccumulateBounds(
        int nodeIndex,
        UiColorAffine affine,
        int depth,
        ref float minX,
        ref float minY,
        ref float maxX,
        ref float maxY,
        ref bool hasBounds,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (depth > MaxPaintDepth)
        {
            error = UiFontError.At(UiFontErrorCode.ResourceLimit, 0, "Color paint graph depth exceeds the limit.");
            return false;
        }

        if (_graph is null || !_graph.TryGetNode(nodeIndex, out UiColorPaintNode node))
        {
            error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "Color paint node is invalid.");
            return false;
        }

        switch (node.Kind)
        {
            case UiColorPaintKind.Glyph:
                if (_face!.TryGetGlyphBounds(node.GlyphId, out int xMin, out int yMin, out int xMax, out int yMax))
                {
                    AddBounds(affine, xMin, yMin, xMax, yMax, ref minX, ref minY, ref maxX, ref maxY);
                    hasBounds = true;
                }

                return true;
            case UiColorPaintKind.ColrGlyph:
                if (!_graph.TryGetChild(nodeIndex, 0, out int referenced))
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "COLR glyph paint has no referenced paint.");
                    return false;
                }

                return AccumulateBounds(referenced, affine, depth + 1, ref minX, ref minY, ref maxX, ref maxY, ref hasBounds, out error);
            case UiColorPaintKind.Transform:
                if (!_graph.TryGetChild(nodeIndex, 0, out int transformed))
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "COLR transform paint has no child.");
                    return false;
                }

                return AccumulateBounds(
                    transformed,
                    Compose(affine, node.Transform),
                    depth + 1,
                    ref minX,
                    ref minY,
                    ref maxX,
                    ref maxY,
                    ref hasBounds,
                    out error);
            case UiColorPaintKind.ColrLayers:
            case UiColorPaintKind.Composite:
                for (int i = 0; i < node.ChildCount; i++)
                {
                    if (!_graph.TryGetChild(nodeIndex, i, out int child) ||
                        !AccumulateBounds(child, affine, depth + 1, ref minX, ref minY, ref maxX, ref maxY, ref hasBounds, out error))
                    {
                        return false;
                    }
                }

                return true;
            default:
                return true;
        }
    }

    private bool RenderPaint(
        int nodeIndex,
        UiColorAffine affine,
        ReadOnlySpan<byte> mask,
        int depth,
        int compositeDepth,
        Span<byte> target,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (depth > MaxPaintDepth)
        {
            error = UiFontError.At(UiFontErrorCode.ResourceLimit, 0, "Color paint graph depth exceeds the limit.");
            return false;
        }

        if (_graph is null || _face is null || !_graph.TryGetNode(nodeIndex, out UiColorPaintNode node))
        {
            error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "Color paint node is invalid.");
            return false;
        }

        switch (node.Kind)
        {
            case UiColorPaintKind.Solid:
                if (!TryResolveColor(node.PaletteIndex, out uint color, out error))
                {
                    return false;
                }

                FillSolid(target, mask, color, node.Alpha);
                return true;
            case UiColorPaintKind.LinearGradient:
            case UiColorPaintKind.RadialGradient:
                return FillGradient(node, affine, mask, target, out error);
            case UiColorPaintKind.ColrLayers:
                for (int i = 0; i < node.ChildCount; i++)
                {
                    if (!_graph.TryGetChild(nodeIndex, i, out int child) ||
                        !RenderPaint(child, affine, mask, depth + 1, compositeDepth, target, out error))
                    {
                        return false;
                    }
                }

                return true;
            case UiColorPaintKind.Glyph:
                return RenderGlyph(nodeIndex, node, affine, mask, depth, compositeDepth, target, out error);
            case UiColorPaintKind.ColrGlyph:
                if (!_graph.TryGetChild(nodeIndex, 0, out int referenced))
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "COLR glyph paint has no referenced paint.");
                    return false;
                }

                return RenderPaint(referenced, affine, mask, depth + 1, compositeDepth, target, out error);
            case UiColorPaintKind.Transform:
                if (!_graph.TryGetChild(nodeIndex, 0, out int childTransform))
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "COLR transform paint has no child.");
                    return false;
                }

                return RenderPaint(
                    childTransform,
                    Compose(affine, node.Transform),
                    mask,
                    depth + 1,
                    compositeDepth,
                    target,
                    out error);
            case UiColorPaintKind.Composite:
                return RenderComposite(nodeIndex, node, affine, mask, depth, compositeDepth, target, out error);
            default:
                error = UiFontError.At(UiFontErrorCode.UnsupportedColorFormat, 0, "Color paint kind is not supported.");
                return false;
        }
    }

    private bool RenderGlyph(
        int nodeIndex,
        UiColorPaintNode node,
        UiColorAffine affine,
        ReadOnlySpan<byte> mask,
        int depth,
        int compositeDepth,
        Span<byte> target,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (depth >= MaxPaintDepth || !_graph!.TryGetChild(nodeIndex, 0, out int child))
        {
            error = UiFontError.At(UiFontErrorCode.ResourceLimit, 0, "Color glyph paint has no child.");
            return false;
        }

        byte[] glyphMask = GetMaskBuffer(depth);
        UiColorAffine pixelTransform = ToPixelTransform(affine);
        if (!_maskRasterizer.TryRasterizeColorMask(
                _face!,
                node.GlyphId,
                _pixelSize,
                pixelTransform,
                _width,
                _height,
                glyphMask,
                out error))
        {
            return false;
        }

        if (!mask.IsEmpty)
        {
            for (int i = 0; i < _pixels; i++)
            {
                glyphMask[i] = (byte)((glyphMask[i] * mask[i]) / 255);
            }
        }

        return RenderPaint(child, affine, glyphMask.AsSpan(0, _pixels), depth + 1, compositeDepth, target, out error);
    }

    private bool RenderComposite(
        int nodeIndex,
        UiColorPaintNode node,
        UiColorAffine affine,
        ReadOnlySpan<byte> mask,
        int depth,
        int compositeDepth,
        Span<byte> target,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (!IsCompositeModeSupported((UiColorCompositeMode)node.CompositeMode))
        {
            error = UiFontError.At(
                UiFontErrorCode.UnsupportedColorFormat,
                0,
                "Color composite mode is not supported.");
            return false;
        }

        if (compositeDepth >= MaxCompositeDepth ||
            !_graph!.TryGetChild(nodeIndex, 0, out int sourceNode) ||
            !_graph.TryGetChild(nodeIndex, 1, out int backdropNode))
        {
            error = UiFontError.At(UiFontErrorCode.ResourceLimit, 0, "Color composite nesting or children are invalid.");
            return false;
        }

        byte[] source = GetCompositeSource(compositeDepth);
        byte[] backdrop = GetCompositeBackdrop(compositeDepth);
        source.AsSpan(0, _pixels * 4).Clear();
        backdrop.AsSpan(0, _pixels * 4).Clear();
        if (!RenderPaint(sourceNode, affine, ReadOnlySpan<byte>.Empty, depth + 1, compositeDepth + 1, source, out error) ||
            !RenderPaint(backdropNode, affine, ReadOnlySpan<byte>.Empty, depth + 1, compositeDepth + 1, backdrop, out error))
        {
            return false;
        }

        MergeComposite((UiColorCompositeMode)node.CompositeMode, source, backdrop, mask, target);
        return true;
    }

    private void MergeComposite(
        UiColorCompositeMode mode,
        ReadOnlySpan<byte> source,
        ReadOnlySpan<byte> backdrop,
        ReadOnlySpan<byte> mask,
        Span<byte> target)
    {
        for (int pixel = 0; pixel < _pixels; pixel++)
        {
            int offset = pixel * 4;
            int maskValue = mask.IsEmpty ? 255 : mask[pixel];
            if (maskValue == 0)
            {
                continue;
            }

            int sourceAlpha = source[offset + 3];
            int backdropAlpha = backdrop[offset + 3];
            if (sourceAlpha == 0 && backdropAlpha == 0)
            {
                continue;
            }

            Blend(
                mode,
                source[offset],
                source[offset + 1],
                source[offset + 2],
                sourceAlpha,
                backdrop[offset],
                backdrop[offset + 1],
                backdrop[offset + 2],
                backdropAlpha,
                out int red,
                out int green,
                out int blue,
                out int alpha);
            alpha = (alpha * maskValue) / 255;
            red = (red * maskValue) / 255;
            green = (green * maskValue) / 255;
            blue = (blue * maskValue) / 255;
            BlendSourceOver(target, offset, red, green, blue, alpha);
        }
    }

    private static void Blend(
        UiColorCompositeMode mode,
        int sourceRed,
        int sourceGreen,
        int sourceBlue,
        int sourceAlpha,
        int backdropRed,
        int backdropGreen,
        int backdropBlue,
        int backdropAlpha,
        out int red,
        out int green,
        out int blue,
        out int alpha)
    {
        if (mode == UiColorCompositeMode.Source)
        {
            red = sourceRed;
            green = sourceGreen;
            blue = sourceBlue;
            alpha = sourceAlpha;
            return;
        }

        if (mode == UiColorCompositeMode.Destination)
        {
            red = backdropRed;
            green = backdropGreen;
            blue = backdropBlue;
            alpha = backdropAlpha;
            return;
        }

        if (mode == UiColorCompositeMode.SourceOver)
        {
            red = BlendSource(backdropRed, sourceRed, sourceAlpha);
            green = BlendSource(backdropGreen, sourceGreen, sourceAlpha);
            blue = BlendSource(backdropBlue, sourceBlue, sourceAlpha);
            alpha = sourceAlpha + (backdropAlpha * (255 - sourceAlpha) / 255);
            return;
        }

        if (mode == UiColorCompositeMode.Plus)
        {
            red = Math.Min(255, sourceRed + backdropRed);
            green = Math.Min(255, sourceGreen + backdropGreen);
            blue = Math.Min(255, sourceBlue + backdropBlue);
            alpha = Math.Min(255, sourceAlpha + backdropAlpha);
            return;
        }

        if (mode == UiColorCompositeMode.Screen)
        {
            red = Screen(sourceRed, backdropRed);
            green = Screen(sourceGreen, backdropGreen);
            blue = Screen(sourceBlue, backdropBlue);
            alpha = Screen(sourceAlpha, backdropAlpha);
            return;
        }

        int resultAlpha = sourceAlpha + backdropAlpha - ((sourceAlpha * backdropAlpha) / 255);
        if (resultAlpha == 0)
        {
            red = 0;
            green = 0;
            blue = 0;
            alpha = 0;
            return;
        }

        int sourceStraightRed = Straight(sourceRed, sourceAlpha);
        int sourceStraightGreen = Straight(sourceGreen, sourceAlpha);
        int sourceStraightBlue = Straight(sourceBlue, sourceAlpha);
        int backdropStraightRed = Straight(backdropRed, backdropAlpha);
        int backdropStraightGreen = Straight(backdropGreen, backdropAlpha);
        int backdropStraightBlue = Straight(backdropBlue, backdropAlpha);
        int blendedRed;
        int blendedGreen;
        int blendedBlue;
        if (mode == UiColorCompositeMode.Multiply)
        {
            blendedRed = (sourceStraightRed * backdropStraightRed) / 255;
            blendedGreen = (sourceStraightGreen * backdropStraightGreen) / 255;
            blendedBlue = (sourceStraightBlue * backdropStraightBlue) / 255;
        }
        else if (mode == UiColorCompositeMode.Darken)
        {
            blendedRed = Math.Min(sourceStraightRed, backdropStraightRed);
            blendedGreen = Math.Min(sourceStraightGreen, backdropStraightGreen);
            blendedBlue = Math.Min(sourceStraightBlue, backdropStraightBlue);
        }
        else
        {
            blendedRed = Math.Max(sourceStraightRed, backdropStraightRed);
            blendedGreen = Math.Max(sourceStraightGreen, backdropStraightGreen);
            blendedBlue = Math.Max(sourceStraightBlue, backdropStraightBlue);
        }

        int inverseBackdrop = 255 - backdropAlpha;
        int inverseSource = 255 - sourceAlpha;
        red = (sourceRed * inverseBackdrop / 255) + (backdropRed * inverseSource / 255) + (blendedRed * sourceAlpha * backdropAlpha / 65025);
        green = (sourceGreen * inverseBackdrop / 255) + (backdropGreen * inverseSource / 255) + (blendedGreen * sourceAlpha * backdropAlpha / 65025);
        blue = (sourceBlue * inverseBackdrop / 255) + (backdropBlue * inverseSource / 255) + (blendedBlue * sourceAlpha * backdropAlpha / 65025);
        alpha = resultAlpha;
    }

    private void FillSolid(Span<byte> target, ReadOnlySpan<byte> mask, uint color, float alpha)
    {
        int colorAlpha = (int)(((color >> 24) & 0xFF) * alpha + 0.5f);
        int red = (int)((color >> 16) & 0xFF);
        int green = (int)((color >> 8) & 0xFF);
        int blue = (int)(color & 0xFF);
        for (int pixel = 0; pixel < _pixels; pixel++)
        {
            int maskValue = mask.IsEmpty ? 255 : mask[pixel];
            int value = (colorAlpha * maskValue) / 255;
            if (value == 0)
            {
                continue;
            }

            int offset = pixel * 4;
            BlendSourceOver(
                target,
                offset,
                (red * value) / 255,
                (green * value) / 255,
                (blue * value) / 255,
                value);
        }
    }

    private bool FillGradient(
        UiColorPaintNode node,
        UiColorAffine affine,
        ReadOnlySpan<byte> mask,
        Span<byte> target,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (_graph is null || !_graph.TryGetGradient(node.GradientIndex, out UiColorGradientRecord gradient))
        {
            error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "Color gradient record is invalid.");
            return false;
        }

        int stopCount = gradient.StopCount;
        if (stopCount <= 0)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "Color gradient has no stops.");
            return false;
        }

        if (_stopColors.Length < stopCount)
        {
            _stopColors = new uint[stopCount];
            _stopOffsets = new float[stopCount];
        }

        for (int i = 0; i < stopCount; i++)
        {
            if (!_graph.TryGetStop(node.GradientIndex, i, out UiColorGradientStop stop) ||
                !TryResolveColor(stop.PaletteIndex, out uint color, out error))
            {
                if (!error.HasError)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "Color gradient stop is invalid.");
                }

                return false;
            }

            int alpha = (int)(((color >> 24) & 0xFF) * stop.Alpha + 0.5f);
            _stopColors[i] = ((uint)alpha << 24) | (color & 0x00FFFFFFu);
            _stopOffsets[i] = stop.Offset;
        }

        if (!TryInvert(ToPixelTransform(affine), out UiColorAffine inverse))
        {
            error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "Color gradient transform is singular.");
            return false;
        }

        for (int row = 0; row < _height; row++)
        {
            float pixelY = row + 0.5f;
            int rowOffset = row * _width;
            for (int column = 0; column < _width; column++)
            {
                float pixelX = column + 0.5f;
                float x = (inverse.XX * pixelX) + (inverse.XY * pixelY) + inverse.DX;
                float y = (inverse.YX * pixelX) + (inverse.YY * pixelY) + inverse.DY;
                float t = gradient.Kind == UiColorPaintKind.LinearGradient
                    ? LinearGradientPosition(gradient, x, y)
                    : RadialGradientPosition(gradient, x, y);
                t = ApplyExtend(t, gradient.Extend);
                InterpolateStop(stopCount, t, out int red, out int green, out int blue, out int alpha);
                int maskValue = mask.IsEmpty ? 255 : mask[rowOffset + column];
                int value = (int)((alpha * node.Alpha * maskValue) / 255.0f + 0.5f);
                if (value == 0)
                {
                    continue;
                }

                BlendSourceOver(
                    target,
                    (rowOffset + column) * 4,
                    (red * value) / 255,
                    (green * value) / 255,
                    (blue * value) / 255,
                    value);
            }
        }

        return true;
    }

    private static float LinearGradientPosition(in UiColorGradientRecord gradient, float x, float y)
    {
        float dx = gradient.X1 - gradient.X0;
        float dy = gradient.Y1 - gradient.Y0;
        float lengthSquared = (dx * dx) + (dy * dy);
        if (lengthSquared <= 0.0f)
        {
            return 0.0f;
        }

        return (((x - gradient.X0) * dx) + ((y - gradient.Y0) * dy)) / lengthSquared;
    }

    private static float RadialGradientPosition(in UiColorGradientRecord gradient, float x, float y)
    {
        float dx = x - gradient.X0;
        float dy = y - gradient.Y0;
        float radius = MathF.Sqrt((dx * dx) + (dy * dy));
        float span = gradient.R1 - gradient.R0;
        return span <= 0.0f ? 0.0f : (radius - gradient.R0) / span;
    }

    private static float ApplyExtend(float value, UiColorExtendMode extend)
    {
        if (extend == UiColorExtendMode.Pad)
        {
            return Math.Clamp(value, 0.0f, 1.0f);
        }

        if (extend == UiColorExtendMode.Repeat)
        {
            value -= MathF.Floor(value);
            return value;
        }

        float period = value - (MathF.Floor(value / 2.0f) * 2.0f);
        return period > 1.0f ? 2.0f - period : period;
    }

    private void InterpolateStop(int count, float position, out int red, out int green, out int blue, out int alpha)
    {
        if (position <= _stopOffsets[0])
        {
            Unpack(_stopColors[0], out red, out green, out blue, out alpha);
            return;
        }

        int last = count - 1;
        if (position >= _stopOffsets[last])
        {
            Unpack(_stopColors[last], out red, out green, out blue, out alpha);
            return;
        }

        for (int i = 0; i < last; i++)
        {
            float start = _stopOffsets[i];
            float end = _stopOffsets[i + 1];
            if (position <= end)
            {
                float weight = end > start ? (position - start) / (end - start) : 1.0f;
                Unpack(_stopColors[i], out int r0, out int g0, out int b0, out int a0);
                Unpack(_stopColors[i + 1], out int r1, out int g1, out int b1, out int a1);
                red = r0 + (int)(((r1 - r0) * weight) + 0.5f);
                green = g0 + (int)(((g1 - g0) * weight) + 0.5f);
                blue = b0 + (int)(((b1 - b0) * weight) + 0.5f);
                alpha = a0 + (int)(((a1 - a0) * weight) + 0.5f);
                return;
            }
        }

        Unpack(_stopColors[last], out red, out green, out blue, out alpha);
    }

    private bool TryResolveColor(int paletteEntry, out uint color, out UiFontError error)
    {
        error = UiFontError.None;
        if (paletteEntry < 0)
        {
            color = ForegroundColor;
            return true;
        }

        if (_face!.TryGetColor(PaletteIndex, paletteEntry, out color))
        {
            return true;
        }

        error = UiFontError.At(UiFontErrorCode.InvalidColor, 0, "Color palette entry is invalid.");
        return false;
    }

    private UiColorAffine ToPixelTransform(in UiColorAffine affine) => new(
        affine.XX * _scale,
        affine.YX * _scale,
        affine.XY * _scale,
        affine.YY * _scale,
        (affine.DX * _scale) - _left,
        (affine.DY * _scale) - _bottom);

    private static UiColorAffine Compose(in UiColorAffine left, in UiColorAffine right) => new(
        (left.XX * right.XX) + (left.XY * right.YX),
        (left.YX * right.XX) + (left.YY * right.YX),
        (left.XX * right.XY) + (left.XY * right.YY),
        (left.YX * right.XY) + (left.YY * right.YY),
        (left.XX * right.DX) + (left.XY * right.DY) + left.DX,
        (left.YX * right.DX) + (left.YY * right.DY) + left.DY);

    private static bool TryInvert(in UiColorAffine affine, out UiColorAffine inverse)
    {
        float determinant = (affine.XX * affine.YY) - (affine.XY * affine.YX);
        if (MathF.Abs(determinant) < 0.000001f)
        {
            inverse = default;
            return false;
        }

        float inverseDeterminant = 1.0f / determinant;
        inverse = new UiColorAffine(
            affine.YY * inverseDeterminant,
            -affine.YX * inverseDeterminant,
            -affine.XY * inverseDeterminant,
            affine.XX * inverseDeterminant,
            -((affine.YY * affine.DX) - (affine.XY * affine.DY)) * inverseDeterminant,
            ((affine.YX * affine.DX) - (affine.XX * affine.DY)) * inverseDeterminant);
        return true;
    }

    private static bool IsCompositeModeSupported(UiColorCompositeMode mode) =>
        mode is UiColorCompositeMode.Source or
            UiColorCompositeMode.Destination or
            UiColorCompositeMode.SourceOver or
            UiColorCompositeMode.Plus or
            UiColorCompositeMode.Screen or
            UiColorCompositeMode.Multiply or
            UiColorCompositeMode.Darken or
            UiColorCompositeMode.Lighten;

    private static void AddBounds(
        in UiColorAffine affine,
        int xMin,
        int yMin,
        int xMax,
        int yMax,
        ref float minX,
        ref float minY,
        ref float maxX,
        ref float maxY)
    {
        AddPoint(affine, xMin, yMin, ref minX, ref minY, ref maxX, ref maxY);
        AddPoint(affine, xMax, yMin, ref minX, ref minY, ref maxX, ref maxY);
        AddPoint(affine, xMin, yMax, ref minX, ref minY, ref maxX, ref maxY);
        AddPoint(affine, xMax, yMax, ref minX, ref minY, ref maxX, ref maxY);
    }

    private static void AddPoint(
        in UiColorAffine affine,
        float x,
        float y,
        ref float minX,
        ref float minY,
        ref float maxX,
        ref float maxY)
    {
        float px = (affine.XX * x) + (affine.XY * y) + affine.DX;
        float py = (affine.YX * x) + (affine.YY * y) + affine.DY;
        minX = MathF.Min(minX, px);
        minY = MathF.Min(minY, py);
        maxX = MathF.Max(maxX, px);
        maxY = MathF.Max(maxY, py);
    }

    private static void BlendSourceOver(Span<byte> target, int offset, int red, int green, int blue, int alpha)
    {
        int inverse = 255 - alpha;
        target[offset] = (byte)Math.Min(255, red + (target[offset] * inverse / 255));
        target[offset + 1] = (byte)Math.Min(255, green + (target[offset + 1] * inverse / 255));
        target[offset + 2] = (byte)Math.Min(255, blue + (target[offset + 2] * inverse / 255));
        target[offset + 3] = (byte)Math.Min(255, alpha + (target[offset + 3] * inverse / 255));
    }

    private static int BlendSource(int backdrop, int source, int backdropAlpha) =>
        source + (backdrop * (255 - backdropAlpha) / 255);

    private static int Screen(int source, int backdrop) =>
        source + backdrop - ((source * backdrop) / 255);

    private static int Straight(int premultiplied, int alpha) =>
        alpha == 0 ? 0 : Math.Min(255, (premultiplied * 255) / alpha);

    private static void Unpack(uint color, out int red, out int green, out int blue, out int alpha)
    {
        alpha = (int)((color >> 24) & 0xFF);
        red = (int)((color >> 16) & 0xFF);
        green = (int)((color >> 8) & 0xFF);
        blue = (int)(color & 0xFF);
    }

    private void EnsureCanvas()
    {
        int bytes = _pixels * 4;
        if (_rgba.Length < bytes)
        {
            _rgba = GC.AllocateArray<byte>(bytes, pinned: true);
        }

        _rgba.AsSpan(0, bytes).Clear();
    }

    private byte[] GetMaskBuffer(int depth)
    {
        byte[]? buffer = _masks[depth];
        if (buffer is null || buffer.Length < _pixels)
        {
            buffer = GC.AllocateArray<byte>(_pixels, pinned: true);
            _masks[depth] = buffer;
        }

        return buffer;
    }

    private byte[] GetCompositeSource(int depth)
    {
        byte[]? buffer = _compositeSource[depth];
        if (buffer is null || buffer.Length < _pixels * 4)
        {
            buffer = GC.AllocateArray<byte>(_pixels * 4, pinned: true);
            _compositeSource[depth] = buffer;
        }

        return buffer;
    }

    private byte[] GetCompositeBackdrop(int depth)
    {
        byte[]? buffer = _compositeBackdrop[depth];
        if (buffer is null || buffer.Length < _pixels * 4)
        {
            buffer = GC.AllocateArray<byte>(_pixels * 4, pinned: true);
            _compositeBackdrop[depth] = buffer;
        }

        return buffer;
    }
}
