using Axrone.Numeric;
using Axrone.Physics.Core;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Contact break band gate: a solid pair that opened a gap no wider than
/// <see cref="PhysicsConstants.ContactBreakThreshold"/> is still the same pair
/// and keeps its identity in the contact set and the event stream, while a pair
/// wider than the band leaves and reports Ended. The band tracks the pair and
/// never supports it, and a carried warm-start impulse only follows a witness
/// that stayed inside <see cref="PhysicsConstants.ContactPersistentThresholdSq"/>.
/// </summary>
public sealed class ContactBreakBand3DTests
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const float HairGap = 0.0001f;
    private const float InsideBand = 0.019f;
    private const float BeyondBand = 0.021f;
    private const float WiderThanBand = 0.05f;
    private const float SlideWithinThreshold = 0.05f;
    private const float SlideBeyondThreshold = 0.5f;
    private readonly ITestOutputHelper _output;

    public ContactBreakBand3DTests(ITestOutputHelper output) => _output = output;

    [Theory]
    [InlineData(HairGap)]
    [InlineData(0.01f)]
    [InlineData(InsideBand)]
    public void Pair_InsideTheBand_KeepsItsIdentity(float gap)
    {
        using World world = new(new WorldDef { Gravity = Vec3.Zero });
        Ground(world);
        BodyId box = Placed(world, -0.005f);
        world.Step(Dt);
        world.ContactCount.Should().Be(1, "the pair must start in contact before the band can hold it.");

        MoveToGap(world, box, gap);
        int leastTracked = world.ContactCount;
        int ended = 0;
        for (int step = 0; step < 30; step++)
        {
            world.Step(Dt);
            leastTracked = Math.Min(leastTracked, world.ContactCount);
            ended += CountEvents(world, ContactEventType.Ended);
        }

        _output.WriteLine($"gap {gap:0.#####} m over 30 steps: least contacts {leastTracked}, Ended events {ended}");
        leastTracked.Should().Be(1,
            $"a pair that opened only {gap:0.#####} m of gap, inside the " +
            $"{PhysicsConstants.ContactBreakThreshold:0.###} m band, still dropped out of the contact set.");
        ended.Should().Be(0,
            $"a {gap:0.#####} m gap inside the band raised {ended} Ended event(s).");
    }

    [Theory]
    [InlineData(BeyondBand)]
    [InlineData(WiderThanBand)]
    public void Pair_BeyondTheBand_BreaksAndReportsEnded(float gap)
    {
        using World world = new(new WorldDef { Gravity = Vec3.Zero });
        Ground(world);
        BodyId box = Placed(world, -0.005f);
        world.Step(Dt);

        MoveToGap(world, box, gap);
        world.Step(Dt);
        int ended = CountEvents(world, ContactEventType.Ended);

        _output.WriteLine($"gap {gap:0.#####} m: contacts {world.ContactCount}, Ended events {ended}");
        world.ContactCount.Should().Be(0,
            $"a {gap:0.#####} m gap is wider than the {PhysicsConstants.ContactBreakThreshold:0.####} m band, yet " +
            $"{world.ContactCount} pair(s) are still tracked.");
        ended.Should().Be(1, $"the broken pair raised {ended} Ended event(s) instead of exactly one.");
    }

    [Fact]
    public void Band_TracksThePair_ButNeverHoldsABodyUp()
    {
        using World world = new(new WorldDef { Gravity = Vec3.Zero });
        Ground(world);
        BodyId box = Placed(world, -0.005f);
        world.Step(Dt);

        MoveToGap(world, box, 0.01f);
        world.Gravity = new Vec3(0.0f, -9.81f, 0.0f);
        world.Step(Dt);
        float afterOneStep = world.Bodies.GetTransform(box).Position.Y;
        for (int step = 0; step < 60; step++)
        {
            world.Step(Dt);
        }

        float settled = world.Bodies.GetTransform(box).Position.Y;
        _output.WriteLine(
            $"pair held {0.01f:0.###} m apart with gravity switched on at the band: y={afterOneStep:0.#####} m " +
            $"after one step, y={settled:0.#####} m after 61, contacts {world.ContactCount}");

        afterOneStep.Should().BeLessThan(Half + 0.01f,
            $"a body {0.01f:0.###} m above the ground inside the band did not fall at all " +
            $"(y={afterOneStep:0.#####} m), so the band is supporting it.");
        settled.Should().BeApproximately(Half - PhysicsConstants.LinearSlop, 0.01f,
            $"the body that fell through the band came to rest at {settled:0.#####} m, off the " +
            $"{(Half - PhysicsConstants.LinearSlop):0.###} m the slop allows.");
    }

    [Theory]
    [InlineData(SlideWithinThreshold, true)]
    [InlineData(SlideBeyondThreshold, false)]
    public void CarriedImpulse_FollowsTheWitnessDriftRule(float slide, bool expectCarry)
    {
        using World world = new(new WorldDef { Gravity = new Vec3(0.0f, -9.81f, 0.0f) });
        Ground(world);
        BodyId box = Placed(world, -0.005f, friction: 0.0f);
        for (int step = 0; step < 30; step++)
        {
            world.Step(Dt);
        }

        float before = world.Bodies.GetTransform(box).Position.X;
        world.Bodies.SetTransform(box, new Vec3(before + slide, Half - PhysicsConstants.LinearSlop, 0.0f), Quat.Identity);
        OfferContext offer = new();
        world.Step(Dt, new OfferHandler(), ref offer);

        _output.WriteLine(
            $"pair slid {slide:0.###} m in one step (threshold " +
            $"{MathF.Sqrt(PhysicsConstants.ContactPersistentThresholdSq):0.###} m): carried impulse offered " +
            $"{offer.Offered:0.#####} N*s, contacts {world.ContactCount}");

        world.ContactCount.Should().BeGreaterThan(0,
            $"sliding the box {slide:0.###} m removed the pair from the contact set, so this measured an " +
            "absence rather than a rejection.");
        if (expectCarry)
        {
            offer.Offered.Should().BeGreaterThan(0.0f,
                $"a witness that moved {slide:0.###} m, inside the " +
                $"{MathF.Sqrt(PhysicsConstants.ContactPersistentThresholdSq):0.###} m threshold, was refused its " +
                "carry, so the threshold rejects what it should keep.");
        }
        else
        {
            offer.Offered.Should().Be(0.0f,
                $"a witness that jumped {slide:0.###} m — beyond the " +
                $"{MathF.Sqrt(PhysicsConstants.ContactPersistentThresholdSq):0.###} m threshold — still carried " +
                $"{offer.Offered:0.#####} N*s of impulse earned somewhere else.");
        }
    }

    [Fact]
    public void Band_NeverInventsAPair_ThatNeverTouched()
    {
        using World world = new(new WorldDef { Gravity = Vec3.Zero });
        Ground(world);
        BodyId box = Placed(world, HairGap);

        int mostTracked = 0;
        int began = 0;
        for (int step = 0; step < 10; step++)
        {
            world.Step(Dt);
            mostTracked = Math.Max(mostTracked, world.ContactCount);
            began += CountEvents(world, ContactEventType.Began);
        }

        _output.WriteLine($"pair that started {HairGap:0.#####} m apart and never touched: most contacts " +
            $"{mostTracked}, Began events {began}");
        mostTracked.Should().Be(0,
            $"a pair sitting {HairGap:0.#####} m apart with no prior touch was tracked as a contact.");
        began.Should().Be(0, $"the band raised {began} Began event(s) for a pair that never met.");
    }

    [Fact]
    public void Band_SkipsSensorPairs()
    {
        using World world = new(new WorldDef { Gravity = Vec3.Zero });
        BodyId scenery = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, scenery,
            new Vec3(0.0f, -0.5f, 0.0f), new Vec3(10.0f, 0.5f, 10.0f), 1.0f, default,
            new PhysicsMaterial(0.8f, 0.0f), isSensor: true);
        BodyId box = Placed(world, -0.005f);

        world.Step(Dt);
        int whileOverlapping = world.SensorEventCount;
        MoveToGap(world, box, HairGap);
        world.Step(Dt);
        int exits = 0;
        int tracked = world.ContactCount;
        for (int i = 0; i < world.SensorEventCount; i++)
        {
            if (world.GetSensorEvent(i).Type == SensorEventType.Exit)
            {
                exits++;
            }
        }

        _output.WriteLine($"sensor pair one hair of daylight apart: tracked contacts {tracked}, Exit events {exits}, " +
            $"sensor notices on the overlap step {whileOverlapping}");
        whileOverlapping.Should().Be(1, "the overlap step must have raised exactly one sensor notice.");
        tracked.Should().Be(0, $"the band carried a sensor pair across a {HairGap:0.#####} m gap.");
        exits.Should().Be(1, $"a sensor pair that split raised {exits} Exit event(s) instead of exactly one.");
    }

    [Fact]
    public void Band_SkipsBodiesThatLeftTheSimulation()
    {
        using World world = new(new WorldDef { Gravity = Vec3.Zero });
        Ground(world);
        BodyId box = Placed(world, -0.005f);
        world.Step(Dt);

        MoveToGap(world, box, HairGap);
        world.Bodies.SetEnabled(box, false);
        world.Step(Dt);
        int tracked = world.ContactCount;
        int ended = CountEvents(world, ContactEventType.Ended);

        _output.WriteLine($"disabled body inside the band: tracked contacts {tracked}, Ended events {ended}");
        tracked.Should().Be(0,
            $"a body that left the simulation still held a pair in the contact set ({tracked}).");
        ended.Should().Be(1, $"the disabled pair raised {ended} Ended event(s) instead of exactly one.");
        world.Validate().Should().BeTrue("the contact set no longer names only live entities.");
    }

    [Fact]
    public void Band_Bookkeeping_AllocatesNothingPerStep()
    {
        using World world = new(new WorldDef { Gravity = Vec3.Zero });
        Ground(world);
        BodyId box = Placed(world, -0.005f);
        world.Step(Dt);
        MoveToGap(world, box, HairGap);

        for (int warm = 0; warm < 8; warm++)
        {
            world.Step(Dt);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int step = 0; step < 1000; step++)
        {
            world.Step(Dt);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        _output.WriteLine($"1000 steps with one pair parked in the band allocated {allocated} B");
        allocated.Should().Be(0L,
            $"{allocated} B allocated over 1000 steady steps of a world holding one band-tracked pair.");
    }

    private static BodyId Ground(World world)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, ground,
            new Vec3(0.0f, -0.5f, 0.0f), new Vec3(10.0f, 0.5f, 10.0f), 1.0f, default, new PhysicsMaterial(0.8f, 0.0f));
        return ground;
    }

    private static BodyId Placed(World world, float gap, float friction = 0.7f)
    {
        BodyId box = world.Bodies.Create(new BodyDef
        {
            Position = new Vec3(0.0f, Half + gap, 0.0f),
            AllowSleep = false,
        });
        world.Shapes.AttachBox(world.Bodies, world.Broadphase, box, Vec3.Zero, new Vec3(Half, Half, Half),
            1.0f, default, new PhysicsMaterial(friction, 0.0f));
        return box;
    }

    private static void MoveToGap(World world, BodyId box, float gap)
    {
        Vec3 at = world.Bodies.GetTransform(box).Position;
        world.Bodies.SetTransform(box, new Vec3(at.X, Half + gap, at.Z), Quat.Identity);
    }

    private static int CountEvents(World world, ContactEventType type)
    {
        int hits = 0;
        for (int i = 0; i < world.ContactEventCount; i++)
        {
            if (world.GetContactEvent(i).Type == type)
            {
                hits++;
            }
        }

        return hits;
    }

    private sealed class OfferContext
    {
        public float Offered;
    }

    private readonly struct OfferHandler : IContactSolverCallbacks<Contact3D, Manifold3D, OfferContext>
    {
        public static void OnPreSolve(ref Contact3D contact, ref Manifold3D manifold, ref ContactTuning tuning, ref OfferContext context)
        {
            for (int p = 0; p < manifold.Count; p++)
            {
                if (manifold[p].NormalImpulse > context.Offered)
                {
                    context.Offered = manifold[p].NormalImpulse;
                }
            }
        }

        public static void OnPostSolve(ref readonly Contact3D contact, in Manifold3D manifold, in ContactImpulses impulses, ref OfferContext context)
        {
        }
    }
}
