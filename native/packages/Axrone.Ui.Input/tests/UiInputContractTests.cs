namespace Axrone.Ui.Input.Tests;

using System.Runtime.CompilerServices;
using Axrone.Numeric;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiInputContractTests
{
    [Fact]
    public void PointerEventCarriesPositionAndButtons()
    {
        UiPointerEvent evt = new(
            new UiNodeId(4),
            UiPointerPhase.Down,
            new Vec2(12.0f, 8.0f),
            new Vec2(1.0f, -1.0f),
            PointerId: 0,
            Button: 0,
            UiPointerButtons.Left,
            UiKeyModifiers.Shift,
            Timestamp: 42);

        evt.Phase.Should().Be(UiPointerPhase.Down);
        evt.Target.Should().Be(new UiNodeId(4));
        evt.Position.Should().Be(new Vec2(12.0f, 8.0f));
        evt.Buttons.Should().Be(UiPointerButtons.Left);
        evt.Modifiers.Should().Be(UiKeyModifiers.Shift);
        evt.Timestamp.Should().Be(42);
    }

    [Fact]
    public void PointerAndModifierMasksAreIndependentBits()
    {
        UiPointerButtons buttons = UiPointerButtons.Left | UiPointerButtons.Middle;
        (buttons & UiPointerButtons.Right).Should().Be(UiPointerButtons.None);
        (buttons & UiPointerButtons.Middle).Should().Be(UiPointerButtons.Middle);

        UiKeyModifiers modifiers = UiKeyModifiers.Control | UiKeyModifiers.Alt;
        (modifiers & UiKeyModifiers.Shift).Should().Be(UiKeyModifiers.None);
    }

    [Fact]
    public void HitResultCarriesClipAndLocalPoint()
    {
        UiHitResult hit = new(
            new UiNodeId(9),
            new Vec2(3.0f, 4.0f),
            ZIndex: 2,
            HasClip: true,
            new Rect(0.0f, 0.0f, 100.0f, 50.0f));

        hit.Node.Should().Be(new UiNodeId(9));
        hit.LocalPoint.Should().Be(new Vec2(3.0f, 4.0f));
        hit.ZIndex.Should().Be(2);
        hit.HasClip.Should().BeTrue();
        hit.ClipBounds.Width.Should().Be(100.0f);
    }

    [Fact]
    public void RouterContractDispatchesTypedEvents()
    {
        RecordingRouter router = new();

        UiInputDispatchResult pointer = router.Route(new UiPointerEvent(
            new UiNodeId(1),
            UiPointerPhase.Move,
            Vec2.Zero,
            Vec2.Zero,
            0,
            -1,
            UiPointerButtons.None,
            UiKeyModifiers.None,
            0));

        pointer.Handled.Should().BeTrue();
        pointer.Target.Should().Be(new UiNodeId(1));
        pointer.Phase.Should().Be(UiRoutingPhase.Target);

        UiInputDispatchResult key = router.Route(new UiKeyEvent(
            new UiNodeId(2),
            UiKeyPhase.Down,
            65,
            false,
            UiKeyModifiers.None,
            0));

        key.Handled.Should().BeFalse();
        key.Canceled.Should().BeFalse();
    }

    [Fact]
    public void RouteGraphExposesParentChain()
    {
        FixedRouteGraph graph = new(new UiNodeId(2), new UiNodeId(1));

        graph.TryGetParent(new UiNodeId(2), out UiNodeId parent).Should().BeTrue();
        parent.Should().Be(new UiNodeId(1));
        graph.TryGetParent(new UiNodeId(1), out _).Should().BeFalse();
    }

    [Fact]
    public void WindowFocusEventIsSingleByte()
    {
        UiWindowFocusEvent evt = new(true);
        evt.Focused.Should().BeTrue();
        Unsafe.SizeOf<UiWindowFocusEvent>().Should().Be(1);
    }
}

internal sealed class RecordingRouter : IUiInputRouter
{
    public UiInputDispatchResult Route(in UiPointerEvent args) =>
        new(true, args.Target, UiRoutingPhase.Target, false);

    public UiInputDispatchResult Route(in UiKeyEvent args) =>
        new(false, args.Target, UiRoutingPhase.Bubble, false);

    public UiInputDispatchResult Route(in UiTextInputEvent args) =>
        new(false, args.Target, UiRoutingPhase.Target, false);

    public UiInputDispatchResult Route(in UiFocusChangeEvent args) =>
        new(false, args.Target, UiRoutingPhase.Target, false);
}

internal sealed class FixedRouteGraph : IUiRouteGraph
{
    private readonly UiNodeId _child;
    private readonly UiNodeId _parent;

    public FixedRouteGraph(UiNodeId child, UiNodeId parent)
    {
        _child = child;
        _parent = parent;
    }

    public bool TryGetParent(UiNodeId node, out UiNodeId parent)
    {
        if (node == _child)
        {
            parent = _parent;
            return true;
        }

        parent = UiNodeId.Invalid;
        return false;
    }
}
