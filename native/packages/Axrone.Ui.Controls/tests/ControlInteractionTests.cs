namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;
using FluentAssertions;
using Xunit;

public sealed class ButtonTests
{
    [Fact]
    public void ClickEmitsSingleClickAndTracksPressState()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();

        host.Pointer(UiPointerPhase.Move, 10.0f, 10.0f).Should().BeFalse();
        host.Runtime.TryGetSnapshot(button, out UiControlSnapshot hovered).Should().BeTrue();
        hovered.State.Should().Be(UiControlState.Hover);

        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f).Should().BeTrue();
        host.Runtime.TryGetSnapshot(button, out UiControlSnapshot pressed).Should().BeTrue();
        pressed.State.Should().Be(UiControlState.Pressed);

        host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f).Should().BeTrue();
        host.Runtime.TryGetSnapshot(button, out UiControlSnapshot released).Should().BeTrue();
        released.State.Should().Be(UiControlState.Hover);
        events.Count(UiControlEventKind.Click).Should().Be(1);
    }

    [Fact]
    public void HoverChangesTheResolvedWidgetStyle()
    {
        var host = new ControlHost();
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();
        host.Runtime.TryGetStyle(button.Node, out UiWidgetStyle idle).Should().BeTrue();

        host.Pointer(UiPointerPhase.Move, 10.0f, 10.0f);

        host.Runtime.TryGetStyle(button.Node, out UiWidgetStyle hovered).Should().BeTrue();
        hovered.Background.Should().NotBe(idle.Background);
        host.Runtime.TryGetSnapshot(button, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.State.Should().Be(UiControlState.Hover);
    }

    [Fact]
    public void ReleaseWithoutPressDoesNotClick()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();

        host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f).Should().BeFalse();

        events.Events.Should().BeEmpty();
    }

    [Fact]
    public void PointerDownFocusesButtonAndKeyClickIsRouted()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f);
        host.Runtime.TryGetFocusedControl(out UiControl focused).Should().BeTrue();
        focused.Should().Be(button);
        events.Clear();

        host.Key(ControlKeys.Space).Should().BeTrue();
        host.Key(ControlKeys.Enter).Should().BeTrue();

        events.Count(UiControlEventKind.Click).Should().Be(2);
    }

    [Fact]
    public void DisabledButtonIgnoresPointerAndKeyboard()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();
        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f);
        host.Runtime.SetEnabled(button, false);
        host.Layout();
        events.Clear();

        host.Click(10.0f, 10.0f);
        host.Key(ControlKeys.Space);

        events.Count(UiControlEventKind.Click).Should().Be(0);
    }
}

public sealed class LabelAndImageTests
{
    [Fact]
    public void LabelMeasuresThroughTheTextContract()
    {
        var host = new ControlHost();
        UiControl label = host.Create(ControlKind.Label, "abcd");
        host.Runtime.Mount(label);
        host.Layout();

        host.TryGetBounds(label, out Rect bounds).Should().BeTrue();
        bounds.Height.Should().Be(16.0f);
        bounds.Width.Should().Be(400.0f);
    }

    [Fact]
    public void LabelIsNotInteractive()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl label = host.Create(ControlKind.Label, "label");
        host.Runtime.Mount(label);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f).Should().BeFalse();

        events.Events.Should().BeEmpty();
        host.Runtime.TryGetFocusedControl(out _).Should().BeFalse();
    }

    [Fact]
    public void ImageUsesIntrinsicHeight()
    {
        var images = new TestImageMetrics();
        images.Set(new UiResourceId(9), 64.0f, 32.0f);
        var host = new ControlHost(images: images);
        UiControl image = host.Create(ControlKind.Image, image: new UiResourceId(9));
        host.Runtime.Mount(image);
        host.Layout();

        host.TryGetBounds(image, out Rect bounds).Should().BeTrue();
        bounds.Height.Should().Be(32.0f);
        bounds.Width.Should().Be(400.0f);
    }

    [Fact]
    public void ImageWithoutMetricsCollapsesToZeroHeight()
    {
        var host = new ControlHost(images: new TestImageMetrics());
        UiControl image = host.Create(ControlKind.Image, image: new UiResourceId(9));
        host.Runtime.Mount(image);
        host.Layout();

        host.TryGetBounds(image, out Rect bounds).Should().BeTrue();
        bounds.Height.Should().Be(0.0f);
    }
}

public sealed class PanelTests
{
    [Fact]
    public void PanelFlowsChildrenWithPaddingAndGap()
    {
        var host = new ControlHost();
        UiControl panel = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(panel);
        UiControl first = host.Create(ControlKind.Label, "One", panel);
        UiControl second = host.Create(ControlKind.Label, "Two", panel);
        host.Layout();

        host.TryGetBounds(first, out Rect firstBox).Should().BeTrue();
        host.TryGetBounds(second, out Rect secondBox).Should().BeTrue();
        firstBox.Y.Should().Be(8.0f);
        firstBox.Height.Should().Be(16.0f);
        secondBox.Y.Should().Be(28.0f);
    }

    [Fact]
    public void LayoutStyleOverridesControlGeometry()
    {
        var host = new ControlHost();
        UiControl panel = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(panel);
        UiControl button = host.Create(ControlKind.Button, "OK", panel);
        host.Runtime.SetLayoutStyle(button, UiLayoutStyle.Default with { Width = UiLength.Px(120.0f), Height = UiLength.Px(20.0f) });
        host.Layout();

        host.TryGetBounds(button, out Rect bounds).Should().BeTrue();
        bounds.Width.Should().Be(120.0f);
        bounds.Height.Should().Be(20.0f);
    }
}

public sealed class CheckboxAndToggleTests
{
    [Fact]
    public void CheckboxClickTogglesAndRaisesClick()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl checkbox = host.Create(ControlKind.Checkbox, "Remember");
        host.Runtime.Mount(checkbox);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(checkbox, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Checked.Should().BeTrue();
        events.Count(UiControlEventKind.CheckedChanged).Should().Be(1);
        events.Count(UiControlEventKind.Click).Should().Be(1);
    }

    [Fact]
    public void SecondCheckboxClickUnchecks()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl checkbox = host.Create(ControlKind.Checkbox, "Remember", isChecked: true);
        host.Runtime.Mount(checkbox);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(checkbox, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Checked.Should().BeFalse();
        events.Count(UiControlEventKind.CheckedChanged).Should().Be(1);
    }

    [Fact]
    public void CheckboxSpaceKeyToggles()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl checkbox = host.Create(ControlKind.Checkbox, "Remember");
        host.Runtime.Mount(checkbox);
        host.Layout();
        host.Click(10.0f, 10.0f);
        events.Clear();

        host.Key(ControlKeys.Space).Should().BeTrue();

        host.Runtime.TryGetSnapshot(checkbox, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Checked.Should().BeFalse();
        events.Count(UiControlEventKind.CheckedChanged).Should().Be(1);
    }

    [Fact]
    public void SetCheckedRaisesOnlyOnChange()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl checkbox = host.Create(ControlKind.Checkbox, "Remember");
        host.Runtime.Mount(checkbox);

        host.Runtime.SetChecked(checkbox, true).Should().BeTrue();
        host.Runtime.SetChecked(checkbox, true).Should().BeTrue();

        events.Count(UiControlEventKind.CheckedChanged).Should().Be(1);
    }

    [Fact]
    public void ToggleClickRaisesCheckedChangedWithoutClick()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl toggle = host.Create(ControlKind.Toggle);
        host.Runtime.Mount(toggle);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(toggle, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Checked.Should().BeTrue();
        events.Count(UiControlEventKind.CheckedChanged).Should().Be(1);
        events.Count(UiControlEventKind.Click).Should().Be(0);
    }

    [Fact]
    public void DisabledToggleDoesNotChange()
    {
        var host = new ControlHost();
        UiControl toggle = host.Create(ControlKind.Toggle);
        host.Runtime.Mount(toggle);
        host.Layout();
        host.Runtime.SetEnabled(toggle, false);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(toggle, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Checked.Should().BeFalse();
    }
}

public sealed class ProgressBarTests
{
    [Fact]
    public void SetValueEmitsAndClampsToUnitRange()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl progress = host.Create(ControlKind.ProgressBar);
        host.Runtime.Mount(progress);

        host.Runtime.SetValue(progress, 0.4f).Should().BeTrue();
        host.Runtime.SetValue(progress, 2.0f).Should().BeTrue();
        host.Runtime.SetValue(progress, 2.0f).Should().BeTrue();

        host.Runtime.TryGetSnapshot(progress, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(1.0f);
        events.Count(UiControlEventKind.ValueChanged).Should().Be(2);
    }

    [Fact]
    public void ProgressBarIsNotFocusable()
    {
        var host = new ControlHost();
        UiControl progress = host.Create(ControlKind.ProgressBar);
        host.Runtime.Mount(progress);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetFocusedControl(out _).Should().BeFalse();
    }
}
