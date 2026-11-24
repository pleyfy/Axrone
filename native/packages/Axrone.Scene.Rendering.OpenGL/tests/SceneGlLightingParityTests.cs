namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Lighting;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

/// <summary>
/// Locks the directional-light extraction the WebGL2 editor viewport relies on:
/// the per-light ambient must survive the collector-to-uniform hop, and a frame
/// without lighting must stay at zero energy rather than an implicit default.
/// </summary>
public sealed class SceneGlLightingParityTests
{
    [Fact]
    public void ExtractLighting_PreservesTheDirectionalAmbientColor()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity lightEntity = world.CreateEntity("Sun");
        world.AddData(lightEntity, new SceneDirectionalLight
        {
            Color = new Vec3(1.0f, 0.93f, 0.98f),
            Ambient = new Vec3(0.851f, 0.894f, 1.0f),
            Intensity = 1.4f,
            Primary = true,
            Enabled = true
        });
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(2);
        LightingSelectionState lighting = collector.Collect(
            world,
            Vec3.Zero,
            new Vec3(0.2f, 0.2f, 0.25f),
            new Vec3(0.4f, 0.45f, 0.55f),
            new Vec3(0.15f, 0.13f, 0.1f));

        SceneGlDrawExecutor.ExtractLighting(lighting, out SceneGlDrawExecutor.LightingValues values);

        values.DirectionalAmbient.Should().Be(new Vec3(0.851f, 0.894f, 1.0f));
        values.DirectionalColor.Should().Be(new Vec3(1.0f, 0.93f, 0.98f));
        values.DirectionalIntensity.Should().Be(1.4f);
        values.Ambient.Should().Be(new Vec3(0.2f, 0.2f, 0.25f));
    }

    [Fact]
    public void ExtractLighting_LeavesAmbientZeroWithoutADirectionalLight()
    {
        using SceneWorld world = CreateWorld();
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(2);
        LightingSelectionState lighting = collector.Collect(
            world,
            Vec3.Zero,
            new Vec3(0.2f, 0.2f, 0.25f),
            new Vec3(0.4f, 0.45f, 0.55f),
            new Vec3(0.15f, 0.13f, 0.1f));

        SceneGlDrawExecutor.ExtractLighting(lighting, out SceneGlDrawExecutor.LightingValues values);

        lighting.Stats.SelectedDirectionalCount.Should().Be(0);
        values.DirectionalAmbient.Should().Be(Vec3.Zero);
    }

    [Fact]
    public void ExtractLighting_ZeroesEveryTermForAnUnlitFrame()
    {
        SceneGlDrawExecutor.ExtractLighting(null, out SceneGlDrawExecutor.LightingValues values);

        values.DirectionalAmbient.Should().Be(Vec3.Zero);
        values.Ambient.Should().Be(Vec3.Zero);
        values.Sky.Should().Be(Vec3.Zero);
        values.Ground.Should().Be(Vec3.Zero);
        values.DirectionalIntensity.Should().Be(0.0f);
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-lighting-parity")))
            .AddTransform3D()
            .AddRendering3D()
            .AddLighting3D()
            .Build()
            .CreateWorld();
}
