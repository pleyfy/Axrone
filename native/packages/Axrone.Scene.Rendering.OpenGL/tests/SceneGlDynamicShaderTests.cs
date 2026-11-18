namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System;
using System.Collections.Generic;
using System.Collections.Immutable;
using Axrone.AssetShader;
using Axrone.Numeric;
using Axrone.Render.Core;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Render.OpenGL.Native;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

/// <summary>
/// Covers dynamically compiled material-graph shaders reaching the GPU: raw GLSL registration,
/// attribute location binding, structured compile diagnostics, arbitrary sampler and value
/// uniform binding, and the fixed-function state a shader authors for itself.
/// </summary>
public sealed class SceneGlDynamicShaderTests : IDisposable
{
    private const string ShaderName = "test/custom-shader";
    private const string MaterialName = "test/custom-material";
    private const string MaskUniform = "u_Mask";
    private const string FallbackUniform = "u_Fallback";
    private const string TintUniform = "u_Tint";

    private const string UnqualifiedVertexSource = """
        #version 330 core
        in vec3 a_Position;
        in vec2 a_UV0;
        in vec4 a_Tangent;
        uniform mat4 u_Model;
        out vec2 v_Uv;
        out vec4 v_Tangent;
        void main() {
            v_Uv = a_UV0;
            v_Tangent = a_Tangent;
            gl_Position = u_Model * vec4(a_Position, 1.0);
        }
        """;

    private const string RenamedAttributeVertexSource = """
        #version 330 core
        in vec3 a_MyPosition;
        in vec2 a_MyUv;
        uniform mat4 u_Model;
        out vec2 v_Uv;
        void main() {
            v_Uv = a_MyUv;
            gl_Position = u_Model * vec4(a_MyPosition, 1.0);
        }
        """;

    private const string QualifiedVertexSource = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        layout(location = 2) in vec2 a_UV0;
        layout(location = 4) in vec4 a_Tangent;
        uniform mat4 u_Model;
        out vec2 v_Uv;
        out vec4 v_Tangent;
        void main() {
            v_Uv = a_UV0;
            v_Tangent = a_Tangent;
            gl_Position = u_Model * vec4(a_Position, 1.0);
        }
        """;

    private const string CustomFragmentSource = """
        #version 330 core
        precision mediump float;
        in vec2 v_Uv;
        in vec4 v_Tangent;
        uniform vec3 u_Tint;
        uniform float u_Strength;
        uniform sampler2D u_Mask;
        uniform sampler2D u_Fallback;
        out vec4 o_FragColor;
        void main() {
            vec3 masked = mix(texture(u_Mask, v_Uv).rgb, texture(u_Fallback, v_Uv).rgb, v_Tangent.w);
            o_FragColor = vec4(masked * u_Tint * u_Strength, 1.0);
        }
        """;

    private readonly DynamicShaderFixture _fixture = new();

    public void Dispose() => _fixture.Dispose();

    [Fact]
    public void RegisterShader_KeepsRawCustomGlslAsItsOwnProgram()
    {
        SceneShaderDefinition definition = _fixture.ShaderDefinition();

        SceneGlShader shader = _fixture.Cache.RegisterShader(definition);

        shader.Label.Should().Be(definition.Id.ToString());
        shader.TryGetUniform(MaskUniform, out SceneShaderUniform mask).Should().BeTrue();
        mask.Type.Should().Be(SceneShaderUniformType.Sampler2D);
        shader.TryGetUniform(TintUniform, out SceneShaderUniform tint).Should().BeTrue();
        tint.Type.Should().Be(SceneShaderUniformType.Vec3);
        shader.SamplerUniformNames.Should().Contain(MaskUniform).And.Contain(FallbackUniform);
        _fixture.Cache.TryGetShader(definition.Id, out SceneGlShader? resolved).Should().BeTrue();
        resolved.Should().BeSameAs(shader);
    }

    [Fact]
    public void RegisterShader_QualifiesUnqualifiedAttributesWithSceneLocations()
    {
        SceneShaderDefinition definition = _fixture.ShaderDefinition();

        SceneGlShader shader = _fixture.Cache.RegisterShader(definition);

        shader.VertexSource.Should().Contain("layout(location = 0) in vec3 a_Position;")
            .And.Contain("layout(location = 2) in vec2 a_UV0;")
            .And.Contain("layout(location = 4) in vec4 a_Tangent;");
    }

    [Fact]
    public void RegisterShader_LeavesAlreadyQualifiedAttributesUntouched()
    {
        SceneShaderDefinition definition = _fixture.ShaderDefinition(vertexSource: QualifiedVertexSource);

        SceneGlShader shader = _fixture.Cache.RegisterShader(definition);

        shader.VertexSource.Should().Be(QualifiedVertexSource);
        _fixture.Cache.TryGetShaderPreparationNotes(definition.Id, out _).Should().BeFalse();
    }

    [Fact]
    public void RegisterShader_ReportsNotesForAttributeDeclarationsItCannotQualify()
    {
        const string SharedDeclaration = """
            #version 330 core
            in vec3 a_Position, a_Normal;
            void main() { gl_Position = vec4(a_Position + a_Normal, 1.0); }
            """;
        SceneShaderDefinition definition = _fixture.ShaderDefinition(vertexSource: SharedDeclaration);

        SceneGlShader shader = _fixture.Cache.RegisterShader(definition);

        shader.VertexSource.Should().Be(SharedDeclaration);
        _fixture.Cache.TryGetShaderPreparationNotes(
            definition.Id, out IReadOnlyList<string> notes).Should().BeTrue();
        notes.Should().ContainSingle(note => note.Contains("a_Position", StringComparison.Ordinal));
    }


    [Fact]
    public void RegisterShader_HonoursCustomAttributeNamesFromTheDefinition()
    {
        var attributes = new Dictionary<SceneMeshSemantic, string>
        {
            [SceneMeshSemantic.Position] = "a_MyPosition",
            [SceneMeshSemantic.Uv0] = "a_MyUv"
        };
        SceneShaderDefinition definition = _fixture.ShaderDefinition(
            vertexSource: RenamedAttributeVertexSource,
            attributes: attributes);

        SceneGlShader shader = _fixture.Cache.RegisterShader(definition);

        shader.VertexSource.Should().Contain("layout(location = 0) in vec3 a_MyPosition;")
            .And.Contain("layout(location = 2) in vec2 a_MyUv;");
        shader.VertexSource.Should().NotContain("a_Position");
    }

    [Fact]
    public void TryRegisterShader_ReportsCompileFailureWithoutThrowing()
    {
        SceneShaderDefinition definition = _fixture.ShaderDefinition();
        const string driverLog = "Fragment shader.\nERROR: 0:7: 'u_Mask' : undeclared identifier";
        _fixture.Cache.ShaderCompilerOverride = (_, _, _, _) =>
            throw new GLShaderException(
                "SHADER_COMPILE_FAILED: " + driverLog,
                GLShaderErrorCode.ShaderCompileFailed,
                driverLog);

        bool registered = _fixture.Cache.TryRegisterShader(
            definition, out SceneGlShaderCompilationFailure failure);

        registered.Should().BeFalse();
        failure.Stage.Should().Be(SceneGlShaderFailureStage.Fragment);
        failure.ErrorLine.Should().Be(7);
        failure.HasErrorLine.Should().BeTrue();
        failure.InfoLog.Should().Be(driverLog);
        failure.Label.Should().Be(definition.Id.ToString());
        failure.Message.Should().Contain(driverLog);
        _fixture.Cache.ShaderCount.Should().Be(0);
        _fixture.Cache.TryGetShader(definition.Id, out _).Should().BeFalse();
    }

    [Fact]
    public void RegisterShader_ThrowsStructuredFailureForCallersThatDoNotProbe()
    {
        SceneShaderDefinition definition = _fixture.ShaderDefinition();
        const string driverLog = "Vertex shader. Compile failed: 3(4) : error: bad swizzle";
        _fixture.Cache.ShaderCompilerOverride = (_, _, _, _) =>
            throw new GLShaderException(
                "SHADER_COMPILE_FAILED: " + driverLog,
                GLShaderErrorCode.ShaderCompileFailed,
                driverLog);

        Action act = () => _fixture.Cache.RegisterShader(definition);

        SceneGlShaderCompileException error = act.Should().Throw<SceneGlShaderCompileException>().Which;
        error.Failure.Stage.Should().Be(SceneGlShaderFailureStage.Vertex);
        error.Failure.ErrorLine.Should().Be(4);
        error.ShaderCode.Should().Be(GLShaderErrorCode.ShaderCompileFailed);
        error.InfoLog.Should().Be(driverLog);

        // Callers that only know the backend exception type must still reach the failure.
        act.Should().Throw<GLShaderException>();
    }

    [Fact]
    public void TryRegisterShader_KeepsLiveProgramWhenAnEditFailsToCompile()
    {
        SceneShaderDefinition definition = _fixture.ShaderDefinition();
        SceneGlShader original = _fixture.Cache.RegisterShader(definition);

        _fixture.Cache.ShaderCompilerOverride = (_, _, _, _) =>
            throw new GLShaderException(
                "SHADER_COMPILE_FAILED",
                GLShaderErrorCode.ShaderCompileFailed,
                "Fragment shader.\nERROR: 0:3: type mismatch");

        _fixture.Cache.TryRegisterShader(
            definition, out SceneGlShaderCompilationFailure failure).Should().BeFalse();

        failure.ErrorLine.Should().Be(3);
        _fixture.Cache.TryGetShader(definition.Id, out SceneGlShader? live).Should().BeTrue();
        live.Should().BeSameAs(original);
        live.IsDisposed.Should().BeFalse();
    }

    [Fact]
    public void TryRegisterShader_ReportsEffectBakeFailureBeforeCompiling()
    {
        ShaderEffect broken = new(new ShaderEffectDefinition(
            new ShaderSymbol("test/broken-effect"),
            new ShaderStageDefinition(
                Main: "gl_Position = vec4(0.0);",
                Includes: ImmutableArray.Create(new ShaderSymbol("missing/library"))),
            new ShaderStageDefinition(Main: "o_FragColor = vec4(1.0);")));
        SceneShaderDefinition definition = _fixture.ShaderDefinition(effect: broken);
        int compileCalls = 0;
        _fixture.Cache.ShaderCompilerOverride = (_, _, _, _) =>
        {
            compileCalls++;
            return new SceneGlShader(_fixture.Context, "unexpected", "void main(){}", "void main(){}");
        };

        bool registered = _fixture.Cache.TryRegisterShader(
            definition, out SceneGlShaderCompilationFailure failure);

        registered.Should().BeFalse();
        failure.Stage.Should().Be(SceneGlShaderFailureStage.Effect);
        failure.InfoLog.Should().NotBeNullOrWhiteSpace();
        compileCalls.Should().Be(0);
    }

    [Fact]
    public void ShaderState_FallsBackToDefinitionFlagsForRawCustomShaders()
    {
        SceneShaderDefinition definition = _fixture.ShaderDefinition(
            depthTest: false,
            cull: false,
            blend: true);

        _fixture.Cache.RegisterShader(definition);

        _fixture.Cache.TryGetShaderState(definition.Id, out SceneGlShaderState state).Should().BeTrue();
        state.DepthTest.Should().BeFalse();
        state.Cull.Should().Be(SceneGlCullMode.None);
        state.CullEnabled.Should().BeFalse();
        state.Blend.Should().BeTrue();
    }

    [Fact]
    public void ShaderState_UsesEffectRenderStateWhenTheDefinitionCarriesAnEffect()
    {
        ShaderEffect effect = GeneratedEffect(
            new ShaderRenderState(CullMode: "none", BlendMode: "alpha", DepthTest: "disabled"));

        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(
            effect,
            new SceneShaderEffectOptions(Id: _fixture.Assets.CreateId<ShaderAssetTag>(ShaderName)));
        _fixture.Assets.Shaders.Register(definition);
        SceneGlShader shader = _fixture.Cache.RegisterShader(definition);

        shader.FragmentSource.Should().Contain("uniform vec3 u_Tint;")
            .And.Contain("uniform sampler2D u_Mask;");
        shader.VertexSource.Should().Contain("layout(location = 0) in vec3 a_Position;");
        _fixture.Cache.TryGetShaderState(definition.Id, out SceneGlShaderState state).Should().BeTrue();
        state.Cull.Should().Be(SceneGlCullMode.None);
        state.Blend.Should().BeTrue();
        state.DepthTest.Should().BeFalse();
    }

    [Fact]
    public void UploadAll_ResolvesCustomShaderAndMaterialWithoutFallingBack()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition();
        _fixture.Assets.Shaders.Register(shader);
        SceneAssetId<TextureAssetTag> mask = _fixture.AddTexture("test/mask-texture");
        SceneAssetId<TextureAssetTag> fallback = _fixture.AddTexture("test/fallback-texture");
        SceneMaterialDefinition material = _fixture.MaterialDefinition(mask, fallback);
        _fixture.Assets.Materials.Register(material);

        SceneGlUploadStats stats = _fixture.Cache.UploadAll();

        stats.Shaders.Should().Be(1);
        stats.Materials.Should().Be(1);
        _fixture.Cache.TryGetShader(shader.Id, out SceneGlShader? resolved).Should().BeTrue();
        _fixture.Cache.TryGetMaterial(material.Id, out SceneGlMaterial? gpuMaterial).Should().BeTrue();
        gpuMaterial!.Shader.Should().BeSameAs(resolved);
        gpuMaterial.ShaderState.Blend.Should().BeFalse();
        gpuMaterial.HasUniformDiagnostics.Should().BeFalse();
    }

    [Fact]
    public void RegisterMaterial_BindsArbitrarySamplerUniformsToDistinctFreeUnits()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition();
        SceneAssetId<TextureAssetTag> mask = _fixture.AddTexture("test/mask-texture");
        SceneAssetId<TextureAssetTag> fallback = _fixture.AddTexture("test/fallback-texture");
        SceneMaterialDefinition material = _fixture.MaterialDefinition(mask, fallback);

        SceneGlMaterial gpuMaterial = _fixture.Register(shader, material);

        SceneGlTextureSlot maskSlot = gpuMaterial.TextureSlots.ToArray()
            .Single(slot => string.Equals(slot.UniformName, MaskUniform, StringComparison.Ordinal));
        SceneGlTextureSlot fallbackSlot = gpuMaterial.TextureSlots.ToArray()
            .Single(slot => string.Equals(slot.UniformName, FallbackUniform, StringComparison.Ordinal));
        maskSlot.Unit.Should().NotBe(fallbackSlot.Unit);
        SceneGlTextureUnits.IsReservedUnit(maskSlot.Unit).Should().BeFalse();
        SceneGlTextureUnits.IsReservedUnit(fallbackSlot.Unit).Should().BeFalse();
        maskSlot.Texture.Should().NotBeNull();
        maskSlot.Sampler.Should().NotBeNull();
    }

    [Fact]
    public void RegisterMaterial_HonoursExplicitSamplerUnits()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition();
        SceneAssetId<TextureAssetTag> mask = _fixture.AddTexture("test/mask-texture");
        SceneMaterialDefinition material = _fixture.MaterialDefinition(
            mask,
            mask,
            maskBinding: new SceneMaterialTextureBinding(mask, unit: 13));

        SceneGlMaterial gpuMaterial = _fixture.Register(shader, material);

        gpuMaterial.TextureSlots.ToArray()
            .Single(slot => slot.UniformName == MaskUniform).Unit.Should().Be(13);
    }

    [Fact]
    public void RegisterMaterial_RejectsTextureUniformCollidingWithReservedSurfaceName()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition();
        SceneAssetId<TextureAssetTag> mask = _fixture.AddTexture("test/mask-texture");
        var textureUniforms = new Dictionary<string, SceneMaterialTextureBinding>(StringComparer.Ordinal)
        {
            ["u_AlbedoMap"] = new(mask)
        };
        SceneMaterialDefinition material = new(
            _fixture.Assets.CreateId<MaterialAssetTag>(MaterialName),
            shader.Id,
            new SceneMaterialSurface(),
            textureUniforms: textureUniforms);

        Action act = () => _fixture.Register(shader, material);

        act.Should().Throw<SceneAssetException>()
            .Which.Message.Should().Contain("u_AlbedoMap");
    }

    [Fact]
    public void RegisterMaterial_BindsCustomUniformValuesAndSkipsWidthMismatches()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition();
        var uniforms = new Dictionary<string, SceneUniformValue>(StringComparer.Ordinal)
        {
            [TintUniform] = SceneUniformValue.FromVec3(new Vec3(0.2f, 0.4f, 0.6f)),
            ["u_Strength"] = SceneUniformValue.FromFloat(1.5f),
            ["u_Invert"] = SceneUniformValue.FromBool(true),
            ["u_Mode"] = SceneUniformValue.FromInt(2),
            [MaskUniform] = SceneUniformValue.FromFloat(1.0f)
        };
        SceneMaterialDefinition material = new(
            _fixture.Assets.CreateId<MaterialAssetTag>(MaterialName),
            shader.Id,
            new SceneMaterialSurface(),
            uniforms: uniforms);

        SceneGlMaterial gpuMaterial = _fixture.Register(shader, material);

        gpuMaterial.UniformEntries.ToArray().Should().Contain(entry => entry.Name == TintUniform)
            .And.Contain(entry => entry.Name == "u_Strength")
            .And.Contain(entry => entry.Name == "u_Invert")
            .And.Contain(entry => entry.Name == "u_Mode");
        SceneGlUniformBindingDiagnostic[] diagnostics = gpuMaterial.UniformDiagnostics.ToArray();
        diagnostics.Should().ContainSingle(diagnostic => diagnostic.Name == MaskUniform)
            .Which.Reason.Should().Contain("sampler");
    }

    [Fact]
    public void ApplyState_UsesShaderStateWhenNeitherPassNorMaterialOverrides()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition(depthTest: false, cull: false, blend: true);
        SceneMaterialDefinition material = new(
            _fixture.Assets.CreateId<MaterialAssetTag>(MaterialName),
            shader.Id,
            new SceneMaterialSurface());
        SceneGlMaterial gpuMaterial = _fixture.Register(shader, material);

        SceneGlDrawExecutor.ApplyState(
            _fixture.Context,
            transparent: false,
            gpuMaterial,
            _fixture.Pass("test/pass-silent"));

        _fixture.Context.State.DepthTestEnabled.Should().BeFalse();
        _fixture.Context.State.CullFaceEnabled.Should().BeFalse();
        _fixture.Context.State.BlendEnabled.Should().BeTrue();
    }

    [Fact]
    public void ApplyState_LetsRenderPassWinOverShaderAuthoredState()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition(depthTest: false, cull: false, blend: true);
        SceneMaterialDefinition material = new(
            _fixture.Assets.CreateId<MaterialAssetTag>(MaterialName),
            shader.Id,
            new SceneMaterialSurface());
        SceneGlMaterial gpuMaterial = _fixture.Register(shader, material);

        SceneGlDrawExecutor.ApplyState(
            _fixture.Context,
            transparent: false,
            gpuMaterial,
            _fixture.Pass("test/pass-forced", depthTest: true, cull: true, blend: false));

        _fixture.Context.State.DepthTestEnabled.Should().BeTrue();
        _fixture.Context.State.CullFaceEnabled.Should().BeTrue();
        _fixture.Context.State.BlendEnabled.Should().BeFalse();
    }

    [Fact]
    public void ApplyState_UsesFrontFaceCullingFromEffectAuthoredState()
    {
        ShaderEffect effect = GeneratedEffect(new ShaderRenderState(CullMode: "front"));
        SceneShaderDefinition definition = SceneShaderEffectFactory.Create(
            effect,
            new SceneShaderEffectOptions(Id: _fixture.Assets.CreateId<ShaderAssetTag>(ShaderName)));
        SceneMaterialDefinition material = new(
            _fixture.Assets.CreateId<MaterialAssetTag>(MaterialName),
            definition.Id,
            new SceneMaterialSurface());

        SceneGlMaterial gpuMaterial = _fixture.Register(definition, material);
        SceneGlDrawExecutor.ApplyState(
            _fixture.Context,
            transparent: false,
            gpuMaterial,
            _fixture.Pass("test/pass-silent"));

        _fixture.Context.State.CullFaceEnabled.Should().BeTrue();
        _fixture.Context.State.CullMode.Should().Be(GLConst.Front);
    }

    [Fact]
    public void ApplyState_DefaultProgramKeepsBackFaceCullingAndDepthTest()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition();
        SceneMaterialDefinition material = new(
            _fixture.Assets.CreateId<MaterialAssetTag>(MaterialName),
            shader.Id,
            new SceneMaterialSurface());

        SceneGlMaterial gpuMaterial = _fixture.Register(shader, material);
        SceneGlDrawExecutor.ApplyState(
            _fixture.Context,
            transparent: false,
            gpuMaterial,
            _fixture.Pass("test/pass-silent"));

        _fixture.Context.State.CullFaceEnabled.Should().BeTrue();
        _fixture.Context.State.CullMode.Should().Be(GLConst.Back);
        _fixture.Context.State.DepthTestEnabled.Should().BeTrue();
        _fixture.Context.State.BlendEnabled.Should().BeFalse();
    }

    [Fact]
    public void BlendMapper_FallsBackToShaderBlendBeforeQueueTransparency()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition(blend: true);
        SceneMaterialDefinition material = new(
            _fixture.Assets.CreateId<MaterialAssetTag>(MaterialName),
            shader.Id,
            new SceneMaterialSurface());
        SceneGlMaterial gpuMaterial = _fixture.Register(shader, material);

        SceneGlBlendMapping mapping = SceneGlBlendStateMapper.Resolve(
            gpuMaterial,
            _fixture.Pass("test/pass-silent"),
            transparent: false);

        mapping.Enabled.Should().BeTrue();
        mapping.SourceColor.Should().Be(GLConst.SrcAlpha);
    }

    [Fact]
    public void BlendMapper_MaterialPassStillBeatsShaderBlend()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition(blend: true);
        SceneMaterialDefinition material = new(
            _fixture.Assets.CreateId<MaterialAssetTag>(MaterialName),
            shader.Id,
            new SceneMaterialSurface(),
            [new SceneMaterialPass("main", blend: false)]);
        SceneGlMaterial gpuMaterial = _fixture.Register(shader, material);

        SceneGlBlendMapping mapping = SceneGlBlendStateMapper.Resolve(
            gpuMaterial,
            _fixture.Pass("test/pass-silent"),
            transparent: true);

        mapping.Enabled.Should().BeFalse();
    }

    [Fact]
    public void BindTextures_UploadsEverySamplerUniformWithItsUnit()
    {
        SceneShaderDefinition shader = _fixture.ShaderDefinition();
        SceneAssetId<TextureAssetTag> mask = _fixture.AddTexture("test/mask-texture");
        SceneAssetId<TextureAssetTag> fallback = _fixture.AddTexture("test/fallback-texture");
        SceneMaterialDefinition material = _fixture.MaterialDefinition(mask, fallback);
        SceneGlShader gpuShader = _fixture.Cache.RegisterShader(shader);
        SceneGlMaterial gpuMaterial = _fixture.Cache.RegisterMaterial(material);

        _fixture.Api.ClearCallLog();
        SceneGlDrawExecutor.BindTextures(_fixture.Context, gpuShader, gpuMaterial.TextureSlots.Span);

        string[] log = [.. _fixture.Api.CallLog];
        log.Should().Contain(call => string.Equals(call, "ActiveTexture(33984)", StringComparison.Ordinal));
        log.Should().Contain(call => string.Equals(call, "ActiveTexture(33985)", StringComparison.Ordinal));
        log.Count(call => call.StartsWith("BindTexture(3553, ", StringComparison.Ordinal)).Should().Be(2);
        log.Count(call => call.StartsWith("BindSampler(", StringComparison.Ordinal)).Should().Be(2);
    }

    private static ShaderEffect GeneratedEffect(ShaderRenderState renderState) =>
        new(new ShaderEffectDefinition(
            Id: new ShaderSymbol("test/generated-material"),
            Vertex: new ShaderStageDefinition(
                Main: "v_Uv = a_UV0; gl_Position = u_Model * vec4(a_Position, 1.0);",
                Precision: ShaderPrecision.Highp),
            Fragment: new ShaderStageDefinition(
                Main: "o_FragColor = vec4(texture(u_Mask, v_Uv).rgb * u_Tint, 1.0);",
                Precision: ShaderPrecision.Mediump,
                Outputs: ImmutableArray.Create(new ShaderInterfaceDefinition("o_FragColor", "vec4"))),
            Attributes: ImmutableArray.Create(
                new ShaderAttributeDefinition("a_Position", "vec3", 0),
                new ShaderAttributeDefinition("a_UV0", "vec2", 2)),
            Varyings: ImmutableArray.Create(new ShaderInterfaceDefinition("v_Uv", "vec2")),
            Properties: ImmutableArray.Create(
                new ShaderPropertyDefinition(new ShaderSymbol("u_Model"), "mat4", Stages: ImmutableArray.Create(ShaderStageTag.Vertex)),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Tint"), "vec3", Stages: ImmutableArray.Create(ShaderStageTag.Fragment)),
                new ShaderPropertyDefinition(new ShaderSymbol("u_Mask"), "sampler2D", Stages: ImmutableArray.Create(ShaderStageTag.Fragment))),
            RenderState: renderState));

    private sealed class DynamicShaderFixture : IDisposable
    {
        private readonly Dictionary<string, SceneAssetId<TextureAssetTag>> _textureIds = new(StringComparer.Ordinal);

        public DynamicShaderFixture()
        {
            Api = new MockGLApi { EnableCallLogging = true };
            Context = new GLContext(Api);
            Assets = new SceneAssetRegistry();
            Cache = new SceneGlAssetCache(Context, Assets);
        }

        public MockGLApi Api { get; }

        public GLContext Context { get; }

        public SceneAssetRegistry Assets { get; }

        public SceneGlAssetCache Cache { get; }

        public SceneShaderDefinition ShaderDefinition(
            string? vertexSource = null,
            string? fragmentSource = null,
            IReadOnlyDictionary<SceneMeshSemantic, string>? attributes = null,
            ShaderEffect? effect = null,
            bool depthTest = true,
            bool cull = true,
            bool blend = false) =>
            new(
                Assets.CreateId<ShaderAssetTag>(ShaderName),
                vertexSource ?? UnqualifiedVertexSource,
                fragmentSource ?? CustomFragmentSource,
                attributes: attributes,
                depthTest: depthTest,
                cull: cull,
                blend: blend,
                effect: effect);

        public SceneAssetId<TextureAssetTag> AddTexture(string name)
        {
            SceneAssetId<TextureAssetTag> id = Assets.CreateId<TextureAssetTag>(name);
            _textureIds[name] = id;
            SceneTextureDefinition definition = new(
                id,
                new SceneTextureColor(Vec4.One, 4, 4));
            Assets.Textures.Register(definition);
            Cache.RegisterTexture(definition);
            return id;
        }

        public SceneMaterialDefinition MaterialDefinition(
            SceneAssetId<TextureAssetTag> maskTexture,
            SceneAssetId<TextureAssetTag> fallbackTexture,
            SceneMaterialTextureBinding? maskBinding = null)
        {
            var textureUniforms = new Dictionary<string, SceneMaterialTextureBinding>(StringComparer.Ordinal)
            {
                [MaskUniform] = maskBinding ?? new SceneMaterialTextureBinding(maskTexture),
                [FallbackUniform] = new SceneMaterialTextureBinding(fallbackTexture)
            };

            return new SceneMaterialDefinition(
                Assets.CreateId<MaterialAssetTag>(MaterialName),
                Assets.CreateId<ShaderAssetTag>(ShaderName),
                new SceneMaterialSurface(),
                textureUniforms: textureUniforms);
        }

        public SceneGlMaterial Register(SceneShaderDefinition shader, SceneMaterialDefinition material)
        {
            Assets.Shaders.Register(shader);
            Assets.Materials.Register(material);
            Cache.RegisterShader(shader);
            return Cache.RegisterMaterial(material);
        }

        public SceneRenderPassDefinition Pass(
            string name,
            bool? depthTest = null,
            bool? cull = null,
            bool? blend = null)
        {
            SceneRenderPassDefinition definition = new(
                Assets.CreateId<RenderPassAssetTag>(name),
                depthTest: depthTest,
                cull: cull,
                blend: blend);
            Assets.RenderPasses.Register(definition);
            return definition;
        }

        public void Dispose()
        {
            Cache.Dispose();
            Context.Dispose();
        }
    }
}
