namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;
using FluentAssertions;
using Xunit;

public sealed class DataGridTests
{
    private static ControlHost Build(out UiControl grid, int rows = 100)
    {
        var host = new ControlHost(new RecordingControlSink());
        grid = host.Create(ControlKind.DataGrid, grid: new TestGridSource { RowCount = rows });
        host.Runtime.Mount(grid);
        host.Layout();
        return host;
    }

    [Fact]
    public void ClickSelectsCellByPosition()
    {
        ControlHost host = Build(out UiControl grid);

        host.Click(10.0f, 70.0f);

        host.Runtime.TryGetSnapshot(grid, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(2);
        snapshot.Column.Should().Be(0);
    }

    [Fact]
    public void ClickUsesCumulativeColumnWidths()
    {
        ControlHost host = Build(out UiControl grid);

        host.Click(50.0f, 10.0f);

        host.Runtime.TryGetSnapshot(grid, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
        snapshot.Column.Should().Be(1);
    }

    [Fact]
    public void KeyboardMovesAcrossRowsAndColumns()
    {
        ControlHost host = Build(out UiControl grid);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.Down).Should().BeTrue();
        host.Key(ControlKeys.Right).Should().BeTrue();
        host.Key(ControlKeys.End).Should().BeTrue();

        host.Runtime.TryGetSnapshot(grid, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(99);
        snapshot.Column.Should().Be(2);
    }

    [Fact]
    public void VirtualRangesCoverRowsAndColumns()
    {
        ControlHost host = Build(out UiControl grid);

        host.Runtime.TryGetVirtualRange(grid, out int firstRow, out int lastRow).Should().BeTrue();
        firstRow.Should().Be(0);
        lastRow.Should().Be(7);

        host.Runtime.TryGetVirtualColumnRange(grid, out int firstColumn, out int lastColumn).Should().BeTrue();
        firstColumn.Should().Be(0);
        lastColumn.Should().Be(2);
    }

    [Fact]
    public void EmptyGridHasNoVirtualRange()
    {
        ControlHost host = Build(out UiControl grid, rows: 0);

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetVirtualRange(grid, out _, out _).Should().BeFalse();
        host.Runtime.TryGetSnapshot(grid, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }

    [Fact]
    public void DisabledGridIgnoresPointer()
    {
        ControlHost host = Build(out UiControl grid);
        host.Runtime.SetEnabled(grid, false);
        host.Layout();

        host.Click(10.0f, 70.0f);

        host.Runtime.TryGetSnapshot(grid, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }
}

public sealed class DatePickerTests
{
    private static void ClickDay(ControlHost host, UiControl picker, int year, int month, int day)
    {
        host.TryGetBounds(picker, out Rect box).Should().BeTrue();
        float headerHeight = 28.0f;
        float cellWidth = box.Width / 7.0f;
        float cellHeight = (box.Height - headerHeight) / 6.0f;
        int leading = (int)new DateTime(year, month, 1).DayOfWeek;
        int index = leading + day - 1;
        int column = index % 7;
        int row = index / 7;
        host.Click(
            box.X + ((column + 0.5f) * cellWidth),
            box.Y + headerHeight + ((row + 0.5f) * cellHeight));
    }

    private static ControlHost Build(out UiControl picker, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        picker = host.Create(ControlKind.DatePicker, value: UiDateCodec.Pack(2026, 1, 1));
        host.Runtime.Mount(picker);
        host.Layout();
        return host;
    }

    [Fact]
    public void InitialDateComesFromTheDefinition()
    {
        ControlHost host = Build(out UiControl picker);

        host.Runtime.TryGetSnapshot(picker, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
        snapshot.Value.Should().Be(UiDateCodec.Pack(2026, 1, 1));
    }

    [Fact]
    public void ArrowKeysMoveDayAndCommit()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl picker = host.Create(ControlKind.DatePicker, value: UiDateCodec.Pack(2026, 1, 30));
        host.Runtime.Mount(picker);
        host.Layout();
        ClickDay(host, picker, 2026, 1, 30);

        host.Key(ControlKeys.Right).Should().BeTrue();

        host.Runtime.TryGetSnapshot(picker, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(UiDateCodec.Pack(2026, 1, 31));
        events.Count(UiControlEventKind.ValueChanged).Should().Be(1);
    }

    [Fact]
    public void PageKeysChangeMonthAndClampTheDay()
    {
        ControlHost host = Build(out UiControl picker);
        ClickDay(host, picker, 2026, 1, 1);
        host.Key(ControlKeys.End).Should().BeTrue();

        host.Key(ControlKeys.PageDown).Should().BeTrue();

        host.Runtime.TryGetSnapshot(picker, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(UiDateCodec.Pack(2026, 2, 28));
        snapshot.Index.Should().Be(28);
    }

    [Fact]
    public void HeaderClickNavigatesMonths()
    {
        ControlHost host = Build(out UiControl picker);

        host.Click(200.0f, 10.0f);

        host.Runtime.TryGetSnapshot(picker, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(UiDateCodec.Pack(2026, 2, 1));
    }

    [Fact]
    public void DisabledPickerIgnoresClicksAndKeys()
    {
        ControlHost host = Build(out UiControl picker);
        host.Runtime.SetEnabled(picker, false);
        host.Layout();

        host.Click(200.0f, 10.0f);
        host.Key(ControlKeys.Right);

        host.Runtime.TryGetSnapshot(picker, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(UiDateCodec.Pack(2026, 1, 1));
    }
}

public sealed class ColorPickerTests
{
    private static ControlHost Build(out UiControl picker, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        picker = host.Create(ControlKind.ColorPicker);
        host.Runtime.Mount(picker);
        host.Layout();
        return host;
    }

    [Fact]
    public void SaturationValueZoneUpdatesThePackedColor()
    {
        ControlHost host = Build(out UiControl picker);

        host.Click(75.0f, 80.0f);

        host.Runtime.TryGetSnapshot(picker, out UiControlSnapshot snapshot).Should().BeTrue();
        UiColorCodec.Unpack(snapshot.Index, out byte r, out byte g, out byte b, out byte a);
        r.Should().Be((byte)128);
        g.Should().Be((byte)64);
        b.Should().Be((byte)64);
        a.Should().Be((byte)255);
    }

    [Fact]
    public void AlphaBarUpdatesAlphaValue()
    {
        ControlHost host = Build(out UiControl picker);

        host.Click(190.0f, 80.0f);

        host.Runtime.TryGetSnapshot(picker, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().BeApproximately(0.5f, 0.01f);
        UiColorCodec.Unpack(snapshot.Index, out _, out _, out _, out byte a);
        a.Should().Be((byte)128);
    }

    [Fact]
    public void HomeKeyClearsAlpha()
    {
        ControlHost host = Build(out UiControl picker);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.Home).Should().BeTrue();

        host.Runtime.TryGetSnapshot(picker, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(0.0f);
    }
}

public sealed class NavigationBarTests
{
    private static ControlHost Build(out UiControl bar, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        bar = host.Create(ControlKind.NavigationBar, "Title");
        host.Runtime.Mount(bar);
        host.Layout();
        return host;
    }

    [Fact]
    public void BackZoneClickEmitsBack()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl bar = host.Create(ControlKind.NavigationBar, "Title");
        host.Runtime.Mount(bar);
        host.Layout();

        host.Click(10.0f, 10.0f);

        events.Count(UiControlEventKind.Back).Should().Be(1);
    }

    [Fact]
    public void TitleClickDoesNotEmitBack()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl bar = host.Create(ControlKind.NavigationBar, "Title");
        host.Runtime.Mount(bar);
        host.Layout();

        host.Click(200.0f, 10.0f);

        events.Count(UiControlEventKind.Back).Should().Be(0);
    }

    [Fact]
    public void EscapeEmitsBackWhenFocused()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl bar = host.Create(ControlKind.NavigationBar, "Title");
        host.Runtime.Mount(bar);
        host.Layout();
        host.Click(200.0f, 10.0f);

        host.Key(ControlKeys.Escape).Should().BeTrue();

        events.Count(UiControlEventKind.Back).Should().Be(1);
    }
}

public sealed class PageStackTests
{
    private static ControlHost Build(out UiControl stack, out UiControl[] pages)
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        stack = host.Runtime.CreateControl(ControlKind.PageStack, default);
        host.Runtime.Mount(stack);
        pages = new UiControl[3];
        for (int i = 0; i < pages.Length; i++)
        {
            pages[i] = host.Runtime.CreateControl(ControlKind.Panel, default);
            host.Runtime.Mount(pages[i], stack);
            host.Runtime.AddPage(stack, pages[i]);
        }

        host.Layout();
        return host;
    }

    private static bool IsVisible(ControlHost host, UiControl control) =>
        host.Runtime.Nodes.TryGetNode(control.Node, out UiNodeRecord record) && (record.Flags & UiNodeFlags.Visible) != 0;

    [Fact]
    public void FirstPageIsVisibleAndLaterPagesAreHidden()
    {
        ControlHost host = Build(out UiControl stack, out UiControl[] pages);

        IsVisible(host, pages[0]).Should().BeTrue();
        IsVisible(host, pages[1]).Should().BeFalse();
        host.Runtime.TryGetSnapshot(stack, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }

    [Fact]
    public void PushAndPopAdjustVisibilityAndHistory()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl stack = host.Runtime.CreateControl(ControlKind.PageStack, default);
        host.Runtime.Mount(stack);
        UiControl first = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(first, stack);
        UiControl second = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(second, stack);
        host.Runtime.AddPage(stack, first);
        host.Layout();

        host.Runtime.PushPage(stack, second).Should().BeTrue();
        host.Runtime.TryGetSnapshot(stack, out UiControlSnapshot pushed).Should().BeTrue();
        pushed.Index.Should().Be(1);
        IsVisible(host, second).Should().BeTrue();
        IsVisible(host, first).Should().BeFalse();

        host.Runtime.PopPage(stack).Should().BeTrue();
        host.Runtime.TryGetSnapshot(stack, out UiControlSnapshot popped).Should().BeTrue();
        popped.Index.Should().Be(0);
        IsVisible(host, first).Should().BeTrue();
        IsVisible(host, second).Should().BeFalse();
        events.Count(UiControlEventKind.Back).Should().Be(1);
    }

    [Fact]
    public void PopWithoutHistoryFails()
    {
        ControlHost host = Build(out UiControl stack, out _);

        host.Runtime.PopPage(stack).Should().BeFalse();
    }

    [Fact]
    public void EscapePopsWhenFocused()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl stack = host.Runtime.CreateControl(ControlKind.PageStack, default);
        host.Runtime.Mount(stack);
        UiControl first = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(first, stack);
        UiControl second = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(second, stack);
        host.Runtime.AddPage(stack, first);
        host.Runtime.PushPage(stack, second);
        host.Layout();
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.Escape).Should().BeTrue();

        host.Runtime.TryGetSnapshot(stack, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
        events.Count(UiControlEventKind.Back).Should().Be(1);
    }
}

public sealed class PageViewTests
{
    private static ControlHost Build(out UiControl view, out UiControl[] pages)
    {
        var host = new ControlHost(new RecordingControlSink());
        view = host.Runtime.CreateControl(ControlKind.PageView, default);
        host.Runtime.Mount(view);
        pages = new UiControl[3];
        for (int i = 0; i < pages.Length; i++)
        {
            pages[i] = host.Runtime.CreateControl(ControlKind.Panel, default);
            host.Runtime.Mount(pages[i]);
            host.Runtime.AddPage(view, pages[i]);
        }

        host.Layout();
        return host;
    }

    [Fact]
    public void SwipeLeftAdvancesThePage()
    {
        ControlHost host = Build(out UiControl view, out _);

        host.Pointer(UiPointerPhase.Down, 300.0f, 10.0f);
        host.Pointer(UiPointerPhase.Move, 200.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 200.0f, 10.0f);

        host.Runtime.TryGetSnapshot(view, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
    }

    [Fact]
    public void ShortSwipeDoesNotChangeThePage()
    {
        ControlHost host = Build(out UiControl view, out _);

        host.Pointer(UiPointerPhase.Down, 300.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 290.0f, 10.0f);

        host.Runtime.TryGetSnapshot(view, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }

    [Fact]
    public void KeyboardPagesAndClampsAtEnds()
    {
        ControlHost host = Build(out UiControl view, out _);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.Right).Should().BeTrue();
        host.Key(ControlKeys.End).Should().BeTrue();
        host.Key(ControlKeys.Right);

        host.Runtime.TryGetSnapshot(view, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(2);
    }

    [Fact]
    public void SwipeSelectionSwapsPageVisibility()
    {
        ControlHost host = Build(out UiControl view, out UiControl[] pages);

        host.Pointer(UiPointerPhase.Down, 300.0f, 10.0f);
        host.Pointer(UiPointerPhase.Up, 200.0f, 10.0f);

        host.Runtime.Nodes.TryGetNode(pages[0].Node, out UiNodeRecord first).Should().BeTrue();
        host.Runtime.Nodes.TryGetNode(pages[1].Node, out UiNodeRecord second).Should().BeTrue();
        (first.Flags & UiNodeFlags.Visible).Should().Be(UiNodeFlags.None);
        (second.Flags & UiNodeFlags.Visible).Should().NotBe(UiNodeFlags.None);
    }
}

public sealed class PopupTests
{
    private static ControlHost Build(out UiControl popup, out UiControl button, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        popup = host.Create(ControlKind.Popup, "Popup");
        host.Runtime.Mount(popup);
        host.Layout();
        return host;
    }

    [Fact]
    public void PopupStartsHiddenAndOpensOnDemand()
    {
        ControlHost host = Build(out UiControl popup, out _);
        host.Runtime.Nodes.TryGetNode(popup.Node, out UiNodeRecord hidden).Should().BeTrue();
        (hidden.Flags & UiNodeFlags.Visible).Should().Be(UiNodeFlags.None);

        host.Runtime.SetOpen(popup, true).Should().BeTrue();

        host.Runtime.Nodes.TryGetNode(popup.Node, out UiNodeRecord shown).Should().BeTrue();
        (shown.Flags & UiNodeFlags.Visible).Should().NotBe(UiNodeFlags.None);
    }

    [Fact]
    public void OutsideClickClosesThePopup()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        UiControl popup = host.Create(ControlKind.Popup, "Popup");
        host.Runtime.Mount(popup);
        host.Layout();
        host.Runtime.SetOpen(popup, true);
        host.Layout();
        events.Clear();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(popup, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeFalse();
        events.Count(UiControlEventKind.Click).Should().Be(1);
    }

    [Fact]
    public void ClickInsideKeepsThePopupOpen()
    {
        ControlHost host = Build(out UiControl popup, out UiControl button);
        host.Runtime.SetOpen(popup, true);
        host.Layout();

        host.Click(50.0f, 50.0f);

        host.Runtime.TryGetSnapshot(popup, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeTrue();
        host.Runtime.TryGetStyle(button.Node, out _).Should().BeTrue();
    }

    [Fact]
    public void EscapeClosesAFocusedPopup()
    {
        ControlHost host = Build(out UiControl popup, out _);
        host.Runtime.SetOpen(popup, true);
        host.Layout();
        host.Click(50.0f, 50.0f);
        host.Runtime.TryGetFocusedControl(out UiControl focused).Should().BeTrue();
        focused.Should().Be(popup);

        host.Key(ControlKeys.Escape).Should().BeTrue();

        host.Runtime.TryGetSnapshot(popup, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeFalse();
    }
}

public sealed class ImageFaceTests
{
    [Fact]
    public void ClickRaisesClickAndUsesIntrinsicSize()
    {
        var images = new TestImageMetrics();
        images.Set(new UiResourceId(9), 64.0f, 32.0f);
        var events = new RecordingControlSink();
        var host = new ControlHost(events, images);
        UiControl face = host.Create(ControlKind.ImageFace, image: new UiResourceId(9));
        host.Runtime.Mount(face);
        host.Layout();
        host.TryGetBounds(face, out Rect bounds).Should().BeTrue();
        bounds.Height.Should().Be(32.0f);

        host.Click(10.0f, 10.0f);

        events.Count(UiControlEventKind.Click).Should().Be(1);
    }

    [Fact]
    public void DisabledImageFaceIgnoresClicks()
    {
        var images = new TestImageMetrics();
        images.Set(new UiResourceId(9), 64.0f, 32.0f);
        var events = new RecordingControlSink();
        var host = new ControlHost(events, images);
        UiControl face = host.Create(ControlKind.ImageFace, image: new UiResourceId(9));
        host.Runtime.Mount(face);
        host.Layout();
        host.Runtime.SetEnabled(face, false);
        host.Layout();

        host.Click(10.0f, 10.0f);

        events.Count(UiControlEventKind.Click).Should().Be(0);
    }
}

public sealed class MenuBarTests
{
    private static ControlHost Build(out UiControl bar)
    {
        var host = new ControlHost(new RecordingControlSink());
        bar = host.Create(ControlKind.MenuBar, "A\nB\nC");
        host.Runtime.Mount(bar);
        host.Layout();
        return host;
    }

    [Fact]
    public void ClickSelectsTitleByPosition()
    {
        ControlHost host = Build(out UiControl bar);

        host.Click(40.0f, 10.0f);

        host.Runtime.TryGetSnapshot(bar, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
    }

    [Fact]
    public void KeyboardMovesSelection()
    {
        ControlHost host = Build(out UiControl bar);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.Right).Should().BeTrue();
        host.Key(ControlKeys.End).Should().BeTrue();

        host.Runtime.TryGetSnapshot(bar, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(2);
    }

    [Fact]
    public void DisabledBarIgnoresClicks()
    {
        ControlHost host = Build(out UiControl bar);
        host.Runtime.SetEnabled(bar, false);
        host.Layout();

        host.Click(40.0f, 10.0f);

        host.Runtime.TryGetSnapshot(bar, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(0);
    }
}

public sealed class AccordionTests
{
    private static ControlHost Build(out UiControl accordion, out UiControl content)
    {
        var host = new ControlHost(new RecordingControlSink());
        accordion = host.Create(ControlKind.Accordion, "Section");
        host.Runtime.Mount(accordion);
        content = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(content, accordion);
        UiControl label = host.Runtime.CreateControl(ControlKind.Label, new UiControlDefinition(Text: "Body"));
        host.Runtime.Mount(label, content);
        host.Layout();
        return host;
    }

    [Fact]
    public void HeaderClickExpandsAndCollapsesContent()
    {
        ControlHost host = Build(out UiControl accordion, out UiControl content);
        host.TryGetBounds(content, out Rect collapsed).Should().BeTrue();
        collapsed.Height.Should().Be(0.0f);

        host.Click(10.0f, 10.0f);
        host.Layout();
        host.Runtime.TryGetSnapshot(accordion, out UiControlSnapshot open).Should().BeTrue();
        open.IsOpen.Should().BeTrue();
        host.TryGetBounds(content, out Rect expanded).Should().BeTrue();
        expanded.Height.Should().BeGreaterThan(0.0f);

        host.Click(10.0f, 10.0f);
        host.Layout();
        host.TryGetBounds(content, out Rect closed).Should().BeTrue();
        closed.Height.Should().Be(0.0f);
    }

    [Fact]
    public void SpaceKeyTogglesTheSection()
    {
        ControlHost host = Build(out UiControl accordion, out _);
        host.Click(10.0f, 10.0f);
        host.Runtime.TryGetSnapshot(accordion, out UiControlSnapshot opened).Should().BeTrue();
        opened.IsOpen.Should().BeTrue();

        host.Key(ControlKeys.Space).Should().BeTrue();

        host.Runtime.TryGetSnapshot(accordion, out UiControlSnapshot closed).Should().BeTrue();
        closed.IsOpen.Should().BeFalse();
    }

    [Fact]
    public void ClickBelowHeaderDoesNotToggle()
    {
        ControlHost host = Build(out UiControl accordion, out _);
        host.Click(10.0f, 10.0f);
        host.Layout();

        host.Pointer(UiPointerPhase.Down, 10.0f, 200.0f);

        host.Runtime.TryGetSnapshot(accordion, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeTrue();
    }

    [Fact]
    public void DisabledAccordionIgnoresHeaderClicks()
    {
        ControlHost host = Build(out UiControl accordion, out _);
        host.Runtime.SetEnabled(accordion, false);
        host.Layout();

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetSnapshot(accordion, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.IsOpen.Should().BeFalse();
    }
}

public sealed class BreadcrumbTests
{
    private static ControlHost Build(out UiControl path)
    {
        var host = new ControlHost(new RecordingControlSink());
        path = host.Create(ControlKind.Breadcrumb, "A\nB\nC");
        host.Runtime.Mount(path);
        host.Layout();
        return host;
    }

    [Fact]
    public void ClickSelectsSegment()
    {
        ControlHost host = Build(out UiControl path);

        host.Click(40.0f, 10.0f);

        host.Runtime.TryGetSnapshot(path, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(1);
    }

    [Fact]
    public void EndKeySelectsLastSegment()
    {
        ControlHost host = Build(out UiControl path);
        host.Click(10.0f, 10.0f);

        host.Key(ControlKeys.End).Should().BeTrue();

        host.Runtime.TryGetSnapshot(path, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Index.Should().Be(2);
    }
}

public sealed class ChipTests
{
    private static ControlHost Build(out UiControl chip, IUiControlEventSink? events = null)
    {
        var host = new ControlHost(events ?? new RecordingControlSink());
        chip = host.Create(ControlKind.Chip, "Tag");
        host.Runtime.Mount(chip);
        host.Layout();
        return host;
    }

    [Fact]
    public void BodyClickReportsZoneZero()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl chip = host.Create(ControlKind.Chip, "Tag");
        host.Runtime.Mount(chip);
        host.Layout();

        host.Click(10.0f, 10.0f);

        events.Count(UiControlEventKind.Click).Should().Be(1);
        events.Last(UiControlEventKind.Click).Index.Should().Be(0);
    }

    [Fact]
    public void CloseZoneClickReportsZoneOne()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl chip = host.Create(ControlKind.Chip, "Tag");
        host.Runtime.Mount(chip);
        host.Layout();

        host.Click(35.0f, 10.0f);

        events.Count(UiControlEventKind.Click).Should().Be(1);
        events.Last(UiControlEventKind.Click).Index.Should().Be(1);
    }

    [Fact]
    public void DeleteKeyRequestsRemoval()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl chip = host.Create(ControlKind.Chip, "Tag");
        host.Runtime.Mount(chip);
        host.Layout();
        host.Click(10.0f, 10.0f);
        events.Clear();

        host.Key(ControlKeys.Delete).Should().BeTrue();

        events.Count(UiControlEventKind.Click).Should().Be(1);
        events.Last(UiControlEventKind.Click).Index.Should().Be(1);
    }

    [Fact]
    public void DisabledChipIgnoresClicks()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl chip = host.Create(ControlKind.Chip, "Tag");
        host.Runtime.Mount(chip);
        host.Layout();
        host.Runtime.SetEnabled(chip, false);
        host.Layout();

        host.Click(10.0f, 10.0f);

        events.Events.Should().BeEmpty();
    }
}

public sealed class BadgeTests
{
    [Fact]
    public void BadgeMeasuresItsTextAndStaysNonInteractive()
    {
        var host = new ControlHost();
        UiControl badge = host.Create(ControlKind.Badge, "New");
        host.Runtime.Mount(badge);
        host.Layout();
        host.TryGetBounds(badge, out Rect bounds).Should().BeTrue();
        bounds.Height.Should().Be(18.0f);

        host.Click(10.0f, 10.0f);

        host.Runtime.TryGetFocusedControl(out _).Should().BeFalse();
    }

    [Fact]
    public void BadgeWithoutTextKeepsItsFixedHeight()
    {
        var host = new ControlHost();
        UiControl badge = host.Create(ControlKind.Badge);
        host.Runtime.Mount(badge);
        host.Layout();

        host.TryGetBounds(badge, out Rect bounds).Should().BeTrue();
        bounds.Height.Should().Be(18.0f);
    }
}

public sealed class SpinnerTests
{
    [Fact]
    public void TickAdvancesThePhaseWhileOpen()
    {
        var host = new ControlHost();
        UiControl spinner = host.Create(ControlKind.Spinner);
        host.Runtime.Mount(spinner);
        host.Runtime.SetOpen(spinner, true).Should().BeTrue();

        host.Runtime.Update(0.25f);

        host.Runtime.TryGetSnapshot(spinner, out UiControlSnapshot quarter).Should().BeTrue();
        quarter.Value.Should().BeApproximately(0.25f, 0.0001f);

        host.Runtime.Update(1.0f);
        host.Runtime.TryGetSnapshot(spinner, out UiControlSnapshot wrapped).Should().BeTrue();
        wrapped.Value.Should().BeApproximately(0.25f, 0.0001f);
    }

    [Fact]
    public void ClosedSpinnerDoesNotAdvance()
    {
        var host = new ControlHost();
        UiControl spinner = host.Create(ControlKind.Spinner);
        host.Runtime.Mount(spinner);

        host.Runtime.Update(0.5f);

        host.Runtime.TryGetSnapshot(spinner, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.Value.Should().Be(0.0f);
    }
}
