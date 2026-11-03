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
    public void IdentityHvarAppliesPerGlyphDeltasWithoutAMap()
    {
        WithProvider(UiTestFont.CreateMetricsVariation(identityHvar: true), out UiFontProvider provider, out UiFontFaceId face, out _);
        _ = provider.TryGetFace(face, out UiFontFace? fontFace);

        fontFace!.TryGetGlyphMetrics(0x41, out UiGlyphMetrics defaultA).Should().BeTrue();
        defaultA.Advance.Should().Be(600.0f);

        provider.SetVariation(face, [new UiFontAxisValue(Weight, 900.0f)], out UiFontError error)
            .Should().BeTrue(error.Message);

        // Glyph 2 and glyph 3 index item data sets 2 and 3, whose deltas are glyph * 10.
        fontFace.TryGetGlyphMetrics(0x41, out UiGlyphMetrics variedA).Should().BeTrue();
        variedA.Advance.Should().Be(620.0f);
        fontFace.TryGetGlyphMetrics(0x56, out UiGlyphMetrics variedV).Should().BeTrue();
        variedV.Advance.Should().Be(630.0f);
    }

    [Fact]
    public void RejectsIdentityHvarWhoseStoreDoesNotCoverTheGlyphs()
    {
        byte[] font = UiTestFont.CreateMetricsVariation(identityHvar: true);

        // Same header, but the store now answers only outer index 0: glyph ids past it would
        // silently read as a zero delta, so the face is refused at parse instead.
        int store = UiTestFont.TableOffset(font, "HVAR") + 20;
        font[store + 6] = 0;
        font[store + 7] = 1;

        ParseError(font).Code.Should().Be(UiFontErrorCode.InvalidVariation);
    }

    [Fact]
    public void RejectsHvarMapEntryOutsideTheItemVariationStore()
    {
        byte[] font = UiTestFont.CreateMetricsVariation();
        int hvar = UiTestFont.TableOffset(font, "HVAR");

        // HVAR header (20) + store (32) + map header (4): the first advance map entry.
        int entry = hvar + 20 + 32 + 4;
        font[entry] = 2;

        UiFontError error = ParseError(font);
        error.Code.Should().Be(UiFontErrorCode.InvalidVariation);
        error.Offset.Should().Be(entry);
    }

    [Fact]
    public void RejectsMalformedVariationRegionTriplet()
    {
        byte[] font = UiTestFont.CreateMetricsVariation();
        int hvar = UiTestFont.TableOffset(font, "HVAR");

        // Store region cuts sit at HVAR+20+16 (start) .. +21 (end): set end below the peak.
        font[hvar + 20 + 20] = 0x20;
        font[hvar + 20 + 21] = 0x00;

        UiFontError error = ParseError(font);
        error.Code.Should().Be(UiFontErrorCode.InvalidVariation);

        // The report points at the start of the offending cut triple, not at the patched byte.
        error.Offset.Should().Be(hvar + 20 + 16);
    }

    [Fact]
    public void MalformedRegionTripletYieldsNoDeltaInsteadOfTheFullOne()
    {
        // The same cuts evaluated directly: a region whose end sits below its peak is refused
        // with a zero factor, so a stray tuple can never apply its whole delta.
        UiVariationMath.TryAxisFactor(1.0f, 0.0f, 1.0f, 0.5f, out float broken).Should().BeFalse();
        broken.Should().Be(0.0f);

        // Positive counterpart: a well-formed triplet still interpolates to its full factor.
        UiVariationMath.TryAxisFactor(1.0f, 0.0f, 1.0f, 1.0f, out float valid).Should().BeTrue();
        valid.Should().Be(1.0f);
    }

    [Fact]
    public void ZeroPeakRegionIgnoresTheAxisInsteadOfRefusingIt()
    {
        // Positive/negative pair for the peak == 0 rule: the axis contributes a neutral factor
        // whatever the cuts say, and a straddling cut pair is only malformed for a real peak.
        UiVariationMath.TryAxisFactor(0.5f, -0.5f, 0.0f, 0.5f, out float ignored).Should().BeTrue();
        ignored.Should().Be(1.0f);

        UiVariationMath.TryAxisFactor(0.5f, -0.5f, 0.5f, 0.5f, out float straddling).Should().BeFalse();
        straddling.Should().Be(0.0f);
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
