namespace Axrone.Ui.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiTextContentTests
{
    [Fact]
    public void TextNodeMeasuresThroughTextMeasurer()
    {
        FixedTextMeasurer measurer = new();
        UiTextContentMeasurer content = new(measurer);
        UiNodeId node = new(1);
        content.SetText(node, "abc", Style(size: 10.0f, lineHeight: 12.0f));

        content.TryMeasureContent(node, UiMeasureConstraints.Unbounded, out UiSize size).Should().BeTrue();

        size.Width.Should().BeApproximately(30.0f, 0.0001f);
        size.Height.Should().BeApproximately(12.0f, 0.0001f);
        measurer.CallCount.Should().Be(1);
    }

    [Fact]
    public void ChangingTextChangesMeasuredSize()
    {
        UiTextContentMeasurer content = new(new FixedTextMeasurer());
        UiNodeId node = new(1);
        content.SetText(node, "abc", Style(size: 10.0f, lineHeight: 12.0f));
        content.TryMeasureContent(node, UiMeasureConstraints.Unbounded, out UiSize before);

        content.SetText(node, "abcde", Style(size: 10.0f, lineHeight: 12.0f));
        content.TryMeasureContent(node, UiMeasureConstraints.Unbounded, out UiSize after);

        before.Width.Should().BeApproximately(30.0f, 0.0001f);
        after.Width.Should().BeApproximately(50.0f, 0.0001f);
    }

    [Fact]
    public void UnregisteredNodeIsNotMeasured()
    {
        FixedTextMeasurer measurer = new();
        UiTextContentMeasurer content = new(measurer);

        content.TryMeasureContent(new UiNodeId(1), UiMeasureConstraints.Unbounded, out UiSize size).Should().BeFalse();
        size.Width.Should().Be(0.0f);
        measurer.CallCount.Should().Be(0);
        content.Count.Should().Be(0);
    }

    [Fact]
    public void RemovedTextStopsMeasuring()
    {
        UiTextContentMeasurer content = new(new FixedTextMeasurer());
        UiNodeId node = new(1);
        content.SetText(node, "abc", Style(size: 10.0f, lineHeight: 12.0f));
        content.Count.Should().Be(1);

        content.Remove(node).Should().BeTrue();
        content.TryMeasureContent(node, UiMeasureConstraints.Unbounded, out _).Should().BeFalse();
        content.Remove(node).Should().BeFalse();
    }

    [Fact]
    public void TextLeafParticipatesInParentLayout()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Column,
            AlignItems = UiAlign.Start,
        });
        UiNodeId text = harness.AddContainer(root, UiLayoutStyle.Default);
        harness.TextContent.SetText(text, "hello", Style(size: 8.0f, lineHeight: 10.0f));
        harness.Freeze();

        UiMeasureResult measured = harness.Measure(root);

        measured.Size.Width.Should().BeApproximately(40.0f, 0.0001f);
        measured.Size.Height.Should().BeApproximately(10.0f, 0.0001f);

        harness.Arrange(root, new Rect(0.0f, 0.0f, 40.0f, 10.0f));
        Rect textBounds = harness.Sink.Boxes[text].Bounds;
        textBounds.Width.Should().BeApproximately(40.0f, 0.0001f);
        textBounds.Height.Should().BeApproximately(10.0f, 0.0001f);
    }

    [Fact]
    public void TextAndBoxLeavesCoexistInFlow()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Column,
            AlignItems = UiAlign.Start,
            Gap = 2.0f,
        });
        UiNodeId text = harness.AddContainer(root, UiLayoutStyle.Default);
        harness.TextContent.SetText(text, "ab", Style(size: 10.0f, lineHeight: 12.0f));
        harness.AddLeaf(root, UiLayoutStyle.Default, new UiSize(5.0f, 6.0f));
        harness.Freeze();

        UiMeasureResult measured = harness.Measure(root);

        measured.Size.Width.Should().BeApproximately(20.0f, 0.0001f);
        measured.Size.Height.Should().BeApproximately(20.0f, 0.0001f);
    }

    [Fact]
    public void SteadyStateTextLayoutAllocatesNothing()
    {
        LayoutHarness harness = new();
        UiNodeId root = harness.AddRoot(new UiLayoutStyle
        {
            Direction = UiAxis.Column,
            AlignItems = UiAlign.Start,
        });
        UiNodeId text = harness.AddContainer(root, UiLayoutStyle.Default);
        harness.TextContent.SetText(text, "stable text", Style(size: 9.0f, lineHeight: 11.0f));
        harness.Freeze();

        for (int i = 0; i < 4; i++)
        {
            harness.Measure(root);
            harness.Arrange(root, new Rect(0.0f, 0.0f, 100.0f, 50.0f));
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            harness.Measure(root);
            harness.Arrange(root, new Rect(0.0f, 0.0f, 100.0f, 50.0f));
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    private static UiTextStyle Style(float size, float lineHeight) => new(
        new UiFontFaceId(1),
        size,
        lineHeight,
        0.0f,
        UiTextWrap.None,
        UiTextOverflow.Clip,
        UiTextAlign.Start,
        UiTextDirection.Ltr,
        1);
}

internal sealed class FixedTextMeasurer : IUiTextMeasurer
{
    public int CallCount { get; private set; }

    public UiTextMetrics Measure(ReadOnlySpan<char> text, in UiTextStyle style, in UiMeasureConstraints constraints)
    {
        _ = constraints;
        CallCount++;
        float width = text.Length * style.Size;
        float height = style.LineHeight > 0.0f ? style.LineHeight : style.Size;
        return new UiTextMetrics(width, height, height, style.Size, 1, false);
    }
}
