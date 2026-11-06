namespace Axrone.Physics2D.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class WorldOpsTests : IDisposable
{
    private const float Tolerance = 1e-4f;

    private readonly World _world;

    public WorldOpsTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private ShapeId AddStaticCircle(Vec2 center, float radius)
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = center });
        return _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, body, Vec2.Zero, radius);
    }

    [Fact]
    public void ShiftOrigin_MovesBodiesStaticsAndQueries()
    {
        ShapeId disc = AddStaticCircle(new Vec2(3f, 0f), 1f);
        BodyId dynamic = _world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 10f) });

        _world.ShiftOrigin(new Vec2(100f, 0f));

        _world.Bodies.GetTransform(_world.Shapes.GetBody(disc)).Position.X.Should().BeApproximately(-97f, Tolerance);
        _world.Bodies.GetTransform(dynamic).Position.X.Should().BeApproximately(-100f, Tolerance);

        var ray = new Ray2D(new Vec2(-96f, 0f), new Vec2(-1f, 0f));
        _world.RaycastClosest(ray, 5f, out RaycastHit2D hit).Should().BeTrue();
        hit.Shape.Should().Be(disc);
    }

    [Fact]
    public void WakeAllBodies_RousesEverySleepingDynamic()
    {
        BodyId sleeper = _world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 0f) });
        BodyId staticBody = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(5f, 0f) });
        _world.Bodies.SetSleeping(sleeper, true);

        _world.WakeAllBodies();

        _world.Bodies.IsAwake(sleeper).Should().BeTrue();
        _world.Bodies.GetTransform(staticBody).Position.Should().Be(new Vec2(5f, 0f));
    }

    [Fact]
    public void ClearForces_ZeroesAccumulatorsAcrossTheStore()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());
        BodyId other = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Bodies.ApplyForce(body, new Vec2(7f, 0f));
        _world.Bodies.ApplyTorque(body, 3f);

        _world.ClearForces();

        ref BodyState state = ref _world.Bodies.Slot(body);
        state.Force.Should().Be(Vec2.Zero);
        state.Torque.Should().Be(0f);
        ref BodyState staticState = ref _world.Bodies.Slot(other);
        staticState.Force.Should().Be(Vec2.Zero);
    }

    [Fact]
    public void GetStatistics_SnapshotsPopulationsAndTree()
    {
        AddStaticCircle(Vec2.Zero, 1f);
        BodyId dynamic = _world.Bodies.Create(new BodyDef { Position = new Vec2(10f, 0f) });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, dynamic, Vec2.Zero, 0.5f);

        World.PhysicsStatistics statistics = _world.GetStatistics();

        statistics.BodyCount.Should().Be(2);
        statistics.ShapeCount.Should().Be(2);
        statistics.BroadphaseItemCount.Should().Be(2);
        statistics.BroadphaseTreeHeight.Should().Be(1);
        statistics.BroadphaseMaxBalance.Should().Be(0);
        statistics.BroadphaseQuality.Should().BeGreaterThan(0f);

        BodyId doomed = _world.Bodies.Create(new BodyDef { Position = new Vec2(-10f, 0f) });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, doomed, Vec2.Zero, 0.5f);
        _world.GetStatistics().BodyCount.Should().Be(3);
    }

    [Fact]
    public void Validate_HoldsOnHealthyWorld()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies, _world.Broadphase, ground,
            new Vec2[] { new(-4f, 0f), new(4f, 0f), new(4f, 1f), new(-4f, 1f) });
        BodyId ball = _world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 2f) });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, ball, Vec2.Zero, 0.5f);

        for (int i = 0; i < 10; i++)
        {
            _world.Step(1f / 60f);
        }

        _world.Validate(out string? failure).Should().BeTrue();
        failure.Should().BeNull();
    }

    [Fact]
    public void Validate_CatchesCorruptedState()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());
        ref BodyState state = ref _world.Bodies.Slot(body);
        state.LocalCenter = new Vec2(float.NaN, 0f);

        _world.Validate(out string? failure).Should().BeFalse();
        failure.Should().NotBeNull();

        state.LocalCenter = Vec2.Zero;
        state.Flags |= BodyFlags.Awake | BodyFlags.Sleeping;
        _world.Validate(out failure).Should().BeFalse();
        failure.Should().Contain("awake/sleeping");
    }

    [Fact]
    public void Validate_CatchesContactsOnDeadShapes()
    {
        BodyId mover = _world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 0f) });
        ShapeId moving = _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, mover, Vec2.Zero, 1f);
        AddStaticCircle(new Vec2(0.5f, 0f), 1f);

        _world.Step(1f / 60f);
        _world.ContactCount.Should().Be(1);

        _world.Shapes.Detach(_world.Bodies, _world.Broadphase, moving);
        _world.Validate(out string? failure).Should().BeFalse();
        failure.Should().NotBeNull();
    }

    [Fact]
    public void TreeMetrics_ReportHeightBalanceAndQuality()
    {
        for (int i = 0; i < 8; i++)
        {
            AddStaticCircle(new Vec2(i * 3f, 0f), 1f);
        }

        TreeMetrics metrics = _world.Broadphase.ComputeMetrics();

        metrics.Height.Should().BeGreaterThanOrEqualTo(1);
        metrics.MaxBalance.Should().BeLessThanOrEqualTo(2);
        metrics.Quality.Should().BeGreaterThanOrEqualTo(1f);
    }

    [Fact]
    public void ShiftOrigin_KeepsRelativeGeometryForQueries()
    {
        AddStaticCircle(new Vec2(0f, 0f), 1f);
        BodyId ball = _world.Bodies.Create(new BodyDef { Position = new Vec2(2.5f, 0f) });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, ball, Vec2.Zero, 0.5f);

        _world.ShiftOrigin(new Vec2(-47f, 13f));

        var results = new ShapeId[8];
        _world.QueryPoint(new Vec2(47f, -13f), results).Should().Be(1);
        _world.Bodies.GetTransform(ball).Position.X.Should().BeApproximately(49.5f, Tolerance);
    }

    [Fact]
    public void PhysicsStatistics_IsValueSemanticSnapshot()
    {
        var first = new World.PhysicsStatistics(1, 2, 3, 4, 5L, 6, 7, 8, 9f);
        var second = first with { BodyCount = 1 };

        second.Should().Be(first);
        (first with { ContactCount = 99 }).Should().NotBe(first);
    }

    [Fact]
    public void DisabledBodies_StopGeneratingContacts()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies, _world.Broadphase, ground,
            new Vec2[] { new(-4f, 0f), new(4f, 0f), new(4f, 1f), new(-4f, 1f) });
        BodyId ball = _world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 0.4f) });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, ball, Vec2.Zero, 0.5f);

        _world.Step(1f / 60f);
        int baselineContacts = _world.ContactCount;
        baselineContacts.Should().Be(1);

        _world.Bodies.SetEnabled(ball, false);
        _world.Step(1f / 60f);
        _world.ContactCount.Should().Be(0);

        _world.Bodies.SetEnabled(ball, true);
        _world.Step(1f / 60f);
        _world.ContactCount.Should().Be(1);
    }
}
