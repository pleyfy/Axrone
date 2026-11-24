namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneSkinnedMeshTests
{
    private static SceneSkinnedMeshRenderer Renderer(int renderOrder = 0, bool transparent = false)
    {
        SceneSkinnedMeshRenderer renderer = SceneSkinnedMeshRenderer.Default;
        renderer.MeshId = SceneAssetId<MeshAssetTag>.FromName("mesh/skinned");
        renderer.MaterialId = SceneAssetId<MaterialAssetTag>.FromName("material/skinned");
        renderer.RenderOrder = renderOrder;
        renderer.Transparent = transparent;
        return renderer;
    }

    [Fact]
    public void PaletteStoreRoundTripsAndTracksRevision()
    {
        var store = new SceneBonePaletteStore();
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.SkinnedMesh);
        SceneEntity entity = world.CreateEntity("Skinned");
        Mat4[] palette = [Mat4.CreateTranslation(1, 0, 0), Mat4.CreateTranslation(2, 0, 0)];

        store.ApplyBonePalette(entity, palette);

        store.Count.Should().Be(1);
        store.Revision.Should().Be(1);
        store.TryGetBonePalette(entity, out ReadOnlySpan<Mat4> stored).Should().BeTrue();
        stored.Length.Should().Be(2);
        stored[1].M41.Should().Be(2.0f);

        palette[0] = Mat4.Identity;
        store.TryGetBonePalette(entity, out stored).Should().BeTrue();
        stored[0].M41.Should().Be(1.0f);

        store.ApplyBonePalette(entity, ReadOnlySpan<Mat4>.Empty);
        store.Count.Should().Be(0);
        store.Revision.Should().Be(2);
        store.TryGetBonePalette(entity, out _).Should().BeFalse();
    }

    [Fact]
    public void PaletteStoreRemovesAndClears()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.SkinnedMesh);
        SceneEntity first = world.CreateEntity("First");
        SceneEntity second = world.CreateEntity("Second");
        var store = new SceneBonePaletteStore();
        store.ApplyBonePalette(first, [Mat4.Identity]);
        store.ApplyBonePalette(second, [Mat4.Identity]);

        store.Remove(first).Should().BeTrue();
        store.Remove(first).Should().BeFalse();
        store.Count.Should().Be(1);
        store.Clear();
        store.Count.Should().Be(0);
        store.TryGetBonePalette(second, out _).Should().BeFalse();
    }

    [Fact]
    public void PaletteUpdateIsZeroAllocationAtSteadyCapacity()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.SkinnedMesh);
        SceneEntity entity = world.CreateEntity("Skinned");
        var store = new SceneBonePaletteStore();
        Mat4[] palette = new Mat4[16];
        for (int i = 0; i < palette.Length; i++)
        {
            palette[i] = Mat4.CreateTranslation(i, 0, 0);
        }

        store.ApplyBonePalette(entity, palette);
        store.ApplyBonePalette(entity, palette);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            store.ApplyBonePalette(entity, palette);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
    }

    [Fact]
    public void CollectorOrdersCullsAndSkipsIncompleteRenderers()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.SkinnedMesh);
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 800, 600)!;
        var assets = new SceneAssetRegistry();
        SceneMeshDefinition mesh = RenderingFixture.CreateMesh(assets, "mesh/skinned", radius: 1.0f);
        assets.Meshes.Register(mesh);

        SceneSkinnedMeshRenderer late = Renderer(renderOrder: 5);
        late.MeshId = mesh.Id;
        SceneEntity lateEntity = world.CreateEntity("Late");
        world.AddData(lateEntity, late);

        SceneSkinnedMeshRenderer early = Renderer(renderOrder: 1);
        early.MeshId = mesh.Id;
        SceneEntity earlyEntity = world.CreateEntity("Early");
        world.AddData(earlyEntity, early);

        SceneSkinnedMeshRenderer invisible = Renderer();
        invisible.Visible = false;
        SceneEntity invisibleEntity = world.CreateEntity("Invisible");
        world.AddData(invisibleEntity, invisible);

        SceneEntity behindEntity = world.CreateEntity("Behind");
        world.GetTransform3D(behindEntity).SetPosition(new Vec3(0, 0, 20));
        SceneSkinnedMeshRenderer behind = Renderer();
        behind.MeshId = mesh.Id;
        world.AddData(behindEntity, behind);
        world.UpdateTransforms();

        var collector = new SceneSkinnedMeshItemCollector();

        collector.Collect(world, frame, SceneRenderPassIds.Main, assets).Should().Be(2);
        collector.Items[0].Entity.Should().Be(earlyEntity);
        collector.Items[1].Entity.Should().Be(lateEntity);
        collector.CulledCount.Should().Be(1);
    }

    [Fact]
    public void CollectorIsZeroAllocationAfterWarmup()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.SkinnedMesh);
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;
        var assets = new SceneAssetRegistry();
        SceneMeshDefinition mesh = RenderingFixture.CreateMesh(assets, "mesh/skinned");
        assets.Meshes.Register(mesh);

        for (int i = 0; i < 8; i++)
        {
            SceneSkinnedMeshRenderer renderer = Renderer(i);
            renderer.MeshId = mesh.Id;
            SceneEntity entity = world.CreateEntity($"Skinned{i}");
            world.GetTransform3D(entity).SetPosition(new Vec3(i * 0.1f, 0, 0));
            world.AddData(entity, renderer);
        }

        world.UpdateTransforms();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets);
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets);

        long before = GC.GetAllocatedBytesForCurrentThread();
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main, assets);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        count.Should().Be(8);
        delta.Should().Be(0);
    }

    [Fact]
    public void WorldWithoutComponentCollectsNothing()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.Billboard);
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 800, 600)!;
        _ = world.CreateEntity("Plain");
        world.UpdateTransforms();

        var collector = new SceneSkinnedMeshItemCollector();

        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(0);
    }

    [Fact]
    public void CodecRoundTripsFields()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = assets.CreateId<MeshAssetTag>("mesh/rigged");
        SceneAssetId<MaterialAssetTag> material = assets.CreateId<MaterialAssetTag>("material/skin");
        SceneAssetId<RenderPassAssetTag> pass = assets.CreateId<RenderPassAssetTag>("pass/main");
        var codec = new SceneSkinnedMeshRendererCodec(assets.Names);

        var value = new SceneSkinnedMeshRenderer
        {
            MeshId = mesh,
            MaterialId = material,
            PassId = pass,
            Visible = false,
            ReceiveLighting = false,
            Transparent = true,
            RenderOrder = 7,
            Bounds = new BoundingSphere3(new Vec3(1, 2, 3), 4.0f)
        };

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneSkinnedMeshRenderer restored = codec.Read(payload);

        payload.GetProperty("mesh").GetString().Should().Be("mesh/rigged");
        restored.MeshId.Should().Be(mesh);
        restored.MaterialId.Should().Be(material);
        restored.PassId.Should().Be(pass);
        restored.Visible.Should().BeFalse();
        restored.ReceiveLighting.Should().BeFalse();
        restored.Transparent.Should().BeTrue();
        restored.RenderOrder.Should().Be(7);
        restored.Bounds.Should().Be(new BoundingSphere3(new Vec3(1, 2, 3), 4.0f));
    }

    [Fact]
    public void CodecDefaultsWhenPayloadIsSparse()
    {
        var assets = new SceneAssetRegistry();
        var codec = new SceneSkinnedMeshRendererCodec(assets.Names);

        SceneSkinnedMeshRenderer restored = codec.Read(JsonCapture.Capture(static _ => { }));

        restored.Visible.Should().BeTrue();
        restored.ReceiveLighting.Should().BeTrue();
        restored.PassId.Should().Be(SceneRenderPassIds.Main);
        restored.Bounds.Should().BeNull();
    }
}
