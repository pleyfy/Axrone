namespace Axrone.Ui.Controls.Tests;

using Axrone.Numeric;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class ControlCatalogTests
{
    [Fact]
    public void CatalogCoversEveryKindWithMatchingBehavior()
    {
        ControlCatalog.Count.Should().Be(12);

        for (int i = 0; i < ControlCatalog.Count; i++)
        {
            ControlKind kind = ControlCatalog.GetKind(i);
            ControlCatalog.Contains(kind).Should().BeTrue();
            ControlCatalog.TryGet(kind, out ControlBehavior behavior).Should().BeTrue();
            behavior.Kind.Should().Be(kind);
        }

        ControlCatalog.Contains((ControlKind)12).Should().BeFalse();
        ControlCatalog.Contains((ControlKind)200).Should().BeFalse();
        ControlCatalog.TryGet((ControlKind)200, out _).Should().BeFalse();
    }

    [Fact]
    public void CatalogLookupDoesNotAllocateAfterWarmup()
    {
        var kinds = new ControlKind[ControlCatalog.Count];
        for (int i = 0; i < kinds.Length; i++)
        {
            kinds[i] = ControlCatalog.GetKind(i);
        }

        for (int warmup = 0; warmup < 256; warmup++)
        {
            for (int i = 0; i < kinds.Length; i++)
            {
                _ = ControlCatalog.TryGet(kinds[i], out _);
            }
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int hits = 0;
        for (int round = 0; round < 1000; round++)
        {
            for (int i = 0; i < kinds.Length; i++)
            {
                if (ControlCatalog.TryGet(kinds[i], out ControlBehavior behavior))
                {
                    hits += (int)behavior.Kind;
                }
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        hits.Should().Be(1000 * 66);
    }
}

public sealed class ControlRuntimeTests
{
    [Fact]
    public void CreatedControlStaysDetachedUntilMounted()
    {
        var host = new ControlHost();
        UiControl button = host.Create(ControlKind.Button, "OK");

        host.Runtime.Nodes.Count.Should().Be(2);
        host.Runtime.Nodes.GetChildren(host.Runtime.Root).Length.Should().Be(0);
        host.Runtime.TryGetControl(button.Node, out UiControl resolved).Should().BeTrue();
        resolved.Should().Be(button);
        host.Runtime.TryGetSnapshot(button, out UiControlSnapshot created).Should().BeTrue();
        created.State.Should().Be(UiControlState.Normal);

        host.Runtime.Mount(button).Should().BeTrue();
        host.Runtime.Nodes.GetChildren(host.Runtime.Root).Length.Should().Be(1);
        host.Runtime.Mount(button).Should().BeFalse();

        host.Layout();
        host.TryGetBounds(button, out Rect bounds).Should().BeTrue();
        bounds.Height.Should().Be(36.0f);
        bounds.Width.Should().Be(400.0f);
    }

    [Fact]
    public void ControlsMountUnderParentsAndInheritFlow()
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
        secondBox.Y.Should().BeGreaterThan(firstBox.Y + firstBox.Height);
        secondBox.X.Should().Be(8.0f);
    }

    [Fact]
    public void DestroyRemovesSubtreeAndRejectsHandles()
    {
        var host = new ControlHost();
        UiControl panel = host.Runtime.CreateControl(ControlKind.Panel, default);
        host.Runtime.Mount(panel);
        UiControl first = host.Create(ControlKind.Button, "A", panel);
        UiControl second = host.Create(ControlKind.Button, "B", panel);
        host.Layout();
        host.Runtime.Nodes.Count.Should().Be(4);

        host.Runtime.DestroyControl(panel).Should().BeTrue();

        host.Runtime.Nodes.Count.Should().Be(1);
        host.Runtime.TryGetSnapshot(panel, out _).Should().BeFalse();
        host.Runtime.TryGetSnapshot(first, out _).Should().BeFalse();
        host.Runtime.TryGetSnapshot(second, out _).Should().BeFalse();
        host.Runtime.TryGetControl(panel.Node, out _).Should().BeFalse();
        host.Runtime.DestroyControl(panel).Should().BeFalse();
    }

    [Fact]
    public void DestroyingFocusedControlClearsFocus()
    {
        var host = new ControlHost();
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();
        host.Click(10.0f, 10.0f);
        host.Runtime.TryGetFocusedControl(out UiControl focused).Should().BeTrue();
        focused.Should().Be(button);

        host.Runtime.DestroyControl(button).Should().BeTrue();

        host.Runtime.TryGetFocusedControl(out _).Should().BeFalse();
    }

    [Fact]
    public void RecycledControlSlotRejectsStaleHandle()
    {
        var host = new ControlHost();
        UiControl first = host.Create(ControlKind.Label, "One");
        host.Runtime.Mount(first);
        uint generation = first.Generation;
        host.Runtime.DestroyControl(first).Should().BeTrue();

        UiControl second = host.Create(ControlKind.Label, "Two");
        host.Runtime.Mount(second);

        second.Index.Should().Be(first.Index);
        second.Generation.Should().NotBe(generation);
        host.Runtime.TryGetSnapshot(first, out _).Should().BeFalse();
        host.Runtime.TryGetSnapshot(second, out _).Should().BeTrue();
    }

    [Fact]
    public void DisabledControlIsNeitherHitTestedNorInteracted()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();

        host.Runtime.SetEnabled(button, false).Should().BeTrue();
        host.Layout();
        host.Click(10.0f, 10.0f);

        events.Count(UiControlEventKind.Click).Should().Be(0);
        host.Runtime.TryGetFocusedControl(out _).Should().BeFalse();
        host.Runtime.TryGetSnapshot(button, out UiControlSnapshot snapshot).Should().BeTrue();
        snapshot.State.Should().Be(UiControlState.Disabled);

        host.Runtime.SetEnabled(button, true).Should().BeTrue();
        host.Layout();
        host.Click(10.0f, 10.0f);
        events.Count(UiControlEventKind.Click).Should().Be(1);
    }

    [Fact]
    public void HiddenControlIsNotHitTested()
    {
        var events = new RecordingControlSink();
        var host = new ControlHost(events);
        UiControl button = host.Create(ControlKind.Button, "OK");
        host.Runtime.Mount(button);
        host.Layout();
        host.Runtime.SetVisible(button, false);
        host.Layout();

        host.Click(10.0f, 10.0f);

        events.Count(UiControlEventKind.Click).Should().Be(0);
    }

    [Fact]
    public void EveryKindCanBeCreatedMountedAndLaidOut()
    {
        var images = new TestImageMetrics();
        images.Set(new UiResourceId(7), 64.0f, 32.0f);
        var host = new ControlHost(images: images);

        for (int i = 0; i < ControlCatalog.Count; i++)
        {
            ControlKind kind = ControlCatalog.GetKind(i);
            var definition = new UiControlDefinition(
                Text: kind is ControlKind.Dropdown or ControlKind.RadioGroup ? "A\nB\nC" : "Sample",
                Image: new UiResourceId(7),
                Value: 0.5f,
                MinValue: 0.0f,
                MaxValue: 1.0f,
                Step: 0.1f);
            UiControl control = host.Runtime.CreateControl(kind, in definition);
            host.Runtime.Mount(control).Should().BeTrue($"{kind} should mount");
            host.Runtime.TryGetSnapshot(control, out UiControlSnapshot snapshot).Should().BeTrue();
            snapshot.Kind.Should().Be(kind);
        }

        host.Layout();

        for (int i = 0; i < ControlCatalog.Count; i++)
        {
            UiControl control = host.Runtime.CreateControl(ControlKind.Label, new UiControlDefinition(Text: "probe"));
            host.Runtime.Mount(control);
            host.Runtime.DestroyControl(control);
        }
    }

    [Fact]
    public void DisposeIsIdempotentAndBlocksCreation()
    {
        var host = new ControlHost();
        host.Runtime.Dispose();
        host.Runtime.Dispose();

        FluentActions.Invoking(() => host.Create(ControlKind.Button, "OK"))
            .Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void UnregisteredKindIsRejectedAtCreation()
    {
        var host = new ControlHost();

        FluentActions.Invoking(() => host.Runtime.CreateControl((ControlKind)99, default))
            .Should().Throw<ArgumentOutOfRangeException>();
    }
}
