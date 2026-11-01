namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;
using FluentAssertions;
using Xunit;

public sealed class DropdownTests
{
    private static ControlHost Build(out UiControl dropdown, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        dropdown = host.Create(ControlKind.Dropdown, "A\nB\nC", index: 1);
        host.Runtime.Mount(dropdown);
        host.Layout();
        return host;
    }

    [Fact]
    public void HeaderShowsSelectedOption()
    {
        ControlHost host = Build(out UiControl dropdown);

        host.Runtime.TryGetSnapshot(dropdown, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Text.Should().Be("B");
        snapshot.Index.Should().Be(1);
        snapshot.IsOpen.Should().BeFalse();
    }

    [Fact]
    public void HeaderClickOpensPopupAndRaisesOpenChanged()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl dropdown = host.Create(ControlKind.Dropdown, "A\nB\nC");
        host.Runtime.Mount(dropdown);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(dropdown, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeTrue();
        events.Count(UiControlEventKind.OpenChanged).Should().Be(1);
    }

    [Fact]
    public void PopupRowClickSelectsAndCloses()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl dropdown = host.Create(ControlKind.Dropdown, "A\nB\nC");
        host.Runtime.Mount(dropdown);
        host.Layout();
        host.Click(10.0f, 10.0f);
        host.Layout();
        events.Clear();
        host.TryGetBounds(dropdown, out Rect headerBounds).Should().BeTrue();

        host.Click(10.0f, headerBounds.Y + headerBounds.Height + (28.0f * 2.0f) + 14.0f);

        host.Runtime.TryGetSnapshot(dropdown, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(2);
        snapshot.Text.Should().Be("C");
        snapshot.IsOpen.Should().BeFalse();
        events.Count(UiControlEventKind.SelectionChanged).Should().Be(1);
    }

    [Fact]
    public void ClosedPopupIsNotHitTestable()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl dropdown = host.Create(ControlKind.Dropdown, "A\nB\nC");
        host.Runtime.Mount(dropdown);
        host.Layout();

        host.Pointer(UiPointerPhase.Move, 10.0f, 70.0f).Should().BeFalse();
        host.Click(10.0f, 70.0f);

        host.Runtime.TryGetSnapshot(dropdown, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeFalse();
        snapshot.Index.Should().Be(0);
        events.Count(UiControlEventKind.SelectionChanged).Should().Be(0);
    }

    [Fact]
    public void KeyboardNavigatesCommitsAndCloses()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl dropdown = host.Create(ControlKind.Dropdown, "A\nB\nC");
        host.Runtime.Mount(dropdown);
        host.Layout();
        host.Click(10.0f, 10.0f);
        events.Clear();

        host.Key(ControlKeys.Down).Should().BeTrue();
        host.Runtime.TryGetSnapshot(dropdown, out UiControlSnapshot moved).Should().BeTrue();
        moved.Index.Should().Be(1);

        host.Key(ControlKeys.Enter).Should().BeTrue();
        host.Runtime.TryGetSnapshot(dropdown, out UiControlSnapshot closed).Should().BeTrue();
        closed.IsOpen.Should().BeFalse();
        events.Count(UiControlEventKind.SelectionChanged).Should().Be(1);
        events.Count(UiControlEventKind.OpenChanged).Should().Be(1);
    }

    [Fact]
    public void EscapeClosesOpenDropdown()
    {
        var host = Build(out UiControl dropdown);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.Escape).Should().BeTrue();

        host.Runtime.TryGetSnapshot(dropdown, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeFalse();
    }
}

public sealed class RadioGroupTests
{
    private static ControlHost Build(out UiControl group, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        group = host.Create(ControlKind.RadioGroup, "A\nB\nC");
        host.Runtime.Mount(group);
        host.Layout();
        return host;
    }

    [Fact]
    public void OptionsBecomeChildNodes()
    {
        ControlHost host = Build(out UiControl group);

        ReadOnlySpan<UiNodeId> options = host.Runtime.Nodes.GetChildren(group.Node);
        options.Length.Should().Be(3);
        host.Runtime.TryGetSnapshot(group, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
        snapshot.Checked.Should().BeFalse();
    }

    [Fact]
    public void OptionClickSelectsRow()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl group = host.Create(ControlKind.RadioGroup, "A\nB\nC");
        host.Runtime.Mount(group);
        host.Layout();
        ReadOnlySpan<UiNodeId> options = host.Runtime.Nodes.GetChildren(group.Node);
        host.Runtime.TryGetBounds(options[1], out Rect box).Should().BeTrue();

        host.Click(box.X + 5.0f, box.Y + (box.Height * 0.5f));

        host.Runtime.TryGetSnapshot(group, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
        events.Count(UiControlEventKind.SelectionChanged).Should().Be(1);
    }

    [Fact]
    public void KeyboardMovesSelectionWithinTheGroup()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl group = host.Create(ControlKind.RadioGroup, "A\nB\nC");
        host.Runtime.Mount(group);
        host.Layout();
        ReadOnlySpan<UiNodeId> options = host.Runtime.Nodes.GetChildren(group.Node);
        host.Runtime.TryGetBounds(options[0], out Rect box).Should().BeTrue();
        host.Click(box.X + 5.0f, box.Y + (box.Height * 0.5f));
        events.Clear();

        host.Key(ControlKeys.Down).Should().BeTrue();
        host.Runtime.TryGetSnapshot(group, out UiControlSnapshot down).Should().BeTrue();
        down.Index.Should().Be(1);

        host.Key(ControlKeys.Up).Should().BeTrue();
        host.Key(ControlKeys.Up).Should().BeTrue();
        host.Runtime.TryGetSnapshot(group, out UiControlSnapshot top).Should().BeTrue();
        top.Index.Should().Be(0);
    }

    [Fact]
    public void DisabledGroupIgnoresOptionClicks()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl group = host.Create(ControlKind.RadioGroup, "A\nB\nC");
        host.Runtime.Mount(group);
        host.Layout();
        ReadOnlySpan<UiNodeId> options = host.Runtime.Nodes.GetChildren(group.Node);
        host.Runtime.TryGetBounds(options[2], out Rect box).Should().BeTrue();
        host.Runtime.SetEnabled(group, false);
        host.Layout();
        events.Clear();

        host.Click(box.X + 5.0f, box.Y + (box.Height * 0.5f));

        host.Runtime.TryGetSnapshot(group, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
        events.Count(UiControlEventKind.SelectionChanged).Should().Be(0);
    }

    [Fact]
    public void SetSelectedIndexClampsAndEmits()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl group = host.Create(ControlKind.RadioGroup, "A\nB\nC");
        host.Runtime.Mount(group);

        host.Runtime.SetSelectedIndex(group, 9).Should().BeTrue();
        host.Runtime.SetSelectedIndex(group, 9).Should().BeTrue();

        host.Runtime.TryGetSnapshot(group, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(2);
        events.Count(UiControlEventKind.SelectionChanged).Should().Be(1);
    }
}
