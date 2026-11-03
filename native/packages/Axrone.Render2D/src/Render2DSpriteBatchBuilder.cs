namespace Axrone.Render2D;

using System.Diagnostics.CodeAnalysis;

/// <summary>Builder settings.</summary>
public sealed record Render2DSpriteBatchBuilderOptions
{
    /// <summary>Gets the maximum quads accepted by one batch range.</summary>
    public int MaxBatchQuads { get; init; } = 2048;
}

/// <summary>
/// One immutable view over the builder's pinned vertex/index/batch buffers.
/// The view borrows builder-owned memory and is invalidated by the next build.
/// </summary>
public readonly ref struct Render2DSpriteBatchBuildResult
{
    internal Render2DSpriteBatchBuildResult(
        ReadOnlySpan<byte> vertexData,
        ReadOnlySpan<ushort> indices16,
        ReadOnlySpan<uint> indices32,
        ReadOnlySpan<Render2DBatchRange> batches,
        int spriteCount,
        int quadCount,
        int vertexCount,
        int indexCount,
        bool usesUint32Indices)
    {
        VertexData = vertexData;
        VertexStride = Render2DSpriteVertex.Stride;
        Indices16 = indices16;
        Indices32 = indices32;
        Batches = batches;
        SpriteCount = spriteCount;
        QuadCount = quadCount;
        VertexCount = vertexCount;
        IndexCount = indexCount;
        UsesUint32Indices = usesUint32Indices;
    }

    /// <summary>Gets the vertex byte stride.</summary>
    public int VertexStride { get; }

    /// <summary>Gets the populated vertex bytes.</summary>
    public ReadOnlySpan<byte> VertexData { get; }

    /// <summary>Gets the populated vertex byte length.</summary>
    public int VertexByteLength => VertexData.Length;

    /// <summary>Gets the populated 16-bit indices (empty when 32-bit is used).</summary>
    public ReadOnlySpan<ushort> Indices16 { get; }

    /// <summary>Gets the populated 32-bit indices (empty when 16-bit is used).</summary>
    public ReadOnlySpan<uint> Indices32 { get; }

    /// <summary>Gets the populated batch ranges.</summary>
    public ReadOnlySpan<Render2DBatchRange> Batches { get; }

    /// <summary>Gets the renderable sprite count.</summary>
    public int SpriteCount { get; }

    /// <summary>Gets the total quad count.</summary>
    public int QuadCount { get; }

    /// <summary>Gets the total vertex count.</summary>
    public int VertexCount { get; }

    /// <summary>Gets the total index count.</summary>
    public int IndexCount { get; }

    /// <summary>Gets whether indices are 32-bit.</summary>
    public bool UsesUint32Indices { get; }
}

/// <summary>
/// Renderer-independent sprite batch builder. Submissions are validated before
/// any buffer write; grouping preserves input order and splits only on source,
/// clip, mask or MaxBatchQuads changes. Reuses pinned buffers across builds.
/// </summary>
public sealed class Render2DSpriteBatchBuilder
{
    private const int InitialBufferBytes = 256;
    private const float MinQuadExtent = 1e-6f;

    private readonly int _maxBatchQuads;
    private readonly float[] _xEdges = new float[4];
    private readonly float[] _yEdges = new float[4];
    private readonly float[] _uEdges = new float[4];
    private readonly float[] _vEdges = new float[4];
    private byte[] _vertexBytes = GC.AllocateArray<byte>(InitialBufferBytes, pinned: true);
    private ushort[] _indices16 = GC.AllocateArray<ushort>(InitialBufferBytes, pinned: true);
    private uint[] _indices32 = GC.AllocateArray<uint>(InitialBufferBytes, pinned: true);
    private Render2DBatchRange[] _batches = new Render2DBatchRange[8];
    private int _vertexByteLength;
    private int _indexCount;
    private int _batchCount;

    /// <summary>Creates a builder.</summary>
    public Render2DSpriteBatchBuilder(Render2DSpriteBatchBuilderOptions? options = null)
    {
        options ??= new Render2DSpriteBatchBuilderOptions();
        if (options.MaxBatchQuads <= 0)
        {
            Render2DThrowHelper.ThrowArgument(nameof(options), "MaxBatchQuads must be positive.");
        }

        _maxBatchQuads = options.MaxBatchQuads;
    }

    /// <summary>Gets the vertex byte stride.</summary>
    public static int VertexStride => Render2DSpriteVertex.Stride;

    /// <summary>Gets the maximum quads per batch.</summary>
    public int MaxBatchQuads => _maxBatchQuads;

    /// <summary>Packs an RGBA color through the single shared color packer.</summary>
    public static uint PackColor(in Vec4 color) => Render2DColorPacker.Pack(in color);

    /// <summary>Clears the last build while retaining buffer capacity.</summary>
    public void Reset()
    {
        _vertexByteLength = 0;
        _indexCount = 0;
        _batchCount = 0;
    }

    /// <summary>Builds a batch result, throwing <see cref="Render2DValidationException"/> on invalid input.</summary>
    public Render2DSpriteBatchBuildResult Build(ReadOnlySpan<Render2DSpriteSubmission> submissions)
    {
        if (!TryBuildCore(submissions, out Render2DSpriteBatchBuildResult result, out Render2DValidationErrorCode error))
        {
            Render2DThrowHelper.ThrowValidation(error);
        }

        return result;
    }

    /// <summary>Builds a batch result without throwing on invalid input.</summary>
    public bool TryBuild(
        ReadOnlySpan<Render2DSpriteSubmission> submissions,
        out Render2DSpriteBatchBuildResult result,
        out Render2DValidationErrorCode error) =>
        TryBuildCore(submissions, out result, out error);

    private bool TryBuildCore(
        ReadOnlySpan<Render2DSpriteSubmission> submissions,
        out Render2DSpriteBatchBuildResult result,
        out Render2DValidationErrorCode error)
    {
        Reset();
        error = ValidateAll(submissions, out int spriteCount, out int quadCount);
        if (error != Render2DValidationErrorCode.None)
        {
            result = default;
            return false;
        }

        if (spriteCount == 0)
        {
            result = new Render2DSpriteBatchBuildResult(
                ReadOnlySpan<byte>.Empty,
                ReadOnlySpan<ushort>.Empty,
                ReadOnlySpan<uint>.Empty,
                ReadOnlySpan<Render2DBatchRange>.Empty,
                0,
                0,
                0,
                0,
                false);
            return true;
        }

        int vertexCount = quadCount * Render2DSpriteShaderContract.VerticesPerQuad;
        int indexCount = quadCount * Render2DSpriteShaderContract.IndicesPerQuad;
        bool useUint32 = vertexCount > 0xFFFF;
        EnsureVertexCapacity(vertexCount);
        EnsureIndexCapacity(indexCount, useUint32);

        Span<byte> indexBytes = useUint32
            ? MemoryMarshal.AsBytes(_indices32.AsSpan(0, indexCount))
            : MemoryMarshal.AsBytes(_indices16.AsSpan(0, indexCount));
        WriteSubmissions(submissions, vertexCount, indexCount, useUint32, indexBytes);

        _vertexByteLength = vertexCount * Render2DSpriteVertex.Stride;
        _indexCount = indexCount;
        result = new Render2DSpriteBatchBuildResult(
            _vertexBytes.AsSpan(0, _vertexByteLength),
            useUint32 ? ReadOnlySpan<ushort>.Empty : _indices16.AsSpan(0, indexCount),
            useUint32 ? _indices32.AsSpan(0, indexCount) : ReadOnlySpan<uint>.Empty,
            _batches.AsSpan(0, _batchCount),
            spriteCount,
            quadCount,
            vertexCount,
            indexCount,
            useUint32);
        return true;
    }

    private Render2DValidationErrorCode ValidateAll(
        ReadOnlySpan<Render2DSpriteSubmission> submissions,
        out int spriteCount,
        out int quadCount)
    {
        spriteCount = 0;
        quadCount = 0;
        long vertexTotal = 0;

        for (int i = 0; i < submissions.Length; i++)
        {
            Render2DValidationErrorCode error = ValidateSubmission(in submissions[i], out int submissionQuads);
            if (error != Render2DValidationErrorCode.None)
            {
                return error;
            }

            if (!IsRenderable(in submissions[i]))
            {
                continue;
            }

            if (submissionQuads > _maxBatchQuads)
            {
                return Render2DValidationErrorCode.SubmissionExceedsBatchQuads;
            }

            spriteCount++;
            quadCount += submissionQuads;
            vertexTotal += (long)submissionQuads * Render2DSpriteShaderContract.VerticesPerQuad;
            if (vertexTotal > uint.MaxValue)
            {
                return Render2DValidationErrorCode.VertexCapacityExceeded;
            }
        }

        return Render2DValidationErrorCode.None;
    }

    private Render2DValidationErrorCode ValidateSubmission(
        in Render2DSpriteSubmission submission,
        out int quadCount)
    {
        quadCount = 0;
        if (!submission.WorldMatrix.IsAllFinite)
        {
            return Render2DValidationErrorCode.WorldMatrixNotFinite;
        }

        if (!IsFinite(submission.Size))
        {
            return Render2DValidationErrorCode.SizeNotFinite;
        }

        if (!IsFinite(submission.Anchor))
        {
            return Render2DValidationErrorCode.AnchorNotFinite;
        }

        if (!IsFinite(submission.UvRect))
        {
            return Render2DValidationErrorCode.UvNotFinite;
        }

        if (!IsFinite(submission.Color))
        {
            return Render2DValidationErrorCode.ColorNotFinite;
        }

        if (submission.HasClip && !IsFinite(submission.Clip))
        {
            return Render2DValidationErrorCode.ClipNotFinite;
        }

        if (submission.HasSlice)
        {
            Render2DSpriteSlice slice = submission.Slice;
            if (!float.IsFinite(slice.SourceSize.X) ||
                !float.IsFinite(slice.SourceSize.Y) ||
                slice.SourceSize.X <= 0.0f ||
                slice.SourceSize.Y <= 0.0f)
            {
                return Render2DValidationErrorCode.SliceSourceInvalid;
            }

            Render2DBorder border = slice.Border;
            if (!float.IsFinite(border.Left) ||
                !float.IsFinite(border.Right) ||
                !float.IsFinite(border.Top) ||
                !float.IsFinite(border.Bottom))
            {
                return Render2DValidationErrorCode.SliceSourceInvalid;
            }

            if (border.Left < 0.0f || border.Right < 0.0f || border.Top < 0.0f || border.Bottom < 0.0f)
            {
                return Render2DValidationErrorCode.SliceBorderNegative;
            }

            if (border.Left + border.Right > slice.SourceSize.X ||
                border.Top + border.Bottom > slice.SourceSize.Y)
            {
                return Render2DValidationErrorCode.SliceBorderTooLarge;
            }
        }

        if (submission.HasMask)
        {
            Render2DSpriteMask mask = submission.Mask;
            if (!IsFinite(mask.Size) || mask.Size.X <= 0.0f || mask.Size.Y <= 0.0f)
            {
                return Render2DValidationErrorCode.MaskSizeInvalid;
            }

            if (!IsFinite(mask.Anchor) ||
                !float.IsFinite(mask.CornerRadius) ||
                !mask.InverseWorldMatrix.IsAllFinite)
            {
                return Render2DValidationErrorCode.MaskNotFinite;
            }

            if (mask.Shape == Render2DSpriteMaskShape.RoundedRect && !float.IsFinite(mask.CornerRadius))
            {
                return Render2DValidationErrorCode.MaskNotFinite;
            }
        }

        if (IsRenderable(in submission))
        {
            quadCount = MeasureQuadCount(in submission);
        }

        return Render2DValidationErrorCode.None;
    }

    /// <summary>Whether a submission contributes quads to the build.</summary>
    public static bool IsRenderable(in Render2DSpriteSubmission submission)
    {
        if (!submission.Visible || !submission.Source.IsValid)
        {
            return false;
        }

        if (submission.Size.X == 0.0f || submission.Size.Y == 0.0f)
        {
            return false;
        }

        if (submission.HasClip && (submission.Clip.Width == 0.0f || submission.Clip.Height == 0.0f))
        {
            return false;
        }

        return true;
    }

    private int MeasureQuadCount(in Render2DSpriteSubmission submission)
    {
        if (!submission.HasSlice)
        {
            return 1;
        }

        ResolveSliceLocalEdges(in submission);
        int count = 0;
        for (int row = 0; row < 3; row++)
        {
            float height = _yEdges[row + 1] - _yEdges[row];
            if (height <= MinQuadExtent)
            {
                continue;
            }

            for (int column = 0; column < 3; column++)
            {
                float width = _xEdges[column + 1] - _xEdges[column];
                if (width > MinQuadExtent)
                {
                    count++;
                }
            }
        }

        return Math.Max(1, count);
    }

    private void WriteSubmissions(
        ReadOnlySpan<Render2DSpriteSubmission> submissions,
        int vertexCount,
        int indexCount,
        bool useUint32,
        Span<byte> indexBytes)
    {
        Span<Render2DSpriteVertex> vertices = MemoryMarshal.Cast<byte, Render2DSpriteVertex>(
            _vertexBytes.AsSpan(0, vertexCount * Render2DSpriteVertex.Stride));

        int quadIndex = 0;
        int spriteOffset = 0;
        int batchCount = 0;
        Render2DBatchKey currentKey = default;
        bool hasBatch = false;

        for (int i = 0; i < submissions.Length; i++)
        {
            ref readonly Render2DSpriteSubmission submission = ref submissions[i];
            if (!IsRenderable(in submission))
            {
                continue;
            }

            int submissionQuads = MeasureQuadCount(in submission);
            Render2DBatchKey key = Render2DBatchKey.From(in submission);
            bool split = !hasBatch ||
                !key.Equals(currentKey) ||
                _batches[batchCount - 1].QuadCount + submissionQuads > _maxBatchQuads;
            if (split)
            {
                EnsureBatchCapacity(batchCount + 1);
                _batches[batchCount] = new Render2DBatchRange(
                    key,
                    spriteOffset,
                    0,
                    0,
                    quadIndex * 6,
                    0,
                    i,
                    0);
                batchCount++;
                currentKey = key;
                hasBatch = true;
            }

            int written = WriteSubmission(
                in submission,
                quadIndex,
                vertices,
                indexBytes,
                useUint32);

            Render2DBatchRange range = _batches[batchCount - 1];
            _batches[batchCount - 1] = range with
            {
                SpriteCount = range.SpriteCount + 1,
                QuadCount = range.QuadCount + written,
                IndexCount = range.IndexCount + (written * Render2DSpriteShaderContract.IndicesPerQuad),
                SubmissionCount = range.SubmissionCount + 1,
            };

            quadIndex += written;
            spriteOffset++;
        }

        _batchCount = batchCount;
        _vertexByteLength = vertexCount * Render2DSpriteVertex.Stride;
        _indexCount = indexCount;
    }

    private int WriteSubmission(
        in Render2DSpriteSubmission submission,
        int quadIndex,
        Span<Render2DSpriteVertex> vertices,
        Span<byte> indices,
        bool useUint32)
    {
        Vec4 sourceColor = submission.Color;
        uint color = Render2DColorPacker.Pack(in sourceColor);
        float minX = -submission.Anchor.X * submission.Size.X;
        float minY = -submission.Anchor.Y * submission.Size.Y;
        float maxX = minX + submission.Size.X;
        float maxY = minY + submission.Size.Y;

        if (!submission.HasSlice)
        {
            Rect sourceUv = submission.UvRect;
            Render2DUvMath.Resolve(
                in sourceUv,
                submission.FlipX,
                submission.FlipY,
                out float u0,
                out float v0,
                out float u1,
                out float v1);

            WriteTransformedQuad(
                in submission,
                quadIndex,
                vertices,
                indices,
                useUint32,
                minX,
                minY,
                maxX,
                maxY,
                u0,
                v0,
                u1,
                v1,
                color);
            return 1;
        }

        ResolveSliceLocalEdges(in submission);
        ResolveSliceUvEdges(in submission);
        int written = 0;
        for (int row = 0; row < 3; row++)
        {
            float localMinY = _yEdges[row];
            float localMaxY = _yEdges[row + 1];
            if (localMaxY - localMinY <= MinQuadExtent)
            {
                continue;
            }

            for (int column = 0; column < 3; column++)
            {
                float localMinX = _xEdges[column];
                float localMaxX = _xEdges[column + 1];
                if (localMaxX - localMinX <= MinQuadExtent)
                {
                    continue;
                }

                WriteTransformedQuad(
                    in submission,
                    quadIndex + written,
                    vertices,
                    indices,
                    useUint32,
                    localMinX,
                    localMinY,
                    localMaxX,
                    localMaxY,
                    _uEdges[column],
                    _vEdges[row + 1],
                    _uEdges[column + 1],
                    _vEdges[row],
                    color);
                written++;
            }
        }

        if (written == 0)
        {
            WriteTransformedQuad(
                in submission,
                quadIndex,
                vertices,
                indices,
                useUint32,
                minX,
                minY,
                maxX,
                maxY,
                submission.UvRect.X,
                submission.UvRect.Y,
                submission.UvRect.X + submission.UvRect.Width,
                submission.UvRect.Y + submission.UvRect.Height,
                color);
            return 1;
        }

        return written;
    }

    private static void WriteTransformedQuad(
        in Render2DSpriteSubmission submission,
        int quadIndex,
        Span<Render2DSpriteVertex> vertices,
        Span<byte> indices,
        bool useUint32,
        float minX,
        float minY,
        float maxX,
        float maxY,
        float uLeft,
        float vTop,
        float uRight,
        float vBottom,
        uint color)
    {
        int vertexBase = quadIndex * Render2DSpriteShaderContract.VerticesPerQuad;

        Vec3 point = Vec3.Transform(new Vec3(minX, minY, 0.0f), submission.WorldMatrix);
        vertices[vertexBase] = new Render2DSpriteVertex(
            point.X,
            point.Y,
            Render2DSpriteVertex.PackUv(uLeft),
            Render2DSpriteVertex.PackUv(vBottom),
            color);

        point = Vec3.Transform(new Vec3(maxX, minY, 0.0f), submission.WorldMatrix);
        vertices[vertexBase + 1] = new Render2DSpriteVertex(
            point.X,
            point.Y,
            Render2DSpriteVertex.PackUv(uRight),
            Render2DSpriteVertex.PackUv(vBottom),
            color);

        point = Vec3.Transform(new Vec3(maxX, maxY, 0.0f), submission.WorldMatrix);
        vertices[vertexBase + 2] = new Render2DSpriteVertex(
            point.X,
            point.Y,
            Render2DSpriteVertex.PackUv(uRight),
            Render2DSpriteVertex.PackUv(vTop),
            color);

        point = Vec3.Transform(new Vec3(minX, maxY, 0.0f), submission.WorldMatrix);
        vertices[vertexBase + 3] = new Render2DSpriteVertex(
            point.X,
            point.Y,
            Render2DSpriteVertex.PackUv(uLeft),
            Render2DSpriteVertex.PackUv(vTop),
            color);

        int indexBase = quadIndex * Render2DSpriteShaderContract.IndicesPerQuad;
        WriteIndex(indices, indexBase, vertexBase, useUint32);
        WriteIndex(indices, indexBase + 1, vertexBase + 1, useUint32);
        WriteIndex(indices, indexBase + 2, vertexBase + 2, useUint32);
        WriteIndex(indices, indexBase + 3, vertexBase, useUint32);
        WriteIndex(indices, indexBase + 4, vertexBase + 2, useUint32);
        WriteIndex(indices, indexBase + 5, vertexBase + 3, useUint32);
    }

    private static void WriteIndex(Span<byte> indices, int index, int vertex, bool useUint32)
    {
        if (useUint32)
        {
            uint value = (uint)vertex;
            MemoryMarshal.Write(indices.Slice(index * sizeof(uint), sizeof(uint)), in value);
        }
        else
        {
            ushort value = (ushort)vertex;
            MemoryMarshal.Write(indices.Slice(index * sizeof(ushort), sizeof(ushort)), in value);
        }
    }

    private void ResolveSliceLocalEdges(in Render2DSpriteSubmission submission)
    {
        Render2DSpriteSlice slice = submission.Slice;
        float minX = -submission.Anchor.X * submission.Size.X;
        float minY = -submission.Anchor.Y * submission.Size.Y;
        ResolveDisplayAxisEdges(
            submission.Size.X,
            slice.SourceSize.X,
            slice.Border.Left,
            slice.Border.Right,
            minX,
            _xEdges);
        ResolveDisplayAxisEdges(
            submission.Size.Y,
            slice.SourceSize.Y,
            slice.Border.Bottom,
            slice.Border.Top,
            minY,
            _yEdges);
    }

    private void ResolveSliceUvEdges(in Render2DSpriteSubmission submission)
    {
        Render2DSpriteSlice slice = submission.Slice;
        float uvLeft = submission.UvRect.X;
        float uvTop = submission.UvRect.Y;
        float uvRight = uvLeft + submission.UvRect.Width;
        float uvBottom = uvTop + submission.UvRect.Height;
        float leftInner = uvLeft + submission.UvRect.Width * (slice.Border.Left / slice.SourceSize.X);
        float rightInner = uvLeft + submission.UvRect.Width * ((slice.SourceSize.X - slice.Border.Right) / slice.SourceSize.X);
        float topInner = uvTop + submission.UvRect.Height * (slice.Border.Top / slice.SourceSize.Y);
        float bottomInner = uvTop + submission.UvRect.Height * ((slice.SourceSize.Y - slice.Border.Bottom) / slice.SourceSize.Y);

        _uEdges[0] = uvLeft;
        _uEdges[1] = leftInner;
        _uEdges[2] = rightInner;
        _uEdges[3] = uvRight;
        if (submission.FlipX)
        {
            ReverseEdges(_uEdges);
        }

        _vEdges[0] = uvBottom;
        _vEdges[1] = bottomInner;
        _vEdges[2] = topInner;
        _vEdges[3] = uvTop;
        if (submission.FlipY)
        {
            ReverseEdges(_vEdges);
        }
    }

    private static void ResolveDisplayAxisEdges(
        float targetSize,
        float sourceSize,
        float startBorder,
        float endBorder,
        float offset,
        float[] edges)
    {
        float startSize = (startBorder / sourceSize) * targetSize;
        float endSize = (endBorder / sourceSize) * targetSize;
        float totalBorder = startSize + endSize;
        if (totalBorder > targetSize && totalBorder > 0.0f)
        {
            float scale = targetSize / totalBorder;
            startSize *= scale;
            endSize *= scale;
        }

        float center = MathF.Max(0.0f, targetSize - startSize - endSize);
        edges[0] = offset;
        edges[1] = offset + startSize;
        edges[2] = offset + startSize + center;
        edges[3] = offset + targetSize;
    }

    private static void ReverseEdges(float[] edges)
    {
        float first = edges[0];
        float second = edges[1];
        edges[0] = edges[3];
        edges[1] = edges[2];
        edges[2] = second;
        edges[3] = first;
    }

    private void EnsureVertexCapacity(int vertexCount)
    {
        int requiredBytes = vertexCount * Render2DSpriteVertex.Stride;
        if (_vertexBytes.Length >= requiredBytes)
        {
            return;
        }

        int capacity = Math.Max(InitialBufferBytes, _vertexBytes.Length);
        while (capacity < requiredBytes)
        {
            capacity *= 2;
        }

        _vertexBytes = GC.AllocateArray<byte>(capacity, pinned: true);
    }

    private void EnsureIndexCapacity(int indexCount, bool useUint32)
    {
        if (useUint32)
        {
            if (_indices32.Length >= indexCount)
            {
                return;
            }

            int capacity = Math.Max(InitialBufferBytes, _indices32.Length);
            while (capacity < indexCount)
            {
                capacity *= 2;
            }

            _indices32 = GC.AllocateArray<uint>(capacity, pinned: true);
            return;
        }

        if (_indices16.Length >= indexCount)
        {
            return;
        }

        int shortCapacity = Math.Max(InitialBufferBytes, _indices16.Length);
        while (shortCapacity < indexCount)
        {
            shortCapacity *= 2;
        }

        _indices16 = GC.AllocateArray<ushort>(shortCapacity, pinned: true);
    }

    private void EnsureBatchCapacity(int needed)
    {
        if (needed <= _batches.Length)
        {
            return;
        }

        int capacity = _batches.Length;
        while (capacity < needed)
        {
            capacity *= 2;
        }

        Array.Resize(ref _batches, capacity);
    }

    private static bool IsFinite(Vec2 value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y);

    private static bool IsFinite(Vec4 value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y) &&
        float.IsFinite(value.Z) && float.IsFinite(value.W);

    private static bool IsFinite(Rect value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y) &&
        float.IsFinite(value.Width) && float.IsFinite(value.Height);
}
