namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneTrailTests
{
    private static SceneTrailRenderer Trail(uint id, float lifetime = 2.0f, SceneTrailFade fade = SceneTrailFade.Linear)
    {
        SceneTrailRenderer trail = SceneTrailRenderer.Default;
        trail.TrailId = id;
        trail.LifetimeSeconds = lifetime;
        trail.Fade = fade;
        trail.Width = 0.1f;
        return trail;
    }

    [Fact]
    public void RingOverwritesOldestPoints()
    {
        var registry = new SceneTrailRegistry();
        registry.Register(1, capacity: 3);

        for (int i = 0; i < 4; i++)
        {
            registry.Push(1, new Vec3(i, 0, 0), i);
        }

        registry.TryGetPointCount(1, out int count).Should().BeTrue();
        count.Should().Be(3);
        registry.TryCopyPoints(1, new SceneTrailPoint[3], out int copied).Should().BeTrue();
        copied.Should().Be(3);

        Span<SceneTrailPoint> points = stackalloc SceneTrailPoint[3];
        registry.TryCopyPoints(1, points, out _);
        points[0].Position.X.Should().Be(1.0f);
        points[1].Position.X.Should().Be(2.0f);
        points[2].Position.X.Should().Be(3.0f);

        registry.Count.Should().Be(1);
        registry.Clear();
        registry.TryGetPointCount(1, out count).Should().BeTrue();
        count.Should().Be(0);
    }

    [Fact]
    public void RegistryRejectsRegressionAndInvalidConfiguration()
    {
        var registry = new SceneTrailRegistry();

        Action zeroId = () => registry.Register(0);
        Action tiny = () => registry.Register(1, capacity: 1);
        zeroId.Should().Throw<SceneConfigurationException>();
        tiny.Should().Throw<SceneConfigurationException>();

        registry.Register(1, capacity: 4);
        registry.Push(1, Vec3.Zero, 2.0f).Should().BeTrue();
        registry.Push(1, Vec3.UnitX, 1.0f).Should().BeFalse();
        registry.Push(99, Vec3.Zero, 0.0f).Should().BeFalse();
    }

    [Fact]
    public void CollectorEmitsFadingSegments()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Trail);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var registry = new SceneTrailRegistry();
        registry.Register(1, capacity: 8);
        registry.Push(1, new Vec3(0, 0, 0), 0.0f);
        registry.Push(1, new Vec3(1, 0, 0), 1.0f);
        registry.Push(1, new Vec3(2, 0, 0), 2.0f);

        SceneActor actor = world.CreateActor("Trail");
        world.AddData(actor, Trail(1, lifetime: 2.0f));
        world.UpdateTransforms();

        var collector = new SceneTrailItemCollector();
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main, registry, time: 2.0f);

        count.Should().Be(2);
        collector.Items[0].StartAlpha.Should().BeApproximately(0.0f, 1e-5f);
        collector.Items[0].EndAlpha.Should().BeApproximately(0.5f, 1e-5f);
        collector.Items[1].EndAlpha.Should().BeApproximately(1.0f, 1e-5f);
    }

    [Fact]
    public void ConstantFadeKeepsFullAlpha()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Trail);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var registry = new SceneTrailRegistry();
        registry.Register(2, capacity: 4);
        registry.Push(2, new Vec3(0, 0, 0), 0.0f);
        registry.Push(2, new Vec3(1, 0, 0), 1.0f);

        SceneActor actor = world.CreateActor("Trail");
        world.AddData(actor, Trail(2, lifetime: 1.0f, fade: SceneTrailFade.Constant));
        world.UpdateTransforms();

        var collector = new SceneTrailItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry, time: 1.0f).Should().Be(1);
        collector.Items[0].StartAlpha.Should().Be(1.0f);
        collector.Items[0].EndAlpha.Should().Be(1.0f);
    }

    [Fact]
    public void ExpiredHistoryProducesNoSegments()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Trail);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var registry = new SceneTrailRegistry();
        registry.Register(3, capacity: 4);
        registry.Push(3, new Vec3(0, 0, 0), 0.0f);
        registry.Push(3, new Vec3(1, 0, 0), 0.5f);

        SceneActor actor = world.CreateActor("Trail");
        world.AddData(actor, Trail(3, lifetime: 1.0f));
        world.UpdateTransforms();

        var collector = new SceneTrailItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry, time: 5.0f).Should().Be(0);
    }

    [Fact]
    public void CollectorIsZeroAllocationAfterWarmup()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Trail);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 1280, 720)!;

        var registry = new SceneTrailRegistry();
        registry.Register(4, capacity: 32);
        for (int i = 0; i < 16; i++)
        {
            registry.Push(4, new Vec3(i * 0.1f, 0.0f, 0.0f), i * 0.05f);
        }

        SceneActor actor = world.CreateActor("Trail");
        world.AddData(actor, Trail(4, lifetime: 10.0f));
        world.UpdateTransforms();

        var collector = new SceneTrailItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry, time: 1.0f);
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry, time: 1.0f);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main, registry, time: 1.0f);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        count.Should().Be(15);
        delta.Should().Be(0);
    }

    [Fact]
    public void CodecRoundTripsTrailFields()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<RenderPassAssetTag> pass = assets.CreateId<RenderPassAssetTag>("pass/fx");
        var codec = new SceneTrailRendererCodec(assets.Names);

        var value = new SceneTrailRenderer
        {
            TrailId = 77,
            PassId = pass,
            Enabled = true,
            Visible = false,
            Width = 0.25f,
            LifetimeSeconds = 3.5f,
            Color = new Vec4(0.1f, 0.2f, 0.3f, 0.4f),
            Fade = SceneTrailFade.Constant,
            SortingLayer = 4,
            RenderOrder = 2,
            Depth = -1.0f
        };

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneTrailRenderer restored = codec.Read(payload);

        payload.GetProperty("trail").GetInt32().Should().Be(77);
        payload.GetProperty("fade").GetString().Should().Be("constant");
        restored.TrailId.Should().Be(77);
        restored.PassId.Should().Be(pass);
        restored.Visible.Should().BeFalse();
        restored.LifetimeSeconds.Should().BeApproximately(3.5f, 1e-6f);
        restored.Fade.Should().Be(SceneTrailFade.Constant);
    }

    [Fact]
    public void CodecRejectsUnknownFade()
    {
        var assets = new SceneAssetRegistry();
        var codec = new SceneTrailRendererCodec(assets.Names);
        JsonElement payload = JsonCapture.Capture(writer => writer.WriteString("fade", "sine"));

        Action read = () => codec.Read(payload);

        read.Should().Throw<SceneValidationException>()
            .Where(exception => exception.Code == SceneErrorCodes.ValidationInvalid);
    }
}
