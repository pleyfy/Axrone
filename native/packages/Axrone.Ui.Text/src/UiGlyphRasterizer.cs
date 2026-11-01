namespace Axrone.Ui.Text;

public sealed class UiGlyphRasterizer : IUiGlyphRasterizer
{
    private const int MaxPoints = 8192;
    private const int MaxContours = 512;
    private const int MaxEdges = 16_384;
    private const int MaxCompositeDepth = 8;
    private const float MaxPixelSize = 4096.0f;
    private const int QuadSubdivisions = 8;
    private const float SubRowWeight = 0.25f;

    private readonly UiFontProvider _provider;
    private readonly int _maxDimension;
    private readonly long _maxPixels;

    private float[] _pointX = new float[256];
    private float[] _pointY = new float[256];
    private bool[] _onCurve = new bool[256];
    private float[] _rawX = new float[256];
    private float[] _rawY = new float[256];
    private byte[] _flags = new byte[256];
    private int[] _endPoints = new int[16];
    private int[] _contourEnds = new int[16];
    private float[] _edgeX0 = new float[512];
    private float[] _edgeY0 = new float[512];
    private float[] _edgeX1 = new float[512];
    private float[] _edgeY1 = new float[512];
    private float[] _hitX = new float[512];
    private sbyte[] _hitDirection = new sbyte[512];
    private float[] _coverage = [];
    private byte[] _alpha = [];

    private int _pointCount;
    private int _contourCount;
    private int _edgeCount;

    public UiGlyphRasterizer(UiFontProvider provider, int maxDimension = 512)
    {
        ArgumentNullException.ThrowIfNull(provider);
        if (maxDimension < 1 || maxDimension > 4096)
        {
            throw new ArgumentOutOfRangeException(nameof(maxDimension), "Raster dimension must be between 1 and 4096.");
        }

        _provider = provider;
        _maxDimension = maxDimension;
        _maxPixels = (long)maxDimension * maxDimension;
    }

    public bool TryRasterize(
        UiFontFaceId face,
        int codePoint,
        float pixelSize,
        out UiGlyphBitmap bitmap,
        out UiFontError failure)
    {
        bitmap = default;
        failure = UiFontError.None;
        if (!float.IsFinite(pixelSize) || pixelSize <= 0.0f || pixelSize > MaxPixelSize)
        {
            failure = UiFontError.At(UiFontErrorCode.InvalidPixelSize, 0, "Pixel size must be finite, positive and within the limit.");
            return false;
        }

        if (!_provider.TryGetFace(face, out UiFontFace? fontFace))
        {
            failure = UiFontError.At(UiFontErrorCode.FaceNotFound, 0, "The face identity is not registered.");
            return false;
        }

        if (fontFace.OutlineFormat != UiFontOutlineFormat.TrueType)
        {
            failure = UiFontError.At(UiFontErrorCode.UnsupportedOutlineFormat, 0, "Only TrueType glyf outlines can be rasterized.");
            return false;
        }

        if (!fontFace.TryGetGlyph(codePoint, out int glyphId))
        {
            failure = UiFontError.At(UiFontErrorCode.GlyphNotFound, 0, "The code point has no glyph in the face.");
            return false;
        }

        if (!fontFace.TryGetGlyphRange(glyphId, out int glyphOffset, out int glyphLength))
        {
            failure = UiFontError.At(UiFontErrorCode.InvalidGlyph, glyphOffset, "The glyph range is invalid.");
            return false;
        }

        ReadOnlySpan<byte> data = fontFace.Buffer.Span;
        float scale = pixelSize / fontFace.UnitsPerEm;
        float advance = fontFace.ReadAdvance(data, glyphId) * scale;
        if (glyphLength < 10)
        {
            bitmap = new UiGlyphBitmap(0, 0, 0, 0, advance, ReadOnlySpan<byte>.Empty);
            return true;
        }

        int xMin = UiFontFace.ReadI16(data, glyphOffset + 2);
        int yMin = UiFontFace.ReadI16(data, glyphOffset + 4);
        int xMax = UiFontFace.ReadI16(data, glyphOffset + 6);
        int yMax = UiFontFace.ReadI16(data, glyphOffset + 8);
        if (xMax <= xMin || yMax <= yMin)
        {
            bitmap = new UiGlyphBitmap(0, 0, 0, 0, advance, ReadOnlySpan<byte>.Empty);
            return true;
        }

        int left = (int)MathF.Floor(xMin * scale) - 1;
        int right = (int)MathF.Ceiling(xMax * scale) + 1;
        int bottom = (int)MathF.Floor(yMin * scale) - 1;
        int top = (int)MathF.Ceiling(yMax * scale) + 1;
        int width = right - left;
        int height = top - bottom;
        if (width <= 0 || height <= 0)
        {
            bitmap = new UiGlyphBitmap(0, 0, 0, 0, advance, ReadOnlySpan<byte>.Empty);
            return true;
        }

        if (width > _maxDimension || height > _maxDimension || (long)width * height > _maxPixels)
        {
            failure = UiFontError.At(UiFontErrorCode.RasterTooLarge, 0, "The raster dimensions exceed the limit.");
            return false;
        }

        _pointCount = 0;
        _contourCount = 0;
        _edgeCount = 0;

        if (!TryAppendGlyph(fontFace, glyphId, 1.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0, out failure))
        {
            return false;
        }

        if (!Flatten(scale, left, bottom, out failure))
        {
            return false;
        }

        int pixels = width * height;
        EnsureCoverage(pixels);
        EnsureHitCapacity(_edgeCount);
        _coverage.AsSpan(0, pixels).Clear();
        RasterizeEdges(width, height);
        FillAlpha(width, height);
        bitmap = new UiGlyphBitmap(width, height, left, top, advance, _alpha.AsSpan(0, pixels));
        return true;
    }

    private bool TryAppendGlyph(
        UiFontFace face,
        int glyphId,
        float a,
        float b,
        float c,
        float d,
        float dx,
        float dy,
        int depth,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (depth > MaxCompositeDepth)
        {
            error = UiFontError.At(UiFontErrorCode.UnsupportedGlyph, 0, "Composite glyph nesting exceeds the limit.");
            return false;
        }

        if (!face.TryGetGlyphRange(glyphId, out int offset, out int length) || length < 10)
        {
            return true;
        }

        ReadOnlySpan<byte> data = face.Buffer.Span;
        int contours = UiFontFace.ReadI16(data, offset);
        return contours >= 0
            ? TryAppendSimple(face, offset, length, contours, a, b, c, d, dx, dy, out error)
            : TryAppendComposite(face, offset, length, a, b, c, d, dx, dy, depth, out error);
    }

    private bool TryAppendSimple(
        UiFontFace face,
        int offset,
        int length,
        int contours,
        float a,
        float b,
        float c,
        float d,
        float dx,
        float dy,
        out UiFontError error)
    {
        error = UiFontError.None;
        if (contours > MaxContours)
        {
            error = UiFontError.At(UiFontErrorCode.OutlineTooComplex, offset, "Contour count exceeds the limit.");
            return false;
        }

        if (contours == 0)
        {
            return true;
        }

        ReadOnlySpan<byte> data = face.Buffer.Span;
        int end = offset + length;
        int cursor = offset + 10;
        EnsureEndPointCapacity(Math.Max(contours, 1));

        int pointCount = 0;
        int previousEnd = -1;
        for (int i = 0; i < contours; i++)
        {
            if (cursor + 2 > end)
            {
                error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Contour end points are truncated.");
                return false;
            }

            int endPoint = UiFontFace.ReadU16(data, cursor);
            cursor += 2;
            if (endPoint <= previousEnd)
            {
                error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Contour end points are not increasing.");
                return false;
            }

            previousEnd = endPoint;
            pointCount = endPoint + 1;
            _endPoints[i] = endPoint;
        }

        if (pointCount <= 0 || pointCount > MaxPoints)
        {
            error = UiFontError.At(UiFontErrorCode.OutlineTooComplex, offset, "Point count exceeds the limit.");
            return false;
        }

        if (cursor + 2 > end)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Instruction length is truncated.");
            return false;
        }

        int instructionLength = UiFontFace.ReadU16(data, cursor);
        cursor += 2 + instructionLength;
        if (cursor > end)
        {
            error = UiFontError.At(UiFontErrorCode.InvalidGlyph, offset, "Glyph instructions exceed the glyph record.");
            return false;
        }

        EnsureRawCapacity(pointCount);
        int read = 0;
        while (read < pointCount)
        {
            if (cursor >= end)
            {
                error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Glyph flags are truncated.");
                return false;
            }

            byte flag = data[cursor++];
            _flags[read++] = flag;
            if ((flag & 0x08) != 0)
            {
                if (cursor >= end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Glyph flag repeat is truncated.");
                    return false;
                }

                int repeat = data[cursor++];
                if (read + repeat > pointCount)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Glyph flag repeat exceeds the point count.");
                    return false;
                }

                for (int r = 0; r < repeat; r++)
                {
                    _flags[read++] = flag;
                }
            }
        }

        int x = 0;
        for (int i = 0; i < pointCount; i++)
        {
            byte flag = _flags[i];
            if ((flag & 0x02) != 0)
            {
                if (cursor >= end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Glyph x coordinates are truncated.");
                    return false;
                }

                int delta = data[cursor++];
                x += (flag & 0x10) != 0 ? delta : -delta;
            }
            else if ((flag & 0x10) == 0)
            {
                if (cursor + 2 > end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Glyph x coordinates are truncated.");
                    return false;
                }

                x += UiFontFace.ReadI16(data, cursor);
                cursor += 2;
            }

            _rawX[i] = x;
        }

        int y = 0;
        for (int i = 0; i < pointCount; i++)
        {
            byte flag = _flags[i];
            if ((flag & 0x04) != 0)
            {
                if (cursor >= end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Glyph y coordinates are truncated.");
                    return false;
                }

                int delta = data[cursor++];
                y += (flag & 0x20) != 0 ? delta : -delta;
            }
            else if ((flag & 0x20) == 0)
            {
                if (cursor + 2 > end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Glyph y coordinates are truncated.");
                    return false;
                }

                y += UiFontFace.ReadI16(data, cursor);
                cursor += 2;
            }

            _rawY[i] = y;
        }

        EnsurePointCapacity(_pointCount + pointCount);
        EnsureContourCapacity(_contourCount + contours);
        int baseIndex = _pointCount;
        for (int i = 0; i < pointCount; i++)
        {
            float fx = _rawX[i];
            float fy = _rawY[i];
            _pointX[baseIndex + i] = (a * fx) + (c * fy) + dx;
            _pointY[baseIndex + i] = (b * fx) + (d * fy) + dy;
            _onCurve[baseIndex + i] = (_flags[i] & 0x01) != 0;
        }

        _pointCount += pointCount;
        for (int i = 0; i < contours; i++)
        {
            _contourEnds[_contourCount++] = baseIndex + _endPoints[i];
        }

        return true;
    }

    private bool TryAppendComposite(
        UiFontFace face,
        int offset,
        int length,
        float a,
        float b,
        float c,
        float d,
        float dx,
        float dy,
        int depth,
        out UiFontError error)
    {
        error = UiFontError.None;
        ReadOnlySpan<byte> data = face.Buffer.Span;
        int end = offset + length;
        int cursor = offset + 10;
        while (true)
        {
            if (cursor + 4 > end)
            {
                error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Composite component header is truncated.");
                return false;
            }

            int flags = UiFontFace.ReadU16(data, cursor);
            int child = UiFontFace.ReadU16(data, cursor + 2);
            cursor += 4;

            int arg1;
            int arg2;
            if ((flags & 0x0001) != 0)
            {
                if (cursor + 4 > end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Composite arguments are truncated.");
                    return false;
                }

                arg1 = UiFontFace.ReadI16(data, cursor);
                arg2 = UiFontFace.ReadI16(data, cursor + 2);
                cursor += 4;
            }
            else
            {
                if (cursor + 2 > end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Composite arguments are truncated.");
                    return false;
                }

                arg1 = (sbyte)data[cursor];
                arg2 = (sbyte)data[cursor + 1];
                cursor += 2;
            }

            if ((flags & 0x0002) == 0)
            {
                error = UiFontError.At(UiFontErrorCode.UnsupportedGlyph, cursor, "Point-matched composite components are not supported.");
                return false;
            }

            float ca = 1.0f;
            float cb = 0.0f;
            float cc = 0.0f;
            float cd = 1.0f;
            if ((flags & 0x0008) != 0)
            {
                if (cursor + 2 > end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Composite scale is truncated.");
                    return false;
                }

                float scale = F2Dot14(UiFontFace.ReadI16(data, cursor));
                cursor += 2;
                ca = scale;
                cd = scale;
            }
            else if ((flags & 0x0040) != 0)
            {
                if (cursor + 4 > end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Composite scale is truncated.");
                    return false;
                }

                ca = F2Dot14(UiFontFace.ReadI16(data, cursor));
                cd = F2Dot14(UiFontFace.ReadI16(data, cursor + 2));
                cursor += 4;
            }
            else if ((flags & 0x0080) != 0)
            {
                if (cursor + 8 > end)
                {
                    error = UiFontError.At(UiFontErrorCode.InvalidGlyph, cursor, "Composite transform is truncated.");
                    return false;
                }

                ca = F2Dot14(UiFontFace.ReadI16(data, cursor));
                cb = F2Dot14(UiFontFace.ReadI16(data, cursor + 2));
                cc = F2Dot14(UiFontFace.ReadI16(data, cursor + 4));
                cd = F2Dot14(UiFontFace.ReadI16(data, cursor + 6));
                cursor += 8;
            }

            float na = (a * ca) + (c * cb);
            float nb = (b * ca) + (d * cb);
            float nc = (a * cc) + (c * cd);
            float nd = (b * cc) + (d * cd);
            float ndx = (a * arg1) + (c * arg2) + dx;
            float ndy = (b * arg1) + (d * arg2) + dy;
            if (!TryAppendGlyph(face, child, na, nb, nc, nd, ndx, ndy, depth + 1, out error))
            {
                return false;
            }

            if ((flags & 0x0020) == 0)
            {
                return true;
            }
        }
    }

    private bool Flatten(float scale, int left, int bottom, out UiFontError error)
    {
        error = UiFontError.None;
        int start = 0;
        for (int contour = 0; contour < _contourCount; contour++)
        {
            int end = _contourEnds[contour] + 1;
            if (end <= start)
            {
                start = end;
                continue;
            }

            int firstOn = -1;
            for (int i = start; i < end; i++)
            {
                if (_onCurve[i])
                {
                    firstOn = i;
                    break;
                }
            }

            float startX;
            float startY;
            int sequenceStart;
            int sequenceCount;
            if (firstOn >= 0)
            {
                startX = _pointX[firstOn];
                startY = _pointY[firstOn];
                sequenceStart = firstOn + 1;
                sequenceCount = end - start - 1;
            }
            else
            {
                startX = (_pointX[start] + _pointX[end - 1]) * 0.5f;
                startY = (_pointY[start] + _pointY[end - 1]) * 0.5f;
                sequenceStart = start;
                sequenceCount = end - start;
            }

            float previousX = startX;
            float previousY = startY;
            bool hasControl = false;
            float controlX = 0.0f;
            float controlY = 0.0f;

            for (int n = 0; n < sequenceCount; n++)
            {
                int index = sequenceStart + n;
                if (index >= end)
                {
                    index = start + (index - end);
                }

                float pointX = _pointX[index];
                float pointY = _pointY[index];
                if (_onCurve[index])
                {
                    if (hasControl)
                    {
                        if (!AppendQuad(previousX, previousY, controlX, controlY, pointX, pointY, scale, left, bottom, out error))
                        {
                            return false;
                        }

                        hasControl = false;
                    }
                    else if (!AppendLine(previousX, previousY, pointX, pointY, scale, left, bottom, out error))
                    {
                        return false;
                    }

                    previousX = pointX;
                    previousY = pointY;
                }
                else
                {
                    if (hasControl)
                    {
                        float midX = (controlX + pointX) * 0.5f;
                        float midY = (controlY + pointY) * 0.5f;
                        if (!AppendQuad(previousX, previousY, controlX, controlY, midX, midY, scale, left, bottom, out error))
                        {
                            return false;
                        }

                        previousX = midX;
                        previousY = midY;
                    }

                    controlX = pointX;
                    controlY = pointY;
                    hasControl = true;
                }
            }

            if (hasControl)
            {
                if (!AppendQuad(previousX, previousY, controlX, controlY, startX, startY, scale, left, bottom, out error))
                {
                    return false;
                }
            }
            else if (!AppendLine(previousX, previousY, startX, startY, scale, left, bottom, out error))
            {
                return false;
            }

            start = end;
        }

        return true;
    }

    private bool AppendQuad(
        float x0,
        float y0,
        float cx,
        float cy,
        float x1,
        float y1,
        float scale,
        int left,
        int bottom,
        out UiFontError error)
    {
        error = UiFontError.None;
        float previousX = x0;
        float previousY = y0;
        for (int i = 1; i <= QuadSubdivisions; i++)
        {
            float t = i / (float)QuadSubdivisions;
            float inv = 1.0f - t;
            float x = (inv * inv * x0) + (2.0f * inv * t * cx) + (t * t * x1);
            float y = (inv * inv * y0) + (2.0f * inv * t * cy) + (t * t * y1);
            if (!AppendLine(previousX, previousY, x, y, scale, left, bottom, out error))
            {
                return false;
            }

            previousX = x;
            previousY = y;
        }

        return true;
    }

    private bool AppendLine(
        float x0,
        float y0,
        float x1,
        float y1,
        float scale,
        int left,
        int bottom,
        out UiFontError error)
    {
        error = UiFontError.None;
        float px0 = (x0 * scale) - left;
        float py0 = (y0 * scale) - bottom;
        float px1 = (x1 * scale) - left;
        float py1 = (y1 * scale) - bottom;
        if (MathF.Abs(px0 - px1) < 1e-5f && MathF.Abs(py0 - py1) < 1e-5f)
        {
            return true;
        }

        if (_edgeCount >= MaxEdges)
        {
            error = UiFontError.At(UiFontErrorCode.OutlineTooComplex, 0, "The flattened outline exceeds the edge limit.");
            return false;
        }

        EnsureEdgeCapacity(_edgeCount + 1);
        _edgeX0[_edgeCount] = px0;
        _edgeY0[_edgeCount] = py0;
        _edgeX1[_edgeCount] = px1;
        _edgeY1[_edgeCount] = py1;
        _edgeCount++;
        return true;
    }

    private void RasterizeEdges(int width, int height)
    {
        for (int row = 0; row < height; row++)
        {
            for (int sub = 0; sub < 4; sub++)
            {
                float sampleY = row + ((sub + 0.5f) * SubRowWeight);
                int hits = 0;
                for (int edge = 0; edge < _edgeCount; edge++)
                {
                    float y0 = _edgeY0[edge];
                    float y1 = _edgeY1[edge];
                    if (!((y0 <= sampleY && sampleY < y1) || (y1 <= sampleY && sampleY < y0)))
                    {
                        continue;
                    }

                    float t = (sampleY - y0) / (y1 - y0);
                    _hitX[hits] = _edgeX0[edge] + (t * (_edgeX1[edge] - _edgeX0[edge]));
                    _hitDirection[hits] = (sbyte)(y1 > y0 ? 1 : -1);
                    hits++;
                }

                for (int i = 1; i < hits; i++)
                {
                    float x = _hitX[i];
                    sbyte direction = _hitDirection[i];
                    int j = i - 1;
                    while (j >= 0 && _hitX[j] > x)
                    {
                        _hitX[j + 1] = _hitX[j];
                        _hitDirection[j + 1] = _hitDirection[j];
                        j--;
                    }

                    _hitX[j + 1] = x;
                    _hitDirection[j + 1] = direction;
                }

                int winding = 0;
                float spanStart = 0.0f;
                for (int i = 0; i < hits; i++)
                {
                    if (winding == 0)
                    {
                        spanStart = _hitX[i];
                    }

                    winding += _hitDirection[i];
                    if (winding == 0)
                    {
                        AddSpan(row, width, spanStart, _hitX[i]);
                    }
                }
            }
        }
    }

    private void AddSpan(int row, int width, float start, float end)
    {
        if (end <= start)
        {
            return;
        }

        float x0 = MathF.Max(0.0f, start);
        float x1 = MathF.Min(width, end);
        if (x1 <= x0)
        {
            return;
        }

        int firstColumn = (int)MathF.Floor(x0);
        int lastColumn = (int)MathF.Ceiling(x1);
        int rowOffset = row * width;
        for (int column = firstColumn; column < lastColumn; column++)
        {
            float left = MathF.Max(x0, column);
            float right = MathF.Min(x1, column + 1);
            if (right > left)
            {
                _coverage[rowOffset + column] += (right - left) * SubRowWeight;
            }
        }
    }

    private void FillAlpha(int width, int height)
    {
        for (int row = 0; row < height; row++)
        {
            int source = row * width;
            int target = (height - 1 - row) * width;
            for (int column = 0; column < width; column++)
            {
                float coverage = _coverage[source + column];
                int alpha = (int)((coverage * 255.0f) + 0.5f);
                _alpha[target + column] = (byte)Math.Clamp(alpha, 0, 255);
            }
        }
    }

    private static float F2Dot14(short value) => value / 16384.0f;

    private void EnsureCoverage(int pixels)
    {
        if (_coverage.Length >= pixels)
        {
            return;
        }

        _coverage = GC.AllocateArray<float>(pixels, pinned: true);
        _alpha = GC.AllocateArray<byte>(pixels, pinned: true);
    }

    private void EnsureHitCapacity(int required)
    {
        if (_hitX.Length >= required && _hitDirection.Length >= required)
        {
            return;
        }

        int capacity = Math.Max(required, _hitX.Length * 2);
        _hitX = new float[capacity];
        _hitDirection = new sbyte[capacity];
    }

    private void EnsurePointCapacity(int required)
    {
        if (_pointX.Length >= required)
        {
            return;
        }

        int capacity = Math.Max(required, _pointX.Length * 2);
        _pointX = new float[capacity];
        _pointY = new float[capacity];
        _onCurve = new bool[capacity];
    }

    private void EnsureRawCapacity(int required)
    {
        if (_rawX.Length >= required)
        {
            return;
        }

        int capacity = Math.Max(required, _rawX.Length * 2);
        _rawX = new float[capacity];
        _rawY = new float[capacity];
        _flags = new byte[capacity];
    }

    private void EnsureEndPointCapacity(int required)
    {
        if (_endPoints.Length >= required)
        {
            return;
        }

        _endPoints = new int[Math.Max(required, _endPoints.Length * 2)];
    }

    private void EnsureContourCapacity(int required)
    {
        if (_contourEnds.Length >= required)
        {
            return;
        }

        _contourEnds = new int[Math.Max(required, _contourEnds.Length * 2)];
    }

    private void EnsureEdgeCapacity(int required)
    {
        if (_edgeX0.Length >= required)
        {
            return;
        }

        int capacity = Math.Max(required, _edgeX0.Length * 2);
        _edgeX0 = new float[capacity];
        _edgeY0 = new float[capacity];
        _edgeX1 = new float[capacity];
        _edgeY1 = new float[capacity];
    }
}
