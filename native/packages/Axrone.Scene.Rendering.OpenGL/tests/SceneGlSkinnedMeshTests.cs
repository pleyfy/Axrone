namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlSkinnedMeshTests
{
    private const int SkinnedStride = 52;

    [Fact]
    public void SkinnedBatchUploadsPaletteAndDraws()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();

        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.CreateTranslation(0.25f, 0, 0)]);

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets).Should().Be(1);

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        int drawCalls = renderer.Render(world, frame, collector.Items, pass, state);

        drawCalls.Should().Be(1);
        renderer.LastDrawCalls.Should().Be(1);
        renderer.LastBoneCount.Should().Be(1);
        renderer.SkippedBatches.Should().Be(0);
        state.TrianglesSubmitted.Should().Be(1);
        api.CallLog.Should().Contain(call => call.StartsWith("UniformMatrix4(", StringComparison.Ordinal));
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
    }

    [Fact]
    public void MissingPaletteSkipsTheBatch()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets).Should().Be(1);

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, new SceneBonePaletteStore());
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, state).Should().Be(0);
        renderer.SkippedBatches.Should().Be(1);
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
        _ = actor;
    }

    [Fact]
    public void OversizedPaletteSkipsTheBatch()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();

        var palettes = new SceneBonePaletteStore();
        Mat4[] bones = new Mat4[SceneGlSkinnedMeshRenderer.MaxBones + 1];
        Array.Fill(bones, Mat4.Identity);
        palettes.ApplyBonePalette(actor, bones);

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets);

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, state).Should().Be(0);
        renderer.SkippedBatches.Should().Be(1);
    }

    [Fact]
    public void MeshWithoutSkinAttributesSkipsTheBatch()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterPlainMesh(assets);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();

        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.Identity]);

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets);

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, state).Should().Be(0);
        renderer.SkippedBatches.Should().Be(1);
    }

    [Fact]
    public void DisposeIsIdempotentAndRejectsRendering()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        using var cache = new SceneGlAssetCache(context, assets);
        var renderer = new SceneGlSkinnedMeshRenderer(context, cache, new SceneBonePaletteStore());

        renderer.Dispose();
        renderer.Dispose();

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        var pass = new SceneRenderPassDefinition(SceneRenderPassIds.Main, clearMask: SceneClearMask.None);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        Action render = () => renderer.Render(world, frame, [], pass, state);
        render.Should().Throw<SceneDisposedException>();
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-skinned")))
            .AddTransform3D()
            .AddRendering3D()
            .AddSceneRenderables(SceneRenderableFeatures.SkinnedMesh)
            .Build()
            .CreateWorld();

    private static SceneCameraFrame CreateCameraFrame(SceneWorld world)
    {
        SceneActor actor = world.CreateActor("Camera");
        world.GetTransform3D(actor).SetPosition(new Vec3(0, 0, 10));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(actor, camera);
        world.UpdateTransforms();
        return new SceneCameraFrameCollector().Collect(world, actor, 800, 600)!;
    }

    private static SceneActor CreateSkinnedActor(
        SceneWorld world,
        SceneAssetId<MeshAssetTag> mesh,
        SceneAssetId<MaterialAssetTag> material)
    {
        SceneActor actor = world.CreateActor("Skinned");
        SceneSkinnedMeshRenderer renderer = SceneSkinnedMeshRenderer.Default;
        renderer.MeshId = mesh;
        renderer.MaterialId = material;
        world.AddData(actor, renderer);
        return actor;
    }

    private static SceneAssetId<MeshAssetTag> RegisterSkinnedMesh(SceneAssetRegistry assets)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("mesh/skinned");
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, SkinnedStride),
            new SceneVertexAttribute(SceneMeshSemantic.Uv0, 2, 12, SkinnedStride),
            new SceneVertexAttribute(SceneMeshSemantic.Joints0, 4, 20, SkinnedStride, integer: true),
            new SceneVertexAttribute(SceneMeshSemantic.Weights0, 4, 36, SkinnedStride)
        ];
        assets.Meshes.Register(new SceneMeshDefinition(
            id,
            new byte[3 * SkinnedStride],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));
        return id;
    }

    private static SceneAssetId<MeshAssetTag> RegisterPlainMesh(SceneAssetRegistry assets)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("mesh/plain");
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)
        ];
        assets.Meshes.Register(new SceneMeshDefinition(
            id,
            new byte[36],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));
        return id;
    }

    private static SceneAssetId<MaterialAssetTag> RegisterMaterial(SceneAssetRegistry assets)
    {
        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("shader/skinned");
        assets.Shaders.Register(new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}"));
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/skinned");
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
}
