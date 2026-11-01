namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiCmapFormatTests
{
    private static readonly UiFontFamilyId Family = UiFontProvider.FromFamilyName("Test");

    [Fact]
    public void ParsesFormat0()
    {
        WithFace(UiTestFont.CreateFormat0(), face =>
        {
            face.TryGetGlyph(0x41, out int a).Should().BeTrue();
            a.Should().Be(2);
            face.TryGetGlyph(0x56, out int v).Should().BeTrue();
            v.Should().Be(3);
            face.TryGetGlyph(0xE9, out int e).Should().BeTrue();
            e.Should().Be(8);
            face.TryGetGlyph(0x5A, out _).Should().BeFalse();
            face.GetCanonicalCodePoint(2).Should().Be(0x41);
            face.GetCanonicalCodePoint(3).Should().Be(0x56);
        });
    }

    [Fact]
    public void ParsesFormat6()
    {
        WithFace(UiTestFont.CreateFormat6(), face =>
        {
            face.TryGetGlyph(0x20, out int space).Should().BeTrue();
            space.Should().Be(1);
            face.TryGetGlyph(0x41, out int a).Should().BeTrue();
            a.Should().Be(2);
            face.TryGetGlyph(0x6C, out int l).Should().BeTrue();
            l.Should().Be(6);
            face.TryGetGlyph(0xE9, out _).Should().BeFalse();
            face.GetCanonicalCodePoint(6).Should().Be(0x6C);
        });
    }

    [Fact]
    public void ParsesFormat13ConstantGroups()
    {
        WithFace(UiTestFont.CreateFormat13(), face =>
        {
            face.TryGetGlyph(0x41, out int a).Should().BeTrue();
            a.Should().Be(2);
            face.TryGetGlyph(0x60, out int first).Should().BeTrue();
            first.Should().Be(8);
            face.TryGetGlyph(0x61, out int second).Should().BeTrue();
            second.Should().Be(8);
            face.TryGetGlyph(0x56, out int v).Should().BeTrue();
            v.Should().Be(3);
            face.GetCanonicalCodePoint(8).Should().Be(0x60);
        });
    }

    [Fact]
    public void ParsesVariationSequences()
    {
        WithFace(UiTestFont.CreateFormat14(), face =>
        {
            face.TryGetGlyph(0x41, out int baseGlyph).Should().BeTrue();
            baseGlyph.Should().Be(2);

            face.TryGetGlyph(0x41, 0xFE0F, out int nonDefault).Should().BeTrue();
            nonDefault.Should().Be(3);
            face.TryGetVariationGlyph(0x41, 0xFE0F, out int mapped, out bool isDefault).Should().BeTrue();
            mapped.Should().Be(3);
            isDefault.Should().BeFalse();

            face.TryGetGlyph(0x41, 0xFE0E, out int defaultGlyph).Should().BeTrue();
            defaultGlyph.Should().Be(2);
            face.TryGetVariationGlyph(0x41, 0xFE0E, out int inherited, out bool defaulted).Should().BeTrue();
            inherited.Should().Be(2);
            defaulted.Should().BeTrue();

            face.TryGetVariationGlyph(0x56, 0xFE0F, out _, out _).Should().BeFalse();
            face.TryGetGlyph(0x41, 0xFE01, out int fallback).Should().BeTrue();
            fallback.Should().Be(2);
            face.GetCanonicalCodePoint(3).Should().Be(0x56);
        });
    }

    [Fact]
    public void ShaperUsesExtendedCmap()
    {
        using var provider = new UiFontProvider();
        UiFontFaceId face = provider.RegisterFace(
            UiTestFont.CreateFormat6(),
            new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);
        var shaper = new UiTextShaper(provider);
        var style = new UiTextStyle(face, 1000.0f, 0.0f, 0.0f, UiTextWrap.None, UiTextOverflow.Clip, UiTextAlign.Start, UiTextDirection.Ltr, 0);
        var glyphs = new UiShapedGlyph[4];

        int count = shaper.Shape("AV".AsSpan(), style, glyphs);

        count.Should().Be(2);
        glyphs[0].Advance.Should().Be(600.0f);
        glyphs[1].X.Should().Be(520.0f);
    }

    [Fact]
    public void RejectsMalformedExtendedCmaps()
    {
        byte[] format0 = UiTestFont.CreateFormat0();
        int subtable = Subtable(format0, 0);
        format0[subtable + 3] = 10;
        ParseError(format0).Code.Should().Be(UiFontErrorCode.InvalidCmap);

        byte[] format6 = UiTestFont.CreateFormat6();
        subtable = Subtable(format6, 0);
        format6[subtable + 8] = 0xFF;
        format6[subtable + 9] = 0xFF;
        ParseError(format6).Code.Should().Be(UiFontErrorCode.InvalidCmap);

        byte[] format13 = UiTestFont.CreateFormat13();
        subtable = Subtable(format13, 0);
        format13[subtable + 16 + 8] = 0xFF;
        format13[subtable + 16 + 9] = 0xFF;
        format13[subtable + 16 + 10] = 0xFF;
        format13[subtable + 16 + 11] = 0xFF;
        ParseError(format13).Code.Should().Be(UiFontErrorCode.InvalidCmap);

        byte[] format14 = UiTestFont.CreateFormat14();
        int uvs = Subtable(format14, 1);
        format14[uvs + 10 + 7] = 0;
        format14[uvs + 10 + 8] = 0;
        format14[uvs + 10 + 9] = 0;
        format14[uvs + 10 + 10] = 49;
        ParseError(format14).Code.Should().Be(UiFontErrorCode.InvalidCmap);
    }

    private static void WithFace(byte[] font, Action<UiFontFace> assert)
    {
        using UiFontBuffer buffer = UiFontBuffer.FromSpan(font);
        bool parsed = UiFontParser.TryParse(
            buffer,
            Family,
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
            Family,
            "Test",
            UiFontWeight.Normal,
            UiFontStyle.Normal,
            out _,
            out UiFontError error);

        parsed.Should().BeFalse();
        return error;
    }

    private static int Subtable(byte[] font, int record)
    {
        int cmap = UiTestFont.TableOffset(font, "cmap");
        uint offset = ReadU32(font, cmap + 4 + (record * 8) + 4);
        return cmap + (int)offset;
    }

    private static uint ReadU32(byte[] data, int offset) =>
        (uint)((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]);
}
