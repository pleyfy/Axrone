namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneMaterialShaderCompositionTests
{
    private const string PbrFragmentSource = """
        #version 330 core
        in vec2 v_UV0;
        uniform vec4 u_Albedo;
        uniform sampler2D u_AlbedoMap;
        out vec4 o_FragColor;
        void main()
        {
            o_FragColor = u_Albedo * texture(u_AlbedoMap, v_UV0);
        }
        """;

    private const string PbrVertexSource = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        void main()
        {
            gl_Position = vec4(a_Position, 1.0);
        }
        """;

    [Fact]
    public void CacheCompilesMaterialExtensionContractIntoPbrSource()
    {
        using var fixture = new SceneGlFixture();
        var definition = new SceneShaderDefinition(
            fixture.Assets.CreateId<ShaderAssetTag>("test/pbr-extensions"),
            PbrVertexSource,
            PbrFragmentSource);
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);

        SceneGlShader shader = cache.RegisterShader(definition);
        string compiled = shader.Program.FragmentSource;

        compiled.Should().StartWith("#version 330 core");
        compiled.Should().Contain(SceneGlMaterialShaderComposer.Marker);
        compiled.Should().Contain("uniform sampler2D u_ClearcoatMap;");
        compiled.Should().Contain("uniform sampler2D u_ClearcoatRoughnessMap;");
        compiled.Should().Contain("uniform sampler2D u_ClearcoatNormalMap;");
        compiled.Should().Contain("uniform sampler2D u_SheenColorMap;");
        compiled.Should().Contain("uniform sampler2D u_SheenRoughnessMap;");
        compiled.Should().Contain("uniform sampler2D u_TransmissionMap;");
        compiled.Should().Contain("uniform sampler2D u_IridescenceMap;");
        compiled.Should().Contain("uniform sampler2D u_IridescenceThicknessMap;");
        compiled.Should().Contain("uniform sampler2D u_SubsurfaceMap;");
        compiled.Should().Contain("uniform int u_ClearcoatEnabled;");
        compiled.Should().Contain("ClearcoatWeight(");
        compiled.Should().Contain("TransmissionWeight(");
        compiled.Should().Contain("void main()");
        compiled.Should().Be(SceneGlMaterialShaderComposer.ComposeFragmentSource(PbrFragmentSource));

        cache.TryGetSkinnedShader(definition.Id, out SceneGlShader? skinned).Should().BeTrue();
        skinned!.Program.FragmentSource.Should().Contain(SceneGlMaterialShaderComposer.Marker);
        skinned.Program.FragmentSource.Should().Contain("uniform sampler2D u_TransmissionMap;");
    }

    [Fact]
    public void CompositionIsIdempotent()
    {
        string composed = SceneGlMaterialShaderComposer.ComposeFragmentSource(PbrFragmentSource);
        string recomposed = SceneGlMaterialShaderComposer.ComposeFragmentSource(composed);

        recomposed.Should().Be(composed);
        CountOccurrences(composed, SceneGlMaterialShaderComposer.Marker).Should().Be(1);
        SceneGlMaterialShaderComposer.IsComposed(composed).Should().BeTrue();
        SceneGlMaterialShaderComposer.IsComposed(PbrFragmentSource).Should().BeFalse();
    }

    [Fact]
    public void CompositionSkipsUnsupportedAndCustomSources()
    {
        const string customShader = """
            #version 330 core
            uniform vec4 u_Color;
            out vec4 o_FragColor;
            void main() { o_FragColor = u_Color; }
            """;
        const string unversioned = """
            uniform vec4 u_Albedo;
            void main() { gl_FragColor = u_Albedo; }
            """;
        const string esShader = """
            #version 300 es
            precision mediump float;
            uniform vec4 u_Albedo;
            out vec4 o_FragColor;
            void main() { o_FragColor = u_Albedo; }
            """;
        const string existingExtensionShader = """
            #version 330 core
            uniform vec4 u_Albedo;
            uniform sampler2D u_ClearcoatMap;
            out vec4 o_FragColor;
            void main() { o_FragColor = u_Albedo + texture(u_ClearcoatMap, vec2(0.0)); }
            """;

        SceneGlMaterialShaderComposer.ComposeFragmentSource(customShader).Should().Be(customShader);
        SceneGlMaterialShaderComposer.ComposeFragmentSource(unversioned).Should().Be(unversioned);
        SceneGlMaterialShaderComposer.ComposeFragmentSource(esShader).Should().Be(esShader);
        SceneGlMaterialShaderComposer.ComposeFragmentSource(existingExtensionShader).Should().Be(existingExtensionShader);
    }

    [Fact]
    public void FeatureDisabledSkipsExtensionSamplerBinding()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(fixture.Assets, "texture/feature-off");
        var binding = new SceneMaterialTextureBinding(texture);
        var surface = new SceneMaterialSurface
        {
            Features = SceneMaterialFeatures.None,
            ClearcoatMap = binding,
            SheenColorMap = binding,
            TransmissionMap = binding,
            IridescenceMap = binding,
            SubsurfaceMap = binding
        };
        SceneAssetId<MaterialAssetTag> materialId = fixture.Assets.CreateId<MaterialAssetTag>("material/feature-off");
        fixture.Assets.Materials.Register(new SceneMaterialDefinition(materialId, fixture.Shader.Id, surface));

        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        cache.TryGetMaterial(materialId, out SceneGlMaterial? material).Should().BeTrue();
        material!.TextureSlots.Length.Should().Be(0);

        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out SceneActor rendererActor);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 320, 180)!;
        SceneRenderItem item = fixture.CreateItem(rendererActor);
        item.MaterialId = materialId;
        var executor = new SceneGlDrawExecutor(fixture.Context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);
        SceneRenderPassDefinition pass = new(fixture.Assets.CreateId<RenderPassAssetTag>("main"), clearMask: SceneClearMask.None);

        executor.Render(world, frame, [item], lighting: null, pass, state).Should().Be(1);

        fixture.Api.CallLog.Should().NotContain("ActiveTexture(33989)");
        fixture.Api.CallLog.Should().NotContain(entry => entry.StartsWith("BindSampler(5,", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(14)]
    [InlineData(15)]
    [InlineData(16)]
    public void ExtensionUnitsRejectReservedAndOverflow(int unit)
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(fixture.Assets, "texture/unit-guard");
        var surface = new SceneMaterialSurface
        {
            Features = SceneMaterialFeatures.Clearcoat,
            ClearcoatMap = new SceneMaterialTextureBinding(texture, unit: unit),
            Extensions = new SceneMaterialExtensions { Clearcoat = 0.5f }
        };
        SceneAssetId<MaterialAssetTag> materialId = fixture.Assets.CreateId<MaterialAssetTag>($"material/unit-{unit}");
        fixture.Assets.Materials.Register(new SceneMaterialDefinition(materialId, fixture.Shader.Id, surface));
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);

        Action upload = () => { _ = cache.UploadAll(); };

        upload.Should().Throw<SceneAssetException>().WithMessage($"*texture unit {unit}*");
    }

    [Fact]
    public void BaseMapUnitsRejectReservedSkinningUnit()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(fixture.Assets, "texture/base-unit-guard");
        var surface = new SceneMaterialSurface
        {
            AlbedoMap = new SceneMaterialTextureBinding(texture, unit: SceneGlTextureUnits.Skinning)
        };
        SceneAssetId<MaterialAssetTag> materialId = fixture.Assets.CreateId<MaterialAssetTag>("material/base-unit-guard");
        fixture.Assets.Materials.Register(new SceneMaterialDefinition(materialId, fixture.Shader.Id, surface));
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);

        Action upload = () => { _ = cache.UploadAll(); };

        upload.Should().Throw<SceneAssetException>()
            .WithMessage($"*reserved texture unit {SceneGlTextureUnits.Skinning}*");
    }

    [Fact]
    public void DuplicateExtensionUnitsFailFast()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(fixture.Assets, "texture/duplicate-unit");
        var surface = new SceneMaterialSurface
        {
            Features = SceneMaterialFeatures.Clearcoat,
            ClearcoatMap = new SceneMaterialTextureBinding(texture, unit: 5),
            ClearcoatRoughnessMap = new SceneMaterialTextureBinding(texture, unit: 5),
            Extensions = new SceneMaterialExtensions { Clearcoat = 0.5f }
        };
        SceneAssetId<MaterialAssetTag> materialId = fixture.Assets.CreateId<MaterialAssetTag>("material/duplicate-unit");
        fixture.Assets.Materials.Register(new SceneMaterialDefinition(materialId, fixture.Shader.Id, surface));
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);

        Action upload = () => { _ = cache.UploadAll(); };

        upload.Should().Throw<SceneAssetException>().WithMessage("*same texture unit 5*");
    }

    [Fact]
    public void OpaqueMaterialEmitsNoBlendCalls()
    {
        using var fixture = new SceneGlFixture();
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out SceneActor rendererActor);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 320, 180)!;
        SceneRenderItem item = fixture.CreateItem(rendererActor);
        var executor = new SceneGlDrawExecutor(fixture.Context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);
        SceneRenderPassDefinition pass = new(fixture.Assets.CreateId<RenderPassAssetTag>("main"), clearMask: SceneClearMask.None);

        executor.Render(world, frame, [item], lighting: null, pass, state).Should().Be(1);

        fixture.Api.CallLog.Should().NotContain("Enable(3042)");
        fixture.Api.CallLog.Should().NotContain(entry => entry.StartsWith("BlendFuncSeparate(", StringComparison.Ordinal));
        fixture.Api.CallLog.Should().NotContain(entry => entry.StartsWith("BlendEquationSeparate(", StringComparison.Ordinal));
    }

    private static int CountOccurrences(string source, string value)
    {
        int count = 0;
        int index = 0;
        while ((index = source.IndexOf(value, index, StringComparison.Ordinal)) >= 0)
        {
            count++;
            index += value.Length;
        }

        return count;
    }

    private static SceneAssetId<TextureAssetTag> RegisterTexture(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<TextureAssetTag> id = assets.CreateId<TextureAssetTag>(name);
        assets.Textures.Register(new SceneTextureDefinition(id, new SceneTextureColor(Vec4.One, 8, 8)));
        return id;
    }
}
