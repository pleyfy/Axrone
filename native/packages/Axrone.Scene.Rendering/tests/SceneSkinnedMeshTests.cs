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
        SceneActor actor = world.CreateActor("Skinned");
        Mat4[] palette = [Mat4.CreateTranslation(1, 0, 0), Mat4.CreateTranslation(2, 0, 0)];

        store.ApplyBonePalette(actor, palette);

        store.Count.Should().Be(1);
        store.Revision.Should().Be(1);
        store.TryGetBonePalette(actor, out ReadOnlySpan<Mat4> stored).Should().BeTrue();
        stored.Length.Should().Be(2);
        stored[1].M41.Should().Be(2.0f);

        palette[0] = Mat4.Identity;
        store.TryGetBonePalette(actor, out stored).Should().BeTrue();
        stored[0].M41.Should().Be(1.0f);

        store.ApplyBonePalette(actor, ReadOnlySpan<Mat4>.Empty);
        store.Count.Should().Be(0);
        store.Revision.Should().Be(2);
        store.TryGetBonePalette(actor, out _).Should().BeFalse();
    }

    [Fact]
    public void PaletteStoreRemovesAndClears()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.SkinnedMesh);
        SceneActor first = world.CreateActor("First");
        SceneActor second = world.CreateActor("Second");
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
        SceneActor actor = world.CreateActor("Skinned");
        var store = new SceneBonePaletteStore();
        Mat4[] palette = new Mat4[16];
        for (int i = 0; i < palette.Length; i++)
        {
            palette[i] = Mat4.CreateTranslation(i, 0, 0);
        }

        store.ApplyBonePalette(actor, palette);
        store.ApplyBonePalette(actor, palette);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            store.ApplyBonePalette(actor, palette);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
    }

    [Fact]
    public void CollectorOrdersCullsAndSkipsIncompleteRenderers()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.SkinnedMesh);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        var assets = new SceneAssetRegistry();
        SceneMeshDefinition mesh = RenderingFixture.CreateMesh(assets, "mesh/skinned", radius: 1.0f);
        assets.Meshes.Register(mesh);

        SceneSkinnedMeshRenderer late = Renderer(renderOrder: 5);
        late.MeshId = mesh.Id;
        SceneActor lateActor = world.CreateActor("Late");
        world.AddData(lateActor, late);

        SceneSkinnedMeshRenderer early = Renderer(renderOrder: 1);
        early.MeshId = mesh.Id;
        SceneActor earlyActor = world.CreateActor("Early");
        world.AddData(earlyActor, early);

        SceneSkinnedMeshRenderer invisible = Renderer();
        invisible.Visible = false;
        SceneActor invisibleActor = world.CreateActor("Invisible");
        world.AddData(invisibleActor, invisible);

        SceneActor behindActor = world.CreateActor("Behind");
        world.GetTransform3D(behindActor).SetPosition(new Vec3(0, 0, 20));
        SceneSkinnedMeshRenderer behind = Renderer();
        behind.MeshId = mesh.Id;
        world.AddData(behindActor, behind);
        world.UpdateTransforms();

        var collector = new SceneSkinnedMeshItemCollector();

        collector.Collect(world, frame, SceneRenderPassIds.Main, assets).Should().Be(2);
        collector.Items[0].Actor.Should().Be(earlyActor);
        collector.Items[1].Actor.Should().Be(lateActor);
        collector.CulledCount.Should().Be(1);
    }

    [Fact]
    public void CollectorIsZeroAllocationAfterWarmup()
    {
        using SceneWorld world = RenderingFixture.CreateRenderableWorld(SceneRenderableFeatures.SkinnedMesh);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 1280, 720)!;
        var assets = new SceneAssetRegistry();
        SceneMeshDefinition mesh = RenderingFixture.CreateMesh(assets, "mesh/skinned");
        assets.Meshes.Register(mesh);

        for (int i = 0; i < 8; i++)
        {
            SceneSkinnedMeshRenderer renderer = Renderer(i);
            renderer.MeshId = mesh.Id;
            SceneActor actor = world.CreateActor($"Skinned{i}");
            world.GetTransform3D(actor).SetPosition(new Vec3(i * 0.1f, 0, 0));
            world.AddData(actor, renderer);
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
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        _ = world.CreateActor("Plain");
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
