namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiCffTests
{
    private static readonly UiFontFamilyId Family = UiFontProvider.FromFamilyName("Test");

    [Fact]
    public void ParsesCffBoundsForCurvesAndSubroutines()
    {
        WithFace(UiTestFont.Create(cff: true), face =>
        {
            face.OutlineFormat.Should().Be(UiFontOutlineFormat.Cff);

            face.TryGetGlyphMetrics(0x41, out UiGlyphMetrics a).Should().BeTrue();
            a.BearingX.Should().Be(50.0f);
            a.BearingY.Should().Be(600.0f);
            a.Width.Should().Be(500.0f);
            a.Height.Should().Be(600.0f);

            face.TryGetGlyphMetrics(0x56, out UiGlyphMetrics v).Should().BeTrue();
            v.Width.Should().Be(600.0f);
            v.Height.Should().Be(600.0f);

            face.TryGetGlyphMetrics(0x66, out UiGlyphMetrics curve).Should().BeTrue();
            curve.Width.Should().Be(300.0f);
            curve.Height.Should().Be(500.0f);

            face.TryGetGlyphMetrics(0x69, out UiGlyphMetrics localSubr).Should().BeTrue();
            localSubr.BearingX.Should().Be(50.0f);
            localSubr.Width.Should().Be(500.0f);
            localSubr.Height.Should().Be(400.0f);

            face.TryGetGlyphMetrics(0x6C, out UiGlyphMetrics globalSubr).Should().BeTrue();
            globalSubr.BearingX.Should().Be(50.0f);
            globalSubr.Width.Should().Be(300.0f);
            globalSubr.Height.Should().Be(400.0f);

            face.TryGetGlyphMetrics(0x42, out UiGlyphMetrics flex).Should().BeTrue();
            flex.Width.Should().Be(400.0f);
            flex.Height.Should().Be(200.0f);

            face.TryGetGlyphMetrics(0x2026, out UiGlyphMetrics hhCurve).Should().BeTrue();
            hhCurve.Width.Should().Be(300.0f);
            hhCurve.Height.Should().Be(300.0f);

            face.TryGetGlyphMetrics(0x20, out UiGlyphMetrics space).Should().BeTrue();
            space.Advance.Should().Be(300.0f);
            space.Width.Should().Be(0.0f);
            space.Height.Should().Be(0.0f);
        });
    }

    [Fact]
    public void RasterizesCffCurvesAndSubroutines()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);
        int[] codePoints = [0x41, 0x56, 0x66, 0x69, 0x6C, 0x42, 0x2026];

        foreach (int codePoint in codePoints)
        {
            rasterizer.TryRasterize(face, codePoint, 100.0f, out UiGlyphBitmap bitmap, out UiFontError error)
                .Should().BeTrue(error.Message);
            bitmap.IsEmpty.Should().BeFalse();
            bitmap.Alpha.ToArray().Sum(static value => value).Should().BeGreaterThan(0);
        }
    }

    [Fact]
    public void CffRasterizationIsDeterministic()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);

        rasterizer.TryRasterize(face, 0x66, 100.0f, out UiGlyphBitmap first, out _).Should().BeTrue();
        byte[] firstAlpha = first.Alpha.ToArray();
        rasterizer.TryRasterize(face, 0x66, 100.0f, out UiGlyphBitmap second, out _).Should().BeTrue();

        second.Alpha.ToArray().Should().Equal(firstAlpha);
    }

    [Fact]
    public void CffRasterizationDoesNotAllocate()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var rasterizer = new UiGlyphRasterizer(provider);

        for (int i = 0; i < 32; i++)
        {
            _ = rasterizer.TryRasterize(face, 0x66, 100.0f, out _, out _);
        }

        bool rasterized = true;
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            rasterized &= rasterizer.TryRasterize(face, 0x66, 100.0f, out UiGlyphBitmap bitmap, out _);
            rasterized &= !bitmap.IsEmpty;
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        rasterized.Should().BeTrue();
        allocated.Should().Be(0);
    }

    [Fact]
    public void RejectsMalformedCff()
    {
        byte[] font = UiTestFont.Create(cff: true);
        int cff = UiTestFont.TableOffset(font, "CFF ");
        int cffRecord = UiTestFont.TableRecord(font, "CFF ");

        byte[] truncated = (byte[])font.Clone();
        WriteI32(truncated, cffRecord + 12, 4);
        ParseError(truncated).Code.Should().Be(UiFontErrorCode.InvalidCff);

        byte[] badCharStrings = (byte[])font.Clone();
        WriteI32(badCharStrings, cff + 19, 0x00FFFFFF);
        ParseError(badCharStrings).Code.Should().Be(UiFontErrorCode.InvalidCff);

        int charStringsOffset = ReadI32(font, cff + 19);
        int charStrings = cff + charStringsOffset;
        byte[] countMismatch = (byte[])font.Clone();
        countMismatch[charStrings] = 0;
        countMismatch[charStrings + 1] = 11;
        ParseError(countMismatch).Code.Should().Be(UiFontErrorCode.InvalidCff);

        int offsetSize = font[charStrings + 2];
        int firstCharString = charStrings + 3 + ((12 + 1) * offsetSize);
        byte[] badOperator = (byte[])font.Clone();
        badOperator[firstCharString] = 0;
        ParseError(badOperator).Code.Should().Be(UiFontErrorCode.InvalidCff);
    }

    private static UiFontProvider CreateProvider(out UiFontFaceId face)
    {
        var provider = new UiFontProvider();
        face = provider.RegisterFace(
            UiTestFont.Create(cff: true),
            new UiFontFaceDescriptor("Test", UiFontWeight.Normal, UiFontStyle.Normal),
            out UiFontError error);
        face.IsValid.Should().BeTrue(error.Message);
        return provider;
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

    private static int ReadI32(byte[] data, int offset) =>
        (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];

    private static void WriteI32(byte[] data, int offset, int value)
    {
        data[offset] = (byte)(value >> 24);
        data[offset + 1] = (byte)(value >> 16);
        data[offset + 2] = (byte)(value >> 8);
        data[offset + 3] = (byte)value;
    }
}
