using Axrone.Numeric;
using Axrone.Physics3D;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Dynamic wake paths: whatever the caller puts into motion must wake what rests
/// on it, transitively, through the same bounded walk a relocated support uses.
/// Each gate names the step the wake arrived on and the metres the boxes it
/// should have carried actually moved, because a stack whose bottom is shoved
/// while the rest sleep is a stack left hanging in the air.
/// </summary>
public sealed class DynamicWakePropagation3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float CubeHalf = 0.4f;
    private const float GroundHalf = 0.5f;
    private const float NeighbourX = 12.0f;
    private const int SleepLimit = 400;
    private const int Horizon = 600;
    private const int WakeWindow = 3;
    private const float CarriedMetres = 0.30f;
    private const float LiftedMetres = 0.50f;
    private const float WallHalf = 0.2f;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Theory]
    [InlineData("impulse")]
    [InlineData("force")]
    [InlineData("velocity")]
    [InlineData("torque")]
    public void MotionCommandOnASleepingStack_WakesAndCarriesEveryBox(string command)
    {
        CreateGround();
        BodyId[] boxes = CreateStack(3, 0.0f);
        int sleepStep = StepUntilAllAsleep(boxes);

        Assert.True(
            sleepStep > 0,
            $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");

        Vec3[] before = boxes.Select(id => _world.Bodies.GetTransform(id).Position).ToArray();
        Command(boxes[0], command);

        Trace trace = Observe(boxes, Horizon);
        float[] travel = Travel(before, boxes);

        Assert.True(
            trace.WakeStep.Skip(1).All(step => step >= 1 && step <= WakeWindow),
            $"{command} on box0 of a sleeping stack woke only the body it touched: wakeStep=[{Join(trace.WakeStep)}] within {Horizon} steps, " +
            $"expected every box awake by step {WakeWindow}; travel=[{Join(travel)}] m, sleepStep={sleepStep}, " +
            $"y=[{YsState(boxes)}] was [{JoinVec3(before)}].");

        for (int i = 1; i < boxes.Length; i++)
        {
            Assert.True(
                travel[i] >= CarriedMetres,
                $"{command} on box0 left box{i} hanging where it slept: it travelled {travel[i]:0.0000} m, expected at least {CarriedMetres:0.##} m once the " +
                $"body under it was set into motion; wakeStep=[{Join(trace.WakeStep)}], y=[{YsState(boxes)}], contacts={_world.ContactCount}.");
        }

        Assert.True(trace.AllFinite, $"{command} left a non-finite body behind: y=[{YsState(boxes)}], v=[{VelsState(boxes)}].");
        Assert.True(
            trace.ResleepStep > 0,
            $"{command} scattered the stack and it never went back to sleep within {Horizon} steps; awake=[{AwakeState(boxes)}], v=[{VelsState(boxes)}].");
    }

    [Fact]
    public void VerticalImpulseOnASleepingStack_LiftsTheStackInsteadOfVanishing()
    {
        CreateGround();
        BodyId[] boxes = CreateStack(2, 0.0f);
        int sleepStep = StepUntilAllAsleep(boxes);

        Assert.True(
            sleepStep > 0,
            $"precondition: the two stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");

        float restY = _world.Bodies.GetTransform(boxes[0]).Position.Y;
        _world.Bodies.ApplyLinearImpulse(boxes[0], new Vec3(0.0f, 6.0f, 0.0f));

        Trace trace = Observe(boxes, Horizon);

        Assert.True(
            trace.WakeStep.All(step => step >= 1 && step <= WakeWindow),
            $"a 6 N.s upward impulse into the bottom of a sleeping stack woke {trace.AwakeBodySteps} body steps in {Horizon} steps: " +
            $"wakeStep=[{Join(trace.WakeStep)}], expected both boxes awake by step {WakeWindow}; sleepStep={sleepStep}.");
        Assert.True(
            trace.MaxRise[0] >= LiftedMetres,
            $"the upward impulse was swallowed: box0 rose {trace.MaxRise[0]:0.0000} m above its resting y={restY:0.0000}, expected at least " +
            $"{LiftedMetres:0.##} m; y=[{YsState(boxes)}], v=[{VelsState(boxes)}], contacts={_world.ContactCount}.");

        Assert.True(
            trace.ResleepStep > 0,
            $"the lifted stack never settled back to sleep within {Horizon} steps; y=[{YsState(boxes)}], v=[{VelsState(boxes)}].");
        for (int i = 0; i < boxes.Length; i++)
        {
            float analytic = CubeHalf + (2.0f * CubeHalf) * i - ((i + 1) * Slop());
            float y = _world.Bodies.GetTransform(boxes[i]).Position.Y;
            Assert.True(
                MathF.Abs(y - analytic) <= 2.0f * Slop(),
                $"the stack that took the upward impulse did not come back to rest on the analytic height: box{i} at y={y:0.0000}, analytic={analytic:0.0000}, " +
                $"delta={y - analytic:0.0000}, wakeStep=[{Join(trace.WakeStep)}], resleepStep={trace.ResleepStep}.");
        }
    }

    [Fact]
    public void CollisionWake_PropagatesThroughTheSleepingStackUnderTheStruckBody()
    {
        CreateGround();
        BodyId[] boxes = CreateStack(3, 0.0f);
        BodyId platform = CreateSlab(new Vec3(0.0f, 4.0f, 0.0f), BodyType.Kinematic);
        int sleepStep = StepUntilAllAsleep(boxes);

        Assert.True(
            sleepStep > 0,
            $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");

        var platformVelocity = new Vec3(0.0f, -2.4f, 0.0f);
        int[] wakeStep = new int[boxes.Length];
        Array.Fill(wakeStep, -1);
        for (int step = 1; step <= 40; step++)
        {
            _world.Bodies.SetLinearVelocity(platform, platformVelocity);
            _world.Step(Dt);
            for (int i = 0; i < boxes.Length; i++)
            {
                if (wakeStep[i] < 0 && _world.Bodies.IsAwake(boxes[i]))
                {
                    wakeStep[i] = step;
                }
            }
        }

        int struck = wakeStep[boxes.Length - 1];
        Assert.True(
            struck >= 1,
            $"precondition: the descending platform never woke the box it landed on within 40 steps; wakeStep=[{Join(wakeStep)}], y=[{YsState(boxes)}].");
        for (int i = 0; i < boxes.Length - 1; i++)
        {
            Assert.True(
                wakeStep[i] >= struck && wakeStep[i] <= struck + WakeWindow,
                $"the platform woke box{boxes.Length - 1} at step {struck} and left box{i} asleep: wakeStep=[{Join(wakeStep)}] after 40 steps, expected every " +
                $"box awake within {WakeWindow} steps of the body it struck; y=[{YsState(boxes)}], contacts={_world.ContactCount}, sleepStep={sleepStep}.");
        }
    }

    [Fact]
    public void MotionCommand_LeavesASleepingStackOnTheSameGroundUntouched()
    {
        CreateGround();
        BodyId[] boxes = CreateStack(3, 0.0f);
        BodyId[] neighbour = CreateStack(3, NeighbourX);
        int sleepStep = StepUntilAllAsleep(boxes.Concat(neighbour).ToArray());

        Assert.True(
            sleepStep > 0,
            $"precondition: the two stacks never both slept within {SleepLimit} steps; awake=[{AwakeState(boxes.Concat(neighbour).ToArray())}].");

        Vec3[] before = neighbour.Select(id => _world.Bodies.GetTransform(id).Position).ToArray();
        _world.Bodies.ApplyLinearImpulse(boxes[0], new Vec3(0.0f, 0.0f, 1.2f));

        int breachStep = -1;
        for (int step = 1; step <= Horizon; step++)
        {
            _world.Step(Dt);
            if (breachStep < 0 && neighbour.Any(id => _world.Bodies.IsAwake(id)))
            {
                breachStep = step;
            }
        }

        Assert.True(
            boxes.All(id => _world.Bodies.IsAwake(id)) || breachStep < 0,
            $"control: the {NeighbourX:0.##} m command must still reach its own stack before the test means anything; awake=[{AwakeState(boxes)}].");
        Assert.True(
            breachStep < 0,
            $"a motion command on one stack dragged its neighbour awake through the shared ground: the stack at x={NeighbourX:0.##} woke at step {breachStep}; " +
            $"commanded stack awake=[{AwakeState(boxes)}], neighbour awake=[{AwakeState(neighbour)}], sleepStep={sleepStep}.");

        for (int i = 0; i < neighbour.Length; i++)
        {
            Vec3 after = _world.Bodies.GetTransform(neighbour[i]).Position;
            Assert.True(
                after == before[i],
                $"the neighbour stack drifted without waking: box{i} went from {before[i]} to {after} over {Horizon} steps of a command it never touched.");
        }
    }

    [Fact]
    public void CommandTheSolverCancels_StillRunsTheWakeItAskedFor()
    {
        CreateGround();
        BodyId[] boxes = CreateStack(1, 0.0f);
        BodyId wall = CreateWall(new Vec3(CubeHalf + WallHalf, CubeHalf, 0.0f));
        int sleepStep = StepUntilAllAsleep(boxes);

        Assert.True(
            sleepStep > 0,
            $"precondition: the box never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");
        Assert.True(
            !_world.Bodies.IsAwake(boxes[0]),
            $"precondition: the box must be asleep before it is commanded; awake={_world.Bodies.IsAwake(boxes[0])}, sleepStep={sleepStep}.");

        Vec3 before = _world.Bodies.GetTransform(boxes[0]).Position;
        _world.Bodies.ApplyLinearImpulse(boxes[0], new Vec3(3.0f, 0.0f, 0.0f));

        int awakeSteps = 0;
        int sleepAt = -1;
        for (int step = 1; step <= 120; step++)
        {
            _world.Step(Dt);
            if (_world.Bodies.IsAwake(boxes[0]))
            {
                awakeSteps++;
            }
            else if (sleepAt < 0)
            {
                sleepAt = step;
            }
        }

        int window = (int)MathF.Round(PhysicsConstants.SleepTime / Dt);
        Assert.True(
            awakeSteps > 0,
            $"a 3 N.s impulse into a box pressed against scenery was discarded without being simulated: awake for {awakeSteps} of 120 steps, it slept at " +
            $"step {sleepAt}; the command must at least wake the body it was aimed at. position={_world.Bodies.GetTransform(boxes[0]).Position} was {before}, " +
            $"v=[{VelsState(boxes)}], contacts={_world.ContactCount}.");
        Assert.True(
            awakeSteps >= window / 2,
            $"the woken box stopped being simulated after {awakeSteps} steps, below half the {window}-step ({PhysicsConstants.SleepTime:0.##} s) quiet window a " +
            $"wake buys it; it slept at step {sleepAt}, impulse was aimed at scenery it could not move.");

        Vec3 after = _world.Bodies.GetTransform(boxes[0]).Position;
        Assert.True(
            MathF.Abs(after.X - before.X) <= Slop(),
            $"the box that could not move did move: x went from {before.X:0.0000} to {after.X:0.0000} (delta {after.X - before.X:0.0000}, slop {Slop():0.0000}) " +
            $"while the wall held it; awake={_world.Bodies.IsAwake(boxes[0])}, v=[{VelsState(boxes)}].");
        Assert.True(
            _world.Bodies.GetLinearVelocity(boxes[0]) == Vec3.Zero && _world.Bodies.IsSleeping(boxes[0]),
            $"the box never went back to sleep after the cancelled command: v={_world.Bodies.GetLinearVelocity(boxes[0])}, sleeping={_world.Bodies.IsSleeping(boxes[0])}, " +
            $"awakeSteps={awakeSteps}.");
        Assert.True(
            _world.Bodies.GetLinearVelocity(wall) == Vec3.Zero,
            $"the scenery that cancelled the command picked up velocity {_world.Bodies.GetLinearVelocity(wall)}; a woken body must never drag the wall it " +
            $"was aimed at. wall awake={_world.Bodies.IsAwake(wall)}, contacts={_world.ContactCount}.");
    }

    private void Command(BodyId target, string command)
    {
        switch (command)
        {
            case "impulse":
                _world.Bodies.ApplyLinearImpulse(target, new Vec3(0.0f, 0.0f, 1.2f));
                break;
            case "force":
                _world.Bodies.ApplyForce(target, new Vec3(0.0f, 0.0f, 60.0f));
                break;
            case "velocity":
                _world.Bodies.SetLinearVelocity(target, new Vec3(0.0f, 0.0f, 1.5f));
                break;
            default:
                _world.Bodies.ApplyTorque(target, new Vec3(0.0f, 0.0f, 2.0f));
                break;
        }
    }

    private Trace Observe(BodyId[] boxes, int horizon)
    {
        Trace trace = new()
        {
            WakeStep = new int[boxes.Length],
            MaxRise = new float[boxes.Length],
        };
        Array.Fill(trace.WakeStep, -1);
        float[] startY = boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y).ToArray();

        for (int step = 1; step <= horizon; step++)
        {
            _world.Step(Dt);
            for (int i = 0; i < boxes.Length; i++)
            {
                if (_world.Bodies.IsAwake(boxes[i]))
                {
                    trace.AwakeBodySteps++;
                    if (trace.WakeStep[i] < 0)
                    {
                        trace.WakeStep[i] = step;
                    }
                }

                float y = _world.Bodies.GetTransform(boxes[i]).Position.Y;
                trace.MaxRise[i] = MathF.Max(trace.MaxRise[i], y - startY[i]);
            }

            if (trace.ResleepStep < 0 && step > WakeWindow && boxes.All(id => !_world.Bodies.IsAwake(id)))
            {
                trace.ResleepStep = step;
            }
        }

        trace.AllFinite = boxes.All(id => Finite(_world.Bodies.GetTransform(id).Position) && Finite(_world.Bodies.GetLinearVelocity(id)));
        return trace;
    }

    private float[] Travel(Vec3[] before, BodyId[] boxes)
    {
        float[] travel = new float[boxes.Length];
        for (int i = 0; i < boxes.Length; i++)
        {
            travel[i] = (_world.Bodies.GetTransform(boxes[i]).Position - before[i]).Length();
        }

        return travel;
    }

    private static bool Finite(Vec3 value) =>
        !float.IsNaN(value.X + value.Y + value.Z) && !float.IsInfinity(value.X + value.Y + value.Z);

    private static float Slop() => PhysicsConstants.LinearSlop;

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

    private BodyId CreateSlab(Vec3 center, BodyType type)
    {
        BodyId slab = _world.Bodies.Create(new BodyDef { Type = type });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, slab, Vec3.Zero, new Vec3(1.0f, CubeHalf, 1.0f));
        _world.Bodies.SetTransform(slab, center, Quat.Identity);
        return slab;
    }

    private BodyId CreateWall(Vec3 center)
    {
        BodyId wall = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, wall, Vec3.Zero, new Vec3(WallHalf, CubeHalf, 1.0f));
        _world.Bodies.SetTransform(wall, center, Quat.Identity);
        return wall;
    }

    private BodyId[] CreateStack(int count, float x)
    {
        BodyId[] boxes = new BodyId[count];
        for (int i = 0; i < count; i++)
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

    private string VelsState(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.GetLinearVelocity(id).Length().ToString("0.000000")));

    private static string JoinVec3(Vec3[] values) => string.Join(" ", values.Select(v => $"({v.X:0.0000} {v.Y:0.0000} {v.Z:0.0000})"));

    private static string Join(int[] values) => string.Join(" ", values);

    private static string Join(float[] values) => string.Join(" ", values.Select(v => v.ToString("0.0000")));

    private sealed class Trace
    {
        public int[] WakeStep { get; init; } = [];

        public float[] MaxRise { get; init; } = [];

        public long AwakeBodySteps { get; set; }

        public int ResleepStep { get; set; } = -1;

        public bool AllFinite { get; set; }
    }
}
