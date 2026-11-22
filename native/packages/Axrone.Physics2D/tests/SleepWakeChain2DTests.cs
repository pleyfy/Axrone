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

    private static BodyId AddBox(World world, Vec2 center, float half = BoxHalf, bool allowSleep = true, BodyType type = BodyType.Dynamic)
    {
        BodyId body = world.Bodies.Create(new BodyDef { Type = type, Position = center, AllowSleep = allowSleep });
        world.Shapes.AttachPolygon(
            world.Bodies,
            world.Broadphase,
            body,
            new Vec2[] { new(-half, -half), new(half, -half), new(half, half), new(-half, half) },
            material: new PhysicsMaterial(0.7f, 0.0f));
        return body;
    }

    /// <summary>Bottom-touching stack of <paramref name="count"/> boxes resting on the y = 0 surface.</summary>
    private BodyId[] AddStack(int count, float x = 0.0f, bool allowSleep = true)
    {
        BodyId[] boxes = new BodyId[count];
        for (int i = 0; i < count; i++)
        {
            boxes[i] = AddBox(_world, new Vec2(x, BoxHalf + (2.0f * BoxHalf) * i), allowSleep: allowSleep);
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

    private const float SurfaceY = -1.0f;

    /// <summary>
    /// Analytic resting centre of stack member <paramref name="index"/> after the
    /// ground drops to surface y = -1: the pile settles one linear slop deep at
    /// every interface below and including the member.
    /// </summary>
    private static float AnalyticRestY(int index) =>
        SurfaceY + BoxHalf + (2.0f * BoxHalf) * index - ((index + 1) * PhysicsConstants.LinearSlop);

    private const float RestTolerance = 2.0f * PhysicsConstants.LinearSlop;

    private int[] WakeSteps(BodyId[] boxes, int limit, out int resleepStep, out long awakeBodySteps)
    {
        int[] wake = new int[boxes.Length];
        Array.Fill(wake, -1);
        resleepStep = -1;
        awakeBodySteps = 0;
        for (int step = 1; step <= limit; step++)
        {
            _world.Step(Dt);
            for (int i = 0; i < boxes.Length; i++)
            {
                if (_world.Bodies.IsAwake(boxes[i]))
                {
                    awakeBodySteps++;
                    if (wake[i] < 0)
                    {
                        wake[i] = step;
                    }
                }
            }

            if (resleepStep < 0 && step > WakeWindow && AllAsleep(boxes))
            {
                resleepStep = step;
            }
        }

        return wake;
    }

    private const int WakeWindow = 3;
    private const int SettleLimit = 600;

    private string ChainRow(BodyId[] boxes, int[] wake, int sleepStep, int resleepStep)
    {
        string wakeText = string.Join(" ", wake);
        string ys = string.Join(" ", boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000", Inv)));
        string awake = string.Join(" ", boxes.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"));
        return $"sleepStep={sleepStep} wake=[{wakeText}] resleep={resleepStep} awake=[{awake}] y=[{ys}] contacts={_world.ContactCount}";
    }

    /// <summary>
    /// The 2D face of MAJOR-R2-C: the support is withdrawn from under the base of
    /// a sleeping stack, so only the base is inside the volume the placement
    /// swept. Everything above it is reachable only by walking the contact graph,
    /// and without that walk it stays asleep and hangs where it was.
    /// </summary>
    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(8)]
    public void SupportWithdrawnFromStack_WakesEveryBoxThroughTheContactGraph(int count)
    {
        BodyId ground = AddGround(_world);
        BodyId[] boxes = AddStack(count);
        int sleepStep = SleepStepAll(boxes, SleepLimit);
        sleepStep.Should().BeGreaterThan(0, $"precondition: a {count}-box stack never slept within {SleepLimit} steps; {Row(boxes, sleepStep)}");
        float[] resting = boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y).ToArray();

        _world.Bodies.SetTransform(ground, new Vec2(0.0f, -2.0f), 0.0f);
        int[] wake = WakeSteps(boxes, SettleLimit, out int resleepStep, out _);

        wake.Should().OnlyContain(
            step => step >= 1 && step <= WakeWindow,
            $"withdrawing the support of a {count}-box stack must wake every box within {WakeWindow} steps by walking the contact graph; " +
            $"box0 was inside the swept volume and every higher box is reached only through the pair below it; {ChainRow(boxes, wake, sleepStep, resleepStep)}");

        for (int i = 0; i < boxes.Length; i++)
        {
            float y = _world.Bodies.GetTransform(boxes[i]).Position.Y;
            y.Should().BeApproximately(
                AnalyticRestY(i),
                RestTolerance,
                $"box{i} was resting at {resting[i]:0.0000} and its support moved to surface y = {SurfaceY:0.0000}, so it must land on the new surface; {ChainRow(boxes, wake, sleepStep, resleepStep)}");
        }

        resleepStep.Should().BeGreaterThan(0, $"the landed stack must come back to rest; {ChainRow(boxes, wake, sleepStep, resleepStep)}");
        _world.Bodies.GetLinearVelocity(ground).Should().Be(Vec2.Zero, "the withdrawn scenery must not pick up velocity from waking the stack that rested on it");
    }

    /// <summary>
    /// Control for the same scene with sleep disabled: the boxes must still end up
    /// on the new surface, so the wake assertions above cannot be satisfied by a
    /// stack that never rests anywhere.
    /// </summary>
    [Fact]
    public void SupportWithdrawnFromSleepDisabledStack_KeepsTheStackCorrectAsControl()
    {
        BodyId ground = AddGround(_world);
        BodyId[] boxes = AddStack(3, allowSleep: false);
        _world.Bodies.SetTransform(ground, new Vec2(0.0f, -2.0f), 0.0f);
        for (int step = 1; step <= SettleLimit; step++)
        {
            _world.Step(Dt);
        }

        for (int i = 0; i < boxes.Length; i++)
        {
            _world.Bodies.GetTransform(boxes[i]).Position.Y.Should().BeApproximately(
                AnalyticRestY(i), RestTolerance,
                $"a stack that is never allowed to sleep still has to land on the moved surface at member {i}; {Row(boxes, -1)}");
        }
    }

    /// <summary>
    /// Nothing relocated means nothing woken: a supported stack that is left alone
    /// must stay asleep with byte-identical frames and an unchanged contact list.
    /// </summary>
    [Fact]
    public void UntouchedSupport_KeepsTheWholeStackAsleepAsControl()
    {
        AddGround(_world);
        BodyId[] boxes = AddStack(3);
        int sleepStep = SleepStepAll(boxes, SleepLimit);
        sleepStep.Should().BeGreaterThan(0, $"precondition: the three stack never slept within {SleepLimit} steps; {Row(boxes, sleepStep)}");

        Vec2[] before = boxes.Select(id => _world.Bodies.GetTransform(id).Position).ToArray();
        int contactsBefore = _world.ContactCount;
        for (int step = 1; step <= 300; step++)
        {
            _world.Step(Dt);
            AllAsleep(boxes).Should().BeTrue(
                $"a supported stack woke at step {step} with nothing relocated; {Row(boxes, sleepStep)}");
        }

        for (int i = 0; i < boxes.Length; i++)
        {
            _world.Bodies.GetTransform(boxes[i]).Position.Should().Be(before[i], $"a supported stack drifted from {before[i]} to {_world.Bodies.GetTransform(boxes[i]).Position}");
        }

        _world.ContactCount.Should().Be(contactsBefore, "nothing relocated, so the pair set of a resting stack must not change");
    }

    /// <summary>
    /// The locality half of the walk: two stacks rest on one slab and only the
    /// wall under the first is withdrawn. A shared support couples nothing — the
    /// same rule that keeps the island pass from unioning through scenery — so
    /// the second stack must keep sleeping at the exact frames it held.
    /// </summary>
    [Fact]
    public void NeighbourStackWithdrawal_LeavesTheSecondSleepingStackUntouched()
    {
        AddGround(_world, halfWidth: 40.0f);
        BodyId[] first = AddStack(3);
        BodyId[] second = AddStack(3, x: 6.0f);
        BodyId wall = AddBox(_world, new Vec2(0.9f, BoxHalf), type: BodyType.Static);
        BodyId[] all = [.. first, .. second];
        int sleepStep = SleepStepAll(all, SleepLimit);
        sleepStep.Should().BeGreaterThan(0, $"precondition: neither stack slept within {SleepLimit} steps; {Row(all, sleepStep)}");

        Vec2[] before = second.Select(id => _world.Bodies.GetTransform(id).Position).ToArray();
        _world.Bodies.SetTransform(wall, new Vec2(3.0f, BoxHalf), 0.0f);
        int firstWakeOfNeighbour = -1;
        for (int step = 1; step <= 60; step++)
        {
            _world.Step(Dt);
            if (firstWakeOfNeighbour < 0 && first.Any(id => _world.Bodies.IsAwake(id)))
            {
                firstWakeOfNeighbour = step;
            }

            AllAsleep(second).Should().BeTrue(
                $"withdrawing a wall touching only the first stack woke the second one at step {step}; walking through a shared support is not propagation; {Row(second, sleepStep)}");
        }

        for (int i = 0; i < second.Length; i++)
        {
            _world.Bodies.GetTransform(second[i]).Position.Should().Be(
                before[i], $"the untouched stack moved box{i} from {before[i]} to {_world.Bodies.GetTransform(second[i]).Position}");
        }

        firstWakeOfNeighbour.Should().BeInRange(
            1,
            WakeWindow,
            $"the stack the wall actually touched must wake from the withdrawal; {Row(first, sleepStep)}");
    }

    /// <summary>
    /// The propagation reaches dynamic bodies and nothing else. A script-driven
    /// platform that is parked and asleep sits inside the volume the withdrawn
    /// support sweeps, and waking it would hand the world motion its owner put
    /// to sleep on purpose; the scenery immunity rule is the same one the solver
    /// rows and the island pass already hold.
    /// </summary>
    [Fact]
    public void RelocationSweep_WakesTheDynamicNeighbourAndLeavesASleepingPlatformAsleep()
    {
        AddGround(_world, halfWidth: 40.0f);
        BodyId box = AddBox(_world, new Vec2(0.0f, BoxHalf));
        BodyId platform = AddBox(_world, new Vec2(1.0f, BoxHalf), type: BodyType.Kinematic);
        BodyId wall = AddBox(_world, new Vec2(0.5f, BoxHalf), half: 0.4f, type: BodyType.Static);
        int sleepStep = SleepStepAll([box], SleepLimit);
        sleepStep.Should().BeGreaterThan(0, $"precondition: the box never slept; {Row([box], sleepStep)}");
        _world.Bodies.SetAwake(platform, awake: false);
        _world.Bodies.IsAwake(platform).Should().BeFalse("the platform has to start the row asleep for it to mean anything");

        Vec2 platformBefore = _world.Bodies.GetTransform(platform).Position;
        _world.Bodies.SetTransform(wall, new Vec2(5.0f, BoxHalf), 0.0f);
        int boxWake = -1;
        for (int step = 1; step <= 30; step++)
        {
            _world.Step(Dt);
            if (boxWake < 0 && _world.Bodies.IsAwake(box))
            {
                boxWake = step;
            }

            _world.Bodies.IsAwake(platform).Should().BeFalse(
                $"the withdrawal sweep woke the parked kinematic at step {step}; the propagation is allowed to write the awake flag only onto dynamic bodies; " +
                $"boxWake={boxWake} sleepStep={sleepStep}");
        }

        _world.Bodies.GetTransform(platform).Position.Should().Be(platformBefore, "a kinematic left asleep must not be dragged by the sweep that passed through it");
        boxWake.Should().BeInRange(1, WakeWindow, $"the dynamic neighbour of the withdrawn wall has to wake; sleepStep={sleepStep}");
    }
}
