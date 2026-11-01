namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneLodTests
{
    private static SceneLodGroup Group(SceneLodMetric metric, float hysteresis, params float[] thresholds)
    {
        SceneLodGroup group = SceneLodGroup.Default;
        group.Metric = metric;
        group.Hysteresis = hysteresis;
        group.LevelCount = 0;

        for (int i = 0; i < thresholds.Length; i++)
        {
            var level = new SceneLodLevel(
                SceneAssetId<MeshAssetTag>.FromName($"mesh/lod{i}"),
                SceneAssetId<MaterialAssetTag>.FromName("material/lod"),
                thresholds[i]);
            group.SetLevel(i, in level);
        }

        return group;
    }

    private static (SceneWorld World, SceneCameraFrame Frame) CreateScene(Vec3 cameraPosition)
    {
        SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.LodGroup);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, cameraPosition, primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        return (world, frame);
    }

    [Fact]
    public void DistanceMetricSelectsFirstThreshold()
    {
        (SceneWorld world, SceneCameraFrame frame) = CreateScene(Vec3.Zero);
        using SceneWorld scope = world;
        SceneLodGroup group = Group(SceneLodMetric.Distance, 0.0f, 5.0f, 15.0f, 25.0f);

        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 1), -1).Should().Be(0);
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 10), -1).Should().Be(1);
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 20), -1).Should().Be(2);
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 40), -1).Should().Be(2);
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 5), -1).Should().Be(0);
    }

    [Fact]
    public void HysteresisPreventsFlapping()
    {
        (SceneWorld world, SceneCameraFrame frame) = CreateScene(Vec3.Zero);
        using SceneWorld scope = world;
        SceneLodGroup group = Group(SceneLodMetric.Distance, 0.1f, 10.0f, 20.0f, 30.0f);

        // 10.5 exceeds the threshold but not the 10% margin: stay at level 0.
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 10.5f), 0).Should().Be(0);
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 12.0f), 0).Should().Be(1);

        // Moving back requires falling below 9.0.
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 9.5f), 1).Should().Be(1);
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 8.0f), 1).Should().Be(0);
    }

    [Fact]
    public void ScreenRadiusMetricSelectsByProjectedPixels()
    {
        (SceneWorld world, SceneCameraFrame frame) = CreateScene(new Vec3(0, 0, 10));
        using SceneWorld scope = world;
        SceneLodGroup group = Group(SceneLodMetric.ScreenRadius, 0.0f, 100.0f, 30.0f, 5.0f);
        group.Radius = 1.0f;

        SceneLodEvaluator.Select(group, frame, Vec3.Zero, -1).Should().Be(1);
        SceneLodEvaluator.Select(group, frame, new Vec3(0, 0, 0), -1).Should().Be(1);

        group.Radius = 0.5f;
        SceneLodEvaluator.Select(group, frame, Vec3.Zero, -1).Should().Be(2);

        group.Radius = 4.0f;
        SceneLodEvaluator.Select(group, frame, Vec3.Zero, -1).Should().Be(0);
    }

    [Fact]
    public void CollectorUsesSelectedLevelAndBuildsMeshItems()
    {
        (SceneWorld world, SceneCameraFrame frame) = CreateScene(new Vec3(0, 0, 10));
        using SceneWorld scope = world;
        SceneLodGroup group = Group(SceneLodMetric.Distance, 0.0f, 5.0f, 50.0f);
        group.RenderOrder = 3;
        SceneActor actor = world.CreateActor("Lod");
        world.AddData(actor, group);
        world.UpdateTransforms();

        var evaluator = new SceneLodEvaluator();
        var collector = new SceneLodItemCollector();

        collector.Collect(world, frame, SceneRenderPassIds.Main, evaluator).Should().Be(1);
        SceneLodRenderItem item = collector.Items[0];
        item.Level.Should().Be(1);
        item.MeshId.Should().Be(SceneAssetId<MeshAssetTag>.FromName("mesh/lod1"));
        item.RenderOrder.Should().Be(3);

        collector.MeshItems.Length.Should().Be(1);
        collector.MeshItems[0].MeshId.Should().Be(item.MeshId);
        collector.MeshItems[0].RenderOrder.Should().Be(3);
        evaluator.GetLevel(actor).Should().Be(1);

        evaluator.Reset();
        evaluator.GetLevel(actor).Should().Be(-1);
    }

    [Fact]
    public void CollectorCullsBehindCamera()
    {
        (SceneWorld world, SceneCameraFrame frame) = CreateScene(new Vec3(0, 0, 10));
        using SceneWorld scope = world;
        SceneLodGroup group = Group(SceneLodMetric.Distance, 0.0f, 100.0f);
        SceneActor actor = world.CreateActor("Behind");
        world.GetTransform3D(actor).SetPosition(new Vec3(0, 0, 20));
        world.AddData(actor, group);
        world.UpdateTransforms();

        var collector = new SceneLodItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, new SceneLodEvaluator());

        collector.Count.Should().Be(0);
        collector.CulledCount.Should().Be(1);
    }

    [Fact]
    public void InvalidGroupIsSkipped()
    {
        (SceneWorld world, SceneCameraFrame frame) = CreateScene(new Vec3(0, 0, 10));
        using SceneWorld scope = world;
        SceneLodGroup invalid = SceneLodGroup.Default;
        SceneActor actor = world.CreateActor("Invalid");
        world.AddData(actor, invalid);
        world.UpdateTransforms();

        var collector = new SceneLodItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, new SceneLodEvaluator()).Should().Be(0);
    }

    [Fact]
    public void CollectorAndEvaluatorAreZeroAllocationAfterWarmup()
    {
        (SceneWorld world, SceneCameraFrame frame) = CreateScene(new Vec3(0, 0, 10));
        using SceneWorld scope = world;
        SceneLodGroup group = Group(SceneLodMetric.Distance, 0.1f, 5.0f, 15.0f, 50.0f);

        for (int i = 0; i < 8; i++)
        {
            SceneActor actor = world.CreateActor($"Lod{i}");
            world.GetTransform3D(actor).SetPosition(new Vec3(i, 0, 0));
            world.AddData(actor, group);
        }

        world.UpdateTransforms();

        var evaluator = new SceneLodEvaluator();
        var collector = new SceneLodItemCollector();
        evaluator.Evaluate(world, frame);
        collector.Collect(world, frame, SceneRenderPassIds.Main, evaluator);
        evaluator.Evaluate(world, frame);
        collector.Collect(world, frame, SceneRenderPassIds.Main, evaluator);

        long before = GC.GetAllocatedBytesForCurrentThread();
        evaluator.Evaluate(world, frame);
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main, evaluator);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        count.Should().Be(8);
        delta.Should().Be(0);
    }

    [Fact]
    public void CodecRoundTripsLevelsAndMetric()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh0 = assets.CreateId<MeshAssetTag>("mesh/high");
        SceneAssetId<MeshAssetTag> mesh1 = assets.CreateId<MeshAssetTag>("mesh/low");
        SceneAssetId<MaterialAssetTag> material = assets.CreateId<MaterialAssetTag>("material/lod");
        SceneAssetId<RenderPassAssetTag> pass = assets.CreateId<RenderPassAssetTag>("pass/main");
        var codec = new SceneLodGroupCodec(assets.Names);

        SceneLodGroup value = SceneLodGroup.Default;
        value.LevelCount = 0;
        value.PassId = pass;
        value.Metric = SceneLodMetric.ScreenRadius;
        value.Hysteresis = 0.2f;
        value.ReceiveLighting = false;
        value.Transparent = true;
        value.RenderOrder = 6;
        value.LocalCenter = new Vec3(1, 2, 3);
        value.Radius = 2.5f;
        value.SetLevel(0, new SceneLodLevel(mesh0, material, 120.0f));
        value.SetLevel(1, new SceneLodLevel(mesh1, material, 40.0f));

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneLodGroup restored = codec.Read(payload);

        payload.GetProperty("metric").GetString().Should().Be("screenRadius");
        restored.LevelCount.Should().Be(2);
        restored.GetLevel(0).MeshId.Should().Be(mesh0);
        restored.GetLevel(1).MeshId.Should().Be(mesh1);
        restored.GetLevel(1).Threshold.Should().BeApproximately(40.0f, 1e-6f);
        restored.Metric.Should().Be(SceneLodMetric.ScreenRadius);
        restored.PassId.Should().Be(pass);
        restored.RenderOrder.Should().Be(6);
        restored.Radius.Should().BeApproximately(2.5f, 1e-6f);
    }

    [Fact]
    public void CodecRejectsUnknownMetric()
    {
        var assets = new SceneAssetRegistry();
        var codec = new SceneLodGroupCodec(assets.Names);
        JsonElement payload = JsonCapture.Capture(writer => writer.WriteString("metric", "triangle"));

        Action read = () => codec.Read(payload);

        read.Should().Throw<SceneValidationException>()
            .Where(exception => exception.Code == SceneErrorCodes.ValidationInvalid);
    }
}
