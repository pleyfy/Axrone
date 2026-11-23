namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Pins the claim that the driven-kinematic test in the wake walk reads the very
/// same tolerance pair that the island pass uses to block sleep, so the two
/// systems can never disagree about which platforms are moving. The claim is an
/// identity between two independent code paths, so it is gated as an identity
/// between two independent measurements: for a ladder of platform speeds that
/// straddle <c>LinearSleepTolerance</c> and <c>AngularSleepTolerance</c>, the walk
/// has to pick up a sleeping rider exactly when the island refuses to let a
/// riding rider fall asleep. Any window where the two answers differ is a window
/// where one of them is reading the wrong constant.
/// </summary>
public sealed class KinematicTolerancePair2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float BoxHalf = 0.5f;
    private const int SettleLimit = 240;
    private const int WakeWindow = 6;
    private const int QuietWindow = 240;

    /// <summary>Below both tolerances, between them, above both, far above.</summary>
    private static readonly float[] Speeds = [0.005f, 0.02f, 0.05f, 0.4f];

    private readonly List<World> _worlds = [];

    public void Dispose()
    {
        foreach (World world in _worlds)
        {
            world.Dispose();
        }

        GC.SuppressFinalize(this);
    }

    [Fact]
    public void WalkAndIslandAgreeOnWhichPlatformSpeedsAreDriving()
    {
        foreach (float speed in Speeds)
        {
            bool walkDrives = WalkPicksUpASleeper(speed);
            bool islandDrives = IslandBlocksSleepOnTheRider(speed);

            walkDrives.Should().Be(
                islandDrives,
                $"at platform speed {speed:0.###} m/s the wake walk and the island pass disagree about whether the platform is moving: " +
                $"walk picked a sleeping rider up = {walkDrives}, island kept a riding rider awake = {islandDrives}. " +
                $"The walk's IsDrivingKinematic has to read the same tolerance pair the island pass blocks sleep on — LinearSleepTolerance={LinearTolerance}, " +
                $"AngularSleepTolerance={AngularTolerance} — and a disagreement window proves one side moved off the pair. speed={speed:0.###}");
        }
    }

    [Fact]
    public void TheDisagreementWindowIsClosedAtTheLinearSleepTolerance()
    {
        float below = LinearTolerance * 0.5f;
        float above = LinearTolerance * 2.0f;

        WalkPicksUpASleeper(below).Should().BeFalse(
            $"a platform at {below:0.####} m/s, half the linear sleep tolerance, drove the walk: below the tolerance the island lets the rider sleep, so a walk that wakes it here is reading a looser constant than the island");
        IslandBlocksSleepOnTheRider(below).Should().BeFalse(
            $"a rider carried at {below:0.####} m/s never slept within {QuietWindow} steps, so the island is not reading LinearSleepTolerance either");
        WalkPicksUpASleeper(above).Should().BeTrue(
            $"a platform at {above:0.####} m/s, twice the linear sleep tolerance, left a sleeping rider where it was: the walk is the only path that reaches a sleeper on an integrated platform");
        IslandBlocksSleepOnTheRider(above).Should().BeTrue(
            $"a rider carried at {above:0.####} m/s fell asleep inside {QuietWindow} steps while the island's own quiet test reads LinearSleepTolerance={LinearTolerance:0.####}");
    }

    [Fact]
    public void BothDimensionsDefaultThePairFromTheSameCoreConstants()
    {
        LinearTolerance.Should().Be(
            PhysicsConstants.LinearSleepTolerance,
            $"the 2D world's linear sleep tolerance is {LinearTolerance:0.####} while Axrone.Physics.Core publishes {PhysicsConstants.LinearSleepTolerance:0.####}: the pair the wake walk and the island pass share has drifted away from the single source the 3D world defaults from, which is how the two dimensions start disagreeing about the same platform");
        AngularTolerance.Should().Be(
            PhysicsConstants.AngularSleepTolerance,
            $"the 2D world's angular sleep tolerance is {AngularTolerance:0.####} while Axrone.Physics.Core publishes {PhysicsConstants.AngularSleepTolerance:0.####}; the shared pair has drifted from the source the 3D world reads");
    }

    /// <summary>Settles a box on a parked platform, then starts the drive and asks whether the sleeper wakes.</summary>
    private bool WalkPicksUpASleeper(float speed)
    {
        World world = NewWorld();
        BodyId platform = AddBox(world, new Vec2(0.0f, -0.5f), new Vec2(4.0f, 0.5f), BodyType.Kinematic);
        BodyId box = AddBox(world, new Vec2(0.0f, BoxHalf), new Vec2(BoxHalf, BoxHalf), BodyType.Dynamic);

        bool slept = false;
        for (int step = 1; step <= SettleLimit && !slept; step++)
        {
            world.Step(Dt);
            slept = !world.Bodies.IsAwake(box);
        }

        slept.Should().BeTrue(
            $"precondition: a box parked on a still platform never fell asleep within {SettleLimit} steps at speed {speed:0.###}; y={world.Bodies.GetTransform(box).Position.Y:R}");

        for (int step = 1; step <= WakeWindow; step++)
        {
            world.Bodies.SetLinearVelocity(platform, new Vec2(speed, 0.0f));
            world.Step(Dt);
            if (world.Bodies.IsAwake(box))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Starts the drive from the first step and asks whether the island ever lets the rider sleep.</summary>
    private bool IslandBlocksSleepOnTheRider(float speed)
    {
        World world = NewWorld();
        BodyId platform = AddBox(world, new Vec2(0.0f, -0.5f), new Vec2(4.0f, 0.5f), BodyType.Kinematic);
        BodyId box = AddBox(world, new Vec2(0.0f, BoxHalf), new Vec2(BoxHalf, BoxHalf), BodyType.Dynamic);

        for (int step = 1; step <= QuietWindow; step++)
        {
            world.Bodies.SetLinearVelocity(platform, new Vec2(speed, 0.0f));
            world.Step(Dt);
            if (step > WakeWindow && !world.Bodies.IsAwake(box))
            {
                return false;
            }
        }

        return true;
    }

    private static readonly float LinearTolerance = ReadTolerance(static world => world.LinearSleepTolerance);
    private static readonly float AngularTolerance = ReadTolerance(static world => world.AngularSleepTolerance);

    private static float ReadTolerance(Func<World, float> read)
    {
        using World probe = new(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
        return read(probe);
    }

    private World NewWorld()
    {
        World world = new(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
        _worlds.Add(world);
        AddBox(world, new Vec2(0.0f, -1.5f), new Vec2(40.0f, 0.5f), BodyType.Static);
        return world;
    }

    private static BodyId AddBox(World world, Vec2 center, Vec2 halfExtents, BodyType type)
    {
        BodyId body = world.Bodies.Create(new BodyDef { Type = type, Position = center, AllowSleep = true });
        world.Shapes.AttachPolygon(
            world.Bodies,
            world.Broadphase,
            body,
            new Vec2[]
            {
                new(-halfExtents.X, -halfExtents.Y),
                new(halfExtents.X, -halfExtents.Y),
                new(halfExtents.X, halfExtents.Y),
                new(-halfExtents.X, halfExtents.Y),
            },
            material: new PhysicsMaterial(0.9f, 0.0f));
        return body;
    }
}
