namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class SensorTests : IDisposable
{
    private readonly World _world;

    public SensorTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private BodyId AddCircle(Vec2 center, float radius, BodyType type = BodyType.Dynamic, bool isSensor = false)
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Type = type, Position = center });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, body, new Vec2(0, 0), radius, isSensor: isSensor);
        return body;
    }

    [Fact]
    public void SensorOverlap_ProducesContact_MarkedSensor()
    {
        AddCircle(new Vec2(0, 0), 1f, BodyType.Static, isSensor: true);
        AddCircle(new Vec2(0, 1.5f), 1f);

        _world.Step(1f / 60f);

        _world.ContactCount.Should().Be(1);
        _world.GetContact(0).IsSensor.Should().BeTrue();
    }

    [Fact]
    public void SensorOverlap_DoesNotPush_BodyFallsThrough()
    {
        float sensorY = SettleWithSensor(isSensor: true);
        float solidY = SettleWithSensor(isSensor: false);

        sensorY.Should().BeLessThan(1.5f);
        sensorY.Should().BeLessThan(solidY);
    }

    [Fact]
    public void SetSensor_TogglesFlag_And_RejectsUnknown()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());
        ShapeId shape = _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, body, new Vec2(0, 0), 1f);

        _world.Shapes.IsSensor(shape).Should().BeFalse();

        _world.Shapes.SetSensor(shape, true);
        _world.Shapes.IsSensor(shape).Should().BeTrue();

        _world.Shapes.SetSensor(shape, false);
        _world.Shapes.IsSensor(shape).Should().BeFalse();

        Action unknown = () => _world.Shapes.SetSensor(ShapeId.FromRaw(999u), true);
        unknown.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void SensorOverlap_RaisesBeginEvent()
    {
        AddCircle(new Vec2(0, 0), 1f, BodyType.Static, isSensor: true);
        AddCircle(new Vec2(0, 1.5f), 1f);

        _world.Step(1f / 60f);

        _world.ContactEventCount.Should().Be(1);
        ContactEvent evt = _world.GetContactEvent(0);
        evt.Type.Should().Be(CollisionEventType.Begin);
        Contact contact = _world.GetContact(0);
        evt.ShapeA.Should().Be(contact.ShapeA);
        evt.ShapeB.Should().Be(contact.ShapeB);
    }

    [Fact]
    public void SensorOverlap_Raises_Enter_Then_Exit()
    {
        AddCircle(new Vec2(0, 0), 1f, BodyType.Static, isSensor: true);
        BodyId ball = _world.Bodies.Create(new BodyDef { Position = new Vec2(0, 1.5f), LinearVelocity = new Vec2(0, 5) });
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, ball, new Vec2(0, 0), 1f);

        _world.Step(1f / 60f);

        _world.SensorEventCount.Should().Be(1);
        SensorEvent entered = _world.GetSensorEvent(0);
        entered.Type.Should().Be(SensorEventType.Enter);

        bool exited = false;
        for (int i = 0; i < 60 && !exited; i++)
        {
            _world.Step(1f / 60f);
            for (int j = 0; j < _world.SensorEventCount; j++)
            {
                if (_world.GetSensorEvent(j).Type == SensorEventType.Exit)
                {
                    exited = true;
                }
            }
        }

        exited.Should().BeTrue();
    }

    [Fact]
    public void SolidOverlap_Raises_No_Sensor_Event()
    {
        AddCircle(new Vec2(0, 0), 1f, BodyType.Static);
        AddCircle(new Vec2(0, 1.5f), 1f);

        _world.Step(1f / 60f);

        _world.ContactEventCount.Should().Be(1);
        _world.SensorEventCount.Should().Be(0);
    }

    private static float SettleWithSensor(bool isSensor)
    {
        using var world = new World();
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0, 0) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, ground, new Vec2(0, 0), 1f, isSensor: isSensor);
        BodyId ball = world.Bodies.Create(new BodyDef { Position = new Vec2(0, 1.5f) });
        world.Shapes.AttachCircle(world.Bodies, world.Broadphase, ball, new Vec2(0, 0), 1f);

        world.Step(1f / 60f);

        return world.Bodies.GetTransform(ball).Position.Y;
    }
}
