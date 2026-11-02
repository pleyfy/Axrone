namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiColorPaintTests
{
    [Fact]
    public void ReadsLinearGradientPaint()
    {
        WithFace(UiTestFont.CreateColorV1(UiTestColorV1.Linear), face =>
        {
            face.HasColorPaintGraph.Should().BeTrue();
            face.TryGetColorPaint(0x41, out UiColorPaint root).Should().BeTrue();
            root.Kind.Should().Be(UiColorPaintKind.LinearGradient);
            face.TryGetPaintChildCount(root, out int children).Should().BeTrue();
            children.Should().Be(0);

            face.TryGetPaintGradient(root, out UiColorGradient gradient).Should().BeTrue();
            face.TryGetLinearGradient(gradient, out UiColorLinearGradient linear).Should().BeTrue();
            linear.Extend.Should().Be(UiColorExtendMode.Pad);
            linear.X0.Should().Be(0.0f);
            linear.Y0.Should().Be(0.0f);
            linear.X1.Should().Be(640.0f);
            linear.Y1.Should().Be(0.0f);
            linear.X2.Should().Be(0.0f);
            linear.Y2.Should().Be(640.0f);

            face.TryGetGradientStopCount(gradient, out int stops).Should().BeTrue();
            stops.Should().Be(2);
            face.TryGetGradientStop(gradient, 0, out UiColorGradientStop first).Should().BeTrue();
            first.Should().Be(new UiColorGradientStop(0.0f, 0, 1.0f));
            face.TryGetGradientStop(gradient, 1, out UiColorGradientStop second).Should().BeTrue();
            second.Should().Be(new UiColorGradientStop(1.0f, 1, 1.0f));
        });
    }

    [Fact]
    public void ReadsGlyphPaintAndGradient()
    {
        WithFace(UiTestFont.CreateColorV1(UiTestColorV1.Glyph), face =>
        {
            face.TryGetColorPaint(0x41, out UiColorPaint root).Should().BeTrue();
            root.Kind.Should().Be(UiColorPaintKind.Glyph);
            face.TryGetPaintGlyph(root, out int glyphId).Should().BeTrue();
            glyphId.Should().Be(2);
            face.TryGetPaintChildCount(root, out int count).Should().BeTrue();
            count.Should().Be(1);
            face.TryGetPaintChild(root, 0, out UiColorPaint child).Should().BeTrue();
            child.Kind.Should().Be(UiColorPaintKind.LinearGradient);
            face.TryGetPaintGradient(child, out UiColorGradient gradient).Should().BeTrue();
            face.TryGetLinearGradient(gradient, out UiColorLinearGradient linear).Should().BeTrue();
            linear.Extend.Should().Be(UiColorExtendMode.Reflect);
        });
    }

    [Fact]
    public void ReadsLayerRadialGradientAndTransforms()
    {
        WithFace(UiTestFont.CreateColorV1(UiTestColorV1.Layers), face =>
        {
            face.TryGetColorPaint(0x41, out UiColorPaint root).Should().BeTrue();
            root.Kind.Should().Be(UiColorPaintKind.ColrLayers);
            face.TryGetPaintChildCount(root, out int count).Should().BeTrue();
            count.Should().Be(2);

            face.TryGetPaintChild(root, 0, out UiColorPaint solid).Should().BeTrue();
            solid.Kind.Should().Be(UiColorPaintKind.Solid);
            face.TryGetPaintSolid(solid, out int palette, out float alpha).Should().BeTrue();
            palette.Should().Be(0);
            alpha.Should().Be(1.0f);

            face.TryGetPaintChild(root, 1, out UiColorPaint radial).Should().BeTrue();
            radial.Kind.Should().Be(UiColorPaintKind.RadialGradient);
            face.TryGetPaintGradient(radial, out UiColorGradient gradient).Should().BeTrue();
            face.TryGetRadialGradient(gradient, out UiColorRadialGradient value).Should().BeTrue();
            value.Extend.Should().Be(UiColorExtendMode.Repeat);
            value.R1.Should().Be(480.0f);
            face.TryGetGradientStopCount(gradient, out int stops).Should().BeTrue();
            stops.Should().Be(2);

            WithFace(UiTestFont.CreateColorV1(UiTestColorV1.Transform), transformFace =>
            {
                transformFace.TryGetColorPaint(0x41, out UiColorPaint transform).Should().BeTrue();
                transform.Kind.Should().Be(UiColorPaintKind.Transform);
                transformFace.TryGetPaintTransform(transform, out UiColorAffine affine).Should().BeTrue();
                affine.Should().Be(new UiColorAffine(2.0f, 0.0f, 0.0f, 2.0f, 10.0f, 20.0f));
                transformFace.TryGetPaintChild(transform, 0, out UiColorPaint child).Should().BeTrue();
                child.Kind.Should().Be(UiColorPaintKind.Solid);
                transformFace.TryGetPaintSolid(child, out int childPalette, out _).Should().BeTrue();
                childPalette.Should().Be(1);
            });
        });
    }

    [Fact]
    public void ReadsRotatePaintTransform()
    {
        WithFace(UiTestFont.CreateColorV1(UiTestColorV1.GlyphRotate), face =>
        {
            face.TryGetColorPaint(0x41, out UiColorPaint root).Should().BeTrue();
            root.Kind.Should().Be(UiColorPaintKind.Transform);
            face.TryGetPaintTransform(root, out UiColorAffine affine).Should().BeTrue();
            float diagonal = MathF.Sqrt(0.5f);
            affine.XX.Should().BeApproximately(diagonal, 0.001f);
            affine.YX.Should().BeApproximately(diagonal, 0.001f);
            affine.XY.Should().BeApproximately(-diagonal, 0.001f);
            affine.YY.Should().BeApproximately(diagonal, 0.001f);
        });
    }

    [Fact]
    public void ReadsCompositePaint()
    {
        WithFace(UiTestFont.CreateColorV1(UiTestColorV1.Composite), face =>
        {
            face.TryGetColorPaint(0x41, out UiColorPaint root).Should().BeTrue();
            root.Kind.Should().Be(UiColorPaintKind.Composite);
            face.TryGetPaintComposite(root, out UiColorCompositeMode mode).Should().BeTrue();
            mode.Should().Be(UiColorCompositeMode.SourceOver);
            face.TryGetPaintChildCount(root, out int count).Should().BeTrue();
            count.Should().Be(2);
            face.TryGetPaintChild(root, 0, out UiColorPaint source).Should().BeTrue();
            face.TryGetPaintSolid(source, out int sourcePalette, out _).Should().BeTrue();
            sourcePalette.Should().Be(0);
            face.TryGetPaintChild(root, 1, out UiColorPaint backdrop).Should().BeTrue();
            face.TryGetPaintSolid(backdrop, out int backdropPalette, out _).Should().BeTrue();
            backdropPalette.Should().Be(1);
        });
    }

    [Fact]
    public void ResolvesColrGlyphReferences()
    {
        WithFace(UiTestFont.CreateColorV1(UiTestColorV1.ColrGlyph), face =>
        {
            face.TryGetColorPaint(0x56, out UiColorPaint root).Should().BeTrue();
            root.Kind.Should().Be(UiColorPaintKind.ColrGlyph);
            face.TryGetPaintGlyph(root, out int glyphId).Should().BeTrue();
            glyphId.Should().Be(2);
            face.TryGetPaintChild(root, 0, out UiColorPaint child).Should().BeTrue();
            child.Kind.Should().Be(UiColorPaintKind.Solid);

            face.TryGetColorPaint(0x41, out UiColorPaint direct).Should().BeTrue();
            direct.Kind.Should().Be(UiColorPaintKind.Solid);
            face.GetColorLayers(0x41, Span<UiColorLayer>.Empty).Should().Be(0);
        });
    }

    [Fact]
    public void RejectsUnsupportedCorruptAndCyclicPaintGraphs()
    {
        UiFontError unsupported = ParseError(UiTestFont.CreateColorV1(UiTestColorV1.Unsupported));
        unsupported.Code.Should().Be(UiFontErrorCode.UnsupportedColorFormat);
        unsupported.Message.Should().Contain("paint");

        ParseError(UiTestFont.CreateColorV1(UiTestColorV1.Corrupt)).Code
            .Should().Be(UiFontErrorCode.InvalidColor);
        ParseError(UiTestFont.CreateColorV1(UiTestColorV1.Cycle)).Code
            .Should().Be(UiFontErrorCode.InvalidColor);
    }

    [Fact]
    public void PaintQueriesDoNotAllocateAndAreDeterministic()
    {
        WithFace(UiTestFont.CreateColorV1(UiTestColorV1.Layers), face =>
        {
            for (int i = 0; i < 32; i++)
            {
                _ = Query(face);
            }

            bool ok = true;
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 64; i++)
            {
                ok &= Query(face);
            }

            long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
            ok.Should().BeTrue();
            allocated.Should().Be(0);

            Query(face).Should().BeTrue();
            Query(face).Should().BeTrue();
        });
    }

    private static bool Query(UiFontFace face)
    {
        if (!face.TryGetColorPaint(0x41, out UiColorPaint root) ||
            !face.TryGetPaintChildCount(root, out int count) ||
            count != 2 ||
            !face.TryGetPaintChild(root, 1, out UiColorPaint child) ||
            !face.TryGetPaintGradient(child, out UiColorGradient gradient) ||
            !face.TryGetRadialGradient(gradient, out UiColorRadialGradient radial) ||
            radial.R1 != 480.0f ||
            !face.TryGetGradientStop(gradient, 1, out UiColorGradientStop stop))
        {
            return false;
        }

        return stop.PaletteIndex == 1 && stop.Offset == 1.0f;
    }

    private static void WithFace(byte[] font, Action<UiFontFace> assert)
    {
        using UiFontBuffer buffer = UiFontBuffer.FromSpan(font);
        bool parsed = UiFontParser.TryParse(
            buffer,
            UiFontProvider.FromFamilyName("Paint"),
            "Paint",
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            out UiFontFace? face,
            out UiFontError error);

        parsed.Should().BeTrue(error.Message);
        assert(face!);
    }

    private static UiFontError ParseError(byte[] font)
    {
        using UiFontBuffer buffer = UiFontBuffer.FromSpan(font);
        bool parsed = UiFontParser.TryParse(
            buffer,
            UiFontProvider.FromFamilyName("Paint"),
            "Paint",
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            out _,
            out UiFontError error);

        parsed.Should().BeFalse();
        return error;
    }
}
