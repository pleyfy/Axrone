namespace Axrone.Physics2D.Tests;

using System.Globalization;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Branching-graph gates for the 2D wake walk's worklist, the counterpart of the
/// 3D cross. Every other wake gate here is a linear stack, and a stack never
/// holds more than one slot pending, so the worklist bound is only reachable
/// through a graph that fans out: a three-plus-two-plus-one-plus-one pyramid
/// reaches its widest at the mid cube on the left, which has the two base cubes
/// and the apex in front of it while the pass still holds the other mid cube.
/// The gates report the peak queue depth, the pushes and the visits the pass
/// really made, so narrowing the worklist shows up as a smaller number instead
/// of a suite that keeps passing.
/// </summary>
public sealed class WakeBranchingGraph2DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int SleepLimit = 900;
    private const int BodyCount = 7;
    private const int PyramidContacts = 11;
    private const int SeedPeakSlots = 4;
    private const int SeedPushes = 7;
    private const int SeedVisits = 7;

    private readonly World _world;

    public WakeBranchingGraph2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void BranchingGraph_SeedAtAMidCubeFansOutToFourPendingSlots()
    {
        BodyId[] bodies = CreatePyramid(out BodyId seed);
        int sleepStep = SleepStepAll(bodies, SleepLimit);

        sleepStep.Should().BeGreaterThan(
            0,
            $"precondition: the pyramid never came to rest within {SleepLimit} steps; {Row(bodies, sleepStep)}.");
        _world.ContactCount.Should().Be(
            PyramidContacts,
            $"precondition: the resting pyramid carries {_world.ContactCount} contacts, expected {PyramidContacts} (three base cubes on the ground, two mid cubes on two base cubes each, apex on both mids, crown on the apex); {Row(bodies, sleepStep)}.");

        PutToSleep(bodies);
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(seed));
        _world.PropagateWakes();

        _world.WakeQueuePeakLength.Should().Be(
            SeedPeakSlots,
            $"a pass seeded at the left mid cube held at most {_world.WakeQueuePeakLength} slots pending, expected {SeedPeakSlots}: a branching pass must be able to hold every neighbour it found at once, and a worklist narrower than that silently refuses to walk the rest of the graph; pushes={_world.WakePushCount}, visits={_world.WakeVisitCount}, {Row(bodies, sleepStep)}.");
        _world.WakePushCount.Should().Be(
            SeedPushes,
            $"the pass queued {_world.WakePushCount} slots, expected {SeedPushes} — one per body in the pyramid; every slot it refused was a body the walk never scanned; peak={_world.WakeQueuePeakLength}, visits={_world.WakeVisitCount}, {Row(bodies, sleepStep)}.");
        _world.WakeVisitCount.Should().Be(
            SeedVisits,
            $"the pass visited {_world.WakeVisitCount} bodies, expected {SeedVisits}: the last cube in the pyramid is only reachable through a pass that drained its whole worklist; peak={_world.WakeQueuePeakLength}, pushes={_world.WakePushCount}, {Row(bodies, sleepStep)}.");
        bodies.Select(id => _world.Bodies.IsAwake(id)).Should().OnlyContain(
            awake => awake,
            $"the pass from the mid cube left bodies asleep; peak={_world.WakeQueuePeakLength}, pushes={_world.WakePushCount}, visits={_world.WakeVisitCount}, {Row(bodies, sleepStep)}.");
    }

    [Fact]
    public void BranchingGraph_InputAtAMidCubeWakesEveryCubeOnTheFirstStep()
    {
        BodyId[] bodies = CreatePyramid(out BodyId seed);
        int sleepStep = SleepStepAll(bodies, SleepLimit);

        sleepStep.Should().BeGreaterThan(
            0,
            $"precondition: the pyramid never came to rest within {SleepLimit} steps; {Row(bodies, sleepStep)}.");

        PutToSleep(bodies);
        _world.Bodies.SetLinearVelocity(seed, new Vec2(0.5f, 0.0f));
        _world.Step(Dt);

        bodies.Select(id => _world.Bodies.IsAwake(id)).Should().OnlyContain(
            awake => awake,
            $"one step after a velocity command at the mid cube, {Row(bodies, sleepStep)} — every body the contact graph reaches from it had to be awake at that step.");
        _world.ContactCount.Should().Be(
            PyramidContacts,
            $"the waking step changed the contact count to {_world.ContactCount}, expected {PyramidContacts}; the graph the walk ran over has to be the resting one; {Row(bodies, sleepStep)}.");
    }

    private void PutToSleep(BodyId[] bodies)
    {
        foreach (BodyId id in bodies)
        {
            _world.Bodies.SetAwake(id, false);
        }
    }

    private BodyId[] CreatePyramid(out BodyId seed)
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec2[] { new(-40.0f, -1.0f), new(40.0f, -1.0f), new(40.0f, 1.0f), new(-40.0f, 1.0f) },
            material: new PhysicsMaterial(0.8f, 0.0f));

        BodyId[] bodies = new BodyId[BodyCount];
        bodies[0] = Cube(new Vec2(-2.0f * Half, Half));
        bodies[1] = Cube(new Vec2(0.0f, Half));
        bodies[2] = Cube(new Vec2(2.0f * Half, Half));
        bodies[3] = Cube(new Vec2(-1.0f * Half, 3.0f * Half));
        bodies[4] = Cube(new Vec2(1.0f * Half, 3.0f * Half));
        bodies[5] = Cube(new Vec2(0.0f, 5.0f * Half));
        bodies[6] = Cube(new Vec2(0.0f, 7.0f * Half));
        seed = bodies[3];
        return bodies;

        BodyId Cube(Vec2 center)
        {
            BodyId box = _world.Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = center, AllowSleep = true });
            _world.Shapes.AttachPolygon(
                _world.Bodies,
                _world.Broadphase,
                box,
                new Vec2[] { new(-Half, -Half), new(Half, -Half), new(Half, Half), new(-Half, Half) },
                material: new PhysicsMaterial(0.7f, 0.0f));
            return box;
        }
    }

    private int SleepStepAll(BodyId[] bodies, int limit)
    {
        for (int step = 1; step <= limit; step++)
        {
            _world.Step(Dt);
            if (bodies.All(id => !_world.Bodies.IsAwake(id)))
            {
                return step;
            }
        }

        return -1;
    }

    private string Row(BodyId[] bodies, int sleepStep)
    {
        string awake = string.Join(" ", bodies.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"));
        string ys = string.Join(" ", bodies.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000", CultureInfo.InvariantCulture)));
        return $"awake=[{awake}] y=[{ys}] contacts={_world.ContactCount} sleepStep={sleepStep}";
    }
}
