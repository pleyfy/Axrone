namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiColorFontTests
{
    [Fact]
    public void ParsesColorLayers()
    {
        WithFace(UiTestFont.CreateColor(), face =>
        {
            face.HasColorLayers.Should().BeTrue();
            face.ColorPaletteCount.Should().Be(2);
            face.ColorPaletteEntryCount.Should().Be(2);

            var layers = new UiColorLayer[4];
            int count = face.GetColorLayers(0x41, layers);
            count.Should().Be(2);
            layers[0].Should().Be(new UiColorLayer(2, 0));
            layers[1].Should().Be(new UiColorLayer(3, 1));

            face.GetColorLayers(0x56, layers).Should().Be(0);
            face.GetColorLayersByGlyph(2, layers).Should().Be(2);

            var single = new UiColorLayer[1];
            face.GetColorLayers(0x41, single).Should().Be(2);
            single[0].Should().Be(new UiColorLayer(2, 0));
        });
    }

    [Fact]
    public void ReadsPaletteColors()
    {
        WithFace(UiTestFont.CreateColor(), face =>
        {
            face.TryGetColor(0, 0, out uint black).Should().BeTrue();
            black.Should().Be(0xFF000000u);
            face.TryGetColor(0, 1, out uint red).Should().BeTrue();
            red.Should().Be(0xFFFF0000u);
            face.TryGetColor(1, 0, out uint white).Should().BeTrue();
            white.Should().Be(0xFFFFFFFFu);
            face.TryGetColor(1, 1, out uint blue).Should().BeTrue();
            blue.Should().Be(0xFF0000FFu);

            face.TryGetColor(-1, 0, out _).Should().BeFalse();
            face.TryGetColor(2, 0, out _).Should().BeFalse();
            face.TryGetColor(0, 2, out _).Should().BeFalse();
        });
    }

    [Fact]
    public void ParsesColrV1WhenOnlyV0RecordsAreUsed()
    {
        WithFace(UiTestFont.CreateColor(colrV1: true), face =>
        {
            face.HasColorLayers.Should().BeTrue();
            var layers = new UiColorLayer[4];
            face.GetColorLayers(0x41, layers).Should().Be(2);
            layers[0].Should().Be(new UiColorLayer(2, 0));
            layers[1].Should().Be(new UiColorLayer(3, 1));
            face.TryGetColor(1, 1, out uint color).Should().BeTrue();
            color.Should().Be(0xFF0000FFu);
        });
    }

    [Fact]
    public void RejectsUnsupportedColrV1Paints()
    {
        UiFontError error = ParseError(UiTestFont.CreateColorV1(UiTestColorV1.Unsupported));
        error.Code.Should().Be(UiFontErrorCode.UnsupportedColorFormat);
    }

    [Fact]
    public void RejectsMalformedColorTables()
    {
        UiFontError error = ParseError(UiTestFont.CreateColor(corrupt: true));
        error.Code.Should().Be(UiFontErrorCode.InvalidColor);

        using UiFontBuffer buffer = UiFontBuffer.FromSpan(UiTestFont.CreateColor());
        UiColorData.TryParse(buffer.Span, -1, 0, 0, 0, out _, out _).Should().BeFalse();
    }

    [Fact]
    public void ColorLookupsDoNotAllocate()
    {
        WithFace(UiTestFont.CreateColor(), face =>
        {
            var layers = new UiColorLayer[4];
            for (int i = 0; i < 32; i++)
            {
                _ = face.GetColorLayers(0x41, layers);
                _ = face.TryGetColor(0, 1, out _);
            }

            bool found = true;
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < 64; i++)
            {
                found &= face.GetColorLayers(0x41, layers) == 2;
                found &= face.TryGetColor(1, 1, out uint color);
                found &= color == 0xFF0000FFu;
            }

            long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
            found.Should().BeTrue();
            allocated.Should().Be(0);
        });
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
