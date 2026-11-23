namespace Axrone.Physics3D.Tests;

using Axrone.Numeric;
using Xunit;

/// <summary>
/// Bounds on one wake pass over a graph whose paths reconverge. The walk marks a
/// body with the generation of the open pass, so a body reached by three edges is
/// still queued and visited once; that mark is the only thing keeping a pass from
/// rescanning the graph forever, and before these gates its only observable
/// failure was a suite that never finished. Each gate therefore reports the counts
/// themselves: edges scanned, slots queued, bodies visited, slots left over.
/// </summary>
public sealed class WakeWalkBound3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int SleepLimit = 900;
    private const int BodyCount = 9;
    private const int ReconvergentEntries = 56;
    private const int ExpectedPushes = 9;
    private const int ExpectedVisits = 9;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Fact]
    public void ReconvergentGraph_VisitsEveryBodyOnceAcrossFiftySixEdges()
    {
        BodyId[] bodies = CreateCross(out BodyId hub);
        int sleepStep = StepUntilAllAsleep(bodies);

        Assert.True(
            sleepStep > 0,
            $"precondition: the cross never came to rest within {SleepLimit} steps; awake=[{AwakeState(bodies)}], y=[{YsState(bodies)}].");

        _world.BuildContactAdjacency();
        int entries = _world.CountWakeAdjacencyEntries(BodyType.Dynamic);
        Assert.True(
            entries == ReconvergentEntries,
            $"precondition: the walkable graph offers {entries} adjacency entries, expected {ReconvergentEntries}; the point of this gate is a graph where edges outnumber bodies several times over (contacts={_world.ContactCount}, sleepStep={sleepStep}).");

        PutToSleep(bodies);
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(hub));
        _world.PropagateWakes();

        Assert.True(
            _world.WakeVisitCount == ExpectedVisits,
            $"the pass scanned {entries} adjacency entries and visited {_world.WakeVisitCount} bodies, expected {ExpectedVisits}: a body reached by several edges may be visited once per pass, and the generation mark is what makes that true; a pass that rescans never terminates, which is why the count is pinned rather than the hang (pushes={_world.WakePushCount}, queued={_world.WakeQueueLength}, sleepStep={sleepStep}).");
        Assert.True(
            _world.WakePushCount == ExpectedPushes,
            $"the pass queued {_world.WakePushCount} slots across {entries} edges, expected {ExpectedPushes} — one per body; a queue that grows past the body count is a pass that is rescanning (visits={_world.WakeVisitCount}, peak={_world.WakeQueuePeakLength}, queued={_world.WakeQueueLength}).");
        Assert.True(
            _world.WakeQueueLength == 0,
            $"the pass ended with {_world.WakeQueueLength} slots still queued and never walked; a bounded drain is allowed to stop early only when it ran out of bodies, and this graph has {BodyCount} of them (visits={_world.WakeVisitCount}, pushes={_world.WakePushCount}).");
        Assert.True(
            bodies.All(id => _world.Bodies.IsAwake(id)),
            $"after a pass over a graph with {entries} edges, awake=[{AwakeState(bodies)}], visits={_world.WakeVisitCount}, pushes={_world.WakePushCount}.");
    }

    [Fact]
    public void NextPassOpensAFreshGenerationAndWalksTheWholeGraphAgain()
    {
        BodyId[] bodies = CreateCross(out BodyId hub);
        int sleepStep = StepUntilAllAsleep(bodies);

        Assert.True(
            sleepStep > 0,
            $"precondition: the cross never came to rest within {SleepLimit} steps; awake=[{AwakeState(bodies)}], y=[{YsState(bodies)}].");

        PutToSleep(bodies);
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(hub));
        _world.PropagateWakes();
        int firstVisits = _world.WakeVisitCount;

        PutToSleep(bodies);
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(hub));
        _world.PropagateWakes();

        Assert.True(
            _world.WakeVisitCount == firstVisits && _world.WakeVisitCount == ExpectedVisits,
            $"the first pass visited {firstVisits} bodies and the second visited {_world.WakeVisitCount}, expected {ExpectedVisits} both times: marks are stamped with the generation of the open pass, so a pass that failed to advance it would find every mark already set and walk nothing (queued={_world.WakeQueueLength}, peak={_world.WakeQueuePeakLength}, awake=[{AwakeState(bodies)}], sleepStep={sleepStep}).");
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

    private string YsState(BodyId[] bodies) => string.Join(" ", bodies.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000")));
}
