using Axrone.Numeric;
using Axrone.Physics3D;
using Xunit;
using Xunit.Abstractions;

namespace Axrone.Physics3D.Tests;

public sealed class SleepWakeChain3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float CubeHalf = 0.4f;
    private const float GroundHalf = 0.5f;
    private const float Drop = 5.5f;
    private const int WakeWindow = 3;
    private const int SettleLimit = 900;
    private const int SleepLimit = 300;

    private readonly World _world = new();
    private readonly ITestOutputHelper _output;

    public SleepWakeChain3DTests(ITestOutputHelper output)
    {
        _output = output;
    }

    public void Dispose() => _world.Dispose();

    [Fact]
    public void ThreeStackWithdrawal_WakesEveryBoxAndRestsTheWholeStackOnTheNewSupport()
    {
        BodyId ground = CreateGround();
        BodyId[] boxes = CreateStack(3, allowSleep: true);
        Outcome outcome = Withdraw(ground, boxes);
        _output.WriteLine(Dump(outcome));

        Assert.True(outcome.SleepStep > 0, $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");
        Assert.True(
            outcome.WakeStep.All(step => step >= 1 && step <= WakeWindow),
            $"wake did not reach every box within {WakeWindow} steps of the withdrawal: wakeStep=[{Join(outcome.WakeStep)}], sleepStep={outcome.SleepStep}, {Dump(outcome)}");

        AssertFinalHeights(boxes, outcome);
        Assert.True(outcome.ResleepStep > 0, $"stack never went back to sleep after landing: {Dump(outcome)}");
        Assert.True(outcome.Asleep, $"stack not asleep at the settle limit: {Dump(outcome)}");
        Assert.True(
            outcome.GroundVelocity == Vec3.Zero,
            $"withdrawn scenery carries velocity {outcome.GroundVelocity} after the propagation: {Dump(outcome)}");
        Assert.True(outcome.Finite, $"non-finite state after the propagation: {Dump(outcome)}");
    }

    [Fact]
    public void EightStackWithdrawal_WakesEveryBoxAndRestsTheWholeStackOnTheNewSupport()
    {
        BodyId ground = CreateGround();
        BodyId[] boxes = CreateStack(8, allowSleep: true);
        Outcome outcome = Withdraw(ground, boxes);
        _output.WriteLine(Dump(outcome));

        Assert.True(outcome.SleepStep > 0, $"precondition: the eight stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");
        Assert.True(
            outcome.WakeStep.All(step => step >= 1 && step <= WakeWindow),
            $"wake did not reach every box within {WakeWindow} steps of the withdrawal: wakeStep=[{Join(outcome.WakeStep)}], sleepStep={outcome.SleepStep}, {Dump(outcome)}");

        AssertFinalHeights(boxes, outcome);
        Assert.True(outcome.ResleepStep > 0, $"stack never went back to sleep after landing: {Dump(outcome)}");
        Assert.True(outcome.Asleep, $"stack not asleep at the settle limit: {Dump(outcome)}");
        Assert.True(
            outcome.GroundVelocity == Vec3.Zero,
            $"withdrawn scenery carries velocity {outcome.GroundVelocity} after the propagation: {Dump(outcome)}");
        Assert.True(outcome.Finite, $"non-finite state after the propagation: {Dump(outcome)}");
    }

    [Fact]
    public void SleepingDisabledWithdrawal_KeepsTheStackCorrectAsControl()
    {
        BodyId ground = CreateGround();
        BodyId[] boxes = CreateStack(3, allowSleep: false);
        Outcome outcome = Withdraw(ground, boxes);
        _output.WriteLine(Dump(outcome));

        Assert.True(outcome.SleepStep < 0, $"control precondition: a stack with AllowSleep=false slept at step {outcome.SleepStep}.");
        AssertFinalHeights(boxes, outcome);
        Assert.True(outcome.Finite, $"control failed: non-finite state with AllowSleep=false: {Dump(outcome)}");
    }

    [Fact]
    public void UntouchedSupport_KeepsTheWholeStackAsleepAsControl()
    {
        CreateGround();
        BodyId[] boxes = CreateStack(3, allowSleep: true);
        int sleepStep = StepUntilAllAsleep(boxes);
        Assert.True(sleepStep > 0, $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");

        Vec3[] before = boxes.Select(id => _world.Bodies.GetTransform(id).Position).ToArray();
        int contactsBefore = _world.ContactCount;
        for (int step = 1; step <= SettleLimit; step++)
        {
            _world.Step(Dt);
            Assert.True(
                StillAsleep(boxes),
                $"spurious wake: a supported stack woke at step {step} with nothing relocated; y=[{YsState(boxes)}], sleepStep={sleepStep}.");
        }

        for (int i = 0; i < boxes.Length; i++)
        {
            Vec3 after = _world.Bodies.GetTransform(boxes[i]).Position;
            Assert.True(after == before[i], $"control failed: a supported stack drifted from {before[i]} to {after}.");
        }

        Assert.True(
            _world.ContactCount == contactsBefore,
            $"control failed: contact count moved from {contactsBefore} to {_world.ContactCount} with nothing relocated.");
    }

    [Fact]
    public void DistantSupportWithdrawal_LeavesTheSleepingStackUntouched()
    {
        CreateGround();
        BodyId distant = CreateSlab(new Vec3(0.0f, 40.0f, 0.0f));
        BodyId[] boxes = CreateStack(3, allowSleep: true);
        int sleepStep = StepUntilAllAsleep(boxes);
        Assert.True(sleepStep > 0, $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");

        Vec3[] before = boxes.Select(id => _world.Bodies.GetTransform(id).Position).ToArray();
        _world.Bodies.SetTransform(distant, new Vec3(0.0f, 34.5f, 0.0f), Quat.Identity);
        for (int step = 1; step <= 30; step++)
        {
            _world.Step(Dt);
            Assert.True(
                StillAsleep(boxes),
                $"spurious wake: relocating a support 5.5 m away woke the stack at step {step}; sleepStep={sleepStep}, y=[{YsState(boxes)}].");
        }

        for (int i = 0; i < boxes.Length; i++)
        {
            Vec3 after = _world.Bodies.GetTransform(boxes[i]).Position;
            Assert.True(after == before[i], $"an unrelated relocation moved box{i} from {before[i]} to {after}.");
        }
    }

    [Fact]
    public void AlreadyAwakeBottomBox_Withdrawal_StillWakesTheSleepingBoxesAboveIt()
    {
        BodyId ground = CreateGround();
        BodyId[] boxes = CreateStack(3, allowSleep: true);
        Outcome outcome = Withdraw(ground, boxes, pokeBottom: true);
        _output.WriteLine(Dump(outcome));

        Assert.True(outcome.SleepStep > 0, $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(boxes)}].");
        Assert.True(
            outcome.WakeStep.All(step => step >= 1 && step <= WakeWindow),
            $"propagation stopped at a body that was already awake: wakeStep=[{Join(outcome.WakeStep)}], sleepStep={outcome.SleepStep}, {Dump(outcome)}");

        AssertFinalHeights(boxes, outcome);
        Assert.True(outcome.Finite, $"non-finite state after the poked withdrawal: {Dump(outcome)}");
    }

    private static void AssertFinalHeights(BodyId[] boxes, Outcome outcome)
    {
        for (int i = 0; i < boxes.Length; i++)
        {
            float analytic = AnalyticRestY(i);
            float delta = outcome.Y[i] - analytic;
            Assert.True(
                Math.Abs(delta) <= Slop(),
                $"box{i} did not rest within one slop of the analytic height above the new support: y={outcome.Y[i]:0.0000000}, analytic={analytic:0.0000000}, delta={delta:0.0000000}, was={outcome.Before[i]:0.0000000}, wakeStep=[{Join(outcome.WakeStep)}], {Dump(outcome)}");
        }
    }

    private Outcome Withdraw(BodyId ground, BodyId[] boxes, bool pokeBottom = false)
    {
        Outcome outcome = new()
        {
            SleepStep = StepUntilAllAsleep(boxes),
            Before = boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y).ToArray(),
        };

        if (pokeBottom)
        {
            _world.Bodies.SetAwake(boxes[0], true);
        }

        _world.Bodies.SetTransform(ground, new Vec3(0.0f, -Drop, 0.0f), Quat.Identity);
        outcome.WakeStep = new int[boxes.Length];
        Array.Fill(outcome.WakeStep, -1);

        for (int step = 1; step <= SettleLimit; step++)
        {
            _world.Step(Dt);
            for (int i = 0; i < boxes.Length; i++)
            {
                if (outcome.WakeStep[i] < 0 && _world.Bodies.IsAwake(boxes[i]))
                {
                    outcome.WakeStep[i] = step;
                }
            }

            if (outcome.ResleepStep < 0 && step > WakeWindow && AllAsleep(boxes))
            {
                outcome.ResleepStep = step;
            }
        }

        outcome.Y = boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y).ToArray();
        outcome.Contacts = _world.ContactCount;
        outcome.GroundVelocity = _world.Bodies.GetLinearVelocity(ground);
        outcome.GroundPosition = _world.Bodies.GetTransform(ground).Position;
        outcome.Finite = AllFinite(boxes, ground);
        outcome.Asleep = AllAsleep(boxes);
        return outcome;
    }

    private int StepUntilAllAsleep(BodyId[] boxes)
    {
        for (int step = 1; step <= SleepLimit; step++)
        {
            _world.Step(Dt);
            if (AllAsleep(boxes))
            {
                return step;
            }
        }

        return -1;
    }

    private bool AllAsleep(BodyId[] boxes) => boxes.All(id => !_world.Bodies.IsAwake(id));

    private bool StillAsleep(BodyId[] boxes) => boxes.All(id => !_world.Bodies.IsAwake(id));

    private bool AllFinite(BodyId[] boxes, BodyId ground)
    {
        foreach (BodyId id in boxes.Append(ground))
        {
            Vec3 position = _world.Bodies.GetTransform(id).Position;
            Vec3 linear = _world.Bodies.GetLinearVelocity(id);
            Vec3 angular = _world.Bodies.GetAngularVelocity(id);
            if (!Finite(position) || !Finite(linear) || !Finite(angular))
            {
                return false;
            }
        }

        return true;
    }

    private static bool Finite(Vec3 value) =>
        !float.IsNaN(value.X + value.Y + value.Z) && !float.IsInfinity(value.X + value.Y + value.Z);

    private BodyId CreateGround() => CreateSlab(Vec3.Zero);

    private BodyId CreateSlab(Vec3 center)
    {
        BodyId slab = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = center });
        _world.Shapes.AttachBox(
            _world.Bodies,
            _world.Broadphase,
            slab,
            new Vec3(0.0f, -GroundHalf, 0.0f),
            new Vec3(40.0f, GroundHalf, 40.0f));
        return slab;
    }

    private BodyId[] CreateStack(int count, bool allowSleep)
    {
        BodyId[] boxes = new BodyId[count];
        for (int i = 0; i < count; i++)
        {
            BodyId box = _world.Bodies.Create(new BodyDef { AllowSleep = allowSleep });
            _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(CubeHalf, CubeHalf, CubeHalf));
            _world.Bodies.SetTransform(box, new Vec3(0.0f, CubeHalf + (2.0f * CubeHalf) * i, 0.0f), Quat.Identity);
            boxes[i] = box;
        }

        return boxes;
    }

    private static float Slop() => PhysicsConstants.LinearSlop;

    private static float AnalyticRestY(int index) => -Drop + CubeHalf + (2.0f * CubeHalf) * index - ((index + 1) * Slop());

    private string AwakeState(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"));

    private string YsState(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000")));

    private static string Join(int[] values) => string.Join(" ", values);

    private static string Dump(Outcome outcome) =>
        $"sleepStep={outcome.SleepStep} wakeStep=[{Join(outcome.WakeStep)}] resleepStep={outcome.ResleepStep} " +
        $"y=[{string.Join(" ", outcome.Y.Select(v => v.ToString("0.0000")))}] " +
        $"was=[{string.Join(" ", outcome.Before.Select(v => v.ToString("0.0000")))}] " +
        $"contacts={outcome.Contacts} asleep={outcome.Asleep} finite={outcome.Finite} " +
        $"groundPos={outcome.GroundPosition} groundVel={outcome.GroundVelocity}";

    private sealed class Outcome
    {
        public int SleepStep { get; init; }

        public int[] WakeStep { get; set; } = [];

        public int ResleepStep { get; set; } = -1;

        public float[] Before { get; init; } = [];

        public float[] Y { get; set; } = [];

        public int Contacts { get; set; }

        public Vec3 GroundPosition { get; set; }

        public Vec3 GroundVelocity { get; set; }

        public bool Finite { get; set; }

        public bool Asleep { get; set; }
    }
}
