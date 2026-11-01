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

public sealed class SceneSkinningHardeningTests
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
        uniform float u_Tint;

        out vec4 fragColor;

        void main()
        {
            fragColor = texture(u_AlbedoMap, v_Uv) * u_Tint;
        }
        """;

    [Fact]
    public void InjectionDiagnosticsReportExactReasons()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<ShaderAssetTag> valid = RegisterShader(assets, "shader/valid", SkinnableVertexShader);
        SceneAssetId<ShaderAssetTag> noVersion = RegisterShader(assets, "shader/no-version", "void main(){}");
        SceneAssetId<ShaderAssetTag> vec4Position = RegisterShader(
            assets,
            "shader/vec4",
            "#version 330 core\nlayout(location = 0) in vec4 a_Position;\nvoid main(){}");
        SceneAssetId<ShaderAssetTag> locationSix = RegisterShader(
            assets,
            "shader/six",
            "#version 330 core\nlayout(location = 6) in vec4 a_Custom;\nlayout(location = 0) in vec3 a_Position;\nvoid main(){}");
        SceneAssetId<ShaderAssetTag> locationSeven = RegisterShader(
            assets,
            "shader/seven",
            "#version 330 core\nlayout(location=7) in vec4 a_Custom;\nlayout(location=0) in vec3 a_Position;\nvoid main(){}");
        SceneAssetId<ShaderAssetTag> existing = RegisterShader(
            assets,
            "shader/existing",
            "#version 330 core\nlayout(location = 0) in vec3 a_Position;\nin vec4 a_SkinJoints;\nvoid main(){}");

        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();

        cache.TryGetSkinnedShader(valid, out _).Should().BeTrue();
        cache.TryGetSkinningDiagnostic(valid, out SkinningShaderDiagnostic validDiagnostic).Should().BeTrue();
        validDiagnostic.Skinned.Should().BeTrue();
        validDiagnostic.Failure.Should().Be(SkinningInjectionFailure.None);

        AssertFailure(cache, noVersion, SkinningInjectionFailure.MissingVersionDirective);
        AssertFailure(cache, vec4Position, SkinningInjectionFailure.MissingPositionAttribute);
        AssertFailure(cache, locationSix, SkinningInjectionFailure.AttributeLocationConflict);
        AssertFailure(cache, locationSeven, SkinningInjectionFailure.AttributeLocationConflict);
        AssertFailure(cache, existing, SkinningInjectionFailure.ExistingSkinningDeclarations);
        cache.UnskinnableShaderCount.Should().Be(5);
    }

    [Fact]
    public void UnskinnableMaterialProducesVisibleDiagnostic()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets, "mesh/skinned");
        _ = RegisterShader(assets, "shader/unsupported", "void main(){}");
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets, "shader/unsupported");
        SceneRenderPassDefinition pass = RegisterPass(assets);
        using var world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();
        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.Identity]);
        SceneSkinnedMeshRenderItem[] items = Collect(world, frame, assets).ToArray();

        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, items, null, pass, state).Should().Be(0);
        renderer.Diagnostics.UnskinnableMaterial.Should().Be(1);
        renderer.Diagnostics.SkippedBatches.Should().Be(1);
        renderer.LastFailure.Should().Be(SceneSkinningFailureReason.UnskinnableMaterial);
        cache.TryGetSkinningDiagnostic(SceneAssetId<ShaderAssetTag>.FromSymbol(assets.Names.Intern("shader/unsupported")), out SkinningShaderDiagnostic diagnostic).Should().BeTrue();
        diagnostic.Failure.Should().Be(SkinningInjectionFailure.MissingVersionDirective);
        _ = api;
    }

    [Fact]
    public void ConfiguredBoneBudgetSkipsOverflowAndCountsIt()
    {
        (MockGLApi api, GLContext context) = CreateContext(logging: true);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets, "mesh/skinned");
        _ = RegisterShader(assets, "shader/budget", SkinnableVertexShader);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets, "shader/budget");
        SceneRenderPassDefinition pass = RegisterPass(assets);
        using var world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();
        var palettes = new SceneBonePaletteStore();
        SceneSkinnedMeshRenderItem[] items = Collect(world, frame, assets).ToArray();
        using var renderer = new SceneGlSkinnedMeshRenderer(
            context,
            cache,
            palettes,
            new SceneSkinningOptions { MaxBones = 64 });
        var state = new SceneRenderFrameState();
        state.Begin(0);

        palettes.ApplyBonePalette(actor, CreatePalette(65));
        renderer.Render(world, frame, items, null, pass, state).Should().Be(0);
        renderer.Diagnostics.PaletteOverflow.Should().Be(1);
        renderer.LastFailure.Should().Be(SceneSkinningFailureReason.PaletteOverflow);

        palettes.ApplyBonePalette(actor, CreatePalette(64));
        renderer.Render(world, frame, items, null, pass, state).Should().Be(1);
        renderer.LastBoneCount.Should().Be(64);
        renderer.Options.MaxBones.Should().Be(64);
        api.CallLog.Should().Contain(call => call.StartsWith("TexSubImage2D(3553, 0, 0, 0, 256, 1)", StringComparison.Ordinal));
    }

    [Fact]
    public void ThrowModeFailsOnPaletteOverflow()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets, "mesh/skinned");
        _ = RegisterShader(assets, "shader/throw", SkinnableVertexShader);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets, "shader/throw");
        SceneRenderPassDefinition pass = RegisterPass(assets);
        using var world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();
        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();
        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, CreatePalette(3));
        SceneSkinnedMeshRenderItem[] items = Collect(world, frame, assets).ToArray();
        using var renderer = new SceneGlSkinnedMeshRenderer(
            context,
            cache,
            palettes,
            new SceneSkinningOptions { MaxBones = 2, FailureMode = SceneSkinningFailureMode.Throw });
        var state = new SceneRenderFrameState();
        state.Begin(0);

        Action render = () => renderer.Render(world, frame, items, null, pass, state);
        render.Should().Throw<SceneConfigurationException>().WithMessage("*PaletteOverflow*");
        renderer.Diagnostics.PaletteOverflow.Should().Be(1);
        _ = api;
    }

    [Fact]
    public void ThrowModeFailsOnMissingPalette()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets, "mesh/skinned");
        _ = RegisterShader(assets, "shader/missing-palette", SkinnableVertexShader);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets, "shader/missing-palette");
        SceneRenderPassDefinition pass = RegisterPass(assets);
        using var world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        _ = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();
        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();
        SceneSkinnedMeshRenderItem[] items = Collect(world, frame, assets).ToArray();
        using var renderer = new SceneGlSkinnedMeshRenderer(
            context,
            cache,
            new SceneBonePaletteStore(),
            new SceneSkinningOptions { FailureMode = SceneSkinningFailureMode.Throw });
        var state = new SceneRenderFrameState();
        state.Begin(0);

        Action render = () => renderer.Render(world, frame, items, null, pass, state);
        render.Should().Throw<SceneConfigurationException>().WithMessage("*MissingPalette*");
        renderer.Diagnostics.MissingPalette.Should().Be(1);
        _ = api;
    }

    [Fact]
    public void TextureUnitConflictFailsFastEvenInSkipMode()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets, "mesh/skinned");
        _ = RegisterShader(assets, "shader/unit", SkinnableVertexShader);
        SceneAssetId<TextureAssetTag> albedo = RegisterTexture(assets, "texture/unit");
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets, "shader/unit", albedo, albedoUnit: 3);
        SceneRenderPassDefinition pass = RegisterPass(assets);
        using var world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();
        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();
        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.Identity]);
        SceneSkinnedMeshRenderItem[] items = Collect(world, frame, assets).ToArray();
        using var renderer = new SceneGlSkinnedMeshRenderer(
            context,
            cache,
            palettes,
            new SceneSkinningOptions { TextureUnit = 3, FailureMode = SceneSkinningFailureMode.Skip });
        var state = new SceneRenderFrameState();
        state.Begin(0);

        Action render = () => renderer.Render(world, frame, items, null, pass, state);
        render.Should().Throw<SceneConfigurationException>().WithMessage("*reserved skinning texture unit 3*");
        renderer.Diagnostics.TextureUnitConflict.Should().Be(1);
        renderer.LastFailure.Should().Be(SceneSkinningFailureReason.TextureUnitConflict);
        _ = api;
    }

    [Fact]
    public void ConfiguredTextureUnitIsUsedForBonePalette()
    {
        (MockGLApi api, GLContext context) = CreateContext(logging: true);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets, "mesh/skinned");
        _ = RegisterShader(assets, "shader/unit-ok", SkinnableVertexShader);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets, "shader/unit-ok");
        SceneRenderPassDefinition pass = RegisterPass(assets);
        using var world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();
        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();
        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.Identity]);
        SceneSkinnedMeshRenderItem[] items = Collect(world, frame, assets).ToArray();
        using var renderer = new SceneGlSkinnedMeshRenderer(
            context,
            cache,
            palettes,
            new SceneSkinningOptions { TextureUnit = 3 });
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, items, null, pass, state).Should().Be(1);
        api.CallLog.Should().Contain("ActiveTexture(33987)");
        api.CallLog.Should().Contain(call => call.StartsWith("BindTexture(3553,", StringComparison.Ordinal));
    }

    [Fact]
    public void InvalidOptionsAreRejected()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        var assets = new SceneAssetRegistry();
        using var cache = new SceneGlAssetCache(context, assets);
        var palettes = new SceneBonePaletteStore();

        Action zero = () => _ = new SceneGlSkinnedMeshRenderer(
            context, cache, palettes, new SceneSkinningOptions { MaxBones = 0 });
        Action negativeUnit = () => _ = new SceneGlSkinnedMeshRenderer(
            context, cache, palettes, new SceneSkinningOptions { TextureUnit = -1 });
        Action highUnit = () => _ = new SceneGlSkinnedMeshRenderer(
            context, cache, palettes, new SceneSkinningOptions { TextureUnit = 32 });
        Action hugeBones = () => _ = new SceneGlSkinnedMeshRenderer(
            context, cache, palettes, new SceneSkinningOptions { MaxBones = 5000 });

        zero.Should().Throw<SceneConfigurationException>();
        negativeUnit.Should().Throw<SceneConfigurationException>();
        highUnit.Should().Throw<SceneConfigurationException>();
        hugeBones.Should().Throw<SceneConfigurationException>();
        _ = api;
    }

    [Fact]
    public void MissingMeshMaterialAndSkinAttributesAreCounted()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> plainMesh = RegisterPlainMesh(assets, "mesh/plain");
        _ = RegisterShader(assets, "shader/counters", SkinnableVertexShader);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets, "shader/counters");
        SceneRenderPassDefinition pass = RegisterPass(assets);
        using var world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        world.UpdateTransforms();
        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();
        var state = new SceneRenderFrameState();
        state.Begin(0);
        var item = new SceneSkinnedMeshRenderItem
        {
            Actor = world.CreateActor("Ghost"),
            MeshId = SceneAssetId<MeshAssetTag>.FromName("mesh/ghost"),
            MaterialId = material
        };
        using var missingMeshRenderer = new SceneGlSkinnedMeshRenderer(context, cache, new SceneBonePaletteStore());
        missingMeshRenderer.Render(world, frame, [item], null, pass, state).Should().Be(0);
        missingMeshRenderer.Diagnostics.MissingMesh.Should().Be(1);

        SceneSkinnedMeshRenderItem materialItem = item;
        materialItem.MeshId = plainMesh;
        materialItem.MaterialId = SceneAssetId<MaterialAssetTag>.FromName("material/missing");
        using var missingMaterialRenderer = new SceneGlSkinnedMeshRenderer(context, cache, new SceneBonePaletteStore());
        missingMaterialRenderer.Render(world, frame, [materialItem], null, pass, state).Should().Be(0);
        missingMaterialRenderer.Diagnostics.MissingMaterial.Should().Be(1);

        SceneActor actor = CreateSkinnedActor(world, plainMesh, material);
        world.UpdateTransforms();
        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.Identity]);
        SceneSkinnedMeshRenderItem[] items = Collect(world, frame, assets).ToArray();
        using var skinAttributeRenderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        skinAttributeRenderer.Render(world, frame, items, null, pass, state).Should().Be(0);
        skinAttributeRenderer.Diagnostics.MissingSkinAttributes.Should().Be(1);
        _ = api;
    }

    [Fact]
    public void DiagnosticsAreDeterministicAndResetBetweenFrames()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterSkinnedMesh(assets, "mesh/skinned");
        _ = RegisterShader(assets, "shader/deterministic", SkinnableVertexShader);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets, "shader/deterministic");
        SceneRenderPassDefinition pass = RegisterPass(assets);
        using var world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = CreateSkinnedActor(world, mesh, material);
        world.UpdateTransforms();
        using var cache = new SceneGlAssetCache(context, assets);
        _ = cache.UploadAll();
        var palettes = new SceneBonePaletteStore();
        palettes.ApplyBonePalette(actor, [Mat4.Identity]);
        SceneSkinnedMeshRenderItem[] items = Collect(world, frame, assets).ToArray();
        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, palettes);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, items, null, pass, state).Should().Be(1);
        SceneSkinningDiagnostics first = renderer.Diagnostics;
        renderer.Render(world, frame, items, null, pass, state).Should().Be(1);
        SceneSkinningDiagnostics second = renderer.Diagnostics;

        second.Should().Be(first);
        first.DrawnBatches.Should().Be(1);
        first.SkippedBatches.Should().Be(0);
        first.LastFailure.Should().Be(SceneSkinningFailureReason.None);
        _ = api;
    }

    [Fact]
    public void EmptyRenderIsZeroAllocationAfterWarmup()
    {
        (MockGLApi api, GLContext context) = CreateContext();
        var assets = new SceneAssetRegistry();
        using var cache = new SceneGlAssetCache(context, assets);
        using var renderer = new SceneGlSkinnedMeshRenderer(context, cache, new SceneBonePaletteStore());
        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        var pass = new SceneRenderPassDefinition(SceneRenderPassIds.Main, clearMask: SceneClearMask.None);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.Render(world, frame, [], null, pass, state);
        renderer.Render(world, frame, [], null, pass, state);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++)
        {
            renderer.Render(world, frame, [], null, pass, state);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
        _ = api;
    }

    private static void AssertFailure(
        SceneGlAssetCache cache,
        SceneAssetId<ShaderAssetTag> shader,
        SkinningInjectionFailure expected)
    {
        cache.TryGetSkinnedShader(shader, out _).Should().BeFalse();
        cache.TryGetSkinningDiagnostic(shader, out SkinningShaderDiagnostic diagnostic).Should().BeTrue();
        diagnostic.Shader.Should().Be(shader);
        diagnostic.Skinned.Should().BeFalse();
        diagnostic.Failure.Should().Be(expected);
    }

    private static (MockGLApi Api, GLContext Context) CreateContext(bool logging = false)
    {
        var api = new MockGLApi { EnableCallLogging = logging };
        return (api, new GLContext(api));
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

    private static ReadOnlySpan<SceneSkinnedMeshRenderItem> Collect(
        SceneWorld world,
        SceneCameraFrame frame,
        SceneAssetRegistry assets)
    {
        var collector = new SceneSkinnedMeshItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main, assets);
        return collector.Items;
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/skinning-hardening")))
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

    private static SceneAssetId<ShaderAssetTag> RegisterShader(
        SceneAssetRegistry assets,
        string name,
        string vertexSource)
    {
        SceneAssetId<ShaderAssetTag> id = assets.CreateId<ShaderAssetTag>(name);
        assets.Shaders.Register(new SceneShaderDefinition(id, vertexSource, FragmentShader));
        return id;
    }

    private static SceneAssetId<MeshAssetTag> RegisterSkinnedMesh(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>(name);
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

    private static SceneAssetId<MeshAssetTag> RegisterPlainMesh(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>(name);
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

    private static SceneAssetId<MaterialAssetTag> RegisterMaterial(
        SceneAssetRegistry assets,
        string shaderName,
        SceneAssetId<TextureAssetTag>? albedo = null,
        int? albedoUnit = null)
    {
        SceneAssetId<ShaderAssetTag> shaderId = SceneAssetId<ShaderAssetTag>.FromSymbol(assets.Names.Intern(shaderName));
        var surface = new SceneMaterialSurface();
        if (albedo is { } texture)
        {
            surface = new SceneMaterialSurface
            {
                AlbedoMap = new SceneMaterialTextureBinding(texture, unit: albedoUnit)
            };
        }

        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>($"material/{shaderName}");
        assets.Materials.Register(new SceneMaterialDefinition(materialId, shaderId, surface));
        return materialId;
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
}
