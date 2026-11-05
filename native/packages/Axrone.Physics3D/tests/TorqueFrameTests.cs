using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

/// <summary>
/// Torque lives in world space; applying it must rotate the body-frame
/// inverse-inertia diagonal into the world frame, exactly like the impulse
/// path. Hand-computed tables pin the transform for anisotropic inertia under
/// non-identity rotations: omega' = dt * R * (D * (R^T * torque)).
/// </summary>
public class TorqueFrameTests
{
    private static BodyStore DynamicBody(out BodyId id, Quat rotation, Vec3 inertiaDiagonal)
    {
        var store = new BodyStore();
        id = store.Create(new BodyDef { GravityScale = 0.0f, Rotation = rotation });
        store.SetMassData(id, 1.0f, inertiaDiagonal);
        return store;
    }

    [Fact]
    public void WorldTorque_RollRotation_AnisotropicInertia_RotatesResponse()
    {
        Quat roll = Quat.CreateFromAxisAngle(new Vec3(1.0f, 0.0f, 0.0f), MathF.PI / 2.0f);
        BodyStore store = DynamicBody(out BodyId id, roll, new Vec3(5.0f, 1.0f, 0.2f));

        store.ApplyTorque(id, new Vec3(0.0f, 1.0f, 0.0f));
        store.IntegrateVelocities(1.0f, Vec3.Zero);

        // Axrone convention: applying X(+90) then its inverse on the vector channel maps
        // world Y into the softest principal axis, scaling it by D.Y = 1/0.2 = 5.
        Vec3 omega = store.GetAngularVelocity(id);
        omega.X.Should().BeApproximately(0.0f, 1e-5f);
        omega.Y.Should().BeApproximately(5.0f, 1e-4f);
        omega.Z.Should().BeApproximately(0.0f, 1e-5f);
    }

    [Fact]
    public void WorldTorque_PitchRotation_AnisotropicInertia_RotatesResponse()
    {
        Quat pitch = Quat.CreateFromAxisAngle(new Vec3(0.0f, 1.0f, 0.0f), MathF.PI / 2.0f);
        BodyStore store = DynamicBody(out BodyId id, pitch, new Vec3(5.0f, 1.0f, 0.2f));

        store.ApplyTorque(id, new Vec3(0.0f, 0.0f, 1.0f));
        store.IntegrateVelocities(1.0f, Vec3.Zero);

        Vec3 omega = store.GetAngularVelocity(id);
        omega.X.Should().BeApproximately(0.0f, 1e-5f);
        omega.Y.Should().BeApproximately(0.0f, 1e-5f);
        omega.Z.Should().BeApproximately(0.2f, 1e-5f);
    }

    [Fact]
    public void AngularImpulse_Shares_The_Torque_Transform()
    {
        Quat yaw = Quat.CreateFromAxisAngle(new Vec3(0.0f, 0.0f, 1.0f), MathF.PI / 2.0f);
        BodyStore store = DynamicBody(out BodyId id, yaw, new Vec3(4.0f, 2.0f, 1.0f));

        store.ApplyAngularImpulse(id, new Vec3(1.0f, 0.0f, 0.0f));

        Vec3 omega = store.GetAngularVelocity(id);
        omega.X.Should().BeApproximately(0.5f, 1e-5f);
        omega.Y.Should().BeApproximately(0.0f, 1e-5f);
        omega.Z.Should().BeApproximately(0.0f, 1e-5f);
    }

    [Fact]
    public void IdentityRotation_IsotropicInertia_Keeps_LegacyComponentwise_Result()
    {
        BodyStore store = DynamicBody(out BodyId id, Quat.Identity, new Vec3(2.0f, 2.0f, 2.0f));

        store.ApplyTorque(id, new Vec3(1.0f, 2.0f, 3.0f));
        store.IntegrateVelocities(0.5f, Vec3.Zero);

        Vec3 omega = store.GetAngularVelocity(id);
        omega.X.Should().BeApproximately(0.25f, 1e-6f);
        omega.Y.Should().BeApproximately(0.5f, 1e-6f);
        omega.Z.Should().BeApproximately(0.75f, 1e-6f);
    }

    [Fact]
    public void OffCenterForce_AccumulatesWorldTorque_ThroughTheSameTransform()
    {
        Quat roll = Quat.CreateFromAxisAngle(new Vec3(1.0f, 0.0f, 0.0f), MathF.PI / 2.0f);
        BodyStore store = DynamicBody(out BodyId id, roll, new Vec3(5.0f, 1.0f, 0.2f));

        // r = point - center = (1,0,0); F = (0,0,10) -> torque = r x F = (0,-10,0).
        store.ApplyForce(id, new Vec3(0.0f, 0.0f, 10.0f), new Vec3(1.0f, 0.0f, 0.0f));
        store.IntegrateVelocities(1.0f, Vec3.Zero);

        Vec3 omega = store.GetAngularVelocity(id);
        omega.X.Should().BeApproximately(0.0f, 1e-5f);
        omega.Y.Should().BeApproximately(-50.0f, 1e-3f);
        omega.Z.Should().BeApproximately(0.0f, 1e-5f);
    }
}
