namespace Axrone.Physics2D.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class QueryFilterTests : IDisposable
{
    private const float Tolerance = 1e-4f;
    private const int AllocationIterations = 200;
    private const int WarmupIterations = 1000;

    private readonly World _world;

    public QueryFilterTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private ShapeId AddStaticCircle(Vec2 center, float radius, CollisionFilter filter = default)
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = center });
        return _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, body, Vec2.Zero, radius, filter: filter);
    }

    private ShapeId AddDisabledCircle(Vec2 center, float radius)
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = center });
        _world.Bodies.SetEnabled(body, false);
        return _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, body, Vec2.Zero, radius);
    }

    [Fact]
    public void Raycast_NoFilter_ReportsEveryShape()
    {
        ShapeId first = AddStaticCircle(new Vec2(3f, 0f), 1f);
        ShapeId second = AddStaticCircle(new Vec2(7f, 0f), 1f);

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[8];
        int count = _world.Raycast(ray, 20f, hits);

        count.Should().Be(2);
        hits[0].Shape.Should().Be(first);
        hits[1].Shape.Should().Be(second);
    }

    [Fact]
    public void Raycast_CategoryMaskFilter_CrossMatchesBothWays()
    {
        ShapeId visible = AddStaticCircle(new Vec2(3f, 0f), 1f, new CollisionFilter(4, (uint)CollisionCategory.All, 0));
        ShapeId invisible = AddStaticCircle(new Vec2(7f, 0f), 1f, new CollisionFilter(2, (uint)CollisionCategory.All, 0));

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[8];
        var filter = new QueryFilter(1, 4, 0);
        int count = _world.Raycast(ray, 20f, hits, in filter);

        count.Should().Be(1);
        hits[0].Shape.Should().Be(visible);
        visible.Should().NotBe(invisible);
    }

    [Fact]
    public void Raycast_ShapeMaskRejectsQuery()
    {
        AddStaticCircle(new Vec2(3f, 0f), 1f, new CollisionFilter(4, 0, 0));

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[8];
        var filter = new QueryFilter(1, (uint)CollisionCategory.All, 0);

        _world.Raycast(ray, 20f, hits, in filter).Should().Be(0);
    }

    [Fact]
    public void PositiveSharedGroup_PinsPairTogether()
    {
        AddStaticCircle(new Vec2(3f, 0f), 1f, new CollisionFilter(4, (uint)CollisionCategory.All, 5));

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[8];
        var groupFilter = new QueryFilter(1, (uint)CollisionCategory.All, 5);

        _world.Raycast(ray, 20f, hits, in groupFilter).Should().Be(1);

        var otherGroup = new QueryFilter(1, (uint)CollisionCategory.All, 6);
        _world.Raycast(ray, 20f, hits, in otherGroup).Should().Be(0);

        var ungroupedQuery = new QueryFilter(1, 4, 0);
        _world.Raycast(ray, 20f, hits, in ungroupedQuery).Should().Be(1);
    }

    [Fact]
    public void NegativeSharedGroup_KeepsPairApart()
    {
        AddStaticCircle(new Vec2(3f, 0f), 1f, new CollisionFilter(1, (uint)CollisionCategory.All, -5));

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[8];
        var groupFilter = new QueryFilter(1, (uint)CollisionCategory.All, -5);

        _world.Raycast(ray, 20f, hits, in groupFilter).Should().Be(0);
    }

    [Fact]
    public void Queries_SkipDisabledBodies()
    {
        AddDisabledCircle(new Vec2(3f, 0f), 1f);

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[8];
        var results = new ShapeId[8];
        _world.Raycast(ray, 20f, hits).Should().Be(0);
        _world.OverlapAabb(new Aabb2D(new Vec2(2f, -1f), new Vec2(4f, 1f)), results).Should().Be(0);
        _world.QueryPoint(new Vec2(3f, 0f), results).Should().Be(0);
    }

    [Fact]
    public void RaycastClosest_ReportsOnlyNearest()
    {
        AddStaticCircle(new Vec2(3f, 0f), 1f);
        ShapeId nearer = AddStaticCircle(new Vec2(2f, 0f), 0.2f);

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        _world.RaycastClosest(ray, 20f, out RaycastHit2D hit).Should().BeTrue();
        hit.Shape.Should().Be(nearer);
        hit.Distance.Should().BeApproximately(1.8f, Tolerance);
    }

    [Fact]
    public void RaycastClosest_FilterCanHideTheNearestShape()
    {
        ShapeId far = AddStaticCircle(new Vec2(6f, 0f), 1f, new CollisionFilter(4, (uint)CollisionCategory.All, 0));
        AddStaticCircle(new Vec2(2f, 0f), 1f, new CollisionFilter(2, (uint)CollisionCategory.All, 0));

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var filter = new QueryFilter(1, 4, 0);
        _world.RaycastClosest(ray, 20f, out RaycastHit2D hit, in filter).Should().BeTrue();
        hit.Shape.Should().Be(far);
    }

    [Fact]
    public void RaycastClosest_MissReturnsFalse()
    {
        AddStaticCircle(new Vec2(3f, 5f), 1f);

        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        _world.RaycastClosest(ray, 20f, out RaycastHit2D hit).Should().BeFalse();
        hit.Shape.Should().Be(ShapeId.Invalid);
    }

    [Fact]
    public void OverlapAabb_FiltersAndSorts()
    {
        ShapeId hidden = AddStaticCircle(new Vec2(0f, 0f), 1f, new CollisionFilter(2, (uint)CollisionCategory.All, 0));
        ShapeId shown = AddStaticCircle(new Vec2(2f, 0f), 1f, new CollisionFilter(4, (uint)CollisionCategory.All, 0));

        var box = new Aabb2D(new Vec2(-2f, -2f), new Vec2(4f, 2f));
        var results = new ShapeId[8];
        var filter = new QueryFilter(1, 4, 0);
        int count = _world.OverlapAabb(box, results, in filter);

        count.Should().Be(1);
        results[0].Should().Be(shown);
        shown.Should().NotBe(hidden);
    }

    [Fact]
    public void QueryPoint_InsideOutAndEdgesNeverContain()
    {
        ShapeId disc = AddStaticCircle(Vec2.Zero, 1f);
        BodyId edgeBody = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachEdge(_world.Bodies, _world.Broadphase, edgeBody, new Vec2(-1f, 0f), new Vec2(1f, 0f));

        var results = new ShapeId[8];
        _world.QueryPoint(new Vec2(0.5f, 0f), results).Should().Be(1);
        results[0].Should().Be(disc);
        _world.QueryPoint(new Vec2(5f, 5f), results).Should().Be(0);

        var idFilter = new QueryFilter(1, (uint)CollisionCategory.All, 0);
        _world.QueryPoint(new Vec2(0.5f, 0f), results, in idFilter).Should().Be(1);
    }

    [Fact]
    public void QueryPointAll_CallbackReportsEveryCoveringShapeAndStopsEarly()
    {
        AddStaticCircle(Vec2.Zero, 2f);
        AddStaticCircle(new Vec2(0.5f, 0f), 2f);

        var collector = new PointCollector();
        _world.QueryPointAll(Vec2.Zero, ref collector, ref collector.State);
        collector.State.Count.Should().Be(2);

        var early = new PointCollector();
        early.State.StopAfterFirst = true;
        _world.QueryPointAll(Vec2.Zero, ref early, ref early.State);
        early.State.Count.Should().Be(1);
    }

    [Fact]
    public void QueryPointNearest_ReportsSurfacePointsInAscendingOrder()
    {
        ShapeId near = AddStaticCircle(new Vec2(3f, 0f), 1f);
        ShapeId far = AddStaticCircle(new Vec2(7f, 0f), 1f);

        var hits = new ClosestPointHit2D[8];
        int count = _world.QueryPointNearest(Vec2.Zero, 10f, hits);

        count.Should().Be(2);
        hits[0].Shape.Should().Be(near);
        hits[0].Distance.Should().BeApproximately(2f, Tolerance);
        hits[1].Shape.Should().Be(far);
        hits[0].Distance.Should().BeLessThan(hits[1].Distance);
    }

    [Fact]
    public void QueryPointNearest_InsidePointReportsZero()
    {
        ShapeId disc = AddStaticCircle(Vec2.Zero, 1f);

        var hits = new ClosestPointHit2D[4];
        _world.QueryPointNearest(new Vec2(0.5f, 0f), 0f, hits).Should().Be(1);
        hits[0].Shape.Should().Be(disc);
        hits[0].Distance.Should().Be(0f);
        hits[0].Point.Should().Be(new Vec2(0.5f, 0f));
    }

    [Fact]
    public void OverlapShape_UsesNarrowPhaseAndSkipsSelf()
    {
        ShapeId probe = AddStaticCircle(Vec2.Zero, 1f);
        ShapeId touching = AddStaticCircle(new Vec2(1.5f, 0f), 1f);
        ShapeId apart = AddStaticCircle(new Vec2(5f, 0f), 1f);

        var results = new ShapeId[8];
        int count = _world.OverlapShape(probe, results);

        count.Should().Be(1);
        results[0].Should().Be(touching);
        touching.Should().NotBe(apart);
    }

    [Fact]
    public void Raycast_SteadyStateAllocatesZero()
    {
        ShapeId target = AddStaticCircle(new Vec2(3f, 0f), 1f);
        var ray = new Ray2D(Vec2.Zero, new Vec2(1f, 0f));
        var hits = new RaycastHit2D[8];
        var filter = new QueryFilter(1, (uint)CollisionCategory.All, 0);

        // Positive control before measuring: the loop must really be working,
        // and tier promotion must happen outside every timed window.
        int primed = 0;
        for (int i = 0; i < WarmupIterations; i++)
        {
            primed += _world.Raycast(ray, 20f, hits, in filter);
        }

        primed.Should().Be(WarmupIterations);

        for (int window = 0; window < 3; window++)
        {
            long before = GC.GetAllocatedBytesForCurrentThread();
            int counted = 0;
            for (int i = 0; i < AllocationIterations; i++)
            {
                counted += _world.Raycast(ray, 20f, hits, in filter);
            }

            long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

            counted.Should().Be(AllocationIterations);
            allocated.Should().Be(0L, "steady-state raycast with filter must not allocate");
        }

        target.Should().NotBe(ShapeId.Invalid);
    }

    [Fact]
    public void Step_SteadyStateAllocatesZero()
    {
        using var world = new World(new WorldDef { Flags = SolverFlags.Default & ~SolverFlags.SleepingBodies });
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, ground,
            new Vec2[] { new(-4f, 0f), new(4f, 0f), new(4f, 1f), new(-4f, 1f) });
        BodyId ball = world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 0.4f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, ball, Vec2.Zero, 0.5f);

        for (int i = 0; i < 100; i++)
        {
            world.Step(1f / 60f);
        }

        world.ContactCount.Should().Be(1);

        for (int window = 0; window < 3; window++)
        {
            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int i = 0; i < AllocationIterations; i++)
            {
                world.Step(1f / 60f);
            }

            long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

            world.ContactCount.Should().Be(1);
            allocated.Should().Be(0L, "steady-state step must not allocate once buffers have grown");
        }
    }
}

internal struct PointCollector : World.IPointQueryVisitor<PointQueryState>
{
    internal PointQueryState State;

    public readonly bool OnShape(ShapeId shapeId, BodyId bodyId, ref PointQueryState context)
    {
        context.Count++;
        if (context.StopAfterFirst)
        {
            return false;
        }

        return true;
    }
}

internal struct PointQueryState
{
    internal int Count;

    internal bool StopAfterFirst;
}
