namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;
using FluentAssertions;
using Xunit;

public sealed class SliderTests
{
    [Fact]
    public void PointerDragUpdatesValueAndCommitsOnRelease()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl slider = host.Create(ControlKind.Slider);
        host.Runtime.Mount(slider);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 120.0f, 10.0f).Should().BeTrue();
        host.Runtime.TryGetSnapshot(slider, out UiControlSnapshot pressed).Should().BeTrue();
        pressed.Value.Should().BeApproximately(0.3f, 0.0001f);

        host.Pointer(UiPointerPhase.Move, 320.0f, 10.0f).Should().BeTrue();
        host.Pointer(UiPointerPhase.Up, 320.0f, 10.0f).Should().BeTrue();

        host.Runtime.TryGetSnapshot(slider, out UiControlSnapshot released).Should().BeTrue();
        released.Value.Should().BeApproximately(0.8f, 0.0001f);
        released.State.Should().Be(UiControlState.Hover);
        events.Count(UiControlEventKind.ValueChanged).Should().Be(2);
        events.Count(UiControlEventKind.ValueCommitted).Should().Be(1);
    }

    [Fact]
    public void PointerBeyondTrackClampsToMaximum()
    {
        var host = new ControlHost();
        UiControl slider = host.Create(ControlKind.Slider);
        host.Runtime.Mount(slider);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 200.0f, 10.0f);
        host.Pointer(UiPointerPhase.Move, 5000.0f, 10.0f);

        host.Runtime.TryGetSnapshot(slider, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(1.0f);
    }

    [Fact]
    public void KeyboardStepsAndJumpsToBounds()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl slider = host.Create(ControlKind.Slider);
        host.Runtime.Mount(slider);
        host.Layout();
        host.Pointer(UiPointerPhase.Down, 200.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 200.0f, 10.0f);
        host.Runtime.TryGetSnapshot(slider, out UiControlSnapshot start).Should().BeTrue();
        start.Value.Should().BeApproximately(0.5f, 0.0001f);
        events.Clear();

        host.Key(ControlKeys.Right).Should().BeTrue();
        host.Runtime.TryGetSnapshot(slider, out UiControlSnapshot stepped).Should().BeTrue();
        stepped.Value.Should().BeApproximately(0.6f, 0.0001f);

        host.Key(ControlKeys.Home).Should().BeTrue();
        host.Key(ControlKeys.End).Should().BeTrue();
        host.Runtime.TryGetSnapshot(slider, out UiControlSnapshot end).Should().BeTrue();
        end.Value.Should().Be(1.0f);
        events.Count(UiControlEventKind.ValueCommitted).Should().Be(3);
    }

    [Fact]
    public void DisabledSliderIgnoresPointer()
    {
        var host = new ControlHost();
        UiControl slider = host.Create(ControlKind.Slider);
        host.Runtime.Mount(slider);
        host.Layout();
        host.Runtime.SetEnabled(slider, false);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 200.0f, 10.0f);

        host.Runtime.TryGetSnapshot(slider, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(0.0f);
    }
}

public sealed class TextInputTests
{
    private static ControlHost Focused(IUiControlEventSink sink, out UiControl input)
    {
        var host = new ControlHost(sink);
        input = host.Create(ControlKind.TextInput, "hi");
        host.Runtime.Mount(input);
        host.Layout();
        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f);
        return host;
    }

    [Fact]
    public void TypingAppendsAtCaret()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl input = host.Create(ControlKind.TextInput, "ab");
        host.Runtime.Mount(input);
        host.Layout();
        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f);
        host.Runtime.TryGetFocusedControl(out UiControl focused).Should().BeTrue();
        focused.Should().Be(input);

        host.Text("cd").Should().BeTrue();

        host.Runtime.TryGetSnapshot(input, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Text.Should().Be("abcd");
        events.Count(UiControlEventKind.TextChanged).Should().Be(1);
    }

    [Fact]
    public void EditingKeysRespectCaret()
    {
        var host = Focused(new RecordingControlSink(), out UiControl input);

        host.Key(ControlKeys.Backspace).Should().BeTrue();
        host.Runtime.TryGetSnapshot(input, out UiControlSnapshot afterBackspace).Should().BeTrue();
        afterBackspace.Text.Should().Be("h");

        host.Text("xy");
        host.Key(ControlKeys.Home).Should().BeTrue();
        host.Key(ControlKeys.Delete).Should().BeTrue();
        host.Runtime.TryGetSnapshot(input, out UiControlSnapshot afterDelete).Should().BeTrue();
        afterDelete.Text.Should().Be("xy");
    }

    [Fact]
    public void EnterCommitsText()
    {
        var events = new RecordingControlSink();
        var host = Focused(events, out UiControl input);
        host.Text("!");
        events.Clear();

        host.Key(ControlKeys.Enter).Should().BeTrue();

        events.Count(UiControlEventKind.TextCommitted).Should().Be(1);
        events.Last(UiControlEventKind.TextCommitted).Text.Should().Be("hi!");
        host.Runtime.TryGetSnapshot(input, out _).Should().BeTrue();
    }

    [Fact]
    public void BlurCommitsText()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl input = host.Create(ControlKind.TextInput, "x");
        host.Runtime.Mount(input);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();
        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f);
        events.Clear();

        host.Pointer(UiPointerPhase.Down, 10.0f, 50.0f);
        host.Pointer(UiPointerPhase.Up, 10.0f, 50.0f);

        events.Count(UiControlEventKind.TextCommitted).Should().Be(1);
        host.Runtime.TryGetFocusedControl(out UiControl focused).Should().BeTrue();
        focused.Should().Be(button);
    }

    [Fact]
    public void SetTextApiUpdatesValueAndEmits()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl input = host.Create(ControlKind.TextInput, "a");
        host.Runtime.Mount(input);

        host.Runtime.SetText(input, "abc").Should().BeTrue();
        host.Runtime.SetText(input, "abc").Should().BeTrue();

        host.Runtime.TryGetSnapshot(input, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Text.Should().Be("abc");
        events.Count(UiControlEventKind.TextChanged).Should().Be(1);
    }
}

public sealed class ScrollViewTests
{
    private static ControlHost Build(out UiControl scroll, out UiControl[] rows)
    {
        var host = new ControlHost(new RecordingControlSink());
        scroll = host.Runtime.CreateControl(ControlKind.ScrollView, default);
        host.Runtime.Mount(scroll);
        rows = new UiControl[6];
        for (int i = 0; i < rows.Length; i++)
        {
            rows[i] = host.Create(ControlKind.Label, $"Row {i}", scroll);
            host.Runtime.SetLayoutStyle(rows[i], UiLayoutStyle.Default with { Height = UiLength.Px(32.0f), Shrink = 0.0f });
        }

        host.Layout();
        return host;
    }

    [Fact]
    public void WheelScrollsChildrenWithinTheClip()
    {
        ControlHost host = Build(out UiControl scroll, out UiControl[] rows);
        host.TryGetBounds(rows[0], out Rect before).Should().BeTrue();
        before.Y.Should().Be(0.0f);

        host.Wheel(10.0f, 10.0f, -1.0f).Should().BeTrue();
        host.Layout();

        host.Runtime.TryGetSnapshot(scroll, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.ScrollOffset.Should().Be(20.0f);
        host.TryGetBounds(rows[0], out Rect after).Should().BeTrue();
        after.Y.Should().Be(-20.0f);
    }

    [Fact]
    public void WheelAtTopDoesNotScroll()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl scroll = host.Runtime.CreateControl(ControlKind.ScrollView, default);
        host.Runtime.Mount(scroll);
        UiControl row = host.Create(ControlKind.Label, "Row", scroll);
        host.Runtime.SetLayoutStyle(row, UiLayoutStyle.Default with { Height = UiLength.Px(32.0f), Shrink = 0.0f });
        host.Layout();

        host.Wheel(10.0f, 10.0f, 1.0f).Should().BeFalse();

        host.Runtime.TryGetSnapshot(scroll, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.ScrollOffset.Should().Be(0.0f);
        events.Count(UiControlEventKind.ScrollChanged).Should().Be(0);
    }

    [Fact]
    public void WheelClampsToContentHeight()
    {
        ControlHost host = Build(out UiControl scroll, out _);

        host.Wheel(10.0f, 10.0f, -1000.0f);
        host.Layout();

        host.Runtime.TryGetSnapshot(scroll, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.ScrollOffset.Should().Be(72.0f);
    }

    [Fact]
    public void KeyboardHomeAndEndMoveScrollOffset()
    {
        ControlHost host = Build(out UiControl scroll, out _);
        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f);

        host.Key(ControlKeys.End).Should().BeTrue();
        host.Layout();
        host.Runtime.TryGetSnapshot(scroll, out UiControlSnapshot end).Should().BeTrue();
        end.ScrollOffset.Should().Be(72.0f);

        host.Key(ControlKeys.Home).Should().BeTrue();
        host.Layout();
        host.Runtime.TryGetSnapshot(scroll, out UiControlSnapshot home).Should().BeTrue();
        home.ScrollOffset.Should().Be(0.0f);
    }
}
