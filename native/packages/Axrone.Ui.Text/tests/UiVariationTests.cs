namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiVariationTests
{
    private static readonly UiFontAxisTag Weight = UiFontAxisTag.FromFourCc("wght");
    private static readonly UiFontAxisTag Width = UiFontAxisTag.FromFourCc("wdth");

    [Fact]
    public void ParsesFvarAxes()
    {
        WithProvider(UiTestFont.CreateVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);

        _ = provider.TryGetFace(face, out UiFontFace? fontFace);
        fontFace!.IsVariable.Should().BeTrue();
        fontFace.AxisCount.Should().Be(1);
        fontFace.TryGetAxis(0, out UiFontAxis axis).Should().BeTrue();
        axis.Tag.Should().Be(Weight);
        axis.MinValue.Should().Be(100.0f);
        axis.DefaultValue.Should().Be(400.0f);
        axis.MaxValue.Should().Be(900.0f);
        fontFace.FindAxis(Weight).Should().Be(0);
        fontFace.FindAxis(Width).Should().Be(-1);
        fontFace.TryGetAxis(1, out _).Should().BeFalse();
        fontFace.TryGetNormalizedCoordinate(Weight, out float coordinate).Should().BeTrue();
        coordinate.Should().Be(0.0f);
    }

    [Fact]
    public void SelectsAndClampsVariationCoordinates()
    {
        WithProvider(UiTestFont.CreateVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);
        _ = provider.TryGetFace(face, out UiFontFace? fontFace);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out UiFontError error)
            .Should().BeTrue(error.Message);
        fontFace!.TryGetNormalizedCoordinate(Weight, out float coordinate).Should().BeTrue();
        coordinate.Should().Be(1.0f);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 100.0f)], out _).Should().BeTrue();
        fontFace.TryGetNormalizedCoordinate(Weight, out coordinate).Should().BeTrue();
        coordinate.Should().Be(-1.0f);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 2000.0f)], out _).Should().BeTrue();
        fontFace.TryGetNormalizedCoordinate(Weight, out coordinate).Should().BeTrue();
        coordinate.Should().Be(1.0f);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 400.0f)], out _).Should().BeTrue();
        fontFace.TryGetNormalizedCoordinate(Weight, out coordinate).Should().BeTrue();
        coordinate.Should().Be(0.0f);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 650.0f)], out _).Should().BeTrue();
        fontFace.TryGetNormalizedCoordinate(Weight, out coordinate).Should().BeTrue();
        coordinate.Should().Be(0.5f);

        provider.ClearVariation(face).Should().BeTrue();
        fontFace.TryGetNormalizedCoordinate(Weight, out coordinate).Should().BeTrue();
        coordinate.Should().Be(0.0f);
    }

    [Fact]
    public void RejectsUnknownAndNonFiniteAxisValues()
    {
        WithProvider(UiTestFont.CreateVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);

        provider.SetVariation(face, [new UiFontAxisValue(Width, 100.0f)], out UiFontError unknown)
            .Should().BeFalse();
        unknown.Code.Should().Be(UiFontErrorCode.InvalidVariation);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, float.NaN)], out UiFontError notFinite)
            .Should().BeFalse();
        notFinite.Code.Should().Be(UiFontErrorCode.InvalidVariation);

        WithProvider(UiTestFont.Create(), out UiFontProvider staticProvider, out UiFontFaceId staticFace, out _);
        staticProvider.SetVariation(staticFace, [new UiFontAxisValue(Weight, 500.0f)], out UiFontError missing)
            .Should().BeFalse();
        missing.Code.Should().Be(UiFontErrorCode.InvalidVariation);
    }

    [Fact]
    public void AppliesGlyphVariationToSimpleOutlines()
    {
        WithProvider(UiTestFont.CreateVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap baseline, out UiFontError error)
            .Should().BeTrue(error.Message);
        byte[] baselineAlpha = baseline.Alpha.ToArray();

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 400.0f)], out _).Should().BeTrue();
        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap defaultVariation, out _).Should().BeTrue();
        defaultVariation.Alpha.SequenceEqual(baselineAlpha).Should().BeTrue();

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out _).Should().BeTrue();
        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap varied, out _).Should().BeTrue();
        varied.Alpha.SequenceEqual(baselineAlpha).Should().BeFalse();
        varied.BearingX.Should().Be(baseline.BearingX);
    }

    [Fact]
    public void AppliesAvarSegmentMapping()
    {
        WithProvider(UiTestFont.CreateVariation(avar: true), out UiFontProvider provider, out UiFontFaceId face, out _);
        _ = provider.TryGetFace(face, out UiFontFace? fontFace);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 650.0f)], out _).Should().BeTrue();
        fontFace!.TryGetNormalizedCoordinate(Weight, out float mapped).Should().BeTrue();
        mapped.Should().Be(1.0f);

        var rasterizer = new UiGlyphRasterizer(provider);
        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap atMidpoint, out _).Should().BeTrue();
        byte[] midpointAlpha = atMidpoint.Alpha.ToArray();

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out _).Should().BeTrue();
        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap atMaximum, out _).Should().BeTrue();
        atMaximum.Alpha.SequenceEqual(midpointAlpha).Should().BeTrue();
    }

    [Fact]
    public void AppliesGlyphVariationToCompositeOffsets()
    {
        WithProvider(UiTestFont.CreateVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x42, 100.0f, out UiGlyphBitmap baseline, out UiFontError error)
            .Should().BeTrue(error.Message);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out _).Should().BeTrue();
        rasterizer.TryRasterize(face, 0x42, 100.0f, out UiGlyphBitmap varied, out _).Should().BeTrue();

        varied.Width.Should().BeGreaterThan(baseline.Width);
        varied.Alpha.SequenceEqual(baseline.Alpha.ToArray()).Should().BeFalse();
    }

    [Fact]
    public void RejectsMalformedVariationData()
    {
        byte[] corrupt = UiTestFont.CreateVariation(corruptGvar: true);
        ParseError(corrupt).Code.Should().Be(UiFontErrorCode.InvalidVariation);

        ParseError(UiTestFont.CreateCff2Tagged()).Code.Should().Be(UiFontErrorCode.UnsupportedOutlineFormat);
    }

    private static void WithProvider(
        byte[] font,
        out UiFontProvider provider,
        out UiFontFaceId face,
        out UiFontError error)
    {
        provider = new UiFontProvider();
        face = provider.RegisterFace(
            font,
            new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal),
            out error);
        face.IsValid.Should().BeTrue(error.Message);
    }

    private static UiFontError ParseError(byte[] font)
    {
        using UiFontBuffer buffer = UiFontBuffer.FromSpan(font);
        bool parsed = UiFontParser.TryParse(
            buffer,
            UiFontProvider.FromFamilyName("Test"),
            "Test",
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            out _,
            out UiFontError error);

        parsed.Should().BeFalse();
        return error;
    }
}
