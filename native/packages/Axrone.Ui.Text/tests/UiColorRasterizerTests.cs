namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiColorRasterizerTests
{
    [Fact]
    public void RendersSolidGlyphWithMaskAndAlpha()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.GlyphSolid));
        var rasterizer = new UiColorGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);
        bitmap.IsEmpty.Should().BeFalse();
        bitmap.Pixels.Length.Should().Be(bitmap.Width * bitmap.Height * 4);

        (byte r, byte g, byte b, byte a) inside = Sample(bitmap, 300.0f, 100.0f, 0.1f);
        inside.a.Should().BeGreaterThan(240);
        inside.r.Should().BeGreaterThan(240);
        inside.g.Should().BeLessThan(20);
        inside.b.Should().BeLessThan(20);

        (_, _, _, byte outsideAlpha) = Sample(bitmap, 20.0f, 720.0f, 0.1f);
        outsideAlpha.Should().BeLessThan(20);

        using var alphaProvider = new UiFontProvider();
        UiFontFaceId alphaFace = Register(alphaProvider, UiTestFont.CreateColorV1(UiTestColorV1.GlyphSolidAlpha));
        var alphaRasterizer = new UiColorGlyphRasterizer(alphaProvider);
        alphaRasterizer.TryRasterize(alphaFace, 0x41, 100.0f, out UiColorGlyphBitmap half, out error)
            .Should().BeTrue(error.Message);
        (byte halfRed, _, _, byte halfAlpha) = Sample(half, 300.0f, 100.0f, 0.1f);
        halfAlpha.Should().BeInRange(110, 145);
        halfRed.Should().BeInRange(110, 145);
    }

    [Fact]
    public void InterpolatesLinearGradientStopsAndAlpha()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.Glyph));
        var rasterizer = new UiColorGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        (byte leftRed, _, _, byte leftAlpha) = Sample(bitmap, 100.0f, 100.0f, 0.1f);
        (byte middleRed, _, _, byte middleAlpha) = Sample(bitmap, 320.0f, 100.0f, 0.1f);
        (byte rightRed, _, _, byte rightAlpha) = Sample(bitmap, 500.0f, 100.0f, 0.1f);

        leftAlpha.Should().BeGreaterThan(240);
        middleAlpha.Should().BeGreaterThan(240);
        rightAlpha.Should().BeGreaterThan(240);
        leftRed.Should().BeLessThan(middleRed);
        middleRed.Should().BeLessThan(rightRed);
        middleRed.Should().BeInRange(100, 160);

        using var alphaProvider = new UiFontProvider();
        UiFontFaceId alphaFace = Register(alphaProvider, UiTestFont.CreateColorV1(UiTestColorV1.LinearAlpha));
        var alphaRasterizer = new UiColorGlyphRasterizer(alphaProvider);
        alphaRasterizer.TryRasterize(alphaFace, 0x41, 100.0f, out UiColorGlyphBitmap alphaBitmap, out error)
            .Should().BeTrue(error.Message);
        (byte startRed, _, _, byte startAlpha) = Sample(alphaBitmap, 10.0f, 100.0f, 0.1f);
        (byte endRed, _, _, byte endAlpha) = Sample(alphaBitmap, 590.0f, 100.0f, 0.1f);
        startAlpha.Should().BeGreaterThan(240);
        endAlpha.Should().BeInRange(100, 170);
        endRed.Should().BeGreaterThan(100);
        startRed.Should().BeLessThan(30);
    }

    [Fact]
    public void RendersLayersAndRadialGradient()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.Layers));
        var rasterizer = new UiColorGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        (byte centerRed, _, _, byte centerAlpha) = Sample(bitmap, 320.0f, 330.0f, 0.1f);
        (byte edgeRed, _, _, byte edgeAlpha) = Sample(bitmap, 580.0f, 400.0f, 0.1f);
        centerAlpha.Should().BeGreaterThan(240);
        edgeAlpha.Should().BeGreaterThan(240);
        centerRed.Should().BeLessThan(30);
        edgeRed.Should().BeGreaterThan(60);
    }

    [Fact]
    public void AppliesClipBoxes()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.ClipGlyph));
        var rasterizer = new UiColorGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        (byte insideRed, _, _, byte insideAlpha) = Sample(bitmap, 150.0f, 100.0f, 0.1f);
        (_, _, _, byte clippedAlpha) = Sample(bitmap, 300.0f, 100.0f, 0.1f);
        insideAlpha.Should().BeGreaterThan(240);
        insideRed.Should().BeGreaterThan(240);
        clippedAlpha.Should().BeLessThan(20);
    }

    [Fact]
    public void RendersColrGlyphReference()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.ColrGlyph));
        var rasterizer = new UiColorGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x56, 100.0f, out UiColorGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        (byte r, byte g, byte b, byte a) = Sample(bitmap, 300.0f, 300.0f, 0.1f);
        a.Should().BeGreaterThan(240);
        r.Should().BeLessThan(20);
        g.Should().BeLessThan(20);
        b.Should().BeLessThan(20);
    }

    [Fact]
    public void AppliesPaintTransforms()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.TransformGlyph));
        var rasterizer = new UiColorGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);

        (_, _, _, byte originalAlpha) = Sample(bitmap, 100.0f, 100.0f, 0.1f);
        (byte movedRed, _, _, byte movedAlpha) = Sample(bitmap, 300.0f, 100.0f, 0.1f);
        originalAlpha.Should().BeLessThan(20);
        movedAlpha.Should().BeGreaterThan(240);
        movedRed.Should().BeGreaterThan(240);
    }

    [Fact]
    public void CompositesSourceOverAndPlus()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.Composite));
        var rasterizer = new UiColorGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap over, out UiFontError error)
            .Should().BeTrue(error.Message);
        (byte overRed, byte overGreen, byte overBlue, byte overAlpha) = Sample(over, 300.0f, 300.0f, 0.1f);
        overAlpha.Should().BeGreaterThan(240);
        overRed.Should().BeLessThan(20);
        overGreen.Should().BeLessThan(20);
        overBlue.Should().BeLessThan(20);

        using var plusProvider = new UiFontProvider();
        UiFontFaceId plusFace = Register(plusProvider, UiTestFont.CreateColorV1(UiTestColorV1.CompositePlus));
        var plusRasterizer = new UiColorGlyphRasterizer(plusProvider);
        plusRasterizer.TryRasterize(plusFace, 0x41, 100.0f, out UiColorGlyphBitmap plus, out error)
            .Should().BeTrue(error.Message);
        (byte plusRed, byte plusGreen, byte plusBlue, byte plusAlpha) = Sample(plus, 300.0f, 300.0f, 0.1f);
        plusAlpha.Should().BeGreaterThan(240);
        plusRed.Should().BeGreaterThan(240);
        plusGreen.Should().BeLessThan(20);
        plusBlue.Should().BeLessThan(20);
    }

    [Fact]
    public void SelectsPaletteAndRejectsInvalidConfiguredPalette()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.GlyphSolid));
        var rasterizer = new UiColorGlyphRasterizer(provider) { PaletteIndex = 1 };

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);
        (_, _, byte blue, byte alpha) = Sample(bitmap, 300.0f, 100.0f, 0.1f);
        alpha.Should().BeGreaterThan(240);
        blue.Should().BeGreaterThan(240);

        rasterizer.PaletteIndex = 7;
        rasterizer.TryRasterize(face, 0x41, 100.0f, out _, out UiFontError invalid)
            .Should().BeFalse();
        invalid.Code.Should().Be(UiFontErrorCode.InvalidColor);
    }

    [Fact]
    public void RejectsV0AndUnsupportedCompositeModes()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId v0Face = Register(provider, UiTestFont.CreateColor());
        var rasterizer = new UiColorGlyphRasterizer(provider);
        rasterizer.TryRasterize(v0Face, 0x41, 100.0f, out _, out UiFontError v0Error)
            .Should().BeFalse();
        v0Error.Code.Should().Be(UiFontErrorCode.UnsupportedColorFormat);

        using var unsupportedProvider = new UiFontProvider();
        UiFontFaceId unsupportedFace = Register(
            unsupportedProvider,
            UiTestFont.CreateColorV1(UiTestColorV1.CompositeUnsupported));
        var unsupportedRasterizer = new UiColorGlyphRasterizer(unsupportedProvider);
        unsupportedRasterizer.TryRasterize(unsupportedFace, 0x41, 100.0f, out _, out UiFontError modeError)
            .Should().BeFalse();
        modeError.Code.Should().Be(UiFontErrorCode.UnsupportedColorFormat);
    }

    [Fact]
    public void WarmColorRasterizationDoesNotAllocateAndIsDeterministic()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = Register(provider, UiTestFont.CreateColorV1(UiTestColorV1.Glyph));
        UiFontFaceId compositeFace = Register(
            provider,
            UiTestFont.CreateColorV1(UiTestColorV1.Composite),
            family: "Composite");
        var rasterizer = new UiColorGlyphRasterizer(provider);

        for (int i = 0; i < 32; i++)
        {
            _ = rasterizer.TryRasterize(face, 0x41, 100.0f, out _, out _);
            _ = rasterizer.TryRasterize(compositeFace, 0x41, 100.0f, out _, out _);
        }

        bool rasterized = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            rasterized &= rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap bitmap, out _);
            rasterized &= bitmap.IsEmpty == false;
            rasterized &= rasterizer.TryRasterize(compositeFace, 0x41, 100.0f, out UiColorGlyphBitmap composite, out _);
            rasterized &= composite.IsEmpty == false;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        rasterized.Should().BeTrue();
        allocated.Should().Be(0);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap first, out _).Should().BeTrue();
        byte[] firstPixels = first.Pixels.ToArray();
        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiColorGlyphBitmap second, out _).Should().BeTrue();
        second.Pixels.ToArray().Should().Equal(firstPixels);
    }

    private static (byte R, byte G, byte B, byte A) Sample(
        in UiColorGlyphBitmap bitmap,
        float fontX,
        float fontY,
        float scale)
    {
        int bottom = bitmap.BearingY - bitmap.Height;
        int column = (int)MathF.Floor(fontX * scale) - bitmap.BearingX;
        int rowFromBottom = (int)MathF.Floor(fontY * scale) - bottom;
        int row = bitmap.Height - 1 - rowFromBottom;
        if ((uint)column >= (uint)bitmap.Width || (uint)row >= (uint)bitmap.Height)
        {
            return (0, 0, 0, 0);
        }

        int offset = ((row * bitmap.Width) + column) * 4;
        return (
            bitmap.Pixels[offset],
            bitmap.Pixels[offset + 1],
            bitmap.Pixels[offset + 2],
            bitmap.Pixels[offset + 3]);
    }

    private static UiFontFaceId Register(UiFontProvider provider, byte[] font, string family = "Color")
    {
        UiFontFaceId face = provider.RegisterFace(
            font,
            new UiFontFaceDescriptor(family, UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);
        return face;
    }
}
