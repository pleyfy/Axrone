namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneHierarchyTests
{
    [Fact]
    public void Children_EnumerateInSiblingOrder()
    {
        SceneEntityTable entities = new(4);
        var hierarchy = new SceneHierarchy(entities, observer: null);
        SceneEntity root = CreateEntity(entities);
        SceneEntity first = CreateEntity(entities);
        SceneEntity second = CreateEntity(entities);

        hierarchy.SetParent(first, root);
        hierarchy.SetParent(second, root);

        List<SceneEntity> children = new();
        foreach (SceneEntity child in hierarchy.Children(root))
        {
            children.Add(child);
        }

        children.Should().Equal(second, first);
        hierarchy.ChildCount(root).Should().Be(2);
    }

    [Fact]
    public void VisitDescendants_UsesPreOrderAndDepth()
    {
        SceneEntityTable entities = new(4);
        var hierarchy = new SceneHierarchy(entities, observer: null);
        SceneEntity root = CreateEntity(entities);
        SceneEntity a = CreateEntity(entities);
        SceneEntity b = CreateEntity(entities);
        SceneEntity c = CreateEntity(entities);

        hierarchy.SetParent(a, root);
        hierarchy.SetParent(b, a);
        hierarchy.SetParent(c, root);

        var context = new TraversalBuffer(new SceneEntity[8], new int[8]);
        var visitor = new CollectorVisitor();

        hierarchy.VisitDescendants(root, ref visitor, ref context).Should().BeTrue();

        context.Entities[..context.Count].ToArray().Should().Equal(c, a, b);
        context.Depths[..context.Count].ToArray().Should().Equal(1, 1, 2);
    }

    [Fact]
    public void VisitAncestors_WalksToRoot()
    {
        SceneEntityTable entities = new(4);
        var hierarchy = new SceneHierarchy(entities, observer: null);
        SceneEntity root = CreateEntity(entities);
        SceneEntity middle = CreateEntity(entities);
        SceneEntity leaf = CreateEntity(entities);

        hierarchy.SetParent(middle, root);
        hierarchy.SetParent(leaf, middle);

        List<SceneEntity> ancestors = new();
        foreach (SceneEntity ancestor in hierarchy.Ancestors(leaf))
        {
            ancestors.Add(ancestor);
        }

        ancestors.Should().Equal(middle, root);
    }

    [Fact]
    public void SetParent_RejectsCycles()
    {
        SceneEntityTable entities = new(4);
        var hierarchy = new SceneHierarchy(entities, observer: null);
        SceneEntity root = CreateEntity(entities);
        SceneEntity child = CreateEntity(entities);
        hierarchy.SetParent(child, root);

        Action cycle = () => hierarchy.SetParent(root, child);

        cycle.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void Reparent_UpdatesDepthAndOrder()
    {
        SceneEntityTable entities = new(4);
        var hierarchy = new SceneHierarchy(entities, observer: null);
        SceneEntity root = CreateEntity(entities);
        SceneEntity a = CreateEntity(entities);
        SceneEntity b = CreateEntity(entities);

        hierarchy.SetParent(a, root);
        hierarchy.SetParent(b, a);

        hierarchy.SetParent(b, root);

        hierarchy.DepthOf(b).Should().Be(1);
        hierarchy.ParentOf(b).Should().Be(root);
        hierarchy.ChildCount(a).Should().Be(0);
        hierarchy.ChildCount(root).Should().Be(2);
    }

    [Fact]
    public void VisitSubtree_IncludesRootAndDescendants()
    {
        SceneEntityTable entities = new(4);
        var hierarchy = new SceneHierarchy(entities, observer: null);
        SceneEntity root = CreateEntity(entities);
        SceneEntity child = CreateEntity(entities);
        hierarchy.SetParent(child, root);

        var context = new TraversalBuffer(new SceneEntity[4], new int[4]);
        var visitor = new CollectorVisitor();

        hierarchy.VisitSubtree(root, ref visitor, ref context).Should().BeTrue();

        context.Entities[..context.Count].ToArray().Should().Equal(root, child);
        context.Depths[..context.Count].ToArray().Should().Equal(0, 1);
    }

    private static SceneEntity CreateEntity(SceneEntityTable entities) =>
        entities.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, active: true, persistent: false, pooled: false);

    private sealed class TraversalBuffer
    {
        public SceneEntity[] Entities;
        public int[] Depths;
        public int Count;

        public TraversalBuffer(SceneEntity[] entities, int[] depths)
        {
            Entities = entities;
            Depths = depths;
            Count = 0;
        }
    }

    private struct CollectorVisitor : ISceneHierarchyVisitor<TraversalBuffer>
    {
        public bool Visit(SceneEntity entity, int depth, scoped ref TraversalBuffer context)
        {
            if ((uint)context.Count >= (uint)context.Entities.Length)
            {
                return false;
            }

            context.Entities[context.Count] = entity;
            context.Depths[context.Count] = depth;
            context.Count++;
            return true;
        }
    }
}
