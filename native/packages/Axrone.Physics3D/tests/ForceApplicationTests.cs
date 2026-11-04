using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public class ForceApplicationTests
{
    private static BodyStore DynamicStore(out BodyId id, float mass = 1.0f, Vec3 inertia = default)
    {
        if (inertia.Equals(default))
        {
            inertia = new Vec3(1.0f, 1.0f, 1.0f);
        }

        var store = new BodyStore();
        id = store.Create(new BodyDef { GravityScale = 0.0f });
        store.SetMassData(id, mass, inertia);
        return store;
    }

    [Fact]
    public void ApplyForce_AtPoint_AccumulatesLinearAndAngular()
    {
        BodyStore store = DynamicStore(out BodyId id);

        store.ApplyForce(id, new Vec3(0.0f, 0.0f, 10.0f), new Vec3(1.0f, 0.0f, 0.0f));
        store.Integrate(1.0f, Vec3.Zero);

        store.GetLinearVelocity(id).Should().Be(new Vec3(0.0f, 0.0f, 10.0f));
        store.GetAngularVelocity(id).Should().Be(new Vec3(0.0f, -10.0f, 0.0f));
    }

    [Fact]
    public void ApplyForce_AtCenter_ProducesNoTorque()
    {
        BodyStore store = DynamicStore(out BodyId id);

        store.ApplyForce(id, new Vec3(0.0f, 5.0f, 0.0f), Vec3.Zero);
        store.Integrate(1.0f, Vec3.Zero);

        store.GetLinearVelocity(id).Should().Be(new Vec3(0.0f, 5.0f, 0.0f));
        store.GetAngularVelocity(id).Should().Be(Vec3.Zero);
    }

    [Fact]
    public void ApplyForceToCenter_Matches_PointlessOverload()
    {
        BodyStore storeA = DynamicStore(out BodyId idA);
        BodyStore storeB = DynamicStore(out BodyId idB);

        storeA.ApplyForce(idA, new Vec3(2.0f, 3.0f, -4.0f));
        storeB.ApplyForceToCenter(idB, new Vec3(2.0f, 3.0f, -4.0f));

        storeA.Integrate(1.0f / 60.0f, Vec3.Zero);
        storeB.Integrate(1.0f / 60.0f, Vec3.Zero);

        storeA.GetLinearVelocity(idA).Should().Be(storeB.GetLinearVelocity(idB));
        storeA.GetAngularVelocity(idA).Should().Be(storeB.GetAngularVelocity(idB));
    }

    [Fact]
    public void ApplyLinearImpulse_AtPoint_AddsSpinThroughWorldInverseInertia()
    {
        BodyStore store = DynamicStore(out BodyId id, mass: 2.0f);

        store.ApplyLinearImpulse(id, new Vec3(0.0f, 10.0f, 0.0f), new Vec3(1.0f, 0.0f, 0.0f));

        store.GetLinearVelocity(id).Should().Be(new Vec3(0.0f, 5.0f, 0.0f));
        store.GetAngularVelocity(id).Should().Be(new Vec3(0.0f, 0.0f, 10.0f));
    }

    [Fact]
    public void ApplyLinearImpulse_AtCenter_KeepsLegacyBehavior()
    {
        BodyStore store = DynamicStore(out BodyId id, mass: 2.0f);

        store.ApplyLinearImpulse(id, new Vec3(4.0f, 0.0f, 0.0f));
        store.ApplyLinearImpulse(id, new Vec3(4.0f, 0.0f, 0.0f), store.GetTransform(id).Position);

        store.GetLinearVelocity(id).Should().Be(new Vec3(4.0f, 0.0f, 0.0f));
        store.GetAngularVelocity(id).Should().Be(Vec3.Zero);
    }

    [Fact]
    public void PointLoads_Wake_SleepingBodies()
    {
        var store = new BodyStore();
        BodyId id = store.Create(new BodyDef { Awake = false });
        store.SetMassData(id, 1.0f, new Vec3(1.0f, 1.0f, 1.0f));
        store.SetAwake(id, false);

        store.ApplyForce(id, new Vec3(1.0f, 0.0f, 0.0f), new Vec3(0.0f, 1.0f, 0.0f));
        store.IsAwake(id).Should().BeTrue();
    }

    [Fact]
    public void StaticAndKinematicBodies_Ignore_PointedLoads()
    {
        var store = new BodyStore();
        BodyId staticBody = store.Create(new BodyDef { Type = BodyType.Static });
        BodyId kinematicBody = store.Create(new BodyDef { Type = BodyType.Kinematic });

        store.ApplyForce(staticBody, new Vec3(1.0f, 0.0f, 0.0f), new Vec3(1.0f, 1.0f, 1.0f));
        store.ApplyLinearImpulse(kinematicBody, new Vec3(1.0f, 0.0f, 0.0f), new Vec3(1.0f, 1.0f, 1.0f));

        store.GetLinearVelocity(staticBody).Should().Be(Vec3.Zero);
        store.GetAngularVelocity(staticBody).Should().Be(Vec3.Zero);
        store.GetLinearVelocity(kinematicBody).Should().Be(Vec3.Zero);
        store.GetAngularVelocity(kinematicBody).Should().Be(Vec3.Zero);
    }

    [Fact]
    public void ApplyForce_AtPoint_UsesOffsetCenterOfMass()
    {
        using var tree = new Axrone.Geometry.DynamicAabbTree<ShapeId, Axrone.Geometry.SurfaceAreaHeuristicStrategy, Axrone.Geometry.NullSpatialMetricsSink>();
        var store = new BodyStore();
        var shapes = new ShapeStore();
        BodyId id = store.Create(new BodyDef { GravityScale = 0.0f });
        shapes.AttachSphere(store, tree, id, new Vec3(2.0f, 0.0f, 0.0f), 1.0f);

        ref BodyState state = ref store.Slot(id);
        Vec3 worldCenter = state.Position + (state.Rotation * state.LocalCenter);
        float invInertiaY = state.InverseInertia.Y;

        // Lever arm runs from the world center of mass, not the body origin:
        // r = (5,0,0) - worldCenter, torque = r x F with F = (0,0,6).
        store.ApplyForce(id, new Vec3(0.0f, 0.0f, 6.0f), new Vec3(5.0f, 0.0f, 0.0f));
        store.Integrate(1.0f, Vec3.Zero);

        float lever = 5.0f - worldCenter.X;
        store.GetAngularVelocity(id).Y.Should().BeApproximately(-6.0f * lever * invInertiaY, 1e-5f);
    }
}
