using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Rule-killer tests for the canonical core query-filter contract. Each test
/// pins one clause of <see cref="QueryFilter.Matches(in CollisionFilter, in QueryFilter)"/>
/// through the real 3D query door, so a reintroduced consumer-side bypass
/// (skip matching for "unfiltered-looking" shapes) fails here.
/// </summary>
public class QueryFilterRulesTests
{
    private static readonly CollisionFilter ZeroCategory = new(0u, 8u, 0);
    private static readonly CollisionFilter Plain = new(2u, 8u, 5);
    private static readonly CollisionFilter NegativeGroup = new(8u, 1u, -3);

    private static World SingleSphereWorld(CollisionFilter filter, out BodyId body)
    {
        var world = new World();
        body = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, body, new Vec3(0.0f, 0.0f, 5.0f), 0.5f, filter: filter);
        return world;
    }

    private static int OverlapCount(World world, in QueryFilter filter)
    {
        var box = new Aabb3D(new Vec3(-1.0f, -1.0f, 4.0f), new Vec3(1.0f, 1.0f, 6.0f));
        Span<ShapeId> results = stackalloc ShapeId[4];
        return world.OverlapAabb(box, results, in filter);
    }

    [Fact]
    public void ZeroCategory_Shape_Is_Hidden_From_Masked_Query()
    {
        BodyId body;
        using var world = SingleSphereWorld(ZeroCategory, out body);

        QueryFilter query = new(0xFFFFu, 0xFFFFu, 0);

        QueryFilter.Matches(in ZeroCategory, in query).Should().BeFalse();
        OverlapCount(world, in query).Should().Be(0);
    }

    [Fact]
    public void Unset_Query_Mask_Reveals_Every_Category_And_Group()
    {
        BodyId a;
        BodyId b;
        BodyId c;
        using var worldA = SingleSphereWorld(ZeroCategory, out a);
        using var worldB = SingleSphereWorld(Plain, out b);
        using var worldC = SingleSphereWorld(NegativeGroup, out c);

        QueryFilter query = new(0u, 0u, 7);

        query.IsEmpty.Should().BeTrue();
        OverlapCount(worldA, in query).Should().Be(1);
        OverlapCount(worldB, in query).Should().Be(1);
        OverlapCount(worldC, in query).Should().Be(1);
    }

    [Fact]
    public void Negative_Group_Pin_Hides_Even_The_Matching_Group()
    {
        BodyId body;
        using var world = SingleSphereWorld(NegativeGroup, out body);

        QueryFilter pin = new(0u, 0xFFFFu, -3);
        QueryFilter otherPin = new(0u, 0xFFFFu, -9);

        QueryFilter.Matches(in NegativeGroup, in pin).Should().BeFalse();
        QueryFilter.Matches(in NegativeGroup, in otherPin).Should().BeFalse();
        OverlapCount(world, in pin).Should().Be(0);
    }

    [Fact]
    public void Positive_Group_Pin_Reveals_Only_The_Matching_Group()
    {
        BodyId member;
        BodyId outsider;
        using var worldMember = SingleSphereWorld(Plain, out member);
        using var worldOutsider = SingleSphereWorld(NegativeGroup, out outsider);

        QueryFilter pin = new(0u, 0xFFFFu, 5);
        QueryFilter otherPin = new(0u, 0xFFFFu, 4);

        QueryFilter.Matches(in Plain, in pin).Should().BeTrue();
        QueryFilter.Matches(in NegativeGroup, in pin).Should().BeFalse();
        QueryFilter.Matches(in Plain, in otherPin).Should().BeFalse();
        OverlapCount(worldMember, in pin).Should().Be(1);
        OverlapCount(worldOutsider, in pin).Should().Be(0);
        OverlapCount(worldMember, in otherPin).Should().Be(0);
    }
}
