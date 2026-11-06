namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class ControlTextAutoSizeTests
{
    /// <summary>Reports true overflow (unlike TestTextMeasurer, it never clamps to the constraints).</summary>
    private sealed class StrictTextMeasurer : IUiTextMeasurer
    {
        public UiTextMetrics Measure(ReadOnlySpan<char> text, in UiTextStyle style, in UiMeasureConstraints constraints)
        {
            float scale = style.Size / 15.0f;
            return new UiTextMetrics(text.Length * 8.0f * scale, 16.0f * scale, 16.0f * scale, 12.8f * scale, 1, false);
        }
    }

    private static UiTextStyle ShrinkStyle() =>
        new(
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

    [Fact]
    public void LabelShrinksTextToViewportWidthAndResolvesOncePerContent()
    {
        var service = new UiAutoSizeService();
        var runtime = new UiControlRuntime(new UiControlRuntimeOptions(
            TextMeasurer: new StrictTextMeasurer(),
            Theme: UiControlTheme.CreateDefaultTheme(),
            ThemeTokens: UiControlTheme.Default,
            DefaultTextStyle: ShrinkStyle(),
            Viewport: ControlHost.DefaultViewport,
            AutoSizing: service));

        UiControl label = runtime.CreateControl(ControlKind.Label, new UiControlDefinition(Text: new string('x', 80)));
        _ = runtime.Mount(label);
        _ = runtime.UpdateLayout(ControlHost.DefaultViewport);

        // The label stretches to the viewport but its text shrink-fits: height follows the resolved size.
        runtime.TryGetBounds(label.Node, out Rect box).Should().BeTrue();
        box.Width.Should().Be(400.0f);
        box.Height.Should().BeLessThan(16.0f);
        runtime.TextContentMeasurer!.TryGetResolvedStyle(label.Node, out UiTextStyle resolved).Should().BeTrue();
        resolved.Size.Should().BeLessThan(15.0f);
        service.Count.Should().Be(1);
        service.MissCount.Should().Be(1);

        // Repeated layout passes must not re-run the shrink search (dirty-flag
        // consumption): the first pass may settle a second constraint variant,
        // after that every measure must be a cache hit.
        long settledMisses = service.MissCount;
        settledMisses.Should().BeLessThanOrEqualTo(2);
        for (int pass = 0; pass < 5; pass++)
        {
            _ = runtime.UpdateLayout(ControlHost.DefaultViewport);
        }

        service.MissCount.Should().Be(settledMisses, "layout must reuse the resolved measurements");

        // Editing the text re-keys the measurement; misses grow but stay bounded.
        _ = runtime.SetText(label, new string('y', 10));
        for (int pass = 0; pass < 3; pass++)
        {
            _ = runtime.UpdateLayout(ControlHost.DefaultViewport);
        }

        service.MissCount.Should().BeGreaterThan(settledMisses);
        service.MissCount.Should().BeLessThanOrEqualTo(settledMisses + 2, "one edit must not cost more than the constraint variants it spans");
    }
}
