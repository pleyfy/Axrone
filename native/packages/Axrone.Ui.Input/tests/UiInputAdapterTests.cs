namespace Axrone.Ui.Input.Tests;

using Axrone.Input;
using Axrone.Numeric;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiInputAdapterTests
{
    private static InputTimestamp Ts(uint milliseconds) => new(milliseconds);

    private static RawInputEvent MouseMove(float x, float y) =>
        RawInputEvent.CreateMouseMove(DeviceIndex.Primary, x, y, Ts(1));

    private static RawInputEvent KeyDown(Key key) =>
        RawInputEvent.CreateKeyDown(DeviceIndex.Primary, key, 0, Ts(2));

    private static RawInputEvent KeyUp(Key key) =>
        RawInputEvent.CreateKeyUp(DeviceIndex.Primary, key, 0, Ts(3));

    [Fact]
    public void MouseMoveMapsPositionAndDelta()
    {
        var adapter = new UiInputAdapter();

        adapter.TryMapPointer(MouseMove(10f, 5f), out UiPointerEvent first).Should().BeTrue();
        adapter.TryMapPointer(MouseMove(12f, 9f), out UiPointerEvent second).Should().BeTrue();

        first.Phase.Should().Be(UiPointerPhase.Move);
        first.PointerId.Should().Be(UiInputAdapter.MousePointerId);
        first.Position.Should().Be(new Vec2(10f, 5f));
        first.Delta.Should().Be(new Vec2(10f, 5f));
        second.Delta.Should().Be(new Vec2(2f, 4f));
        adapter.Position.Should().Be(new Vec2(12f, 9f));
    }

    [Fact]
    public void MouseButtonDownAndUpTrackTheHeldMask()
    {
        var adapter = new UiInputAdapter();

        adapter.TryMapPointer(RawInputEvent.CreateMouseDown(DeviceIndex.Primary, MouseButton.Left, Ts(1)), out UiPointerEvent leftDown);
        adapter.TryMapPointer(RawInputEvent.CreateMouseDown(DeviceIndex.Primary, MouseButton.Right, Ts(1)), out UiPointerEvent rightDown);
        adapter.TryMapPointer(RawInputEvent.CreateMouseUp(DeviceIndex.Primary, MouseButton.Left, Ts(1)), out UiPointerEvent leftUp);
        adapter.TryMapPointer(RawInputEvent.CreateMouseUp(DeviceIndex.Primary, MouseButton.Right, Ts(1)), out UiPointerEvent rightUp);

        leftDown.Phase.Should().Be(UiPointerPhase.Down);
        leftDown.Button.Should().Be(0);
        leftDown.Buttons.Should().Be(UiPointerButtons.Left);
        rightDown.Buttons.Should().Be(UiPointerButtons.Left | UiPointerButtons.Right);
        leftUp.Phase.Should().Be(UiPointerPhase.Up);
        leftUp.Buttons.Should().Be(UiPointerButtons.Right);
        rightUp.Buttons.Should().Be(UiPointerButtons.None);
        adapter.Buttons.Should().Be(UiPointerButtons.None);
    }

    [Fact]
    public void MouseScrollMapsDeltaAndKeepsPosition()
    {
        var adapter = new UiInputAdapter();
        adapter.TryMapPointer(MouseMove(10f, 10f), out _);

        adapter.TryMapPointer(RawInputEvent.CreateMouseScroll(DeviceIndex.Primary, 0f, -1f, Ts(4)), out UiPointerEvent wheel);

        wheel.Phase.Should().Be(UiPointerPhase.Wheel);
        wheel.Position.Should().Be(new Vec2(10f, 10f));
        wheel.Delta.Should().Be(new Vec2(0f, -1f));
    }

    [Fact]
    public void TouchContactsMapToDistinctPointerIds()
    {
        var adapter = new UiInputAdapter();
        adapter.TryMapPointer(RawInputEvent.CreateTouch(0, TouchPhase.Start, 0f, 0f, Ts(1)), out UiPointerEvent startA);
        adapter.TryMapPointer(RawInputEvent.CreateTouch(0, TouchPhase.Move, 5f, 0f, Ts(2)), out UiPointerEvent moveA);
        adapter.TryMapPointer(RawInputEvent.CreateTouch(1, TouchPhase.Start, 50f, 50f, Ts(3)), out UiPointerEvent startB);
        adapter.TryMapPointer(RawInputEvent.CreateTouch(0, TouchPhase.End, 5f, 0f, Ts(4)), out UiPointerEvent endA);
        adapter.TryMapPointer(RawInputEvent.CreateTouch(1, TouchPhase.End, 50f, 50f, Ts(5)), out UiPointerEvent endB);

        startA.Phase.Should().Be(UiPointerPhase.Down);
        startA.PointerId.Should().Be(1);
        moveA.Phase.Should().Be(UiPointerPhase.Move);
        moveA.Delta.Should().Be(new Vec2(5f, 0f));
        startB.PointerId.Should().Be(2);
        endA.Phase.Should().Be(UiPointerPhase.Up);
        endA.Buttons.Should().Be(UiPointerButtons.Left);
        endB.Buttons.Should().Be(UiPointerButtons.None);
    }

    [Fact]
    public void KeyDownTracksModifiersAndRepeat()
    {
        var adapter = new UiInputAdapter();

        adapter.TryMapKey(KeyDown(Key.ShiftLeft), out UiKeyEvent first).Should().BeTrue();
        adapter.TryMapKey(KeyDown(Key.ShiftLeft), out UiKeyEvent repeated).Should().BeTrue();
        adapter.TryMapKey(KeyUp(Key.ShiftLeft), out UiKeyEvent released).Should().BeTrue();
        adapter.TryMapKey(KeyDown(Key.A), out UiKeyEvent plain).Should().BeTrue();

        first.Modifiers.Should().Be(UiKeyModifiers.Shift);
        first.Repeat.Should().BeFalse();
        repeated.Repeat.Should().BeTrue();
        released.Phase.Should().Be(UiKeyPhase.Up);
        released.Modifiers.Should().Be(UiKeyModifiers.Shift);
        plain.Modifiers.Should().Be(UiKeyModifiers.None);
        adapter.Modifiers.Should().Be(UiKeyModifiers.None);
    }

    [Fact]
    public void KeyCharMapsToReusedSingleCharacterString()
    {
        var adapter = new UiInputAdapter();

        adapter.TryMapText(RawInputEvent.CreateKeyChar(DeviceIndex.Primary, 'a', Ts(1)), out UiTextInputEvent first).Should().BeTrue();
        adapter.TryMapText(RawInputEvent.CreateKeyChar(DeviceIndex.Primary, 'a', Ts(2)), out UiTextInputEvent second).Should().BeTrue();
        adapter.TryMapText(RawInputEvent.CreateKeyChar(DeviceIndex.Primary, 'ç', Ts(3)), out UiTextInputEvent nonAscii).Should().BeTrue();

        first.Text.Should().Be("a");
        first.Composing.Should().BeFalse();
        first.Locale.Should().BeNull();
        ReferenceEquals(first.Text, second.Text).Should().BeTrue();
        nonAscii.Text.Should().Be("ç");
    }

    [Fact]
    public void UnmappedRawTypesAreRejected()
    {
        var adapter = new UiInputAdapter();

        adapter.TryMapPointer(RawInputEvent.CreateGamepadAxis(DeviceIndex.Primary, 0, 1f, Ts(1)), out UiPointerEvent pointer).Should().BeFalse();
        adapter.TryMapKey(RawInputEvent.CreateGamepadButtonDown(DeviceIndex.Primary, ButtonName.A, 0, Ts(1)), out UiKeyEvent key).Should().BeFalse();
        adapter.TryMapText(MouseMove(1f, 1f), out UiTextInputEvent text).Should().BeFalse();

        pointer.Target.Should().Be(UiNodeId.Invalid);
        key.Target.Should().Be(UiNodeId.Invalid);
        text.Target.Should().Be(UiNodeId.Invalid);
        text.Text.Should().BeNull();
    }

    [Fact]
    public void OutOfRangeTouchAndKeyCodesAreRejected()
    {
        var adapter = new UiInputAdapter();

        adapter.TryMapPointer(RawInputEvent.CreateTouch(9, TouchPhase.Start, 0f, 0f, Ts(1)), out _).Should().BeFalse();
        adapter.TryMapKey(new RawInputEvent(Ts(1), RawInputType.KeyDown, DeviceIndex.Primary, 600, 0, 0), out _).Should().BeFalse();
    }

    [Fact]
    public void ResetClearsTrackedDeviceState()
    {
        var adapter = new UiInputAdapter();
        adapter.TryMapKey(KeyDown(Key.ShiftLeft), out _);
        adapter.TryMapPointer(RawInputEvent.CreateMouseDown(DeviceIndex.Primary, MouseButton.Left, Ts(1)), out _);

        adapter.Reset();
        adapter.TryMapPointer(MouseMove(1f, 1f), out UiPointerEvent afterReset);

        adapter.Buttons.Should().Be(UiPointerButtons.None);
        adapter.Modifiers.Should().Be(UiKeyModifiers.None);
        afterReset.Buttons.Should().Be(UiPointerButtons.None);
        afterReset.Modifiers.Should().Be(UiKeyModifiers.None);
    }

    [Fact]
    public void MappingIsDeterministicAcrossAdapters()
    {
        static UiPointerEvent[] Run(UiInputAdapter adapter)
        {
            var results = new List<UiPointerEvent>();
            adapter.TryMapPointer(MouseMove(3f, 4f), out UiPointerEvent move);
            results.Add(move);
            adapter.TryMapPointer(RawInputEvent.CreateMouseDown(DeviceIndex.Primary, MouseButton.Left, Ts(1)), out UiPointerEvent down);
            results.Add(down);
            adapter.TryMapPointer(RawInputEvent.CreateTouch(0, TouchPhase.Start, 7f, 8f, Ts(2)), out UiPointerEvent touch);
            results.Add(touch);
            adapter.TryMapPointer(MouseMove(9f, 10f), out UiPointerEvent secondMove);
            results.Add(secondMove);
            return results.ToArray();
        }

        Run(new UiInputAdapter()).Should().Equal(Run(new UiInputAdapter()));
    }

    [Fact]
    public void PointerMappingDoesNotAllocateAfterWarmup()
    {
        var adapter = new UiInputAdapter();
        RawInputEvent raw = MouseMove(5f, 5f);
        for (int warmup = 0; warmup < 128; warmup++)
        {
            adapter.TryMapPointer(raw, out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int mapped = 0;
        for (int step = 0; step < 2000; step++)
        {
            if (adapter.TryMapPointer(raw, out _))
            {
                mapped++;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        mapped.Should().Be(2000);
    }

    [Fact]
    public void MappedCharacterFeedsActiveComposition()
    {
        var sink = new RecordingTextSink();
        using var composition = new UiTextComposition(sink);
        var node = new UiNodeId(1);
        composition.Begin(node).Should().BeTrue();
        var adapter = new UiInputAdapter();
        adapter.TryMapText(RawInputEvent.CreateKeyChar(DeviceIndex.Primary, 'a', Ts(1)), out UiTextInputEvent text);

        composition.Feed(node, in text).Should().BeTrue();

        sink.Calls.Should().Equal($"begin:{node.Value}", $"commit:{node.Value}:a");
    }

    [Fact]
    public void PlainTextWithoutCompositionIsNotFedToTheSink()
    {
        var sink = new RecordingTextSink();
        using var composition = new UiTextComposition(sink);
        var adapter = new UiInputAdapter();
        adapter.TryMapText(RawInputEvent.CreateKeyChar(DeviceIndex.Primary, 'a', Ts(1)), out UiTextInputEvent text);

        composition.Feed(new UiNodeId(1), in text).Should().BeFalse();

        sink.Calls.Should().BeEmpty();
    }
}
