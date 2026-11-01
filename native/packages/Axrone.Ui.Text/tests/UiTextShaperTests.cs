namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiTextShaperTests
{
    [Fact]
    public void ShapesLatinWithKerning()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("AV".AsSpan(), Style(face), glyphs);

        count.Should().Be(2);
        glyphs[0].CodePoint.Should().Be(0x41);
        glyphs[0].Cluster.Should().Be(0);
        glyphs[0].X.Should().Be(0.0f);
        glyphs[0].Advance.Should().Be(600.0f);
        glyphs[1].CodePoint.Should().Be(0x56);
        glyphs[1].Cluster.Should().Be(1);
        glyphs[1].X.Should().Be(520.0f);
        glyphs[1].Advance.Should().Be(600.0f);
    }

    [Fact]
    public void AppliesBuiltInLigaturesWhenAvailable()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("fi".AsSpan(), Style(face), glyphs);
        count.Should().Be(1);
        glyphs[0].CodePoint.Should().Be(0xFB01);
        glyphs[0].Advance.Should().Be(650.0f);
        glyphs[0].Cluster.Should().Be(0);

        count = shaper.Shape("fl".AsSpan(), Style(face), glyphs);
        count.Should().Be(2);
        glyphs[0].CodePoint.Should().Be(0x66);
        glyphs[1].CodePoint.Should().Be(0x6C);
    }

    [Fact]
    public void AttachesCombiningMarksToThePreviousBase()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("A\u0301".AsSpan(), Style(face), glyphs);

        count.Should().Be(2);
        glyphs[0].CodePoint.Should().Be(0x41);
        glyphs[1].CodePoint.Should().Be(0x301);
        glyphs[1].Advance.Should().Be(0.0f);
        glyphs[1].Cluster.Should().Be(1);
        glyphs[1].X.Should().Be(200.0f);
    }

    [Fact]
    public void AppliesLetterSpacing()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("AV".AsSpan(), Style(face, spacing: 10.0f), glyphs);

        count.Should().Be(2);
        glyphs[0].Advance.Should().Be(610.0f);
        glyphs[1].X.Should().Be(530.0f);
        glyphs[1].Advance.Should().Be(610.0f);
    }

    [Fact]
    public void ScalesMetricsBySizeOverUnitsPerEm()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("AV".AsSpan(), Style(face, size: 500.0f), glyphs);

        count.Should().Be(2);
        glyphs[0].Advance.Should().Be(300.0f);
        glyphs[1].X.Should().Be(260.0f);
        glyphs[1].Advance.Should().Be(300.0f);
    }

    [Fact]
    public void ResolvesGlyphsThroughFallbackFaces()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId primary = provider.RegisterFace(
            UiTestFont.Create(),
            new UiFontFaceDescriptor("Primary", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError primaryError);
        primary.IsValid.Should().BeTrue(primaryError.Message);
        UiFontFaceId fallback = provider.RegisterFace(
            UiTestFont.CreateFallback(),
            new UiFontFaceDescriptor("Fallback", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError fallbackError);
        fallback.IsValid.Should().BeTrue(fallbackError.Message);
        provider.SetFallbackFamilies([UiFontProvider.FromFamilyName("Fallback")]);

        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("Z".AsSpan(), Style(primary), glyphs);

        count.Should().Be(1);
        glyphs[0].CodePoint.Should().Be(0x5A);
        glyphs[0].Advance.Should().Be(500.0f);
    }

    [Fact]
    public void MissingGlyphEmitsAZeroAdvanceMarker()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("Z".AsSpan(), Style(face), glyphs);

        count.Should().Be(1);
        glyphs[0].CodePoint.Should().Be(0x5A);
        glyphs[0].Advance.Should().Be(0.0f);
        glyphs[0].X.Should().Be(0.0f);
    }

    [Fact]
    public void KeepsLtrRunsInRtlBase()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("AB".AsSpan(), Style(face, direction: UiTextDirection.Rtl), glyphs);

        count.Should().Be(2);
        glyphs[0].CodePoint.Should().Be(0x41);
        glyphs[0].Cluster.Should().Be(0);
        glyphs[0].X.Should().Be(0.0f);
        glyphs[1].CodePoint.Should().Be(0x42);
        glyphs[1].Cluster.Should().Be(1);
        glyphs[1].X.Should().Be(600.0f);
    }

    [Fact]
    public void AutoDirectionKeepsLatinLeftToRight()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[8];

        int count = shaper.Shape("AB".AsSpan(), Style(face, direction: UiTextDirection.Auto), glyphs);

        count.Should().Be(2);
        glyphs[0].CodePoint.Should().Be(0x41);
        glyphs[1].CodePoint.Should().Be(0x42);
    }

    [Fact]
    public void HandlesEmptyAndInvalidInputs()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[4];

        shaper.Shape(ReadOnlySpan<char>.Empty, Style(face), glyphs).Should().Be(0);
        shaper.Shape("A".AsSpan(), Style(face), Span<UiShapedGlyph>.Empty).Should().Be(0);
        shaper.Shape("A".AsSpan(), Style(face, size: 0.0f), glyphs).Should().Be(0);
        shaper.Shape("A".AsSpan(), Style(new UiFontFaceId(9999)), glyphs).Should().Be(0);

        FluentActions.Invoking(static () => new UiTextShaper(null!)).Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void StopsAtDestinationCapacity()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        Span<UiShapedGlyph> glyphs = stackalloc UiShapedGlyph[1];

        int count = shaper.Shape("AV".AsSpan(), Style(face), glyphs);

        count.Should().Be(1);
        glyphs[0].CodePoint.Should().Be(0x41);
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
        float size = 1000.0f,
        float spacing = 0.0f,
        UiTextDirection direction = UiTextDirection.Ltr) =>
        new(
            face,
            size,
            0.0f,
            spacing,
            UiTextWrap.None,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            direction,
            0);
}
