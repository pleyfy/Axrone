namespace Render2DTests;

using Axrone.Numeric;
using Axrone.Render2D;
using FluentAssertions;
using Xunit;

public sealed class Render2DSpriteBatchBuilderTests
{
    private static readonly Vec4 White = new(1.0f, 1.0f, 1.0f, 1.0f);

    [Fact]
    public void VertexLayoutIsSixteenBytes()
    {
        Render2DSpriteVertex.Stride.Should().Be(16);
        Unsafe.SizeOf<Render2DSpriteVertex>().Should().Be(16);
        Render2DSpriteShaderContract.VertexStride.Should().Be(16);
        Render2DSpriteShaderContract.VerticesPerQuad.Should().Be(4);
        Render2DSpriteShaderContract.IndicesPerQuad.Should().Be(6);
        Render2DSpriteBatchBuilder.VertexStride.Should().Be(16);
    }

    [Fact]
    public void ColorPackingUsesRgbaByteOrder()
    {
        Vec4 color = new(1.0f, 0.5f, 0.0f, 1.0f);

        uint packed = Render2DColorPacker.Pack(in color);

        packed.Should().Be(0xFF0080FFu);
        Render2DColorPacker.UnpackChannel(packed, 0).Should().Be(255);
        Render2DColorPacker.UnpackChannel(packed, 1).Should().Be(128);
        Render2DColorPacker.UnpackChannel(packed, 2).Should().Be(0);
        Render2DColorPacker.UnpackChannel(packed, 3).Should().Be(255);
        Render2DSpriteBatchBuilder.PackColor(in color).Should().Be(packed);
    }

    [Fact]
    public void UvPackingIsNormalizedAndClamped()
    {
        Render2DSpriteVertex.PackUv(0.0f).Should().Be(0);
        Render2DSpriteVertex.PackUv(1.0f).Should().Be(65535);
        Render2DSpriteVertex.PackUv(-1.0f).Should().Be(0);
        Render2DSpriteVertex.PackUv(2.0f).Should().Be(65535);
        Render2DSpriteVertex vertex = new(0.0f, 0.0f, 32768, 65535, 0);
        vertex.Uv.X.Should().BeApproximately(0.5f, 0.0001f);
        vertex.Uv.Y.Should().Be(1.0f);
    }

    [Fact]
    public void IdentityMatrixBuildsFourVerticesAndSixIndices()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission[] submissions =
        [
            Submission(Render2DSpriteSource.Texture(7), new Vec2(10.0f, 20.0f)),
        ];

        Render2DSpriteBatchBuildResult result = builder.Build(submissions);

        result.VertexCount.Should().Be(4);
        result.IndexCount.Should().Be(6);
        result.VertexByteLength.Should().Be(64);
        result.Indices16.ToArray().Should().Equal(0, 1, 2, 0, 2, 3);
        result.UsesUint32Indices.Should().BeFalse();
        result.SpriteCount.Should().Be(1);
        result.QuadCount.Should().Be(1);
        result.Batches.Length.Should().Be(1);
        result.Batches[0].SpriteCount.Should().Be(1);
        result.Batches[0].QuadCount.Should().Be(1);
        result.Batches[0].IndexOffset.Should().Be(0);
        result.Batches[0].IndexCount.Should().Be(6);
    }

    [Fact]
    public void WorldMatrixTransformsVertices()
    {
        Render2DSpriteBatchBuilder builder = new();
        Mat4 translation = Mat4.CreateTranslation(5.0f, 7.0f, 0.0f);
        Render2DSpriteSubmission submission = Submission(
            Render2DSpriteSource.Texture(1),
            new Vec2(2.0f, 4.0f),
            anchor: Vec2.Zero,
            worldMatrix: translation);

        Render2DSpriteBatchBuildResult result = builder.Build([submission]);
        Render2DSpriteVertex first = ReadVertex(in result, 0);

        first.Position.Should().Be(new Vec2(5.0f, 7.0f));
    }

    [Fact]
    public void BatchKeyGroupsBySourceClipAndMask()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSource texture = Render2DSpriteSource.Texture(1);
        Render2DSpriteMask mask = new(
            Render2DSpriteMaskShape.Circle,
            Mat4.Identity,
            new Vec2(10.0f, 10.0f),
            new Vec2(0.5f, 0.5f));
        Render2DSpriteSubmission[] submissions =
        [
            Submission(texture, new Vec2(10.0f, 10.0f)),
            Submission(texture, new Vec2(10.0f, 10.0f)),
            Submission(texture, new Vec2(10.0f, 10.0f), hasClip: true, clip: new Rect(0, 0, 5, 5)),
            Submission(texture, new Vec2(10.0f, 10.0f), hasMask: true, mask: mask),
            Submission(Render2DSpriteSource.Material(1), new Vec2(10.0f, 10.0f)),
        ];

        Render2DSpriteBatchBuildResult result = builder.Build(submissions);

        result.Batches.Length.Should().Be(4);
        result.Batches[0].SpriteCount.Should().Be(2);
        result.Batches[1].SpriteCount.Should().Be(1);
        result.Batches[2].SpriteCount.Should().Be(1);
        result.Batches[3].SpriteCount.Should().Be(1);
        result.Batches[0].Key.Source.Kind.Should().Be(Render2DSpriteSourceKind.Texture);
        result.Batches[3].Key.Source.Kind.Should().Be(Render2DSpriteSourceKind.Material);
        result.Batches[1].Key.HasClip.Should().BeTrue();
        result.Batches[2].Key.HasMask.Should().BeTrue();
        result.Batches[0].IndexOffset.Should().Be(0);
        result.Batches[1].IndexOffset.Should().Be(12);
        result.Batches[3].IndexOffset.Should().Be(24);
    }

    [Fact]
    public void SliceBuildsNineQuadsWithEdges()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission submission = Submission(
            Render2DSpriteSource.Texture(1),
            new Vec2(30.0f, 30.0f),
            anchor: Vec2.Zero,
            hasSlice: true,
            slice: new Render2DSpriteSlice(
                new Vec2(30.0f, 30.0f),
                new Render2DBorder(10.0f, 10.0f, 10.0f, 10.0f)));

        Render2DSpriteBatchBuildResult result = builder.Build([submission]);

        result.QuadCount.Should().Be(9);
        result.VertexCount.Should().Be(36);
        result.IndexCount.Should().Be(54);
        Render2DSpriteVertex first = ReadVertex(in result, 0);
        Render2DSpriteVertex third = ReadVertex(in result, 2);
        first.Position.Should().Be(new Vec2(0.0f, 0.0f));
        third.Position.Should().Be(new Vec2(10.0f, 10.0f));
        first.Uv.X.Should().BeApproximately(0.0f, 1.0f / 65535.0f);
        third.Uv.X.Should().BeApproximately(1.0f / 3.0f, 1.0f / 65535.0f);
    }

    [Fact]
    public void FlipsReverseUvEdges()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission submission = Submission(
            Render2DSpriteSource.Texture(1),
            new Vec2(10.0f, 10.0f),
            anchor: Vec2.Zero,
            flipX: true,
            flipY: true);

        Render2DSpriteBatchBuildResult result = builder.Build([submission]);
        Render2DSpriteVertex vertex = ReadVertex(in result, 0);

        vertex.Uv.X.Should().Be(1.0f);
        vertex.Uv.Y.Should().Be(0.0f);
    }

    [Fact]
    public void CapacityGrowthPreservesEarlierBuilds()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission[] single = [Submission(Render2DSpriteSource.Texture(1), new Vec2(10.0f, 10.0f))];
        Render2DSpriteBatchBuildResult first = builder.Build(single);
        byte[] firstBytes = first.VertexData.ToArray();
        ushort[] firstIndices = first.Indices16.ToArray();

        Render2DSpriteSubmission[] many = new Render2DSpriteSubmission[300];
        for (int i = 0; i < many.Length; i++)
        {
            many[i] = Submission(Render2DSpriteSource.Texture(1), new Vec2(10.0f, 10.0f));
        }

        Render2DSpriteBatchBuildResult grown = builder.Build(many);

        grown.VertexCount.Should().Be(1200);
        grown.VertexData.Length.Should().BeGreaterThanOrEqualTo(1200 * 16);
        firstBytes.Should().Equal(builder.Build(single).VertexData.ToArray());
        firstIndices.Should().Equal(builder.Build(single).Indices16.ToArray());
    }

    [Fact]
    public void DegenerateSliceFallsBackToFullQuad()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission submission = Submission(
            Render2DSpriteSource.Texture(1),
            new Vec2(10.0f, 10.0f),
            anchor: Vec2.Zero,
            hasSlice: true,
            slice: new Render2DSpriteSlice(
                new Vec2(10.0f, 10.0f),
                new Render2DBorder(0.0f, 0.0f, 0.0f, 0.0f)));

        Render2DSpriteBatchBuildResult result = builder.Build([submission]);

        result.QuadCount.Should().Be(1);
        result.VertexCount.Should().Be(4);
    }

    [Fact]
    public void MaxBatchQuadsSplitsRanges()
    {
        Render2DSpriteBatchBuilder builder = new(new Render2DSpriteBatchBuilderOptions { MaxBatchQuads = 2 });
        Render2DSpriteSubmission[] submissions =
        [
            Submission(Render2DSpriteSource.Texture(1), new Vec2(10.0f, 10.0f)),
            Submission(Render2DSpriteSource.Texture(1), new Vec2(10.0f, 10.0f)),
            Submission(Render2DSpriteSource.Texture(1), new Vec2(10.0f, 10.0f)),
        ];

        Render2DSpriteBatchBuildResult result = builder.Build(submissions);

        result.Batches.Length.Should().Be(2);
        result.Batches[0].QuadCount.Should().Be(2);
        result.Batches[1].QuadCount.Should().Be(1);
    }

    [Fact]
    public void OversizedSliceIsRejected()
    {
        Render2DSpriteBatchBuilder builder = new(new Render2DSpriteBatchBuilderOptions { MaxBatchQuads = 2 });
        Render2DSpriteSubmission submission = Submission(
            Render2DSpriteSource.Texture(1),
            new Vec2(30.0f, 30.0f),
            hasSlice: true,
            slice: new Render2DSpriteSlice(
                new Vec2(30.0f, 30.0f),
                new Render2DBorder(10.0f, 10.0f, 10.0f, 10.0f)));

        bool built = builder.TryBuild([submission], out Render2DSpriteBatchBuildResult result, out Render2DValidationErrorCode error);

        built.Should().BeFalse();
        result.VertexCount.Should().Be(0);
        error.Should().Be(Render2DValidationErrorCode.SubmissionExceedsBatchQuads);
    }

    [Fact]
    public void InvalidSubmissionReturnsTypedFailure()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission submission = Submission(
            Render2DSpriteSource.Texture(1),
            new Vec2(10.0f, 10.0f),
            worldMatrix: new Mat4(
                float.NaN, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, 0, 0, 1));

        builder.TryBuild([submission], out _, out Render2DValidationErrorCode error).Should().BeFalse();
        error.Should().Be(Render2DValidationErrorCode.WorldMatrixNotFinite);

        Action build = () => builder.Build([submission]);
        build.Should().Throw<Render2DValidationException>()
            .Which.Code.Should().Be(Render2DValidationErrorCode.WorldMatrixNotFinite);
    }

    [Fact]
    public void InvalidSliceAndMaskAreTyped()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission negativeSlice = Submission(
            Render2DSpriteSource.Texture(1),
            new Vec2(10.0f, 10.0f),
            hasSlice: true,
            slice: new Render2DSpriteSlice(new Vec2(10.0f, 10.0f), new Render2DBorder(-1.0f, 0.0f, 0.0f, 0.0f)));
        builder.TryBuild([negativeSlice], out _, out Render2DValidationErrorCode sliceError).Should().BeFalse();
        sliceError.Should().Be(Render2DValidationErrorCode.SliceBorderNegative);

        Render2DSpriteSubmission zeroMask = Submission(
            Render2DSpriteSource.Texture(1),
            new Vec2(10.0f, 10.0f),
            hasMask: true,
            mask: new Render2DSpriteMask(Render2DSpriteMaskShape.Circle, Mat4.Identity, Vec2.Zero, new Vec2(0.5f, 0.5f)));
        builder.TryBuild([zeroMask], out _, out Render2DValidationErrorCode maskError).Should().BeFalse();
        maskError.Should().Be(Render2DValidationErrorCode.MaskSizeInvalid);
    }

    [Fact]
    public void NonRenderableSubmissionsAreSkipped()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission[] submissions =
        [
            Submission(Render2DSpriteSource.Texture(0), new Vec2(10.0f, 10.0f)),
            Submission(Render2DSpriteSource.Texture(1), Vec2.Zero),
            Submission(Render2DSpriteSource.Texture(1), new Vec2(10.0f, 10.0f), visible: false),
            Submission(Render2DSpriteSource.Texture(1), new Vec2(10.0f, 10.0f)),
        ];

        Render2DSpriteBatchBuildResult result = builder.Build(submissions);

        result.SpriteCount.Should().Be(1);
        result.QuadCount.Should().Be(1);
    }

    [Fact]
    public void BuildIsDeterministicAndAllocationFreeWhenWarm()
    {
        Render2DSpriteBatchBuilder builder = new();
        Render2DSpriteSubmission[] submissions = new Render2DSpriteSubmission[16];
        for (int i = 0; i < submissions.Length; i++)
        {
            submissions[i] = Submission(Render2DSpriteSource.Texture((ulong)(i % 3 + 1)), new Vec2(10.0f, 10.0f));
        }

        for (int i = 0; i < 4; i++)
        {
            _ = builder.Build(submissions);
        }

        Render2DSpriteBatchBuildResult first = builder.Build(submissions);
        byte[] firstVertices = first.VertexData.ToArray();
        ushort[] firstIndices = first.Indices16.ToArray();

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            _ = builder.Build(submissions);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);

        Render2DSpriteBatchBuildResult second = builder.Build(submissions);
        second.VertexData.SequenceEqual(firstVertices).Should().BeTrue();
        second.Indices16.SequenceEqual(firstIndices).Should().BeTrue();
        second.Batches.Length.Should().Be(first.Batches.Length);
    }

    [Fact]
    public void Uint32IndicesAreUsedAboveSixteenBitVertexCapacity()
    {
        Render2DSpriteBatchBuilder builder = new(new Render2DSpriteBatchBuilderOptions { MaxBatchQuads = 20000 });
        Render2DSpriteSubmission[] submissions = new Render2DSpriteSubmission[16385];
        for (int i = 0; i < submissions.Length; i++)
        {
            submissions[i] = Submission(Render2DSpriteSource.Texture(1), new Vec2(1.0f, 1.0f));
        }

        Render2DSpriteBatchBuildResult result = builder.Build(submissions);

        result.VertexCount.Should().Be(65540);
        result.UsesUint32Indices.Should().BeTrue();
        result.Indices32.Length.Should().Be(98310);
        result.Indices16.Length.Should().Be(0);
    }

    private static Render2DSpriteSubmission Submission(
        Render2DSpriteSource source,
        Vec2 size,
        Vec2? anchor = null,
        Mat4? worldMatrix = null,
        bool visible = true,
        bool flipX = false,
        bool flipY = false,
        bool hasClip = false,
        Rect clip = default,
        bool hasSlice = false,
        Render2DSpriteSlice slice = default,
        bool hasMask = false,
        Render2DSpriteMask mask = default)
    {
        Vec2 effectiveAnchor = anchor ?? new Vec2(0.5f, 0.5f);

        return new Render2DSpriteSubmission(
            source,
            worldMatrix ?? Mat4.Identity,
            size,
            effectiveAnchor,
            new Rect(0.0f, 0.0f, 1.0f, 1.0f),
            White,
            visible,
            flipX,
            flipY,
            hasClip,
            clip,
            hasSlice,
            slice,
            hasMask,
            mask);
    }

    private static Render2DSpriteVertex ReadVertex(in Render2DSpriteBatchBuildResult result, int index)
    {
        ReadOnlySpan<Render2DSpriteVertex> vertices = MemoryMarshal.Cast<byte, Render2DSpriteVertex>(result.VertexData);
        return vertices[index];
    }
}
