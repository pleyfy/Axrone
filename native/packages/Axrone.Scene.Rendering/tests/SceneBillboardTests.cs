namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneBillboardTests
{
    private static SceneBillboardRenderer Billboard(string texture, int layer = 0, int order = 0)
    {
        SceneBillboardRenderer billboard = SceneBillboardRenderer.Default;
        billboard.TextureId = SceneAssetId<TextureAssetTag>.FromName(texture);
        billboard.SortingLayer = layer;
        billboard.RenderOrder = order;
        return billboard;
    }

    [Fact]
    public void CollectorOrdersByLayerAndCullsBehindCamera()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Billboard);
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;

        SceneEntity back = world.CreateEntity("Back");
        world.AddData(back, Billboard("texture/back", layer: 1));

        SceneEntity front = world.CreateEntity("Front");
        world.GetTransform3D(front).SetPosition(new Vec3(2.0f, 0.0f, 0.0f));
        world.AddData(front, Billboard("texture/front", layer: 0));

        SceneEntity behind = world.CreateEntity("Behind");
        world.GetTransform3D(behind).SetPosition(new Vec3(0.0f, 0.0f, 20.0f));
        world.AddData(behind, Billboard("texture/behind"));
        world.UpdateTransforms();

        var collector = new SceneBillboardItemCollector();

        int count = collector.Collect(world, frame, SceneRenderPassIds.Main);

        count.Should().Be(2);
        collector.CulledCount.Should().Be(1);
        collector.Items[0].Entity.Should().Be(front);
        collector.Items[1].Entity.Should().Be(back);
        collector.Items[0].Sequence.Should().Be(1);
    }

    [Fact]
    public void CollectorSkipsDisabledAndForeignPasses()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Billboard);
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 800, 600)!;

        SceneBillboardRenderer disabled = Billboard("texture/disabled");
        disabled.Enabled = false;
        SceneEntity disabledEntity = world.CreateEntity("Disabled");
        world.AddData(disabledEntity, disabled);

        SceneBillboardRenderer foreign = Billboard("texture/foreign");
        foreign.PassId = SceneAssetId<RenderPassAssetTag>.FromName("pass/ui");
        SceneEntity foreignEntity = world.CreateEntity("Foreign");
        world.AddData(foreignEntity, foreign);

        SceneBillboardRenderer invisible = Billboard("texture/invisible");
        invisible.Visible = false;
        SceneEntity invisibleEntity = world.CreateEntity("Invisible");
        world.AddData(invisibleEntity, invisible);

        var collector = new SceneBillboardItemCollector();

        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(0);
    }

    [Fact]
    public void CollectorIsZeroAllocationAfterWarmup()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Billboard);
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;

        for (int i = 0; i < 8; i++)
        {
            SceneEntity entity = world.CreateEntity($"Billboard{i}");
            world.GetTransform3D(entity).SetPosition(new Vec3(i * 0.25f, 0.0f, 0.0f));
            world.AddData(entity, Billboard($"texture/{i}", layer: i & 1));
        }

        world.UpdateTransforms();
        var collector = new SceneBillboardItemCollector();

        collector.Collect(world, frame, SceneRenderPassIds.Main);
        collector.Collect(world, frame, SceneRenderPassIds.Main);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        count.Should().Be(8);
        delta.Should().Be(0);
    }

    [Fact]
    public void CodecRoundTripsAssetNamesAndFields()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<TextureAssetTag> texture = assets.CreateId<TextureAssetTag>("texture/glow");
        SceneAssetId<MaterialAssetTag> material = assets.CreateId<MaterialAssetTag>("material/additive");
        SceneAssetId<RenderPassAssetTag> pass = assets.CreateId<RenderPassAssetTag>("pass/effects");
        var codec = new SceneBillboardRendererCodec(assets.Names);

        var value = new SceneBillboardRenderer
        {
            TextureId = texture,
            MaterialId = material,
            PassId = pass,
            Enabled = false,
            Visible = true,
            FlipX = true,
            FlipY = false,
            Mode = SceneBillboardMode.Cylindrical,
            SortingLayer = 3,
            RenderOrder = 7,
            Size = new Vec2(2.0f, 1.0f),
            Anchor = new Vec2(0.25f, 0.75f),
            Color = new Vec4(1.0f, 0.5f, 0.25f, 0.75f),
            UvRect = new Vec4(0.1f, 0.2f, 0.3f, 0.4f),
            Depth = 2.5f
        };

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneBillboardRenderer restored = codec.Read(payload);

        payload.GetProperty("texture").GetString().Should().Be("texture/glow");
        payload.GetProperty("mode").GetString().Should().Be("cylindrical");
        restored.Should().Be(value);
    }

    [Fact]
    public void CodecRejectsUnknownMode()
    {
        var assets = new SceneAssetRegistry();
        var codec = new SceneBillboardRendererCodec(assets.Names);
        JsonElement payload = JsonCapture.Capture(writer => writer.WriteString("mode", "spiral"));

        Action read = () => codec.Read(payload);

        read.Should().Throw<SceneValidationException>()
            .Where(exception => exception.Code == SceneErrorCodes.ValidationInvalid);
    }

    [Fact]
    public void CodecDefaultsWhenPayloadIsSparse()
    {
        var assets = new SceneAssetRegistry();
        var codec = new SceneBillboardRendererCodec(assets.Names);

        SceneBillboardRenderer restored = codec.Read(JsonCapture.Capture(static _ => { }));

        restored.Enabled.Should().BeTrue();
        restored.Visible.Should().BeTrue();
        restored.Mode.Should().Be(SceneBillboardMode.Spherical);
        restored.PassId.Should().Be(SceneRenderPassIds.Main);
        restored.Size.Should().Be(Vec2.One);
    }
}
