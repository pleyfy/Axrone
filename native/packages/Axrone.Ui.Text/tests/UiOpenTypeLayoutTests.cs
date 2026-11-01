namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiOpenTypeLayoutTests
{
    private static readonly UiFontFamilyId Family = UiFontProvider.FromFamilyName("Test");

    [Fact]
    public void AppliesGsubLigatureSubstitutions()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        UiTextStyle style = Style(face);
        var runs = new UiGlyphRun[8];

        int count = shaper.ShapeGlyphs("AB".AsSpan(), style, runs);

        count.Should().Be(1);
        runs[0].GlyphId.Should().Be(9);
        runs[0].CodePoint.Should().Be(0xFB01);
        runs[0].Cluster.Should().Be(0);
        runs[0].Advance.Should().Be(650.0f);
        runs[0].Face.Should().Be(face);

        count = shaper.ShapeGlyphs("fi".AsSpan(), style, runs);
        count.Should().Be(1);
        runs[0].GlyphId.Should().Be(9);

        var glyphs = new UiShapedGlyph[8];
        count = shaper.Shape("AB".AsSpan(), style, glyphs);
        count.Should().Be(1);
        glyphs[0].CodePoint.Should().Be(0xFB01);
        glyphs[0].Advance.Should().Be(650.0f);
    }

    [Fact]
    public void KeepsUnmatchedSequencesSeparate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var runs = new UiGlyphRun[8];

        int count = shaper.ShapeGlyphs("AV".AsSpan(), Style(face), runs);

        count.Should().Be(2);
        runs[0].GlyphId.Should().Be(2);
        runs[1].GlyphId.Should().Be(3);
    }

    [Fact]
    public void AppliesGposPairKerning()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var runs = new UiGlyphRun[8];

        int count = shaper.ShapeGlyphs("AV".AsSpan(), Style(face), runs);

        count.Should().Be(2);
        runs[0].Advance.Should().Be(600.0f);
        runs[1].X.Should().Be(550.0f);
        runs[1].Advance.Should().Be(600.0f);
    }

    [Fact]
    public void AppliesGposClassKerning()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var runs = new UiGlyphRun[8];

        int count = shaper.ShapeGlyphs("BV".AsSpan(), Style(face), runs);

        count.Should().Be(2);
        runs[0].GlyphId.Should().Be(10);
        runs[0].Advance.Should().Be(600.0f);
        runs[1].X.Should().Be(570.0f);
    }

    [Fact]
    public void RasterizesSubstitutedGlyphById()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterizeGlyph(face, 9, 100.0f, out UiGlyphBitmap bitmap, out UiFontError error)
            .Should().BeTrue(error.Message);
        bitmap.IsEmpty.Should().BeFalse();
        bitmap.Alpha.ToArray().Sum(static value => value).Should().BeGreaterThan(0);

        rasterizer.TryRasterizeGlyph(face, 999, 100.0f, out _, out UiFontError missing).Should().BeFalse();
        missing.Code.Should().Be(UiFontErrorCode.GlyphNotFound);
    }

    [Fact]
    public void LayoutShapingDoesNotAllocate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var runs = new UiGlyphRun[16];
        UiTextStyle style = Style(face);

        for (int i = 0; i < 32; i++)
        {
            _ = shaper.ShapeGlyphs("AB fi AV BV".AsSpan(), style, runs);
        }

        bool shaped = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            shaped &= shaper.ShapeGlyphs("AB fi AV BV".AsSpan(), style, runs) > 0;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        shaped.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void RejectsMalformedLayoutTables()
    {
        byte[] font = UiTestFont.CreateWithLayout();
        int gsub = UiTestFont.TableOffset(font, "GSUB");
        int gpos = UiTestFont.TableOffset(font, "GPOS");

        byte[] badGsubOffset = (byte[])font.Clone();
        badGsubOffset[gsub + 8] = 0xFF;
        badGsubOffset[gsub + 9] = 0xFF;
        ParseError(badGsubOffset).Code.Should().Be(UiFontErrorCode.InvalidLayout);

        byte[] badGposOffset = (byte[])font.Clone();
        badGposOffset[gpos + 8] = 0xFF;
        badGposOffset[gpos + 9] = 0xFF;
        ParseError(badGposOffset).Code.Should().Be(UiFontErrorCode.InvalidLayout);

        byte[] badLigatureSet = (byte[])font.Clone();
        badLigatureSet[gsub + 28] = 0xFF;
        badLigatureSet[gsub + 29] = 0xFF;
        ParseError(badLigatureSet).Code.Should().Be(UiFontErrorCode.InvalidLayout);
    }

    private static UiFontProvider CreateProvider(out UiFontFaceId face)
    {
        var provider = new UiFontProvider();
        face = provider.RegisterFace(
            UiTestFont.CreateWithLayout(),
            new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);
        return provider;
    }

    private static UiTextStyle Style(UiFontFaceId face) =>
        new(
            face,
            1000.0f,
            0.0f,
            0.0f,
            UiTextWrap.None,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            UiTextDirection.Ltr,
            0);

    private static UiFontError ParseError(byte[] font)
    {
        using UiFontBuffer buffer = UiFontBuffer.FromSpan(font);
        bool parsed = UiFontParser.TryParse(
            buffer,
            Family,
            "Test",
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            out _,
            out UiFontError error);

        parsed.Should().BeFalse();
        return error;
    }
}
