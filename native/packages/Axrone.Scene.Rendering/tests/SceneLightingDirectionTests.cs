namespace Axrone.Scene.Rendering.Tests;

using Axrone.Geometry;
using Axrone.Lighting;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

/// <summary>
/// Lights emit along local +Z, matching WebGL2's Vec3.FORWARD in
/// scene-runtime/src/lighting-collector.ts. Cameras look along -Z, so the two
/// conventions must not be unified.
/// </summary>
public sealed class SceneLightingDirectionTests
{
    private const float SamplePitchX = 48.0f;
    private const float SampleYawY = -32.0f;

    [Fact]
    public void DirectionalLightEmitsAlongLocalPositiveZ()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneActor sun = world.CreateActor("Sun");
        world.GetTransform3D(sun).SetRotation(Euler(SamplePitchX, SampleYawY, 0.0f));
        world.AddData(sun, new SceneDirectionalLight
        {
            Color = Vec3.One,
            Ambient = new Vec3(0.851f, 0.894f, 1.0f),
            Intensity = 1.4f,
            Primary = true,
            Enabled = true
        });
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(2);
        LightingSelectionState selection = collector.Collect(
            world,
            Vec3.Zero,
            new Vec3(0.2f),
            new Vec3(0.4f),
            new Vec3(0.1f));

        selection.Stats.SelectedDirectionalCount.Should().Be(1);
        ReadOnlySpan<float> stored = selection.DirectionalDirections.Span;
        Vec3 ray = new(stored[0], stored[1], stored[2]);

        ray.Y.Should().BeLessThan(
            0.0f,
            "the sun ray must travel downward onto the ground, not upward from below it");
        ray.X.Should().BeApproximately(-0.3546f, 1e-3f);
        ray.Y.Should().BeApproximately(-0.7431f, 1e-3f);
        ray.Z.Should().BeApproximately(0.5675f, 1e-3f);
    }

    [Fact]
    public void SpotLightEmitsAlongLocalPositiveZ()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneActor lamp = world.CreateActor("Lamp");
        world.GetTransform3D(lamp).SetPosition(new Vec3(0.0f, 4.0f, 0.0f));
        world.GetTransform3D(lamp).SetRotation(Euler(SamplePitchX, SampleYawY, 0.0f));
        world.AddData(lamp, new SceneSpotLight
        {
            Color = Vec3.One,
            Intensity = 2.0f,
            Range = 64.0f,
            InnerConeAngleRadians = SceneSpotLight.Default.InnerConeAngleRadians,
            OuterConeAngleRadians = SceneSpotLight.Default.OuterConeAngleRadians,
            Attenuation = SceneSpotLight.Default.Attenuation,
            Enabled = true
        });
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(2);
        LightingSelectionState selection = collector.Collect(
            world,
            new Vec3(0.0f, 0.0f, 10.0f),
            new Vec3(0.2f),
            new Vec3(0.4f),
            new Vec3(0.1f));

        selection.Stats.SelectedSpotCount.Should().Be(1);
        ReadOnlySpan<float> stored = selection.SpotDirections.Span;
        Vec3 ray = new(stored[0], stored[1], stored[2]);

        ray.Y.Should().BeLessThan(0.0f, "a spot light must cone downward when tilted like the sun");
        ray.Y.Should().BeApproximately(-0.7431f, 1e-3f);
    }

    [Fact]
    public void UnrotatedLightShinesTowardsPositiveZ()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneActor sun = world.CreateActor("Sun");
        world.AddData(sun, new SceneDirectionalLight
        {
            Color = Vec3.One,
            Intensity = 1.0f,
            Primary = true,
            Enabled = true
        });
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(2);
        LightingSelectionState selection = collector.Collect(
            world,
            Vec3.Zero,
            new Vec3(0.2f),
            new Vec3(0.4f),
            new Vec3(0.1f));

        ReadOnlySpan<float> stored = selection.DirectionalDirections.Span;
        new Vec3(stored[0], stored[1], stored[2]).Should().Be(new Vec3(0.0f, 0.0f, 1.0f));
    }

    private static Quat Euler(float xDegrees, float yDegrees, float zDegrees) =>
        Quat.CreateFromEuler(
            AngleRadians.FromDegrees(xDegrees),
            AngleRadians.FromDegrees(yDegrees),
            AngleRadians.FromDegrees(zDegrees),
            RotationOrder.Zyx);
}
