namespace Axrone.Ui.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class UiDirtyTrackerTests
{
    [Fact]
    public void FlagsAccumulatePerNodeWithoutDoubleCounting()
    {
        UiDirtyTracker tracker = new();
        UiNodeId node = new(3);

        tracker.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Layout));
        tracker.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Layout | UiInvalidationFlags.Style));

        tracker.LayoutDirty.Should().BeTrue();
        tracker.StructureDirty.Should().BeFalse();
        tracker.DirtyNodeCount.Should().Be(1);
        tracker.LayoutDirtyNodeCount.Should().Be(1);
        tracker.IsDirty(node, UiInvalidationFlags.Style).Should().BeTrue();
        tracker.GetFlags(node).Should().Be(UiInvalidationFlags.Layout | UiInvalidationFlags.Style);
    }

    [Fact]
    public void EmptyAndInvalidNotificationsAreIgnored()
    {
        UiDirtyTracker tracker = new();

        tracker.Invalidate(new UiInvalidation(UiNodeId.Invalid, UiInvalidationFlags.All));
        tracker.Invalidate(new UiInvalidation(new UiNodeId(1), UiInvalidationFlags.None));

        tracker.DirtyNodeCount.Should().Be(0);
        tracker.LayoutDirty.Should().BeFalse();
    }

    [Fact]
    public void ClearLayoutKeepsOtherChannels()
    {
        UiDirtyTracker tracker = new();
        UiNodeId node = new(4);
        tracker.Invalidate(new UiInvalidation(node, UiInvalidationFlags.Layout | UiInvalidationFlags.Content));

        tracker.ClearLayout(node);

        tracker.LayoutDirty.Should().BeFalse();
        tracker.DirtyNodeCount.Should().Be(1);
        tracker.IsDirty(node, UiInvalidationFlags.Content).Should().BeTrue();

        tracker.Clear();
        tracker.DirtyNodeCount.Should().Be(0);
        tracker.IsDirty(node, UiInvalidationFlags.Content).Should().BeFalse();
    }

    [Fact]
    public void SubtreeInvalidationMarksEveryDescendant()
    {
        StyleTree tree = new();
        UiDirtyTracker tracker = new();

        tracker.InvalidateSubtree(tree.Nodes, tree.Root, UiInvalidationFlags.Layout);

        tracker.LayoutDirtyNodeCount.Should().Be(3);
        tracker.IsDirty(tree.Child, UiInvalidationFlags.Layout).Should().BeTrue();
        tracker.IsDirty(tree.Grandchild, UiInvalidationFlags.Layout).Should().BeTrue();
    }

    [Fact]
    public void DirtyNodesCopyHonoursLayoutChannel()
    {
        UiDirtyTracker tracker = new();
        UiNodeId layoutNode = new(1);
        UiNodeId contentNode = new(2);
        tracker.Invalidate(new UiInvalidation(layoutNode, UiInvalidationFlags.Layout));
        tracker.Invalidate(new UiInvalidation(contentNode, UiInvalidationFlags.Content));

        Span<UiNodeId> destination = stackalloc UiNodeId[4];
        int written = tracker.CopyLayoutDirtyNodes(destination);

        written.Should().Be(1);
        destination[0].Should().Be(layoutNode);
    }

    private sealed class StyleTree
    {
        public StyleTree()
        {
            UiDocumentBuilder builder = new();
            Root = builder.CreateNode(UiNodeKind.Root, UiNodeFlags.Visible);
            Child = builder.CreateNode(UiNodeKind.Container, UiNodeFlags.Visible);
            Grandchild = builder.CreateNode(UiNodeKind.Text, UiNodeFlags.Visible);
            builder.TryAppendChild(Root, Child);
            builder.TryAppendChild(Child, Grandchild);
            Nodes = builder.Build(new UiDocumentInfo(new UiDocumentId(1), "dirty", 1, default)).Nodes;
        }

        public UiNodeId Root { get; }

        public UiNodeId Child { get; }

        public UiNodeId Grandchild { get; }

        public IUiNodeTree Nodes { get; }
    }
}

public sealed class UiLayoutRunnerTests
{
    private static readonly UiViewport Viewport = new(new UiSize(300.0f, 200.0f));

    [Fact]
    public void InitialRunLaysOutWholeTree()
    {
        DirtyHarness harness = new();
        harness.Freeze();

        int processed = harness.Runner.Run(in Viewport);

        processed.Should().BeGreaterThan(0);
        harness.Runner.TryGetBounds(harness.LeafB, out Rect leafBounds).Should().BeTrue();
        leafBounds.Width.Should().BeApproximately(30.0f, 0.0001f);
        harness.Runner.TryGetBounds(harness.Root, out Rect rootBounds).Should().BeTrue();
        rootBounds.Width.Should().BeApproximately(300.0f, 0.0001f);
        rootBounds.Height.Should().BeApproximately(200.0f, 0.0001f);
    }

    [Fact]
    public void DirtyLeafRelayoutsOnlyItsSubtree()
    {
        DirtyHarness harness = new();
        harness.Freeze();
        harness.Runner.Run(in Viewport);
        int before = harness.Content.MeasureCount;

        harness.Dirty.Invalidate(new UiInvalidation(harness.LeafA, UiInvalidationFlags.Layout));
        int processed = harness.Runner.Run(in Viewport);

        processed.Should().Be(1);
        (harness.Content.MeasureCount - before).Should().Be(1);
        harness.Runner.TryGetBounds(harness.LeafB, out Rect leafB).Should().BeTrue();
        leafB.Width.Should().BeApproximately(30.0f, 0.0001f);
    }

    [Fact]
    public void ContentGrowthEscalatesToParent()
    {
        DirtyHarness harness = new();
        harness.Freeze();
        harness.Runner.Run(in Viewport);

        harness.Content.Set(harness.LeafA, new UiSize(60.0f, 10.0f));
        harness.Dirty.Invalidate(new UiInvalidation(harness.LeafA, UiInvalidationFlags.Layout));
        harness.Runner.Run(in Viewport);

        harness.Runner.TryGetBounds(harness.LeafA, out Rect leafA).Should().BeTrue();
        leafA.Width.Should().BeApproximately(60.0f, 0.0001f);
        harness.Runner.TryGetBounds(harness.PanelA, out Rect panel).Should().BeTrue();
        panel.Width.Should().BeApproximately(100.0f, 0.0001f);
    }

    [Fact]
    public void NonLayoutInvalidationDoesNotRelayout()
    {
        DirtyHarness harness = new();
        harness.Freeze();
        harness.Runner.Run(in Viewport);
        int before = harness.Content.MeasureCount;

        harness.Dirty.Invalidate(new UiInvalidation(harness.LeafA, UiInvalidationFlags.Content));
        int processed = harness.Runner.Run(in Viewport);

        processed.Should().Be(0);
        harness.Content.MeasureCount.Should().Be(before);
    }

    [Fact]
    public void StructureInvalidationPropagatesLayoutToDescendants()
    {
        DirtyHarness harness = new();
        harness.Freeze();
        harness.Runner.Run(in Viewport);

        harness.Runner.Invalidate(new UiInvalidation(harness.PanelA, UiInvalidationFlags.Structure));

        harness.Dirty.IsDirty(harness.PanelA, UiInvalidationFlags.Layout).Should().BeTrue();
        harness.Dirty.IsDirty(harness.LeafA, UiInvalidationFlags.Layout).Should().BeTrue();
        harness.Runner.Run(in Viewport).Should().Be(1);
    }

    [Fact]
    public void RepeatedRunsAreDeterministic()
    {
        DirtyHarness first = new();
        DirtyHarness second = new();
        first.Freeze();
        second.Freeze();
        first.Runner.Run(in Viewport);
        second.Runner.Run(in Viewport);

        foreach (UiNodeId node in new[] { first.Root, first.PanelA, first.LeafA, first.LeafB })
        {
            first.Runner.TryGetBounds(node, out Rect a).Should().BeTrue();
            second.Runner.TryGetBounds(node, out Rect b).Should().BeTrue();
            a.X.Should().Be(b.X);
            a.Y.Should().Be(b.Y);
            a.Width.Should().Be(b.Width);
            a.Height.Should().Be(b.Height);
        }
    }

    [Fact]
    public void SteadyStateRelayoutAllocatesNothing()
    {
        DirtyHarness harness = new();
        harness.Freeze();

        for (int i = 0; i < 4; i++)
        {
            harness.Dirty.Invalidate(new UiInvalidation(harness.LeafA, UiInvalidationFlags.Layout));
            harness.Runner.Run(in Viewport);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            harness.Dirty.Invalidate(new UiInvalidation(harness.LeafA, UiInvalidationFlags.Layout));
            harness.Runner.Run(in Viewport);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
    }

    private sealed class DirtyHarness
    {
        private readonly LayoutHarness _layout = new();

        public DirtyHarness()
        {
            UiLayoutStyle rootStyle = new()
            {
                Direction = UiAxis.Row,
                AlignItems = UiAlign.Start,
                Gap = 4.0f,
                Width = UiLength.Px(200.0f),
                Height = UiLength.Px(100.0f),
            };
            Root = _layout.AddRoot(rootStyle);
            PanelA = _layout.AddContainer(Root, new UiLayoutStyle
            {
                Direction = UiAxis.Column,
                AlignItems = UiAlign.Start,
                Width = UiLength.Px(100.0f),
            });
            LeafA = _layout.AddLeaf(PanelA, UiLayoutStyle.Default, new UiSize(20.0f, 10.0f));
            LeafB = _layout.AddLeaf(Root, UiLayoutStyle.Default, new UiSize(30.0f, 10.0f));
        }

        public UiNodeId Root { get; }

        public UiNodeId PanelA { get; }

        public UiNodeId LeafA { get; }

        public UiNodeId LeafB { get; }

        public FakeContentMeasurer Content => _layout.Content;

        public UiDirtyTracker Dirty { get; } = new();

        public UiLayoutRunner Runner { get; private set; } = null!;

        public void Freeze()
        {
            _layout.Freeze();
            Runner = new UiLayoutRunner(_layout.Tree.Nodes, _layout.Tree, _layout.Engine, _layout.Sink, Dirty);
        }
    }
}
