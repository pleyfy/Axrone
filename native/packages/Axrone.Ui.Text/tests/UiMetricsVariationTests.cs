namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiMetricsVariationTests
{
    private static readonly UiFontAxisTag Weight = UiFontAxisTag.FromFourCc("wght");

    [Fact]
    public void AppliesHvarAdvanceAndLeftSideBearing()
    {
        WithProvider(UiTestFont.CreateMetricsVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);
        _ = provider.TryGetFace(face, out UiFontFace? fontFace);

        fontFace!.TryGetGlyphMetrics(0x41, out UiGlyphMetrics baseA).Should().BeTrue();
        baseA.Advance.Should().Be(600.0f);
        baseA.BearingX.Should().Be(0.0f);

        fontFace.TryGetGlyphMetrics(0x56, out UiGlyphMetrics baseV).Should().BeTrue();
        baseV.Advance.Should().Be(600.0f);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out UiFontError error)
            .Should().BeTrue(error.Message);

        fontFace.TryGetGlyphMetrics(0x41, out UiGlyphMetrics variedA).Should().BeTrue();
        variedA.Advance.Should().Be(700.0f);
        variedA.BearingX.Should().Be(50.0f);

        fontFace.TryGetGlyphMetrics(0x56, out UiGlyphMetrics variedV).Should().BeTrue();
        variedV.Advance.Should().Be(650.0f);
        variedV.BearingX.Should().Be(100.0f);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 400.0f)], out _).Should().BeTrue();
        fontFace.TryGetGlyphMetrics(0x41, out UiGlyphMetrics defaultA).Should().BeTrue();
        defaultA.Advance.Should().Be(600.0f);
        defaultA.BearingX.Should().Be(0.0f);
    }

    [Fact]
    public void AppliesMvarMetrics()
    {
        WithProvider(UiTestFont.CreateMetricsVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);
        _ = provider.TryGetFace(face, out UiFontFace? fontFace);

        fontFace!.Ascender.Should().Be(800);
        fontFace.Descender.Should().Be(-200);
        fontFace.LineGap.Should().Be(100);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out _).Should().BeTrue();
        fontFace.Ascender.Should().Be(850);
        fontFace.Descender.Should().Be(-230);
        fontFace.LineGap.Should().Be(120);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 650.0f)], out _).Should().BeTrue();
        fontFace.Ascender.Should().Be(825);
        fontFace.Descender.Should().Be(-215);
        fontFace.LineGap.Should().Be(110);

        provider.ClearVariation(face).Should().BeTrue();
        fontFace.Ascender.Should().Be(800);
        fontFace.Descender.Should().Be(-200);
        fontFace.LineGap.Should().Be(100);
    }

    [Fact]
    public void ShapingUsesHvarAdvances()
    {
        WithProvider(UiTestFont.CreateMetricsVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[4];
        UiTextStyle style = Style(face);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out _).Should().BeTrue();
        int count = shaper.Shape("AV".AsSpan(), style, glyphs);

        count.Should().Be(2);
        glyphs[0].Advance.Should().Be(700.0f);
        glyphs[1].Advance.Should().Be(650.0f);
    }

    [Fact]
    public void MissingMetricTablesKeepBaseValues()
    {
        WithProvider(UiTestFont.CreateVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);
        _ = provider.TryGetFace(face, out UiFontFace? fontFace);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out _).Should().BeTrue();
        fontFace!.TryGetGlyphMetrics(0x41, out UiGlyphMetrics metrics).Should().BeTrue();
        metrics.Advance.Should().Be(600.0f);
        metrics.BearingX.Should().Be(0.0f);
        fontFace.Ascender.Should().Be(800);
        fontFace.Descender.Should().Be(-200);
        fontFace.LineGap.Should().Be(100);
    }

    [Fact]
    public void RejectsMalformedMetricVariationTables()
    {
        ParseError(UiTestFont.CreateMetricsVariation(corruptHvar: true)).Code
            .Should().Be(UiFontErrorCode.InvalidVariation);
        ParseError(UiTestFont.CreateMetricsVariation(corruptMvar: true)).Code
            .Should().Be(UiFontErrorCode.InvalidVariation);
    }

    [Fact]
    public void MetricVariationIsDeterministicAndAllocationFree()
    {
        WithProvider(UiTestFont.CreateMetricsVariation(), out UiFontProvider provider, out UiFontFaceId face, out _);
        _ = provider.TryGetFace(face, out UiFontFace? fontFace);
        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out _).Should().BeTrue();
        var shaper = new UiTextShaper(provider);
        var measurer = new UiTextMeasurer(provider);
        var rasterizer = new UiGlyphRasterizer(provider);
        UiTextStyle style = Style(face, wrap: UiTextWrap.Word);
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1000.0f, float.PositiveInfinity);
        var glyphs = new UiShapedGlyph[8];

        for (int i = 0; i < 32; i++)
        {
            _ = shaper.Shape("AV".AsSpan(), style, glyphs);
            _ = measurer.Measure("AV".AsSpan(), style, constraints);
            _ = rasterizer.TryRasterize(face, 0x41, 100.0f, out _, out _);
        }

        bool ok = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            ok &= shaper.Shape("AV".AsSpan(), style, glyphs) == 2;
            ok &= measurer.Measure("AV".AsSpan(), style, constraints).Width > 0.0f;
            ok &= rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap bitmap, out _);
            ok &= !bitmap.IsEmpty;
            ok &= fontFace!.Ascender == 850;
            ok &= fontFace.Descender == -230;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        ok.Should().BeTrue();
        allocated.Should().Be(0);

        UiTextMetrics first = measurer.Measure("AV".AsSpan(), style, constraints);
        UiTextMetrics second = measurer.Measure("AV".AsSpan(), style, constraints);
        first.Should().Be(second);

        var firstGlyphs = new UiShapedGlyph[8];
        var secondGlyphs = new UiShapedGlyph[8];
        int firstCount = shaper.Shape("AV".AsSpan(), style, firstGlyphs);
        int secondCount = shaper.Shape("AV".AsSpan(), style, secondGlyphs);
        firstCount.Should().Be(secondCount);
        firstGlyphs.AsSpan(0, firstCount).SequenceEqual(secondGlyphs.AsSpan(0, secondCount)).Should().BeTrue();

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap firstBitmap, out _).Should().BeTrue();
        byte[] alpha = firstBitmap.Alpha.ToArray();
        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap secondBitmap, out _).Should().BeTrue();
        secondBitmap.Alpha.ToArray().Should().Equal(alpha);
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
            new UiFontFaceDescriptor("Metrics", UiFontWeight.Normal, UiFontStyle.Normal),
            out error);
        face.IsValid.Should().BeTrue(error.Message);
    }

    private static UiFontError ParseError(byte[] font)
    {
        using UiFontBuffer buffer = UiFontBuffer.FromSpan(font);
        bool parsed = UiFontParser.TryParse(
            buffer,
            UiFontProvider.FromFamilyName("Metrics"),
            "Metrics",
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            out _,
            out UiFontError error);

        parsed.Should().BeFalse();
        return error;
    }

    private static UiTextStyle Style(UiFontFaceId face, UiTextWrap wrap = UiTextWrap.None) =>
        new(
            face,
            1000.0f,
            0.0f,
            0.0f,
            wrap,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            UiTextDirection.Ltr,
            0);
}
