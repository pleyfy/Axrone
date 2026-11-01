namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using Axrone.Ui.Input;
using FluentAssertions;
using Xunit;

public sealed class ControlAllocationTests
{
    [Fact]
    public void StateUpdatesDoNotAllocateAfterWarmup()
    {
        var sink = new CountingControlSink();
        var host = new ControlHost(sink);
        UiControl checkbox = host.Create(ControlKind.Checkbox, "Check");
        host.Runtime.Mount(checkbox);
        host.Layout();
        for (int warmup = 0; warmup < 128; warmup++)
        {
            host.Runtime.SetChecked(checkbox, (warmup & 1) == 0);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int applied = 0;
        for (int round = 0; round < 2000; round++)
        {
            if (host.Runtime.SetChecked(checkbox, (round & 1) == 0))
            {
                applied++;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        applied.Should().Be(2000);
        sink.Count.Should().BeGreaterThan(0);
    }

    [Fact]
    public void PointerDispatchDoesNotAllocateAfterWarmup()
    {
        var sink = new CountingControlSink();
        var host = new ControlHost(sink);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();
        for (int warmup = 0; warmup < 128; warmup++)
        {
            host.Click(10.0f, 10.0f);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int handled = 0;
        for (int round = 0; round < 500; round++)
        {
            if (host.Pointer(UiPointerPhase.Move, 10.0f, 10.0f))
            {
                handled++;
            }

            if (host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f))
            {
                handled++;
            }

            if (host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f))
            {
                handled++;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        handled.Should().Be(1000);
        sink.Clicks.Should().BeGreaterThanOrEqualTo(500);
    }

    [Fact]
    public void VirtualizedListDispatchAndRangeDoNotAllocateAfterWarmup()
    {
        var sink = new CountingControlSink();
        var host = new ControlHost(sink);
        UiControl list = host.Create(ControlKind.ListView, items: new TestListSource { Count = 10000 });
        host.Runtime.Mount(list);
        host.Layout();
        _ = host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f);
        _ = host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f);
        for (int warmup = 0; warmup < 128; warmup++)
        {
            _ = host.Pointer(UiPointerPhase.Move, 10.0f, 10.0f);
            _ = host.Key(ControlKeys.Down);
            _ = host.Runtime.TryGetVirtualRange(list, out _, out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int ranges = 0;
        for (int round = 0; round < 500; round++)
        {
            _ = host.Pointer(UiPointerPhase.Move, 10.0f, 10.0f);
            _ = host.Key(ControlKeys.Down);
            if (host.Runtime.TryGetVirtualRange(list, out int first, out int last) && first <= last)
            {
                ranges++;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        ranges.Should().Be(500);
        sink.Count.Should().BeGreaterThan(0);
    }

    [Fact]
    public void SnapshotAndNodeLookupsDoNotAllocateAfterWarmup()
    {
        var host = new ControlHost();
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();
        for (int warmup = 0; warmup < 128; warmup++)
        {
            _ = host.Runtime.TryGetSnapshot(button, out _);
            _ = host.Runtime.TryGetControl(button.Node, out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int reads = 0;
        for (int round = 0; round < 2000; round++)
        {
            if (host.Runtime.TryGetSnapshot(button, out UiControlSnapshot snapshot) && snapshot.Kind == ControlKind.Button)
            {
                reads++;
            }

            if (host.Runtime.TryGetControl(button.Node, out UiControl resolved) && resolved == button)
            {
                reads++;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        reads.Should().Be(4000);
    }
}

public sealed class ControlDeterminismTests
{
    private static List<string> RunScript(out Rect[] bounds)
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl panel = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(panel);
        UiControl checkbox = host.Create(ControlKind.Checkbox, "Toggle", panel);
        UiControl slider = host.Create(ControlKind.Slider, parent: panel);
        UiControl dropdown = host.Create(ControlKind.Dropdown, "A\nB\nC", panel);
        host.Layout();
        host.Click(10.0f, 10.0f);
        host.Pointer(UiPointerPhase.Down, 120.0f, 70.0f);
        host.Pointer(UiPointerPhase.Up, 120.0f, 70.0f);
        host.Key(ControlKeys.Enter);
        host.Click(10.0f, 120.0f);
        host.Layout();
        host.Key(ControlKeys.Down);
        host.Key(ControlKeys.Enter);

        bounds = new Rect[3];
        host.TryGetBounds(checkbox, out bounds[0]).Should().BeTrue();
        host.TryGetBounds(slider, out bounds[1]).Should().BeTrue();
        host.TryGetBounds(dropdown, out bounds[2]).Should().BeTrue();

        var lines = new List<string>(events.Events.Count);
        for (int i = 0; i < events.Events.Count; i++)
        {
            UiControlEvent e = events.Events[i];
            lines.Add($"{e.Kind}|{e.EventKind}|{e.Value:F3}|{e.Checked}|{e.Index}|{e.Text}");
        }

        return lines;
    }

    [Fact]
    public void IdenticalScriptsProduceIdenticalEventsAndBounds()
    {
        List<string> first = RunScript(out Rect[] firstBounds);
        List<string> second = RunScript(out Rect[] secondBounds);

        first.Should().NotBeEmpty();
        first.Should().Equal(second);
        secondBounds.Should().Equal(firstBounds);
    }

    private static List<string> RunExtendedScript(out Rect[] bounds)
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl tabs = host.Create(ControlKind.TabView, "A" + (char)10 + "B" + (char)10 + "C");
        host.Runtime.Mount(tabs);
        for (int i = 0; i < 3; i++)
        {
            UiControl page = host.Runtime.CreateControl(ControlKind.Panel, default);
            host.Runtime.Mount(page);
            host.Runtime.AddPage(tabs, page);
        }

        UiControl list = host.Create(ControlKind.ListView, items: new TestListSource { Count = 50 });
        host.Runtime.Mount(list);
        UiControl tree = host.Create(ControlKind.TreeView, tree: new TestTreeSource());
        host.Runtime.Mount(tree);
        UiControl split = host.Runtime.CreateControl(ControlKind.SplitPane, default);
        host.Runtime.Mount(split);
        host.Runtime.Mount(host.Runtime.CreateControl(ControlKind.Panel, default), split);
        host.Runtime.Mount(host.Runtime.CreateControl(ControlKind.Panel, default), split);
        host.Layout();

        host.Click(40.0f, 10.0f);
        host.Click(10.0f, 70.0f);
        host.Click(100.0f, 250.0f);
        host.Key(ControlKeys.Right);
        host.Pointer(UiPointerPhase.Down, 200.0f, 470.0f);
        host.Pointer(UiPointerPhase.Move, 300.0f, 470.0f);
        host.Pointer(UiPointerPhase.Up, 300.0f, 470.0f);
        host.Layout();

        bounds = new Rect[4];
        host.TryGetBounds(tabs, out bounds[0]).Should().BeTrue();
        host.TryGetBounds(list, out bounds[1]).Should().BeTrue();
        host.TryGetBounds(tree, out bounds[2]).Should().BeTrue();
        host.TryGetBounds(split, out bounds[3]).Should().BeTrue();

        var lines = new List<string>(events.Events.Count);
        for (int i = 0; i < events.Events.Count; i++)
        {
            UiControlEvent e = events.Events[i];
            lines.Add($"{e.Kind}|{e.EventKind}|{e.Value:F3}|{e.Checked}|{e.Index}|{e.Text}");
        }

        return lines;
    }

    [Fact]
    public void ExtendedCatalogScriptIsDeterministic()
    {
        List<string> first = RunExtendedScript(out Rect[] firstBounds);
        List<string> second = RunExtendedScript(out Rect[] secondBounds);

        first.Should().NotBeEmpty();
        first.Should().Equal(second);
        secondBounds.Should().Equal(firstBounds);
    }

    [Fact]
    public void DataGridDispatchAndRangesDoNotAllocateAfterWarmup()
    {
        var sink = new CountingControlSink();
        var host = new ControlHost(sink);
        UiControl grid = host.Create(ControlKind.DataGrid, grid: new TestGridSource { RowCount = 10000 });
        host.Runtime.Mount(grid);
        host.Layout();
        _ = host.Pointer(UiPointerPhase.Down, 10.0f, 10.0f);
        _ = host.Pointer(UiPointerPhase.Up, 10.0f, 10.0f);
        for (int warmup = 0; warmup < 128; warmup++)
        {
            _ = host.Pointer(UiPointerPhase.Move, 10.0f, 10.0f);
            _ = host.Key(ControlKeys.Down);
            _ = host.Key(ControlKeys.Right);
            _ = host.Runtime.TryGetVirtualRange(grid, out _, out _);
            _ = host.Runtime.TryGetVirtualColumnRange(grid, out _, out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int ranges = 0;
        for (int round = 0; round < 500; round++)
        {
            _ = host.Pointer(UiPointerPhase.Move, 10.0f, 10.0f);
            _ = host.Key(ControlKeys.Down);
            _ = host.Key(ControlKeys.Right);
            if (host.Runtime.TryGetVirtualRange(grid, out int first, out int last) && first <= last)
            {
                ranges++;
            }

            if (host.Runtime.TryGetVirtualColumnRange(grid, out int firstColumn, out int lastColumn) &&
                firstColumn <= lastColumn)
            {
                ranges++;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        ranges.Should().Be(1000);
        sink.Count.Should().BeGreaterThan(0);
    }

    [Fact]
    public void CatalogCompletionScriptIsDeterministic()
    {
        List<string> first = RunCompletionScript(out Rect[] firstBounds);
        List<string> second = RunCompletionScript(out Rect[] secondBounds);

        first.Should().NotBeEmpty();
        first.Should().Equal(second);
        secondBounds.Should().Equal(firstBounds);
    }

    private static List<string> RunCompletionScript(out Rect[] bounds)
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl grid = host.Create(ControlKind.DataGrid, grid: new TestGridSource { RowCount = 50 });
        host.Runtime.Mount(grid);
        UiControl picker = host.Create(ControlKind.DatePicker, value: UiDateCodec.Pack(2026, 1, 1));
        host.Runtime.Mount(picker);
        UiControl stack = host.Runtime.CreateControl(ControlKind.PageStack, default);
        host.Runtime.Mount(stack);
        UiControl firstPage = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(firstPage, stack);
        UiControl secondPage = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(secondPage, stack);
        host.Runtime.AddPage(stack, firstPage);
        host.Runtime.PushPage(stack, secondPage);
        host.Layout();

        host.Click(10.0f, 10.0f);
        host.Key(ControlKeys.Down);
        host.Key(ControlKeys.Right);
        host.Click(200.0f, 300.0f);
        host.Key(ControlKeys.PageDown);
        host.Click(10.0f, 380.0f);
        host.Key(ControlKeys.Escape);
        host.Layout();

        bounds = new Rect[3];
        host.TryGetBounds(grid, out bounds[0]).Should().BeTrue();
        host.TryGetBounds(picker, out bounds[1]).Should().BeTrue();
        host.TryGetBounds(stack, out bounds[2]).Should().BeTrue();

        var lines = new List<string>(events.Events.Count);
        for (int i = 0; i < events.Events.Count; i++)
        {
            UiControlEvent e = events.Events[i];
            lines.Add($"{e.Kind}|{e.EventKind}|{e.Value:F3}|{e.Checked}|{e.Index}|{e.Text}");
        }

        return lines;
    }

    [Fact]
    public void RepeatedClicksProduceStableEventSequences()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();

        for (int round = 0; round < 5; round++)
        {
            host.Click(10.0f, 10.0f);
        }

        events.Count(UiControlEventKind.Click).Should().Be(5);
        events.Events.Should().OnlyContain(e =>
            e.EventKind == UiControlEventKind.Click || e.EventKind == UiControlEventKind.FocusChanged);
    }
}
