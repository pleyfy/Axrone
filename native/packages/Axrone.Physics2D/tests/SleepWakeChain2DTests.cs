namespace Axrone.Physics2D.Tests;

using System.Globalization;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Gates the rest half of the 2D wake family: a stack of dynamic bodies has to
/// reach sleep on its own before any withdrawal, propagation or carriage claim
/// means anything. The island rule is the minimum over the island, so one
/// member that never reads quiet holds every other member awake forever.
/// </summary>
public sealed class SleepWakeChain2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float BoxHalf = 0.5f;
    private const int SleepLimit = 300;

    private readonly World _world;

    public SleepWakeChain2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>Static slab whose top surface sits at y = 0.</summary>
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

    private static BodyId AddBox(World world, Vec2 center, bool allowSleep = true, BodyType type = BodyType.Dynamic)
    {
        BodyId body = world.Bodies.Create(new BodyDef { Type = type, Position = center, AllowSleep = allowSleep });
        world.Shapes.AttachPolygon(
            world.Bodies,
            world.Broadphase,
            body,
            new Vec2[] { new(-BoxHalf, -BoxHalf), new(BoxHalf, -BoxHalf), new(BoxHalf, BoxHalf), new(-BoxHalf, BoxHalf) },
            material: new PhysicsMaterial(0.7f, 0.0f));
        return body;
    }

    /// <summary>Bottom-touching stack of <paramref name="count"/> boxes resting on the y = 0 surface.</summary>
    private BodyId[] AddStack(int count, float x = 0.0f, bool allowSleep = true)
    {
        BodyId[] boxes = new BodyId[count];
        for (int i = 0; i < count; i++)
        {
            boxes[i] = AddBox(_world, new Vec2(x, BoxHalf + (2.0f * BoxHalf) * i), allowSleep);
        }

        return boxes;
    }

    private bool AllAsleep(BodyId[] boxes) => boxes.All(id => !_world.Bodies.IsAwake(id));

    private int SleepStepAll(BodyId[] boxes, int limit)
    {
        for (int step = 1; step <= limit; step++)
        {
            _world.Step(Dt);
            if (AllAsleep(boxes))
            {
                return step;
            }
        }

        return -1;
    }

    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private string Row(BodyId[] boxes, int sleepStep)
    {
        string awake = string.Join(" ", boxes.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"));
        string speeds = string.Join(" ", boxes.Select(id => _world.Bodies.GetLinearVelocity(id).LengthSquared().ToString("0.00000000", Inv)));
        string ys = string.Join(" ", boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000", Inv)));
        return $"awake=[{awake}] |v|sq=[{speeds}] y=[{ys}] contacts={_world.ContactCount} sleepStep={sleepStep}";
    }

    /// <summary>
    /// Every stack that is allowed to sleep must actually sleep, and no earlier
    /// than the 0.5 s quiet requirement allows: at 1/60 that is 30 steps, plus
    /// the transient of the settle. The linear sleep tolerance is a speed, so a
    /// resting residual above it holds the island minimum at zero forever.
    /// </summary>
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(8)]
    public void StackOfDynamicBodies_SleepsWithinTheQuietWindow(int count)
    {
        AddGround(_world);
        BodyId[] boxes = AddStack(count);
        int sleepStep = SleepStepAll(boxes, SleepLimit);

        sleepStep.Should().BeGreaterThan(
            0,
            $"a {count}-box stack of sleeping-enabled bodies never came to rest within {SleepLimit} steps; {_world.LinearSleepTolerance} m/s is the quiet speed and every member must fall under it; {Row(boxes, sleepStep)}");
        sleepStep.Should().BeLessThanOrEqualTo(
            SleepFloorSteps() + SleepWindowSteps,
            $"a {count}-box stack slept {sleepStep - SleepFloorSteps()} steps after the earliest step the {PhysicsConstants.SleepTime} s quiet rule allows; {Row(boxes, sleepStep)}");

        foreach (BodyId box in boxes)
        {
            _world.Bodies.GetLinearVelocity(box).Should().Be(
                Vec2.Zero,
                $"a body put to rest must carry no velocity; {Row(boxes, sleepStep)}");
        }
    }

    /// <summary>Earliest step an island can sleep: the quiet timer starts at zero and grows by dt.</summary>
    private static int SleepFloorSteps() => (int)MathF.Ceiling(PhysicsConstants.SleepTime / Dt);

    private const int SleepWindowSteps = 40;
}
