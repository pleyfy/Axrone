namespace Axrone.Scene.Rendering.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using FluentAssertions;
using Xunit;

public sealed class SceneCamera2DDefaultsTests
{
    [Fact]
    public void DefaultsMatchTheTwoDReferenceChain()
    {
        SceneCamera2DDefaults.PixelsPerUnit.Should().Be(100.0f);
        SceneCamera2DDefaults.Zoom.Should().Be(1.0f);
        SceneCamera2DDefaults.Near.Should().Be(0.1f);
        SceneCamera2DDefaults.Far.Should().Be(1000.0f);
        SceneCamera2DDefaults.Depth.Should().Be(10.0f);
        SceneCamera2DDefaults.ReferenceViewportHeight.Should().Be(720);
    }

    [Fact]
    public void OrthographicSizeScalesWithViewportAndZoom()
    {
        SceneCamera2DDefaults.OrthographicSizeFor(720).Should().BeApproximately(3.6f, 0.0001f);
        SceneCamera2DDefaults.OrthographicSizeFor(720, zoom: 2.0f).Should().BeApproximately(1.8f, 0.0001f);
        SceneCamera2DDefaults.OrthographicSizeFor(1080, pixelsPerUnit: 50.0f).Should().BeApproximately(10.8f, 0.0001f);
    }

    [Fact]
    public void InvalidInputsAreRejected()
    {
        FluentActions.Invoking(static () => SceneCamera2DDefaults.OrthographicSizeFor(0)).Should().Throw<SceneValidationException>();
        FluentActions.Invoking(static () => SceneCamera2DDefaults.OrthographicSizeFor(720, zoom: 0.0f)).Should().Throw<SceneValidationException>();
        FluentActions.Invoking(static () => SceneCamera2DDefaults.OrthographicSizeFor(720, pixelsPerUnit: -1.0f)).Should().Throw<SceneValidationException>();
        FluentActions.Invoking(static () => SceneCamera2DDefaults.CreateProjection(0.0f, 1.0f)).Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void CreateCameraProducesTheOrthographicChain()
    {
        SceneCamera camera = SceneCamera2DDefaults.CreateCamera(720, zoom: 2.0f);

        camera.Orthographic.Should().BeTrue();
        camera.Primary.Should().BeTrue();
        camera.OrthographicSize.Should().BeApproximately(1.8f, 0.0001f);
        camera.Near.Should().Be(SceneCamera2DDefaults.Near);
        camera.Far.Should().Be(SceneCamera2DDefaults.Far);
        SceneCamera2DDefaults.CreateCamera2D().Depth.Should().Be(SceneCamera2DDefaults.Depth);
    }

    [Fact]
    public void ProjectionScalesMatchTheOrthographicExtents()
    {
        const float halfHeight = 3.6f;
        const float aspect = 16.0f / 9.0f;

        Mat4 projection = SceneCamera2DDefaults.CreateProjection(halfHeight, aspect);

        projection.M11.Should().BeApproximately(1.0f / (halfHeight * aspect), 0.0001f);
        projection.M22.Should().BeApproximately(1.0f / halfHeight, 0.0001f);
    }

    [Fact]
    public void FrameCollectorUsesTheSharedProjectionFormula()
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/camera2d-defaults")));
        SceneWorld world = builder.AddTransform2D().AddRendering2D().Build().CreateWorld();

        SceneActor cameraActor = world.CreateActor("Camera2D");
        SceneCamera camera = SceneCamera2DDefaults.CreateCamera(720);
        world.AddData(cameraActor, camera);
        world.AddData(cameraActor, SceneCamera2DDefaults.CreateCamera2D());
        world.UpdateTransforms();

        SceneCameraFrame frame = new SceneCamera2DFrameCollector().Collect(world, cameraActor, 1280, 720)!;
        Mat4 expected = SceneCamera2DDefaults.CreateProjection(
            camera.OrthographicSize,
            1280.0f / 720.0f,
            camera.Near,
            camera.Far);

        frame.ProjectionMatrix.M11.Should().BeApproximately(expected.M11, 0.0001f);
        frame.ProjectionMatrix.M22.Should().BeApproximately(expected.M22, 0.0001f);
        frame.ProjectionMatrix.M33.Should().BeApproximately(expected.M33, 0.0001f);
        frame.ProjectionMatrix.M34.Should().BeApproximately(expected.M34, 0.0001f);
    }
}
