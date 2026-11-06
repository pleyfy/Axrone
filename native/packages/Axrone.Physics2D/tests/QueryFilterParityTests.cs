namespace Axrone.Physics2D.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Physics.Core;
using FluentAssertions;
using Xunit;

public sealed class QueryFilterParityTests : IDisposable
{
    private readonly World _world;

    public QueryFilterParityTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private ShapeId CircleAt(Vec2 center)
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = center });
        return _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, body, Vec2.Zero, 1f);
    }

    [Fact]
    public void ZeroCategoryShape_IsHiddenFromEveryNonEmptyQuery()
    {
        ShapeId ghost = CircleAt(new Vec2(3f, 0f));
        _world.Shapes.SetFilter(ghost, new CollisionFilter(0u, 0u, 0));
        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var box = new Aabb2D(new Vec2(2f, -1f), new Vec2(4f, 1f));
        var hits = new RaycastHit2D[4];
        var shapes = new ShapeId[4];
        var filter = QueryFilter.Default;

        _world.Raycast(in ray, 20f, hits, in filter).Should().Be(0,
            "a shape without a category matches no query mask, exactly like the 3D path");
        _world.RaycastClosest(in ray, 20f, out _, in filter).Should().BeFalse();
        _world.OverlapAabb(in box, shapes, in filter).Should().Be(0);
        _world.QueryPoint(new Vec2(3f, 0f), shapes, in filter).Should().Be(0);
    }

    [Fact]
    public void ZeroCategoryShape_IsStillVisibleToAnEmptyFilter()
    {
        ShapeId ghost = CircleAt(new Vec2(3f, 0f));
        _world.Shapes.SetFilter(ghost, new CollisionFilter(0u, 0u, 0));
        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[4];
        var unfiltered = QueryFilter.None;

        _world.Raycast(in ray, 20f, hits, in unfiltered).Should().Be(1);
    }

    [Theory]
    [InlineData(0u, 0u, 0, 1u, 0xFFFFFFFFu, 0, false)]
    [InlineData(0u, 0xFFFFFFFFu, 0, 1u, 0xFFFFFFFFu, 0, false)]
    [InlineData(0u, 0xFFFFFFFFu, 3, 1u, 0xFFFFFFFFu, 0, false)]
    [InlineData(0u, 0xFFFFFFFFu, 3, 1u, 0xFFFFFFFFu, 3, true)]
    [InlineData(0u, 0xFFFFFFFFu, -3, 1u, 0xFFFFFFFFu, -3, false)]
    [InlineData(4u, 0xFFFFFFFFu, 0, 1u, 0, 0, true)]
    [InlineData(4u, 0xFFFFFFFFu, 0, 1u, 2u, 0, false)]
    [InlineData(1u, 0xFFFFFFFFu, 5, 1u, 0xFFFFFFFFu, 5, true)]
    [InlineData(1u, 0xFFFFFFFFu, 5, 1u, 0xFFFFFFFFu, 6, false)]
    [InlineData(1u, 0xFFFFFFFFu, 5, 1u, 0xFFFFFFFFu, -5, false)]
    [InlineData(2u, 2u, 0, 2u, 2u, 0, true)]
    [InlineData(2u, 4u, 0, 2u, 4u, 0, false)]
    public void Raycast_DecisionMatchesCoreContract(
        uint shapeCategory, uint shapeMask, int shapeGroup,
        uint queryCategory, uint queryMask, int queryGroup,
        bool expectVisible)
    {
        ShapeId probe = CircleAt(new Vec2(3f, 0f));
        _world.Shapes.SetFilter(probe, new CollisionFilter(shapeCategory, shapeMask, shapeGroup));
        var shape = _world.Shapes.GetFilter(probe);
        var filter = new QueryFilter(queryCategory, queryMask, queryGroup);
        QueryFilter.Matches(in shape, in filter).Should().Be(expectVisible,
            "the shared Core contract is the single source of truth for the expected answer");

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[4];
        int reported = _world.Raycast(in ray, 20f, hits, in filter);
        reported.Should().Be(expectVisible ? 1 : 0);
    }
}
