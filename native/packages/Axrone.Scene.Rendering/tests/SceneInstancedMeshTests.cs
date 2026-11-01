namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneInstancedMeshTests
{
    private static SceneInstanceTransform At(float x) =>
        new(Mat4.CreateTranslation(x, 0, 0), Vec4.One);

    private static SceneInstancedMeshRenderer Renderer(uint group, int renderOrder = 0)
    {
        SceneInstancedMeshRenderer renderer = SceneInstancedMeshRenderer.Default;
        renderer.MeshId = SceneAssetId<MeshAssetTag>.FromName("mesh/instanced");
        renderer.MaterialId = SceneAssetId<MaterialAssetTag>.FromName("material/instanced");
        renderer.InstanceGroupId = group;
        renderer.RenderOrder = renderOrder;
        return renderer;
    }

    [Fact]
    public void RegistryStoresGroupsAndRejectsZeroId()
    {
        var registry = new SceneInstanceRegistry();

        Action zero = () => registry.Register(0, [At(0)]);
        zero.Should().Throw<SceneConfigurationException>();

        registry.Register(1, [At(0), At(1), At(2)]);
        registry.Count.Should().Be(1);
        registry.TryGet(1, out ReadOnlySpan<SceneInstanceTransform> instances).Should().BeTrue();
        instances.Length.Should().Be(3);

        registry.Register(1, [At(5)]);
        registry.TryGet(1, out instances).Should().BeTrue();
        instances.Length.Should().Be(1);

        registry.Remove(1).Should().BeTrue();
        registry.Remove(1).Should().BeFalse();
    }

    [Fact]
    public void CollectorResolvesGroupCountAndBounds()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.InstancedMesh);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var registry = new SceneInstanceRegistry();
        registry.Register(7, [At(-1), At(0), At(1), At(2)]);

        SceneActor actor = world.CreateActor("Instances");
        world.AddData(actor, Renderer(7, renderOrder: 4));
        world.UpdateTransforms();

        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry).Should().Be(1);

        SceneInstancedMeshItem item = collector.Items[0];
        item.InstanceCount.Should().Be(4);
        item.InstanceGroupId.Should().Be(7);
        item.RenderOrder.Should().Be(4);
        item.HasBounds.Should().BeTrue();
        item.WorldBounds.Radius.Should().BeApproximately(1.5f, 1e-4f);
    }

    [Fact]
    public void CollectorSkipsMissingGroupsMeshesAndMaterials()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.InstancedMesh);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        var registry = new SceneInstanceRegistry();
        registry.Register(8, [At(0)]);

        SceneActor missingGroup = world.CreateActor("MissingGroup");
        world.AddData(missingGroup, Renderer(99));

        SceneInstancedMeshRenderer missingMesh = Renderer(8);
        missingMesh.MeshId = default;
        SceneActor missingMeshActor = world.CreateActor("MissingMesh");
        world.AddData(missingMeshActor, missingMesh);

        SceneInstancedMeshRenderer missingMaterial = Renderer(8);
        missingMaterial.MaterialId = default;
        SceneActor missingMaterialActor = world.CreateActor("MissingMaterial");
        world.AddData(missingMaterialActor, missingMaterial);

        world.UpdateTransforms();

        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry).Should().Be(0);
    }

    [Fact]
    public void CollectorCullsBehindCamera()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.InstancedMesh);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        var registry = new SceneInstanceRegistry();
        registry.Register(9, [At(0)]);

        SceneActor actor = world.CreateActor("Behind");
        world.GetTransform3D(actor).SetPosition(new Vec3(0.0f, 0.0f, 20.0f));
        world.AddData(actor, Renderer(9));
        world.UpdateTransforms();

        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry);

        collector.Count.Should().Be(0);
        collector.CulledCount.Should().Be(1);
    }

    [Fact]
    public void CollectorSortsByRenderOrder()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.InstancedMesh);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        var registry = new SceneInstanceRegistry();
        registry.Register(10, [At(0)]);

        SceneActor late = world.CreateActor("Late");
        world.AddData(late, Renderer(10, renderOrder: 5));

        SceneActor early = world.CreateActor("Early");
        world.AddData(early, Renderer(10, renderOrder: 1));
        world.UpdateTransforms();

        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry);

        collector.Items[0].Actor.Should().Be(early);
        collector.Items[1].Actor.Should().Be(late);
    }

    [Fact]
    public void CollectorIsZeroAllocationAfterWarmup()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.InstancedMesh);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 1280, 720)!;
        var registry = new SceneInstanceRegistry();

        for (uint i = 1; i <= 8; i++)
        {
            SceneInstanceTransform[] instances = [At(0), At(1)];
            registry.Register(i, instances);
            SceneActor actor = world.CreateActor($"Instances{i}");
            world.AddData(actor, Renderer(i));
        }

        world.UpdateTransforms();
        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry);
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main, registry);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        count.Should().Be(8);
        delta.Should().Be(0);
    }

    [Fact]
    public void CodecRoundTripsInstancedRendererFields()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = assets.CreateId<MeshAssetTag>("mesh/rocks");
        SceneAssetId<MaterialAssetTag> material = assets.CreateId<MaterialAssetTag>("material/rock");
        SceneAssetId<RenderPassAssetTag> pass = assets.CreateId<RenderPassAssetTag>("pass/opaque");
        var codec = new SceneInstancedMeshRendererCodec(assets.Names);

        var value = new SceneInstancedMeshRenderer
        {
            MeshId = mesh,
            MaterialId = material,
            PassId = pass,
            InstanceGroupId = 12,
            Visible = false,
            Transparent = true,
            RenderOrder = 9,
            Bounds = new BoundingSphere3(new Vec3(1, 2, 3), 4.5f)
        };

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneInstancedMeshRenderer restored = codec.Read(payload);

        payload.GetProperty("mesh").GetString().Should().Be("mesh/rocks");
        payload.GetProperty("group").GetInt32().Should().Be(12);
        restored.MeshId.Should().Be(mesh);
        restored.MaterialId.Should().Be(material);
        restored.PassId.Should().Be(pass);
        restored.InstanceGroupId.Should().Be(12);
        restored.Visible.Should().BeFalse();
        restored.Transparent.Should().BeTrue();
        restored.RenderOrder.Should().Be(9);
        restored.Bounds.Should().Be(new BoundingSphere3(new Vec3(1, 2, 3), 4.5f));
    }

    [Fact]
    public void CodecDefaultsWhenPayloadIsSparse()
    {
        var assets = new SceneAssetRegistry();
        var codec = new SceneInstancedMeshRendererCodec(assets.Names);

        SceneInstancedMeshRenderer restored = codec.Read(JsonCapture.Capture(static _ => { }));

        restored.Visible.Should().BeTrue();
        restored.PassId.Should().Be(SceneRenderPassIds.Main);
        restored.InstanceGroupId.Should().Be(0);
        restored.Bounds.Should().BeNull();
    }
}
