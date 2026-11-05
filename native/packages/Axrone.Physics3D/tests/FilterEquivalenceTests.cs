using Axrone.Numeric;
using Axrone.Physics.Core;
using FluentAssertions;
using Xunit;

using World2 = Axrone.Physics2D.World;
using World3 = Axrone.Physics3D.World;
using BodyDef2 = Axrone.Physics2D.BodyDef;
using BodyDef3 = Axrone.Physics3D.BodyDef;
using BodyId2 = Axrone.Physics2D.BodyId;
using BodyId3 = Axrone.Physics3D.BodyId;
using BodyType2 = Axrone.Physics2D.BodyType;
using BodyType3 = Axrone.Physics3D.BodyType;
using ShapeId2 = Axrone.Physics2D.ShapeId;
using ShapeId3 = Axrone.Physics3D.ShapeId;
using Aabb2 = Axrone.Geometry.Aabb2D;
using Aabb3 = Axrone.Geometry.Aabb3D;
using Ray2 = Axrone.Geometry.Ray2D;
using Ray3 = Axrone.Geometry.Ray3D;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Cross-dimensional query-filter equivalence over a hand-tabulated visibility
/// table derived exclusively from the canonical core contract
/// <see cref="QueryFilter.Matches(in CollisionFilter, in QueryFilter)"/>
/// (Physics.Core/src/QueryFilter.cs): an unset query mask (0) matches
/// everything; a non-zero query group pins visibility to shapes of that exact
/// group and only when the pin is positive; otherwise category and mask must
/// cross-match both ways. Expected sets are fixed data, not observed output.
/// The web reference is internally inconsistent between its two dimensions
/// (physics-2d <c>_matchesFilter</c> in physics-world-2d-shape-store.ts:412-429
/// pins only non-zero groups and cross-tests shape.mask against query
/// category, while physics-3d <c>supportsQueryFilter</c> in
/// physics-world-3d-shared.ts:299-314 treats every defined group as an exact
/// match and uses same-side checks); the native engine deliberately unifies
/// both dimensions on the single core contract.
/// </summary>
public class FilterEquivalenceTests
{
    private static readonly CollisionFilter[] ShapeFilters =
    [
        new(2u, 8u, 5),
        new(4u, 3u, 7),
        new(0u, 8u, 0),
        new(8u, 1u, -3),
    ];

    private static readonly QueryFilter[] QueryFilters =
    [
        default,
        new(0xFFFFu, 0xFFFFu, 0),
        new(0u, 0xFFFFu, 5),
        new(0u, 0xFFFFu, -3),
        new(8u, 2u, 0),
        new(1u, 1u, 0),
        new(0u, 0u, 7),
        new(0u, 0xFFFFu, 0),
    ];

    /// <summary>
    /// Hand derivations per Core rules; shapes are s0=(2,8,g5) s1=(4,3,g7)
    /// s2=(0,8,g0) s3=(8,1,g-3).
    /// q0 default: query.Mask==0 -> IsEmpty -> every shape visible.
    /// q1 (F,F,0): cross: s0 2&amp;F &amp;&amp; F&amp;8 yes; s1 yes; s2 cat 0 fails; s3 yes.
    /// q2 (0,F,5): group pin 5>0: only s0 (g5); s1/s2/s3 groups differ.
    /// q3 (0,F,-3): group pin -3: s3 equal but pin not positive; others differ; empty.
    /// q4 (8,2,0): cross: s0 2&amp;2 &amp;&amp; 8&amp;8 yes; s1 4&amp;2=0; s2 0&amp;2=0; s3 8&amp;2=0.
    /// q5 (1,1,0): cross: every shape category is even, cat&amp;1=0 for all; empty.
    /// q6 (0,0,7): query.Mask==0 -> IsEmpty takes precedence over the group pin -> all visible.
    /// q7 (0,F,0): cross second factor query.Category 0 &amp; shape.Mask = 0 for all; empty.
    /// </summary>
    private static readonly int[][] ExpectedVisible =
    [
        [0, 1, 2, 3],
        [0, 1, 3],
        [0],
        [],
        [0],
        [],
        [0, 1, 2, 3],
        [],
    ];

    /// <summary>Same rows with the s1 body disabled: the enabled gate hides s1 in every query.</summary>
    private static readonly int[][] ExpectedVisibleWithSlot1Disabled =
    [
        [0, 2, 3],
        [0, 3],
        [0],
        [],
        [0],
        [],
        [0, 2, 3],
        [],
    ];

    private static World2 Build2D(int disabledSlot)
    {
        var world = new World2();
        for (int i = 0; i < ShapeFilters.Length; i++)
        {
            BodyId2 body = world.Bodies.Create(new BodyDef2 { Type = BodyType2.Static });
            world.Shapes.AttachCircle(world.Bodies, world.Broadphase, body, new Vec2(i * 5.0f, 0.0f), 0.5f, filter: ShapeFilters[i]);
            if (i == disabledSlot)
            {
                world.Bodies.SetEnabled(body, false);
            }
        }

        return world;
    }

    private static World3 Build3D(int disabledSlot)
    {
        var world = new World3();
        for (int i = 0; i < ShapeFilters.Length; i++)
        {
            BodyId3 body = world.Bodies.Create(new BodyDef3 { Type = BodyType3.Static });
            world.Shapes.AttachSphere(world.Bodies, world.Broadphase, body, new Vec3(i * 5.0f, 0.0f, 0.0f), 0.5f, filter: ShapeFilters[i]);
            if (i == disabledSlot)
            {
                world.Bodies.SetEnabled(body, false);
            }
        }

        return world;
    }

    private static int[] Visible2D(World2 world, in QueryFilter filter)
    {
        var box = new Aabb2(new Vec2(-2.0f, -2.0f), new Vec2(22.0f, 2.0f));
        Span<ShapeId2> results = stackalloc ShapeId2[8];
        int count = world.OverlapAabb(box, results, in filter);
        int[] slots = new int[count];
        for (int i = 0; i < count; i++)
        {
            slots[i] = results[i].ToIndex();
        }

        return slots;
    }

    private static int[] Visible3D(World3 world, in QueryFilter filter)
    {
        var box = new Aabb3(new Vec3(-2.0f, -2.0f, -2.0f), new Vec3(22.0f, 2.0f, 2.0f));
        Span<ShapeId3> results = stackalloc ShapeId3[8];
        int count = world.OverlapAabb(box, results, in filter);
        int[] slots = new int[count];
        for (int i = 0; i < count; i++)
        {
            slots[i] = results[i].ToIndex();
        }

        return slots;
    }

    private static int ClosestSlot2D(World2 world, in QueryFilter filter)
    {
        var ray = new Ray2(new Vec2(-3.0f, 0.0f), new Vec2(1.0f, 0.0f));
        return world.RaycastClosest(in ray, 40.0f, out Axrone.Physics2D.RaycastHit2D hit, in filter)
            ? hit.Shape.ToIndex()
            : -1;
    }

    private static int ClosestSlot3D(World3 world, in QueryFilter filter)
    {
        var ray = new Ray3(new Vec3(-3.0f, 0.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f));
        return world.RaycastClosest(in ray, 40.0f, out Axrone.Physics3D.RaycastHit3D hit, in filter)
            ? hit.Shape.ToIndex()
            : -1;
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(1)]
    public void Overlap_Decisions_Match_Hand_Table_And_Both_Dimensions(int disabledSlot)
    {
        int[][] expected = disabledSlot < 0 ? ExpectedVisible : ExpectedVisibleWithSlot1Disabled;
        using World2 world2 = Build2D(disabledSlot);
        using World3 world3 = Build3D(disabledSlot);

        for (int q = 0; q < QueryFilters.Length; q++)
        {
            QueryFilter query = QueryFilters[q];
            int[] actual2 = Visible2D(world2, in query);
            int[] actual3 = Visible3D(world3, in query);

            actual3.Should().Equal(expected[q], $"3D overlap must equal the hand-derived core table at query {q}");
            actual2.Should().Equal(expected[q], $"2D overlap must equal the hand-derived core table at query {q}");
        }
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(1)]
    public void RaycastClosest_Decisions_Match_Hand_Table_And_Both_Dimensions(int disabledSlot)
    {
        int[][] expected = disabledSlot < 0 ? ExpectedVisible : ExpectedVisibleWithSlot1Disabled;

        using World2 world2 = Build2D(disabledSlot);
        using World3 world3 = Build3D(disabledSlot);

        for (int q = 0; q < QueryFilters.Length; q++)
        {
            QueryFilter query = QueryFilters[q];
            int first = expected[q].Length == 0 ? -1 : expected[q][0];

            ClosestSlot2D(world2, in query).Should().Be(first, $"2D closest ray must hit the hand-table first visible at query {q}");
            ClosestSlot3D(world3, in query).Should().Be(first, $"3D closest ray must hit the hand-table first visible at query {q}");
        }
    }
}
