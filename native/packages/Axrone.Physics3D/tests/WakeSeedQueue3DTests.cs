namespace Axrone.Physics3D.Tests;

using Axrone.Numeric;
using Xunit;

/// <summary>
/// Gates the seed queue that carries a caller's motion command into the wake
/// walk. A body set into motion is appended once per step and the queue is
/// emptied when the walk drains it; if the emptying forgets to release the slots
/// it marked, the next command on that same body is swallowed and the bodies
/// resting on it never wake — the second poke is a separate path from the first
/// and it was not covered. Each gate reports the queue length it measured at the
/// point the command was given, so a stale list shows up as a zero.
/// </summary>
public sealed class WakeSeedQueue3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int SleepLimit = 400;
    private const int StackSize = 3;
    private const int StackContacts = 3;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Fact]
    public void TwoCommandsOnOneBodyInOneStep_QueueOneSeedAndWakeTheStack()
    {
        CreateGround();
        BodyId[] stack = CreateStack(0.0f);
        int sleepStep = StepUntilAllAsleep(stack);

        Assert.True(
            sleepStep > 0,
            $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(stack)}].");

        _world.Bodies.SetLinearVelocity(stack[0], new Vec3(0.0f, 0.5f, 0.0f));
        int afterFirst = _world.Bodies.WakeSeedCount;
        _world.Bodies.SetLinearVelocity(stack[0], new Vec3(0.0f, 0.9f, 0.0f));
        int afterSecond = _world.Bodies.WakeSeedCount;

        Assert.True(
            afterFirst == 1,
            $"the first command on a sleeping base left {_world.Bodies.WakeSeedCount} seed(s) queued, expected 1 (awake=[{AwakeState(stack)}], sleepStep={sleepStep}).");
        Assert.True(
            afterSecond == 1,
            $"two commands on the same body in the same step queued {afterSecond} seeds, expected {afterFirst}: the slot is already in the list, and appending it twice makes the walk scan a body it has already woken twice (first={afterFirst}, awake=[{AwakeState(stack)}]).");

        _world.Step(Dt);

        Assert.True(
            _world.Bodies.WakeSeedCount == 0,
            $"the step left {_world.Bodies.WakeSeedCount} seed(s) in the queue, expected 0 — a drained queue that still counts entries is a queue whose marks were never released (awake=[{AwakeState(stack)}]).");
        Assert.True(
            stack.All(id => _world.Bodies.IsAwake(id)),
            $"after the step that drained one seed, awake=[{AwakeState(stack)}], expected every box in the stack awake; contacts={_world.ContactCount}, sleepStep={sleepStep}.");
    }

    [Fact]
    public void SecondCommandOnTheSameBody_AcrossSteps_WakesTheStackAgain()
    {
        CreateGround();
        BodyId[] stack = CreateStack(0.0f);
        int sleepStep = StepUntilAllAsleep(stack);

        Assert.True(
            sleepStep > 0,
            $"precondition: the three stack never slept within {SleepLimit} steps; awake=[{AwakeState(stack)}].");

        _world.Bodies.SetLinearVelocity(stack[0], new Vec3(0.0f, 0.5f, 0.0f));
        _world.Step(Dt);
        Assert.True(
            stack.All(id => _world.Bodies.IsAwake(id)),
            $"precondition: the first command did not wake the stack; awake=[{AwakeState(stack)}], seeds={_world.Bodies.WakeSeedCount}.");

        int resleepStep = StepUntilAllAsleep(stack);
        Assert.True(
            resleepStep > 0,
            $"precondition: the stack never slept again within {SleepLimit} steps after the first command; awake=[{AwakeState(stack)}], y=[{YsState(stack)}].");

        Assert.True(
            _world.Bodies.GetTransform(stack[1]).Position.Y - _world.Bodies.GetTransform(stack[0]).Position.Y > 0.5f &&
            _world.Bodies.GetTransform(stack[2]).Position.Y - _world.Bodies.GetTransform(stack[1]).Position.Y > 0.5f &&
            _world.ContactCount == StackContacts,
            $"precondition: the command that woke the stack left it lying down instead of standing: y=[{YsState(stack)}], contacts={_world.ContactCount}, expected {StackContacts}; the second poke has to be taken on the same column the first one woke (first sleepStep={sleepStep}, resleepStep={resleepStep}).");

        _world.Bodies.SetLinearVelocity(stack[0], new Vec3(0.0f, 0.5f, 0.0f));

        Assert.True(
            _world.Bodies.WakeSeedCount == 1,
            $"the second command on a body the previous step had already seeded queued {_world.Bodies.WakeSeedCount} seeds, expected 1: draining the queue has to release the marks it carried, or every later command on that body is swallowed and the walk never runs (awake=[{AwakeState(stack)}], resleepStep={resleepStep}).");

        _world.Step(Dt);

        Assert.True(
            stack.All(id => _world.Bodies.IsAwake(id)),
            $"the stack stayed asleep after a second command on its base, one step after the first command had woken it: awake=[{AwakeState(stack)}], seeds={_world.Bodies.WakeSeedCount}, contacts={_world.ContactCount}, first sleepStep={sleepStep}, resleepStep={resleepStep}, y=[{YsState(stack)}].");
        Assert.True(
            _world.Bodies.WakeSeedCount == 0,
            $"the second draining step left {_world.Bodies.WakeSeedCount} seed(s) queued, expected 0 (awake=[{AwakeState(stack)}]).");
    }

    [Fact]
    public void CommandsOnTwoBodiesInOneStep_QueueTwoSeedsAndWakeBothStacks()
    {
        CreateGround();
        BodyId[] first = CreateStack(0.0f);
        BodyId[] second = CreateStack(12.0f);
        BodyId[] all = first.Concat(second).ToArray();
        int sleepStep = StepUntilAllAsleep(all);

        Assert.True(
            sleepStep > 0,
            $"precondition: the two stacks never both slept within {SleepLimit} steps; awake=[{AwakeState(all)}].");

        _world.Bodies.SetLinearVelocity(first[0], new Vec3(0.0f, 0.5f, 0.0f));
        _world.Bodies.SetLinearVelocity(second[0], new Vec3(0.0f, -0.5f, 0.0f));

        Assert.True(
            _world.Bodies.WakeSeedCount == 2,
            $"commands on two different bodies in one step queued {_world.Bodies.WakeSeedCount} seeds, expected 2 — the two bases are distinct slots and neither may displace the other (awake=[{AwakeState(all)}], sleepStep={sleepStep}).");

        _world.Step(Dt);

        Assert.True(
            all.All(id => _world.Bodies.IsAwake(id)),
            $"after the step that drained two seeds, awake=[{AwakeState(all)}]; both stacks rest on their own base and both had to wake (seeds={_world.Bodies.WakeSeedCount}, contacts={_world.ContactCount}).");
        Assert.True(
            _world.Bodies.WakeSeedCount == 0,
            $"the step left {_world.Bodies.WakeSeedCount} seed(s) queued, expected 0 (awake=[{AwakeState(all)}]).");
        Assert.True(
            _world.ContactCount == 2 * StackContacts,
            $"two separate stacks must carry {2 * StackContacts} contacts once both are awake, measured {_world.ContactCount} (awake=[{AwakeState(all)}], y=[{YsState(all)}]).");
    }

    private BodyId CreateGround()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec3(0.0f, -0.5f, 0.0f),
            new Vec3(40.0f, 0.5f, 40.0f));
        return ground;
    }

    private BodyId[] CreateStack(float x)
    {
        BodyId[] boxes = new BodyId[StackSize];
        for (int i = 0; i < StackSize; i++)
        {
            BodyId box = _world.Bodies.Create(new BodyDef { AllowSleep = true });
            _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(Half, Half, Half));
            _world.Bodies.SetTransform(box, new Vec3(x, Half + (2.0f * Half) * i, 0.0f), Quat.Identity);
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
}
