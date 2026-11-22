using Axrone.Numeric;
using Axrone.Physics3D;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Locality pins for the wake walk. The walk may only step from one dynamic body
/// to another, so relocating a support wakes the stack resting on it and nothing
/// that merely shares the scenery. Each gate reports the number it measured: the
/// adjacency entries that lead off the dynamic graph, and the step a second stack
/// was dragged awake on.
/// </summary>
public sealed class WakeWalkLocality3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float CubeHalf = 0.4f;
    private const float GroundHalf = 0.5f;
    private const float NeighbourX = 12.0f;
    private const float WallStartX = 0.8f;
    private const float WallEndX = 4.0f;
    private const int SleepLimit = 400;
    private const int WatchSteps = 6;
    private const int WakeWindow = 3;
    private const int StackContacts = 3;
    private const int NeighbourContacts = 2 * StackContacts;
    private const int DynamicAdjacencyEntries = 4;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Fact]
    public void SharedSupportWithdrawal_WakesTheStackItTouchedAndLeavesTheNeighbourAsleep()
    {
        CreateGround();
        BodyId[] touched = CreateStack(0.0f);
        BodyId[] neighbour = CreateStack(NeighbourX);
        BodyId wall = CreateWall();
        int sleepStep = StepUntilAllAsleep(touched.Concat(neighbour).ToArray());

        Assert.True(
            sleepStep > 0,
            $"precondition: the two stacks never both slept within {SleepLimit} steps; awake=[{AwakeState(touched.Concat(neighbour).ToArray())}].");

        Vec3[] before = neighbour.Select(id => _world.Bodies.GetTransform(id).Position).ToArray();
        int contactsBefore = _world.ContactCount;

        _world.Bodies.SetTransform(wall, new Vec3(WallEndX, CubeHalf, 0.0f), Quat.Identity);

        int[] wakeStep = new int[touched.Length];
        Array.Fill(wakeStep, -1);
        int breachStep = -1;
        int breachedBody = -1;
        for (int step = 1; step <= WatchSteps; step++)
        {
            _world.Step(Dt);
            for (int i = 0; i < touched.Length; i++)
            {
                if (wakeStep[i] < 0 && _world.Bodies.IsAwake(touched[i]))
                {
                    wakeStep[i] = step;
                }
            }

            for (int i = 0; i < neighbour.Length && breachStep < 0; i++)
            {
                if (_world.Bodies.IsAwake(neighbour[i]))
                {
                    breachStep = step;
                    breachedBody = i;
                }
            }
        }

        Assert.True(
            wakeStep.All(step => step >= 1 && step <= WakeWindow),
            $"the walk must still reach the stack the withdrawn wall touched within {WakeWindow} steps, including the one resting on top of it: " +
            $"wakeStep=[{Join(wakeStep)}], sleepStep={sleepStep}, y=[{YsState(touched)}].");

        Assert.True(
            breachStep < 0,
            $"the walk dragged a sleeping neighbour through the shared ground: box{breachedBody} of the stack at x={NeighbourX:0.##} was awake at step {breachStep} " +
            $"after a wall that only ever touched x=0 was relocated to x={WallEndX:0.##}; touched wakeStep=[{Join(wakeStep)}], sleepStep={sleepStep}, " +
            $"neighbour awake=[{AwakeState(neighbour)}], neighbour y=[{YsState(neighbour)}] was [{JoinVec3(before)}], contacts={contactsBefore}->{_world.ContactCount}.");

        for (int i = 0; i < neighbour.Length; i++)
        {
            Vec3 after = _world.Bodies.GetTransform(neighbour[i]).Position;
            Assert.True(
                after == before[i],
                $"the neighbour stack moved without waking: box{i} went from {before[i]} to {after} across {WatchSteps} steps of a relocation it never touched; " +
                $"neighbour awake=[{AwakeState(neighbour)}], touched wakeStep=[{Join(wakeStep)}].");
        }

        Assert.True(
            _world.ContactCount == NeighbourContacts,
            $"each three stack must still carry {StackContacts} contacts once the wall has left the scene, {NeighbourContacts} in the world: measured " +
            $"{_world.ContactCount} after {WatchSteps} steps; neighbour awake=[{AwakeState(neighbour)}], neighbour y=[{YsState(neighbour)}], " +
            $"touched wakeStep=[{Join(wakeStep)}], contacts before the withdrawal={contactsBefore} (the wall held two of them).");
    }

    [Fact]
    public void ContactAdjacency_LeadsToDynamicBodiesOnly()
    {
        CreateGround();
        BodyId[] boxes = CreateStack(0.0f);
        int sleepStep = StepUntilAllAsleep(boxes);

        Assert.True(
            sleepStep > 0,
            $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");
        Assert.True(
            _world.ContactCount == StackContacts,
            $"precondition: the three stack carries {_world.ContactCount} contacts, expected {StackContacts} (ground to box0, box0 to box1, box1 to box2).");

        _world.BuildContactAdjacency();
        int dynamicEntries = _world.CountWakeAdjacencyEntries(BodyType.Dynamic);
        int staticEntries = _world.CountWakeAdjacencyEntries(BodyType.Static);

        Assert.True(
            staticEntries == 0,
            $"the walkable graph held {staticEntries} entries leading to Static scenery, expected 0: a shared support couples nothing, so a withdrawn " +
            $"wall must not be able to step through the ground into every body resting on it (dynamic entries={dynamicEntries}, contacts={_world.ContactCount}, " +
            $"boxes={boxes.Length}, sleepStep={sleepStep}).");
        Assert.True(
            dynamicEntries == DynamicAdjacencyEntries,
            $"the walkable graph held {dynamicEntries} entries leading to dynamic bodies, expected {DynamicAdjacencyEntries} " +
            $"(box0 to box1, box1 to box0, box1 to box2, box2 to box1) for {_world.ContactCount} contacts.");
    }

    private BodyId CreateGround()
    {
        BodyId slab = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(
            _world.Bodies,
            _world.Broadphase,
            slab,
            new Vec3(0.0f, -GroundHalf, 0.0f),
            new Vec3(40.0f, GroundHalf, 40.0f));
        return slab;
    }

    private BodyId CreateWall()
    {
        BodyId wall = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, wall, Vec3.Zero, new Vec3(CubeHalf, CubeHalf, CubeHalf));
        _world.Bodies.SetTransform(wall, new Vec3(WallStartX, CubeHalf, 0.0f), Quat.Identity);
        return wall;
    }

    private BodyId[] CreateStack(float x)
    {
        BodyId[] boxes = new BodyId[3];
        for (int i = 0; i < boxes.Length; i++)
        {
            BodyId box = _world.Bodies.Create(new BodyDef { AllowSleep = true });
            _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(CubeHalf, CubeHalf, CubeHalf));
            _world.Bodies.SetTransform(box, new Vec3(x, CubeHalf + (2.0f * CubeHalf) * i, 0.0f), Quat.Identity);
            boxes[i] = box;
        }

        return boxes;
    }

    private int StepUntilAllAsleep(BodyId[] boxes)
    {
        for (int step = 1; step <= SleepLimit; step++)
        {
            _world.Step(Dt);
            if (boxes.All(id => !_world.Bodies.IsAwake(id)))
            {
                return step;
            }
        }

        return -1;
    }

    private string AwakeState(IEnumerable<BodyId> boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"));

    private string YsState(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000")));

    private static string JoinVec3(Vec3[] values) => string.Join(" ", values.Select(v => $"({v.X:0.0000} {v.Y:0.0000} {v.Z:0.0000})"));

    private static string Join(int[] values) => string.Join(" ", values);
}
