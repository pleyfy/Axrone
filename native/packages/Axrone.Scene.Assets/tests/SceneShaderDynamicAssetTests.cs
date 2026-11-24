namespace Axrone.Scene.Assets.Tests;

using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using Axrone.AssetShader;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using FluentAssertions;
using Xunit;

/// <summary>
/// Covers the asset-side surface a dynamically compiled material graph needs: texture uniforms
/// addressed by sampler name, uniform reflection over generated GLSL, and the effect-to-definition
/// factory.
/// </summary>
public sealed class SceneShaderDynamicAssetTests
{
    private const string SamplerVertexSource = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        uniform mat4 u_Model;
        out vec2 v_Uv;
        void main() { v_Uv = a_Position.xy; gl_Position = u_Model * vec4(a_Position, 1.0); }
        """;

    private const string SamplerFragmentSource = """
        #version 330 core
        in vec2 v_Uv;
        uniform vec3 u_Tint;
        uniform float u_Strength;
        uniform bool u_Invert;
        uniform int u_Mode;
        uniform sampler2D u_Mask;
        uniform samplerCube u_Environment;
        uniform vec3 u_Lights[4];
        out vec4 o_FragColor;
        void main() { o_FragColor = vec4(texture(u_Mask, v_Uv).rgb * u_Tint, 1.0); }
        """;

    [Fact]
    public void Definition_AcceptsARawCustomGlslPairWithoutAnEffect()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<ShaderAssetTag> id = assets.CreateId<ShaderAssetTag>("graph/custom");

        var definition = new SceneShaderDefinition(
            id,
            SamplerVertexSource,
            SamplerFragmentSource,
            uniforms: ["u_Tint", "u_Mask"],
            attributes: SceneShaderAttributes.DefaultNames,
            depthTest: true,
            cull: false,
            blend: true);

        definition.Effect.Should().BeNull();
        definition.Uniforms.Should().HaveCount(2);
        definition.Cull.Should().BeFalse();
        definition.Blend.Should().BeTrue();
        definition.DepthTest.Should().BeTrue();
        definition.Attributes[SceneMeshSemantic.Tangent].Should().Be("a_Tangent");
    }

    [Fact]
    public void MaterialDefinition_CopiesTextureUniformsAndKeepsDeclarationOrder()
    {
        var assets = new SceneAssetRegistry();
        SceneAssetId<MaterialAssetTag> id = assets.CreateId<MaterialAssetTag>("mat/graph");
        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("shader/graph");
        SceneAssetId<TextureAssetTag> mask = assets.CreateId<TextureAssetTag>("tex/mask");
        var bindings = new Dictionary<string, SceneMaterialTextureBinding>(StringComparer.Ordinal)
        {
            ["u_Mask"] = new(mask),
            ["u_Environment"] = new(mask, unit: 7)
        };

        var material = new SceneMaterialDefinition(
            id,
            shaderId,
            new SceneMaterialSurface(),
            textureUniforms: bindings);
        bindings.Clear();

        material.TextureUniforms.Should().HaveCount(2);
        material.TextureUniforms["u_Environment"].Unit.Should().Be(7);
        material.TextureUniforms.Should().NotContainKey("u_Missing");
    }

    [Fact]
    public void MaterialDefinition_RejectsBlankTextureUniformNames()
    {
        var assets = new SceneAssetRegistry();
        var bindings = new Dictionary<string, SceneMaterialTextureBinding>(StringComparer.Ordinal)
        {
            [" "] = new(assets.CreateId<TextureAssetTag>("tex/mask"))
        };

        SceneMaterialDefinition? created = null;
        Action act = () => created = new SceneMaterialDefinition(
            assets.CreateId<MaterialAssetTag>("mat/graph"),
            assets.CreateId<ShaderAssetTag>("shader/graph"),
            new SceneMaterialSurface(),
            textureUniforms: bindings);

        act.Should().Throw<SceneAssetException>()
            .Which.Code.Should().Be(SceneAssetErrorCodes.Invalid);
        created.Should().BeNull();
    }

    [Fact]
    public void MaterialDefinition_RejectsTextureUniformsWithoutATexture()
    {
        var assets = new SceneAssetRegistry();
        var bindings = new Dictionary<string, SceneMaterialTextureBinding>(StringComparer.Ordinal)
        {
            ["u_Mask"] = new SceneMaterialTextureBinding()
        };

        SceneMaterialDefinition? created = null;
        Action act = () => created = new SceneMaterialDefinition(
            assets.CreateId<MaterialAssetTag>("mat/graph"),
            assets.CreateId<ShaderAssetTag>("shader/graph"),
            new SceneMaterialSurface(),
            textureUniforms: bindings);

        act.Should().Throw<SceneAssetException>()
            .Which.Message.Should().Contain("u_Mask");
        created.Should().BeNull();
    }

    [Fact]
    public void Reflection_MapsGeneratedGlslTypesAndSamplers()
    {
        SceneShaderUniformReflection reflection = SceneShaderUniformReflection.FromSources(
            SamplerVertexSource,
            SamplerFragmentSource);

        reflection.TryGet("u_Tint", out SceneShaderUniform tint).Should().BeTrue();
        tint.Type.Should().Be(SceneShaderUniformType.Vec3);
        reflection.TryGet("u_Mask", out SceneShaderUniform mask).Should().BeTrue();
        mask.Type.Should().Be(SceneShaderUniformType.Sampler2D);
        reflection.TryGet("u_Environment", out SceneShaderUniform environment).Should().BeTrue();
        environment.Type.Should().Be(SceneShaderUniformType.SamplerCube);
        reflection.TryGet("u_Lights", out SceneShaderUniform lights).Should().BeTrue();
        lights.ArrayLength.Should().Be(4);
        reflection.SamplerNames.Should().BeEquivalentTo(["u_Mask", "u_Environment"]);
        reflection.TryGet("u_Model", out SceneShaderUniform model).Should().BeTrue();
        model.Type.Should().Be(SceneShaderUniformType.Mat4);
        reflection.Uniforms.Should().HaveCount(8);
    }

    [Fact]
    public void Reflection_TellsWhetherAnAuthoredValueCanReachTheUniform()
    {
        SceneShaderUniformReflection.TryGetValueKind(SceneShaderUniformType.Vec3, out SceneUniformKind vec3)
            .Should().BeTrue();
        vec3.Should().Be(SceneUniformKind.Vec3);
        SceneShaderUniformReflection.TryGetValueKind(SceneShaderUniformType.Bool, out SceneUniformKind boolean)
            .Should().BeTrue();
        boolean.Should().Be(SceneUniformKind.Bool);
        SceneShaderUniformReflection.TryGetValueKind(SceneShaderUniformType.Mat4, out _).Should().BeFalse();
        SceneShaderUniformReflection.TryGetValueKind(SceneShaderUniformType.Sampler2D, out _).Should().BeFalse();
    }

    [Fact]
    public void Reflection_ReportsUnknownAndAbsentTypes()
    {
        SceneShaderUniformReflection reflection = SceneShaderUniformReflection.FromSources(
            SamplerVertexSource,
            "uniform texture2D u_Weird;\n");

        SceneShaderUniformReflection.MapType("vec3").Should().Be(SceneShaderUniformType.Vec3);
        SceneShaderUniformReflection.MapType("texture2D").Should().Be(SceneShaderUniformType.Unsupported);
        reflection.TryGet("u_Tint", out _).Should().BeFalse();
        reflection.Uniforms.Should().HaveCount(2);
        reflection.Uniforms[1].Type.Should().Be(SceneShaderUniformType.Unsupported);
        reflection.IsEmpty.Should().BeFalse();
        SceneShaderUniformReflection.Empty.IsEmpty.Should().BeTrue();
        SceneShaderUniformReflection.IsSampler(SceneShaderUniformType.Sampler3D).Should().BeTrue();
    }

    [Fact]
    public void Reflection_ReportsNothingForSourcesWithoutUniforms()
    {
        SceneShaderUniformReflection reflection = SceneShaderUniformReflection.FromSources(
            "void main() {}",
            "void main() {}");

        reflection.IsEmpty.Should().BeTrue();
        reflection.SamplerNames.Should().BeEmpty();
    }

    [Fact]
    public void Attributes_MapSemanticsToNamesAndLocations()
    {
        SceneShaderAttributes.DefaultName(SceneMeshSemantic.Position).Should().Be("a_Position");
        SceneShaderAttributes.DefaultName(SceneMeshSemantic.Uv1).Should().Be("a_UV1");
        SceneShaderAttributes.DefaultName(SceneMeshSemantic.Tangent).Should().Be("a_Tangent");
        SceneShaderAttributes.DefaultNames.Should().HaveCount(10);

        SceneShaderAttributes.LocationOf(SceneMeshSemantic.Normal).Should().Be(1);
        SceneShaderAttributes.LocationOf(SceneMeshSemantic.Tangent).Should().Be(4);
        SceneShaderAttributes.TryResolveLocation(2, out SceneMeshSemantic uv0).Should().BeTrue();
        uv0.Should().Be(SceneMeshSemantic.Uv0);
        SceneShaderAttributes.TryResolveLocation(99, out _).Should().BeFalse();
    }

    [Fact]
    public void Factory_BakesGeneratedEffectIntoARegistrableShaderDefinition()
    {
        ShaderEffect effect = GeneratedEffect();

        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(effect);

        definition.Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("graph/studio"));
        definition.VertexSource.Should().StartWith("#version 330 core");
        definition.VertexSource.Should().Contain("layout(location = 0) in vec3 a_Position;")
            .And.Contain("uniform vec3 u_Tint;")
            .And.Contain("uniform mat4 u_Model;");
        definition.FragmentSource.Should().Contain("uniform sampler2D u_Mask;")
            .And.Contain("in vec2 v_Uv;");
        definition.Uniforms.Should().Contain("u_Tint").And.Contain("u_Mask");
        definition.Effect.Should().NotBeNull();
        definition.Attributes[SceneMeshSemantic.Tangent].Should().Be("a_Tangent");
    }

    [Fact]
    public void Factory_KeepsAnAuthoredVersionDirective()
    {
        ShaderEffect effect = GeneratedEffect(version: "#version 300 es");

        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(effect);

        definition.VertexSource.Should().StartWith("#version 300 es");
        definition.FragmentSource.Should().StartWith("#version 300 es");
    }

    [Fact]
    public void Factory_MapsAuthoredRenderStateOntoShaderFlags()
    {
        ShaderEffect effect = GeneratedEffect(renderState:
            new ShaderRenderState(CullMode: "none", BlendMode: "alpha", DepthTest: "disabled"));

        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(effect);

        definition.Cull.Should().BeFalse();
        definition.Blend.Should().BeTrue();
        definition.DepthTest.Should().BeFalse();
    }

    [Fact]
    public void Factory_LeavesRenderStateAtSceneDefaultsWhenUnspecified()
    {
        ShaderEffect definitionEffect = GeneratedEffect();

        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(definitionEffect);

        definition.DepthTest.Should().BeTrue();
        definition.Cull.Should().BeTrue();
        definition.Blend.Should().BeFalse();
    }

    [Fact]
    public void Factory_CanSkipRenderStateForPassDrivenMaterials()
    {
        ShaderEffect effect = GeneratedEffect(
            renderState: new ShaderRenderState(BlendMode: "alpha"));

        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(
            effect,
            new SceneShaderEffectOptions(ApplyRenderState: false));

        definition.Blend.Should().BeFalse();
    }

    [Fact]
    public void Factory_HonoursAnExplicitShaderId()
    {
        var assets = new SceneAssetRegistry();
        ShaderEffect effect = GeneratedEffect();

        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(
            effect,
            new SceneShaderEffectOptions(Id: assets.CreateId<ShaderAssetTag>("graph/override")));

        definition.Id.Should().Be(assets.CreateId<ShaderAssetTag>("graph/override"));
    }

    [Fact]
    public void Factory_ReportsSourceErrorsInsteadOfProducingABrokenDefinition()
    {
        ShaderEffect effect = new(new ShaderEffectDefinition(
            Id: new ShaderSymbol("graph/broken"),
            Vertex: new ShaderStageDefinition(Main: "gl_Position = vec4(0.0);"),
            Fragment: new ShaderStageDefinition(Main: "o_FragColor = vec4(1.0);"),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "texture2D"))));

        bool created = SceneShaderEffectFactory.TryCreate(
            effect,
            new SceneShaderEffectOptions(),
            out SceneShaderDefinition? definition,
            out ImmutableArray<ShaderDiagnostic> diagnostics);

        created.Should().BeFalse();
        definition.Should().BeNull();
        diagnostics.Should().Contain(diagnostic =>
            diagnostic.Severity == ShaderDiagnosticSeverity.Error &&
            diagnostic.Message.Contains("texture2D", StringComparison.Ordinal));

        Action act = () => SceneShaderEffectFactory.Create(effect);
        act.Should().Throw<SceneAssetException>();
    }

    [Fact]
    public void Factory_UsesCustomAttributeNamesWhenSupplied()
    {
        var attributes = new Dictionary<SceneMeshSemantic, string>
        {
            [SceneMeshSemantic.Position] = "a_StudioPosition"
        };

        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(
            GeneratedEffect(),
            new SceneShaderEffectOptions(Attributes: attributes));

        definition.Attributes[SceneMeshSemantic.Position].Should().Be("a_StudioPosition");
        definition.Attributes[SceneMeshSemantic.Normal].Should().Be("a_Normal");
    }

    [Fact]
    public void ResolveRenderState_ReadsTheAuthoredVocabulary()
    {
        SceneShaderEffectFactory.ResolveRenderState(
            new ShaderRenderState(CullMode: "front", BlendMode: "opaque", DepthTest: "less"),
            out bool depthTest,
            out bool cull,
            out bool blend);
        depthTest.Should().BeTrue();
        cull.Should().BeTrue();
        blend.Should().BeFalse();

        SceneShaderEffectFactory.ResolveRenderState(
            new ShaderRenderState(CullMode: "none", BlendMode: "off", DepthTest: "off"),
            out bool disabledDepth,
            out bool disabledCull,
            out bool disabledBlend);
        disabledDepth.Should().BeFalse();
        disabledCull.Should().BeFalse();
        disabledBlend.Should().BeFalse();
    }

    [Fact]
    public void HasVersion_OnlyAcceptsAVersionDirective()
    {
        ShaderEffect withVersion = GeneratedEffect(version: "#version 300 es");
        ShaderEffect withoutVersion = GeneratedEffect();

        SceneShaderEffectFactory.HasVersion(withVersion.Definition.Vertex).Should().BeTrue();
        SceneShaderEffectFactory.HasVersion(withoutVersion.Definition.Vertex).Should().BeFalse();
        SceneShaderEffectFactory.HasVersion(withoutVersion.Definition.Fragment).Should().BeFalse();
    }

    private static ShaderEffect GeneratedEffect(
        string? version = null,
        ShaderRenderState? renderState = null)
    {
        ImmutableArray<string> directives = version is null
            ? default
            : ImmutableArray.Create(version);

        return new ShaderEffect(new ShaderEffectDefinition(
            Id: new ShaderSymbol("graph/studio"),
            Vertex: new ShaderStageDefinition(
                Main: "v_Uv = a_UV0;\ngl_Position = u_Model * vec4(a_Position, 1.0);",
                Directives: directives,
                Precision: ShaderPrecision.Highp),
            Fragment: new ShaderStageDefinition(
                Main: "o_FragColor = vec4(texture(u_Mask, v_Uv).rgb * u_Tint, 1.0);",
                Directives: directives,
                Precision: ShaderPrecision.Mediump),
            Attributes: ImmutableArray.Create(
                new ShaderAttributeDefinition("a_Position", "vec3", 0),
                new ShaderAttributeDefinition("a_UV0", "vec2", 2),
                new ShaderAttributeDefinition("a_Tangent", "vec4", 4)),
            Varyings: ImmutableArray.Create(new ShaderInterfaceDefinition("v_Uv", "vec2")),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Model"), "mat4"),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3"),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Mask"), "sampler2D")),
            RenderState: renderState));
    }
}
