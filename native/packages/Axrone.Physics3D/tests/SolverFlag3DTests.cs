using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Solver capability gate: every <see cref="SolverFlags"/> member either
/// changes what the step does or it does not exist. Each rule is measured by
/// flipping that one bit against the shipped 3D default and reporting the
/// numbers both sides produced, so a flag that goes quiet again fails here.
/// </summary>
public sealed class SolverFlag3DTests
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const float Overlap = 0.6f;
    private const float DriveSpeed = 9.0f;
    private const float FastSpeed = 60.0f;
    private static readonly Vec3 BoxHalf = new(Half, Half, Half);
    private const SolverFlags Shipped = SolverFlags.Default | SolverFlags.ContinuousDetection;
    private readonly ITestOutputHelper _output;

    public SolverFlag3DTests(ITestOutputHelper output) => _output = output;

    [Fact]
    public void RegisterTriple_DefaultNoneAndSleepingBodies_Diverge()
    {
        float shipped = SettleHeight(Shipped);
        float none = SettleHeight(SolverFlags.None);
        float sleepingOnly = SettleHeight(SolverFlags.SleepingBodies);

        _output.WriteLine(
            $"stack after 300 steps: Default|ContinuousDetection top y={shipped:0.#####} m, None y={none:0.#####} m, " +
            $"SleepingBodies y={sleepingOnly:0.#####} m");

        shipped.Should().BeGreaterThan(0.5f,
            $"the shipped flag set let a two-box stack settle at y={shipped:0.#####} m, below the bottom box's own top face.");
        none.Should().BeLessThan(shipped - 1.0f,
            $"Flags=None dropped the stack to y={none:0.#####} m against the shipped set's {shipped:0.#####} m; the " +
            "two configurations still share an outcome, so clearing every capability changes nothing.");
        sleepingOnly.Should().BeLessThan(shipped - 1.0f,
            $"Flags=SleepingBodies dropped the stack to y={sleepingOnly:0.#####} m against the shipped set's " +
            $"{shipped:0.#####} m; a lone capability bit must not carry the whole solver.");
    }

    [Fact]
    public void VelocityConstraints_Cleared_LeavesApproachVelocityUntouched()
    {
        float solved = VerticalSpeedAfterImpact(Shipped);
        float unsolved = VerticalSpeedAfterImpact(Shipped & ~SolverFlags.VelocityConstraints);

        _output.WriteLine(
            $"ball driven into the ground at {DriveSpeed} m/s: with the flag vy={solved:0.#####} m/s, " +
            $"without it vy={unsolved:0.#####} m/s");

        solved.Should().BeGreaterThanOrEqualTo(0.0f,
            $"solving the contact still left the ball moving into the ground at {solved:0.#####} m/s.");
        unsolved.Should().Be(-DriveSpeed,
            $"with VelocityConstraints cleared the ball left the step at {unsolved:0.#####} m/s instead of the " +
            $"incoming {-DriveSpeed:0.###} m/s, so the flag is not what stops the velocity pass.");
    }

    [Fact]
    public void PositionCorrection_Cleared_LeavesOverlapInPlace()
    {
        float lifted = OverlapLift(Shipped);
        float stillBuried = OverlapLift(Shipped & ~SolverFlags.PositionCorrection);

        _output.WriteLine(
            $"one step on a {Overlap} m overlap: with the flag dy={lifted:0.#####} m, without it dy={stillBuried:0.#####} m");

        lifted.Should().BeGreaterThan(0.1f,
            $"the position pass lifted the buried box by only {lifted:0.#####} m with the flag set.");
        stillBuried.Should().Be(0.0f,
            $"with PositionCorrection cleared the box still moved {stillBuried:0.#####} m, so something else is " +
            "paying for the separation the flag was supposed to skip.");
    }

    [Fact]
    public void WarmStarting_Cleared_OffersTheCarryAtZero()
    {
        float carried = OfferedImpulse(Shipped);
        float cold = OfferedImpulse(Shipped & ~SolverFlags.WarmStarting);
        float firstContact = OfferedImpulse(Shipped, stepsBeforeReading: 1);
        _output.WriteLine(
            $"impulse the pre-solve hook is offered on a settled pair: flag set {carried:0.#####} N*s, " +
            $"cleared {cold:0.#####} N*s, on the first contact step {firstContact:0.#####} N*s");

        carried.Should().BeGreaterThan(0.0f,
            $"a pair at rest offered {carried:0.#####} N*s of carried impulse, so warm start was not carrying " +
            "anything even with its bit set.");
        cold.Should().Be(0.0f,
            $"clearing WarmStarting still offered {cold:0.#####} N*s at the hook, so the carry is not gated by the flag.");
        firstContact.Should().Be(0.0f,
            $"the very first contact step offered {firstContact:0.#####} N*s, so the nonzero figure above is not a carry.");
    }

    [Fact]
    public void SleepingBodies_Cleared_KeepsARestingStackAwake()
    {
        bool sleepsWithFlag = RestsAsleep(Shipped);
        bool sleepsWithoutFlag = RestsAsleep(Shipped & ~SolverFlags.SleepingBodies);

        sleepsWithFlag.Should().BeTrue("the shipped flag set never put a quiet box to sleep within 300 steps.");
        sleepsWithoutFlag.Should().BeFalse(
            "clearing SleepingBodies still let the box sleep, so the one flag the register found live has gone dead.");
    }

    [Fact]
    public void ContinuousDetection_Cleared_UnsweepsFastBullets()
    {
        float stopped = ThroughWallTravel(Shipped, ccdSweepStep: 0.25f, bullet: true);
        float tunnelled = ThroughWallTravel(Shipped & ~SolverFlags.ContinuousDetection, ccdSweepStep: 0.25f, bullet: true);

        _output.WriteLine(
            $"bullet sphere at {FastSpeed} m/s against a 0.2 m wall: flag set ends at x={stopped:0.#####} m, " +
            $"cleared ends at x={tunnelled:0.#####} m");

        stopped.Should().BeLessThan(-0.1f,
            $"with ContinuousDetection set the bullet ended at x={stopped:0.#####} m, past the wall's near face.");
        tunnelled.Should().BeGreaterThan(0.5f,
            $"with ContinuousDetection cleared the bullet ended at x={tunnelled:0.#####} m, so the flag is not " +
            "what put the sweep under it.");
    }

    [Fact]
    public void SubStepping_Set_SlicesFastBodiesThatAreNotBullets()
    {
        float unsliced = ThroughWallTravel(Shipped, ccdSweepStep: 0.25f, bullet: false);
        float sliced = ThroughWallTravel(Shipped | SolverFlags.SubStepping, ccdSweepStep: 0.25f, bullet: false);

        _output.WriteLine(
            $"plain sphere at {FastSpeed} m/s against a 0.2 m wall: SubStepping cleared ends at x={unsliced:0.#####} m, " +
            $"set ends at x={sliced:0.#####} m");

        unsliced.Should().BeGreaterThan(0.5f,
            $"with SubStepping cleared the plain body stopped at x={unsliced:0.#####} m, so it was being sliced " +
            "by something other than the flag.");
        sliced.Should().BeLessThan(-0.1f,
            $"with SubStepping set the plain body ended at x={sliced:0.#####} m, so the flag bought no subdivision.");
    }

    private static float SettleHeight(SolverFlags flags)
    {
        using World world = new(new WorldDef { Flags = flags, Gravity = new Vec3(0.0f, -9.81f, 0.0f) });
        Ground(world);
        Box(world, Half - Overlap);
        BodyId upper = Box(world, Half - Overlap + ((2.0f * Half) - Overlap));

        for (int step = 0; step < 300; step++)
        {
            world.Step(Dt);
        }

        return world.Bodies.GetTransform(upper).Position.Y;
    }

    private static bool RestsAsleep(SolverFlags flags)
    {
        using World world = new(new WorldDef { Flags = flags, Gravity = new Vec3(0.0f, -9.81f, 0.0f) });
        Ground(world);
        BodyId box = world.Bodies.Create(new BodyDef
        {
            Position = new Vec3(0.0f, Half, 0.0f),
            AllowSleep = true,
        });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, box, Vec3.Zero, BoxHalf,
            1.0f, default, new PhysicsMaterial(0.7f, 0.0f));

        for (int step = 0; step < 300; step++)
        {
            world.Step(Dt);
            if (world.Bodies.IsSleeping(box))
            {
                return true;
            }
        }

        return false;
    }

    private static float VerticalSpeedAfterImpact(SolverFlags flags)
    {
        using World world = new(new WorldDef { Flags = flags, Gravity = Vec3.Zero });
        Ground(world);
        BodyId ball = world.Bodies.Create(new BodyDef
        {
            Position = new Vec3(0.0f, 0.5f - 0.05f, 0.0f),
            LinearVelocity = new Vec3(0.0f, -DriveSpeed, 0.0f),
            AllowSleep = false,
        });
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, ball, Vec3.Zero, 0.5f,
            1.0f, default, new PhysicsMaterial(0.0f, 0.0f));

        world.Step(Dt);
        return world.Bodies.GetLinearVelocity(ball).Y;
    }

    private static float OverlapLift(SolverFlags flags)
    {
        using World world = new(new WorldDef { Flags = flags, Gravity = Vec3.Zero });
        Ground(world);
        BodyId box = Box(world, Half - Overlap);

        float before = world.Bodies.GetTransform(box).Position.Y;
        world.Step(Dt);
        return world.Bodies.GetTransform(box).Position.Y - before;
    }

    private static float OfferedImpulse(SolverFlags flags, int stepsBeforeReading = 60)
    {
        using World world = new(new WorldDef { Flags = flags, Gravity = new Vec3(0.0f, -9.81f, 0.0f) });
        Ground(world);
        BodyId box = world.Bodies.Create(new BodyDef
        {
            Position = new Vec3(0.0f, Half - Overlap, 0.0f),
            AllowSleep = false,
        });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, box, Vec3.Zero, BoxHalf,
            1.0f, default, new PhysicsMaterial(0.7f, 0.0f));

        for (int step = 1; step < stepsBeforeReading; step++)
        {
            world.Step(Dt);
        }

        OfferContext offer = new();
        world.Step(Dt, new OfferHandler(), ref offer);
        return offer.Offered;
    }

    private static float ThroughWallTravel(SolverFlags flags, float ccdSweepStep, bool bullet)
    {
        using World world = new(new WorldDef
        {
            Flags = flags,
            CcdSweepStep = ccdSweepStep,
            MaxCcdSubsteps = 8,
            Gravity = Vec3.Zero,
        });

        BodyId wall = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, wall, Vec3.Zero,
            new Vec3(0.1f, 5.0f, 5.0f), 1.0f, default, new PhysicsMaterial(0.8f, 0.0f));

        BodyId ball = world.Bodies.Create(new BodyDef
        {
            Position = new Vec3(-5.5f, 0.0f, 0.0f),
            LinearVelocity = new Vec3(FastSpeed, 0.0f, 0.0f),
            Bullet = bullet,
            AllowSleep = false,
        });
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, ball, Vec3.Zero, 0.2f,
            1.0f, default, new PhysicsMaterial(0.0f, 0.0f));

        for (int step = 0; step < 20; step++)
        {
            world.Step(Dt);
        }

        return world.Bodies.GetTransform(ball).Position.X;
    }

    private static void Ground(World world)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground,
            new Vec3(0.0f, -0.5f, 0.0f), new Vec3(10.0f, 0.5f, 10.0f), 1.0f, default, new PhysicsMaterial(0.8f, 0.0f));
    }

    private static BodyId Box(World world, float y)
    {
        BodyId box = world.Bodies.Create(new BodyDef
        {
            Position = new Vec3(0.0f, y, 0.0f),
            AllowSleep = false,
        });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, box, Vec3.Zero, BoxHalf,
            1.0f, default, new PhysicsMaterial(0.7f, 0.0f));
        return box;
    }

    private sealed class OfferContext
    {
        public float Offered;
    }

    private readonly struct OfferHandler : IContactSolverCallbacks<Contact3D, Manifold3D, OfferContext>
    {
        public static void OnPreSolve(ref Contact3D contact, ref Manifold3D manifold, ref ContactTuning tuning, ref OfferContext context)
        {
            if (manifold.Count > 0 && manifold[0].NormalImpulse > context.Offered)
            {
                context.Offered = manifold[0].NormalImpulse;
            }
        }

        public static void OnPostSolve(ref readonly Contact3D contact, in Manifold3D manifold, in ContactImpulses impulses, ref OfferContext context)
        {
        }
    }
}
