namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class ContactCallbackTests : IDisposable
{
    private readonly World _world;

    public ContactCallbackTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private static BodyId AddSlidingBlock(World world, PhysicsMaterial blockMaterial, float initialSpeed = 4f)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, ground,
            new Vec2[] { new(-10f, 0f), new(10f, 0f), new(10f, 1f), new(-10f, 1f) },
            material: new PhysicsMaterial(0.5f, 0f));

        BodyId block = world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 0.1f), LinearVelocity = new Vec2(initialSpeed, 0f) });
        world.Bodies.SetMassData(block, 1f, 1f, Vec2.Zero);
        world.Shapes.AttachPolygon(
            world.Bodies, world.Broadphase, block,
            new Vec2[] { new(-0.5f, -0.5f), new(0.5f, -0.5f), new(0.5f, 0.5f), new(-0.5f, 0.5f) },
            material: blockMaterial);
        return block;
    }

    private BodyId AddRestingBall()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0f, -1f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies, _world.Broadphase, ground,
            new Vec2[] { new(-10f, 0f), new(10f, 0f), new(10f, 1f), new(-10f, 1f) });
        BodyId ball = _world.Bodies.Create(new BodyDef { Position = new Vec2(0f, 0.4f) });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, ball, Vec2.Zero, 0.5f);
        return ball;
    }

    [Fact]
    public void PreSolve_ZeroedFrictionKeepsTheBlockSliding()
    {
        using var baselineWorld = new World();
        BodyId baseline = AddSlidingBlock(baselineWorld, new PhysicsMaterial(0.5f, 0f));
        for (int i = 0; i < 30; i++)
        {
            baselineWorld.Step(1f / 60f);
        }

        float stoppedDistance = baselineWorld.Bodies.GetTransform(baseline).Position.X;
        baselineWorld.Bodies.GetLinearVelocity(baseline).X.Should().BeLessThan(4f);

        using var slickWorld = new World();
        BodyId slick = AddSlidingBlock(slickWorld, new PhysicsMaterial(0.5f, 0f));
        var handler = new FrictionEraser { State = default };
        for (int i = 0; i < 30; i++)
        {
            slickWorld.Step(1f / 60f, handler, ref handler.State);
        }

        float slidingDistance = slickWorld.Bodies.GetTransform(slick).Position.X;
        slidingDistance.Should().BeGreaterThan(stoppedDistance);
        stoppedDistance.Should().BeGreaterThan(0f);
    }

    [Fact]
    public void PostSolve_ReportsImpulsesForRestingContact()
    {
        AddRestingBall();
        var handler = new ImpulseRecorder { State = default };

        _world.Step(1f / 60f, handler, ref handler.State);

        handler.State.PostSolveCount.Should().Be(1);
        handler.State.LastNormalImpulse.Should().BeGreaterThan(0f);
    }

    [Fact]
    public void PreSolve_FiresOncePerStepWithTuningFromMaterials()
    {
        AddSlidingBlock(_world, new PhysicsMaterial(0.5f, 0.2f));
        var handler = new TuningSpy { State = default };

        _world.Step(1f / 60f, handler, ref handler.State);
        _world.Step(1f / 60f, handler, ref handler.State);

        handler.State.PreSolveCount.Should().Be(2);
        handler.State.SeenFriction.Should().BeApproximately(0.5f, 1e-4f);
        handler.State.SeenRestitution.Should().BeApproximately(0.2f, 1e-4f);
        handler.State.SeenPrePhase.Should().Be(CollisionEventType.PreSolve);
        handler.State.SeenPostPhase.Should().Be(CollisionEventType.PostSolve);
    }

    [Fact]
    public void Sensors_GetNoCallbackPoints()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, ground, Vec2.Zero, 2f, isSensor: true);
        BodyId ball = _world.Bodies.Create(new BodyDef { Position = new Vec2(1f, 0f) });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, ball, Vec2.Zero, 0.5f);

        var handler = new ImpulseRecorder { State = default };
        _world.Step(1f / 60f, handler, ref handler.State);

        _world.ContactCount.Should().Be(1);
        handler.State.PostSolveCount.Should().Be(0);
    }

    [Fact]
    public void ImpulseNotices_ArePublishedForSolidContactsOnly()
    {
        AddRestingBall();

        _world.Step(1f / 60f);

        _world.ContactImpulseEventCount.Should().Be(1);
        ContactImpulseEvent notice = _world.GetContactImpulseEvent(0);
        notice.PointCount.Should().Be(1);
        notice.NormalAt(0).Should().BeGreaterThan(0f);
        notice.NormalAt(1).Should().Be(0f);

        Action outOfRange = () => _world.GetContactImpulseEvent(5);
        outOfRange.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void ImpulseNotices_ClearWithEachStep()
    {
        BodyId ball = AddRestingBall();

        _world.Step(1f / 60f);
        _world.ContactImpulseEventCount.Should().Be(1);

        _world.Bodies.SetTransform(ball, new Vec2(50f, 50f), 0f);
        _world.Step(1f / 60f);
        _world.ContactImpulseEventCount.Should().Be(0);
    }
}

internal struct FrictionEraser : IContactSolverCallbacks<Contact, ContactManifold, CallbackState>
{
    internal CallbackState State;

    public static void OnPreSolve(
        ref Contact contact, ref ContactManifold manifold, ref ContactTuning tuning, ref CallbackState context)
    {
        tuning.Friction = 0f;
        tuning.DynamicFriction = 0f;
    }

    public static void OnPostSolve(
        ref readonly Contact contact, in ContactManifold manifold, in ContactImpulses impulses, ref CallbackState context)
    {
    }
}

internal struct ImpulseRecorder : IContactSolverCallbacks<Contact, ContactManifold, CallbackState>
{
    internal CallbackState State;

    public static void OnPreSolve(
        ref Contact contact, ref ContactManifold manifold, ref ContactTuning tuning, ref CallbackState context)
    {
    }

    public static void OnPostSolve(
        ref readonly Contact contact, in ContactManifold manifold, in ContactImpulses impulses, ref CallbackState context)
    {
        context.PostSolveCount++;
        context.LastNormalImpulse = impulses.NormalAt(0);
    }
}

internal struct TuningSpy : IContactSolverCallbacks<Contact, ContactManifold, TuningState>
{
    internal TuningState State;

    public static void OnPreSolve(
        ref Contact contact, ref ContactManifold manifold, ref ContactTuning tuning, ref TuningState context)
    {
        context.PreSolveCount++;
        context.SeenFriction = tuning.Friction;
        context.SeenRestitution = tuning.Restitution;
        context.SeenPrePhase = tuning.Phase;
    }

    public static void OnPostSolve(
        ref readonly Contact contact, in ContactManifold manifold, in ContactImpulses impulses, ref TuningState context)
    {
        context.SeenPostPhase = impulses.Phase;
    }
}

internal struct CallbackState
{
    internal int PostSolveCount;

    internal float LastNormalImpulse;
}

internal struct TuningState
{
    internal int PreSolveCount;

    internal float SeenFriction;

    internal float SeenRestitution;

    internal CollisionEventType SeenPrePhase;

    internal CollisionEventType SeenPostPhase;
}
