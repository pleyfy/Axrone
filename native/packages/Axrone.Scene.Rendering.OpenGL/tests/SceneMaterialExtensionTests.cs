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

public sealed class SceneMaterialExtensionTests
{
    private const string VertexShader = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        uniform mat4 u_Model;
        uniform mat4 u_ViewProjection;
        void main()
        {
            gl_Position = vec4(a_Position, 1.0) * u_Model * u_ViewProjection;
        }
        """;

    private const string FragmentShader = """
        #version 330 core
        uniform sampler2D u_AlbedoMap;
        out vec4 fragColor;
        void main()
        {
            fragColor = texture(u_AlbedoMap, vec2(0.0));
        }
        """;

    [Fact]
    public void ExtensionMapsReceiveDedicatedUnits()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(fixture.Assets, "texture/extension");
        SceneAssetId<MaterialAssetTag> materialId = RegisterExtensionMaterial(
            fixture,
            texture,
            SceneMaterialFeatures.Clearcoat | SceneMaterialFeatures.Sheen |
            SceneMaterialFeatures.Transmission | SceneMaterialFeatures.Iridescence |
            SceneMaterialFeatures.Subsurface);

        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        cache.TryGetMaterial(materialId, out SceneGlMaterial? material).Should().BeTrue();

        ReadOnlySpan<SceneGlTextureSlot> slots = material!.TextureSlots.Span;
        slots.Length.Should().Be(9);
        slots[0].UniformName.Should().Be("u_ClearcoatMap");
        slots[0].Unit.Should().Be(5);
        slots[2].UniformName.Should().Be("u_ClearcoatNormalMap");
        slots[2].Unit.Should().Be(7);
        slots[3].UniformName.Should().Be("u_SheenColorMap");
        slots[3].Unit.Should().Be(8);
        slots[5].UniformName.Should().Be("u_TransmissionMap");
        slots[5].Unit.Should().Be(10);
        slots[6].UniformName.Should().Be("u_IridescenceMap");
        slots[6].Unit.Should().Be(11);
        slots[8].UniformName.Should().Be("u_SubsurfaceMap");
        slots[8].Unit.Should().Be(13);
    }

    [Fact]
    public void DisabledFeaturesDoNotAllocateMapUnits()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(fixture.Assets, "texture/disabled");
        SceneAssetId<MaterialAssetTag> materialId = RegisterMaterialWithMaps(
            fixture,
            texture,
            SceneMaterialFeatures.None,
            extensions: null);

        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        cache.TryGetMaterial(materialId, out SceneGlMaterial? material).Should().BeTrue();
        material!.TextureSlots.Length.Should().Be(0);
    }

    [Fact]
    public void BinderReportsFeaturesAndMissingMapsSafely()
    {
        using var fixture = new SceneGlFixture();
        using var shader = new SceneGlShader(
            fixture.Context,
            "extension-binding",
            VertexShader,
            "#version 330 core\nout vec4 c;\nvoid main(){c=vec4(1);}\n" + SceneGlShaderSnippets.MaterialExtensions);

        var surface = new SceneMaterialSurface
        {
            Features = SceneMaterialFeatures.Clearcoat | SceneMaterialFeatures.Transmission,
            ClearcoatMap = new SceneMaterialTextureBinding(
                SceneAssetId<TextureAssetTag>.FromName("texture/binder")),
            Extensions = new SceneMaterialExtensions
            {
                Clearcoat = 0.75f,
                ClearcoatRoughness = 0.25f,
                Transmission = 0.5f,
                Ior = 1.4f,
                Thickness = 2.0f
            }
        };

        SceneMaterialExtensionBindings bindings = SceneGlMaterialExtensionBinder.Bind(shader, surface);

        bindings.Clearcoat.Should().BeTrue();
        bindings.Transmission.Should().BeTrue();
        bindings.Sheen.Should().BeFalse();
        bindings.HasClearcoatMap.Should().BeTrue();
        bindings.HasTransmissionMap.Should().BeFalse();
        bindings.Should().Be(SceneGlMaterialExtensionBinder.Bind(shader, surface));

        var bare = new SceneMaterialSurface { Features = SceneMaterialFeatures.Subsurface };
        SceneMaterialExtensionBindings bareBindings = SceneGlMaterialExtensionBinder.Bind(shader, bare);
        bareBindings.Subsurface.Should().BeTrue();
        bareBindings.HasSubsurfaceMap.Should().BeFalse();
        bareBindings.Clearcoat.Should().BeFalse();
    }

    [Fact]
    public void ExtensionBindingIsZeroAllocation()
    {
        using var fixture = new SceneGlFixture();
        using var shader = new SceneGlShader(
            fixture.Context,
            "extension-zero",
            VertexShader,
            "#version 330 core\nout vec4 c;\nvoid main(){c=vec4(1);}\n" + SceneGlShaderSnippets.MaterialExtensions);
        var surface = new SceneMaterialSurface
        {
            Features = SceneMaterialFeatures.Clearcoat | SceneMaterialFeatures.Sheen |
                SceneMaterialFeatures.Transmission | SceneMaterialFeatures.Iridescence |
                SceneMaterialFeatures.Subsurface,
            Extensions = new SceneMaterialExtensions
            {
                Clearcoat = 0.5f,
                SheenColor = new Vec3(0.2f, 0.3f, 0.4f),
                Transmission = 0.6f,
                Iridescence = 0.7f,
                Subsurface = 0.8f
            }
        };

        _ = SceneGlMaterialExtensionBinder.Bind(shader, surface);
        _ = SceneGlMaterialExtensionBinder.Bind(shader, surface);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 256; i++)
        {
            _ = SceneGlMaterialExtensionBinder.Bind(shader, surface);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
    }

    [Fact]
    public void ExtensionSnippetGatesMapSamplingOnFeatureAndMapFlags()
    {
        const string snippet = SceneGlShaderSnippets.MaterialExtensions;

        snippet.Should().Contain(
            "u_HasClearcoatMap != 0 ? u_Clearcoat * texture(u_ClearcoatMap, uv).r : u_Clearcoat");
        snippet.Should().Contain("if (u_SheenEnabled == 0) return vec3(0.0);");
        snippet.Should().Contain(
            "u_HasTransmissionMap != 0 ? u_Transmission * texture(u_TransmissionMap, uv).r : u_Transmission");
        snippet.Should().Contain(
            "u_HasIridescenceMap != 0 ? u_Iridescence * texture(u_IridescenceMap, uv).r : u_Iridescence");
        snippet.Should().Contain(
            "u_HasSubsurfaceMap != 0 ? u_Subsurface * texture(u_SubsurfaceMap, uv).r : u_Subsurface");
        snippet.Should().Contain("mix(u_IridescenceThicknessMinimum, u_IridescenceThicknessMaximum, t)");
    }

    [Fact]
    public void ExecutorBindsExtensionMapUnits()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(fixture.Assets, "texture/bind");
        var binding = new SceneMaterialTextureBinding(texture);
        var surface = new SceneMaterialSurface
        {
            Features = SceneMaterialFeatures.Clearcoat,
            ClearcoatMap = binding,
            ClearcoatRoughnessMap = binding,
            ClearcoatNormalMap = binding,
            Extensions = new SceneMaterialExtensions { Clearcoat = 0.5f, ClearcoatRoughness = 0.4f }
        };
        SceneAssetId<MaterialAssetTag> materialId = fixture.Assets.CreateId<MaterialAssetTag>("material/extension-bind");
        fixture.Assets.Materials.Register(new SceneMaterialDefinition(materialId, fixture.Shader.Id, surface));

        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out SceneActor rendererActor);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 320, 180)!;
        SceneRenderItem item = fixture.CreateItem(rendererActor);
        item.MaterialId = materialId;
        var executor = new SceneGlDrawExecutor(fixture.Context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);
        SceneRenderPassDefinition pass = new(fixture.Assets.CreateId<RenderPassAssetTag>("main"), clearMask: SceneClearMask.None);

        executor.Render(world, frame, [item], lighting: null, pass, state).Should().Be(1);

        fixture.Api.CallLog.Should().Contain("ActiveTexture(33989)");
        fixture.Api.CallLog.Should().Contain("ActiveTexture(33990)");
        fixture.Api.CallLog.Should().Contain("ActiveTexture(33991)");
    }

    [Fact]
    public void ExplicitBlendStateMapsAdditiveAndMinMax()
    {
        using var fixture = new SceneGlFixture();
        using var shader = new SceneGlShader(fixture.Context, "blend-state", VertexShader, FragmentShader);
        var additiveDefinition = new SceneMaterialDefinition(
            fixture.Assets.CreateId<MaterialAssetTag>("material/additive"),
            fixture.Shader.Id,
            new SceneMaterialSurface(),
            [new SceneMaterialPass("main", blendState: SceneBlendState.Additive)]);
        var additive = new SceneGlMaterial(additiveDefinition, shader, []);
        SceneRenderPassDefinition pass = new(fixture.Assets.CreateId<RenderPassAssetTag>("main"), clearMask: SceneClearMask.None);

        SceneGlBlendMapping mapping = SceneGlBlendStateMapper.Resolve(additive, pass, transparent: false);

        mapping.Enabled.Should().BeTrue();
        mapping.SourceColor.Should().Be(1);
        mapping.DestinationColor.Should().Be(1);
        mapping.SourceAlpha.Should().Be(1);
        mapping.DestinationAlpha.Should().Be(1);
        mapping.ColorEquation.Should().Be(0x8006);
        mapping.AlphaEquation.Should().Be(0x8006);
        mapping.Should().Be(SceneGlBlendStateMapper.Resolve(additive, pass, transparent: false));

        var minDefinition = new SceneMaterialDefinition(
            fixture.Assets.CreateId<MaterialAssetTag>("material/minmax"),
            fixture.Shader.Id,
            new SceneMaterialSurface(),
            [new SceneMaterialPass("main", blendState: new SceneBlendState(
                true,
                SceneBlendFactor.Zero,
                SceneBlendFactor.One,
                SceneBlendOperation.Min,
                SceneBlendFactor.Zero,
                SceneBlendFactor.One,
                SceneBlendOperation.Max))]);
        var minMaterial = new SceneGlMaterial(minDefinition, shader, []);

        SceneGlBlendMapping minMapping = SceneGlBlendStateMapper.Resolve(minMaterial, pass, transparent: false);
        minMapping.ColorEquation.Should().Be(0x8007);
        minMapping.AlphaEquation.Should().Be(0x8008);
    }

    [Fact]
    public void LegacyBlendBooleanKeepsAlphaFuncs()
    {
        using var fixture = new SceneGlFixture();
        using var shader = new SceneGlShader(fixture.Context, "legacy-blend", VertexShader, FragmentShader);
        var definition = new SceneMaterialDefinition(
            fixture.Assets.CreateId<MaterialAssetTag>("material/legacy"),
            fixture.Shader.Id,
            new SceneMaterialSurface { AlphaMode = SceneMaterialAlphaMode.Blend },
            [new SceneMaterialPass("main", blend: true)]);
        var material = new SceneGlMaterial(definition, shader, []);
        SceneRenderPassDefinition pass = new(fixture.Assets.CreateId<RenderPassAssetTag>("main"), clearMask: SceneClearMask.None);

        SceneGlBlendMapping mapping = SceneGlBlendStateMapper.Resolve(material, pass, transparent: false);

        mapping.Enabled.Should().BeTrue();
        mapping.SourceColor.Should().Be(0x0302);
        mapping.DestinationColor.Should().Be(0x0303);
        mapping.SourceAlpha.Should().Be(1);
        mapping.DestinationAlpha.Should().Be(0x0303);
    }

    [Fact]
    public void ExecutorEmitsAdditiveBlendFunctions()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<MaterialAssetTag> materialId = fixture.Assets.CreateId<MaterialAssetTag>("material/forward-add");
        fixture.Assets.Materials.Register(new SceneMaterialDefinition(
            materialId,
            fixture.Shader.Id,
            new SceneMaterialSurface(),
            [new SceneMaterialPass("main", blendState: SceneBlendState.Additive)]));

        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out SceneActor rendererActor);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 320, 180)!;
        SceneRenderItem item = fixture.CreateItem(rendererActor);
        item.MaterialId = materialId;
        var executor = new SceneGlDrawExecutor(fixture.Context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);
        SceneRenderPassDefinition pass = new(fixture.Assets.CreateId<RenderPassAssetTag>("main"), clearMask: SceneClearMask.None);

        executor.Render(world, frame, [item], lighting: null, pass, state).Should().Be(1);

        fixture.Api.CallLog.Should().Contain("Enable(3042)");
        fixture.Api.CallLog.Should().Contain("BlendFuncSeparate(1, 1, 1, 1)");
        fixture.Api.CallLog.Should().Contain("BlendEquationSeparate(32774, 32774)");
    }

    private static SceneAssetId<TextureAssetTag> RegisterTexture(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<TextureAssetTag> id = assets.CreateId<TextureAssetTag>(name);
        assets.Textures.Register(new SceneTextureDefinition(id, new SceneTextureColor(Vec4.One, 8, 8)));
        return id;
    }

    private static SceneAssetId<MaterialAssetTag> RegisterExtensionMaterial(
        SceneGlFixture fixture,
        SceneAssetId<TextureAssetTag> texture,
        SceneMaterialFeatures features) =>
        RegisterMaterialWithMaps(fixture, texture, features, new SceneMaterialExtensions
        {
            Clearcoat = 0.5f,
            ClearcoatRoughness = 0.25f,
            ClearcoatNormalScale = 1.2f,
            SheenColor = new Vec3(0.3f, 0.4f, 0.5f),
            SheenRoughness = 0.6f,
            Transmission = 0.7f,
            Ior = 1.45f,
            Thickness = 2.0f,
            Iridescence = 0.4f,
            IridescenceIor = 1.35f,
            Subsurface = 0.2f
        });

    private static SceneAssetId<MaterialAssetTag> RegisterMaterialWithMaps(
        SceneGlFixture fixture,
        SceneAssetId<TextureAssetTag> texture,
        SceneMaterialFeatures features,
        SceneMaterialExtensions? extensions)
    {
        var binding = new SceneMaterialTextureBinding(texture);
        var surface = new SceneMaterialSurface
        {
            Features = features,
            ClearcoatMap = binding,
            ClearcoatRoughnessMap = binding,
            ClearcoatNormalMap = binding,
            SheenColorMap = binding,
            SheenRoughnessMap = binding,
            TransmissionMap = binding,
            IridescenceMap = binding,
            IridescenceThicknessMap = binding,
            SubsurfaceMap = binding,
            Extensions = extensions
        };
        SceneAssetId<MaterialAssetTag> id = fixture.Assets.CreateId<MaterialAssetTag>($"material/extension-{features}-{extensions is not null}");
        fixture.Assets.Materials.Register(new SceneMaterialDefinition(id, fixture.Shader.Id, surface));
        return id;
    }
}
