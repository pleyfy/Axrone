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

public sealed class SceneGlOrchestratorTests
{
    [Fact]
    public void Orchestrator_RendersMeshesAndSpritesInOnePass()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();

        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("shader/mixed");
        assets.Shaders.Register(new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}"));

        SceneAssetId<MeshAssetTag> meshId = assets.CreateId<MeshAssetTag>("mesh/mixed");
        assets.Meshes.Register(new SceneMeshDefinition(
            meshId,
            new byte[36],
            [new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)],
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));

        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/mixed");
        assets.Materials.Register(new SceneMaterialDefinition(
            materialId,
            shaderId,
            new SceneMaterialSurface()));

        SceneAssetId<TextureAssetTag> textureId = assets.CreateId<TextureAssetTag>("texture/mixed");
        assets.Textures.Register(new SceneTextureDefinition(
            textureId,
            new SceneTextureColor(Vec4.One, 4, 4)));

        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("main");
        var pass = new SceneRenderPassDefinition(
            passId,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.05f, 0.06f, 0.08f, 1.0f));
        assets.RenderPasses.Register(pass);

        using SceneWorld world = CreateMixedWorld(out SceneEntity cameraEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 640, 360)!;

        SceneEntity meshEntity = world.CreateEntity("Mesh");
        SceneMeshRenderer renderer = SceneMeshRenderer.Default;
        renderer.MeshId = meshId;
        renderer.MaterialId = materialId;
        renderer.PassId = passId;
        world.AddData(meshEntity, renderer);

        SceneEntity spriteEntity = world.CreateEntity("Sprite");
        SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
        sprite.TextureId = textureId;
        sprite.PassId = passId;
        world.AddData(spriteEntity, sprite);
        world.UpdateTransforms();

        var meshCollector = new SceneRenderItemCollector();
        meshCollector.Collect(world, frame, passId, assets).Should().Be(1);

        var spriteCollector = new SceneSpriteItemCollector();
        spriteCollector.Collect(world, frame, passId).Should().Be(1);

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        var fog = new SceneFogState(
            true,
            new Vec3(0.5f, 0.5f, 0.5f),
            SceneFogMode.Exponential,
            0.5f,
            0.0f,
            100.0f);
        var source = new ItemSource(meshCollector.Items.ToArray(), spriteCollector.Items.ToArray())
        {
            Fog = fog,
            OutputGamma = 1f / 2.2f,
            EditorPreview = true,
        };
        using var orchestrator = new SceneGlRenderOrchestrator(context, cache, world);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        SceneRenderStats stats = orchestrator.RenderFrame(
            world,
            frame,
            source,
            [pass],
            frameState);

        stats.PassCount.Should().Be(1);
        stats.DrawCalls.Should().Be(2);
        orchestrator.MeshExecutor.LastFog.Should().Be(fog);
        orchestrator.MeshExecutor.LastOutputGamma.Should().BeApproximately(1f / 2.2f, 1e-5f);
        orchestrator.MeshExecutor.LastEditorPreview.Should().BeTrue();
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements", StringComparison.Ordinal));
    }

    [Fact]
    public void Orchestrator_ReportsNoPassesForEmptyPlan()
    {
        var api = new MockGLApi();
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        using SceneWorld world = CreateMixedWorld(out SceneEntity cameraEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 640, 360)!;

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        using var orchestrator = new SceneGlRenderOrchestrator(context, cache, world);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        SceneRenderStats stats = orchestrator.RenderFrame(
            world,
            frame,
            new ItemSource([], []),
            [],
            frameState);

        stats.PassCount.Should().Be(0);
        stats.DrawCalls.Should().Be(0);
    }

    private static SceneWorld CreateMixedWorld(out SceneEntity cameraEntity)
    {
        var builder = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/gl-mixed")))
            .AddTransform3D()
            .AddRendering3D();

        builder.AddData<SceneSpriteRenderer>(
            "SpriteRenderer",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        SceneWorld world = builder.Build().CreateWorld();
        cameraEntity = world.CreateEntity("Camera3D");
        world.GetTransform3D(cameraEntity).SetPosition(new Vec3(0.0f, 0.0f, 10.0f));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(cameraEntity, camera);
        world.UpdateTransforms();
        return world;
    }

    private sealed class ItemSource : ISceneFrameItemSource
    {
        private readonly SceneRenderItem[] _meshes;
        private readonly SceneSpriteRenderItem[] _sprites;

        public ItemSource(SceneRenderItem[] meshes, SceneSpriteRenderItem[] sprites)
        {
            _meshes = meshes;
            _sprites = sprites;
        }

        public LightingSelectionState? Lighting => null;

        public SceneFogState Fog { get; set; } = SceneFogState.Default;

        public float OutputGamma { get; set; } = 1f;

        public bool EditorPreview { get; set; }

        public ReadOnlySpan<SceneRenderItem> CollectMeshes(SceneAssetId<RenderPassAssetTag> passId) =>
            _meshes;

        public ReadOnlySpan<SceneSpriteRenderItem> CollectSprites(SceneAssetId<RenderPassAssetTag> passId) =>
            _sprites;
    }
}
