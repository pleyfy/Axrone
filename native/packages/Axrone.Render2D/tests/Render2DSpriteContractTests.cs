namespace Render2DTests;

using Axrone.Numeric;
using Axrone.Render2D;
using FluentAssertions;
using Xunit;

public sealed class Render2DSpriteContractTests
{
    private static Render2DSpriteSubmission Submission(
        ulong textureId,
        ulong materialId = 0,
        bool requiresImmediate = false,
        bool visible = true,
        bool flipX = false)
    {
        var uv = new Rect(0.0f, 0.0f, 1.0f, 1.0f);
        return new Render2DSpriteSubmission(
            Render2DSpriteSource.Texture(textureId),
            Mat4.Identity,
            new Vec2(10.0f, 10.0f),
            new Vec2(0.5f, 0.5f),
            uv,
            Vec4.One,
            visible,
            flipX,
            false,
            false,
            default,
            false,
            default,
            false,
            default,
            materialId,
            requiresImmediate);
    }

    [Fact]
    public void AttributeLayoutMatchesThePackedVertex()
    {
        ReadOnlySpan<Render2DSpriteAttributeLayout> attributes = Render2DSpriteShaderContract.Attributes;

        attributes.Length.Should().Be(3);
        attributes[0].Name.Should().Be(Render2DSpriteShaderContract.PositionAttribute);
        attributes[0].Location.Should().Be(0);
        attributes[0].Offset.Should().Be(0);
        attributes[0].ComponentCount.Should().Be(2);
        attributes[0].Type.Should().Be(Render2DSpriteAttributeType.Scalar32);
        attributes[1].Name.Should().Be(Render2DSpriteShaderContract.UvAttribute);
        attributes[1].Location.Should().Be(2);
        attributes[1].Offset.Should().Be(8);
        attributes[1].Type.Should().Be(Render2DSpriteAttributeType.UNorm16);
        attributes[2].Name.Should().Be(Render2DSpriteShaderContract.ColorAttribute);
        attributes[2].Location.Should().Be(3);
        attributes[2].Offset.Should().Be(12);
        attributes[2].Type.Should().Be(Render2DSpriteAttributeType.UNorm8);
        Render2DSpriteShaderContract.VertexStride.Should().Be(Render2DSpriteVertex.Stride);
        Render2DSpriteAttributeLayout[] layout = attributes.ToArray();
        foreach (Render2DSpriteAttributeLayout attribute in layout)
        {
            (attribute.Offset + (attribute.ComponentCount * BytesPerComponent(attribute.Type)))
                .Should().BeLessThanOrEqualTo(Render2DSpriteShaderContract.VertexStride);
            attribute.Location.Should().BeGreaterThanOrEqualTo(0);
        }
    }

    [Fact]
    public void MaterialIdSplitsBatchesInsideOneTexture()
    {
        var builder = new Render2DSpriteBatchBuilder();
        Render2DSpriteSubmission[] items =
        [
            Submission(1, materialId: 10),
            Submission(1, materialId: 10),
            Submission(1, materialId: 11),
            Submission(1),
        ];

        Render2DSpriteBatchBuildResult result = builder.Build(items);

        result.Batches.Length.Should().Be(3);
        result.Batches[0].Key.MaterialId.Should().Be(10);
        result.Batches[1].Key.MaterialId.Should().Be(11);
        result.Batches[2].Key.MaterialId.Should().Be(0);
    }

    [Fact]
    public void RequiresImmediateSplitsRuns()
    {
        var builder = new Render2DSpriteBatchBuilder();
        Render2DSpriteSubmission[] items =
        [
            Submission(1),
            Submission(1, requiresImmediate: true),
            Submission(1),
        ];

        Render2DSpriteBatchBuildResult result = builder.Build(items);

        result.Batches.Length.Should().Be(3);
        result.Batches[0].Key.RequiresImmediate.Should().BeFalse();
        result.Batches[1].Key.RequiresImmediate.Should().BeTrue();
        result.Batches[2].Key.RequiresImmediate.Should().BeFalse();
    }

    [Fact]
    public void BatchRangeTracksFirstSubmissionAndCount()
    {
        var builder = new Render2DSpriteBatchBuilder();
        Render2DSpriteSubmission[] items =
        [
            Submission(1),
            Submission(1, visible: false),
            Submission(1),
        ];

        Render2DSpriteBatchBuildResult result = builder.Build(items);

        result.Batches.Length.Should().Be(1);
        result.Batches[0].FirstSubmission.Should().Be(0);
        result.Batches[0].SubmissionCount.Should().Be(2);
        result.Batches[0].SpriteCount.Should().Be(2);
        result.SpriteCount.Should().Be(2);
    }

    [Fact]
    public void UvMathFlipMatchesPackedVertexWinding()
    {
        var builder = new Render2DSpriteBatchBuilder();
        Render2DSpriteBatchBuildResult result = builder.Build([Submission(1, flipX: true)]);

        Render2DUvMath.Resolve(new Rect(0.0f, 0.0f, 1.0f, 1.0f), true, false, out float u0, out _, out float u1, out _);
        Render2DSpriteVertex[] vertices = MemoryMarshal.Cast<byte, Render2DSpriteVertex>(result.VertexData).ToArray();

        u0.Should().Be(1.0f);
        u1.Should().Be(0.0f);
        vertices[0].U.Should().Be(Render2DSpriteVertex.PackUv(u0));
        vertices[1].U.Should().Be(Render2DSpriteVertex.PackUv(u1));
        vertices[0].Color.Should().Be(0xFFFFFFFFu);
    }

    [Fact]
    public void ColorPackerKeepsRgbaByteOrder()
    {
        uint packed = Render2DColorPacker.Pack(new Vec4(1.0f, 0.0f, 0.0f, 0.5f));

        packed.Should().Be(0x800000FFu);
        Render2DColorPacker.UnpackChannel(packed, 0).Should().Be(0xFF);
        Render2DColorPacker.UnpackChannel(packed, 1).Should().Be(0x00);
        Render2DColorPacker.UnpackChannel(packed, 2).Should().Be(0x00);
        Render2DColorPacker.UnpackChannel(packed, 3).Should().Be(0x80);
    }

    private static int BytesPerComponent(Render2DSpriteAttributeType type) => type switch
    {
        Render2DSpriteAttributeType.Scalar32 => 4,
        Render2DSpriteAttributeType.UNorm16 => 2,
        _ => 1,
    };
}
