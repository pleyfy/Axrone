namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class ApplyForcePointTests : IDisposable
{
    private const float Tolerance = 1e-4f;

    private readonly World _world;

    public ApplyForcePointTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private BodyId AddBody(BodyType type = BodyType.Dynamic, Vec2 position = default, float angle = 0f)
    {
        return _world.Bodies.Create(new BodyDef { Type = type, Position = position, Angle = angle });
    }

    private BodyId AddMassiveBody(Vec2 position = default, float mass = 1f, float inertia = 1f)
    {
        BodyId body = AddBody(BodyType.Dynamic, position);
        _world.Bodies.SetMassData(body, mass, inertia, Vec2.Zero);
        return body;
    }

    [Fact]
    public void EccentricForce_AccumulatesTorque()
    {
        BodyId body = AddBody();
        _world.Bodies.ApplyForce(body, new Vec2(0f, 10f), new Vec2(2f, 0f));

        ref BodyState state = ref _world.Bodies.Slot(body);
        state.Force.X.Should().BeApproximately(0f, Tolerance);
        state.Force.Y.Should().BeApproximately(10f, Tolerance);
        state.Torque.Should().BeApproximately(20f, Tolerance);
    }

    [Fact]
    public void CenteredForce_ProducesNoTorque()
    {
        BodyId body = AddBody();
        _world.Bodies.ApplyForce(body, new Vec2(0f, 10f));
        _world.Bodies.ApplyForceToCenter(body, new Vec2(3f, 0f));

        ref BodyState state = ref _world.Bodies.Slot(body);
        state.Force.X.Should().BeApproximately(3f, Tolerance);
        state.Force.Y.Should().BeApproximately(10f, Tolerance);
        state.Torque.Should().Be(0f);
    }

    [Fact]
    public void EccentricForce_ComparesAgainstAnalyticTorque()
    {
        BodyId body = AddMassiveBody();
        BodyId twin = AddMassiveBody();
        Vec2 force = new(0f, 5f);
        Vec2 point = new(-3f, 1f);

        _world.Bodies.ApplyForce(body, force, point);
        _world.Bodies.ApplyForceToCenter(twin, force);
        _world.Bodies.IntegrateVelocities(0.5f, Vec2.Zero, clearForces: true);
        _world.Bodies.IntegrateVelocities(0.5f, Vec2.Zero, clearForces: true);

        float expectedTorque = (point.X * force.Y) - (point.Y * force.X);
        float eccentricSpin = _world.Bodies.GetAngularVelocity(body);
        float centeredSpin = _world.Bodies.GetAngularVelocity(twin);

        // One step of dt=0.5 on inverse inertia 1: Δω = 0.5·τ; the second
        // step finds the accumulator cleared.
        eccentricSpin.Should().BeApproximately(0.5f * expectedTorque, Tolerance);
        centeredSpin.Should().Be(0f);
    }

    [Fact]
    public void EccentricImpulse_AddsAngularVelocity()
    {
        BodyId body = AddMassiveBody(position: new Vec2(1f, 1f));
        Vec2 impulse = new(0f, 2f);

        _world.Bodies.ApplyLinearImpulse(body, impulse, new Vec2(3f, 1f));

        _world.Bodies.GetLinearVelocity(body).X.Should().BeApproximately(0f, Tolerance);
        _world.Bodies.GetLinearVelocity(body).Y.Should().BeApproximately(2f, Tolerance);
        _world.Bodies.GetAngularVelocity(body).Should().BeApproximately(4f, Tolerance);
    }

    [Fact]
    public void CenteredImpulse_LeavesAngularVelocityAlone()
    {
        BodyId body = AddMassiveBody();
        _world.Bodies.ApplyLinearImpulse(body, new Vec2(1f, 0f), _world.Bodies.GetCenter(body));

        _world.Bodies.GetAngularVelocity(body).Should().Be(0f);
        _world.Bodies.GetLinearVelocity(body).X.Should().BeApproximately(1f, Tolerance);
    }

    [Fact]
    public void PointImpulse_RoundTripsAgainstAngularImpulse()
    {
        BodyId body = AddMassiveBody();
        BodyId twin = AddMassiveBody();
        Vec2 impulse = new(0f, 3f);
        Vec2 point = new(4f, 2f);
        float torque = (point.X * impulse.Y) - (point.Y * impulse.X);

        _world.Bodies.ApplyLinearImpulse(body, impulse, point);
        _world.Bodies.ApplyAngularImpulse(twin, torque);

        _world.Bodies.GetAngularVelocity(body).Should().BeApproximately(
            _world.Bodies.GetAngularVelocity(twin), Tolerance);
    }

    [Fact]
    public void StaticAndKinematicBodies_IgnoreForcesAndImpulses()
    {
        BodyId staticBody = AddBody(BodyType.Static);
        BodyId kinematicBody = AddBody(BodyType.Kinematic);

        _world.Bodies.ApplyForce(staticBody, new Vec2(1f, 1f), new Vec2(5f, 5f));
        _world.Bodies.ApplyLinearImpulse(staticBody, new Vec2(1f, 1f), new Vec2(5f, 5f));
        _world.Bodies.ApplyForce(kinematicBody, new Vec2(1f, 1f), new Vec2(5f, 5f));
        _world.Bodies.ApplyLinearImpulse(kinematicBody, new Vec2(1f, 1f), new Vec2(5f, 5f));

        ref BodyState staticState = ref _world.Bodies.Slot(staticBody);
        staticState.Force.X.Should().Be(0f);
        staticState.Torque.Should().Be(0f);
        _world.Bodies.GetLinearVelocity(kinematicBody).X.Should().Be(0f);
        _world.Bodies.GetAngularVelocity(kinematicBody).Should().Be(0f);
    }

    [Fact]
    public void FixedRotation_EccentricImpulseKeepsSpinPinned()
    {
        BodyId body = AddMassiveBody();
        _world.Bodies.SetFixedRotation(body, true);

        _world.Bodies.ApplyLinearImpulse(body, new Vec2(0f, 2f), new Vec2(3f, 0f));

        _world.Bodies.GetLinearVelocity(body).Y.Should().BeApproximately(2f, Tolerance);
        _world.Bodies.GetAngularVelocity(body).Should().Be(0f);
        _world.Bodies.GetInverseInertia(body).Should().Be(0f);
    }

    [Fact]
    public void DisabledBody_IgnoresForcesAndIntegration()
    {
        BodyId body = AddMassiveBody();
        _world.Bodies.SetEnabled(body, false);

        _world.Bodies.ApplyForce(body, new Vec2(10f, 0f));
        _world.Bodies.ApplyLinearImpulse(body, new Vec2(10f, 0f), _world.Bodies.GetCenter(body));
        _world.Bodies.Integrate(1f / 60f, PhysicsConstants.DefaultGravity2D);

        _world.Bodies.IsEnabled(body).Should().BeFalse();
        _world.Bodies.GetLinearVelocity(body).X.Should().Be(0f);
        _world.Bodies.GetLinearVelocity(body).Y.Should().Be(0f);

        _world.Bodies.SetEnabled(body, true);
        _world.Bodies.IsEnabled(body).Should().BeTrue();
        _world.Bodies.IsAwake(body).Should().BeTrue();
    }

    [Fact]
    public void TorqueAccumulates_AndIntegratesIntoSpin()
    {
        BodyId body = AddMassiveBody();
        _world.Bodies.ApplyTorque(body, 1f);
        _world.Bodies.ApplyTorque(body, 1f);

        ref BodyState state = ref _world.Bodies.Slot(body);
        state.Torque.Should().BeApproximately(2f, Tolerance);

        _world.Bodies.IntegrateVelocities(0.5f, Vec2.Zero, clearForces: true);
        _world.Bodies.GetAngularVelocity(body).Should().BeApproximately(1f, Tolerance);
        state.Torque.Should().Be(0f);
    }

    [Fact]
    public void WorldAutoClearForcesOff_KeepsAccumulatorsWarm()
    {
        BodyId body = AddMassiveBody();

        _world.AutoClearForces = false;
        _world.Bodies.ApplyForce(body, new Vec2(4f, 0f));
        _world.Step(1f / 60f);

        ref BodyState warm = ref _world.Bodies.Slot(body);
        warm.Force.X.Should().BeApproximately(4f, Tolerance);
        _world.Bodies.GetLinearVelocity(body).X.Should().BeGreaterThan(0f);

        _world.ClearForces();
        warm.Force.X.Should().Be(0f);

        _world.AutoClearForces = true;
        _world.Bodies.ApplyForce(body, new Vec2(4f, 0f));
        _world.Step(1f / 60f);
        warm.Force.X.Should().Be(0f);
    }

    [Fact]
    public void EccentricForce_WakesSleepingBody()
    {
        BodyId body = AddMassiveBody();
        _world.Bodies.SetSleeping(body, true);

        _world.Bodies.ApplyForce(body, new Vec2(1f, 0f), new Vec2(1f, 1f));

        _world.Bodies.IsAwake(body).Should().BeTrue();
    }
}
