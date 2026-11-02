namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiSdfTests
{
    [Fact]
    public void ProducesSignedDistanceFieldWithAtlasPadding()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.Create());
        var rasterizer = new UiGlyphRasterizer(provider);
        var options = new UiSdfOptions(4.0f, 1);

        rasterizer.TryRasterizeSdf(face, 0xE9, 100.0f, options, out UiGlyphBitmap sdf, out UiFontError error)
            .Should().BeTrue(error.Message);
        rasterizer.TryRasterize(face, 0xE9, 100.0f, out UiGlyphBitmap coverage, out error)
            .Should().BeTrue(error.Message);

        sdf.Format.Should().Be(UiGlyphBitmapFormat.Sdf);
        coverage.Format.Should().Be(UiGlyphBitmapFormat.Coverage);
        sdf.Width.Should().Be(coverage.Width + 6);
        sdf.Height.Should().Be(coverage.Height + 6);
        sdf.BearingX.Should().Be(coverage.BearingX - 3);
        sdf.BearingY.Should().Be(coverage.BearingY + 3);
        sdf.Alpha.Length.Should().Be(sdf.Width * sdf.Height);

        byte center = Sample(sdf, 30.0f, 35.0f);
        center.Should().BeGreaterThan(240);
        sdf.Alpha[0].Should().BeLessThan(20);
    }

    [Fact]
    public void EncodesEdgeAtHalfIntensity()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.Create());
        var rasterizer = new UiGlyphRasterizer(provider);
        var options = new UiSdfOptions(8.0f, 2);

        rasterizer.TryRasterizeSdf(face, 0xE9, 100.0f, options, out UiGlyphBitmap sdf, out UiFontError error)
            .Should().BeTrue(error.Message);

        byte insideNearEdge = Sample(sdf, 0.5f, 35.0f);
        byte outsideNearEdge = Sample(sdf, -0.5f, 35.0f);
        insideNearEdge.Should().BeInRange(120, 180);
        outsideNearEdge.Should().BeInRange(80, 135);
        insideNearEdge.Should().BeGreaterThan(outsideNearEdge);
    }

    [Fact]
    public void SpreadControlsFalloff()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.Create());
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterizeSdf(face, 0xE9, 100.0f, new UiSdfOptions(2.0f, 1), out UiGlyphBitmap tight, out UiFontError error)
            .Should().BeTrue(error.Message);
        rasterizer.TryRasterizeSdf(face, 0xE9, 100.0f, new UiSdfOptions(8.0f, 1), out UiGlyphBitmap wide, out error)
            .Should().BeTrue(error.Message);

        byte tightValue = Sample(tight, -0.5f, 35.0f);
        byte wideValue = Sample(wide, -0.5f, 35.0f);
        wideValue.Should().BeGreaterThan(tightValue);
        tight.Alpha.SequenceEqual(wide.Alpha).Should().BeFalse();
    }

    [Fact]
    public void ResolutionIsDeterministic()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.Create());
        var rasterizer = new UiGlyphRasterizer(provider);
        var options = new UiSdfOptions(4.0f, 3);

        rasterizer.TryRasterizeSdf(face, 0x41, 100.0f, options, out UiGlyphBitmap first, out UiFontError error)
            .Should().BeTrue(error.Message);
        byte[] firstAlpha = first.Alpha.ToArray();
        rasterizer.TryRasterizeSdf(face, 0x41, 100.0f, options, out UiGlyphBitmap second, out _)
            .Should().BeTrue();

        second.Format.Should().Be(UiGlyphBitmapFormat.Sdf);
        second.Alpha.ToArray().Should().Equal(firstAlpha);
    }

    [Fact]
    public void SupportsCffOutlines()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.Create(cff: true));
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterizeSdf(face, 0x41, 100.0f, UiSdfOptions.Default, out UiGlyphBitmap sdf, out UiFontError error)
            .Should().BeTrue(error.Message);

        sdf.Format.Should().Be(UiGlyphBitmapFormat.Sdf);
        sdf.IsEmpty.Should().BeFalse();
        sdf.Alpha.ToArray().Should().Contain(value => value > 128);
    }

    [Fact]
    public void RejectsInvalidSdfOptions()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.Create());
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterizeSdf(face, 0x41, 100.0f, new UiSdfOptions(0.0f, 1), out _, out UiFontError zeroSpread)
            .Should().BeFalse();
        zeroSpread.Code.Should().Be(UiFontErrorCode.InvalidSdfSettings);

        rasterizer.TryRasterizeSdf(face, 0x41, 100.0f, new UiSdfOptions(float.NaN, 1), out _, out UiFontError nanSpread)
            .Should().BeFalse();
        nanSpread.Code.Should().Be(UiFontErrorCode.InvalidSdfSettings);

        rasterizer.TryRasterizeSdf(face, 0x41, 100.0f, new UiSdfOptions(4.0f, 0), out _, out UiFontError lowResolution)
            .Should().BeFalse();
        lowResolution.Code.Should().Be(UiFontErrorCode.InvalidSdfSettings);

        rasterizer.TryRasterizeSdf(face, 0x41, 100.0f, new UiSdfOptions(4.0f, 5), out _, out UiFontError highResolution)
            .Should().BeFalse();
        highResolution.Code.Should().Be(UiFontErrorCode.InvalidSdfSettings);
    }

    [Fact]
    public void WarmSdfRasterizationDoesNotAllocate()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.Create());
        var rasterizer = new UiGlyphRasterizer(provider);
        var options = new UiSdfOptions(4.0f, 2);

        for (int i = 0; i < 32; i++)
        {
            _ = rasterizer.TryRasterizeSdf(face, 0xE9, 100.0f, options, out _, out _);
            _ = rasterizer.TryRasterize(face, 0xE9, 100.0f, out _, out _);
        }

        bool rasterized = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            rasterized &= rasterizer.TryRasterizeSdf(face, 0xE9, 100.0f, options, out UiGlyphBitmap sdf, out _);
            rasterized &= !sdf.IsEmpty;
            rasterized &= rasterizer.TryRasterize(face, 0xE9, 100.0f, out UiGlyphBitmap coverage, out _);
            rasterized &= !coverage.IsEmpty;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        rasterized.Should().BeTrue();
        allocated.Should().Be(0);
    }

    private static byte Sample(in UiGlyphBitmap bitmap, float worldX, float worldY)
    {
        int bottom = bitmap.BearingY - bitmap.Height;
        int column = (int)MathF.Floor(worldX) - bitmap.BearingX;
        int row = (int)MathF.Floor(worldY) - bottom;
        if ((uint)column >= (uint)bitmap.Width || (uint)row >= (uint)bitmap.Height)
        {
            return 0;
        }

        return bitmap.Alpha[((bitmap.Height - 1 - row) * bitmap.Width) + column];
    }

    private static UiFontFaceId Register(UiFontProvider provider, byte[] font)
    {
        UiFontFaceId face = provider.RegisterFace(
            font,
            new UiFontFaceDescriptor("Sdf", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);
        return face;
    }
}
