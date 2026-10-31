namespace Axrone.Ui.Rendering.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiNineSliceTests
{
    private static UiRenderCommand SlicedImage(in Rect bounds, in UiEdgeInsets border, in Rect uv, UiRenderFlags flags = UiRenderFlags.None) =>
        UiRenderCommand.Image(
            new UiNodeId(1),
            bounds,
            new UiResourceId(9),
            uv,
            UiColor.White,
            0,
            opacity: 0.5f).WithSliceBorder(border) with
        {
            Flags = UiRenderFlags.NineSlice | flags,
        };

    [Fact]
    public void NineSliceExpandsToNineInstances()
    {
        UiRenderCommand command = SlicedImage(
            new Rect(0, 0, 100, 50),
            new UiEdgeInsets(Top: 10, Right: 10, Bottom: 10, Left: 10),
            new Rect(0, 0, 1, 1));

        Span<UiImageInstance> instances = stackalloc UiImageInstance[UiNineSlice.MaxInstances];
        int count = UiInstanceEncoder.EncodeImage(in command, new UiSize(100, 50), instances);

        count.Should().Be(9);
        instances[4].Bounds.Should().Be(new Rect(10, 10, 80, 30));
        instances[4].UvRect.X.Should().BeApproximately(0.1f, 1e-5f);
        instances[4].UvRect.Y.Should().BeApproximately(0.2f, 1e-5f);
        instances[4].UvRect.Width.Should().BeApproximately(0.8f, 1e-5f);
        instances[4].UvRect.Height.Should().BeApproximately(0.6f, 1e-5f);
        instances[4].Opacity.Should().Be(0.5f);
        instances[4].Radii.Should().Be(UiCornerRadii.Zero);
    }

    [Fact]
    public void CollapsedMiddleYieldsSixInstances()
    {
        UiRenderCommand command = SlicedImage(
            new Rect(0, 0, 20, 20),
            new UiEdgeInsets(Top: 5, Right: 10, Bottom: 5, Left: 10),
            new Rect(0, 0, 1, 1));

        Span<UiImageInstance> instances = stackalloc UiImageInstance[UiNineSlice.MaxInstances];
        int count = UiInstanceEncoder.EncodeImage(in command, new UiSize(20, 20), instances);

        count.Should().Be(6);
    }

    [Fact]
    public void BordersAreClampedToExtent()
    {
        UiRenderCommand command = SlicedImage(
            new Rect(0, 0, 100, 100),
            new UiEdgeInsets(Top: 80, Right: 80, Bottom: 80, Left: 80),
            new Rect(0, 0, 1, 1));

        Span<UiImageInstance> instances = stackalloc UiImageInstance[UiNineSlice.MaxInstances];
        UiInstanceEncoder.EncodeImage(in command, new UiSize(100, 100), instances);

        UiNineSlice.ComputeAxis(100, 80, 80, 100, 0, 1,
            out UiSliceSpan start, out UiSliceSpan middle, out UiSliceSpan end);

        start.Size.Should().Be(80);
        middle.Size.Should().Be(0);
        end.Size.Should().Be(20);
        middle.IsDrawable.Should().BeFalse();
    }

    [Fact]
    public void FlipXMirrorsSpanUv()
    {
        UiRenderCommand plain = SlicedImage(
            new Rect(0, 0, 100, 100),
            new UiEdgeInsets(10, 10, 10, 10),
            new Rect(0, 0, 1, 1));
        UiRenderCommand flipped = plain with { Flags = UiRenderFlags.NineSlice | UiRenderFlags.FlipX };

        Span<UiImageInstance> a = stackalloc UiImageInstance[UiNineSlice.MaxInstances];
        Span<UiImageInstance> b = stackalloc UiImageInstance[UiNineSlice.MaxInstances];

        int countA = UiNineSlice.Build(in plain, new UiSize(100, 100), a);
        int countB = UiNineSlice.Build(in flipped, new UiSize(100, 100), b);

        countA.Should().Be(9);
        countB.Should().Be(9);

        // Top-left slice of the flipped image samples the source's top-right corner.
        a[0].UvRect.X.Should().BeApproximately(0.0f, 1e-5f);
        b[0].UvRect.X.Should().BeApproximately(0.9f, 1e-5f);
        b[2].UvRect.X.Should().BeApproximately(0.0f, 1e-5f);
    }

    [Fact]
    public void FillFitReturnsDestination()
    {
        Rect destination = new(5, 6, 40, 20);
        UiImageFitResolver.TryResolve(UiImageFit.Fill, destination, new UiSize(10, 10), out Rect result).Should().BeTrue();
        result.Should().Be(destination);
    }

    [Fact]
    public void ContainFitCentersWithAspect()
    {
        UiImageFitResolver.TryResolve(UiImageFit.Contain, new Rect(0, 0, 100, 100), new UiSize(200, 100), out Rect result)
            .Should().BeTrue();

        result.Width.Should().Be(100);
        result.Height.Should().Be(50);
        result.X.Should().Be(0);
        result.Y.Should().Be(25);
    }

    [Fact]
    public void CoverFitOverflowsAndCenters()
    {
        UiImageFitResolver.TryResolve(UiImageFit.Cover, new Rect(0, 0, 100, 100), new UiSize(200, 100), out Rect result)
            .Should().BeTrue();

        result.Width.Should().Be(200);
        result.Height.Should().Be(100);
        result.X.Should().Be(-50);
        result.Y.Should().Be(0);
    }

    [Fact]
    public void ScaleDownNeverUpscales()
    {
        UiImageFitResolver.TryResolve(UiImageFit.ScaleDown, new Rect(0, 0, 100, 100), new UiSize(10, 10), out Rect result)
            .Should().BeTrue();

        result.Width.Should().Be(10);
        result.Height.Should().Be(10);
    }

    [Fact]
    public void InvalidSourceFailsContainButNotFill()
    {
        UiImageFitResolver.TryResolve(UiImageFit.Contain, new Rect(0, 0, 10, 10), new UiSize(0, 0), out _)
            .Should().BeFalse();
        UiImageFitResolver.TryResolve(UiImageFit.Fill, new Rect(0, 0, 10, 10), new UiSize(0, 0), out Rect filled)
            .Should().BeTrue();
        filled.Width.Should().Be(10);
    }

    [Fact]
    public void EncodeImageWithFitProducesSingleInstance()
    {
        UiRenderCommand command = UiRenderCommand.Image(
            new UiNodeId(1),
            new Rect(0, 0, 100, 100),
            new UiResourceId(1),
            new Rect(0, 0, 1, 1),
            UiColor.White,
            0,
            fit: UiImageFit.Contain);

        Span<UiImageInstance> instances = stackalloc UiImageInstance[1];
        int count = UiInstanceEncoder.EncodeImage(in command, new UiSize(100, 200), instances);

        count.Should().Be(1);
        instances[0].Bounds.Should().Be(new Rect(25, 0, 50, 100));
    }

    [Fact]
    public void EmptyDestinationWritesNothing()
    {
        UiRenderCommand quad = UiRenderCommand.Quad(new UiNodeId(1), new Rect(0, 0, 1, 1), UiColor.White, 0);
        UiInstanceEncoder.EncodeQuad(in quad, Span<UiQuadInstance>.Empty).Should().Be(0);

        UiRenderCommand image = SlicedImage(new Rect(0, 0, 10, 10), new UiEdgeInsets(1, 1, 1, 1), new Rect(0, 0, 1, 1));
        UiInstanceEncoder.EncodeImage(in image, new UiSize(10, 10), Span<UiImageInstance>.Empty).Should().Be(0);
    }

    [Fact]
    public void GlyphEncodingSkipsMissingEntries()
    {
        FakeAtlas atlas = new();
        atlas.Add(new UiFontFaceId(1), 65, new Rect(0, 0, 0.1f, 0.1f), width: 8, height: 10, originX: 1, originY: 2);

        FakeLayout layout = new(
        new UiShapedGlyph[]
        {
            new(65, 0, 0, 0, 9, 0),
            new(66, 1, 9, 0, 9, 0),
        });

        UiRenderCommand command = UiRenderCommand.Text(
            new UiNodeId(1),
            new Rect(10, 20, 100, 20),
            new UiTextLayoutId(1),
            UiColor.White,
            0,
            opacity: 0.75f);

        Span<UiGlyphInstance> instances = stackalloc UiGlyphInstance[4];
        int count = UiInstanceEncoder.EncodeGlyphs(in command, new UiFontFaceId(1), layout, atlas, instances, out int missed);

        count.Should().Be(1);
        missed.Should().Be(1);
        instances[0].Bounds.Should().Be(new Rect(9, 18, 8, 10));
        instances[0].Opacity.Should().Be(0.75f);
        instances[0].UvRect.Width.Should().Be(0.1f);
    }

    [Fact]
    public void GlyphEncodingStopsAtDestinationCapacity()
    {
        FakeAtlas atlas = new();
        atlas.Add(new UiFontFaceId(1), 65, new Rect(0, 0, 0.1f, 0.1f), 8, 10, 0, 0);

        FakeLayout layout = new(
        new UiShapedGlyph[]
        {
            new(65, 0, 0, 0, 9, 0),
            new(65, 1, 9, 0, 9, 0),
            new(65, 2, 18, 0, 9, 0),
        });

        UiRenderCommand command = UiRenderCommand.Text(
            new UiNodeId(1), new Rect(0, 0, 100, 20), new UiTextLayoutId(1), UiColor.White, 0);

        Span<UiGlyphInstance> instances = stackalloc UiGlyphInstance[2];
        int count = UiInstanceEncoder.EncodeGlyphs(in command, new UiFontFaceId(1), layout, atlas, instances, out int missed);

        count.Should().Be(2);
        missed.Should().Be(1);
    }

    private sealed class FakeAtlas : IUiGlyphAtlas
    {
        private static readonly UiGlyphAtlasPageId[] PageIds = [new UiGlyphAtlasPageId(1)];
        private readonly Dictionary<(uint Face, int CodePoint), UiGlyphAtlasEntry> _entries = [];

        public int PageCount => 1;

        public ReadOnlySpan<UiGlyphAtlasPageId> Pages => PageIds;

        public void Add(UiFontFaceId face, int codePoint, Rect uv, float width, float height, float originX, float originY) =>
            _entries[(face.Value, codePoint)] = new UiGlyphAtlasEntry(
                face, codePoint, new UiGlyphAtlasPageId(1), new UiResourceId(1), uv, width, height, originX, originY, width, UiGlyphFormat.Alpha8);

        public bool TryGetPage(UiGlyphAtlasPageId page, out UiGlyphAtlasPageInfo info)
        {
            info = new UiGlyphAtlasPageInfo(page, new UiResourceId(1), 128, 128, _entries.Count, UiGlyphFormat.Alpha8);
            return page.Value == 1;
        }

        public bool TryGetEntry(UiFontFaceId face, int codePoint, out UiGlyphAtlasEntry entry) =>
            _entries.TryGetValue((face.Value, codePoint), out entry);
    }

    private sealed class FakeLayout(ReadOnlyMemory<UiShapedGlyph> glyphs) : IUiTextLayout
    {
        public UiTextLayoutId Id => new(1);

        public UiSize Size => new(100, 20);

        public UiTextMetrics Metrics => new(100, 20, 20, 15, 1, false);

        public ReadOnlySpan<UiShapedGlyph> Glyphs => glyphs.Span;
    }
}
