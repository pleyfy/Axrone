namespace Axrone.Ui.Input.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Ui;
using FluentAssertions;
using Xunit;

public sealed class UiNodeGeometryTests
{
    private static Aabb2D Box(float minX, float minY, float maxX, float maxY) => new(minX, minY, maxX, maxY);

    private static UiNodeRecord Record(UiNodeFlags flags) =>
        new(new UiNodeId(1), UiNodeId.Invalid, UiNodeId.Invalid, UiNodeId.Invalid, UiNodeKind.Container, flags);

    private static bool Completes(Action action)
    {
        Task task = Task.Run(action);
        return task.Wait(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public void ClipIntersectsEveryClippingAncestor()
    {
        var tree = new TestTree();
        UiNodeId outer = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        UiNodeId inner = tree.Add(outer, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        UiNodeId leaf = tree.Add(inner, UiNodeKind.Button, UiNodeFlags.Visible);
        var bounds = new TestBounds();
        bounds.Set(outer, 0f, 0f, 100f, 100f);
        bounds.Set(inner, 20f, 20f, 80f, 80f);
        var resolver = new UiTreeClipResolver(tree, bounds);

        resolver.TryGetClip(leaf, out Aabb2D leafClip).Should().BeTrue();
        leafClip.Min.Should().Be(new Vec2(20f, 20f));
        leafClip.Max.Should().Be(new Vec2(80f, 80f));

        resolver.TryGetClip(inner, out Aabb2D innerClip).Should().BeTrue();
        innerClip.Min.Should().Be(new Vec2(0f, 0f));
        innerClip.Max.Should().Be(new Vec2(100f, 100f));
    }

    [Fact]
    public void ClipSkipsNonClippingAncestors()
    {
        var tree = new TestTree();
        UiNodeId panel = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId leaf = tree.Add(panel, UiNodeKind.Button, UiNodeFlags.Visible);
        var bounds = new TestBounds();
        bounds.Set(tree.Root, 0f, 0f, 500f, 500f);
        bounds.Set(panel, 0f, 0f, 100f, 100f);
        var resolver = new UiTreeClipResolver(tree, bounds);

        resolver.TryGetClip(leaf, out _).Should().BeFalse();
    }

    [Fact]
    public void NodeDoesNotClipItself()
    {
        var tree = new TestTree();
        UiNodeId leaf = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        var bounds = new TestBounds();
        bounds.Set(leaf, 0f, 0f, 100f, 100f);
        var resolver = new UiTreeClipResolver(tree, bounds);

        resolver.TryGetClip(leaf, out _).Should().BeFalse();
    }

    [Fact]
    public void UnknownNodeHasNoClip()
    {
        var tree = new TestTree();
        var bounds = new TestBounds();
        var resolver = new UiTreeClipResolver(tree, bounds);

        resolver.TryGetClip(new UiNodeId(99), out _).Should().BeFalse();
        resolver.TryGetClip(UiNodeId.Invalid, out _).Should().BeFalse();
    }

    [Fact]
    public void MissingParentStopsTheWalk()
    {
        var tree = new MissingParentTree();
        var bounds = new TestBounds();
        bounds.Set(new UiNodeId(1), 0f, 0f, 100f, 100f);
        var resolver = new UiTreeClipResolver(tree, bounds);

        resolver.TryGetClip(new UiNodeId(1), out _).Should().BeFalse();
    }

    [Fact]
    public void ClippingAncestorWithoutBoundsIsIgnored()
    {
        var tree = new TestTree();
        UiNodeId panel = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        UiNodeId leaf = tree.Add(panel, UiNodeKind.Button, UiNodeFlags.Visible);
        var bounds = new TestBounds();
        bounds.Set(leaf, 0f, 0f, 10f, 10f);
        var resolver = new UiTreeClipResolver(tree, bounds);

        resolver.TryGetClip(leaf, out _).Should().BeFalse();
    }

    [Fact]
    public void CyclicParentsTerminateWithStableClip()
    {
        var tree = new CyclicTree(UiNodeFlags.Visible | UiNodeFlags.Clip);
        var bounds = new TestBounds();
        bounds.Set(new UiNodeId(1), 0f, 0f, 100f, 100f);
        bounds.Set(new UiNodeId(2), 50f, 50f, 200f, 200f);
        var resolver = new UiTreeClipResolver(tree, bounds);
        var node = new UiNodeId(1);
        bool resolved = false;
        Aabb2D clip = default;

        bool terminated = Completes(() =>
        {
            resolved = resolver.TryGetClip(node, out Aabb2D value);
            clip = value;
        });

        terminated.Should().BeTrue();
        resolved.Should().BeTrue();
        clip.Min.Should().Be(new Vec2(50f, 50f));
        clip.Max.Should().Be(new Vec2(100f, 100f));
    }

    [Fact]
    public void CyclicVisibilityTerminatesAsNotVisible()
    {
        var tree = new CyclicTree(UiNodeFlags.Visible);
        var node = new UiNodeId(1);
        bool visible = true;

        bool terminated = Completes(() => visible = UiTreeQuery.IsEffectivelyVisible(tree, node));

        terminated.Should().BeTrue();
        visible.Should().BeFalse();
    }

    [Fact]
    public void VisibilityRequiresEveryAncestorVisible()
    {
        var tree = new TestTree();
        UiNodeId panel = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId leaf = tree.Add(panel, UiNodeKind.Button, UiNodeFlags.Visible);

        UiTreeQuery.IsEffectivelyVisible(tree, leaf).Should().BeTrue();

        tree.SetFlags(leaf, UiNodeFlags.None);
        UiTreeQuery.IsEffectivelyVisible(tree, leaf).Should().BeFalse();

        tree.SetFlags(leaf, UiNodeFlags.Visible);
        tree.SetFlags(panel, UiNodeFlags.None);
        UiTreeQuery.IsEffectivelyVisible(tree, leaf).Should().BeFalse();
    }

    [Fact]
    public void VisibilityRejectsUnknownNode()
    {
        var tree = new TestTree();

        UiTreeQuery.IsEffectivelyVisible(tree, new UiNodeId(42)).Should().BeFalse();
        UiTreeQuery.IsEffectivelyVisible(tree, UiNodeId.Invalid).Should().BeFalse();
    }

    [Fact]
    public void InteractivityRequiresBothFlags()
    {
        UiTreeQuery.IsInteractive(Record(UiNodeFlags.Enabled | UiNodeFlags.Interactive)).Should().BeTrue();
        UiTreeQuery.IsInteractive(Record(UiNodeFlags.Enabled)).Should().BeFalse();
        UiTreeQuery.IsInteractive(Record(UiNodeFlags.Interactive)).Should().BeFalse();
        UiTreeQuery.IsInteractive(Record(UiNodeFlags.None)).Should().BeFalse();
    }

    [Fact]
    public void FocusabilityRequiresFocusableEnabledAndVisible()
    {
        var tree = new TestTree();
        UiNodeId panel = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible);
        UiNodeId leaf = tree.Add(panel, UiNodeKind.Button, UiNodeFlags.Visible | UiNodeFlags.Focusable | UiNodeFlags.Enabled);

        UiTreeQuery.IsFocusable(tree, leaf).Should().BeTrue();

        tree.SetFlags(leaf, UiNodeFlags.Visible | UiNodeFlags.Focusable);
        UiTreeQuery.IsFocusable(tree, leaf).Should().BeFalse();

        tree.SetFlags(leaf, UiNodeFlags.Focusable | UiNodeFlags.Enabled);
        UiTreeQuery.IsFocusable(tree, leaf).Should().BeFalse();

        tree.SetFlags(leaf, UiNodeFlags.Visible | UiNodeFlags.Focusable | UiNodeFlags.Enabled);
        tree.SetFlags(panel, UiNodeFlags.None);
        UiTreeQuery.IsFocusable(tree, leaf).Should().BeFalse();

        UiTreeQuery.IsFocusable(tree, new UiNodeId(77)).Should().BeFalse();
    }

    [Fact]
    public void ClipResolutionDoesNotAllocateAfterWarmup()
    {
        var tree = new TestTree();
        UiNodeId outer = tree.Add(tree.Root, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        UiNodeId inner = tree.Add(outer, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
        UiNodeId leaf = tree.Add(inner, UiNodeKind.Button, UiNodeFlags.Visible);
        var bounds = new TestBounds();
        bounds.Set(outer, 0f, 0f, 100f, 100f);
        bounds.Set(inner, 20f, 20f, 80f, 80f);
        var resolver = new UiTreeClipResolver(tree, bounds);
        for (int warmup = 0; warmup < 128; warmup++)
        {
            resolver.TryGetClip(leaf, out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        bool found = false;
        for (int query = 0; query < 2000; query++)
        {
            found = resolver.TryGetClip(leaf, out _);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        found.Should().BeTrue();
    }
}

internal sealed class CyclicTree(UiNodeFlags flags) : IUiNodeTree
{
    public int Count => 2;

    public UiNodeId Root => new(1);

    public bool TryGetNode(UiNodeId id, out UiNodeRecord record)
    {
        if (id.Value is 1 or 2)
        {
            var parent = new UiNodeId(id.Value == 1 ? 2u : 1u);
            record = new UiNodeRecord(id, parent, UiNodeId.Invalid, UiNodeId.Invalid, UiNodeKind.Container, flags);
            return true;
        }

        record = default;
        return false;
    }

    public ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id) => ReadOnlySpan<UiNodeId>.Empty;
}

internal sealed class MissingParentTree : IUiNodeTree
{
    public int Count => 1;

    public UiNodeId Root => new(1);

    public bool TryGetNode(UiNodeId id, out UiNodeRecord record)
    {
        if (id.Value == 1)
        {
            record = new UiNodeRecord(id, new UiNodeId(99), UiNodeId.Invalid, UiNodeId.Invalid, UiNodeKind.Container, UiNodeFlags.Visible | UiNodeFlags.Clip);
            return true;
        }

        record = default;
        return false;
    }

    public ReadOnlySpan<UiNodeId> GetChildren(UiNodeId id) => ReadOnlySpan<UiNodeId>.Empty;
}
