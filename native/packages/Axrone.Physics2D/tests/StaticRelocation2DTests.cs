namespace Axrone.Physics2D.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Gates a support placed outside the integrator. A static or kinematic body
/// moved through the transform API is never touched by the integrator, so
/// unless the world refreshes its broadphase nodes before pair collection and
/// wakes what the placement swept, the move simply does not exist for the
/// bodies resting on it.
/// </summary>
public sealed class StaticRelocation2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float BoxHalf = 0.5f;
    private const float LinearSlop = 0.005f;
    private const float AnalyticRestY = BoxHalf - LinearSlop;

    private readonly World _world;

    public StaticRelocation2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Static slab centred at (0, -1), local half extents (halfWidth, 1): top surface at y = 0.</summary>
    private static BodyId AddGround(World world, float halfWidth = 10.0f)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        world.Shapes.AttachPolygon(
            world.Bodies,
            world.Broadphase,
            ground,
            new Vec2[]
            {
                new(-halfWidth, -1.0f),
                new(halfWidth, -1.0f),
                new(halfWidth, 1.0f),
                new(-halfWidth, 1.0f),
            },
            material: new PhysicsMaterial(0.8f, 0.0f));
        return ground;
    }

    private static BodyId AddBox(
        World world,
        Vec2 center,
        float half = BoxHalf,
        BodyType type = BodyType.Dynamic,
        bool allowSleep = true,
        float friction = 0.7f)
    {
        BodyId body = world.Bodies.Create(new BodyDef { Type = type, Position = center, AllowSleep = allowSleep });
        world.Shapes.AttachPolygon(
            world.Bodies,
            world.Broadphase,
            body,
            new Vec2[] { new(-half, -half), new(half, -half), new(half, half), new(-half, half) },
            material: new PhysicsMaterial(friction, 0.0f));
        return body;
    }

    private static int SleepStep(World world, BodyId body, int limit)
    {
        for (int step = 0; step < limit; step++)
        {
            world.Step(Dt);
            if (!world.Bodies.IsAwake(body))
            {
                return step;
            }
        }

        return -1;
    }

    /// <summary>
    /// The register's E1: a sleeping cube whose ground is taken one metre down.
    /// Base build never woke it — the cube stayed at 0.495 for 120 steps above a
    /// surface that was no longer there.
    /// </summary>
    [Fact]
    public void SupportDroppedUnderSleepingCube_WakesItAndItLandsOnTheNewSurface()
    {
        BodyId ground = AddGround(_world);
        BodyId box = AddBox(_world, new Vec2(0.0f, 0.4f));
        int sleepStep = SleepStep(_world, box, 120);
        sleepStep.Should().BeGreaterThan(-1, "the control half of this row: the cube must actually be asleep before the support moves");

        _world.Bodies.SetTransform(ground, new Vec2(0.0f, -2.0f), 0.0f);

        int wakeStep = -1;
        int firstFallStep = -1;
        for (int step = 0; step < 120; step++)
        {
            _world.Step(Dt);
            if (wakeStep < 0 && _world.Bodies.IsAwake(box))
            {
                wakeStep = step;
            }

            if (firstFallStep < 0 && _world.Bodies.GetLinearVelocity(box).Y < -0.01f)
            {
                firstFallStep = step;
            }
        }

        Vec2 rest = _world.Bodies.GetTransform(box).Position;
        float analytic = -1.0f + AnalyticRestY;
        wakeStep.Should().BeLessThanOrEqualTo(1,
            $"a support withdrawn from under a sleeper must wake it within one step of the placement; measured wake step {wakeStep} (sleep happened at {sleepStep})");
        firstFallStep.Should().BeLessThanOrEqualTo(2,
            $"gravity must take the cube immediately; measured first downward step {firstFallStep}");
        Math.Abs(rest.Y - analytic).Should().BeLessThan(0.02f,
            $"the cube must come to rest on the new surface top at y = -1, i.e. centre {analytic:R}; measured ({rest.X:R},{rest.Y:R})");
        _world.Bodies.IsAwake(box).Should().BeFalse(
            $"it must also go back to sleep on the new support; measured awake = {_world.Bodies.IsAwake(box)}");
    }

    /// <summary>
    /// Negative control: a support that was never placed must not disturb a
    /// sleeper at all, so the wake path above cannot be passing by making
    /// everything awake.
    /// </summary>
    [Fact]
    public void UntouchedSupport_KeepsSleepingCubeAsleep()
    {
        BodyId ground = AddGround(_world);
        BodyId box = AddBox(_world, new Vec2(0.0f, 0.4f));
        int sleepStep = SleepStep(_world, box, 120);
        Vec2 before = _world.Bodies.GetTransform(box).Position;

        for (int step = 0; step < 120; step++)
        {
            _world.Step(Dt);
        }

        Vec2 after = _world.Bodies.GetTransform(box).Position;
        ground.Should().NotBe(default);
        (after.X == before.X && after.Y == before.Y).Should().BeTrue(
            $"a sleeper on an untouched support must not move by one bit; measured {before} then {after}, asleep = {!_world.Bodies.IsAwake(box)}");
        _world.Bodies.IsAwake(box).Should().BeFalse(
            $"the cube slept at step {sleepStep} and nothing was placed; measured awake = {_world.Bodies.IsAwake(box)}");
    }

    /// <summary>
    /// The register's E3: the support slides twenty metres sideways out from
    /// under a sleeping cube. Base build left it floating with nothing beneath
    /// it, because the old position is exactly what the sweep has to cover.
    /// </summary>
    [Fact]
    public void SupportSlidSidewaysFromUnderSleepingCube_DropsIt()
    {
        BodyId ground = AddGround(_world);
        BodyId box = AddBox(_world, new Vec2(0.0f, 0.4f));
        SleepStep(_world, box, 120);
        Vec2 before = _world.Bodies.GetTransform(box).Position;

        _world.Bodies.SetTransform(ground, new Vec2(20.0f, -1.0f), 0.0f);

        int wakeStep = -1;
        for (int step = 0; step < 120; step++)
        {
            _world.Step(Dt);
            if (wakeStep < 0 && _world.Bodies.IsAwake(box))
            {
                wakeStep = step;
            }
        }

        Vec2 after = _world.Bodies.GetTransform(box).Position;
        wakeStep.Should().BeLessThanOrEqualTo(1,
            $"a support removed sideways must still wake what it was holding; measured wake step {wakeStep}");
        (before.Y - after.Y).Should().BeGreaterThan(0.5f,
            $"with nothing underneath, the cube must fall; measured y {before.Y:R} to {after.Y:R}, a drop of {before.Y - after.Y:R} m in 120 steps");
    }

    /// <summary>
    /// The register's R6.3: a static platform teleported up into a falling cube,
    /// with no caller-side sync at all. Base build let the cube pass straight
    /// through and land on the ground five metres below.
    /// </summary>
    [Fact]
    public void StaticPlatformMovedUpIntoFallingCube_CatchesItWithoutCallerSync()
    {
        AddGround(_world);
        BodyId platform = AddBox(_world, new Vec2(0.0f, -8.0f), 2.0f, BodyType.Static, friction: 0.8f);
        BodyId box = AddBox(_world, new Vec2(0.0f, 6.0f), allowSleep: false);

        for (int step = 0; step < 24; step++)
        {
            _world.Step(Dt);
        }

        Vec2 intercept = _world.Bodies.GetTransform(box).Position;
        _world.Bodies.SetTransform(platform, new Vec2(0.0f, 3.0f), 0.0f);

        for (int step = 0; step < 240; step++)
        {
            _world.Step(Dt);
        }

        Vec2 rest = _world.Bodies.GetTransform(box).Position;
        float analytic = 3.0f + 2.0f + AnalyticRestY;
        rest.Y.Should().BeApproximately(analytic, 0.02f,
            $"the platform top is at y = 5 after the placement, so the cube must rest at {analytic:R}; it passed through at y {intercept.Y:R} on the base build and measured {rest.Y:R} here");
    }

    /// <summary>
    /// Negative control: a platform left parked well below the drop path must
    /// catch nothing, so the row above cannot be passing because every body is
    /// stopped by every static.
    /// </summary>
    [Fact]
    public void PlatformLeftParked_CubeFallsToTheGround()
    {
        AddGround(_world);
        BodyId platform = AddBox(_world, new Vec2(0.0f, -8.0f), 2.0f, BodyType.Static, friction: 0.8f);
        BodyId box = AddBox(_world, new Vec2(0.0f, 6.0f), allowSleep: false);

        _world.Bodies.SetTransform(platform, new Vec2(0.0f, -20.0f), 0.0f);
        for (int step = 0; step < 240; step++)
        {
            _world.Step(Dt);
        }

        Vec2 rest = _world.Bodies.GetTransform(box).Position;
        rest.Y.Should().BeApproximately(AnalyticRestY, 0.02f,
            $"nothing was placed in the cube's path, so it must reach the ground at {AnalyticRestY:R}; measured {rest.Y:R}");
    }

    /// <summary>
    /// The register's E4/6c observed from the awake side: after a support is
    /// dropped under a live cube, the recovery and the separation the manifold
    /// reports must agree with the true overlap. Base build left the cube on the
    /// old surface and reported a resting separation while it actually floated
    /// 0.995 m above the support.
    /// </summary>
    [Fact]
    public void SupportDroppedUnderAwakeCube_RecoversWithoutBuryingItself()
    {
        BodyId ground = AddGround(_world);
        BodyId box = AddBox(_world, new Vec2(0.0f, AnalyticRestY), allowSleep: false);

        for (int step = 0; step < 30; step++)
        {
            _world.Step(Dt);
        }

        _world.Bodies.SetTransform(ground, new Vec2(0.0f, -2.0f), 0.0f);
        for (int step = 0; step < 240; step++)
        {
            _world.Step(Dt);
        }

        Vec2 rest = _world.Bodies.GetTransform(box).Position;
        float analytic = -1.0f + AnalyticRestY;
        Math.Abs(rest.Y - analytic).Should().BeLessThan(0.02f,
            $"the cube must follow its support down to the new surface (centre {analytic:R}); measured {rest.Y:R}");

        float trueOverlap = rest.Y - BoxHalf - -1.0f;
        float reportedSeparation = ReportSeparation(_world);
        Math.Abs(reportedSeparation - -Math.Abs(trueOverlap)).Should().BeLessThan(1e-6f,
            $"the manifold must report the overlap that exists: true {trueOverlap:R} m, reported {reportedSeparation:R} m (base measured reported -0.004999995 against a true gap of 0.995 m)");
    }

    /// <summary>
    /// Calibration control for the row above: a plain resting box must already
    /// satisfy separation equals overlap, so a failure there is the defect and
    /// not the instrument.
    /// </summary>
    [Fact]
    public void RestingBox_ReportsSeparationMatchingTrueOverlap()
    {
        AddGround(_world);
        BodyId box = AddBox(_world, new Vec2(0.0f, 0.4f), allowSleep: false);

        for (int step = 0; step < 240; step++)
        {
            _world.Step(Dt);
        }

        Vec2 rest = _world.Bodies.GetTransform(box).Position;
        float trueOverlap = rest.Y - BoxHalf;
        float reportedSeparation = ReportSeparation(_world);
        Math.Abs(reportedSeparation - trueOverlap).Should().BeLessThan(1e-6f,
            $"a box resting at {rest.Y:R} overlaps the surface by {trueOverlap:R} m and the manifold must say so; it reported {reportedSeparation:R}");
    }

    /// <summary>
    /// The new path must be deterministic: the same placement script run twice
    /// on independent worlds ends bit-identically, since a relocation entering
    /// the tree changes pair order and any nondeterminism would show up here.
    /// </summary>
    [Fact]
    public void SupportTeleportScenario_IsBitReproducible()
    {
        Vec2 First(World world)
        {
            BodyId ground = AddGround(world);
            BodyId box = AddBox(world, new Vec2(0.0f, 0.4f));
            SleepStep(world, box, 60);
            world.Bodies.SetTransform(ground, new Vec2(0.0f, -2.0f), 0.0f);
            for (int step = 0; step < 120; step++)
            {
                world.Step(Dt);
            }

            return world.Bodies.GetTransform(box).Position;
        }

        using var a = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
        using var b = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
        Vec2 fromA = First(a);
        Vec2 fromB = First(b);

        (fromA.X == fromB.X && fromA.Y == fromB.Y).Should().BeTrue(
            $"two independent worlds running the same placement must agree to the bit; measured ({fromA.X:R},{fromA.Y:R}) and ({fromB.X:R},{fromB.Y:R})");
    }

    /// <summary>
    /// Row 6e is a 3D defect that 2D never shipped: its island forest excludes
    /// every non-dynamic slot, so one restless body sharing a static support
    /// cannot pin its neighbour. Pinned here with both sleep steps published.
    /// </summary>
    [Fact]
    public void RestlessNeighbourOnTheSameSupport_DoesNotDelaySleep()
    {
        using var alone = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
        AddGround(alone);
        BodyId sleeperAlone = AddBox(alone, new Vec2(0.0f, 0.4f));
        int aloneStep = SleepStep(alone, sleeperAlone, 600);

        AddGround(_world);
        BodyId sleeper = AddBox(_world, new Vec2(0.0f, 0.4f));
        BodyId restless = AddBox(_world, new Vec2(1.6f, 0.4f), allowSleep: false);
        int withNeighbour = SleepStep(_world, sleeper, 600);

        aloneStep.Should().BeGreaterThan(-1, $"the baseline must sleep at all; measured sleep step {aloneStep}");
        withNeighbour.Should().BeGreaterThan(-1,
            $"a body sharing only the static support must not be pinned by it; 3D measured never in 600 steps, 2D baseline slept at {aloneStep} and this run measured {withNeighbour}");
        Math.Abs(withNeighbour - aloneStep).Should().BeLessThanOrEqualTo(1,
            $"the neighbour may not delay the sleeper beyond the baseline either; baseline {aloneStep}, with neighbour {withNeighbour}");
        _world.Bodies.IsAwake(restless).Should().BeTrue(
            "the restless body itself must still never sleep; pinning was not deleted");
    }

    private static float ReportSeparation(World world)
    {
        for (int c = 0; c < world.ContactCount; c++)
        {
            ContactManifold manifold = world.GetContact(c).Manifold;
            if (manifold.Count > 0)
            {
                return manifold.GetPointRO(0).Separation;
            }
        }

        return float.NaN;
    }
}
