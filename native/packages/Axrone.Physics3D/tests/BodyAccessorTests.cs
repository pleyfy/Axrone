using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class BodyAccessorTests
{
    private static void AssertClose(Vec3 actual, Vec3 expected)
    {
        actual.X.Should().BeApproximately(expected.X, 1e-5f);
        actual.Y.Should().BeApproximately(expected.Y, 1e-5f);
        actual.Z.Should().BeApproximately(expected.Z, 1e-5f);
    }

    private static BodyStore StoreWithMass(out BodyId id, float mass, Vec3 inertia)
    {
        var store = new BodyStore();
        id = store.Create(new BodyDef { GravityScale = 0.0f });
        store.SetMassData(id, mass, inertia);
        return store;
    }

    [Fact]
    public void LinearVelocityAtPoint_CarriesSpin()
    {
        BodyStore store = StoreWithMass(out BodyId id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        store.SetLinearVelocity(id, new Vec3(1.0f, 0.0f, 0.0f));
        store.SetAngularVelocity(id, new Vec3(0.0f, 0.0f, 2.0f));

        Vec3 velocity = store.GetLinearVelocityAtPoint(id, new Vec3(0.0f, 1.0f, 0.0f));

        velocity.Should().Be(new Vec3(-1.0f, 0.0f, 0.0f));
    }

    [Fact]
    public void WorldLocalConversions_RoundTrip()
    {
        BodyStore store = StoreWithMass(out BodyId id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        Quat rotation = Quat.CreateFromAxisAngle(new Vec3(0.0f, 1.0f, 0.0f), MathF.PI / 2.0f);
        store.SetTransform(id, new Vec3(3.0f, 4.0f, 5.0f), rotation);

        Vec3 local = new(1.0f, 0.0f, 0.0f);
        Vec3 world = store.GetWorldPoint(id, local);
        AssertClose(store.GetLocalPoint(id, world), local);

        Vec3 localVector = new(0.0f, 0.0f, 1.0f);
        Vec3 worldVector = store.GetWorldVector(id, localVector);
        AssertClose(store.GetLocalVector(id, worldVector), localVector);

        AssertClose(world - new Vec3(3.0f, 4.0f, 5.0f), store.GetWorldVector(id, local));
    }

    [Fact]
    public void MassData_RoundTrips_SetMassData()
    {
        BodyStore store = StoreWithMass(out BodyId id, 2.0f, new Vec3(2.0f, 4.0f, 8.0f));

        MassData3D data = store.GetMassData(id);

        data.Mass.Should().Be(2.0f);
        data.InverseMass.Should().BeApproximately(0.5f, 1e-6f);
        data.InertiaDiagonal.Should().Be(new Vec3(2.0f, 4.0f, 8.0f));
        data.InverseInertiaDiagonal.X.Should().BeApproximately(0.5f, 1e-6f);
        data.InverseInertiaDiagonal.Y.Should().BeApproximately(0.25f, 1e-6f);
        data.InverseInertiaDiagonal.Z.Should().BeApproximately(0.125f, 1e-6f);
    }

    [Fact]
    public void FixedRotation_Lock_ZeroesSpin_Unlock_RestoresInertia()
    {
        BodyStore store = StoreWithMass(out BodyId id, 1.0f, new Vec3(2.0f, 4.0f, 8.0f));
        store.SetAngularVelocity(id, new Vec3(1.0f, 1.0f, 1.0f));

        store.SetFixedRotation(id, true);
        store.GetAngularVelocity(id).Should().Be(Vec3.Zero);
        store.GetInverseInertia(id).Should().Be(Vec3.Zero);
        store.IsFixedRotation(id).Should().BeTrue();

        store.SetFixedRotation(id, false);
        Vec3 restored = store.GetInverseInertia(id);
        restored.X.Should().BeApproximately(0.5f, 1e-6f);
        restored.Y.Should().BeApproximately(0.25f, 1e-6f);
        restored.Z.Should().BeApproximately(0.125f, 1e-6f);
        store.IsFixedRotation(id).Should().BeFalse();
    }

    [Fact]
    public void SetSleeping_Mirrors_SetAwake()
    {
        BodyStore store = StoreWithMass(out BodyId id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));

        store.SetSleeping(id, true);
        store.IsSleeping(id).Should().BeTrue();
        store.IsAwake(id).Should().BeFalse();

        store.SetSleeping(id, false);
        store.IsAwake(id).Should().BeTrue();
        store.IsSleeping(id).Should().BeFalse();
    }

    [Fact]
    public void SetBullet_TogglesHint()
    {
        BodyStore store = StoreWithMass(out BodyId id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));

        store.SetBullet(id, true);
        store.IsBullet(id).Should().BeTrue();

        store.SetBullet(id, false);
        store.IsBullet(id).Should().BeFalse();
    }

    [Fact]
    public void DisabledBody_StaysPut_UntilReEnabled()
    {
        var store = new BodyStore();
        BodyId id = store.Create(new BodyDef());
        store.SetMassData(id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        store.SetLinearVelocity(id, new Vec3(7.0f, 0.0f, 0.0f));

        store.SetEnabled(id, false);
        store.IsEnabled(id).Should().BeFalse();
        store.GetLinearVelocity(id).Should().Be(Vec3.Zero);
        store.IsSleeping(id).Should().BeTrue();

        store.SetAwake(id, true);
        store.Integrate(1.0f, new Vec3(0.0f, -9.81f, 0.0f));
        store.GetTransform(id).Position.Should().Be(Vec3.Zero);

        store.SetEnabled(id, true);
        store.SetAwake(id, true);
        store.Integrate(1.0f, new Vec3(0.0f, -9.81f, 0.0f));
        store.GetTransform(id).Position.Y.Should().BeApproximately(-9.81f, 1e-4f);
    }

    [Fact]
    public void ResetMassData_Restores_ShapeDerivedProperties()
    {
        using var tree = new Axrone.Geometry.DynamicAabbTree<ShapeId, Axrone.Geometry.SurfaceAreaHeuristicStrategy, Axrone.Geometry.NullSpatialMetricsSink>();
        var bodies = new BodyStore();
        var shapes = new ShapeStore();
        BodyId id = bodies.Create(new BodyDef());
        shapes.AttachSphere(bodies, tree, id, new Vec3(2.0f, 0.0f, 0.0f), 1.0f);

        MassData3D fromShapes = bodies.GetMassData(id);
        fromShapes.Mass.Should().BeGreaterThan(0.0f);

        bodies.SetMassData(id, 999.0f, new Vec3(999.0f, 999.0f, 999.0f));
        bodies.GetMassData(id).Mass.Should().Be(999.0f);

        shapes.RecalculateMass(bodies, id);

        MassData3D restored = bodies.GetMassData(id);
        restored.Mass.Should().BeApproximately(fromShapes.Mass, 1e-5f);
        AssertClose(restored.Centroid, fromShapes.Centroid);
    }

    [Fact]
    public void WorldResetMassData_PreservesWorldCenterOfMass()
    {
        using var world = new World();
        BodyId id = world.Bodies.Create(new BodyDef());
        world.Shapes.AttachSphere(world.Bodies, world.Broadphase, id, new Vec3(2.0f, 0.0f, 0.0f), 1.0f);

        Vec3 centerBefore = world.Bodies.GetMassData(id).Centroid
            + world.Bodies.GetTransform(id).Position;

        world.Bodies.SetMassData(id, 42.0f, new Vec3(42.0f, 42.0f, 42.0f));
        world.ResetMassData(id);

        Vec3 centerAfter = world.Bodies.GetMassData(id).Centroid
            + world.Bodies.GetTransform(id).Position;

        centerAfter.X.Should().BeApproximately(centerBefore.X, 1e-5f);
        centerAfter.Y.Should().BeApproximately(centerBefore.Y, 1e-5f);
        centerAfter.Z.Should().BeApproximately(centerBefore.Z, 1e-5f);
        world.Bodies.GetMassData(id).Mass.Should().BeLessThan(42.0f);
    }
}
