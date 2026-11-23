namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Gates the compressed adjacency the 2D wake walk builds once per pass, the
/// counterpart of the coverage that already existed in 3D. The pass counts edges
/// per slot, turns the counts into row starts, then scatters neighbour slots into
/// the rows; an off-by-one in the count-clear leaves the last slot's row pointing
/// at whatever the previous pass left there, and a row that runs past its own slot
/// reaches bodies the contact graph never named. These gates count the artefact
/// itself, and separately refuse every slot the integrator will not simulate,
/// including one whose body has been destroyed.
/// </summary>
public sealed class WakeContactAdjacency2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float Half = 0.4f;
    private const int SleepLimit = 900;
    private const int PyramidBodies = 7;
    private const int PyramidContacts = 11;
    private const int DynamicAdjacencyEntries = 16;

    private readonly World _world;

    public WakeContactAdjacency2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void ContactAdjacency_LeadsToDynamicBodiesOnly()
    {
        BodyId[] bodies = CreatePyramid();
        int sleepStep = SleepStepAll(bodies, SleepLimit);

        sleepStep.Should().BeGreaterThan(0, $"precondition: the pyramid never came to rest within {SleepLimit} steps; {Row(bodies, sleepStep)}");
        _world.ContactCount.Should().Be(
            PyramidContacts,
            $"precondition: the resting pyramid carries {_world.ContactCount} contacts, expected {PyramidContacts} (three base cubes on the ground, two mid cubes on two base cubes each, apex on both mids, crown on the apex); {Row(bodies, sleepStep)}");

        _world.BuildContactAdjacency();
        int dynamicEntries = _world.CountWakeAdjacencyEntries(BodyType.Dynamic);
        int staticEntries = _world.CountWakeAdjacencyEntries(BodyType.Static);

        staticEntries.Should().Be(
            0,
            $"the walkable graph held {staticEntries} entries leading to Static scenery, expected 0: a shared support couples nothing, so a withdrawn ground must not be able to step through into every body resting on it (dynamic entries={dynamicEntries}, contacts={_world.ContactCount}, sleepStep={sleepStep})");
        dynamicEntries.Should().Be(
            DynamicAdjacencyEntries,
            $"the walkable graph held {dynamicEntries} entries leading to dynamic bodies, expected {DynamicAdjacencyEntries} — two per walkable pair, and the pyramid has 8 of them (ground pairs are not walkable); measured over {_world.ContactCount} contacts, {Row(bodies, sleepStep)}");
    }

    [Fact]
    public void ContactAdjacency_RebuiltOverTheSameContactsIsIdenticalTwice()
    {
        BodyId[] bodies = CreatePyramid();
        int sleepStep = SleepStepAll(bodies, SleepLimit);

        sleepStep.Should().BeGreaterThan(0, $"precondition: the pyramid never came to rest within {SleepLimit} steps; {Row(bodies, sleepStep)}");

        _world.BuildContactAdjacency();
        int firstPass = _world.CountWakeAdjacencyEntries(BodyType.Dynamic);
        int firstPassStatic = _world.CountWakeAdjacencyEntries(BodyType.Static);
        _world.BuildContactAdjacency();
        int secondPass = _world.CountWakeAdjacencyEntries(BodyType.Dynamic);
        int secondPassStatic = _world.CountWakeAdjacencyEntries(BodyType.Static);

        secondPass.Should().Be(
            firstPass,
            $"rebuilding the adjacency over the same {_world.ContactCount} contacts gave {secondPass} dynamic entries the second time against {firstPass} the first: the per-slot counts are cleared before they are summed, and a slot that keeps the previous build's write cursor shifts every row end after it, so the last slot's row reaches neighbours the graph never named (static={secondPassStatic}, sleepStep={sleepStep}, {Row(bodies, sleepStep)})");
        secondPassStatic.Should().Be(
            firstPassStatic,
            $"the Static entry count moved from {firstPassStatic} to {secondPassStatic} across two builds of the same contacts; {Row(bodies, sleepStep)}");
    }

    [Fact]
    public void WakeQueue_RefusesEveryNonDynamicSlot()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec2[] { new(-40.0f, -1.0f), new(40.0f, -1.0f), new(40.0f, 1.0f), new(-40.0f, 1.0f) },
            material: new PhysicsMaterial(0.8f, 0.0f));
        BodyId slab = Cube(new Vec2(6.0f, Half), BodyType.Kinematic);
        BodyId sleeper = Cube(new Vec2(12.0f, Half), BodyType.Dynamic);
        _world.Step(Dt);

        _world.Bodies.SetAwake(ground, false);
        _world.Bodies.SetAwake(slab, false);
        _world.Bodies.SetAwake(sleeper, false);
        new[] { ground, slab, sleeper }.Select(id => _world.Bodies.IsAwake(id)).Should().OnlyContain(
            awake => !awake,
            $"precondition: the caller has to be able to put scenery and a dynamic body to sleep to make the walk's write observable; ground={_world.Bodies.IsAwake(ground)}, kinematic={_world.Bodies.IsAwake(slab)}, dynamic={_world.Bodies.IsAwake(sleeper)}");

        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(BodyStore.SlotOf(ground));
        _world.EnqueueWakeSlot(BodyStore.SlotOf(slab));

        _world.WakeQueueLength.Should().Be(
            0,
            $"the walk queued {_world.WakeQueueLength} slot(s) offered as Static and Kinematic scenery, expected 0: nothing the integrator will not simulate may enter the worklist (contacts={_world.ContactCount})");
        _world.Bodies.IsAwake(ground).Should().BeFalse("the walk wrote the awake bit into Static scenery");
        _world.Bodies.IsAwake(slab).Should().BeFalse("the walk wrote the awake bit into a Kinematic slab it was never asked to move");

        _world.EnqueueWakeSlot(BodyStore.SlotOf(sleeper));

        _world.WakeQueueLength.Should().Be(1, $"control: the walk queued {_world.WakeQueueLength} slot(s) for a sleeping dynamic body, expected 1 — the two scenery slots above must be refused while a simulating body is accepted");
        _world.Bodies.IsAwake(sleeper).Should().BeTrue($"control: the sleeping dynamic body was not woken by the queue that accepted it; sleeping={_world.Bodies.IsSleeping(sleeper)}");
    }

    [Fact]
    public void WakeQueue_RefusesASlotWhoseBodyIsGone()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec2[] { new(-40.0f, -1.0f), new(40.0f, -1.0f), new(40.0f, 1.0f), new(-40.0f, 1.0f) },
            material: new PhysicsMaterial(0.8f, 0.0f));
        BodyId doomed = Cube(new Vec2(6.0f, Half), BodyType.Dynamic);
        int slot = BodyStore.SlotOf(doomed);
        _world.Bodies.Destroy(doomed);

        _world.Bodies.IsValid(doomed).Should().BeFalse("precondition: the body has to be gone for this gate to mean anything");
        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(slot);

        _world.WakeQueueLength.Should().Be(
            0,
            $"the walk queued {_world.WakeQueueLength} slot(s) offered as a destroyed body's slot {slot}, expected 0: a slot the free list has already taken back must never reach the awake write, whatever the record sitting in it still claims to be");
        _world.Bodies.IsValid(doomed).Should().BeFalse("offering a dead slot to the walk resurrected the body that used to own it");
    }

    private BodyId Cube(Vec2 center, BodyType type)
    {
        BodyId box = _world.Bodies.Create(new BodyDef { Type = type, Position = center, AllowSleep = true });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            box,
            new Vec2[] { new(-Half, -Half), new(Half, -Half), new(Half, Half), new(-Half, Half) },
            material: new PhysicsMaterial(0.7f, 0.0f));
        return box;
    }

    private BodyId[] CreatePyramid()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec2[] { new(-40.0f, -1.0f), new(40.0f, -1.0f), new(40.0f, 1.0f), new(-40.0f, 1.0f) },
            material: new PhysicsMaterial(0.8f, 0.0f));

        BodyId[] bodies = new BodyId[PyramidBodies];
        bodies[0] = Cube(new Vec2(-2.0f * Half, Half), BodyType.Dynamic);
        bodies[1] = Cube(new Vec2(0.0f, Half), BodyType.Dynamic);
        bodies[2] = Cube(new Vec2(2.0f * Half, Half), BodyType.Dynamic);
        bodies[3] = Cube(new Vec2(-1.0f * Half, 3.0f * Half), BodyType.Dynamic);
        bodies[4] = Cube(new Vec2(1.0f * Half, 3.0f * Half), BodyType.Dynamic);
        bodies[5] = Cube(new Vec2(0.0f, 5.0f * Half), BodyType.Dynamic);
        bodies[6] = Cube(new Vec2(0.0f, 7.0f * Half), BodyType.Dynamic);
        return bodies;
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
        string ys = string.Join(" ", bodies.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000")));
        return $"awake=[{awake}] y=[{ys}] contacts={_world.ContactCount} sleepStep={sleepStep}";
    }
}
