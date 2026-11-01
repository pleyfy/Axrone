namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiTextAllocationTests
{
    private const int Warmup = 32;
    private const int Measured = 64;

    [Fact]
    public void WarmShapingDoesNotAllocate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[16];
        UiTextStyle style = Style(face);

        for (int i = 0; i < Warmup; i++)
        {
            _ = shaper.Shape("AV fi A\u0301".AsSpan(), style, glyphs);
        }

        bool shaped = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Measured; i++)
        {
            shaped &= shaper.Shape("AV fi A\u0301".AsSpan(), style, glyphs) > 0;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        shaped.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void WarmMeasurementDoesNotAllocate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);
        UiTextStyle style = Style(face, wrap: UiTextWrap.Word);
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1000.0f, float.PositiveInfinity);

        for (int i = 0; i < Warmup; i++)
        {
            _ = measurer.Measure("AV fi A\u0301".AsSpan(), style, constraints);
        }

        bool measured = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Measured; i++)
        {
            measured &= measurer.Measure("AV fi A\u0301".AsSpan(), style, constraints).LineCount > 0;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        measured.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void WarmLayoutDoesNotAllocate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var layout = new UiTextLayoutBuffer(provider, glyphCapacity: 16);
        UiTextStyle style = Style(face, align: UiTextAlign.Center);
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1000.0f, float.PositiveInfinity);

        for (int i = 0; i < Warmup; i++)
        {
            _ = layout.TryLayout("AV fi A\u0301".AsSpan(), style, constraints);
        }

        bool laidOut = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Measured; i++)
        {
            laidOut &= layout.TryLayout("AV fi A\u0301".AsSpan(), style, constraints);
            laidOut &= layout.Glyphs.Length > 0;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        laidOut.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void WarmRichTextParsingDoesNotAllocate()
    {
        const string markup = "<b>Hi <size=500>x</size></b><color=#3366FF>y</color>";
        char[] plain = new char[markup.Length];
        var runs = new UiRichTextRun[16];

        for (int i = 0; i < Warmup; i++)
        {
            _ = UiRichTextParser.TryParse(markup.AsSpan(), plain, runs, out _, out _, out _);
        }

        bool parsed = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Measured; i++)
        {
            parsed &= UiRichTextParser.TryParse(markup.AsSpan(), plain, runs, out _, out _, out _);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        parsed.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void WarmFontLookupsDoNotAllocate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var family = UiFontProvider.FromFamilyName("Test");
        for (int i = 0; i < Warmup; i++)
        {
            _ = provider.TryMeasureGlyph(face, 0x41, out _);
            _ = provider.GetKerning(face, 0x41, 0x56);
            _ = provider.TryGetFace(new UiFontQuery(family, UiFontWeight.Normal, UiFontStyle.Normal, "en"), out _);
        }

        bool found = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Measured; i++)
        {
            found &= provider.TryMeasureGlyph(face, 0x41, out _);
            found &= provider.GetKerning(face, 0x41, 0x56) < 0.0f;
            found &= provider.TryGetFace(new UiFontQuery(family, UiFontWeight.Normal, UiFontStyle.Normal, "en"), out _);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        found.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void WarmRasterizationDoesNotAllocate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);

        for (int i = 0; i < Warmup; i++)
        {
            _ = rasterizer.TryRasterize(face, 0x42, 100.0f, out _, out _);
        }

        bool rasterized = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < Measured; i++)
        {
            rasterized &= rasterizer.TryRasterize(face, 0x42, 100.0f, out UiGlyphBitmap bitmap, out _);
            rasterized &= !bitmap.IsEmpty;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        rasterized.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void ShapingMeasurementAndRasterizationAreDeterministic()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var measurer = new UiTextMeasurer(provider);
        var rasterizer = new UiGlyphRasterizer(provider);
        UiTextStyle style = Style(face, wrap: UiTextWrap.Word);
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1000.0f, float.PositiveInfinity);
        var first = new UiShapedGlyph[16];
        var second = new UiShapedGlyph[16];

        int firstCount = shaper.Shape("AV fi A\u0301".AsSpan(), style, first);
        int secondCount = shaper.Shape("AV fi A\u0301".AsSpan(), style, second);
        firstCount.Should().Be(secondCount);
        first.AsSpan(0, firstCount).SequenceEqual(second.AsSpan(0, secondCount)).Should().BeTrue();

        measurer.Measure("AV fi A\u0301".AsSpan(), style, constraints)
            .Should().Be(measurer.Measure("AV fi A\u0301".AsSpan(), style, constraints));

        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap firstBitmap, out _).Should().BeTrue();
        byte[] firstAlpha = firstBitmap.Alpha.ToArray();
        rasterizer.TryRasterize(face, 0x41, 100.0f, out UiGlyphBitmap secondBitmap, out _).Should().BeTrue();
        secondBitmap.Alpha.ToArray().Should().Equal(firstAlpha);
    }

    [Fact]
    public void RichTextParsingIsDeterministic()
    {
        const string markup = "<b>a<i>b</i></b><size=500>c</size>";
        char[] firstPlain = new char[markup.Length];
        char[] secondPlain = new char[markup.Length];
        var firstRuns = new UiRichTextRun[8];
        var secondRuns = new UiRichTextRun[8];

        UiRichTextParser.TryParse(markup.AsSpan(), firstPlain, firstRuns, out int firstLength, out int firstCount, out _)
            .Should().BeTrue();
        UiRichTextParser.TryParse(markup.AsSpan(), secondPlain, secondRuns, out int secondLength, out int secondCount, out _)
            .Should().BeTrue();

        firstLength.Should().Be(secondLength);
        firstCount.Should().Be(secondCount);
        firstPlain.AsSpan(0, firstLength).SequenceEqual(secondPlain.AsSpan(0, secondLength)).Should().BeTrue();
        firstRuns.AsSpan(0, firstCount).SequenceEqual(secondRuns.AsSpan(0, secondCount)).Should().BeTrue();
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

    private static UiTextStyle Style(
        UiFontFaceId face,
        UiTextWrap wrap = UiTextWrap.None,
        UiTextAlign align = UiTextAlign.Start) =>
        new(
            face,
            1000.0f,
            0.0f,
            0.0f,
            wrap,
            UiTextOverflow.Clip,
            align,
            UiTextDirection.Ltr,
            0);
}
