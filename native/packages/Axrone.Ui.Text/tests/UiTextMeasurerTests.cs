namespace Axrone.Ui.Text.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiTextMeasurerTests
{
    [Fact]
    public void MeasuresNoWrapLineWithKerningAwareWidth()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics metrics = measurer.Measure("AV".AsSpan(), Style(face), UiMeasureConstraints.Unbounded);

        metrics.Width.Should().Be(1120.0f);
        metrics.LineHeight.Should().Be(1100.0f);
        metrics.Height.Should().Be(1100.0f);
        metrics.Baseline.Should().Be(800.0f);
        metrics.LineCount.Should().Be(1);
        metrics.Truncated.Should().BeFalse();
    }

    [Fact]
    public void WrapsWordsAtMaximumWidth()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics metrics = measurer.Measure(
            "AA AA".AsSpan(),
            Style(face, wrap: UiTextWrap.Word),
            new UiMeasureConstraints(0.0f, 0.0f, 1300.0f, float.PositiveInfinity));

        metrics.LineCount.Should().Be(2);
        metrics.Width.Should().Be(1200.0f);
        metrics.Height.Should().Be(2200.0f);
        metrics.Truncated.Should().BeFalse();
    }

    [Fact]
    public void BreaksLongWordsAtCharacterBoundaries()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics metrics = measurer.Measure(
            "AAAAAA".AsSpan(),
            Style(face, wrap: UiTextWrap.Word),
            new UiMeasureConstraints(0.0f, 0.0f, 1300.0f, float.PositiveInfinity));

        metrics.LineCount.Should().Be(3);
        metrics.Width.Should().Be(1200.0f);
    }

    [Fact]
    public void GraphemeWrapBreaksAtEveryGlyph()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics metrics = measurer.Measure(
            "AA AA".AsSpan(),
            Style(face, wrap: UiTextWrap.Grapheme),
            new UiMeasureConstraints(0.0f, 0.0f, 1300.0f, float.PositiveInfinity));

        metrics.LineCount.Should().Be(3);
    }

    [Fact]
    public void ClipsAtMaximumLines()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics metrics = measurer.Measure(
            "AA AA".AsSpan(),
            Style(face, wrap: UiTextWrap.Word, maxLines: 1),
            new UiMeasureConstraints(0.0f, 0.0f, 1300.0f, float.PositiveInfinity));

        metrics.LineCount.Should().Be(1);
        metrics.Width.Should().Be(1200.0f);
        metrics.Truncated.Should().BeTrue();
    }

    [Fact]
    public void AddsEllipsisWidthWhenTruncated()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics metrics = measurer.Measure(
            "AA AA".AsSpan(),
            Style(face, wrap: UiTextWrap.Word, maxLines: 1, overflow: UiTextOverflow.Ellipsis),
            new UiMeasureConstraints(0.0f, 0.0f, 1300.0f, float.PositiveInfinity));

        metrics.LineCount.Should().Be(1);
        metrics.Width.Should().Be(1300.0f);
        metrics.Truncated.Should().BeTrue();
    }

    [Fact]
    public void ClipsNoWrapOverflow()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics clip = measurer.Measure(
            "AV".AsSpan(),
            Style(face),
            new UiMeasureConstraints(0.0f, 0.0f, 1000.0f, float.PositiveInfinity));
        clip.Truncated.Should().BeTrue();
        clip.Width.Should().Be(1000.0f);

        UiTextMetrics ellipsis = measurer.Measure(
            "AV".AsSpan(),
            Style(face, overflow: UiTextOverflow.Ellipsis),
            new UiMeasureConstraints(0.0f, 0.0f, 1000.0f, float.PositiveInfinity));
        ellipsis.Truncated.Should().BeTrue();
        ellipsis.Width.Should().Be(1000.0f);
    }

    [Fact]
    public void CapsHeightToTheConstraint()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics metrics = measurer.Measure(
            "AA AA".AsSpan(),
            Style(face, wrap: UiTextWrap.Word),
            new UiMeasureConstraints(0.0f, 0.0f, 1300.0f, 1200.0f));

        metrics.LineCount.Should().Be(1);
        metrics.Height.Should().Be(1100.0f);
        metrics.Truncated.Should().BeTrue();
    }

    [Fact]
    public void HonorsExplicitLineHeight()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics metrics = measurer.Measure(
            "A".AsSpan(),
            Style(face, lineHeight: 1500.0f),
            UiMeasureConstraints.Unbounded);

        metrics.LineHeight.Should().Be(1500.0f);
        metrics.Height.Should().Be(1500.0f);
    }

    [Fact]
    public void CountsExplicitNewlines()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics twoLines = measurer.Measure("A\nB".AsSpan(), Style(face), UiMeasureConstraints.Unbounded);
        twoLines.LineCount.Should().Be(2);
        twoLines.Width.Should().Be(600.0f);

        UiTextMetrics emptyLine = measurer.Measure("\n".AsSpan(), Style(face), UiMeasureConstraints.Unbounded);
        emptyLine.LineCount.Should().Be(1);
        emptyLine.Width.Should().Be(0.0f);
    }

    [Fact]
    public void MeasuresEmptyAndInvalidInputs()
    {
        using UiFontProvider provider = CreateProvider(out UiFontFaceId face);
        var measurer = new UiTextMeasurer(provider);

        UiTextMetrics empty = measurer.Measure(ReadOnlySpan<char>.Empty, Style(face), UiMeasureConstraints.Unbounded);
        empty.Width.Should().Be(0.0f);
        empty.Height.Should().Be(0.0f);
        empty.LineCount.Should().Be(0);
        empty.LineHeight.Should().Be(1100.0f);

        UiTextMetrics invalidFace = measurer.Measure("A".AsSpan(), Style(new UiFontFaceId(9999)), UiMeasureConstraints.Unbounded);
        invalidFace.LineHeight.Should().Be(0.0f);

        UiTextMetrics zeroSize = measurer.Measure("A".AsSpan(), Style(face, size: 0.0f), UiMeasureConstraints.Unbounded);
        zeroSize.LineHeight.Should().Be(0.0f);

        FluentActions.Invoking(static () => new UiTextMeasurer(null!)).Should().Throw<ArgumentNullException>();
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
        float lineHeight = 0.0f,
        UiTextWrap wrap = UiTextWrap.None,
        UiTextOverflow overflow = UiTextOverflow.Clip,
        int maxLines = 0) =>
        new(
            face,
            size,
            lineHeight,
            0.0f,
            wrap,
            overflow,
            UiTextAlign.Start,
            UiTextDirection.Ltr,
            maxLines);
}
