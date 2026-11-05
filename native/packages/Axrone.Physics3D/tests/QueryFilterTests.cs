using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics3D;
using Axrone.Physics.Core;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class QueryFilterTests
{
    private static readonly CollisionFilter LayerA = new(2u, 0xFFFFu, 5);
    private static readonly CollisionFilter LayerB = new(4u, 0xFFFFu, 7);

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
    public void Raycast_Without_Filter_Hits_Everything()
    {
        using var world = BuildTwoSphereWorld(out _, out _);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        Span<RaycastHit3D> hits = stackalloc RaycastHit3D[4];
        int count = world.Raycast(in ray, 20.0f, hits);

        count.Should().Be(2);
    }

    [Fact]
    public void Raycast_Category_Filter_Prunes_Other_Layers()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out _);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        Span<RaycastHit3D> hits = stackalloc RaycastHit3D[4];
        int count = world.Raycast(in ray, 20.0f, hits, new QueryFilter3D(2u, null, null));

        count.Should().Be(1);
        hits[0].Shape.Should().Be(shapeA);
    }

    [Fact]
    public void Raycast_Group_Filter_Is_Exact_Identity_Match()
    {
        using var world = BuildTwoSphereWorld(out _, out ShapeId shapeB);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        Span<RaycastHit3D> hits = stackalloc RaycastHit3D[4];
        int count = world.Raycast(in ray, 20.0f, hits, new QueryFilter3D(null, null, 7));

        count.Should().Be(1);
        hits[0].Shape.Should().Be(shapeB);
    }

    [Fact]
    public void RaycastClosest_Respects_Filter()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out _);
        var ray = new Ray3D(Vec3.Zero, new Vec3(0.0f, 0.0f, 1.0f));

        world.RaycastClosest(in ray, 20.0f, out RaycastHit3D hit).Should().BeTrue();
        hit.Shape.Should().Be(shapeA);

        world.RaycastClosest(in ray, 20.0f, out hit, new QueryFilter3D(null, null, 7)).Should().BeTrue();
        hit.Shape.Should().NotBe(shapeA);

        world.RaycastClosest(in ray, 20.0f, out _, new QueryFilter3D(null, null, 999)).Should().BeFalse();
    }

    [Fact]
    public void OverlapAabb_Respects_Filter()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out ShapeId shapeB);
        var box = new Aabb3D(new Vec3(-1.0f, -1.0f, 0.0f), new Vec3(1.0f, 1.0f, 12.0f));

        Span<ShapeId> results = stackalloc ShapeId[4];
        world.OverlapAabb(box, results).Should().Be(2);
        world.OverlapAabb(box, results, new QueryFilter3D(2u, null, null)).Should().Be(1);
        results[0].Should().Be(shapeA);
        world.OverlapAabb(box, results, new QueryFilter3D(null, null, 7)).Should().Be(1);
        results[0].Should().Be(shapeB);
    }

    [Fact]
    public void QueryPoint_Respects_Filter()
    {
        using var world = BuildTwoSphereWorld(out ShapeId shapeA, out _);

        Span<ClosestPointHit3D> hits = stackalloc ClosestPointHit3D[4];
        world.QueryPoint(new Vec3(0.0f, 0.0f, 0.0f), 12.0f, hits).Should().Be(2);
        world.QueryPoint(new Vec3(0.0f, 0.0f, 0.0f), 12.0f, hits, new QueryFilter3D(4u, null, null)).Should().Be(1);
        hits[0].Shape.Should().NotBe(shapeA);
    }

    [Fact]
    public void QueryFilter_Matches_And_Test_Semantics()
    {
        var shapeFilter = new CollisionFilter(0b1010u, 0b0101u, 3);

        QueryFilter3D.Any.Matches(in shapeFilter).Should().BeTrue();
        new QueryFilter3D(0b0010u, null, null).Matches(in shapeFilter).Should().BeTrue();
        new QueryFilter3D(0b1100u, null, null).Matches(in shapeFilter).Should().BeTrue();
        new QueryFilter3D(0b0100u, null, null).Matches(in shapeFilter).Should().BeFalse();
        new QueryFilter3D(null, 0b0001u, null).Matches(in shapeFilter).Should().BeTrue();
        new QueryFilter3D(null, 0b0010u, null).Matches(in shapeFilter).Should().BeFalse();
        new QueryFilter3D(null, null, 3).Matches(in shapeFilter).Should().BeTrue();
        new QueryFilter3D(null, null, 4).Matches(in shapeFilter).Should().BeFalse();
    }
}
