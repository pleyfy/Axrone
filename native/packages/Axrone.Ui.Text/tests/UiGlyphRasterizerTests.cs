namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiGlyphRasterizerTests
{
    [Fact]
    public void RasterizesTriangleWithExpectedBoundsAndCoverage()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        bitmap.Width.Should().Be(62);
        bitmap.Height.Should().Be(72);
        bitmap.BearingX.Should().Be(-1);
        bitmap.BearingY.Should().Be(71);
        bitmap.Advance.Should().Be(60.0f);
        bitmap.Alpha.Length.Should().Be(62 * 72);

        byte[] alpha = bitmap.Alpha.ToArray();
        alpha.Sum(static value => value).Should().BeGreaterThan(0);
        alpha[(35 * 62) + 30].Should().BeGreaterThan(0);
        alpha[(0 * 62) + 1].Should().Be(0);
        alpha[(70 * 62) + 1].Should().BeGreaterThan(0);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap again, out _).Should().BeTrue();
        again.Alpha.ToArray().Should().Equal(alpha);
    }

    [Fact]
    public void RasterizesCompositeGlyphWithOffsetBounds()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x42, 100.0f, out UiGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        bitmap.Width.Should().Be(62);
        bitmap.Height.Should().Be(72);
        bitmap.BearingX.Should().Be(9);
        bitmap.BearingY.Should().Be(71);
        bitmap.Alpha.ToArray().Sum(static value => value).Should().BeGreaterThan(0);
    }

    [Fact]
    public void EmptyGlyphReturnsAdvanceOnly()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x20, 100.0f, out UiGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        bitmap.IsEmpty.Should().BeTrue();
        bitmap.Width.Should().Be(0);
        bitmap.Height.Should().Be(0);
        bitmap.Advance.Should().Be(30.0f);
        bitmap.Alpha.IsEmpty.Should().BeTrue();
    }

    [Fact]
    public void RasterizesRealFontGlyph()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.LoadRealFont(),
            new UiFontFaceDescriptor("KenPixel", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError registerError);
        face.IsValid.Should().BeTrue(registerError.Message);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 64.0f, out UiGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        bitmap.IsEmpty.Should().BeFalse();
        bitmap.Width.Should().BeGreaterThan(0);
        bitmap.Height.Should().BeGreaterThan(0);
        bitmap.Advance.Should().BeGreaterThan(0.0f);
        bitmap.Alpha.ToArray().Sum(static value => value).Should().BeGreaterThan(0);
    }

    [Fact]
    public void RejectsUnsupportedAndMissingInputs()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(new UiFontFaceId(9999), 0x41, 100.0f, out _, out UiFontError missingFace)
            .Should().BeFalse();
        missingFace.Code.Should().Be(UiFontErrorCode.FaceNotFound);

        rasterizer.TryRasterize(face, 0x5A, 100.0f, out _, out UiFontError missingGlyph).Should().BeFalse();
        missingGlyph.Code.Should().Be(UiFontErrorCode.GlyphNotFound);

        rasterizer.TryRasterize(face, 0x41, 0.0f, out _, out UiFontError zeroSize).Should().BeFalse();
        zeroSize.Code.Should().Be(UiFontErrorCode.InvalidPixelSize);

        rasterizer.TryRasterize(face, 0x41, float.NaN, out _, out UiFontError nanSize).Should().BeFalse();
        nanSize.Code.Should().Be(UiFontErrorCode.InvalidPixelSize);

        rasterizer.TryRasterize(face, 0x41, 5000.0f, out _, out UiFontError hugeSize).Should().BeFalse();
        hugeSize.Code.Should().Be(UiFontErrorCode.InvalidPixelSize);
    }

    [Fact]
    public void RasterizesCffOutlines()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.Create(cff: true),
            new UiFontFaceDescriptor("Cff", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError registerError);
        face.IsValid.Should().BeTrue(registerError.Message);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        bitmap.Width.Should().Be(52);
        bitmap.Height.Should().Be(62);
        bitmap.BearingX.Should().Be(4);
        bitmap.BearingY.Should().Be(61);
        bitmap.Advance.Should().Be(60.0f);
        bitmap.Alpha.ToArray().Sum(static value => value).Should().BeGreaterThan(0);
    }

    [Fact]
    public void EnforcesRasterDimensionLimit()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider, maxDimension: 32);

        rasterizer.TryRasterize(face, 0x41, 1000.0f, out _, out UiFontError error).Should().BeFalse();
        error.Code.Should().Be(UiFontErrorCode.RasterTooLarge);
    }

    [Fact]
    public void ValidatesConstruction()
    {
        using UiFontProvider provider = CreateProvider(out _);

        FluentActions.Invoking(static () => new UiGlyphRasterizer(null!)).Should().Throw<ArgumentNullException>();
        FluentActions.Invoking(() => new UiGlyphRasterizer(provider, maxDimension: 0)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(() => new UiGlyphRasterizer(provider, maxDimension: 5000)).Should().Throw<ArgumentOutOfRangeException>();
    }

    private static UiFontProvider CreateProvider(out UiFontFaceId face)
    {
        var provider = new UiFontProvider();
        face = provider.RegisterFace(
            UiTestFont.Create(),
            new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);
        return provider;
    }
}
