namespace Axrone.Physics2D.Tests;

using System.Globalization;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Gates the pending-seed queue that carries a caller's input into the 2D wake
/// walk. A body pulled out of sleep is appended once and the queue is emptied
/// when the walk drains it; if emptying forgets to release the marks it carried,
/// the next command on that same body is swallowed and whatever rests on it stays
/// asleep. The first poke is covered elsewhere; the second one is a separate path
/// and was not, so each gate reports the queue length measured at the moment the
/// command was given, where a stale list shows up as a zero.
/// </summary>
public sealed class WakeSeedQueue2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float BoxHalf = 0.5f;
    private const int SleepLimit = 300;
    private const int StackSize = 3;
    private const int StackContacts = 3;

    private readonly World _world;

    public WakeSeedQueue2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void TwoCommandsOnOneBodyInOneStep_QueueOneSeedAndWakeTheStack()
    {
        AddGround();
        BodyId[] stack = AddStack(0.0f);
        int sleepStep = SleepStepAll(stack, SleepLimit);

        sleepStep.Should().BeGreaterThan(0, $"precondition: the three stack never slept within {SleepLimit} steps; {Row(stack, sleepStep)}");

        _world.Bodies.ApplyLinearImpulse(stack[0], new Vec2(0.0f, 6.0f));
        int afterFirst = _world.Bodies.PendingWakeCount;
        _world.Bodies.ApplyLinearImpulse(stack[0], new Vec2(0.0f, 6.0f));
        int afterSecond = _world.Bodies.PendingWakeCount;

        afterFirst.Should().Be(1, $"the first command on a sleeping base left {afterFirst} body(s) in the pending queue, expected 1; {Row(stack, sleepStep)}");
        afterSecond.Should().Be(1, $"two commands on the same body in one step queued {afterSecond} entries, expected 1 — the slot is already listed, and a body listed twice is walked twice (first={afterFirst}, {Row(stack, sleepStep)})");

        _world.Step(Dt);

        _world.Bodies.PendingWakeCount.Should().Be(0, $"the step left {_world.Bodies.PendingWakeCount} entries in the pending queue, expected 0 — a drained queue that still counts entries is a queue whose marks were never released; {Row(stack, sleepStep)}");
        stack.Select(id => _world.Bodies.IsAwake(id)).Should().OnlyContain(
            awake => awake,
            $"after the step that drained the queue, {Row(stack, sleepStep)}; everything resting on the struck base had to wake with it");
    }

    [Fact]
    public void SecondCommandOnTheSameBody_AcrossSteps_WakesTheStackAgain()
    {
        AddGround();
        BodyId[] stack = AddStack(0.0f);
        int sleepStep = SleepStepAll(stack, SleepLimit);

        sleepStep.Should().BeGreaterThan(0, $"precondition: the three stack never slept within {SleepLimit} steps; {Row(stack, sleepStep)}");

        _world.Bodies.ApplyLinearImpulse(stack[0], new Vec2(0.0f, 6.0f));
        _world.Step(Dt);
        stack.Select(id => _world.Bodies.IsAwake(id)).Should().OnlyContain(
            awake => awake,
            $"precondition: the first command did not wake the stack; seeds={_world.Bodies.PendingWakeCount}, {Row(stack, sleepStep)}");

        int resleepStep = SleepStepAll(stack, SleepLimit);
        resleepStep.Should().BeGreaterThan(0, $"precondition: the stack never slept again within {SleepLimit} steps after the first command; {Row(stack, resleepStep)}");
        ColumnGap(stack).Should().BeGreaterThan(0.5f, $"precondition: the column must still be standing before the second command; y=[{Ys(stack)}], contacts={_world.ContactCount}, first sleepStep={sleepStep}, resleepStep={resleepStep}");

        _world.Bodies.ApplyLinearImpulse(stack[0], new Vec2(0.0f, 6.0f));

        _world.Bodies.PendingWakeCount.Should().Be(
            1,
            $"the second command on a body the previous step had already seeded queued {_world.Bodies.PendingWakeCount} entries, expected 1: draining the queue has to release the marks it carried, or every later command on that body is swallowed and the walk never runs (awake=[{Awake(stack)}], first sleepStep={sleepStep}, resleepStep={resleepStep}, y=[{Ys(stack)}])");

        _world.Step(Dt);

        stack.Select(id => _world.Bodies.IsAwake(id)).Should().OnlyContain(
            awake => awake,
            $"the stack stayed asleep after a second command on its base, one step after the first command had woken all of it: {Row(stack, resleepStep)}, first sleepStep={sleepStep}, resleepStep={resleepStep}, seeds after={_world.Bodies.PendingWakeCount}");
        _world.Bodies.PendingWakeCount.Should().Be(0, $"the second draining step left {_world.Bodies.PendingWakeCount} entries queued, expected 0; {Row(stack, resleepStep)}");
    }

    [Fact]
    public void CommandsOnTwoBodiesInOneStep_QueueTwoSeedsAndWakeBothStacks()
    {
        AddGround();
        BodyId[] first = AddStack(0.0f);
        BodyId[] second = AddStack(12.0f);
        BodyId[] all = first.Concat(second).ToArray();
        int sleepStep = SleepStepAll(all, SleepLimit);

        sleepStep.Should().BeGreaterThan(0, $"precondition: the two stacks never both slept within {SleepLimit} steps; {Row(all, sleepStep)}");

        _world.Bodies.ApplyLinearImpulse(first[0], new Vec2(0.0f, 6.0f));
        _world.Bodies.ApplyLinearImpulse(second[0], new Vec2(0.0f, 6.0f));

        _world.Bodies.PendingWakeCount.Should().Be(2, $"commands on two different bodies in one step queued {_world.Bodies.PendingWakeCount} entries, expected 2 — the two bases are distinct slots and neither may displace the other; {Row(all, sleepStep)}");

        _world.Step(Dt);

        all.Select(id => _world.Bodies.IsAwake(id)).Should().OnlyContain(
            awake => awake,
            $"after the step that drained two entries, {Row(all, sleepStep)}; both stacks rest on their own base and both had to wake");
        _world.Bodies.PendingWakeCount.Should().Be(0, $"the step left {_world.Bodies.PendingWakeCount} entries queued, expected 0; {Row(all, sleepStep)}");
        _world.ContactCount.Should().Be(2 * StackContacts, $"two separate stacks must carry {2 * StackContacts} contacts once both are awake, measured {_world.ContactCount}; {Row(all, sleepStep)}");
    }

    private void AddGround()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec2[] { new(-40.0f, -1.0f), new(40.0f, -1.0f), new(40.0f, 1.0f), new(-40.0f, 1.0f) },
            material: new PhysicsMaterial(0.8f, 0.0f));
    }

    private BodyId[] AddStack(float x)
    {
        BodyId[] boxes = new BodyId[StackSize];
        for (int i = 0; i < StackSize; i++)
        {
            BodyId box = _world.Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = new Vec2(x, BoxHalf + (2.0f * BoxHalf) * i), AllowSleep = true });
            _world.Shapes.AttachPolygon(
                _world.Bodies,
                _world.Broadphase,
                box,
                new Vec2[] { new(-BoxHalf, -BoxHalf), new(BoxHalf, -BoxHalf), new(BoxHalf, BoxHalf), new(-BoxHalf, BoxHalf) },
                material: new PhysicsMaterial(0.7f, 0.0f));
            boxes[i] = box;
        }

        return boxes;
    }

    private int SleepStepAll(BodyId[] boxes, int limit)
    {
        for (int step = 1; step <= limit; step++)
        {
            _world.Step(Dt);
            if (boxes.All(id => !_world.Bodies.IsAwake(id)))
            {
                return step;
            }
        }

        return -1;
    }

    private float ColumnGap(BodyId[] stack)
    {
        float bottom = _world.Bodies.GetTransform(stack[0]).Position.Y;
        float middle = _world.Bodies.GetTransform(stack[1]).Position.Y;
        return middle - bottom;
    }

    private string Awake(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"));

    private string Ys(BodyId[] boxes) => string.Join(" ", boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y.ToString("0.0000", CultureInfo.InvariantCulture)));

    private string Row(BodyId[] boxes, int sleepStep) => $"awake=[{Awake(boxes)}] y=[{Ys(boxes)}] contacts={_world.ContactCount} sleepStep={sleepStep}";
}
