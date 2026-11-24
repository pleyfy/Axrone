namespace Axrone.Scene.Runtime.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneFrameWiringTests
{
    [Fact]
    public void LodSelectionSwitchesWithCameraDistance()
    {
        using SceneRuntime runtime = CreateRuntime(out SceneEntity cameraEntity, out SceneEntity lodEntity);

        runtime.Frame.Plan(0).Should().BeTrue();
        runtime.Frame.CollectLodItems(SceneRenderPassIds.Main).Should().Be(1);
        runtime.Frame.LodItems[0].Level.Should().Be(1);
        runtime.Frame.LodItems[0].MeshId.Should().Be(SceneAssetId<MeshAssetTag>.FromName("mesh/far"));

        runtime.World.GetTransform3D(cameraEntity).SetPosition(new Vec3(0, 0, 1));
        runtime.World.UpdateTransforms();

        runtime.Frame.Plan(1).Should().BeTrue();
        runtime.Frame.CollectLodItems(SceneRenderPassIds.Main).Should().Be(1);
        runtime.Frame.LodItems[0].Level.Should().Be(0);
        runtime.Frame.LodItems[0].MeshId.Should().Be(SceneAssetId<MeshAssetTag>.FromName("mesh/near"));
        _ = lodEntity;
    }

    [Fact]
    public void LodSelectionIsDeterministicAcrossRuntimes()
    {
        static (int Level, SceneAssetId<MeshAssetTag> Mesh) Run()
        {
            using SceneRuntime runtime = CreateRuntime(out _, out _);
            runtime.Frame.Plan(0);
            runtime.Frame.CollectLodItems(SceneRenderPassIds.Main);
            SceneLodRenderItem item = runtime.Frame.LodItems[0];
            return (item.Level, item.MeshId);
        }

        Run().Should().Be(Run());
    }

    [Fact]
    public void LodCollectionIsZeroAllocationAfterWarmup()
    {
        using SceneRuntime runtime = CreateRuntime(out _, out _);
        runtime.Frame.Plan(0);
        runtime.Frame.CollectLodItems(SceneRenderPassIds.Main);
        runtime.Frame.Plan(1);
        runtime.Frame.CollectLodItems(SceneRenderPassIds.Main);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 64; i++)
        {
            runtime.Frame.Plan(i);
            runtime.Frame.CollectLodItems(SceneRenderPassIds.Main);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
    }

    [Fact]
    public void OptionalCollectorsReturnEmptyWithoutRegisteredComponents()
    {
        using SceneRuntime runtime = new(new SceneRuntimeOptions
        {
            Profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/no-renderables")))
                .AddTransform3D()
                .AddRendering3D()
                .Build()
        });

        SceneEntity camera = RenderingCamera(runtime.World, new Vec3(0, 0, 10));
        runtime.World.UpdateTransforms();
        runtime.Frame.Plan(0).Should().BeTrue();

        runtime.Frame.CollectLodItems(SceneRenderPassIds.Main).Should().Be(0);
        runtime.Frame.CollectSkinnedMeshes(SceneRenderPassIds.Main).Should().Be(0);
        runtime.Frame.CollectBillboards(SceneRenderPassIds.Main).Should().Be(0);
        runtime.Frame.CollectLines(SceneRenderPassIds.Main).Should().Be(0);
        runtime.Frame.CollectTrails(SceneRenderPassIds.Main).Should().Be(0);
        _ = camera;
    }

    private static SceneRuntime CreateRuntime(out SceneEntity cameraEntity, out SceneEntity lodEntity)
    {
        SceneProfile profile = new SceneProfileBuilder(
            new SceneProfileId(SceneStringId.FromName("test/lod-wiring")))
            .AddTransform3D()
            .AddRendering3D()
            .AddSceneRenderables(SceneRenderableFeatures.LodGroup)
            .Build();
        SceneRuntime runtime = new(new SceneRuntimeOptions { Profile = profile });

        cameraEntity = RenderingCamera(runtime.World, new Vec3(0, 0, 10));

        lodEntity = runtime.World.CreateEntity("Lod");
        SceneLodGroup group = SceneLodGroup.Default;
        group.Hysteresis = 0.0f;
        group.SetLevel(0, new SceneLodLevel(
            SceneAssetId<MeshAssetTag>.FromName("mesh/near"),
            SceneAssetId<MaterialAssetTag>.FromName("material/lod"),
            5.0f));
        group.SetLevel(1, new SceneLodLevel(
            SceneAssetId<MeshAssetTag>.FromName("mesh/far"),
            SceneAssetId<MaterialAssetTag>.FromName("material/lod"),
            50.0f));
        runtime.World.AddData(lodEntity, group);
        runtime.World.UpdateTransforms();
        return runtime;
    }

    private static SceneEntity RenderingCamera(SceneWorld world, Vec3 position)
    {
        SceneEntity entity = world.CreateEntity("Camera");
        world.GetTransform3D(entity).SetPosition(position);
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(entity, camera);
        return entity;
    }
}
