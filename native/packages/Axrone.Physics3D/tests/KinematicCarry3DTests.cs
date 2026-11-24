using Axrone.Numeric;
using Axrone.Physics3D;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// A kinematic body moved by velocity relocates every step it travels, so what
/// rests on it is woken by the swept volume instead of being left hanging where
/// the platform used to be. Each gate compares the sleeping scene against the
/// same scene with sleeping disabled, which is the answer the mover owes.
/// </summary>
public sealed class KinematicCarry3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float CubeHalf = 0.4f;
    private const float PlatformSpeed = 0.6f;
    private const float RetractSpeed = 1.2f;
    private const int Steps = 40;
    private const int SleepLimit = 400;
    private const int WakeWindow = 3;
    private const float PlatformStep = PlatformSpeed * Dt;
    private const float OneStepLag = PlatformStep + 0.001f;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Fact]
    public void SlidingKinematicPlatform_CarriesTheBoxSleepingOnIt()
    {
        BodyId platform = CreatePlatform(new Vec3(0.0f, -0.4f, 0.0f));
        BodyId box = CreateBox(0.0f, allowSleep: true);
        int sleepStep = StepUntilAsleep(box);

        Assert.True(
            sleepStep > 0,
            $"precondition: the box never fell asleep on the platform within {SleepLimit} steps; awake={_world.Bodies.IsAwake(box)}.");

        var travel = RunRide(platform, box, Steps);
        float controlTravel = RunRideControl(Steps);

        Assert.True(
            travel >= PlatformStep,
            $"the platform slid {Steps} steps at {PlatformSpeed:0.##} m/s under a sleeping box and carried it {travel:0.0000} m, expected at least one step " +
            $"({PlatformStep:0.0000} m); the box was left at z={_world.Bodies.GetTransform(box).Position.Z:0.0000} with the platform at " +
            $"{_world.Bodies.GetTransform(platform).Position.Z:0.0000}, awake={_world.Bodies.IsAwake(box)}, sleepStep={sleepStep}.");
        Assert.True(
            MathF.Abs(controlTravel - travel) <= OneStepLag,
            $"a sleeping box on a moving platform must end where the same box that never slept ends: control travelled {controlTravel:0.0000} m, the riding box " +
            $"travelled {travel:0.0000} m, difference {controlTravel - travel:0.0000} m against one step of platform travel ({PlatformStep:0.0000} m).");
    }

    [Fact]
    public void KinematicSupportWithdrawnFromASleepingStack_DropsItLikeTheAwakeControl()
    {
        BodyId platform = CreatePlatform(new Vec3(0.0f, -0.4f, 0.0f));
        BodyId[] boxes = CreateStack(3, 0.8f);
        int sleepStep = StepUntilAllAsleep(boxes);

        Assert.True(
            sleepStep > 0,
            $"precondition: the three stack never slept on the platform within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");
        Assert.True(
            _world.Bodies.GetTransform(boxes[0]).Position.Y > 0.3f,
            $"precondition: the stack must be resting above the platform before it is withdrawn; y=[{YsState(boxes)}].");

        int[] wakeStep = new int[boxes.Length];
        Array.Fill(wakeStep, -1);
        for (int step = 1; step <= Steps; step++)
        {
            _world.Bodies.SetLinearVelocity(platform, new Vec3(0.0f, -RetractSpeed, 0.0f));
            _world.Step(Dt);
            for (int i = 0; i < boxes.Length; i++)
            {
                if (wakeStep[i] < 0 && _world.Bodies.IsAwake(boxes[i]))
                {
                    wakeStep[i] = step;
                }
            }
        }

        float[] control = RunRetractControl(Steps);
        for (int i = 0; i < boxes.Length; i++)
        {
            Assert.True(
                wakeStep[i] >= 1 && wakeStep[i] <= WakeWindow,
                $"the platform sank at {RetractSpeed:0.##} m/s and box{i} woke at step {wakeStep[i]}, expected every box awake within {WakeWindow} steps of the " +
                $"support starting to move; sleepStep={sleepStep}, y=[{YsState(boxes)}], control y=[{Join(control)}].");

            float y = _world.Bodies.GetTransform(boxes[i]).Position.Y;
            Assert.True(
                y == control[i],
                $"the stack the platform abandoned did not fall the way the same never-sleeping stack falls: box{i} at y={y:0.0000000}, control {control[i]:0.0000000}, " +
                $"delta={y - control[i]:0.0000000}; wakeStep=[{Join(wakeStep)}], v=[{VelsState(boxes)}].");
        }
    }

    [Fact]
    public void ApproachingKinematicThatNeverArrives_LeavesTheSleepingBoxAlone()
    {
        CreateGround();
        BodyId platform = CreatePlatform(new Vec3(-3.0f, CubeHalf, 0.0f));
        BodyId box = CreateBox(0.0f, allowSleep: true);
        int sleepStep = StepUntilAsleep(box);

        Assert.True(
            sleepStep > 0,
            $"precondition: the box never fell asleep within {SleepLimit} steps; awake={_world.Bodies.IsAwake(box)}.");

        Vec3 before = _world.Bodies.GetTransform(box).Position;
        for (int step = 1; step <= 20; step++)
        {
            _world.Bodies.SetLinearVelocity(platform, new Vec3(3.0f, 0.0f, 0.0f));
            _world.Step(Dt);
            Assert.True(
                !_world.Bodies.IsAwake(box),
                $"a kinematic slab that stopped {_world.Bodies.GetTransform(box).Position.X - _world.Bodies.GetTransform(platform).Position.X - 2.0f:0.###} m " +
                $"short of the box woke it at step {step}; the wake walk may only reach bodies the moved volume actually swept. platform " +
                $"x={_world.Bodies.GetTransform(platform).Position.X:0.0000}, box x={_world.Bodies.GetTransform(box).Position.X:0.0000}, sleepStep={sleepStep}.");
        }

        Vec3 after = _world.Bodies.GetTransform(box).Position;
        Assert.True(
            after == before,
            $"control: the box nobody swept through moved anyway: {before} -> {after} over 20 steps of an approaching slab; awake={_world.Bodies.IsAwake(box)}, " +
            $"v=[{VelsState([box])}].");
    }

    private float RunRide(BodyId platform, BodyId box, int steps)
    {
        Vec3 before = _world.Bodies.GetTransform(box).Position;
        for (int step = 1; step <= steps; step++)
        {
            _world.Bodies.SetLinearVelocity(platform, new Vec3(0.0f, 0.0f, PlatformSpeed));
            _world.Step(Dt);
        }

        return (_world.Bodies.GetTransform(box).Position - before).Length();
    }

    private static float RunRideControl(int steps)
    {
        using var control = new World();
        BodyId platform = control.Bodies.Create(new BodyDef { Type = BodyType.Kinematic });
        control.Shapes.AttachBox(control.Bodies, control.Broadphase, platform, Vec3.Zero, new Vec3(1.0f, 0.4f, 1.0f));
        control.Bodies.SetTransform(platform, new Vec3(0.0f, -0.4f, 0.0f), Quat.Identity);
        BodyId box = control.Bodies.Create(new BodyDef { AllowSleep = false });
        control.Shapes.AttachBox(control.Bodies, control.Broadphase, box, Vec3.Zero, new Vec3(CubeHalf, CubeHalf, CubeHalf));
        control.Bodies.SetTransform(box, new Vec3(0.0f, CubeHalf, 0.0f), Quat.Identity);

        Vec3 before = control.Bodies.GetTransform(box).Position;
        for (int step = 1; step <= steps; step++)
        {
            control.Bodies.SetLinearVelocity(platform, new Vec3(0.0f, 0.0f, PlatformSpeed));
            control.Step(Dt);
        }

        return (control.Bodies.GetTransform(box).Position - before).Length();
    }

    private static float[] RunRetractControl(int steps)
    {
        using var control = new World();
        BodyId platform = control.Bodies.Create(new BodyDef { Type = BodyType.Kinematic });
        control.Shapes.AttachBox(control.Bodies, control.Broadphase, platform, Vec3.Zero, new Vec3(1.0f, 0.4f, 1.0f));
        control.Bodies.SetTransform(platform, new Vec3(0.0f, -0.4f, 0.0f), Quat.Identity);
        BodyId[] boxes = new BodyId[3];
        for (int i = 0; i < boxes.Length; i++)
        {
            BodyId box = control.Bodies.Create(new BodyDef { AllowSleep = false });
            control.Shapes.AttachBox(control.Bodies, control.Broadphase, box, Vec3.Zero, new Vec3(CubeHalf, CubeHalf, CubeHalf));
            control.Bodies.SetTransform(box, new Vec3(0.0f, 0.8f + (2.0f * CubeHalf) * i, 0.0f), Quat.Identity);
            boxes[i] = box;
        }

        for (int step = 1; step <= steps + SleepLimit; step++)
        {
            if (step > SleepLimit)
            {
                control.Bodies.SetLinearVelocity(platform, new Vec3(0.0f, -RetractSpeed, 0.0f));
            }

            control.Step(Dt);
        }

        return boxes.Select(id => control.Bodies.GetTransform(id).Position.Y).ToArray();
    }

    private BodyId CreateGround()
    {
        BodyId slab = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(
            _world.Bodies,
            _world.Broadphase,
            slab,
            new Vec3(0.0f, -0.5f, 0.0f),
            new Vec3(40.0f, 0.5f, 40.0f));
        return slab;
    }

    private BodyId CreatePlatform(Vec3 center)
    {
        BodyId platform = _world.Bodies.Create(new BodyDef { Type = BodyType.Kinematic });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, platform, Vec3.Zero, new Vec3(1.0f, 0.4f, 1.0f));
        _world.Bodies.SetTransform(platform, center, Quat.Identity);
        return platform;
    }

    private BodyId CreateBox(float x, bool allowSleep)
    {
        BodyId box = _world.Bodies.Create(new BodyDef { AllowSleep = allowSleep });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(CubeHalf, CubeHalf, CubeHalf));
        _world.Bodies.SetTransform(box, new Vec3(x, CubeHalf, 0.0f), Quat.Identity);
        return box;
    }

    private BodyId[] CreateStack(int count, float baseY)
    {
        BodyId[] boxes = new BodyId[count];
        for (int i = 0; i < count; i++)
        {
            BodyId box = _world.Bodies.Create(new BodyDef { AllowSleep = true });
            _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(CubeHalf, CubeHalf, CubeHalf));
            _world.Bodies.SetTransform(box, new Vec3(0.0f, baseY + (2.0f * CubeHalf) * i, 0.0f), Quat.Identity);
            boxes[i] = box;
        }

        return boxes;
    }

    private int StepUntilAsleep(BodyId box)
    {
        for (int step = 1; step <= SleepLimit; step++)
        {
            _world.Step(Dt);
            if (!_world.Bodies.IsAwake(box))
            {
                return step;
            }
        }

        return -1;
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

    private string AwakeState(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"));

    private string YsState(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000")));

    private string VelsState(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.GetLinearVelocity(id).Length().ToString("0.000000")));

    private static string Join(int[] values) => string.Join(" ", values);

    private static string Join(float[] values) => string.Join(" ", values.Select(v => v.ToString("0.0000")));
}
