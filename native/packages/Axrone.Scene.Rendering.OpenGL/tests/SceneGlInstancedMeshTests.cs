namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Geometry;
using Axrone.Lighting;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlInstancedMeshTests
{
    [Fact]
    public void InstancedBatchEmitsOneDrawWithEveryInstance()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> meshId = RegisterMesh(assets);
        SceneAssetId<MaterialAssetTag> materialId = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneActor cameraActor = CreateCamera(world);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var registry = new SceneInstanceRegistry();
        registry.Register(1,
        [
            new SceneInstanceTransform(Mat4.CreateTranslation(0, 0, 0), Vec4.One),
            new SceneInstanceTransform(Mat4.CreateTranslation(1, 0, 0), Vec4.One),
            new SceneInstanceTransform(Mat4.CreateTranslation(2, 0, 0), Vec4.One)
        ]);

        SceneActor actor = world.CreateActor("Instances");
        SceneInstancedMeshRenderer renderer = SceneInstancedMeshRenderer.Default;
        renderer.MeshId = meshId;
        renderer.MaterialId = materialId;
        renderer.InstanceGroupId = 1;
        world.AddData(actor, renderer);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry).Should().Be(1);

        using var instancedRenderer = new SceneGlInstancedMeshRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        int drawCalls = instancedRenderer.Render(world, frame, collector.Items, registry, pass, frameState);

        drawCalls.Should().Be(1);
        instancedRenderer.LastBatchCount.Should().Be(1);
        instancedRenderer.LastInstanceCount.Should().Be(3);
        instancedRenderer.PipelineCount.Should().Be(1);
        frameState.DrawCalls.Should().Be(1);
        frameState.TrianglesSubmitted.Should().Be(3);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElementsInstanced(", StringComparison.Ordinal));

        byte[] storage = api.BufferStorage.Values.First(store => store.Length == 3 * 80);
        storage.Length.Should().Be(240);
    }

    [Fact]
    public void MissingMaterialSkipsTheBatch()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> meshId = RegisterMesh(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneActor cameraActor = CreateCamera(world);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var registry = new SceneInstanceRegistry();
        registry.Register(2, [new SceneInstanceTransform(Mat4.Identity, Vec4.One)]);

        SceneActor actor = world.CreateActor("Instances");
        SceneInstancedMeshRenderer renderer = SceneInstancedMeshRenderer.Default;
        renderer.MeshId = meshId;
        renderer.MaterialId = SceneAssetId<MaterialAssetTag>.FromName("material/missing");
        renderer.InstanceGroupId = 2;
        world.AddData(actor, renderer);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry).Should().Be(1);

        using var instancedRenderer = new SceneGlInstancedMeshRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        instancedRenderer.Render(world, frame, collector.Items, registry, pass, frameState).Should().Be(0);
        instancedRenderer.SkippedBatches.Should().Be(1);
        instancedRenderer.LastInstanceCount.Should().Be(0);
    }

    [Fact]
    public void DisposeIsIdempotentAndRejectsRendering()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        using var cache = new SceneGlAssetCache(context, assets);
        SceneGlInstancedMeshRenderer renderer = new(context, cache);

        renderer.Dispose();
        renderer.Dispose();

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, CreateCamera(world), 100, 100)!;
        var registry = new SceneInstanceRegistry();
        var pass = new SceneRenderPassDefinition(SceneRenderPassIds.Main, clearMask: SceneClearMask.None);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        Action render = () => renderer.Render(world, frame, [], registry, pass, state);
        render.Should().Throw<SceneDisposedException>();
    }

    [Fact]
    public void OrchestratorDrawsInstancedBatchesAfterSprites()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> meshId = RegisterMesh(assets);
        SceneAssetId<MaterialAssetTag> materialId = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneActor cameraActor = CreateCamera(world);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        var registry = new SceneInstanceRegistry();
        registry.Register(3,
        [
            new SceneInstanceTransform(Mat4.CreateTranslation(0, 0, 0), Vec4.One),
            new SceneInstanceTransform(Mat4.CreateTranslation(1, 0, 0), Vec4.One),
            new SceneInstanceTransform(Mat4.CreateTranslation(2, 0, 0), Vec4.One)
        ]);

        SceneActor actor = world.CreateActor("Instances");
        SceneInstancedMeshRenderer renderer = SceneInstancedMeshRenderer.Default;
        renderer.MeshId = meshId;
        renderer.MaterialId = materialId;
        renderer.InstanceGroupId = 3;
        world.AddData(actor, renderer);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry).Should().Be(1);

        var source = new InstancedSource(collector);
        using var orchestrator = new SceneGlRenderOrchestrator(context, cache, world, instances: registry);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);
        ReadOnlySpan<SceneRenderPassDefinition> passes = [pass];

        SceneRenderStats stats = orchestrator.RenderFrame(world, frame, source, passes, frameState);

        stats.DrawCalls.Should().Be(1);
        stats.TrianglesSubmitted.Should().Be(3);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElementsInstanced(", StringComparison.Ordinal));
    }

    private sealed class InstancedSource(SceneInstancedMeshItemCollector collector) : ISceneFrameItemSource, ISceneInstancedFrameItemSource
    {
        public LightingSelectionState? Lighting => null;

        public SceneFogState Fog { get; set; } = SceneFogState.Default;

        public ReadOnlySpan<SceneRenderItem> CollectMeshes(SceneAssetId<RenderPassAssetTag> passId) => [];

        public ReadOnlySpan<SceneSpriteRenderItem> CollectSprites(SceneAssetId<RenderPassAssetTag> passId) => [];

        public ReadOnlySpan<SceneInstancedMeshItem> CollectInstancedMeshes(SceneAssetId<RenderPassAssetTag> passId) =>
            collector.Items;
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-instanced")))
            .AddTransform3D()
            .AddRendering3D()
            .AddSceneRenderables(SceneRenderableFeatures.InstancedMesh)
            .Build()
            .CreateWorld();

    private static SceneActor CreateCamera(SceneWorld world)
    {
        SceneActor actor = world.CreateActor("Camera");
        world.GetTransform3D(actor).SetPosition(new Vec3(0, 0, 10));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(actor, camera);
        world.UpdateTransforms();
        return actor;
    }

    private static SceneAssetId<MeshAssetTag> RegisterMesh(SceneAssetRegistry assets)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("mesh/instanced");
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)
        ];
        var mesh = new SceneMeshDefinition(
            id,
            new byte[36],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f));
        assets.Meshes.Register(mesh);
        return id;
    }

    private static SceneAssetId<MaterialAssetTag> RegisterMaterial(SceneAssetRegistry assets)
    {
        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("shader/instanced");
        assets.Shaders.Register(new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}"));
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/instanced");
        assets.Materials.Register(new SceneMaterialDefinition(materialId, shaderId, new SceneMaterialSurface()));
        return materialId;
    }

    private static SceneRenderPassDefinition RegisterPass(SceneAssetRegistry assets)
    {
        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("main");
        var pass = new SceneRenderPassDefinition(
            passId,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.05f, 0.06f, 0.08f, 1.0f),
            depthTest: true,
            blend: false);
        assets.RenderPasses.Register(pass);
        return pass;
    }

    [Fact]
    public void HighSourceAttributeLocationsAreRemapped()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterMeshWithCustomAttribute(assets, 11);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneActor cameraActor = CreateCamera(world);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        var registry = new SceneInstanceRegistry();
        registry.Register(4, [new SceneInstanceTransform(Mat4.Identity, Vec4.One)]);

        SceneActor actor = world.CreateActor("Instances");
        SceneInstancedMeshRenderer renderer = SceneInstancedMeshRenderer.Default;
        renderer.MeshId = mesh;
        renderer.MaterialId = material;
        renderer.InstanceGroupId = 4;
        world.AddData(actor, renderer);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry).Should().Be(1);

        using var instancedRenderer = new SceneGlInstancedMeshRenderer(context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        instancedRenderer.Render(world, frame, collector.Items, registry, pass, state).Should().Be(1);
        instancedRenderer.PipelineCount.Should().Be(1);
        instancedRenderer.SkippedBatches.Should().Be(0);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElementsInstanced(", StringComparison.Ordinal));
    }

    [Fact]
    public void MeshExceedingAttributeBudgetIsSkipped()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterMeshWithManyAttributes(assets, 12);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneActor cameraActor = CreateCamera(world);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        var registry = new SceneInstanceRegistry();
        registry.Register(5, [new SceneInstanceTransform(Mat4.Identity, Vec4.One)]);

        SceneActor actor = world.CreateActor("Instances");
        SceneInstancedMeshRenderer renderer = SceneInstancedMeshRenderer.Default;
        renderer.MeshId = mesh;
        renderer.MaterialId = material;
        renderer.InstanceGroupId = 5;
        world.AddData(actor, renderer);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneInstancedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, registry).Should().Be(1);

        using var instancedRenderer = new SceneGlInstancedMeshRenderer(context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        instancedRenderer.Render(world, frame, collector.Items, registry, pass, state).Should().Be(0);
        instancedRenderer.SkippedBatches.Should().Be(1);
        instancedRenderer.PipelineCount.Should().Be(0);
        _ = api;
    }

    private static SceneAssetId<MeshAssetTag> RegisterMeshWithCustomAttribute(SceneAssetRegistry assets, int location)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("mesh/custom-location");
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 24),
            new SceneVertexAttribute((SceneMeshSemantic)location, 3, 12, 24)
        ];
        assets.Meshes.Register(new SceneMeshDefinition(
            id,
            new byte[3 * 24],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));
        return id;
    }

    private static SceneAssetId<MeshAssetTag> RegisterMeshWithManyAttributes(SceneAssetRegistry assets, int attributeCount)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("mesh/many-attributes");
        SceneVertexAttribute[] attributes = new SceneVertexAttribute[attributeCount];
        int stride = attributeCount * 4;
        for (int i = 0; i < attributeCount; i++)
        {
            byte components = i == 0 ? (byte)3 : (byte)1;
            attributes[i] = new SceneVertexAttribute((SceneMeshSemantic)i, components, i * 4, stride);
        }

        assets.Meshes.Register(new SceneMeshDefinition(
            id,
            new byte[3 * stride],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));
        return id;
    }
}
