using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class QueryFilterTests
{
    private static readonly CollisionFilter LayerA = new(2u, 8u, 5);
    private static readonly CollisionFilter LayerB = new(4u, 3u, 7);

    private static World BuildTwoSphereWorld(out ShapeId shapeA, out ShapeId shapeB)
    {
        var world = new World();
        BodyId bodyA = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        BodyId bodyB = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        shapeA = world.Shapes.AttachSphere(world.Bodies, world.Broadphase, bodyA, new Vec3(0.0f, 0.0f, 5.0f), 0.5f, filter: LayerA);
        shapeB = world.Shapes.AttachSphere(world.Bodies, world.Broadphase, bodyB, new Vec3(0.0f, 0.0f, 10.0f), 0.5f, filter: LayerB);
        return world;
    }

    [Fact]
    public void Empty_Filter_Reports_Everything()
    {
        using var world = BuildTwoSphereWorld(out _, out _);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        Span<RaycastHit3D> hits = stackalloc RaycastHit3D[4];
        world.Raycast(in ray, 20.0f, hits).Should().Be(2);
        world.Raycast(in ray, 20.0f, hits, QueryFilter.None).Should().Be(2);
    }

    [Fact]
    public void Pinned_Positive_Group_Reports_Only_That_Group()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out _);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        Span<RaycastHit3D> hits = stackalloc RaycastHit3D[4];
        int count = world.Raycast(in ray, 20.0f, hits, new QueryFilter(0u, 0xFFFFu, 5));

        count.Should().Be(1);
        hits[0].Shape.Should().Be(shapeA);
    }

    [Fact]
    public void Pinned_Negative_Group_Reports_Nothing()
    {
        using var world = BuildTwoSphereWorld(out _, out _);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        Span<RaycastHit3D> hits = stackalloc RaycastHit3D[4];
        world.Raycast(in ray, 20.0f, hits, new QueryFilter(0u, 0xFFFFu, -5)).Should().Be(0);
    }

    [Fact]
    public void Cross_Match_Requires_Mutual_Bits()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out _);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        Span<RaycastHit3D> hits = stackalloc RaycastHit3D[4];
        // (category 8, mask 2): shape A (2, 8) crosses both ways; shape B (4, 3) fails both.
        world.Raycast(in ray, 20.0f, hits, new QueryFilter(8u, 2u, 0)).Should().Be(1);
        hits[0].Shape.Should().Be(shapeA);

        // (category 1, mask 1): neither shape crosses.
        world.Raycast(in ray, 20.0f, hits, new QueryFilter(1u, 1u, 0)).Should().Be(0);
    }

    [Fact]
    public void RaycastClosest_Respects_Filter()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out ShapeId shapeB);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        world.RaycastClosest(in ray, 20.0f, out RaycastHit3D hit, new QueryFilter(0u, 0xFFFFu, 7)).Should().BeTrue();
        hit.Shape.Should().Be(shapeB);

        world.RaycastClosest(in ray, 20.0f, out hit, new QueryFilter(0u, 0xFFFFu, 5)).Should().BeTrue();
        hit.Shape.Should().Be(shapeA);

        world.RaycastClosest(in ray, 20.0f, out _, new QueryFilter(0u, 0xFFFFu, 999)).Should().BeFalse();
    }

    [Fact]
    public void OverlapAabb_Respects_Filter()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out ShapeId shapeB);
        var box = new Aabb3D(new Vec3(-1.0f, -1.0f, 0.0f), new Vec3(1.0f, 1.0f, 12.0f));

        Span<ShapeId> results = stackalloc ShapeId[4];
        world.OverlapAabb(box, results, QueryFilter.None).Should().Be(2);
        world.OverlapAabb(box, results, new QueryFilter(0u, 0xFFFFu, 5)).Should().Be(1);
        results[0].Should().Be(shapeA);
        world.OverlapAabb(box, results, new QueryFilter(0u, 0xFFFFu, -5)).Should().Be(0);
    }

    [Fact]
    public void QueryPoint_Respects_Filter()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out ShapeId shapeB);

        Span<ClosestPointHit3D> hits = stackalloc ClosestPointHit3D[4];
        world.QueryPoint(new Vec3(0.0f, 0.0f, 0.0f), 12.0f, hits).Should().Be(2);
        world.QueryPoint(new Vec3(0.0f, 0.0f, 0.0f), 12.0f, hits, new QueryFilter(0u, 0xFFFFu, 7)).Should().Be(1);
        hits[0].Shape.Should().Be(shapeB);
    }

    [Fact]
    public void Matches_Table_Is_The_Single_Decision_Source()
    {
        var shape = new CollisionFilter(0b1010u, 0b0101u, 3);
        QueryFilter none = QueryFilter.None;
        QueryFilter empty = default;

        QueryFilter.Matches(in shape, in none).Should().BeTrue();
        QueryFilter.Matches(in shape, in empty).Should().BeTrue();

        QueryFilter disjoint = new(0b0100u, 0b0100u, 0);
        QueryFilter.Matches(in shape, in disjoint).Should().BeFalse();

        QueryFilter crossing = new(0b0011u, 0b1010u, 0);
        QueryFilter.Matches(in shape, in crossing).Should().BeTrue();

        QueryFilter pinnedMember = new(0u, 0xFFFFu, 3);
        QueryFilter.Matches(in shape, in pinnedMember).Should().BeTrue();

        QueryFilter pinnedNegative = new(0u, 0xFFFFu, -3);
        QueryFilter.Matches(in shape, in pinnedNegative).Should().BeFalse();

        QueryFilter pinnedStranger = new(0u, 0xFFFFu, 4);
        QueryFilter.Matches(in shape, in pinnedStranger).Should().BeFalse();
    }
}
