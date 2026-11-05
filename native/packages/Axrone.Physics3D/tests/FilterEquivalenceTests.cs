using Axrone.Numeric;
using Axrone.Physics.Core;
using FluentAssertions;
using Xunit;

using World2 = Axrone.Physics2D.World;
using World3 = Axrone.Physics3D.World;
using BodyDef2 = Axrone.Physics2D.BodyDef;
using BodyDef3 = Axrone.Physics3D.BodyDef;
using BodyType2 = Axrone.Physics2D.BodyType;
using BodyType3 = Axrone.Physics3D.BodyType;
using Aabb2 = Axrone.Geometry.Aabb2D;
using Aabb3 = Axrone.Geometry.Aabb3D;

namespace Axrone.Physics3D.Tests;

public class FilterEquivalenceTests
{
    private static readonly CollisionFilter[] Shapes =
    [
        new(2u, 8u, 5),
        new(4u, 3u, 7),
        new(1u, 15u, 0),
        new(8u, 1u, -3),
    ];

    private static readonly QueryFilter[] Queries =
    [
        default,
        QueryFilter.None,
        QueryFilter.Default,
        new(0u, 0xFFFFu, 5),
        new(0u, 0xFFFFu, -3),
        new(0u, 0xFFFFu, 0),
        new(8u, 2u, 0),
        new(1u, 4u, 0),
        new(0u, 0u, 7),
        new(4u, 15u, 0),
    ];

    private static int[] Visible2D(World2 world, in QueryFilter filter)
    {
        var box = new Aabb2(new Vec2(-2.0f, -2.0f), new Vec2(22.0f, 2.0f));
        Span<Axrone.Physics2D.ShapeId> results = stackalloc Axrone.Physics2D.ShapeId[8];
        int count = world.OverlapAabb(box, results, in filter);
        var slots = new int[count];
        for (int i = 0; i < count; i++)
        {
            slots[i] = results[i].ToIndex();
        }

        return slots;
    }

    private static int[] Visible3D(World3 world, in QueryFilter filter)
    {
        var box = new Aabb3(new Vec3(-2.0f, -2.0f, -2.0f), new Vec3(22.0f, 2.0f, 2.0f));
        Span<Axrone.Physics3D.ShapeId> results = stackalloc Axrone.Physics3D.ShapeId[8];
        int count = world.OverlapAabb(box, results, in filter);
        var slots = new int[count];
        for (int i = 0; i < count; i++)
        {
            slots[i] = results[i].ToIndex();
        }

        return slots;
    }

    [Fact]
    public void TwoD_And_ThreeD_Query_Decisions_Are_Identical()
    {
        using var world2 = new World2();
        for (int i = 0; i < Shapes.Length; i++)
        {
            Axrone.Physics2D.BodyId body = world2.Bodies.Create(new BodyDef2 { Type = BodyType2.Static });
            world2.Shapes.AttachCircle(world2.Bodies, world2.Broadphase, body, new Vec2(i * 5.0f, 0.0f), 0.5f, filter: Shapes[i]);
        }

        using var world3 = new World3();
        for (int i = 0; i < Shapes.Length; i++)
        {
            Axrone.Physics3D.BodyId body = world3.Bodies.Create(new BodyDef3 { Type = BodyType3.Static });
            world3.Shapes.AttachSphere(world3.Bodies, world3.Broadphase, body, new Vec3(i * 5.0f, 0.0f, 0.0f), 0.5f, filter: Shapes[i]);
        }

        for (int q = 0; q < Queries.Length; q++)
        {
            int[] expected = Expected(Queries[q]);
            int[] actual2 = Visible2D(world2, Queries[q]);
            int[] actual3 = Visible3D(world3, Queries[q]);

            actual3.Should().Equal(expected, $"3D world decision must equal the shared core predicate (query {q})");
            actual2.Should().Equal(actual3, $"2D and 3D world decisions must agree (query {q})");
        }
    }

    private static int[] Expected(in QueryFilter query)
    {
        var list = new List<int>();
        for (int i = 0; i < Shapes.Length; i++)
        {
            if (QueryFilter.Matches(in Shapes[i], in query))
            {
                list.Add(i);
            }
        }

        return list.ToArray();
    }

    [Fact]
    public void Group_Semantics_Match_Core_Definition_In_Both_Dimensions()
    {
        var member = new CollisionFilter(1u, 15u, 4);
        var outsider = new CollisionFilter(1u, 15u, 0);
        var negativeMember = new CollisionFilter(1u, 15u, -4);

        QueryFilter.Matches(in member, new QueryFilter(0u, 0xFFFFu, 4)).Should().BeTrue();
        QueryFilter.Matches(in outsider, new QueryFilter(0u, 0xFFFFu, 4)).Should().BeFalse();
        QueryFilter.Matches(in negativeMember, new QueryFilter(0u, 0xFFFFu, -4)).Should().BeFalse();
        QueryFilter.Matches(in member, new QueryFilter(0u, 0xFFFFu, -4)).Should().BeFalse();
    }
}
