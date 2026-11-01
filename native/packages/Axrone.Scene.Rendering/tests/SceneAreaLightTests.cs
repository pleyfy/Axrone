namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Lighting;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneAreaLightTests
{
    private static SceneAreaLight AreaLight() => new()
    {
        Shape = SceneAreaLightShape.Disk,
        Size = new Vec2(2.0f, 1.0f),
        Color = new Vec3(0.8f, 0.4f, 0.2f),
        Intensity = 3.0f,
        Range = 7.0f,
        Attenuation = 1.5f,
        TwoSided = false,
        Enabled = true
    };

    [Fact]
    public void CollectorExposesAreaLightAndFeedsPointApproximation()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.AreaLight);
        SceneActor actor = world.CreateActor("AreaLight");
        world.GetTransform3D(actor).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));
        world.AddData(actor, AreaLight());
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(4);
        _ = collector.Collect(world, Vec3.Zero, Vec3.Zero, Vec3.Zero, Vec3.Zero);

        collector.AreaLightCount.Should().Be(1);
        SceneAreaLightRenderItem item = collector.AreaLights[0];
        item.Actor.Should().Be(actor);
        item.Shape.Should().Be(SceneAreaLightShape.Disk);
        item.Size.Should().Be(new Vec2(2.0f, 1.0f));
        item.Position.Should().Be(new Vec3(1.0f, 2.0f, 3.0f));
        item.Intensity.Should().Be(3.0f);
        item.Range.Should().Be(7.0f);
        item.TwoSided.Should().BeFalse();

        collector.Rig.Count.Should().Be(1);
        foreach (LightData light in collector.Rig)
        {
            light.Type.Should().Be(LightType.Point);
            light.Position.Should().Be(new Vec3(1.0f, 2.0f, 3.0f));
            light.Range.Value.Should().Be(7.0f);
        }
    }

    [Fact]
    public void DisabledAreaLightIsSkipped()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.AreaLight);
        SceneAreaLight light = AreaLight();
        light.Enabled = false;
        SceneActor actor = world.CreateActor("AreaLight");
        world.AddData(actor, light);
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(4);
        _ = collector.Collect(world, Vec3.Zero, Vec3.Zero, Vec3.Zero, Vec3.Zero);

        collector.AreaLightCount.Should().Be(0);
        collector.Rig.Count.Should().Be(0);
    }

    [Fact]
    public void AreaLightsFollowActorOrder()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.AreaLight);
        SceneActor first = world.CreateActor("First");
        world.GetTransform3D(first).SetPosition(new Vec3(1.0f, 0.0f, 0.0f));
        world.AddData(first, AreaLight());

        SceneActor second = world.CreateActor("Second");
        world.GetTransform3D(second).SetPosition(new Vec3(2.0f, 0.0f, 0.0f));
        world.AddData(second, AreaLight());
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(4);
        _ = collector.Collect(world, Vec3.Zero, Vec3.Zero, Vec3.Zero, Vec3.Zero);

        collector.AreaLightCount.Should().Be(2);
        collector.AreaLights[0].Actor.Should().Be(first);
        collector.AreaLights[1].Actor.Should().Be(second);
    }

    [Fact]
    public void AreaLightsAreZeroAllocationAfterWarmup()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.AreaLight);
        SceneActor actor = world.CreateActor("AreaLight");
        world.AddData(actor, AreaLight());
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(4);
        _ = collector.Collect(world, Vec3.Zero, Vec3.Zero, Vec3.Zero, Vec3.Zero);
        _ = collector.Collect(world, Vec3.Zero, Vec3.Zero, Vec3.Zero, Vec3.Zero);

        long before = GC.GetAllocatedBytesForCurrentThread();
        _ = collector.Collect(world, Vec3.Zero, Vec3.Zero, Vec3.Zero, Vec3.Zero);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        delta.Should().Be(0);
        collector.AreaLightCount.Should().Be(1);
    }

    [Fact]
    public void CodecRoundTripsAreaLightFields()
    {
        var codec = new SceneAreaLightCodec();
        SceneAreaLight value = AreaLight();

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneAreaLight restored = codec.Read(payload);

        payload.GetProperty("shape").GetString().Should().Be("disk");
        restored.Shape.Should().Be(SceneAreaLightShape.Disk);
        restored.Size.Should().Be(new Vec2(2.0f, 1.0f));
        restored.Color.Should().Be(new Vec3(0.8f, 0.4f, 0.2f));
        restored.Intensity.Should().BeApproximately(3.0f, 1e-6f);
        restored.Range.Should().BeApproximately(7.0f, 1e-6f);
        restored.Attenuation.Should().BeApproximately(1.5f, 1e-6f);
        restored.TwoSided.Should().BeFalse();
    }

    [Fact]
    public void CodecRejectsUnknownShape()
    {
        var codec = new SceneAreaLightCodec();
        JsonElement payload = JsonCapture.Capture(writer => writer.WriteString("shape", "tube"));

        Action read = () => codec.Read(payload);

        read.Should().Throw<SceneValidationException>()
            .Where(exception => exception.Code == SceneErrorCodes.ValidationInvalid);
    }
}
