namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiTextLayoutTests
{
    [Fact]
    public void AlignsGlyphsInsideTheAvailableWidth()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var buffer = new UiTextLayoutBuffer(provider);
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1000.0f, float.PositiveInfinity);

        buffer.TryLayout("A".AsSpan(), Style(face, UiTextAlign.Start), constraints).Should().BeTrue();
        buffer.Glyphs[0].X.Should().Be(0.0f);

        buffer.TryLayout("A".AsSpan(), Style(face, UiTextAlign.Center), constraints).Should().BeTrue();
        buffer.Glyphs[0].X.Should().Be(200.0f);

        buffer.TryLayout("A".AsSpan(), Style(face, UiTextAlign.End), constraints).Should().BeTrue();
        buffer.Glyphs[0].X.Should().Be(400.0f);
    }

    [Fact]
    public void JustifiesEveryLineExceptTheLast()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var buffer = new UiTextLayoutBuffer(provider);
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1300.0f, float.PositiveInfinity);

        buffer.TryLayout(
            "AB AB".AsSpan(),
            Style(face, UiTextAlign.Justify, wrap: UiTextWrap.Word),
            constraints).Should().BeTrue();

        buffer.Glyphs.Length.Should().Be(4);
        buffer.Glyphs[0].X.Should().Be(0.0f);
        buffer.Glyphs[0].Y.Should().Be(0.0f);
        buffer.Glyphs[1].X.Should().Be(700.0f);
        buffer.Glyphs[1].Y.Should().Be(0.0f);
        buffer.Glyphs[2].X.Should().Be(0.0f);
        buffer.Glyphs[2].Y.Should().Be(1100.0f);
        buffer.Glyphs[3].X.Should().Be(600.0f);
        buffer.Glyphs[3].Y.Should().Be(1100.0f);
    }

    [Fact]
    public void JustifiesAtWordSpaces()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var buffer = new UiTextLayoutBuffer(provider);
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1600.0f, float.PositiveInfinity);

        buffer.TryLayout(
            "A A\nB".AsSpan(),
            Style(face, UiTextAlign.Justify, wrap: UiTextWrap.Word),
            constraints).Should().BeTrue();

        buffer.Glyphs.Length.Should().Be(4);
        buffer.Glyphs[0].X.Should().Be(0.0f);
        buffer.Glyphs[1].X.Should().Be(600.0f);
        buffer.Glyphs[2].X.Should().Be(1000.0f);
        buffer.Glyphs[3].X.Should().Be(0.0f);
        buffer.Glyphs[3].Y.Should().Be(1100.0f);
    }

    [Fact]
    public void ExposesSizeMetricsAndIdentity()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var first = new UiTextLayoutBuffer(provider, glyphCapacity: 1);
        var second = new UiTextLayoutBuffer(provider);

        first.Id.IsValid.Should().BeTrue();
        second.Id.IsValid.Should().BeTrue();
        first.Id.Should().NotBe(second.Id);

        first.TryLayout("AV".AsSpan(), Style(face), UiMeasureConstraints.Unbounded).Should().BeTrue();

        first.Size.Width.Should().Be(1120.0f);
        first.Size.Height.Should().Be(1100.0f);
        first.Metrics.LineCount.Should().Be(1);
        first.Glyphs.Length.Should().Be(2);
    }

    [Fact]
    public void GrowsGlyphCapacityOnDemand()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var buffer = new UiTextLayoutBuffer(provider, glyphCapacity: 1);

        buffer.TryLayout("AAAA".AsSpan(), Style(face), UiMeasureConstraints.Unbounded).Should().BeTrue();

        buffer.Glyphs.Length.Should().Be(4);
        buffer.Glyphs[3].X.Should().Be(1800.0f);
    }

    [Fact]
    public void HandlesEmptyAndInvalidLayouts()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var buffer = new UiTextLayoutBuffer(provider);

        buffer.TryLayout(ReadOnlySpan<char>.Empty, Style(face), UiMeasureConstraints.Unbounded).Should().BeTrue();
        buffer.Glyphs.Length.Should().Be(0);
        buffer.Size.Should().Be(UiSize.Zero);

        buffer.TryLayout("A".AsSpan(), Style(new UiFontFaceId(9999)), UiMeasureConstraints.Unbounded).Should().BeFalse();
        buffer.Glyphs.Length.Should().Be(0);
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
        UiTextAlign align = UiTextAlign.Start,
        UiTextWrap wrap = UiTextWrap.None) =>
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
