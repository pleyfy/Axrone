namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;
using FluentAssertions;
using Xunit;

public sealed class TabViewTests
{
    private static ControlHost Build(out UiControl tabs, out UiControl[] pages)
    {
        var host = new ControlHost(new RecordingControlSink());
        tabs = host.Create(ControlKind.TabView, "A\nB\nC");
        host.Runtime.Mount(tabs);
        pages = new UiControl[3];
        for (int i = 0; i < pages.Length; i++)
        {
            pages[i] = host.Runtime.CreateControl(ControlKind.Panel, default);
            host.Runtime.Mount(pages[i]);
            host.Runtime.AddPage(tabs, pages[i]).Should().BeTrue();
        }

        host.Layout();
        return host;
    }

    private static bool IsVisible(ControlHost host, UiControl control) =>
        host.Runtime.Nodes.TryGetNode(control.Node, out UiNodeRecord record) && (record.Flags & UiNodeFlags.Visible) != 0;

    [Fact]
    public void ClickingHeaderSelectsTabAndSwapsPageVisibility()
    {
        ControlHost host = Build(out UiControl tabs, out UiControl[] pages);
        IsVisible(host, pages[0]).Should().BeTrue();

        host.Click(40.0f, 10.0f);

        host.Runtime.TryGetSnapshot(tabs, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
        IsVisible(host, pages[0]).Should().BeFalse();
        IsVisible(host, pages[1]).Should().BeTrue();
    }

    [Fact]
    public void KeyboardMovesSelectionAndStopsAtEnds()
    {
        ControlHost host = Build(out UiControl tabs, out _);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.Right).Should().BeTrue();
        host.Key(ControlKeys.Right).Should().BeTrue();
        host.Key(ControlKeys.Right).Should().BeTrue();

        host.Runtime.TryGetSnapshot(tabs, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(2);
    }

    [Fact]
    public void DisabledTabViewIgnoresClicks()
    {
        ControlHost host = Build(out UiControl tabs, out _);
        host.Runtime.SetEnabled(tabs, false);
        host.Layout();

        host.Click(40.0f, 10.0f);

        host.Runtime.TryGetSnapshot(tabs, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }
}

public sealed class TextAreaTests
{
    [Fact]
    public void TypingAndNewlineAppendToTheText()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl area = host.Create(ControlKind.TextArea, "a");
        host.Runtime.Mount(area);
        host.Layout();
        host.Click(10.0f, 10.0f);
        host.Runtime.TryGetFocusedControl(out UiControl focused).Should().BeTrue();
        focused.Should().Be(area);
        host.Key(ControlKeys.End).Should().BeTrue();

        host.Text("b").Should().BeTrue();
        host.Key(ControlKeys.Enter).Should().BeTrue();
        host.Text("c").Should().BeTrue();

        host.Runtime.TryGetSnapshot(area, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Text.Should().Be("ab\nc");
        events.Count(UiControlEventKind.TextChanged).Should().Be(3);
    }

    [Fact]
    public void EditingKeysRespectCaretAndLines()
    {
        var host = new ControlHost(new RecordingControlSink());
        UiControl area = host.Create(ControlKind.TextArea, "ab\ncd");
        host.Runtime.Mount(area);
        host.Layout();
        host.Click(100.0f, 100.0f);

        host.Key(ControlKeys.Backspace).Should().BeTrue();
        host.Runtime.TryGetSnapshot(area, out UiControlSnapshot first).Should().BeTrue();
        first.Text.Should().Be("ab\nc");

        host.Key(ControlKeys.Home).Should().BeTrue();
        host.Key(ControlKeys.Up).Should().BeTrue();
        host.Key(ControlKeys.End).Should().BeTrue();
        host.Text("!").Should().BeTrue();
        host.Runtime.TryGetSnapshot(area, out UiControlSnapshot second).Should().BeTrue();
        second.Text.Should().Be("ab!\nc");
    }

    [Fact]
    public void EscapeAndBlurCommitTheText()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl area = host.Create(ControlKind.TextArea, "x");
        host.Runtime.Mount(area);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();
        host.Click(10.0f, 10.0f);
        events.Clear();

        host.Key(ControlKeys.Escape).Should().BeTrue();
        events.Count(UiControlEventKind.TextCommitted).Should().Be(1);

        host.Pointer(UiPointerPhase.Down, 10.0f, 150.0f);
        host.Pointer(UiPointerPhase.Up, 10.0f, 150.0f);
        events.Count(UiControlEventKind.TextCommitted).Should().Be(2);
    }

    [Fact]
    public void DisabledTextAreaDoesNotTakeFocus()
    {
        var host = new ControlHost();
        UiControl area = host.Create(ControlKind.TextArea, "x");
        host.Runtime.Mount(area);
        host.Layout();
        host.Runtime.SetEnabled(area, false);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetFocusedControl(out _).Should().BeFalse();
    }
}

public sealed class ListViewTests
{
    private static ControlHost Build(out UiControl list, int count = 10)
    {
        var host = new ControlHost(new RecordingControlSink());
        list = host.Create(ControlKind.ListView, items: new TestListSource { Count = count });
        host.Runtime.Mount(list);
        host.Layout();
        return host;
    }

    [Fact]
    public void RowClickSelectsIndex()
    {
        ControlHost host = Build(out UiControl list);

        host.Click(10.0f, 70.0f);

        host.Runtime.TryGetSnapshot(list, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(2);
    }

    [Fact]
    public void VirtualRangeTracksScrollOffset()
    {
        ControlHost host = Build(out UiControl list);
        host.Runtime.TryGetVirtualRange(list, out int first, out int last).Should().BeTrue();
        first.Should().Be(0);
        last.Should().Be(7);

        host.Wheel(10.0f, 10.0f, -5.0f);
        host.Layout();

        host.Runtime.TryGetVirtualRange(list, out first, out last).Should().BeTrue();
        first.Should().Be(2);
        last.Should().Be(9);
    }

    [Fact]
    public void KeyboardEndSelectsLastRowAndKeepsItVisible()
    {
        ControlHost host = Build(out UiControl list);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.End).Should().BeTrue();

        host.Runtime.TryGetSnapshot(list, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(9);
        snapshot.ScrollOffset.Should().BeGreaterThan(0.0f);
    }

    [Fact]
    public void EmptySourceHasNoSelectionOrRange()
    {
        ControlHost host = Build(out UiControl list, count: 0);

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetVirtualRange(list, out _, out _).Should().BeFalse();
        host.Runtime.TryGetSnapshot(list, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }

    [Fact]
    public void DisabledListIgnoresPointer()
    {
        ControlHost host = Build(out UiControl list);
        host.Runtime.SetEnabled(list, false);
        host.Layout();

        host.Click(10.0f, 70.0f);

        host.Runtime.TryGetSnapshot(list, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }
}

public sealed class TreeViewTests
{
    private static ControlHost Build(out UiControl tree)
    {
        var host = new ControlHost(new RecordingControlSink());
        tree = host.Create(ControlKind.TreeView, tree: new TestTreeSource());
        host.Runtime.Mount(tree);
        host.Layout();
        return host;
    }

    private static int RowCount(ControlHost host, UiControl tree) =>
        host.Runtime.TryGetVirtualRange(tree, out _, out int last) ? last + 1 : 0;

    [Fact]
    public void CollapsedTreeShowsRootsOnly()
    {
        ControlHost host = Build(out UiControl tree);

        RowCount(host, tree).Should().Be(1);
        host.Runtime.TryGetSnapshot(tree, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }

    [Fact]
    public void RightExpandsAndLeftCollapses()
    {
        ControlHost host = Build(out UiControl tree);
        host.Click(100.0f, 10.0f);

        host.Key(ControlKeys.Right).Should().BeTrue();
        RowCount(host, tree).Should().Be(3);

        host.Key(ControlKeys.Left).Should().BeTrue();
        RowCount(host, tree).Should().Be(1);
    }

    [Fact]
    public void DisclosureClickExpandsTheRow()
    {
        ControlHost host = Build(out UiControl tree);

        host.Click(5.0f, 10.0f);

        RowCount(host, tree).Should().Be(3);
    }

    [Fact]
    public void DisabledTreeIgnoresPointer()
    {
        ControlHost host = Build(out UiControl tree);
        host.Runtime.SetEnabled(tree, false);
        host.Layout();

        host.Click(5.0f, 10.0f);

        RowCount(host, tree).Should().Be(1);
    }
}

public sealed class MenuTests
{
    private static ControlHost Build(out UiControl menu, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        menu = host.Create(ControlKind.Menu, "A\nB\nC");
        host.Runtime.Mount(menu);
        host.Layout();
        return host;
    }

    [Fact]
    public void HeaderClickOpensTheMenu()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl menu = host.Create(ControlKind.Menu, "A\nB\nC");
        host.Runtime.Mount(menu);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(menu, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeTrue();
        events.Count(UiControlEventKind.OpenChanged).Should().Be(1);
    }

    [Fact]
    public void RowClickSelectsEmitsClickAndCloses()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl menu = host.Create(ControlKind.Menu, "A\nB\nC");
        host.Runtime.Mount(menu);
        host.Layout();
        host.Click(10.0f, 10.0f);
        host.Layout();
        events.Clear();

        host.Click(10.0f, 36.0f + 28.0f + 14.0f);

        host.Runtime.TryGetSnapshot(menu, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
        snapshot.IsOpen.Should().BeFalse();
        events.Count(UiControlEventKind.Click).Should().Be(1);
        events.Count(UiControlEventKind.SelectionChanged).Should().Be(1);
    }

    [Fact]
    public void KeyboardNavigatesAndCloses()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl menu = host.Create(ControlKind.Menu, "A\nB\nC");
        host.Runtime.Mount(menu);
        host.Layout();
        host.Click(10.0f, 10.0f);
        host.Key(ControlKeys.Down).Should().BeTrue();
        events.Clear();

        host.Key(ControlKeys.Enter).Should().BeTrue();

        host.Runtime.TryGetSnapshot(menu, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeFalse();
        events.Count(UiControlEventKind.OpenChanged).Should().Be(1);
    }

    [Fact]
    public void DisabledMenuDoesNotOpen()
    {
        ControlHost host = Build(out UiControl menu);
        host.Runtime.SetEnabled(menu, false);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(menu, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeFalse();
    }
}

public sealed class TooltipTests
{
    [Fact]
    public void SetOpenTogglesVisibilityAndEmits()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl tooltip = host.Create(ControlKind.Tooltip, "Hint");
        host.Runtime.Mount(tooltip);
        host.Layout();

        host.Runtime.SetOpen(tooltip, true).Should().BeTrue();
        host.Runtime.TryGetSnapshot(tooltip, out UiControlSnapshot open).Should().BeTrue();
        open.IsOpen.Should().BeTrue();
        host.Runtime.Nodes.TryGetNode(tooltip.Node, out UiNodeRecord shown).Should().BeTrue();
        (shown.Flags & UiNodeFlags.Visible).Should().NotBe(UiNodeFlags.None);

        host.Runtime.SetOpen(tooltip, false).Should().BeTrue();
        host.Runtime.Nodes.TryGetNode(tooltip.Node, out UiNodeRecord hidden).Should().BeTrue();
        (hidden.Flags & UiNodeFlags.Visible).Should().Be(UiNodeFlags.None);
        events.Count(UiControlEventKind.OpenChanged).Should().Be(2);
    }

    [Fact]
    public void TooltipIsNotHitTestable()
    {
        var host = new ControlHost();
        UiControl tooltip = host.Create(ControlKind.Tooltip, "Hint");
        host.Runtime.Mount(tooltip);
        host.Layout();
        host.Runtime.SetOpen(tooltip, true);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f).Should().BeFalse();
        host.Runtime.TryGetFocusedControl(out _).Should().BeFalse();
    }
}

public sealed class DialogTests
{
    private static ControlHost Build(out UiControl dialog, out UiControl button)
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        dialog = host.Create(ControlKind.Dialog, "Title");
        host.Runtime.Mount(dialog);
        host.Layout();
        return host;
    }

    [Fact]
    public void OpenFocusesTheDialogAndEscapeClosesIt()
    {
        ControlHost host = Build(out UiControl dialog, out _);

        host.Runtime.SetOpen(dialog, true).Should().BeTrue();
        host.Runtime.TryGetFocusedControl(out UiControl focused).Should().BeTrue();
        focused.Should().Be(dialog);

        host.Key(ControlKeys.Escape).Should().BeTrue();

        host.Runtime.TryGetSnapshot(dialog, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeFalse();
        host.Runtime.TryGetFocusedControl(out _).Should().BeFalse();
    }

    [Fact]
    public void OpenDialogBlocksControlsBehindIt()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        UiControl dialog = host.Create(ControlKind.Dialog, "Title");
        host.Runtime.Mount(dialog);
        host.Layout();
        host.Runtime.SetOpen(dialog, true);
        host.Layout();
        events.Clear();

        host.Click(10.0f, 10.0f);

        events.Count(UiControlEventKind.Click).Should().Be(0);
    }

    [Fact]
    public void ClosedDialogIsHidden()
    {
        ControlHost host = Build(out UiControl dialog, out _);
        host.Runtime.Nodes.TryGetNode(dialog.Node, out UiNodeRecord record).Should().BeTrue();

        (record.Flags & UiNodeFlags.Visible).Should().Be(UiNodeFlags.None);
    }

    [Fact]
    public void DialogContentClickIsConsumed()
    {
        ControlHost host = Build(out UiControl dialog, out _);
        host.Runtime.SetOpen(dialog, true);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 50.0f, 50.0f).Should().BeTrue();
        host.Pointer(UiPointerPhase.Up, 50.0f, 50.0f).Should().BeTrue();
    }
}

public sealed class ToastTests
{
    [Fact]
    public void OpenStartsTheTimerAndShowsTheToast()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl toast = host.Create(ControlKind.Toast, "Saved");
        host.Runtime.Mount(toast);
        host.Layout();

        host.Runtime.SetOpen(toast, true).Should().BeTrue();

        host.Runtime.TryGetSnapshot(toast, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeTrue();
        snapshot.Value.Should().Be(3.0f);
        events.Count(UiControlEventKind.OpenChanged).Should().Be(1);
    }

    [Fact]
    public void UpdateExpiresTheToast()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl toast = host.Create(ControlKind.Toast, "Saved");
        host.Runtime.Mount(toast);
        host.Runtime.SetOpen(toast, true);
        events.Clear();

        host.Runtime.Update(1.0f).Should().Be(0);
        host.Runtime.TryGetSnapshot(toast, out UiControlSnapshot running).Should().BeTrue();
        running.Value.Should().Be(2.0f);

        host.Runtime.Update(2.5f).Should().Be(1);
        host.Runtime.TryGetSnapshot(toast, out UiControlSnapshot expired).Should().BeTrue();
        expired.IsOpen.Should().BeFalse();
        expired.Value.Should().Be(0.0f);
        events.Count(UiControlEventKind.OpenChanged).Should().Be(1);
    }

    [Fact]
    public void UpdateWithoutOpenToastDoesNothing()
    {
        var host = new ControlHost();
        UiControl toast = host.Create(ControlKind.Toast, "Saved");
        host.Runtime.Mount(toast);

        host.Runtime.Update(5.0f).Should().Be(0);
    }
}

public sealed class SegmentedControlTests
{
    private static ControlHost Build(out UiControl segments)
    {
        var host = new ControlHost(new RecordingControlSink());
        segments = host.Create(ControlKind.SegmentedControl, "A\nB\nC");
        host.Runtime.Mount(segments);
        host.Layout();
        return host;
    }

    [Fact]
    public void ClickSelectsSegmentByPosition()
    {
        ControlHost host = Build(out UiControl segments);

        host.Click(200.0f, 10.0f);

        host.Runtime.TryGetSnapshot(segments, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
    }

    [Fact]
    public void KeyboardMovesSelection()
    {
        ControlHost host = Build(out UiControl segments);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.Right).Should().BeTrue();

        host.Runtime.TryGetSnapshot(segments, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
    }

    [Fact]
    public void DisabledSegmentsIgnoreClicks()
    {
        ControlHost host = Build(out UiControl segments);
        host.Runtime.SetEnabled(segments, false);
        host.Layout();

        host.Click(200.0f, 10.0f);

        host.Runtime.TryGetSnapshot(segments, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }
}

public sealed class StepperTests
{
    private static ControlHost Build(out UiControl stepper, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        stepper = host.Create(ControlKind.Stepper, value: 0.5f, min: 0.0f, max: 1.0f, step: 0.1f);
        host.Runtime.Mount(stepper);
        host.Layout();
        return host;
    }

    [Fact]
    public void ClickingHalvesStepsTheValue()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl stepper = host.Create(ControlKind.Stepper, value: 0.5f, min: 0.0f, max: 1.0f, step: 0.1f);
        host.Runtime.Mount(stepper);
        host.Layout();

        host.Click(100.0f, 10.0f);

        host.Runtime.TryGetSnapshot(stepper, out UiControlSnapshot up).Should().BeTrue();
        up.Value.Should().BeApproximately(0.6f, 0.0001f);

        host.Click(10.0f, 10.0f);
        host.Runtime.TryGetSnapshot(stepper, out UiControlSnapshot down).Should().BeTrue();
        down.Value.Should().BeApproximately(0.5f, 0.0001f);
        events.Count(UiControlEventKind.ValueChanged).Should().Be(2);
        events.Count(UiControlEventKind.ValueCommitted).Should().Be(2);
    }

    [Fact]
    public void ValueClampsAtBounds()
    {
        ControlHost host = Build(out UiControl stepper);
        host.Runtime.SetValue(stepper, 1.0f);

        host.Click(100.0f, 10.0f);

        host.Runtime.TryGetSnapshot(stepper, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(1.0f);

        host.Key(ControlKeys.Home).Should().BeTrue();
        host.Runtime.TryGetSnapshot(stepper, out UiControlSnapshot home).Should().BeTrue();
        home.Value.Should().Be(0.0f);
    }

    [Fact]
    public void DisabledStepperIgnoresClicks()
    {
        ControlHost host = Build(out UiControl stepper);
        host.Runtime.SetEnabled(stepper, false);
        host.Layout();

        host.Click(100.0f, 10.0f);

        host.Runtime.TryGetSnapshot(stepper, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().BeApproximately(0.5f, 0.0001f);
    }
}

public sealed class RatingTests
{
    private static ControlHost Build(out UiControl rating, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        rating = host.Create(ControlKind.Rating, max: 5.0f);
        host.Runtime.Mount(rating);
        host.Layout();
        return host;
    }

    [Fact]
    public void ClickingAStarSetsTheRating()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl rating = host.Create(ControlKind.Rating, max: 5.0f);
        host.Runtime.Mount(rating);
        host.Layout();

        host.Click(50.0f, 10.0f);

        host.Runtime.TryGetSnapshot(rating, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(3.0f);
        events.Count(UiControlEventKind.ValueChanged).Should().Be(1);
        events.Count(UiControlEventKind.ValueCommitted).Should().Be(1);
    }

    [Fact]
    public void KeyboardAdjustsRating()
    {
        ControlHost host = Build(out UiControl rating);
        host.Click(50.0f, 10.0f);

        host.Key(ControlKeys.Right).Should().BeTrue();
        host.Runtime.TryGetSnapshot(rating, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(4.0f);

        host.Key(ControlKeys.Left).Should().BeTrue();
        host.Key(ControlKeys.Left).Should().BeTrue();
        host.Key(ControlKeys.Left).Should().BeTrue();
        host.Key(ControlKeys.Left).Should().BeTrue();
        host.Runtime.TryGetSnapshot(rating, out UiControlSnapshot floor).Should().BeTrue();
        floor.Value.Should().Be(0.0f);
    }

    [Fact]
    public void SetValueClampsToMaximum()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl rating = host.Create(ControlKind.Rating, max: 5.0f);
        host.Runtime.Mount(rating);

        host.Runtime.SetValue(rating, 9.0f).Should().BeTrue();
        host.Runtime.SetValue(rating, 9.0f).Should().BeTrue();

        host.Runtime.TryGetSnapshot(rating, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(5.0f);
        events.Count(UiControlEventKind.ValueChanged).Should().Be(1);
    }
}

public sealed class SplitPaneTests
{
    private static ControlHost Build(out UiControl split, out UiControl left, out UiControl right)
    {
        var host = new ControlHost(new RecordingControlSink());
        split = host.Runtime.CreateControl(ControlKind.SplitPane, default);
        host.Runtime.Mount(split);
        left = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(left, split);
        right = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(right, split);
        host.Layout();
        return host;
    }

    [Fact]
    public void DraggingTheSplitterChangesTheRatioAndPanes()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl split = host.Runtime.CreateControl(ControlKind.SplitPane, default);
        host.Runtime.Mount(split);
        UiControl left = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(left, split);
        UiControl right = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(right, split);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 200.0f, 10.0f).Should().BeTrue();
        host.Pointer(UiPointerPhase.Move, 300.0f, 10.0f).Should().BeTrue();
        host.Pointer(UiPointerPhase.Up, 300.0f, 10.0f).Should().BeTrue();

        host.Runtime.TryGetSnapshot(split, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().BeApproximately(0.75f, 0.0001f);
        events.Count(UiControlEventKind.ValueCommitted).Should().Be(1);

        host.Layout();
        host.TryGetBounds(left, out Rect leftBox).Should().BeTrue();
        host.TryGetBounds(right, out Rect rightBox).Should().BeTrue();
        leftBox.Width.Should().BeApproximately(300.0f, 1.0f);
        rightBox.Width.Should().BeApproximately(100.0f, 1.0f);
    }

    [Fact]
    public void ClickAwayFromSplitterIsIgnored()
    {
        ControlHost host = Build(out UiControl split, out _, out _);

        host.Pointer(UiPointerPhase.Down, 50.0f, 10.0f).Should().BeFalse();

        host.Runtime.TryGetSnapshot(split, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().BeApproximately(0.5f, 0.0001f);
    }

    [Fact]
    public void KeyboardAdjustsTheRatio()
    {
        ControlHost host = Build(out UiControl split, out _, out _);
        host.Click(200.0f, 10.0f);

        host.Key(ControlKeys.Right).Should().BeTrue();

        host.Runtime.TryGetSnapshot(split, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().BeApproximately(0.52f, 0.0001f);
    }

    [Fact]
    public void SetValueClampsTheRatio()
    {
        ControlHost host = Build(out UiControl split, out _, out _);

        host.Runtime.SetValue(split, 5.0f).Should().BeTrue();

        host.Runtime.TryGetSnapshot(split, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().BeApproximately(0.85f, 0.0001f);
    }
}
