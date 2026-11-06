namespace Axrone.Ui.Tests;

using FluentAssertions;
using Xunit;

/// <summary>Deterministic linear text model: width = chars × 8 × size/15, height = 16 × size/15.</summary>
internal sealed class LinearTextMeasurer : IUiTextMeasurer
{
    public int MeasureCount { get; private set; }

    public UiTextMetrics Measure(ReadOnlySpan<char> text, in UiTextStyle style, in UiMeasureConstraints constraints)
    {
        MeasureCount++;
        float scale = style.Size / 15.0f;
        float width = 0.0f;
        int lines = 1;
        for (int i = 0; i < text.Length; i++)
        {
            if (text[i] == '\n')
            {
                lines++;
            }
            else
            {
                width += 8.0f;
            }
        }

        return new UiTextMetrics(
            width * scale,
            lines * 16.0f * scale,
            16.0f * scale,
            12.8f * scale,
            lines,
            false);
    }
}

public sealed class UiAutoSizeServiceTests
{
    private const string Text = "01234567890123456789";

    private static UiTextStyle ShrinkStyle(float size = 15.0f, float min = 0.0f, float max = 0.0f) =>
        new(
            new UiFontFaceId(1),
            size,
            0.0f,
            0.0f,
            UiTextWrap.None,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            UiTextDirection.Ltr,
            0,
            UiTextAutoSize.ShrinkToFit,
            min,
            max);

    [Fact]
    public void NonShrinkStylesPassThroughWithoutCaching()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        UiTextStyle style = ShrinkStyle() with { AutoSize = UiTextAutoSize.None };

        UiAutoSizeResult result = service.Measure(measurer, Text, in style, UiMeasureConstraints.Unbounded);

        result.ResolvedSize.Should().Be(15.0f);
        service.Count.Should().Be(0);
        service.HitCount.Should().Be(0);
        measurer.MeasureCount.Should().Be(1);
    }

    [Fact]
    public void FullyUnboundedConstraintsNeverFitAndNeverCache()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();

        UiAutoSizeResult result = service.Measure(measurer, Text, ShrinkStyle(), UiMeasureConstraints.Unbounded);

        result.ResolvedSize.Should().Be(15.0f);
        service.Count.Should().Be(0);
        service.HitCount.Should().Be(0);
    }

    [Fact]
    public void ShrinkToFitFindsLargestFittingSizeWithBoundedMeasures()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 100.0f, float.PositiveInfinity);

        UiAutoSizeResult result = service.Measure(measurer, Text, ShrinkStyle(), in constraints);

        // Exact fit bound: width = 20*8*size/15 <= 100 → size <= 9.375.
        result.ResolvedSize.Should().BeLessThanOrEqualTo(9.375f + 0.001f);
        result.Metrics.Width.Should().BeLessThanOrEqualTo(100.0f + 0.001f);
        result.MarkedFixedSize.Should().BeFalse();
        measurer.MeasureCount.Should().BeLessThanOrEqualTo(4);
        service.Count.Should().Be(1);
    }

    [Fact]
    public void RepeatedMeasureUsesCacheHit()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 100.0f, float.PositiveInfinity);
        UiAutoSizeResult first = service.Measure(measurer, Text, ShrinkStyle(), in constraints);
        int measuresAfterFirst = measurer.MeasureCount;

        UiAutoSizeResult second = service.Measure(measurer, Text, ShrinkStyle(), in constraints);

        second.Should().Be(first);
        measurer.MeasureCount.Should().Be(measuresAfterFirst);
        service.HitCount.Should().Be(1);
        service.MissCount.Should().Be(1);
    }

    [Fact]
    public void ConstraintQuantizationStabilizesKeysAcrossSubPixelJitter()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        var tight = new UiMeasureConstraints(0.0f, 0.0f, 100.0f, float.PositiveInfinity);
        var jittered = new UiMeasureConstraints(0.0f, 0.0f, 100.1f, float.PositiveInfinity);

        UiAutoSizeResult first = service.Measure(measurer, Text, ShrinkStyle(), in tight);
        UiAutoSizeResult second = service.Measure(measurer, Text, ShrinkStyle(), in jittered);

        second.Should().Be(first, "widths within one 0.25px quantum share the key");
        service.Count.Should().Be(1);
        service.HitCount.Should().Be(1);
    }

    [Fact]
    public void TextAndStyleChangesInvalidateTheKey()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 100.0f, float.PositiveInfinity);

        _ = service.Measure(measurer, Text, ShrinkStyle(), in constraints);
        _ = service.Measure(measurer, "short", ShrinkStyle(), in constraints);
        _ = service.Measure(measurer, Text, ShrinkStyle(size: 20.0f), in constraints);
        _ = service.Measure(measurer, Text, ShrinkStyle(min: 8.0f), in constraints);
        _ = service.Measure(measurer, Text, ShrinkStyle(max: 12.0f), in constraints);
        _ = service.Measure(measurer, Text, ShrinkStyle(), new UiMeasureConstraints(0.0f, 0.0f, 80.0f, float.PositiveInfinity));

        service.Count.Should().Be(6, "text, size, min, max and constraint changes must not collide");
    }

    [Fact]
    public void UnreachableMinClampsToMinAndMarksFixedSize()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1.0f, 1.0f);

        UiAutoSizeResult result = service.Measure(measurer, Text, ShrinkStyle(), in constraints);

        result.ResolvedSize.Should().Be(UiAutoSizeService.DefaultMinFontSize);
        result.MarkedFixedSize.Should().BeTrue();
    }

    [Fact]
    public void MinNotBelowMaxShortCircuitsToMin()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 1000.0f, 1000.0f);
        UiTextStyle style = ShrinkStyle(size: 10.0f, min: 12.0f);

        UiAutoSizeResult result = service.Measure(measurer, Text, in style, in constraints);

        result.ResolvedSize.Should().Be(12.0f);
        result.MarkedFixedSize.Should().BeTrue();
        measurer.MeasureCount.Should().Be(1);
    }

    [Fact]
    public void LruEvictsLeastRecentlyUsedEntryDeterministically()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService(capacity: 2);
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 100.0f, float.PositiveInfinity);

        _ = service.Measure(measurer, "aaa", ShrinkStyle(), in constraints);
        _ = service.Measure(measurer, "bbb", ShrinkStyle(), in constraints);
        _ = service.Measure(measurer, "aaa", ShrinkStyle(), in constraints); // "aaa" becomes MRU
        _ = service.Measure(measurer, "ccc", ShrinkStyle(), in constraints); // evicts "bbb"

        service.Count.Should().Be(2);
        long missesBefore = service.MissCount;
        _ = service.Measure(measurer, "aaa", ShrinkStyle(), in constraints);
        service.MissCount.Should().Be(missesBefore);
        _ = service.Measure(measurer, "bbb", ShrinkStyle(), in constraints);
        service.MissCount.Should().Be(missesBefore + 1, "the evicted entry must recompute");
    }

    [Fact]
    public void InvalidateDropsAllEntries()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 100.0f, float.PositiveInfinity);
        _ = service.Measure(measurer, Text, ShrinkStyle(), in constraints);

        service.Invalidate();

        service.Count.Should().Be(0);
        _ = service.Measure(measurer, Text, ShrinkStyle(), in constraints);
        service.MissCount.Should().Be(2);
    }

    [Fact]
    public void ResolutionIsIdenticalAcrossInstances()
    {
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 120.0f, 9.0f);
        var first = new UiAutoSizeService();
        var second = new UiAutoSizeService();

        UiAutoSizeResult a = first.Measure(new LinearTextMeasurer(), Text, ShrinkStyle(), in constraints);
        UiAutoSizeResult b = second.Measure(new LinearTextMeasurer(), Text, ShrinkStyle(), in constraints);

        b.Should().Be(a);
    }

    [Fact]
    public void CacheHitsDoNotAllocateAfterWarmup()
    {
        var measurer = new LinearTextMeasurer();
        var service = new UiAutoSizeService();
        var constraints = new UiMeasureConstraints(0.0f, 0.0f, 100.0f, 12.0f);
        var style = ShrinkStyle();
        int opsPerWindow = 64;

        float lastWidth = 0.0f;
        var hitWindow = new Action(() =>
        {
            for (int round = 0; round < opsPerWindow; round++)
            {
                UiAutoSizeResult result = service.Measure(measurer, Text, in style, in constraints);
                lastWidth = result.Metrics.Width;
            }
        });
        Action noopWindow = () =>
        {
            for (int round = 0; round < opsPerWindow; round++)
            {
            }
        };
        Action measurePhase = () =>
        {
            for (int round = 0; round < opsPerWindow / 2; round++)
            {
                UiAutoSizeResult result = service.Measure(measurer, Text, in style, in constraints);
                lastWidth = result.Metrics.Width;
            }
        };

        UiAllocationHarness.Outcome outcome = UiAllocationHarness.AssertEveryWindowClean(
            hitWindow,
            betweenWindows: null,
            UiAllocationHarness.Windows,
            primePasses: 3,
            label: "auto-size cache hit",
            diagnostics:
            [
                new UiGatePhase("measure-loop", measurePhase),
                new UiGatePhase("noop-control", noopWindow),
            ]);

        outcome.MeasuredWindows.Should().Be(UiAllocationHarness.Windows);
        lastWidth.Should().BeGreaterThan(0.0f);
        service.MissCount.Should().Be(1);
        service.HitCount.Should().Be((long)outcome.TotalInvocations * opsPerWindow - 1);
    }
}

public sealed class UiTextContentMeasurerAutoSizeTests
{
    [Fact]
    public void ShrinkToFitNodeResolvesAndKeepsFixedMinAfterBottomOut()
    {
        var measurer = new LinearTextMeasurer();
        var content = new UiTextContentMeasurer(measurer);
        UiNodeId node = new(7);
        var style = new UiTextStyle(
            new UiFontFaceId(1),
            15.0f,
            0.0f,
            0.0f,
            UiTextWrap.None,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            UiTextDirection.Ltr,
            0,
            UiTextAutoSize.ShrinkToFit);
        content.SetText(node, "01234567890123456789", in style);

        _ = content.TryMeasureContent(node, new UiMeasureConstraints(0.0f, 0.0f, 1.0f, 1.0f), out _);

        content.AutoSizing.Count.Should().Be(1);
        content.TryGetResolvedStyle(node, out UiTextStyle resolved).Should().BeTrue();
        resolved.Size.Should().Be(UiAutoSizeService.DefaultMinFontSize);

        int measuresAfterBottomOut = measurer.MeasureCount;
        _ = content.TryMeasureContent(node, new UiMeasureConstraints(0.0f, 0.0f, 1.0f, 1.0f), out _);
        content.AutoSizing.HitCount.Should().Be(0, "the node keeps the clamped fixed style and bypasses the service");
        measurer.MeasureCount.Should().Be(measuresAfterBottomOut + 1);
    }

    [Fact]
    public void ReplacingTextInvalidatesTheResolvedSize()
    {
        var measurer = new LinearTextMeasurer();
        var content = new UiTextContentMeasurer(measurer);
        UiNodeId node = new(3);
        var style = new UiTextStyle(
            new UiFontFaceId(1),
            15.0f,
            0.0f,
            0.0f,
            UiTextWrap.None,
            UiTextOverflow.Clip,
            UiTextAlign.Start,
            UiTextDirection.Ltr,
            0,
            UiTextAutoSize.ShrinkToFit);
        content.SetText(node, "01234567890123456789", in style);
        _ = content.TryMeasureContent(node, new UiMeasureConstraints(0.0f, 0.0f, 100.0f, float.PositiveInfinity), out _);
        content.TryGetResolvedStyle(node, out _).Should().BeTrue();

        content.SetText(node, "tiny", in style);

        content.TryGetResolvedStyle(node, out _).Should().BeFalse("a fresh SetText starts unresolved");
    }
}
