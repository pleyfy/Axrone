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

public sealed class SceneGlSkinnedMeshTests
{
    private const int SkinnedStride = 52;

    private const string SkinnableVertexShader = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        layout(location = 2) in vec2 a_Uv;

        uniform mat4 u_Model;
        uniform mat4 u_ViewProjection;

        out vec2 v_Uv;

        void main()
        {
            v_Uv = a_Uv;
            gl_Position = vec4(a_Position, 1.0) * u_Model * u_ViewProjection;
        }
        """;

    private const string FragmentShader = """
        #version 330 core
        in vec2 v_Uv;

        uniform sampler2D u_AlbedoMap;
        uniform sampler2D u_NormalMap;
        uniform float u_Tint;
        uniform vec4 u_Albedo;

        out vec4 fragColor;

        void main()
        {
            fragColor = texture(u_AlbedoMap, v_Uv) * u_Albedo * u_Tint;
        }
        """;

    [Fact]
    public void SkinnedBatchUsesTheMaterialPipeline()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets);
        MaterialAssets materialAssets = RegisterMaterial(assets, skinnable: true);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, materialAssets.MaterialId);
        world.UpdateTransforms();

        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.CreateTranslation(0.25f, 0, 0)]);

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets).Should().Be(1);

        SceneActor lightActor = world.CreateActor("Sun");
        world.AddData(lightActor, SceneDirectionalLight.Default);
        world.UpdateTransforms();
        using var lightingCollector = new SceneLightingCollector(2);
        LightingSelectionState lighting = lightingCollector.Collect(world, frame.Position, Vec3.Zero, Vec3.Zero, Vec3.Zero);

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        int drawCalls = renderer.Render(world, frame, collector.Items, lighting, pass, state);

        drawCalls.Should().Be(1);
        renderer.LastBoneCount.Should().Be(1);
        renderer.SkippedBatches.Should().Be(0);
        state.TrianglesSubmitted.Should().Be(1);

        cache.TryGetMaterial(materialAssets.MaterialId, out SceneGlMaterial? material).Should().BeTrue();
        material!.SkinnedShader.Should().NotBeNull();
        renderer.LastLightingBound.Should().BeTrue();
        renderer.LastTextureSlotCount.Should().Be(2);
        renderer.LastCustomUniformCount.Should().Be(1);
        api.CallLog.Should().Contain("ActiveTexture(33984)");
        api.CallLog.Should().Contain("ActiveTexture(33985)");
        api.CallLog.Should().Contain("ActiveTexture(33999)");
        api.CallLog.Should().Contain("Enable(3042)");
        api.CallLog.Should().Contain("Enable(2884)");
        api.CallLog.Should().Contain(call => call.StartsWith("TexSubImage2D(3553, 0, 0, 0, 4, 1)", StringComparison.Ordinal));
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
    }

    [Fact]
    public void MissingPaletteSkipsTheBatch()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets);
        MaterialAssets material = RegisterMaterial(assets, skinnable: true);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        _ = CreateSkinnedActor(world, mesh, material.MaterialId);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets).Should().Be(1);

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, new SceneBonePaletteStore());
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, collector.Items, null, pass, state).Should().Be(0);
        renderer.SkippedBatches.Should().Be(1);
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
    }

    [Fact]
    public void PaletteAt128And256BonesDrawsAnd257Skips()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets);
        MaterialAssets material = RegisterMaterial(assets, skinnable: true);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material.MaterialId);
        world.UpdateTransforms();

        var palettes = new SceneBonePaletteStore();
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets).Should().Be(1);

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        palettes.ApplyBonePalette(actor, CreatePalette(128));
        renderer.Render(world, frame, collector.Items, null, pass, state).Should().Be(1);
        renderer.LastBoneCount.Should().Be(128);
        api.CallLog.Should().Contain(call => call.StartsWith("TexSubImage2D(3553, 0, 0, 0, 512, 1)", StringComparison.Ordinal));

        palettes.ApplyBonePalette(actor, CreatePalette(SceneGlSkinnedMeshRenderer.MaxBones));
        renderer.Render(world, frame, collector.Items, null, pass, state).Should().Be(1);
        renderer.LastBoneCount.Should().Be(256);
        api.CallLog.Should().Contain(call => call.StartsWith("TexSubImage2D(3553, 0, 0, 0, 1024, 1)", StringComparison.Ordinal));

        palettes.ApplyBonePalette(actor, CreatePalette(SceneGlSkinnedMeshRenderer.MaxBones + 1));
        renderer.Render(world, frame, collector.Items, null, pass, state).Should().Be(0);
        renderer.SkippedBatches.Should().Be(1);
    }

    [Fact]
    public void MeshWithoutSkinAttributesSkipsTheBatch()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterPlainMesh(assets);
        MaterialAssets material = RegisterMaterial(assets, skinnable: true);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material.MaterialId);
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

        renderer.Render(world, frame, collector.Items, null, pass, state).Should().Be(0);
        renderer.SkippedBatches.Should().Be(1);
    }

    [Fact]
    public void MaterialWithoutSkinnableVertexShaderSkipsTheBatch()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets);
        MaterialAssets material = RegisterMaterial(assets, skinnable: false);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material.MaterialId);
        world.UpdateTransforms();

        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.Identity]);

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        cache.TryGetMaterial(material.MaterialId, out SceneGlMaterial? gpuMaterial).Should().BeTrue();
        gpuMaterial!.SkinnedShader.Should().BeNull();
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets);

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, collector.Items, null, pass, state).Should().Be(0);
        renderer.SkippedBatches.Should().Be(1);
    }

    [Fact]
    public void InjectorRewritesPositionReadsOnly()
    {
        bool injected = SkinningShaderInjector.TryInject(SkinnableVertexShader, out string source);

        injected.Should().BeTrue();
        source.Should().Contain("in vec3 a_Position;");
        source.Should().Contain("vec4(ApplySkin(a_Position), 1.0)");
        source.Should().Contain("uniform sampler2D u_SkinBones;");
        source.Should().Contain("layout(location = 6) in ivec4 a_SkinJoints;");
    }

    [Fact]
    public void InjectorRefusesUnsupportedShaders()
    {
        SkinningShaderInjector.TryInject("void main(){}", out _).Should().BeFalse();
        SkinningShaderInjector.TryInject(
            "#version 330 core\nlayout(location = 0) in vec4 a_Position;\nvoid main(){}",
            out _).Should().BeFalse();
        SkinningShaderInjector.TryInject(
            "#version 330 core\nlayout(location = 6) in vec4 a_Custom;\nlayout(location = 0) in vec3 a_Position;\nvoid main(){}",
            out _).Should().BeFalse();
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

        Action render = () => renderer.Render(world, frame, [], null, pass, state);
        render.Should().Throw<SceneDisposedException>();
    }

    private static Mat4[] CreatePalette(int boneCount)
    {
        Mat4[] palette = new Mat4[boneCount];
        for (int i = 0; i < boneCount; i++)
        {
            palette[i] = Mat4.CreateTranslation(i, 0, 0);
        }

        return palette;
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-skinned")))
            .AddTransform3D()
            .AddRendering3D()
            .AddLighting3D()
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

    private static MaterialAssets RegisterMaterial(SceneAssetRegistry assets, bool skinnable)
    {
        SceneAssetId<TextureAssetTag> albedo = RegisterTexture(assets, "texture/albedo");
        SceneAssetId<TextureAssetTag> normal = RegisterTexture(assets, "texture/normal");
        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("shader/skinned");
        assets.Shaders.Register(new SceneShaderDefinition(
            shaderId,
            skinnable ? SkinnableVertexShader : "void main(){}",
            FragmentShader));

        var surface = new SceneMaterialSurface
        {
            AlbedoMap = new SceneMaterialTextureBinding(albedo),
            NormalMap = new SceneMaterialTextureBinding(normal)
        };
        SceneMaterialPass[] passes = [new SceneMaterialPass("main", blend: true, cull: true)];
        var uniforms = new Dictionary<string, SceneUniformValue>
        {
            ["u_Tint"] = SceneUniformValue.FromFloat(3.5f)
        };
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/skinned");
        assets.Materials.Register(new SceneMaterialDefinition(materialId, shaderId, surface, passes, uniforms));
        return new MaterialAssets(materialId);
    }

    private static SceneAssetId<TextureAssetTag> RegisterTexture(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<TextureAssetTag> id = assets.CreateId<TextureAssetTag>(name);
        assets.Textures.Register(new SceneTextureDefinition(id, new SceneTextureColor(Vec4.One, 8, 8)));
        return id;
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

    private readonly record struct MaterialAssets(SceneAssetId<MaterialAssetTag> MaterialId);
}
