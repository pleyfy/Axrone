namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiBidiTests
{
    [Fact]
    public void ReordersHebrewRuns()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[8];

        int count = shaper.Shape("AV \u05D0\u05D1\u05D2".AsSpan(), Style(face), glyphs);

        count.Should().Be(6);
        glyphs[0].CodePoint.Should().Be(0x41);
        glyphs[1].CodePoint.Should().Be(0x56);
        glyphs[2].CodePoint.Should().Be(0x20);
        glyphs[3].CodePoint.Should().Be(0x05D2);
        glyphs[4].CodePoint.Should().Be(0x05D1);
        glyphs[5].CodePoint.Should().Be(0x05D0);
        glyphs[3].Cluster.Should().Be(5);
        glyphs[4].Cluster.Should().Be(4);
        glyphs[5].Cluster.Should().Be(3);
    }

    [Fact]
    public void MirrorsBracketsInRtlBase()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[4];

        int count = shaper.Shape("(".AsSpan(), Style(face, UiTextDirection.Rtl), glyphs);
        count.Should().Be(1);
        glyphs[0].CodePoint.Should().Be(0x29);

        count = shaper.Shape(")".AsSpan(), Style(face, UiTextDirection.Rtl), glyphs);
        count.Should().Be(1);
        glyphs[0].CodePoint.Should().Be(0x28);
    }

    [Fact]
    public void AppliesArabicJoiningForms()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var runs = new UiGlyphRun[8];

        int count = shaper.ShapeGlyphs("\u0628\u0628".AsSpan(), Style(face), runs);

        count.Should().Be(2);
        runs[0].CodePoint.Should().Be(0xFE90);
        runs[0].GlyphId.Should().Be(4);
        runs[0].Cluster.Should().Be(1);
        runs[1].CodePoint.Should().Be(0xFE91);
        runs[1].GlyphId.Should().Be(5);
        runs[1].Cluster.Should().Be(0);
    }

    [Fact]
    public void AppliesArabicJoiningWithAlef()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var runs = new UiGlyphRun[8];

        int count = shaper.ShapeGlyphs("\u0628\u0627".AsSpan(), Style(face), runs);

        count.Should().Be(2);
        runs[0].CodePoint.Should().Be(0xFE8E);
        runs[0].GlyphId.Should().Be(4);
        runs[1].CodePoint.Should().Be(0xFE91);
        runs[1].GlyphId.Should().Be(5);
    }

    [Fact]
    public void StopsArabicJoiningAtLatinBoundaries()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var runs = new UiGlyphRun[8];

        int count = shaper.ShapeGlyphs("\u0628A\u0628".AsSpan(), Style(face), runs);

        count.Should().Be(3);
        runs[0].CodePoint.Should().Be(0xFE8F);
        runs[1].CodePoint.Should().Be(0x41);
        runs[2].CodePoint.Should().Be(0xFE8F);
        runs[0].GlyphId.Should().Be(3);
        runs[1].GlyphId.Should().Be(2);
        runs[2].GlyphId.Should().Be(3);
    }

    [Fact]
    public void BidiAndArabicShapingDoNotAllocate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[16];
        UiTextStyle style = Style(face);

        for (int i = 0; i < 32; i++)
        {
            _ = shaper.Shape("AV \u05D0\u05D1\u05D2".AsSpan(), style, glyphs);
            _ = shaper.Shape("\u0628\u0628".AsSpan(), style, glyphs);
        }

        bool shaped = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            shaped &= shaper.Shape("AV \u05D0\u05D1\u05D2".AsSpan(), style, glyphs) > 0;
            shaped &= shaper.Shape("\u0628\u0628".AsSpan(), style, glyphs) > 0;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        shaped.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void BidiHelpersCoverBaseDirectionAndMirroring()
    {
        UiBidi.ResolveBaseLevel(UiTextDirection.Auto, [0x41]).Should().Be(0);
        UiBidi.ResolveBaseLevel(UiTextDirection.Auto, [0x05D0]).Should().Be(1);
        UiBidi.ResolveBaseLevel(UiTextDirection.Auto, [0x0628]).Should().Be(1);
        UiBidi.ResolveBaseLevel(UiTextDirection.Ltr, [0x05D0]).Should().Be(0);
        UiBidi.ResolveBaseLevel(UiTextDirection.Rtl, [0x41]).Should().Be(1);

        UiBidi.Mirror(0x28).Should().Be(0x29);
        UiBidi.Mirror(0x29).Should().Be(0x28);
        UiBidi.Mirror(0x5B).Should().Be(0x5D);
        UiBidi.Mirror(0x41).Should().Be(0x41);
    }

    [Fact]
    public void ResolvesMixedLevels()
    {
        int[] codepoints = [0x41, 0x05D0, 0x31];
        var types = new UiBidiClass[codepoints.Length];
        var levels = new byte[codepoints.Length];

        UiBidi.ResolveLevels(codepoints, types, levels, 0);

        levels[0].Should().Be(0);
        levels[1].Should().Be(1);
        levels[2].Should().Be(2);
    }

    [Fact]
    public void AppliesRightToLeftOverride()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[8];

        int count = shaper.Shape("\u202Eabc\u202C".AsSpan(), Style(face), glyphs);

        count.Should().Be(3);
        glyphs[0].CodePoint.Should().Be(0x63);
        glyphs[1].CodePoint.Should().Be(0x62);
        glyphs[2].CodePoint.Should().Be(0x61);
        glyphs[0].Cluster.Should().Be(3);
        glyphs[2].Cluster.Should().Be(1);
    }

    [Fact]
    public void AppliesLeftToRightOverrideInsideRtlText()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[8];

        int count = shaper.Shape("\u202D\u05D0\u05D1\u202C".AsSpan(), Style(face, UiTextDirection.Rtl), glyphs);

        count.Should().Be(2);
        glyphs[0].CodePoint.Should().Be(0x05D0);
        glyphs[1].CodePoint.Should().Be(0x05D1);
    }

    [Fact]
    public void ResolvesExplicitEmbeddingLevels()
    {
        int[] codepoints = [0x61, 0x202B, 0x62, 0x63, 0x202C];
        var types = new UiBidiClass[codepoints.Length];
        var levels = new byte[codepoints.Length];

        UiBidi.Resolve(codepoints, types, levels, 0);

        levels.Should().Equal(0, 0, 2, 2, 0);

        int[] nested = [0x05D0, 0x202A, 0x61, 0x62, 0x202C];
        var nestedTypes = new UiBidiClass[nested.Length];
        var nestedLevels = new byte[nested.Length];

        UiBidi.Resolve(nested, nestedTypes, nestedLevels, 1);

        nestedLevels.Should().Equal(1, 1, 2, 2, 1);
    }

    [Fact]
    public void AppliesIsolatesAndRemovesControls()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[8];

        int count = shaper.Shape("a\u2067\u05D0\u05D1\u2069b".AsSpan(), Style(face), glyphs);

        count.Should().Be(4);
        glyphs[0].CodePoint.Should().Be(0x61);
        glyphs[1].CodePoint.Should().Be(0x05D1);
        glyphs[2].CodePoint.Should().Be(0x05D0);
        glyphs[3].CodePoint.Should().Be(0x62);
        glyphs[1].Cluster.Should().Be(3);
        glyphs[3].Cluster.Should().Be(5);

        count = shaper.Shape("a\u2068\u05D0\u2069b".AsSpan(), Style(face), glyphs);
        count.Should().Be(3);
        glyphs[0].CodePoint.Should().Be(0x61);
        glyphs[1].CodePoint.Should().Be(0x05D0);
        glyphs[2].CodePoint.Should().Be(0x62);

        count = shaper.Shape("a\u2068b\u2069c".AsSpan(), Style(face), glyphs);
        count.Should().Be(3);
        glyphs[0].CodePoint.Should().Be(0x61);
        glyphs[1].CodePoint.Should().Be(0x62);
        glyphs[2].CodePoint.Should().Be(0x63);
    }

    [Fact]
    public void ResolvesBracketPairs()
    {
        int[] rtl = [0x05D0, 0x28, 0x41, 0x29, 0x05D1];
        var types = new UiBidiClass[rtl.Length];
        var levels = new byte[rtl.Length];

        UiBidi.Resolve(rtl, types, levels, 1);

        types[1].Should().Be(UiBidiClass.L);
        types[3].Should().Be(UiBidiClass.L);
        levels[1].Should().Be(2);
        levels[3].Should().Be(2);

        int[] ltr = [0x28, 0x05D0, 0x29];
        var ltrTypes = new UiBidiClass[ltr.Length];
        var ltrLevels = new byte[ltr.Length];

        UiBidi.Resolve(ltr, ltrTypes, ltrLevels, 0);

        ltrTypes[0].Should().Be(UiBidiClass.R);
        ltrTypes[2].Should().Be(UiBidiClass.R);
        ltrLevels[0].Should().Be(1);
        ltrLevels[2].Should().Be(1);
    }

    [Fact]
    public void PreservesArabicJoiningAcrossControls()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var runs = new UiGlyphRun[8];

        int count = shaper.ShapeGlyphs("\u0628\u202B\u0628\u202C".AsSpan(), Style(face), runs);

        count.Should().Be(2);
        runs[0].CodePoint.Should().Be(0xFE90);
        runs[1].CodePoint.Should().Be(0xFE91);

        count = shaper.ShapeGlyphs("\u0628\u200F\u0628".AsSpan(), Style(face), runs);

        count.Should().Be(2);
        runs[0].CodePoint.Should().Be(0xFE90);
        runs[1].CodePoint.Should().Be(0xFE91);
    }

    [Fact]
    public void HandlesUnmatchedBidiControls()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[8];

        int count = shaper.Shape("\u202Cabc\u2069".AsSpan(), Style(face), glyphs);

        count.Should().Be(3);
        glyphs[0].CodePoint.Should().Be(0x61);
        glyphs[1].CodePoint.Should().Be(0x62);
        glyphs[2].CodePoint.Should().Be(0x63);
    }

    [Fact]
    public void BidiControlsDoNotAllocateOrChangeDeterminism()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var shaper = new UiTextShaper(provider);
        var glyphs = new UiShapedGlyph[16];
        UiTextStyle style = Style(face);
        const string text = "a\u2067\u05D0\u05D1\u2069b\u202Ecd\u202C";

        for (int i = 0; i < 32; i++)
        {
            _ = shaper.Shape(text.AsSpan(), style, glyphs);
        }

        bool shaped = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            shaped &= shaper.Shape(text.AsSpan(), style, glyphs) > 0;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        shaped.Should().BeTrue();
        allocated.Should().Be(0);

        var first = new UiShapedGlyph[16];
        var second = new UiShapedGlyph[16];
        int firstCount = shaper.Shape(text.AsSpan(), style, first);
        int secondCount = shaper.Shape(text.AsSpan(), style, second);
        firstCount.Should().Be(secondCount);
        first.AsSpan(0, firstCount).SequenceEqual(second.AsSpan(0, secondCount)).Should().BeTrue();
    }

    private static UiFontProvider CreateProvider(out UiFontFaceId face)
    {
        var provider = new UiFontProvider();
        face = provider.RegisterFace(
            UiTestFont.CreateArabic(),
            new UiFontFaceDescriptor("Arabic", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);
        return provider;
    }

    private static UiTextStyle Style(UiFontFaceId face, UiTextDirection direction = UiTextDirection.Auto) =>
        new(
            face,
            1000.0f,
            0.0f,
            0.0f,
            UiTextWrap.None,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            direction,
            0);
}
