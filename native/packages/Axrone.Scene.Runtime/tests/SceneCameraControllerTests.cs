namespace Axrone.Scene.Runtime.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneCameraControllerTests
{
    private const float Epsilon = 1e-4f;

    [Fact]
    public void Orbit_PlacesCameraOnSphereAndAimsAtTarget()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity camera = world.CreateEntity("Camera");
        var orbit = world.AddBehaviour<SceneOrbitCameraControllerBehaviour>(camera);
        orbit.Target = new Vec3(0.0f, 1.0f, 0.0f);
        orbit.Distance = 6.0f;
        orbit.Azimuth = 0.0f;
        orbit.Elevation = 0.35f;

        world.Start();
        world.Update(0.016f);

        SceneTransform3D transform = world.GetTransform3D(camera);
        transform.Position.X.Should().BeApproximately(0.0f, Epsilon);
        transform.Position.Y.Should().BeApproximately(1.0f + (MathF.Sin(0.35f) * 6.0f), Epsilon);
        transform.Position.Z.Should().BeApproximately(MathF.Cos(0.35f) * 6.0f, Epsilon);

        Vec3 backward = Vec3.Normalize(transform.Position - orbit.Target);
        Vec3 look = Quat.Normalize(transform.Rotation) * Vec3.UnitZ;
        Vec3.Dot(look, backward).Should().BeApproximately(1.0f, 1e-3f);
    }

    [Fact]
    public void Orbit_ClampsDistanceAndElevation()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity camera = world.CreateEntity("Camera");
        var orbit = world.AddBehaviour<SceneOrbitCameraControllerBehaviour>(camera);

        orbit.MinDistance = 2.0f;
        orbit.MaxDistance = 10.0f;
        orbit.Distance = 100.0f;
        orbit.Distance.Should().Be(10.0f);

        orbit.Zoom(-100.0f);
        orbit.Distance.Should().Be(2.0f);

        orbit.Elevation = 10.0f;
        orbit.Elevation.Should().BeApproximately(MathF.PI * 0.49f, Epsilon);
    }

    [Fact]
    public void Orbit_AutoRotateAdvancesAzimuth()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity camera = world.CreateEntity("Camera");
        var orbit = world.AddBehaviour<SceneOrbitCameraControllerBehaviour>(camera);
        orbit.AutoRotateSpeed = 0.5f;

        world.Start();
        world.Update(0.2f);

        orbit.Azimuth.Should().BeApproximately(0.1f, Epsilon);
    }

    [Fact]
    public void Follow_SnapsToTargetWithOffset()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity target = world.CreateEntity("Player");
        world.GetTransform3D(target).SetPosition(new Vec3(10.0f, 0.0f, 0.0f));

        SceneEntity camera = world.CreateEntity("Camera");
        var follow = world.AddBehaviour<SceneFollowCameraControllerBehaviour>(camera);
        follow.Distance = 7.0f;
        follow.Azimuth = 0.0f;
        follow.Elevation = 0.45f;
        follow.PositionDamping = 0.0f;
        follow.TargetDamping = 0.0f;
        follow.SetTarget(target);
        world.UpdateTransforms();

        world.Start();
        world.LateUpdate(0.016f);

        SceneTransform3D transform = world.GetTransform3D(camera);
        transform.Position.X.Should().BeApproximately(10.0f, Epsilon);
        transform.Position.Y.Should().BeApproximately(1.5f + (MathF.Sin(0.45f) * 7.0f), Epsilon);
        transform.Position.Z.Should().BeApproximately(MathF.Cos(0.45f) * 7.0f, Epsilon);
    }

    [Fact]
    public void Follow_DampingMovesCameraTowardTarget()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity target = world.CreateEntity("Player");

        SceneEntity camera = world.CreateEntity("Camera");
        var follow = world.AddBehaviour<SceneFollowCameraControllerBehaviour>(camera);
        follow.PositionDamping = 5.0f;
        follow.TargetDamping = 5.0f;
        follow.SetTarget(target);
        world.Start();
        world.LateUpdate(0.016f);

        world.GetTransform3D(target).SetPosition(new Vec3(20.0f, 0.0f, 0.0f));
        world.UpdateTransforms();
        world.LateUpdate(0.1f);

        float x = world.GetTransform3D(camera).Position.X;
        x.Should().BeGreaterThan(0.0f);
        x.Should().BeLessThan(20.0f);
    }

    private static SceneWorld CreateWorld()
    {
        var profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/camera-controllers")))
            .AddTransform3D()
            .AddCameraControllers()
            .Build();

        return profile.CreateWorld();
    }
}
