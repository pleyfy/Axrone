namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiHintingTests
{
    private static readonly byte[] CallFunctionAndAlign =
    [
        0xB0, 0x00,
        0x2B,
        0xB0, 0x01,
        0x2F,
    ];

    private static readonly float[] PointX = [0.0f, 300.0f, 600.0f];
    private static readonly float[] PointY = [0.0f, 740.0f, 0.0f];
    private static readonly float[] PointYIup = [740.0f, 700.0f, 800.0f];
    private static readonly bool[] OnCurve = [true, true, true];
    private static readonly int[] ContourEnds = [2];

    [Fact]
    public void HintedFixtureCarriesInstructions()
    {
        using UiFontBuffer buffer = UiFontBuffer.FromSpan(UiTestFont.CreateHinted());
        bool parsed = UiFontParser.TryParse(
            buffer,
            UiFontProvider.FromFamilyName("Test"),
            "Test",
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            out UiFontFace? face,
            out UiFontError error);
        parsed.Should().BeTrue(error.Message);
        face!.TryGetGlyph(0x41, out int glyphId).Should().BeTrue();
        glyphId.Should().Be(2);
        face.TryGetGlyphRange(glyphId, out int offset, out _).Should().BeTrue();
        int contours = UiFontFace.ReadI16(buffer.Span, offset);
        int instructionLength = UiFontFace.ReadU16(buffer.Span, offset + 10 + (contours * 2));
        instructionLength.Should().Be(6);
    }

    [Fact]
    public void HintsPointToGridThroughFpgmFunction()
    {
        WithFace(UiTestFont.CreateHinted(), face =>
        {
            float[] x = [.. PointX];
            float[] y = [.. PointY];
            bool[] onCurve = [.. OnCurve];
            int[] contourEnds = [.. ContourEnds];
            var hinter = new UiTrueTypeHinter();

            hinter.TryHintGlyph(
                face,
                10.0f,
                CallFunctionAndAlign,
                x,
                y,
                onCurve,
                contourEnds,
                3,
                600,
                out UiFontError error).Should().BeTrue(error.Message);

            y[0].Should().BeApproximately(0.0f, 0.01f);
            y[1].Should().BeApproximately(700.0f, 0.01f);
            y[2].Should().BeApproximately(0.0f, 0.01f);
            x[1].Should().BeApproximately(300.0f, 0.01f);
        });
    }

    [Fact]
    public void PersistsPrepGraphicsStateIntoGlyphs()
    {
        WithFace(UiTestFont.CreateHinted(prepYAxis: true), face =>
        {
            float[] x = [.. PointX];
            float[] y = [.. PointY];
            bool[] onCurve = [.. OnCurve];
            int[] contourEnds = [.. ContourEnds];
            var hinter = new UiTrueTypeHinter();

            hinter.TryHintGlyph(
                face,
                10.0f,
                [0xB0, 0x01, 0x2F],
                x,
                y,
                onCurve,
                contourEnds,
                3,
                600,
                out UiFontError error).Should().BeTrue(error.Message);

            y[1].Should().BeApproximately(700.0f, 0.01f);
        });
    }

    [Fact]
    public void UsesScaledCvtWithMiap()
    {
        WithFace(UiTestFont.CreateHinted(), face =>
        {
            float[] x = [.. PointX];
            float[] y = [.. PointY];
            bool[] onCurve = [.. OnCurve];
            int[] contourEnds = [.. ContourEnds];
            var hinter = new UiTrueTypeHinter();

            hinter.TryHintGlyph(
                face,
                10.0f,
                [0x00, 0xB0, 0x00, 0xB0, 0x01, 0x3F],
                x,
                y,
                onCurve,
                contourEnds,
                3,
                600,
                out UiFontError error).Should().BeTrue(error.Message);

            y[1].Should().BeApproximately(700.0f, 0.01f);
        });
    }

    [Fact]
    public void InterpolatesUntouchedPoints()
    {
        WithFace(UiTestFont.CreateHinted(), face =>
        {
            float[] x = [.. PointX];
            float[] y = [.. PointYIup];
            bool[] onCurve = [.. OnCurve];
            int[] contourEnds = [.. ContourEnds];
            var hinter = new UiTrueTypeHinter();

            hinter.TryHintGlyph(
                face,
                10.0f,
                [0x00, 0xB0, 0x00, 0x2F, 0x30],
                x,
                y,
                onCurve,
                contourEnds,
                3,
                600,
                out UiFontError error).Should().BeTrue(error.Message);

            y[0].Should().BeApproximately(700.0f, 0.01f);
            y[1].Should().BeApproximately(659.375f, 0.01f);
            y[2].Should().BeApproximately(759.375f, 0.01f);
        });
    }

    [Fact]
    public void RejectsMalformedHintPrograms()
    {
        WithFace(UiTestFont.CreateHinted(), face =>
        {
            float[] x = [.. PointX];
            float[] y = [.. PointY];
            bool[] onCurve = [.. OnCurve];
            int[] contourEnds = [.. ContourEnds];
            var hinter = new UiTrueTypeHinter();

            hinter.TryHintGlyph(
                face,
                10.0f,
                [0x28],
                x,
                y,
                onCurve,
                contourEnds,
                3,
                600,
                out UiFontError error).Should().BeFalse();

            error.Code.Should().Be(UiFontErrorCode.InvalidHinting);
        });
    }

    [Fact]
    public void RasterizerAppliesAndDisablesHintingDeterministically()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.CreateHinted(),
            new UiFontFaceDescriptor("Hinted", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);
        _ = provider.TryGetFace(face, out UiFontFace? fontFace);
        fontFace!.HasHinting.Should().BeTrue();

        var rasterizer = new UiGlyphRasterizer(provider);
        rasterizer.EnableHinting.Should().BeTrue();

        var probe = new UiTrueTypeHinter();
        float[] probeX = [.. PointX];
        float[] probeY = [.. PointY];
        probe.TryHintGlyph(
            fontFace,
            10.0f,
            CallFunctionAndAlign,
            probeX,
            probeY,
            OnCurve,
            ContourEnds,
            3,
            600,
            out UiFontError probeError).Should().BeTrue(probeError.Message);
        probeY[1].Should().BeApproximately(700.0f, 0.01f);

        rasterizer.TryRasterize(face, 0x41, 10.0f, out UiGlyphBitmap hinted, out error)
            .Should().BeTrue(error.Message);
        byte[] hintedAlpha = hinted.Alpha.ToArray();
        rasterizer.TryRasterize(face, 0x41, 10.0f, out UiGlyphBitmap repeated, out _).Should().BeTrue();
        repeated.Alpha.ToArray().Should().Equal(hintedAlpha);

        rasterizer.EnableHinting = false;
        rasterizer.TryRasterize(face, 0x41, 10.0f, out UiGlyphBitmap plain, out error)
            .Should().BeTrue(error.Message);
        plain.Alpha.SequenceEqual(hintedAlpha).Should().BeFalse($"hinted {hinted.Width}x{hinted.Height} plain {plain.Width}x{plain.Height}");

        using var staticProvider = new UiFontProvider();
        UiFontFaceId staticFace = staticProvider.RegisterFace(
            UiTestFont.Create(),
            new UiFontFaceDescriptor("Static", UiFontWeight.Normal, UiFontStyle.Normal),
            out _);
        _ = staticProvider.TryGetFace(staticFace, out UiFontFace? staticFont);
        staticFont!.HasHinting.Should().BeFalse();
    }

    [Fact]
    public void HintsCompositeComponents()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.CreateHinted(),
            new UiFontFaceDescriptor("HintedComposite", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);

        var rasterizer = new UiGlyphRasterizer(provider);
        rasterizer.TryRasterize(face, 0x42, 10.0f, out UiGlyphBitmap hinted, out error)
            .Should().BeTrue(error.Message);
        byte[] hintedAlpha = hinted.Alpha.ToArray();

        rasterizer.TryRasterize(face, 0x42, 10.0f, out UiGlyphBitmap repeated, out _).Should().BeTrue();
        repeated.Alpha.ToArray().Should().Equal(hintedAlpha);

        rasterizer.EnableHinting = false;
        rasterizer.TryRasterize(face, 0x42, 10.0f, out UiGlyphBitmap plain, out error)
            .Should().BeTrue(error.Message);
        plain.Alpha.SequenceEqual(hintedAlpha).Should().BeFalse();
    }

    [Fact]
    public void AppliesCompositeGlyphInstructions()
    {
        using var withProvider = new UiFontProvider();
        UiFontFaceId withFace = withProvider.RegisterFace(
            UiTestFont.CreateHinted(compositeInstructions: true),
            new UiFontFaceDescriptor("CompositeInstructions", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        withFace.IsValid.Should().BeTrue(error.Message);

        using var withoutProvider = new UiFontProvider();
        UiFontFaceId withoutFace = withoutProvider.RegisterFace(
            UiTestFont.CreateHinted(),
            new UiFontFaceDescriptor("CompositeInstructions", UiFontWeight.Normal, UiFontStyle.Normal),
            out _);

        var withRasterizer = new UiGlyphRasterizer(withProvider);
        var withoutRasterizer = new UiGlyphRasterizer(withoutProvider);
        withRasterizer.TryRasterize(withFace, 0x42, 100.0f, out UiGlyphBitmap withInstructions, out error)
            .Should().BeTrue(error.Message);
        byte[] alpha = withInstructions.Alpha.ToArray();
        withoutRasterizer.TryRasterize(withoutFace, 0x42, 100.0f, out UiGlyphBitmap withoutInstructions, out _)
            .Should().BeTrue();
        withoutInstructions.Alpha.SequenceEqual(alpha).Should().BeFalse();
    }

    [Fact]
    public void HintsScaledCompositeComponents()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.CreateHinted(scaledComposite: true),
            new UiFontFaceDescriptor("ScaledComposite", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);

        var rasterizer = new UiGlyphRasterizer(provider);
        rasterizer.TryRasterize(face, 0x42, 10.0f, out UiGlyphBitmap hinted, out error)
            .Should().BeTrue(error.Message);
        byte[] hintedAlpha = hinted.Alpha.ToArray();

        rasterizer.EnableHinting = false;
        rasterizer.TryRasterize(face, 0x42, 10.0f, out UiGlyphBitmap plain, out error)
            .Should().BeTrue(error.Message);
        plain.Alpha.SequenceEqual(hintedAlpha).Should().BeFalse();
    }

    [Fact]
    public void HintsDeeplyNestedComposites()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.CreateDeepHinted(10),
            new UiFontFaceDescriptor("DeepComposite", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);

        var rasterizer = new UiGlyphRasterizer(provider);
        rasterizer.TryRasterize(face, 0x41, 10.0f, out UiGlyphBitmap hinted, out error)
            .Should().BeTrue(error.Message);
        byte[] hintedAlpha = hinted.Alpha.ToArray();
        rasterizer.TryRasterize(face, 0x41, 10.0f, out UiGlyphBitmap repeated, out _).Should().BeTrue();
        repeated.Alpha.ToArray().Should().Equal(hintedAlpha);

        rasterizer.EnableHinting = false;
        rasterizer.TryRasterize(face, 0x41, 10.0f, out UiGlyphBitmap plain, out error)
            .Should().BeTrue(error.Message);
        plain.Alpha.SequenceEqual(hintedAlpha).Should().BeFalse();
    }

    [Fact]
    public void AppliesNestedCompositeInstructions()
    {
        using var withProvider = new UiFontProvider();
        UiFontFaceId withFace = withProvider.RegisterFace(
            UiTestFont.CreateDeepHinted(4, nestedInstructions: true),
            new UiFontFaceDescriptor("NestedInstructions", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        withFace.IsValid.Should().BeTrue(error.Message);

        using var withoutProvider = new UiFontProvider();
        UiFontFaceId withoutFace = withoutProvider.RegisterFace(
            UiTestFont.CreateDeepHinted(4, nestedInstructions: false),
            new UiFontFaceDescriptor("NestedInstructions", UiFontWeight.Normal, UiFontStyle.Normal),
            out _);

        var withRasterizer = new UiGlyphRasterizer(withProvider);
        var withoutRasterizer = new UiGlyphRasterizer(withoutProvider);
        withRasterizer.TryRasterize(withFace, 0x41, 100.0f, out UiGlyphBitmap withInstructions, out error)
            .Should().BeTrue(error.Message);
        withoutRasterizer.TryRasterize(withoutFace, 0x41, 100.0f, out UiGlyphBitmap withoutInstructions, out _)
            .Should().BeTrue();
        withoutInstructions.Alpha.SequenceEqual(withInstructions.Alpha.ToArray()).Should().BeFalse();
    }

    [Fact]
    public void PhantomPointHintingLeavesOutlineUntouched()
    {
        WithFace(UiTestFont.CreateHinted(), face =>
        {
            float[] x = [.. PointX];
            float[] y = [.. PointY];
            bool[] onCurve = [.. OnCurve];
            int[] contourEnds = [.. ContourEnds];
            var hinter = new UiTrueTypeHinter();

            hinter.TryHintGlyph(
                face,
                100.0f,
                [0x00, 0xB0, 0x03, 0x2F],
                x,
                y,
                onCurve,
                contourEnds,
                3,
                600,
                out UiFontError error).Should().BeTrue(error.Message);

            x.Should().Equal(0.0f, 300.0f, 600.0f);
            y.Should().Equal(0.0f, 740.0f, 0.0f);

            hinter.TryHintGlyph(
                face,
                100.0f,
                [0x00, 0xB0, 0x04, 0x2F],
                x,
                y,
                onCurve,
                contourEnds,
                3,
                600,
                out error).Should().BeTrue(error.Message);

            x.Should().Equal(0.0f, 300.0f, 600.0f);
            y.Should().Equal(0.0f, 740.0f, 0.0f);
        });
    }

    [Fact]
    public void DeepCompositeHintingDoesNotAllocate()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.CreateDeepHinted(12),
            new UiFontFaceDescriptor("DeepAllocation", UiFontWeight.Normal, UiFontStyle.Normal),
            out _);
        var rasterizer = new UiGlyphRasterizer(provider);
        for (int i = 0; i < 32; i++)
        {
            _ = rasterizer.TryRasterize(face, 0x41, 10.0f, out _, out _);
        }

        bool rasterized = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            rasterized &= rasterizer.TryRasterize(face, 0x41, 10.0f, out UiGlyphBitmap bitmap, out _);
            rasterized &= !bitmap.IsEmpty;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        rasterized.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void WarmHintedRasterizationDoesNotAllocate()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.CreateHinted(),
            new UiFontFaceDescriptor("Hinted", UiFontWeight.Normal, UiFontStyle.Normal),
            out _);
        var rasterizer = new UiGlyphRasterizer(provider);
        for (int i = 0; i < 32; i++)
        {
            _ = rasterizer.TryRasterize(face, 0x41, 10.0f, out _, out _);
            _ = rasterizer.TryRasterize(face, 0x42, 10.0f, out _, out _);
        }

        bool rasterized = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            rasterized &= rasterizer.TryRasterize(face, 0x41, 10.0f, out UiGlyphBitmap simple, out _);
            rasterized &= !simple.IsEmpty;
            rasterized &= rasterizer.TryRasterize(face, 0x42, 10.0f, out UiGlyphBitmap composite, out _);
            rasterized &= !composite.IsEmpty;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        rasterized.Should().BeTrue();
        allocated.Should().Be(0);
    }

    private static void WithFace(byte[] font, Action<UiFontFace> assert)
    {
        using UiFontBuffer buffer = UiFontBuffer.FromSpan(font);
        bool parsed = UiFontParser.TryParse(
            buffer,
            UiFontProvider.FromFamilyName("Test"),
            "Test",
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            out UiFontFace? face,
            out UiFontError error);

        parsed.Should().BeTrue(error.Message);
        assert(face!);
    }
}
