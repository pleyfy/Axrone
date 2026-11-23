namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class Ccd2DTests : IDisposable
{
    private const float Dt = 1f / 60f;

    private readonly World _world;

    public Ccd2DTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private BodyId AddWall(float wallMinX, float thickness)
    {
        BodyId wall = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(wallMinX + (thickness / 2f), 0) });
        _world.Shapes.AttachPolygon(
            _world.Bodies, _world.Broadphase, wall,
            new Vec2[]
            {
                new(-thickness / 2f, -5f),
                new(thickness / 2f, -5f),
                new(thickness / 2f, 5f),
                new(-thickness / 2f, 5f),
            });
        return wall;
    }

    private BodyId AddBall(Vec2 center, Vec2 velocity, bool bullet)
    {
        BodyId ball = _world.Bodies.Create(new BodyDef
        {
            Position = center,
            LinearVelocity = velocity,
            Bullet = bullet,
        });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, ball, new Vec2(0, 0), 0.5f);
        return ball;
    }

    [Fact]
    public void Bullet_Stops_AtThinWall()
    {
        AddWall(10f, 0.2f);
        BodyId ball = AddBall(new Vec2(0.9f, 0), new Vec2(120, 0), bullet: true);

        for (int i = 0; i < 30; i++)
        {
            _world.Step(Dt);
        }

        float x = _world.Bodies.GetTransform(ball).Position.X;
        x.Should().BeLessThan(10f + 0.5f + 0.3f);
        _world.ContactCount.Should().BeGreaterThan(0);
    }

    [Fact]
    public void NonBullet_Tunnels_ThroughThinWall()
    {
        AddWall(10f, 0.2f);
        BodyId ball = AddBall(new Vec2(0.9f, 0), new Vec2(120, 0), bullet: false);

        for (int i = 0; i < 30; i++)
        {
            _world.Step(Dt);
        }

        float x = _world.Bodies.GetTransform(ball).Position.X;
        x.Should().BeGreaterThan(10.2f);
    }

    [Fact]
    public void SlowNonBullet_DoesNotTunnel()
    {
        AddWall(10f, 0.2f);
        BodyId ball = AddBall(new Vec2(8, 0), new Vec2(2, 0), bullet: false);

        for (int i = 0; i < 120; i++)
        {
            _world.Step(Dt);
        }

        float x = _world.Bodies.GetTransform(ball).Position.X;
        x.Should().BeLessThan(10f + 0.5f + 0.3f);
    }

    [Fact]
    public void FastestBullet_RespectsSubstepCap()
    {
        AddWall(10f, 0.2f);
        BodyId ball = AddBall(new Vec2(0, 0), new Vec2(120, 0), bullet: true);

        for (int i = 0; i < 30; i++)
        {
            _world.Step(Dt);
        }

        float x = _world.Bodies.GetTransform(ball).Position.X;
        x.Should().BeLessThan(10f + 0.5f + 0.3f);
    }

    /// <summary>
    /// The 2D default must come from the shared constant, the same way 3D reads
    /// it. Until this row the two packages carried the same number from different
    /// sources — one literal here, one constant there — so lowering the shared
    /// budget moved 3D and left 2D where it was, silently.
    /// </summary>
    [Fact]
    public void ShippedDefault_ReadsTheSharedSubStepBudget()
    {
        using var world = new World();

        world.MaxCcdSubsteps.Should().Be(PhysicsConstants.MaxSubSteps,
            $"the steady-state sub-step budget is one number owned by PhysicsConstants, not a copy per dimension; world carries {world.MaxCcdSubsteps} and the shared constant is {PhysicsConstants.MaxSubSteps}");
    }

    /// <summary>
    /// And the number itself has to be worth pinning. The cap is the ceiling on
    /// how finely one step may be cut, so a bullet that demands more slices than
    /// it can have gets exactly the cap, a bullet inside the budget gets the
    /// number it asked for, and a world with nothing fast in it stays at one.
    /// Lowering the shared budget moves all three rows together; nothing here is
    /// a restatement of the constant.
    /// </summary>
    [Fact]
    public void SubStepBudget_IsTheCeilingOnTheSlicesAStepActuallyRuns()
    {
        const float SweepStep = 0.25f;
        int cap = PhysicsConstants.MaxSubSteps;

        static int SlicesAt(float speed, float sweepStep)
        {
            using var world = new World(new WorldDef { Gravity = Vec2.Zero, CcdSweepStep = sweepStep });
            BodyId ball = world.Bodies.Create(new BodyDef
            {
                Position = new Vec2(0.0f, 0.0f),
                LinearVelocity = new Vec2(speed, 0.0f),
                Bullet = true,
                AllowSleep = false,
            });
            world.Shapes.AttachCircle(world.Bodies, world.Broadphase, ball, Vec2.Zero, 0.1f);
            world.Step(Dt);
            return world.LastCcdSlices;
        }

        // travel = speed * dt; slices asked = ceil(travel / sweepStep).
        float askedExactlyTheCap = cap * SweepStep / Dt;
        float askedTripleTheCap = 3.0f * askedExactlyTheCap;
        float askedOneSlice = SweepStep / Dt * 0.5f;

        SlicesAt(askedExactlyTheCap, SweepStep).Should().Be(cap,
            $"a bullet covering {askedExactlyTheCap * Dt:R} m in one step asks for {cap} slices at a {SweepStep:R} m sweep, which the budget allows; row fails the moment the budget drops below what the scene asks for");
        SlicesAt(askedTripleTheCap, SweepStep).Should().Be(cap,
            $"a bullet asking for {3 * cap} slices is held to the budget of {cap}; the ceiling is what this row pins");
        SlicesAt(askedOneSlice, SweepStep).Should().Be(1,
            $"a bullet covering {askedOneSlice * Dt:R} m, inside one {SweepStep:R} m sweep, must not be subdivided at all — the cap is a ceiling, not a floor");
        SlicesAt(askedTripleTheCap, SweepStep / 2.0f).Should().Be(cap,
            $"halving the sweep step doubles the demand to {6 * cap} and the ceiling still holds at {cap}");
    }

    [Fact]
    public void WorldDef_BadCcdTuning_Throws()
    {
        Action sweep = () => _ = new WorldDef { CcdSweepStep = 0f };
        Action cap = () => _ = new WorldDef { MaxCcdSubsteps = 0 };

        sweep.Should().Throw<InvalidOperationException>();
        cap.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void HeadOnBullets_MeetInsteadOfPassingThrough()
    {
        BodyId left = _world.Bodies.Create(new BodyDef
        {
            Position = new Vec2(-0.1f, 0),
            LinearVelocity = new Vec2(12, 0),
            Bullet = true,
        });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, left, new Vec2(0, 0), 0.05f);

        BodyId right = _world.Bodies.Create(new BodyDef
        {
            Position = new Vec2(0.1f, 0),
            LinearVelocity = new Vec2(-12, 0),
            Bullet = true,
        });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, right, new Vec2(0, 0), 0.05f);

        _world.Step(Dt);

        _world.ContactCount.Should().BeGreaterThan(0);
    }

    [Fact]
    public void FastSpin_DoesNotExplode()
    {
        BodyId spinner = _world.Bodies.Create(new BodyDef
        {
            Position = new Vec2(0, 2),
            LinearVelocity = new Vec2(1, 0),
            AngularVelocity = 20f,
            Bullet = true,
        });
        _world.Shapes.AttachPolygon(
            _world.Bodies, _world.Broadphase, spinner,
            new Vec2[]
            {
                new(-2f, -0.1f),
                new(2f, -0.1f),
                new(2f, 0.1f),
                new(-2f, 0.1f),
            });

        for (int i = 0; i < 60; i++)
        {
            _world.Step(Dt);
        }

        Vec2 p = _world.Bodies.GetTransform(spinner).Position;
        p.X.Should().BeGreaterThan(-30f);
        p.X.Should().BeLessThan(30f);
        float.IsNaN(p.X).Should().BeFalse();
        float.IsNaN(p.Y).Should().BeFalse();
    }
}
