namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiFontParserTests
{
    private static readonly UiFontFamilyId Family = UiFontProvider.FromFamilyName("Test");

    [Fact]
    public void ParsesSyntheticTables()
    {
        WithFace(UiTestFont.Create(), face =>
        {
            face.UnitsPerEm.Should().Be(1000);
            face.GlyphCount.Should().Be(UiTestFont.GlyphCount);
            face.Ascender.Should().Be(800);
            face.Descender.Should().Be(-200);
            face.LineGap.Should().Be(100);
            face.OutlineFormat.Should().Be(UiFontOutlineFormat.TrueType);

            face.TryGetGlyph(0x41, out int a).Should().BeTrue();
            a.Should().Be(2);
            face.TryGetGlyph(0x56, out int v).Should().BeTrue();
            v.Should().Be(3);
            face.TryGetGlyph(0x1F600, out _).Should().BeFalse();
            face.TryGetGlyph(0x5A, out _).Should().BeFalse();

            face.TryGetGlyphMetrics(0x41, out UiGlyphMetrics metrics).Should().BeTrue();
            metrics.Advance.Should().Be(600.0f);
            metrics.BearingX.Should().Be(0.0f);
            metrics.BearingY.Should().Be(700.0f);
            metrics.Width.Should().Be(600.0f);
            metrics.Height.Should().Be(700.0f);

            face.TryGetGlyphMetrics(0x66, out UiGlyphMetrics f).Should().BeTrue();
            f.BearingX.Should().Be(50.0f);
            f.Width.Should().Be(350.0f);

            face.TryGetGlyphMetrics(0x42, out UiGlyphMetrics composite).Should().BeTrue();
            composite.BearingX.Should().Be(100.0f);
            composite.Width.Should().Be(600.0f);
            composite.Advance.Should().Be(600.0f);

            face.TryGetGlyphMetrics(0x20, out UiGlyphMetrics space).Should().BeTrue();
            space.Advance.Should().Be(300.0f);
            space.Width.Should().Be(0.0f);
            space.Height.Should().Be(0.0f);

            face.GetKerning(0x41, 0x56).Should().Be(-80.0f);
            face.GetKerning(0x56, 0x41).Should().Be(-80.0f);
            face.GetKerning(0x66, 0x69).Should().Be(-30.0f);
            face.GetKerning(0x41, 0x41).Should().Be(0.0f);
        });
    }

    [Fact]
    public void ParsesFormat12CmapAndAstralCodePoints()
    {
        WithFace(UiTestFont.Create(format12: true), face =>
        {
            face.TryGetGlyph(0x41, out int a).Should().BeTrue();
            a.Should().Be(2);
            face.TryGetGlyph(0x1F600, out int emoji).Should().BeTrue();
            emoji.Should().Be(8);
            face.TryGetGlyph(0xFB01, out int ligature).Should().BeTrue();
            ligature.Should().Be(9);
        });
    }

    [Fact]
    public void ParsesCffContainerWithMetricsOnly()
    {
        WithFace(UiTestFont.Create(cff: true), face =>
        {
            face.OutlineFormat.Should().Be(UiFontOutlineFormat.Cff);
            face.TryGetGlyphMetrics(0x41, out UiGlyphMetrics metrics).Should().BeTrue();
            metrics.Advance.Should().Be(600.0f);
            metrics.BearingX.Should().Be(50.0f);
            metrics.BearingY.Should().Be(600.0f);
            metrics.Width.Should().Be(500.0f);
            metrics.Height.Should().Be(600.0f);
            face.GetKerning(0x41, 0x56).Should().Be(-80.0f);
        });
    }

    [Fact]
    public void ParsesRepeatedHmtxAdvances()
    {
        WithFace(UiTestFont.Create(hMetrics: 8), face =>
        {
            face.TryGetGlyphMetrics(0x2026, out UiGlyphMetrics ellipsis).Should().BeTrue();
            ellipsis.Advance.Should().Be(UiTestFont.Advances[7]);
            face.TryGetGlyphMetrics(0x41, out UiGlyphMetrics a).Should().BeTrue();
            a.Advance.Should().Be(600.0f);
        });
    }

    [Fact]
    public void ParsesRealFont()
    {
        WithFace(UiTestFont.LoadRealFont(), face =>
        {
            face.UnitsPerEm.Should().Be(1024);
            face.GlyphCount.Should().Be(98);
            face.OutlineFormat.Should().Be(UiFontOutlineFormat.TrueType);
            face.TryGetGlyph(0x41, out int a).Should().BeTrue();
            a.Should().Be(36);
            face.TryGetGlyph(0x56, out int v).Should().BeTrue();
            v.Should().Be(57);
            face.TryGetGlyph(0x5A, out _).Should().BeTrue();
            face.TryGetGlyph(0xE9, out _).Should().BeFalse();
            face.GetKerning(0x41, 0x56).Should().Be(0.0f);

            face.TryGetGlyphMetrics(0x41, out UiGlyphMetrics metrics).Should().BeTrue();
            metrics.Advance.Should().BeGreaterThan(0.0f);
            metrics.Width.Should().BeGreaterThan(0.0f);
            metrics.Height.Should().BeGreaterThan(0.0f);
        });
    }

    [Fact]
    public void RejectsStructuralCorruption()
    {
        byte[] valid = UiTestFont.Create();
        var cases = new List<(string Name, byte[] Font, UiFontErrorCode Code)>();

        byte[] badVersion = Clone(valid);
        badVersion[0] = 0xFF;
        badVersion[1] = 0xFF;
        cases.Add(("sfnt version", badVersion, UiFontErrorCode.UnsupportedSfntVersion));

        cases.Add(("truncated header", valid[..8], UiFontErrorCode.Truncated));

        byte[] missingHead = Clone(valid);
        WriteTag(missingHead, UiTestFont.TableRecord(missingHead, "head"), "xxxx");
        cases.Add(("missing head", missingHead, UiFontErrorCode.MissingTable));

        byte[] badHeadMagic = Clone(valid);
        int head = UiTestFont.TableOffset(badHeadMagic, "head");
        badHeadMagic[head + 12] = 0;
        badHeadMagic[head + 13] = 0;
        badHeadMagic[head + 14] = 0;
        badHeadMagic[head + 15] = 0;
        cases.Add(("head magic", badHeadMagic, UiFontErrorCode.InvalidHead));

        byte[] badUnits = Clone(valid);
        head = UiTestFont.TableOffset(badUnits, "head");
        badUnits[head + 18] = 0;
        badUnits[head + 19] = 0;
        cases.Add(("unitsPerEm", badUnits, UiFontErrorCode.InvalidHead));

        byte[] badMaxp = Clone(valid);
        int maxp = UiTestFont.TableOffset(badMaxp, "maxp");
        badMaxp[maxp + 4] = 0;
        badMaxp[maxp + 5] = 0;
        cases.Add(("numGlyphs", badMaxp, UiFontErrorCode.InvalidMaxp));

        byte[] badHhea = Clone(valid);
        int hhea = UiTestFont.TableOffset(badHhea, "hhea");
        badHhea[hhea + 34] = 0;
        badHhea[hhea + 35] = 0;
        cases.Add(("numberOfHMetrics", badHhea, UiFontErrorCode.InvalidHhea));

        byte[] badHmtx = Clone(valid);
        int hmtxRecord = UiTestFont.TableRecord(badHmtx, "hmtx");
        badHmtx[hmtxRecord + 12] = 0;
        badHmtx[hmtxRecord + 13] = 0;
        badHmtx[hmtxRecord + 14] = 0;
        badHmtx[hmtxRecord + 15] = 4;
        cases.Add(("hmtx length", badHmtx, UiFontErrorCode.InvalidHmtx));

        byte[] badLoca = Clone(valid);
        int loca = UiTestFont.TableOffset(badLoca, "loca");
        badLoca[loca + 2] = 0xFF;
        badLoca[loca + 3] = 0xFF;
        cases.Add(("loca offsets", badLoca, UiFontErrorCode.InvalidLoca));

        byte[] badCmap = Clone(valid);
        int cmap = UiTestFont.TableOffset(badCmap, "cmap");
        badCmap[cmap + 12 + 6] = 0;
        badCmap[cmap + 12 + 7] = 0;
        cases.Add(("cmap segments", badCmap, UiFontErrorCode.InvalidCmap));

        byte[] badKern = Clone(valid);
        int kern = UiTestFont.TableOffset(badKern, "kern");
        badKern[kern + 4 + 14] = 0;
        badKern[kern + 4 + 15] = 3;
        badKern[kern + 4 + 16] = 0;
        badKern[kern + 4 + 17] = 2;
        cases.Add(("kern order", badKern, UiFontErrorCode.InvalidKern));

        byte[] badRange = Clone(valid);
        int headRecord = UiTestFont.TableRecord(badRange, "head");
        badRange[headRecord + 8] = 0xFF;
        badRange[headRecord + 9] = 0xFF;
        badRange[headRecord + 10] = 0xFF;
        badRange[headRecord + 11] = 0xFF;
        cases.Add(("table range", badRange, UiFontErrorCode.InvalidTableRange));

        foreach ((string name, byte[] font, UiFontErrorCode code) in cases)
        {
            UiFontError error = ParseError(font);
            error.Code.Should().Be(code, name);
        }
    }

    [Fact]
    public void BufferPathsExposeTheSameBytes()
    {
        byte[] data = UiTestFont.Create();
        using UiFontBuffer pinned = UiFontBuffer.FromSpan(data);
        using UiFontBuffer native = UiFontBuffer.FromNative(data);

        pinned.IsNative.Should().BeFalse();
        native.IsNative.Should().BeTrue();
        pinned.Length.Should().Be(data.Length);
        native.Length.Should().Be(data.Length);
        pinned.Span.SequenceEqual(data).Should().BeTrue();
        native.Span.SequenceEqual(data).Should().BeTrue();
    }

    [Fact]
    public void BufferRejectsEmptyAndDisposedAccess()
    {
        FluentActions.Invoking(static () => UiFontBuffer.FromSpan(ReadOnlySpan<byte>.Empty))
            .Should().Throw<ArgumentException>();

        UiFontBuffer buffer = UiFontBuffer.FromSpan(UiTestFont.Create());
        buffer.Dispose();
        buffer.Dispose();

        FluentActions.Invoking(() => { _ = buffer.Span; }).Should().Throw<ObjectDisposedException>();
        FluentActions.Invoking(() => { _ = buffer.Length; }).Should().Throw<ObjectDisposedException>();
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

    private static byte[] Clone(byte[] source) => (byte[])source.Clone();

    private static void WriteTag(byte[] font, int record, string tag)
    {
        if (record < 0)
        {
            return;
        }

        for (int i = 0; i < 4; i++)
        {
            font[record + i] = (byte)tag[i];
        }
    }
}
