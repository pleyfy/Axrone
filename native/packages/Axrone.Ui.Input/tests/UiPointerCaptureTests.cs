namespace Axrone.Ui.Input.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiPointerCaptureTests
{
    private static UiFocusManager CreateFocus(TestTree tree, UiNodeId node)
    {
        var focus = new UiFocusManager(tree);
        focus.TryFocus(node, UiFocusReason.Api).Should().BeTrue();
        return focus;
    }

    [Fact]
    public void CaptureTracksOwnerPerPointerIndependently()
    {
        var capture = new UiPointerCapture();
        var first = new UiNodeId(1);
        var second = new UiNodeId(2);

        capture.TryCapture(0, first).Should().BeTrue();
        capture.TryCapture(1, second).Should().BeTrue();

        capture.GetCaptured(0).Should().Be(first);
        capture.GetCaptured(1).Should().Be(second);
        capture.CapturedCount.Should().Be(2);
    }

    [Fact]
    public void RecapturingSameOwnerIsIdempotentAndSilent()
    {
        var sink = new RecordingCaptureSink();
        var capture = new UiPointerCapture(4, sink);
        var node = new UiNodeId(1);
        capture.TryCapture(0, node);

        capture.TryCapture(0, node).Should().BeTrue();

        sink.Events.Should().ContainSingle();
        capture.CapturedCount.Should().Be(1);
    }

    [Fact]
    public void RecapturingDifferentOwnerRaisesTransition()
    {
        var sink = new RecordingCaptureSink();
        var capture = new UiPointerCapture(4, sink);
        var first = new UiNodeId(1);
        var second = new UiNodeId(2);
        capture.TryCapture(0, first);

        capture.TryCapture(0, second).Should().BeTrue();

        capture.GetCaptured(0).Should().Be(second);
        capture.CapturedCount.Should().Be(1);
        sink.Events[^1].Should().Be(new UiPointerCaptureEvent(0, first, second, true));
    }

    [Fact]
    public void InvalidArgumentsAreRejected()
    {
        var capture = new UiPointerCapture(2);

        capture.TryCapture(-1, new UiNodeId(1)).Should().BeFalse();
        capture.TryCapture(2, new UiNodeId(1)).Should().BeFalse();
        capture.TryCapture(0, UiNodeId.Invalid).Should().BeFalse();
        capture.GetCaptured(5).Should().Be(UiNodeId.Invalid);
        capture.GetCaptured(-1).Should().Be(UiNodeId.Invalid);
        capture.CapturedCount.Should().Be(0);
    }

    [Fact]
    public void ReleaseEmitsLossEventAndFreesSlot()
    {
        var sink = new RecordingCaptureSink();
        var capture = new UiPointerCapture(4, sink);
        var node = new UiNodeId(1);
        capture.TryCapture(3, node);
        sink.Events.Clear();

        capture.Release(3).Should().BeTrue();

        capture.GetCaptured(3).Should().Be(UiNodeId.Invalid);
        capture.CapturedCount.Should().Be(0);
        sink.Events.Should().ContainSingle();
        sink.Events[0].Should().Be(new UiPointerCaptureEvent(3, node, UiNodeId.Invalid, false));
    }

    [Fact]
    public void ReleaseOfUncapturedPointerReturnsFalse()
    {
        var capture = new UiPointerCapture(4);

        capture.Release(0).Should().BeFalse();
        capture.Release(9).Should().BeFalse();
    }

    [Fact]
    public void ReleaseAllSweepsInAscendingPointerOrder()
    {
        var sink = new RecordingCaptureSink();
        var capture = new UiPointerCapture(4, sink);
        capture.TryCapture(2, new UiNodeId(1));
        capture.TryCapture(0, new UiNodeId(2));
        sink.Events.Clear();

        capture.ReleaseAll();

        capture.CapturedCount.Should().Be(0);
        sink.Events.Should().HaveCount(2);
        sink.Events[0].PointerId.Should().Be(0);
        sink.Events[1].PointerId.Should().Be(2);
    }

    [Fact]
    public void ReleaseNodeOnlyReleasesPointersHeldByThatNode()
    {
        var capture = new UiPointerCapture(4);
        var node = new UiNodeId(1);
        var other = new UiNodeId(2);
        capture.TryCapture(0, node);
        capture.TryCapture(1, node);
        capture.TryCapture(2, other);

        capture.ReleaseNode(node).Should().Be(2);

        capture.GetCaptured(0).Should().Be(UiNodeId.Invalid);
        capture.GetCaptured(1).Should().Be(UiNodeId.Invalid);
        capture.GetCaptured(2).Should().Be(other);
    }

    [Fact]
    public void ReleaseNodeClearsFocusWhenTheOwnerWasFocused()
    {
        var tree = new TestTree();
        UiNodeId node = tree.Add(tree.Root, UiNodeKind.Button, UiNodeFlags.Visible | UiNodeFlags.Focusable | UiNodeFlags.Enabled);
        UiFocusManager focus = CreateFocus(tree, node);
        var capture = new UiPointerCapture(4, focus: focus);
        capture.TryCapture(0, node);

        capture.ReleaseNode(node).Should().Be(1);

        focus.Focused.Should().Be(UiNodeId.Invalid);
    }

    [Fact]
    public void ReleaseNodeKeepsFocusWhenAnotherNodeWasFocused()
    {
        var tree = new TestTree();
        UiNodeId captured = tree.Add(tree.Root, UiNodeKind.Button, UiNodeFlags.Visible | UiNodeFlags.Focusable | UiNodeFlags.Enabled);
        UiNodeId focused = tree.Add(tree.Root, UiNodeKind.Button, UiNodeFlags.Visible | UiNodeFlags.Focusable | UiNodeFlags.Enabled);
        UiFocusManager focus = CreateFocus(tree, focused);
        var capture = new UiPointerCapture(4, focus: focus);
        capture.TryCapture(0, captured);

        capture.ReleaseNode(captured).Should().Be(1);

        focus.Focused.Should().Be(focused);
    }

    [Fact]
    public void ReleaseNodeWithoutCaptureKeepsFocus()
    {
        var tree = new TestTree();
        UiNodeId focused = tree.Add(tree.Root, UiNodeKind.Button, UiNodeFlags.Visible | UiNodeFlags.Focusable | UiNodeFlags.Enabled);
        UiFocusManager focus = CreateFocus(tree, focused);
        var capture = new UiPointerCapture(4, focus: focus);

        capture.ReleaseNode(focused).Should().Be(0);

        focus.Focused.Should().Be(focused);
    }

    [Fact]
    public void CaptureSlotBoundsAreValidated()
    {
        FluentActions.Invoking(static () => _ = new UiPointerCapture(0)).Should().Throw<ArgumentOutOfRangeException>();
        FluentActions.Invoking(static () => _ = new UiPointerCapture(65)).Should().Throw<ArgumentOutOfRangeException>();
    }
}

internal sealed class RecordingCaptureSink : IUiPointerCaptureSink
{
    public List<UiPointerCaptureEvent> Events { get; } = [];

    public void OnCaptureChanged(in UiPointerCaptureEvent args) => Events.Add(args);
}
