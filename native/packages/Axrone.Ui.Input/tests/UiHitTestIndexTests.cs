namespace Axrone.Ui.Input.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiHitTestIndexTests
{
    private static Aabb2D Box(float minX, float minY, float maxX, float maxY) => new(minX, minY, maxX, maxY);

    [Fact]
    public void HitTestReturnsNodeWithHighestZIndex()
    {
        var index = new UiHitTestIndex();
        var low = new UiNodeId(1);
        var high = new UiNodeId(2);
        index.Insert(low, Box(0f, 0f, 100f, 50f), zIndex: 0, clips: false);
        index.Insert(high, Box(0f, 0f, 100f, 50f), zIndex: 5, clips: false);

        index.TryHitTest(new Vec2(10f, 10f), out UiHitResult result).Should().BeTrue();

        result.Node.Should().Be(high);
        result.ZIndex.Should().Be(5);
    }

    [Fact]
    public void HitTestPrefersLaterInsertionWhenZIndexTies()
    {
        var index = new UiHitTestIndex();
        var first = new UiNodeId(1);
        var second = new UiNodeId(2);
        index.Insert(first, Box(0f, 0f, 100f, 50f), zIndex: 2, clips: false);
        index.Insert(second, Box(0f, 0f, 100f, 50f), zIndex: 2, clips: false);

        index.TryHitTest(new Vec2(10f, 10f), out UiHitResult result).Should().BeTrue();

        result.Node.Should().Be(second);
    }

    [Fact]
    public void HitTestMissesPointOutsideEveryBox()
    {
        var index = new UiHitTestIndex();
        index.Insert(new UiNodeId(1), Box(0f, 0f, 100f, 50f), zIndex: 0, clips: false);

        index.TryHitTest(new Vec2(101f, 10f), out UiHitResult result).Should().BeFalse();
        result.Node.Should().Be(UiNodeId.Invalid);
    }

    [Fact]
    public void HitTestTreatsBoundaryPointAsInside()
    {
        var index = new UiHitTestIndex();
        var node = new UiNodeId(1);
        index.Insert(node, Box(0f, 0f, 100f, 50f), zIndex: 0, clips: false);

        index.TryHitTest(new Vec2(100f, 50f), out UiHitResult result).Should().BeTrue();

        result.Node.Should().Be(node);
    }

    [Fact]
    public void HitTestReportsLocalPointRelativeToBoxOrigin()
    {
        var index = new UiHitTestIndex();
        index.Insert(new UiNodeId(1), Box(10f, 20f, 110f, 70f), zIndex: 0, clips: false);

        index.TryHitTest(new Vec2(30f, 40f), out UiHitResult result).Should().BeTrue();

        result.LocalPoint.Should().Be(new Vec2(20f, 20f));
    }

    [Fact]
    public void ClipResolverExcludesPointOutsideClippingAncestor()
    {
        var tree = new TestTree();
        var panel = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        var button = tree.Add(panel, UiNodeKind.Button, UiNodeFlags.Visible | UiNodeFlags.Interactive);
        var bounds = new TestBounds();
        bounds.Set(panel, 0f, 0f, 40f, 100f);
        bounds.Set(button, 0f, 0f, 100f, 100f);
        var index = new UiHitTestIndex(8, new UiTreeClipResolver(tree, bounds));
        index.Insert(button, Box(0f, 0f, 100f, 100f), zIndex: 0, clips: false);

        index.TryHitTest(new Vec2(60f, 10f), out _).Should().BeFalse();

        index.TryHitTest(new Vec2(10f, 10f), out UiHitResult inside).Should().BeTrue();
        inside.Node.Should().Be(button);
        inside.HasClip.Should().BeTrue();
        inside.ClipBounds.Width.Should().Be(40f);
    }

    [Fact]
    public void ClippingNodeReportsItsOwnBoxAsClipWithoutResolver()
    {
        var index = new UiHitTestIndex();
        var node = new UiNodeId(1);
        index.Insert(node, Box(0f, 0f, 100f, 50f), zIndex: 0, clips: true);

        index.TryHitTest(new Vec2(10f, 10f), out UiHitResult result).Should().BeTrue();

        result.HasClip.Should().BeTrue();
        result.ClipBounds.Width.Should().Be(100f);
        result.ClipBounds.Height.Should().Be(50f);
    }

    [Fact]
    public void ClippingNodeIntersectsOwnBoxWithAncestorClip()
    {
        var tree = new TestTree();
        var panel = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        var node = tree.Add(panel, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        var bounds = new TestBounds();
        bounds.Set(panel, 0f, 0f, 60f, 40f);
        bounds.Set(node, 0f, 0f, 100f, 100f);
        var index = new UiHitTestIndex(8, new UiTreeClipResolver(tree, bounds));
        index.Insert(node, Box(0f, 0f, 100f, 100f), zIndex: 0, clips: true);

        index.TryHitTest(new Vec2(70f, 10f), out _).Should().BeFalse();

        index.TryHitTest(new Vec2(50f, 10f), out UiHitResult result).Should().BeTrue();
        result.ClipBounds.Width.Should().Be(60f);
        result.ClipBounds.Height.Should().Be(40f);
    }

    [Fact]
    public void UpdateMovesTheHitArea()
    {
        var index = new UiHitTestIndex();
        var node = new UiNodeId(1);
        index.Insert(node, Box(0f, 0f, 10f, 10f), zIndex: 0, clips: false);

        index.Update(node, Box(50f, 50f, 60f, 60f)).Should().BeTrue();

        index.TryHitTest(new Vec2(5f, 5f), out _).Should().BeFalse();
        index.TryHitTest(new Vec2(55f, 55f), out UiHitResult result).Should().BeTrue();
        result.Node.Should().Be(node);
    }

    [Fact]
    public void RemoveStopsHitsAndShrinksCount()
    {
        var index = new UiHitTestIndex();
        var node = new UiNodeId(1);
        index.Insert(node, Box(0f, 0f, 10f, 10f), zIndex: 0, clips: false);

        index.Remove(node).Should().BeTrue();
        index.Count.Should().Be(0);
        index.TryHitTest(new Vec2(5f, 5f), out _).Should().BeFalse();
        index.Remove(node).Should().BeFalse();
    }

    [Fact]
    public void DuplicateInsertReplacesInsteadOfStacking()
    {
        var index = new UiHitTestIndex();
        var node = new UiNodeId(1);
        index.Insert(node, Box(0f, 0f, 10f, 10f), zIndex: 0, clips: false);
        index.Insert(node, Box(100f, 100f, 110f, 110f), zIndex: 0, clips: false);

        index.Count.Should().Be(1);
        index.TryHitTest(new Vec2(5f, 5f), out _).Should().BeFalse();
        index.TryHitTest(new Vec2(105f, 105f), out UiHitResult result).Should().BeTrue();
        result.Node.Should().Be(node);
    }

    [Fact]
    public void ClearResetsCountAndInsertionOrder()
    {
        var index = new UiHitTestIndex();
        var first = new UiNodeId(1);
        var second = new UiNodeId(2);
        index.Insert(first, Box(0f, 0f, 10f, 10f), zIndex: 0, clips: false);
        index.Clear();
        index.Insert(second, Box(0f, 0f, 10f, 10f), zIndex: 0, clips: false);
        index.Insert(first, Box(0f, 0f, 10f, 10f), zIndex: 0, clips: false);

        index.Count.Should().Be(2);
        index.TryHitTest(new Vec2(5f, 5f), out UiHitResult result).Should().BeTrue();
        result.Node.Should().Be(first);
    }

    [Fact]
    public void InvalidNodeIsIgnored()
    {
        var index = new UiHitTestIndex();
        index.Insert(UiNodeId.Invalid, Box(0f, 0f, 10f, 10f), zIndex: 0, clips: false);

        index.Count.Should().Be(0);
    }

    [Fact]
    public void RepeatedQueriesReturnIdenticalResults()
    {
        var index = new UiHitTestIndex();
        for (uint id = 1; id <= 4; id++)
        {
            index.Insert(new UiNodeId(id), Box(0f, 0f, 100f, 100f), zIndex: 1, clips: false);
        }

        index.TryHitTest(new Vec2(50f, 50f), out UiHitResult first).Should().BeTrue();
        for (int query = 0; query < 64; query++)
        {
            index.TryHitTest(new Vec2(50f, 50f), out UiHitResult again).Should().BeTrue();
            again.Should().Be(first);
        }

        first.Node.Should().Be(new UiNodeId(4));
    }

    [Fact]
    public void HitTestDoesNotAllocateAfterWarmup()
    {
        var index = new UiHitTestIndex();
        index.Insert(new UiNodeId(1), Box(0f, 0f, 100f, 100f), zIndex: 0, clips: false);
        index.Insert(new UiNodeId(2), Box(10f, 10f, 90f, 90f), zIndex: 1, clips: true);
        var point = new Vec2(50f, 50f);

        for (int warmup = 0; warmup < 256; warmup++)
        {
            index.TryHitTest(point, out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        int hits = 0;
        for (int query = 0; query < 2000; query++)
        {
            if (index.TryHitTest(point, out _))
            {
                hits++;
            }
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        hits.Should().Be(2000);
    }
}
