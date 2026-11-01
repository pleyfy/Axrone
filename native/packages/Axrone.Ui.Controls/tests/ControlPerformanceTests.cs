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
