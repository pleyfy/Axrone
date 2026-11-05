namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class BodyAccessorTests : IDisposable
{
    private const float Tolerance = 1e-4f;

    private readonly World _world;

    public BodyAccessorTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void PointAndVectorTransforms_RoundTrip()
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Position = new Vec2(3f, -2f), Angle = 0.7f });
        Vec2 local = new(1f, 2f);

        Vec2 worldPoint = _world.Bodies.GetWorldPoint(body, local);
        Vec2 worldVector = _world.Bodies.GetWorldVector(body, local);

        Vec2 backPoint = _world.Bodies.GetLocalPoint(body, worldPoint);
        Vec2 backVector = _world.Bodies.GetLocalVector(body, worldVector);

        backPoint.X.Should().BeApproximately(local.X, Tolerance);
        backPoint.Y.Should().BeApproximately(local.Y, Tolerance);
        backVector.X.Should().BeApproximately(local.X, Tolerance);
        backVector.Y.Should().BeApproximately(local.Y, Tolerance);

        Vec2 origin = _world.Bodies.GetTransform(body).Position;
        worldVector.X.Should().BeApproximately(worldPoint.X - origin.X, Tolerance);
        worldVector.Y.Should().BeApproximately(worldPoint.Y - origin.Y, Tolerance);
    }

    [Fact]
    public void VelocityAtPoint_IncludesRotationalContribution()
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Position = new Vec2(1f, 1f) });
        _world.Bodies.SetLinearVelocity(body, new Vec2(2f, 0f));
        _world.Bodies.SetAngularVelocity(body, 3f);

        Vec2 velocity = _world.Bodies.GetLinearVelocityAtPoint(body, new Vec2(1f, 2f));

        velocity.X.Should().BeApproximately(-1f, Tolerance);
        velocity.Y.Should().BeApproximately(0f, Tolerance);
    }

    [Fact]
    public void Center_TranslatesLocalComToWorld()
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Position = new Vec2(2f, 0f), Angle = MathF.PI / 2f });
        _world.Bodies.SetMassData(body, 1f, 1f, new Vec2(1f, 0f));

        Vec2 center = _world.Bodies.GetCenter(body);

        center.X.Should().BeApproximately(2f, Tolerance);
        center.Y.Should().BeApproximately(1f, Tolerance);
    }

    [Fact]
    public void MassData_RoundTripsThroughGetterAndSetter()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());
        _world.Bodies.SetMassData(body, 2f, 4f, new Vec2(0.5f, -0.25f));

        MassData data = _world.Bodies.GetMassData(body);
        data.Mass.Should().Be(2f);
        data.InverseMass.Should().Be(0.5f);
        data.Inertia.Should().Be(4f);
        data.InverseInertia.Should().Be(0.25f);
        data.Centroid.X.Should().BeApproximately(0.5f, Tolerance);
        data.Centroid.Y.Should().BeApproximately(-0.25f, Tolerance);

        Action negative = () => _world.Bodies.SetMassData(body, -1f, 1f, Vec2.Zero);
        negative.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void ResetMassData_RebuildsFromAttachedShapes()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());
        _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, body, Vec2.Zero, 1f, density: 2f);

        _world.Bodies.SetMassData(body, 999f, 999f, new Vec2(7f, 7f));
        _world.Bodies.ResetMassData(body, _world.Shapes);

        MassData data = _world.Bodies.GetMassData(body);
        data.Mass.Should().BeApproximately(2f * MathF.PI, Tolerance);
        data.Centroid.X.Should().BeApproximately(0f, Tolerance);
        data.Centroid.Y.Should().BeApproximately(0f, Tolerance);
        data.InverseMass.Should().BeApproximately(1f / (2f * MathF.PI), Tolerance);
    }

    [Fact]
    public void StaticBody_KeepsInfiniteResponseThroughMassData()
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Bodies.SetMassData(body, 5f, 5f, Vec2.Zero);

        _world.Bodies.GetMass(body).Should().Be(5f);
        _world.Bodies.GetInverseMass(body).Should().Be(0f);
        _world.Bodies.GetInverseInertia(body).Should().Be(0f);
    }

    [Fact]
    public void FixedRotation_PinsAndRestoresInertia()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());
        _world.Bodies.SetMassData(body, 1f, 2f, Vec2.Zero);
        _world.Bodies.SetAngularVelocity(body, 4f);

        _world.Bodies.SetFixedRotation(body, true);
        _world.Bodies.GetFixedRotation(body).Should().BeTrue();
        _world.Bodies.GetAngularVelocity(body).Should().Be(0f);
        _world.Bodies.GetInverseInertia(body).Should().Be(0f);

        _world.Bodies.SetFixedRotation(body, false);
        _world.Bodies.GetInverseInertia(body).Should().BeApproximately(0.5f, Tolerance);
    }

    [Fact]
    public void BulletAndSleepingFlags_RoundTrip()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());

        _world.Bodies.SetBullet(body, true);
        _world.Bodies.GetBullet(body).Should().BeTrue();

        _world.Bodies.SetSleeping(body, true);
        _world.Bodies.IsSleeping(body).Should().BeTrue();
        _world.Bodies.GetLinearVelocity(body).X.Should().Be(0f);

        _world.Bodies.SetSleeping(body, false);
        _world.Bodies.IsAwake(body).Should().BeTrue();

        _world.Bodies.SetAllowSleep(body, false);
        _world.Bodies.GetAllowSleep(body).Should().BeFalse();
        _world.Bodies.SetAllowSleep(body, true);
        _world.Bodies.GetAllowSleep(body).Should().BeTrue();
    }

    [Fact]
    public void DampingAndGravityScale_RoundTripWithGuards()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());

        _world.Bodies.SetDamping(body, 0.4f, 0.6f);
        Vec2 damping = _world.Bodies.GetDamping(body);
        damping.X.Should().BeApproximately(0.4f, Tolerance);
        damping.Y.Should().BeApproximately(0.6f, Tolerance);

        _world.Bodies.SetGravityScale(body, 2f);
        _world.Bodies.GetGravityScale(body).Should().Be(2f);

        Action badDamping = () => _world.Bodies.SetDamping(body, -1f, 0f);
        Action badGravity = () => _world.Bodies.SetGravityScale(body, float.NaN);
        badDamping.Should().Throw<InvalidOperationException>();
        badGravity.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void ShapeFilterAndMaterial_RoundTripThroughStore()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());
        ShapeId shape = _world.Shapes.AttachCircle(_world.Bodies, _world.Broadphase, body, Vec2.Zero, 1f);

        var filter = new CollisionFilter(4, 8, -3);
        var material = new PhysicsMaterial(0.5f, 0.25f, 0.5f, 0.3f, 1.5f, CombineMode.Average, CombineMode.Min);

        _world.Shapes.SetFilter(shape, in filter);
        _world.Shapes.SetMaterial(shape, in material);

        _world.Shapes.GetFilter(shape).Should().Be(filter);
        _world.Shapes.GetMaterial(shape).Should().Be(material);
    }

    [Fact]
    public void TwoArgMaterial_KeepsLegacySemantics()
    {
        var material = new PhysicsMaterial(0.6f, 0.3f);

        material.Friction.Should().Be(0.6f);
        material.StaticFriction.Should().Be(0.6f);
        material.DynamicFriction.Should().Be(0.6f);
        material.TangentSpeed.Should().Be(0f);
        material.FrictionCombine.Should().Be(CombineMode.Max);
        material.RestitutionCombine.Should().Be(CombineMode.Max);

        var full = new PhysicsMaterial(0.6f, 0.3f, 0.8f, 0.2f, 4f, CombineMode.Min, CombineMode.Multiply);
        full.DynamicFriction.Should().Be(0.2f);
        full.TangentSpeed.Should().Be(4f);

        var mirrored = new PhysicsMaterial(0.6f, 0.3f, 0.8f, 0f, 0f, CombineMode.Max, CombineMode.Max);
        mirrored.DynamicFriction.Should().Be(0.8f);
    }

    [Fact]
    public void SetTransform_WakesAndMovesTheBody()
    {
        BodyId body = _world.Bodies.Create(new BodyDef());
        _world.Bodies.SetSleeping(body, true);

        _world.Bodies.SetTransform(body, new Vec2(4f, 5f), 1f);

        _world.Bodies.IsAwake(body).Should().BeTrue();
        _world.Bodies.GetTransform(body).Position.X.Should().BeApproximately(4f, Tolerance);
    }
}
