namespace Axrone.Physics3D.Tests;

using System.Globalization;
using Axrone.Numeric;
using Xunit;

/// <summary>
/// Branching-graph gates for the wake walk's worklist. Every other wake gate in
/// this suite is a linear chain, and a chain never holds more than one slot
/// pending, so the worklist bound is only reachable through a graph that fans
/// out: here the centre cube is touched by four arms and by the four towers that
/// stand on them, so a pass seeded at the centre holds eight slots at once. The
/// gates report the peak queue depth, the pushes and the visits the pass really
/// made, so narrowing the worklist shows up as a smaller number rather than as a
/// suite that keeps passing.
/// </summary>
public sealed class WakeBranchingGraph3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int SleepLimit = 900;
    private const int BodyCount = 9;
    private const int CrossContacts = 33;
    private const int DynamicAdjacencyEntries = 56;
    private const int HubDegree = 8;
    private const int HubPeakSlots = 8;
    private const int HubPushes = 9;
    private const int HubVisits = 9;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Fact]
    public void BranchingGraph_SeedAtTheHubFansOutToEightPendingSlots()
    {
        BodyId[] bodies = CreateCross(out BodyId hub);
        int sleepStep = StepUntilAllAsleep(bodies);

        Assert.True(
            sleepStep > 0,
            $"precondition: the cross never came to rest within {SleepLimit} steps; awake=[{AwakeState(bodies)}], y=[{YsState(bodies)}].");
        Assert.True(
            _world.ContactCount == CrossContacts,
            $"precondition: the resting cross carries {_world.ContactCount} contacts, expected {CrossContacts} (four arms on the ground, four arms on the centre, four towers on the arms, centre and towers on the ground).");

        _world.BuildContactAdjacency();
        int dynamicEntries = _world.CountWakeAdjacencyEntries(BodyType.Dynamic);
        Assert.True(
            dynamicEntries == DynamicAdjacencyEntries,
            $"the resting cross offers {dynamicEntries} walkable adjacency entries, expected {DynamicAdjacencyEntries}; the graph must stay a fan, not a chain (contacts={_world.ContactCount}, sleepStep={sleepStep}).");

        PutToSleep(bodies);
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(hub));
        _world.PropagateWakes();

        Assert.True(
            _world.WakeQueuePeakLength == HubPeakSlots,
            $"a pass seeded at the hub held at most {_world.WakeQueuePeakLength} slots pending, expected {HubPeakSlots}: the hub touches {HubDegree} dynamic bodies at once, and a worklist narrower than that silently refuses to walk the rest of the graph (pushes={_world.WakePushCount}, visits={_world.WakeVisitCount}, awake=[{AwakeState(bodies)}], sleepStep={sleepStep}).");
        Assert.True(
            _world.WakePushCount == HubPushes,
            $"the pass from the hub queued {_world.WakePushCount} slots, expected {HubPushes} — one per body in the cross; every slot it refused was a body the walk never scanned (peak={_world.WakeQueuePeakLength}, visits={_world.WakeVisitCount}, awake=[{AwakeState(bodies)}]).");
        Assert.True(
            _world.WakeVisitCount == HubVisits,
            $"the pass from the hub visited {_world.WakeVisitCount} bodies, expected {HubVisits}: a branching graph must be drained to the last tower in one pass (peak={_world.WakeQueuePeakLength}, pushes={_world.WakePushCount}, awake=[{AwakeState(bodies)}]).");
        Assert.True(
            bodies.All(id => _world.Bodies.IsAwake(id)),
            $"the pass from the hub left bodies asleep: awake=[{AwakeState(bodies)}], peak={_world.WakeQueuePeakLength}, pushes={_world.WakePushCount}, visits={_world.WakeVisitCount}.");
    }

    [Fact]
    public void BranchingGraph_InputAtTheHubWakesEveryTowerOnTheFirstStep()
    {
        BodyId[] bodies = CreateCross(out BodyId hub);
        int sleepStep = StepUntilAllAsleep(bodies);

        Assert.True(
            sleepStep > 0,
            $"precondition: the cross never came to rest within {SleepLimit} steps; awake=[{AwakeState(bodies)}], y=[{YsState(bodies)}].");

        PutToSleep(bodies);
        _world.Bodies.SetLinearVelocity(hub, new Vec3(0.5f, 0.0f, 0.0f));
        _world.Step(Dt);

        Assert.True(
            bodies.All(id => _world.Bodies.IsAwake(id)),
            $"one step after a velocity command at the hub, awake=[{AwakeState(bodies)}] — every body the contact graph reaches from the hub had to be awake at that step; contacts={_world.ContactCount}, y=[{YsState(bodies)}], sleepStep={sleepStep}.");
        Assert.True(
            _world.ContactCount == CrossContacts,
            $"the waking step changed the contact count to {_world.ContactCount}, expected {CrossContacts}; the graph the walk ran over has to be the resting one (awake=[{AwakeState(bodies)}], y=[{YsState(bodies)}]).");
    }

    private void PutToSleep(BodyId[] bodies)
    {
        foreach (BodyId id in bodies)
        {
            _world.Bodies.SetAwake(id, false);
        }
    }

    private BodyId[] CreateCross(out BodyId hub)
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec3(0.0f, -0.5f, 0.0f),
            new Vec3(40.0f, 0.5f, 40.0f));

        BodyId[] bodies = new BodyId[BodyCount];
        bodies[0] = Cube(new Vec3(0.0f, Half, 0.0f));
        bodies[1] = Cube(new Vec3(2.0f * Half, Half, 0.0f));
        bodies[2] = Cube(new Vec3(-2.0f * Half, Half, 0.0f));
        bodies[3] = Cube(new Vec3(0.0f, Half, 2.0f * Half));
        bodies[4] = Cube(new Vec3(0.0f, Half, -2.0f * Half));
        bodies[5] = Cube(new Vec3(2.0f * Half, 3.0f * Half, 0.0f));
        bodies[6] = Cube(new Vec3(-2.0f * Half, 3.0f * Half, 0.0f));
        bodies[7] = Cube(new Vec3(0.0f, 3.0f * Half, 2.0f * Half));
        bodies[8] = Cube(new Vec3(0.0f, 3.0f * Half, -2.0f * Half));
        hub = bodies[0];
        return bodies;

        BodyId Cube(Vec3 center)
        {
            BodyId box = _world.Bodies.Create(new BodyDef { AllowSleep = true });
            _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(Half, Half, Half));
            _world.Bodies.SetTransform(box, center, Quat.Identity);
            return box;
        }
    }

    private int StepUntilAllAsleep(BodyId[] bodies)
    {
        for (int step = 1; step <= SleepLimit; step++)
        {
            _world.Step(Dt);
            if (bodies.All(id => !_world.Bodies.IsAwake(id)))
            {
                return step;
            }
        }

        return -1;
    }

    private string AwakeState(IEnumerable<BodyId> bodies) => string.Join(" ", bodies.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"));

    private string YsState(BodyId[] bodies) => string.Join(" ", bodies.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000", CultureInfo.InvariantCulture)));
}
