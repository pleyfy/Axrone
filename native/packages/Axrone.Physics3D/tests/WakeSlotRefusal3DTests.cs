namespace Axrone.Physics3D.Tests;

using Axrone.Numeric;
using Xunit;

/// <summary>
/// Refusal gates for the wake queue's slot filter, paired with the 2D coverage.
/// The queue is handed raw slot indices by three callers — the contact adjacency,
/// the relocation sweep and the motion-seed list — and a slot can be recycled or
/// freed between the moment it was written and the moment it is read. The gates
/// assert that scenery, kinematics and a destroyed body's former slot all stay
/// out of the worklist, and that a sleeping dynamic body goes in.
/// </summary>
public sealed class WakeSlotRefusal3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Fact]
    public void WakeQueue_RefusesASlotWhoseBodyIsGone()
    {
        CreateGround();
        BodyId doomed = Cube(new Vec3(6.0f, Half, 0.0f), BodyType.Dynamic);
        int slot = BodyStore.SlotOf(doomed);
        _world.Bodies.Destroy(doomed);

        Assert.True(
            !_world.Bodies.IsValid(doomed),
            "precondition: the body has to be gone for this gate to mean anything.");

        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(slot);

        Assert.True(
            _world.WakeQueueLength == 0,
            $"the walk queued {_world.WakeQueueLength} slot(s) offered as destroyed body slot {slot}, expected 0: a slot the free list has taken back must never reach the awake write, whatever the record sitting in it still claims to be (contacts={_world.ContactCount}).");
        Assert.True(
            !_world.Bodies.IsValid(doomed),
            "offering a dead slot to the walk resurrected the body that used to own it.");
    }

    [Fact]
    public void WakeQueue_StillAcceptsTheLiveBodyThatReusedTheFreedSlot()
    {
        CreateGround();
        BodyId doomed = Cube(new Vec3(6.0f, Half, 0.0f), BodyType.Dynamic);
        int slot = BodyStore.SlotOf(doomed);
        _world.Bodies.Destroy(doomed);

        BodyId replacement = Cube(new Vec3(12.0f, Half, 0.0f), BodyType.Dynamic);
        Assert.True(
            BodyStore.SlotOf(replacement) == slot,
            $"precondition: the freed slot {slot} was expected to be handed to the next body, which got {BodyStore.SlotOf(replacement)}; the reuse case below only exists if the allocator recycles.");
        _world.Step(Dt);
        _world.Bodies.SetAwake(replacement, false);

        _world.BeginWakePropagation();
        _world.EnqueueWakeSlot(slot);

        Assert.True(
            _world.WakeQueueLength == 1,
            $"the walk refused {_world.WakeQueueLength} slots queued for the live body that reused the freed slot, expected the pass to accept it; refusing a recycled slot is the other half of the guard and would strand a sleeping body (awake={_world.Bodies.IsAwake(replacement)}, sleeping={_world.Bodies.IsSleeping(replacement)}).");
        Assert.True(
            _world.Bodies.IsAwake(replacement),
            $"the walk accepted the recycled slot but never wrote the awake bit: awake={_world.Bodies.IsAwake(replacement)}, queued={_world.WakeQueueLength}.");
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

    private BodyId Cube(Vec3 center, BodyType type)
    {
        BodyId box = _world.Bodies.Create(new BodyDef { Type = type, AllowSleep = true });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(Half, Half, Half));
        _world.Bodies.SetTransform(box, center, Quat.Identity);
        return box;
    }
}
