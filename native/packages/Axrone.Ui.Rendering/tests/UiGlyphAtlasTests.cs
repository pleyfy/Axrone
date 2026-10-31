namespace Axrone.Ui.Rendering.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiGlyphAtlasTests
{
    private static UiGlyphRaster Raster(int codePoint, int width, int height) =>
        new(new UiFontFaceId(1), codePoint, width, height, 1.0f, 2.0f, 9.0f, UiGlyphFormat.Alpha8);

    [Fact]
    public void FirstGlyphIsPlacedAtOriginWithNormalizedUv()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(64, 64, 0, 2, UiGlyphFormat.Alpha8));

        atlas.TryAddGlyph(Raster(65, 16, 8), default, out UiGlyphAtlasEntry entry).Should().BeTrue();

        entry.UvRect.Should().Be(new Rect(0.0f, 0.0f, 0.25f, 0.125f));
        entry.Width.Should().Be(16);
        entry.Height.Should().Be(8);
        entry.OriginX.Should().Be(1.0f);
        entry.Advance.Should().Be(9.0f);
        entry.Page.Value.Should().Be(1);
        atlas.PageCount.Should().Be(1);
    }

    [Fact]
    public void ShelfAdvancesRightAndWrapsToNextRow()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(64, 64, 0, 2, UiGlyphFormat.Alpha8));

        atlas.TryAddGlyph(Raster(65, 32, 8), default, out _);
        atlas.TryAddGlyph(Raster(66, 16, 8), default, out UiGlyphAtlasEntry second);
        atlas.TryAddGlyph(Raster(67, 32, 8), default, out UiGlyphAtlasEntry third);

        second.UvRect.X.Should().Be(0.5f);
        second.UvRect.Y.Should().Be(0.0f);
        third.UvRect.X.Should().Be(0.0f);
        third.UvRect.Y.Should().Be(0.125f);
    }

    [Fact]
    public void PaddingCreatesGapsBetweenGlyphs()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(64, 64, 2, 2, UiGlyphFormat.Alpha8));

        atlas.TryAddGlyph(Raster(65, 8, 8), default, out _);
        atlas.TryAddGlyph(Raster(66, 8, 8), default, out UiGlyphAtlasEntry second);

        second.UvRect.X.Should().Be(10.0f / 64.0f);
    }

    [Fact]
    public void PageOverflowCreatesSecondPage()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(16, 16, 0, 2, UiGlyphFormat.Alpha8));

        atlas.TryAddGlyph(Raster(65, 16, 16), default, out UiGlyphAtlasEntry first).Should().BeTrue();
        atlas.TryAddGlyph(Raster(66, 16, 16), default, out UiGlyphAtlasEntry second).Should().BeTrue();

        atlas.PageCount.Should().Be(2);
        first.Page.Value.Should().Be(1);
        second.Page.Value.Should().Be(2);
        atlas.Pages.Length.Should().Be(2);
        atlas.Pages[0].Value.Should().Be(1);
        atlas.Pages[1].Value.Should().Be(2);
    }

    [Fact]
    public void DuplicateGlyphIsNotUploadedTwice()
    {
        RecordingUploader uploader = new();
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(64, 64, 0, 2, UiGlyphFormat.Alpha8), uploader);
        byte[] pixels = new byte[16];

        atlas.TryAddGlyph(Raster(65, 4, 4), pixels, out UiGlyphAtlasEntry first).Should().BeTrue();
        atlas.TryAddGlyph(Raster(65, 4, 4), pixels, out UiGlyphAtlasEntry second).Should().BeTrue();

        first.Should().Be(second);
        uploader.UploadCount.Should().Be(1);
        uploader.CreatedPages.Should().Be(1);
    }

    [Fact]
    public void UploadReceivesTightlyPackedPixels()
    {
        RecordingUploader uploader = new();
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(64, 64, 0, 2, UiGlyphFormat.Alpha8), uploader);
        byte[] pixels = new byte[16];

        atlas.TryAddGlyph(Raster(65, 4, 4), pixels, out _);

        uploader.UploadCount.Should().Be(1);
        uploader.LastPixelRect.Should().Be(new Rect(0, 0, 4, 4));
        uploader.LastPixelLength.Should().Be(16);
    }

    [Fact]
    public void ShortPixelBufferIsRejected()
    {
        RecordingUploader uploader = new();
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(64, 64, 0, 2, UiGlyphFormat.Alpha8), uploader);

        atlas.TryAddGlyph(Raster(65, 4, 4), new byte[15], out UiGlyphAtlasEntry entry).Should().BeFalse();

        entry.Should().Be(default(UiGlyphAtlasEntry));
        uploader.UploadCount.Should().Be(0);
        atlas.PageCount.Should().Be(0);
    }

    [Fact]
    public void OversizeGlyphIsRejectedWithoutAllocatingPage()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(16, 16, 0, 2, UiGlyphFormat.Alpha8));

        atlas.TryAddGlyph(Raster(65, 17, 8), default, out _).Should().BeFalse();
        atlas.PageCount.Should().Be(0);
    }

    [Fact]
    public void LeastRecentlyUsedPageIsEvicted()
    {
        RecordingEvictionListener listener = new();
        UiGlyphAtlas atlas = new(
            new UiGlyphAtlasOptions(8, 8, 0, 2, UiGlyphFormat.Alpha8),
            uploader: null,
            evictionListener: listener);

        atlas.TryAddGlyph(Raster(65, 8, 8), default, out UiGlyphAtlasEntry first);
        atlas.Tick();
        atlas.TryAddGlyph(Raster(66, 8, 8), default, out UiGlyphAtlasEntry second);
        atlas.Tick();

        atlas.TryGetEntry(new UiFontFaceId(1), 65, out _).Should().BeTrue();
        atlas.TryAddGlyph(Raster(67, 8, 8), default, out _).Should().BeTrue();

        atlas.EvictionCount.Should().Be(1);
        atlas.PageCount.Should().Be(2);
        listener.Evicted.Should().Equal(second.Page);
        atlas.TryGetEntry(new UiFontFaceId(1), 66, out _).Should().BeFalse();
        atlas.TryGetEntry(new UiFontFaceId(1), 65, out _).Should().BeTrue();
        atlas.TryGetEntry(new UiFontFaceId(1), 67, out _).Should().BeTrue();
        atlas.Pages[0].Should().Be(first.Page);
    }

    [Fact]
    public void SinglePageAtlasEvictsItselfToMakeRoom()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(8, 8, 0, 1, UiGlyphFormat.Alpha8));

        atlas.TryAddGlyph(Raster(65, 8, 8), default, out _);
        atlas.TryAddGlyph(Raster(66, 8, 8), default, out UiGlyphAtlasEntry second).Should().BeTrue();

        atlas.PageCount.Should().Be(1);
        atlas.EvictionCount.Should().Be(1);
        atlas.TryGetEntry(new UiFontFaceId(1), 65, out _).Should().BeFalse();
        second.Page.Value.Should().Be(2);
    }

    [Fact]
    public void LookupIsZeroAllocation()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(64, 64, 0, 2, UiGlyphFormat.Alpha8));
        atlas.TryAddGlyph(Raster(65, 4, 4), default, out _);
        atlas.TryAddGlyph(Raster(66, 4, 4), default, out _);

        static int Probe(UiGlyphAtlas target)
        {
            int hits = 0;
            for (int i = 0; i < 256; i++)
            {
                if (target.TryGetEntry(new UiFontFaceId(1), i < 128 ? 65 : 66, out _))
                {
                    hits++;
                }
            }

            return hits;
        }

        Probe(atlas);
        Probe(atlas);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int hits = Probe(atlas);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        hits.Should().Be(256);
        delta.Should().Be(0);
    }

    [Fact]
    public void DisposeDeletesEveryPageOnce()
    {
        RecordingUploader uploader = new();
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(8, 8, 0, 2, UiGlyphFormat.Alpha8), uploader);
        atlas.TryAddGlyph(Raster(65, 8, 8), default, out _);
        atlas.TryAddGlyph(Raster(66, 8, 8), default, out _);

        atlas.Dispose();
        atlas.Dispose();

        uploader.DeletedPages.Should().Be(2);
        atlas.PageCount.Should().Be(0);
        atlas.IsDisposed.Should().BeTrue();
    }

    [Fact]
    public void AddingToDisposedAtlasThrows()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(8, 8, 0, 1, UiGlyphFormat.Alpha8));
        atlas.Dispose();

        Action act = () => atlas.TryAddGlyph(Raster(65, 4, 4), default, out _);
        act.Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void InvalidOptionsThrow()
    {
        Action small = static () => _ = new UiGlyphAtlas(new UiGlyphAtlasOptions(4, 4, 0, 1, UiGlyphFormat.Alpha8));
        Action pages = static () => _ = new UiGlyphAtlas(new UiGlyphAtlasOptions(64, 64, 0, 0, UiGlyphFormat.Alpha8));
        Action padding = static () => _ = new UiGlyphAtlas(new UiGlyphAtlasOptions(64, 64, -1, 1, UiGlyphFormat.Alpha8));

        small.Should().Throw<ArgumentOutOfRangeException>();
        pages.Should().Throw<ArgumentOutOfRangeException>();
        padding.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void PageInfoReportsAllocationState()
    {
        UiGlyphAtlas atlas = new(new UiGlyphAtlasOptions(64, 64, 0, 2, UiGlyphFormat.Alpha8));
        atlas.TryAddGlyph(Raster(65, 16, 16), default, out UiGlyphAtlasEntry first);
        atlas.TryAddGlyph(Raster(66, 16, 16), default, out _);

        atlas.TryGetPage(first.Page, out UiGlyphAtlasPageInfo info).Should().BeTrue();
        info.Width.Should().Be(64);
        info.Height.Should().Be(64);
        info.AllocatedGlyphs.Should().Be(2);
        info.Format.Should().Be(UiGlyphFormat.Alpha8);
        info.Texture.IsValid.Should().BeTrue();

        atlas.TryGetPage(new UiGlyphAtlasPageId(99), out _).Should().BeFalse();
    }

    private sealed class RecordingUploader : IUiGlyphAtlasUploader
    {
        public int CreatedPages;
        public int UploadCount;
        public int LastPixelLength;
        public Rect LastPixelRect;
        public int DeletedPages;

        public UiResourceId CreatePage(UiGlyphAtlasPageId page, int width, int height, UiGlyphFormat format)
        {
            CreatedPages++;
            return new UiResourceId(100UL + page.Value);
        }

        public void UploadGlyph(UiGlyphAtlasPageId page, in Rect pixelRect, ReadOnlySpan<byte> pixels)
        {
            UploadCount++;
            LastPixelRect = pixelRect;
            LastPixelLength = pixels.Length;
        }

        public void DeletePage(UiGlyphAtlasPageId page) => DeletedPages++;
    }

    private sealed class RecordingEvictionListener : IUiGlyphAtlasEvictionListener
    {
        public List<UiGlyphAtlasPageId> Evicted { get; } = [];

        public void OnGlyphPageEvicted(UiGlyphAtlasPageId page) => Evicted.Add(page);
    }
}
