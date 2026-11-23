namespace Axrone.Physics2D.Tests;

using System.Globalization;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Bounds on one 2D wake pass over a graph whose paths reconverge, the
/// counterpart of the 3D cross bound. The pyramid reconverges twice over: each
/// mid cube rests on two base cubes, the apex rests on both mids, and the mids
/// touch each other, so the walk reaches several bodies along more than one
/// edge. The generation mark is what keeps that to one visit per body, and until
/// these gates the only way to notice it broken was a suite that stopped
/// finishing; the counts are pinned instead.
/// </summary>
public sealed class WakeWalkBound2DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int SleepLimit = 900;
    private const int BodyCount = 7;
    private const int PyramidContacts = 11;
    private const int ExpectedPushes = 7;
    private const int ExpectedVisits = 7;

    private readonly World _world;

    public WakeWalkBound2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void ReconvergentGraph_VisitsEveryBodyOnceAcrossElevenPairs()
    {
        BodyId[] bodies = CreatePyramid(out BodyId seed);
        int sleepStep = SleepStepAll(bodies, SleepLimit);

        sleepStep.Should().BeGreaterThan(
            0,
            $"precondition: the pyramid never came to rest within {SleepLimit} steps; {Row(bodies, sleepStep)}.");
        _world.ContactCount.Should().Be(
            PyramidContacts,
            $"precondition: the resting pyramid carries {_world.ContactCount} contacts, expected {PyramidContacts}; the point of this gate is a graph whose pairs outnumber its bodies (bodies={BodyCount}, {Row(bodies, sleepStep)}).");

        PutToSleep(bodies);
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(seed));
        _world.PropagateWakes();

        _world.WakeVisitCount.Should().Be(
            ExpectedVisits,
            $"the pass scanned pairs around {BodyCount} bodies and visited {_world.WakeVisitCount}, expected {ExpectedVisits}: a body reached by several edges may be visited once per pass, and the generation mark is what makes that true; a pass that rescans never terminates, which is why the count is pinned rather than the hang (pushes={_world.WakePushCount}, queued={_world.WakeQueueLength}, peak={_world.WakeQueuePeakLength}, {Row(bodies, sleepStep)}).");
        _world.WakePushCount.Should().Be(
            ExpectedPushes,
            $"the pass queued {_world.WakePushCount} slots, expected {ExpectedPushes} — one per body; a queue that grows past the body count is a pass that is rescanning (visits={_world.WakeVisitCount}, queued={_world.WakeQueueLength}, {Row(bodies, sleepStep)}).");
        _world.WakeQueueLength.Should().Be(
            0,
            $"the pass ended with {_world.WakeQueueLength} slots still queued and never walked; a bounded drain stops early only when it ran out of bodies, and this graph has {BodyCount} (visits={_world.WakeVisitCount}, pushes={_world.WakePushCount}).");
        bodies.Select(id => _world.Bodies.IsAwake(id)).Should().OnlyContain(
            awake => awake,
            $"after a pass over the reconvergent pyramid, {Row(bodies, sleepStep)}; visits={_world.WakeVisitCount}, pushes={_world.WakePushCount}.");
    }

    [Fact]
    public void NextPassOpensAFreshGenerationAndWalksTheWholeGraphAgain()
    {
        BodyId[] bodies = CreatePyramid(out BodyId seed);
        int sleepStep = SleepStepAll(bodies, SleepLimit);

        sleepStep.Should().BeGreaterThan(
            0,
            $"precondition: the pyramid never came to rest within {SleepLimit} steps; {Row(bodies, sleepStep)}.");

        PutToSleep(bodies);
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(seed));
        _world.PropagateWakes();
        int firstVisits = _world.WakeVisitCount;

        PutToSleep(bodies);
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(seed));
        _world.PropagateWakes();

        _world.WakeVisitCount.Should().Be(
            ExpectedVisits,
            $"the first pass visited {firstVisits} bodies and the second visited {_world.WakeVisitCount}, expected {ExpectedVisits} both times: marks are stamped with the generation of the open pass, so a pass that failed to advance it would find every mark already set and walk nothing (queued={_world.WakeQueueLength}, {Row(bodies, sleepStep)}).");
        firstVisits.Should().Be(
            ExpectedVisits,
            $"the first pass itself visited {firstVisits}, expected {ExpectedVisits}, so the second-pass comparison above proves nothing; {Row(bodies, sleepStep)}.");
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
