namespace Axrone.Ui.Input.Tests;

using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiFocusManagerTests
{
    private const UiNodeFlags FocusableFlags = UiNodeFlags.Visible | UiNodeFlags.Focusable | UiNodeFlags.Enabled;

    private static UiFocusManager CreateManager(
        TestTree tree,
        TestBounds? bounds = null,
        RecordingFocusSink? events = null,
        RecordingInvalidationSink? invalidations = null) =>
        new(tree, bounds, events, invalidations);

    [Fact]
    public void TryFocusSetsFocusedNodeAndRaisesFocusEvent()
    {
        var tree = new TestTree();
        UiNodeId button = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        var events = new RecordingFocusSink();
        UiFocusManager manager = CreateManager(tree, events: events);

        manager.TryFocus(button, UiFocusReason.Api).Should().BeTrue();

        manager.Focused.Should().Be(button);
        events.Events.Should().ContainSingle();
        events.Events[0].Should().Be(new UiFocusChangeEvent(button, true, UiFocusReason.Api));
    }

    [Fact]
    public void TryFocusRejectsNonFocusableNodeAndKeepsPreviousFocus()
    {
        var tree = new TestTree();
        UiNodeId focusable = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId plain = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(focusable, UiFocusReason.Api).Should().BeTrue();

        manager.TryFocus(plain, UiFocusReason.Api).Should().BeFalse();

        manager.Focused.Should().Be(focusable);
    }

    [Fact]
    public void TryFocusSameNodeDoesNotRaiseAnotherEvent()
    {
        var tree = new TestTree();
        UiNodeId node = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        var events = new RecordingFocusSink();
        UiFocusManager manager = CreateManager(tree, events: events);
        manager.TryFocus(node, UiFocusReason.Api);

        manager.TryFocus(node, UiFocusReason.PointerInput).Should().BeTrue();

        events.Events.Should().ContainSingle();
    }

    [Fact]
    public void FocusTransitionRaisesBlurBeforeFocus()
    {
        var tree = new TestTree();
        UiNodeId first = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId second = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        var events = new RecordingFocusSink();
        UiFocusManager manager = CreateManager(tree, events: events);
        manager.TryFocus(first, UiFocusReason.Api);
        events.Events.Clear();

        manager.TryFocus(second, UiFocusReason.Navigation).Should().BeTrue();

        events.Events.Should().HaveCount(2);
        events.Events[0].Should().Be(new UiFocusChangeEvent(first, false, UiFocusReason.Navigation));
        events.Events[1].Should().Be(new UiFocusChangeEvent(second, true, UiFocusReason.Navigation));
    }

    [Fact]
    public void TabForwardFollowsDocumentOrder()
    {
        var tree = new TestTree();
        UiNodeId first = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId second = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(first, UiFocusReason.Api);

        manager.TryMoveFocus(UiFocusMoveDirection.Forward).Should().BeTrue();

        manager.Focused.Should().Be(second);
    }

    [Fact]
    public void TabBackwardReturnsToPreviousNode()
    {
        var tree = new TestTree();
        UiNodeId first = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId second = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(second, UiFocusReason.Api);

        manager.TryMoveFocus(UiFocusMoveDirection.Backward).Should().BeTrue();

        manager.Focused.Should().Be(first);
    }

    [Fact]
    public void TabForwardAtEndWithoutScopeDoesNotWrap()
    {
        var tree = new TestTree();
        UiNodeId first = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId last = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(last, UiFocusReason.Api);

        manager.TryMoveFocus(UiFocusMoveDirection.Forward).Should().BeFalse();

        manager.Focused.Should().Be(last);
        first.Should().NotBe(last);
    }

    [Fact]
    public void FocusScopeConfinesTabOrderAndWraps()
    {
        var tree = new TestTree();
        UiNodeId panel = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.FocusScope);
        UiNodeId insideFirst = tree.Add(panel, UiNodeKind.Button, FocusableFlags);
        UiNodeId insideSecond = tree.Add(panel, UiNodeKind.Button, FocusableFlags);
        UiNodeId outside = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(insideSecond, UiFocusReason.Api);

        manager.TryMoveFocus(UiFocusMoveDirection.Forward).Should().BeTrue();

        manager.Focused.Should().Be(insideFirst);
        manager.Focused.Should().NotBe(outside);
    }

    [Fact]
    public void HiddenNodesAreExcludedFromTabOrder()
    {
        var tree = new TestTree();
        UiNodeId visible = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        tree.Add(tree.Root, UiNodeKind.Button, UiNodeFlags.Focusable | UiNodeFlags.Enabled);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(visible, UiFocusReason.Api);

        manager.TryMoveFocus(UiFocusMoveDirection.Forward).Should().BeFalse();
    }

    [Fact]
    public void DirectionalMovePicksNearestNodeInHalfPlane()
    {
        var tree = new TestTree();
        UiNodeId origin = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId right = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId farRight = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        var bounds = new TestBounds();
        bounds.Set(origin, 0f, 0f, 10f, 10f);
        bounds.Set(right, 40f, 0f, 50f, 10f);
        bounds.Set(farRight, 200f, 0f, 210f, 10f);
        UiFocusManager manager = CreateManager(tree, bounds);
        manager.TryFocus(origin, UiFocusReason.Api);

        manager.TryMoveFocus(UiFocusMoveDirection.Right).Should().BeTrue();

        manager.Focused.Should().Be(right);
    }

    [Fact]
    public void DirectionalMoveIgnoresNodesBehindTheDirection()
    {
        var tree = new TestTree();
        UiNodeId origin = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId right = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId left = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        var bounds = new TestBounds();
        bounds.Set(origin, 0f, 0f, 10f, 10f);
        bounds.Set(right, 40f, 0f, 50f, 10f);
        bounds.Set(left, -50f, 0f, -40f, 10f);
        UiFocusManager manager = CreateManager(tree, bounds);
        manager.TryFocus(origin, UiFocusReason.Api);

        manager.TryMoveFocus(UiFocusMoveDirection.Left).Should().BeTrue();

        manager.Focused.Should().Be(left);
    }

    [Fact]
    public void DirectionalMoveWithoutBoundsFails()
    {
        var tree = new TestTree();
        UiNodeId origin = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(origin, UiFocusReason.Api);

        manager.TryMoveFocus(UiFocusMoveDirection.Right).Should().BeFalse();
    }

    [Fact]
    public void ClearFocusRaisesBlurWithReason()
    {
        var tree = new TestTree();
        UiNodeId node = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        var events = new RecordingFocusSink();
        UiFocusManager manager = CreateManager(tree, events: events);
        manager.TryFocus(node, UiFocusReason.Api);
        events.Events.Clear();

        manager.ClearFocus(UiFocusReason.Window);

        manager.Focused.Should().Be(UiNodeId.Invalid);
        events.Events.Should().ContainSingle();
        events.Events[0].Should().Be(new UiFocusChangeEvent(node, false, UiFocusReason.Window));
    }

    [Fact]
    public void ValidateFocusClearsFocusWhenNodeIsNoLongerFocusable()
    {
        var tree = new TestTree();
        UiNodeId node = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        var events = new RecordingFocusSink();
        UiFocusManager manager = CreateManager(tree, events: events);
        manager.TryFocus(node, UiFocusReason.PointerInput);
        tree.SetFlags(node, UiNodeFlags.Visible);
        events.Events.Clear();

        manager.ValidateFocus();

        manager.Focused.Should().Be(UiNodeId.Invalid);
        events.Events.Should().ContainSingle();
        events.Events[0].Should().Be(new UiFocusChangeEvent(node, false, UiFocusReason.Window));
    }

    [Fact]
    public void ValidateFocusKeepsFocusWhenNodeIsStillFocusable()
    {
        var tree = new TestTree();
        UiNodeId node = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(node, UiFocusReason.Api);

        manager.ValidateFocus();

        manager.Focused.Should().Be(node);
    }

    [Fact]
    public void FocusChangesInvalidateBothNodes()
    {
        var tree = new TestTree();
        UiNodeId first = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiNodeId second = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        var invalidations = new RecordingInvalidationSink();
        UiFocusManager manager = CreateManager(tree, invalidations: invalidations);
        manager.TryFocus(first, UiFocusReason.Api);
        invalidations.Values.Clear();

        manager.TryFocus(second, UiFocusReason.Api);

        invalidations.Values.Should().HaveCount(2);
        invalidations.Values[0].Should().Be(new UiInvalidation(first, UiInvalidationFlags.Focus));
        invalidations.Values[1].Should().Be(new UiInvalidation(second, UiInvalidationFlags.Focus));
    }

    [Fact]
    public void NavigationDoesNotAllocateAfterWarmup()
    {
        var tree = new TestTree();
        UiNodeId first = tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags);
        UiFocusManager manager = CreateManager(tree);
        manager.TryFocus(first, UiFocusReason.Api);
        for (int warmup = 0; warmup < 128; warmup++)
        {
            manager.TryMoveFocus(UiFocusMoveDirection.Forward);
            manager.TryMoveFocus(UiFocusMoveDirection.Backward);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int move = 0; move < 500; move++)
        {
            manager.TryMoveFocus(UiFocusMoveDirection.Forward);
            manager.TryMoveFocus(UiFocusMoveDirection.Backward);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    [Fact]
    public void NavigationIsDeterministicAcrossManagers()
    {
        static TestTree BuildTree(out UiNodeId[] nodes)
        {
            var tree = new TestTree();
            nodes =
            [
                tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags),
                tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags),
                tree.Add(tree.Root, UiNodeKind.Button, FocusableFlags),
            ];
            return tree;
        }

        TestTree firstTree = BuildTree(out UiNodeId[] firstNodes);
        TestTree secondTree = BuildTree(out UiNodeId[] secondNodes);
        UiFocusManager first = CreateManager(firstTree);
        UiFocusManager second = CreateManager(secondTree);
        first.TryFocus(firstNodes[0], UiFocusReason.Api);
        second.TryFocus(secondNodes[0], UiFocusReason.Api);

        for (int step = 0; step < 5; step++)
        {
            first.TryMoveFocus(UiFocusMoveDirection.Forward);
            second.TryMoveFocus(UiFocusMoveDirection.Forward);
            first.Focused.Value.Should().Be(second.Focused.Value);
        }
    }
}

internal sealed class RecordingFocusSink : IUiFocusEventSink
{
    public List<UiFocusChangeEvent> Events { get; } = [];

    public void OnFocusChanged(in UiFocusChangeEvent args) => Events.Add(args);
}

internal sealed class RecordingInvalidationSink : IUiInvalidationSink
{
    public List<UiInvalidation> Values { get; } = [];

    public void Invalidate(in UiInvalidation invalidation) => Values.Add(invalidation);
}
