namespace Axrone.Ui.Rendering.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiRenderingContractTests
{
    [Fact]
    public void QuadFactorySetsKindBoundsAndColor()
    {
        UiRenderCommand command = UiRenderCommand.Quad(
            new UiNodeId(3),
            new Rect(1.0f, 2.0f, 30.0f, 40.0f),
            UiColor.White,
            zIndex: 2,
            opacity: 0.5f);

        command.Kind.Should().Be(UiRenderCommandKind.Quad);
        command.Node.Should().Be(new UiNodeId(3));
        command.Bounds.Width.Should().Be(30.0f);
        command.Color.Should().Be(UiColor.White);
        command.ZIndex.Should().Be(2);
        command.Opacity.Should().Be(0.5f);
    }

    [Fact]
    public void ImageFactoryCarriesResourceUvAndSampling()
    {
        UiRenderCommand command = UiRenderCommand.Image(
            new UiNodeId(5),
            new Rect(0.0f, 0.0f, 64.0f, 64.0f),
            new UiResourceId(11UL),
            new Rect(0.0f, 0.0f, 1.0f, 1.0f),
            UiColor.White,
            zIndex: 0,
            fit: UiImageFit.Contain,
            sampling: UiImageSampling.Nearest);

        command.Kind.Should().Be(UiRenderCommandKind.Image);
        command.Resource.Should().Be(new UiResourceId(11UL));
        command.Fit.Should().Be(UiImageFit.Contain);
        command.Sampling.Should().Be(UiImageSampling.Nearest);
        command.UvRect.Height.Should().Be(1.0f);
    }

    [Fact]
    public void WithClipAndSliceBorderSetFlags()
    {
        UiRenderCommand clipped = UiRenderCommand
            .Text(new UiNodeId(6), new Rect(0.0f, 0.0f, 10.0f, 10.0f), new UiTextLayoutId(2), UiColor.Black, 0)
            .WithClip(new Rect(0.0f, 0.0f, 5.0f, 5.0f));

        (clipped.Flags & UiRenderFlags.Clip).Should().Be(UiRenderFlags.Clip);
        clipped.Clip.Width.Should().Be(5.0f);
        clipped.Kind.Should().Be(UiRenderCommandKind.Text);

        UiRenderCommand sliced = UiRenderCommand
            .Image(new UiNodeId(7), new Rect(0.0f, 0.0f, 40.0f, 20.0f), new UiResourceId(1UL), new Rect(0.0f, 0.0f, 1.0f, 1.0f), UiColor.White, 0)
            .WithSliceBorder(new UiEdgeInsets(4.0f, 4.0f, 4.0f, 4.0f));

        (sliced.Flags & UiRenderFlags.NineSlice).Should().Be(UiRenderFlags.NineSlice);
        sliced.SliceBorder.Left.Should().Be(4.0f);
    }

    [Fact]
    public void BatchKeyEqualityCoversClipAndSampling()
    {
        UiBatchKey first = new(
            UiRenderCommandKind.Quad,
            new UiResourceId(1UL),
            UiGlyphAtlasPageId.Invalid,
            UiBlendMode.Alpha,
            UiImageSampling.Linear,
            HasClip: false,
            default);

        UiBatchKey same = first;
        UiBatchKey otherSampling = first with { Sampling = UiImageSampling.Nearest };
        UiBatchKey otherClip = first with { HasClip = true };

        same.Should().Be(first);
        otherSampling.Should().NotBe(first);
        otherClip.Should().NotBe(first);
    }

    [Fact]
    public void FrameMetricsIsPlainValue()
    {
        UiFrameMetrics metrics = new(
            WidgetCount: 10,
            VisibleWidgetCount: 8,
            RenderCount: 12,
            CustomCommandCount: 1,
            ImageCommandCount: 2,
            TextCommandCount: 3,
            StrokeCommandCount: 1,
            GlyphCount: 40,
            LayoutPasses: 2);

        metrics.WidgetCount.Should().Be(10);
        metrics.GlyphCount.Should().Be(40);
        metrics.LayoutPasses.Should().Be(2);
    }

    [Fact]
    public void GlyphAtlasEntryCarriesPlacement()
    {
        UiGlyphAtlasEntry entry = new(
            new UiFontFaceId(1),
            CodePoint: 65,
            new UiGlyphAtlasPageId(2),
            new UiResourceId(3UL),
            new Rect(0.0f, 0.0f, 0.0625f, 0.0625f),
            16.0f,
            16.0f,
            OriginX: 1.0f,
            OriginY: 14.0f,
            Advance: 12.0f,
            UiGlyphFormat.Sdf);

        entry.Face.Should().Be(new UiFontFaceId(1));
        entry.CodePoint.Should().Be(65);
        entry.Page.Should().Be(new UiGlyphAtlasPageId(2));
        entry.Format.Should().Be(UiGlyphFormat.Sdf);
        entry.Advance.Should().Be(12.0f);
    }

    [Fact]
    public void OverlayAttachmentCarriesSpaceAndScale()
    {
        UiOverlayAttachment attachment = new(
            new UiDocumentId(1),
            Axrone.Scene.SceneActor.Null,
            UiOverlaySpace.World,
            ZOrder: 4,
            PixelsPerUnit: 100.0f);

        attachment.Document.Should().Be(new UiDocumentId(1));
        attachment.Space.Should().Be(UiOverlaySpace.World);
        attachment.ZOrder.Should().Be(4);
        attachment.Host.IsNull.Should().BeTrue();
    }

    [Fact]
    public void PipelineDescriptorEqualityDrivesCacheIdentity()
    {
        UiPipelineDescriptor descriptor = new(new UiResourceId(1UL), UiBlendMode.Alpha, UiImageSampling.Linear, false);

        (descriptor with { }).Should().Be(descriptor);
        (descriptor with { Blend = UiBlendMode.Additive }).Should().NotBe(descriptor);
    }
}
