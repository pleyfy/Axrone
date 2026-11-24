namespace Axrone.Scene.Rendering.Tests;

using Axrone.Geometry;
using Axrone.Lighting;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneRenderingTests
{
    [Fact]
    public void CameraFrame_ProjectsOrigin()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        var collector = new SceneCameraFrameCollector();

        SceneCameraFrame? frame = collector.Collect(world, cameraEntity, 1280, 720);

        frame.Should().NotBeNull();
        frame!.Position.Should().Be(new Vec3(0.0f, 0.0f, 10.0f));
        frame.AspectRatio.Should().BeApproximately(1280.0f / 720.0f, 1e-5f);
        frame.ViewMatrix.Should().NotBe(Mat4.Identity);
        frame.ProjectionMatrix.Should().NotBe(Mat4.Identity);
        frame.Frustum.ContainsPoint(Vec3.Zero).Should().BeTrue();
    }

    [Fact]
    public void CameraFrame_RejectsPointsBehindCamera()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;

        frame.Frustum.ContainsPoint(Vec3.Zero).Should().BeTrue();
        frame.Frustum.ContainsPoint(new Vec3(0.0f, 0.0f, 20.0f)).Should().BeFalse();
        frame.Frustum.ContainsPoint(new Vec3(0.0f, 0.0f, 200.0f)).Should().BeFalse();
    }

    [Fact]
    public void CameraFrame_Orthographic_ProjectsOrigin()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneEntity cameraEntity = world.CreateEntity("Camera");
        world.GetTransform3D(cameraEntity).SetPosition(new Vec3(0.0f, 0.0f, 10.0f));
        SceneCamera camera = SceneCamera.Default;
        camera.SetOrthographic(5.0f, 0.1f, 100.0f);
        world.AddData(cameraEntity, camera);
        world.UpdateTransforms();

        SceneCameraFrame? frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 800, 600);

        frame.Should().NotBeNull();
        frame!.ProjectionMatrix.Should().NotBe(Mat4.Identity);
        frame.Frustum.ContainsPoint(Vec3.Zero).Should().BeTrue();
    }

    [Fact]
    public void CameraFrame_RejectsInvalidClipping()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneEntity cameraEntity = world.CreateEntity("Camera");
        SceneCamera camera = SceneCamera.Default;
        camera.Near = 0.0f;
        world.AddData(cameraEntity, camera);

        var collector = new SceneCameraFrameCollector();
        Action collect = () => collector.Collect(world, cameraEntity, 800, 600);

        collect.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void CameraSelector_PrefersPrimaryThenFallback()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneEntity fallback = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f));
        SceneEntity primary = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 8.0f), primary: true);

        SceneCameraSelector.TrySelect(world, out SceneEntity selected).Should().BeTrue();
        selected.Should().Be(primary);

        world.SetActive(primary, false);
        SceneCameraSelector.TrySelect(world, out selected).Should().BeTrue();
        selected.Should().Be(fallback);
    }

    [Fact]
    public void RenderItemCollector_CullsAndOrdersTransparentQueue()
    {
        SceneProfile profile = RenderingFixture.CreateProfile();
        using SceneWorld world = profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        SceneMeshDefinition mesh = RenderingFixture.CreateMesh(assets, "mesh/item");
        assets.Meshes.Register(mesh);
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/item");
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;

        SceneEntity opaque = CreateRenderer(world, mesh.Id, materialId, new Vec3(0.0f, 0.0f, 0.0f));
        SceneEntity transparentNear = CreateRenderer(world, mesh.Id, materialId, new Vec3(0.0f, 0.0f, 5.0f), transparent: true);
        SceneEntity transparentFar = CreateRenderer(world, mesh.Id, materialId, new Vec3(0.0f, 0.0f, 3.0f), transparent: true);
        SceneEntity culled = CreateRenderer(world, mesh.Id, materialId, new Vec3(0.0f, 0.0f, 200.0f));
        SceneEntity inactive = CreateRenderer(world, mesh.Id, materialId, new Vec3(0.0f, 0.0f, 0.0f));
        world.SetActive(inactive, false);
        world.UpdateTransforms();

        assets.Meshes.TryGet(mesh.Id, out SceneMeshDefinition? resolvedMesh).Should().BeTrue();
        resolvedMesh!.Bounds.Should().NotBeNull();
        world.GetWorldPosition3D(culled).Should().Be(new Vec3(0.0f, 0.0f, 200.0f));
        frame.Frustum.ContainsPoint(new Vec3(0.0f, 0.0f, 200.0f)).Should().BeFalse();
        frame.Frustum.IntersectsSphere(new BoundingSphere3(new Vec3(0.0f, 0.0f, 200.0f), 1.0f)).Should().BeFalse();

        var collector = new SceneRenderItemCollector(16);
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main, assets);

        SceneRenderItem farItem = default;
        bool foundFar = false;
        foreach (SceneRenderItem item in collector.Items)
        {
            if (item.Entity == culled)
            {
                farItem = item;
                foundFar = true;
            }
        }

        if (foundFar)
        {
            farItem.HasBounds.Should().BeTrue();
            farItem.WorldBounds.Center.Z.Should().Be(200.0f);
        }

        count.Should().Be(3);
        collector.CulledCount.Should().Be(1);
        collector.Items[0].Entity.Should().Be(opaque);
        collector.Items[0].Transparent.Should().BeFalse();
        collector.Items[1].Entity.Should().Be(transparentFar);
        collector.Items[2].Entity.Should().Be(transparentNear);
        collector.Items[1].Transparent.Should().BeTrue();
        collector.Items[2].Transparent.Should().BeTrue();

        collector.Collect(world, frame, SceneRenderPassIds.Main, assets, cull: false).Should().Be(4);
    }

    [Fact]
    public void RenderItemCollector_SteadyStateDoesNotAllocate()
    {
        SceneProfile profile = RenderingFixture.CreateProfile();
        using SceneWorld world = profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        SceneMeshDefinition mesh = RenderingFixture.CreateMesh(assets, "mesh/steady");
        assets.Meshes.Register(mesh);
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/steady");
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        _ = CreateRenderer(world, mesh.Id, materialId, Vec3.Zero);
        world.UpdateTransforms();
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;
        var collector = new SceneRenderItemCollector(16);

        for (int i = 0; i < 10; i++)
        {
            collector.Collect(world, frame, SceneRenderPassIds.Main, assets);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++)
        {
            collector.Collect(world, frame, SceneRenderPassIds.Main, assets);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void LightingCollector_ResolvesAndRemovesLights()
    {
        SceneProfile profile = RenderingFixture.CreateProfile();
        using SceneWorld world = profile.CreateWorld();
        SceneEntity directionalEntity = world.CreateEntity("Sun");
        SceneDirectionalLight directional = SceneDirectionalLight.Default;
        directional.Primary = true;
        world.AddData(directionalEntity, directional);
        SceneEntity pointEntity = world.CreateEntity("Point");
        world.AddData(pointEntity, ScenePointLight.Default);
        world.UpdateTransforms();

        using var collector = new SceneLightingCollector(maxLocalLights: 4);
        LightingSelectionState selection = collector.Collect(
            world,
            new Vec3(0.0f, 0.0f, 10.0f),
            new Vec3(0.2f),
            new Vec3(0.4f),
            new Vec3(0.1f));

        selection.Stats.SelectedDirectionalCount.Should().Be(1);
        selection.Stats.SelectedPointCount.Should().Be(1);
        collector.Rig.Count.Should().Be(2);

        world.GetData<ScenePointLight>(pointEntity).Enabled = false;
        selection = collector.Collect(
            world,
            new Vec3(0.0f, 0.0f, 10.0f),
            new Vec3(0.2f),
            new Vec3(0.4f),
            new Vec3(0.1f));

        selection.Stats.SelectedPointCount.Should().Be(0);
        collector.Rig.Count.Should().Be(1);
    }

    [Fact]
    public void LightingCollector_SteadyStateDoesNotAllocate()
    {
        SceneProfile profile = RenderingFixture.CreateProfile();
        using SceneWorld world = profile.CreateWorld();
        SceneEntity directionalEntity = world.CreateEntity("Sun");
        world.AddData(directionalEntity, SceneDirectionalLight.Default);
        SceneEntity pointEntity = world.CreateEntity("Point");
        world.AddData(pointEntity, ScenePointLight.Default);
        world.UpdateTransforms();
        using var collector = new SceneLightingCollector(4);

        for (int i = 0; i < 10; i++)
        {
            _ = collector.Collect(
                world,
                new Vec3(0.0f, 0.0f, 10.0f),
                new Vec3(0.2f),
                new Vec3(0.4f),
                new Vec3(0.1f));
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++)
        {
            _ = collector.Collect(
                world,
                new Vec3(0.0f, 0.0f, 10.0f),
                new Vec3(0.2f),
                new Vec3(0.4f),
                new Vec3(0.1f));
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void RenderFrameState_AccumulatesCounters()
    {
        var state = new SceneRenderFrameState();
        state.Begin(7);
        state.RecordDraw(triangleCount: 3);
        state.RecordDraw(triangleCount: 6, drawCalls: 2);
        state.RecordCulled(4);
        state.RecordQueues(opaqueCount: 2, transparentCount: 1);

        SceneRenderStats stats = state.Snapshot(passCount: 1);

        stats.Frame.Should().Be(7);
        stats.DrawCalls.Should().Be(3);
        stats.TrianglesSubmitted.Should().Be(9);
        stats.PassCount.Should().Be(1);
        stats.OpaqueCount.Should().Be(2);
        stats.TransparentCount.Should().Be(1);
        stats.CulledCount.Should().Be(4);
    }

    [Fact]
    public void RenderPassPlan_OrdersEnabledPasses()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<RenderPassAssetTag> early = assets.CreateId<RenderPassAssetTag>("pass/early");
        SceneAssetId<RenderPassAssetTag> late = assets.CreateId<RenderPassAssetTag>("pass/late");
        SceneAssetId<RenderPassAssetTag> disabled = assets.CreateId<RenderPassAssetTag>("pass/disabled");
        assets.RenderPasses.Register(new SceneRenderPassDefinition(late, order: 2));
        assets.RenderPasses.Register(new SceneRenderPassDefinition(early, order: 1));
        assets.RenderPasses.Register(new SceneRenderPassDefinition(disabled, order: 0, enabled: false));

        var plan = new SceneRenderPassPlan(assets);

        plan.Count.Should().Be(2);
        plan.Passes[0].Id.Should().Be(early);
        plan.Passes[1].Id.Should().Be(late);

        assets.RenderPasses.Register(new SceneRenderPassDefinition(disabled, order: 0, enabled: true));
        plan.Rebuild();

        plan.Count.Should().Be(3);
        plan.Passes[0].Id.Should().Be(disabled);
        plan.Passes[1].Id.Should().Be(early);
        plan.Passes[2].Id.Should().Be(late);
    }

    [Fact]
    public void ProfileExtensions_RegisterRenderingComponents()
    {
        SceneProfile profile = RenderingFixture.CreateProfile();
        profile.HasTransform3D.Should().BeTrue();
        profile.Registry.TryGetDataByType(typeof(SceneCamera), out _).Should().BeTrue();
        profile.Registry.TryGetDataByType(typeof(SceneMeshRenderer), out _).Should().BeTrue();
        profile.Registry.TryGetDataByType(typeof(SceneDirectionalLight), out _).Should().BeTrue();
        profile.Registry.TryGetDataByType(typeof(ScenePointLight), out _).Should().BeTrue();
        profile.Registry.TryGetDataByType(typeof(SceneSpotLight), out _).Should().BeTrue();
    }

    [Fact]
    public void RenderItemCollector_SortsLargeTransparentQueueByDistance()
    {
        SceneProfile profile = RenderingFixture.CreateProfile();
        using SceneWorld world = profile.CreateWorld();
        var assets = new SceneAssetRegistry();
        SceneMeshDefinition mesh = RenderingFixture.CreateMesh(assets, "mesh/large", radius: 0.25f);
        assets.Meshes.Register(mesh);
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/large");
        SceneEntity cameraEntity = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;

        const int rendererCount = 64;
        for (int i = 0; i < rendererCount; i++)
        {
            CreateRenderer(
                world,
                mesh.Id,
                materialId,
                new Vec3(0.0f, 0.0f, -i * 0.25f),
                transparent: true);
        }

        world.UpdateTransforms();
        var collector = new SceneRenderItemCollector(16);
        int planned = collector.Collect(world, frame, SceneRenderPassIds.Main, assets);

        planned.Should().Be(rendererCount);
        for (int i = 1; i < collector.Count; i++)
        {
            collector.Items[i - 1].DistanceSquared
                .Should().BeGreaterThanOrEqualTo(collector.Items[i].DistanceSquared);
        }
    }

    [Fact]
    public void FogState_FromComponentSanitizes()
    {
        var fog = new SceneFog
        {
            Enabled = true,
            Color = Vec3.One,
            Mode = SceneFogMode.Linear,
            Density = 2.0f,
            RangeStart = 100.0f,
            RangeEnd = 10.0f
        };

        SceneFogState state = SceneFogState.FromComponent(fog);

        state.Enabled.Should().BeTrue();
        state.Density.Should().Be(1.0f);
        state.RangeStart.Should().Be(10.0f);
        state.RangeEnd.Should().Be(100.0f);
    }

    [Fact]
    public void FogSelector_SelectsActiveComponent()
    {
        using SceneWorld world = RenderingFixture.CreateProfile().CreateWorld();
        SceneEntity entity = world.CreateEntity("Fog");
        SceneFog fog = SceneFog.Default;
        fog.Enabled = true;
        fog.Mode = SceneFogMode.Linear;
        fog.RangeStart = 1.0f;
        fog.RangeEnd = 50.0f;
        world.AddData(entity, fog);

        SceneFogSelector.TrySelect(world, out SceneFogState state).Should().BeTrue();
        state.Enabled.Should().BeTrue();
        state.Mode.Should().Be(SceneFogMode.Linear);

        world.SetActive(entity, false);

        SceneFogSelector.TrySelect(world, out state).Should().BeFalse();
        state.Enabled.Should().BeFalse();
    }

    private static SceneEntity CreateRenderer(
        SceneWorld world,
        SceneAssetId<MeshAssetTag> meshId,
        SceneAssetId<MaterialAssetTag> materialId,
        Vec3 position,
        bool transparent = false)
    {
        SceneEntity entity = world.CreateEntity("Renderer");
        world.GetTransform3D(entity).SetPosition(position);
        SceneMeshRenderer renderer = SceneMeshRenderer.Default;
        renderer.MeshId = meshId;
        renderer.MaterialId = materialId;
        renderer.Transparent = transparent;
        world.AddData(entity, renderer);
        return entity;
    }
}
