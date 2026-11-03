using Axrone.Lighting;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.FrameGraph;
using Axrone.Render.OpenGL.FrameGraph.Passes;
using Axrone.Render.OpenGL.Shading;

namespace Axrone.Render.OpenGL.Tests;

/// <summary>
/// Tests for the mechanism render passes in the frame graph system, built through the
/// per-pass factories in <c>Axrone.Render.OpenGL.FrameGraph.Passes</c>.
/// Covers factory initialization (Name, Kind), creation-time configuration and
/// per-frame payload mutation through <c>pass.Data</c>, and Validate() pre-condition
/// checks. Effect pass tests live in Axrone.Render.Effects.Tests.
/// </summary>
public sealed class PassExecutorTests : IDisposable
{
    private static readonly string[] ComputeBindingResourceNames = ["buffer1", "image1", "ubo1"];
    private static readonly string[] FullscreenTextureNames = ["tex0", "tex1", "tex2"];
    private static readonly string[] CustomReadResources = ["input_texture"];
    private static readonly string[] CustomWriteResources = ["output_texture"];

    private readonly MockGLApi _mock;
    private readonly GLContext _context;

    public PassExecutorTests()
    {
        _mock = new MockGLApi();
        _context = new GLContext(_mock);
    }

    // =========================================================================
    // ClearPass Tests
    // =========================================================================

    [Fact]
    public void ClearPass_Create_SetsCorrectNameAndKind()
    {
        var pass = ClearPass.Create("clear", clearColor: new Vec4(0, 0, 0, 1));

        pass.Name.Should().Be("clear");
        pass.Kind.Should().Be(FramePassKind.Clear);
    }

    [Fact]
    public void ClearPass_ClearColor_IsCapturedInPayload()
    {
        var pass = ClearPass.Create("clear", clearColor: new Vec4(0.25f, 0.5f, 0.75f, 1f));

        pass.Data.ClearColor.Should().Be(new Vec4(0.25f, 0.5f, 0.75f, 1f));
        pass.Data.ClearDepth.Should().Be(1f);
        pass.Data.ClearStencil.Should().Be(0);
        pass.Data.ClearColorEnabled.Should().BeTrue();
        pass.Data.ClearDepthEnabled.Should().BeTrue();
        pass.Data.ClearStencilEnabled.Should().BeFalse();
    }

    [Fact]
    public void ClearPass_Validate_ThrowsWhenNoBuffersToClear()
    {
        var pass = ClearPass.Create(
            "clear",
            clearColorEnabled: false,
            clearDepthEnabled: false,
            clearStencilEnabled: false);

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);
    }

    [Fact]
    public void ClearPass_Validate_DoesNotThrowWhenClearColorEnabled()
    {
        var pass = ClearPass.Create("clear", clearColorEnabled: true);

        var action = () => pass.Validate();

        action.Should().NotThrow();
    }

    [Fact]
    public void ClearPass_IsEnabled_DefaultsToTrue()
    {
        var pass = ClearPass.Create("clear");

        pass.IsEnabled.Should().BeTrue();
    }

    [Fact]
    public void ClearPass_TargetFramebufferName_DeclaresReadDependency()
    {
        var pass = ClearPass.Create("clear", "hdr_fbo");

        pass.Data.TargetFramebufferName.Should().Be("hdr_fbo");
        pass.GetReadResources().ToArray().Should().Contain("hdr_fbo");
    }

    // =========================================================================
    // OpaquePass Tests
    // =========================================================================

    [Fact]
    public void OpaquePass_Create_SetsCorrectNameAndKind()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = OpaquePass.Create("opaque", program);

        pass.Name.Should().Be("opaque");
        pass.Kind.Should().Be(FramePassKind.Opaque);
        pass.Data.Program.Should().BeSameAs(program);
        pass.Data.Meshes.Should().BeEmpty();

        program.Dispose();
    }

    [Fact]
    public void OpaquePass_TargetFramebufferName_DeclaresWriteDependency()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = OpaquePass.Create("opaque", program, "scene_fbo");

        pass.Data.TargetFramebufferName.Should().Be("scene_fbo");
        pass.GetWrittenResources().ToArray().Should().Contain("scene_fbo");

        program.Dispose();
    }

    [Fact]
    public void OpaquePass_Validate_ThrowsWhenProgramDisposed()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = OpaquePass.Create("opaque", program);
        program.Dispose();

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);
    }

    [Fact]
    public void OpaquePass_Validate_DoesNotThrowWithValidProgram()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = OpaquePass.Create("opaque", program);

        var action = () => pass.Validate();

        action.Should().NotThrow();

        program.Dispose();
    }

    // =========================================================================
    // TransparentPass Tests
    // =========================================================================

    [Fact]
    public void TransparentPass_Create_SetsCorrectNameAndKind()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = TransparentPass.Create("transparent", program);

        pass.Name.Should().Be("transparent");
        pass.Kind.Should().Be(FramePassKind.Transparent);
        pass.Data.Program.Should().BeSameAs(program);
        pass.Data.Entries.Should().BeEmpty();

        program.Dispose();
    }

    [Fact]
    public void TransparentPass_Validate_ThrowsWhenProgramDisposed()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = TransparentPass.Create("transparent", program);
        program.Dispose();

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);
    }

    [Fact]
    public void TransparentPass_Validate_DoesNotThrowWithValidProgram()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = TransparentPass.Create("transparent", program);

        var action = () => pass.Validate();

        action.Should().NotThrow();

        program.Dispose();
    }

    // =========================================================================
    // ComputePass Tests
    // =========================================================================

    [Fact]
    public void ComputePass_Create_SetsCorrectNameAndKind()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create("compute", shader);

        pass.Name.Should().Be("compute");
        pass.Kind.Should().Be(FramePassKind.Compute);
        pass.Data.ComputeShader.Should().BeSameAs(shader);

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_DispatchSize_SetsGroupCounts()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create("compute", shader);

        pass.Data.GroupCountX = 8u;
        pass.Data.GroupCountY = 4u;
        pass.Data.GroupCountZ = 2u;

        pass.Data.GroupCountX.Should().Be(8u);
        pass.Data.GroupCountY.Should().Be(4u);
        pass.Data.GroupCountZ.Should().Be(2u);

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_CreationTimeGroupCounts_AreCapturedInPayload()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create("compute", shader, groupCountX: 8, groupCountY: 4, groupCountZ: 2);

        pass.Data.GroupCountX.Should().Be(8u);
        pass.Data.GroupCountY.Should().Be(4u);
        pass.Data.GroupCountZ.Should().Be(2u);

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_DefaultDispatchSize_IsOneOneOne()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create("compute", shader);

        pass.Data.GroupCountX.Should().Be(1u);
        pass.Data.GroupCountY.Should().Be(1u);
        pass.Data.GroupCountZ.Should().Be(1u);

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_Validate_ThrowsWhenGroupCountXLessThanOne()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create("compute", shader);
        pass.Data.GroupCountX = 0u;

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_StorageBufferBinding_AddsBindingAndReadDependency()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create(
            "compute",
            shader,
            bindings: new[] { new ComputeResourceBinding(0, "myBuffer", ComputeBindingType.ShaderStorageBuffer) });

        pass.Data.Bindings.Should().HaveCount(1);
        pass.Data.Bindings[0].BindingPoint.Should().Be(0u);
        pass.Data.Bindings[0].ResourceName.Should().Be("myBuffer");
        pass.Data.Bindings[0].Type.Should().Be(ComputeBindingType.ShaderStorageBuffer);
        pass.GetReadResources().ToArray().Should().Contain("myBuffer");

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_ImageBinding_AddsBinding()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create(
            "compute",
            shader,
            bindings: new[] { new ComputeResourceBinding(1, "outputImage", ComputeBindingType.Image) });

        pass.Data.Bindings.Should().HaveCount(1);
        pass.Data.Bindings[0].Type.Should().Be(ComputeBindingType.Image);

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_UniformBufferBinding_AddsBinding()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create(
            "compute",
            shader,
            bindings: new[] { new ComputeResourceBinding(2, "params", ComputeBindingType.UniformBuffer) });

        pass.Data.Bindings.Should().HaveCount(1);
        pass.Data.Bindings[0].Type.Should().Be(ComputeBindingType.UniformBuffer);

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_MultipleBindings_AllTracked()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create(
            "compute",
            shader,
            bindings: new[]
            {
                new ComputeResourceBinding(0, "buffer1", ComputeBindingType.ShaderStorageBuffer),
                new ComputeResourceBinding(1, "image1", ComputeBindingType.Image),
                new ComputeResourceBinding(2, "ubo1", ComputeBindingType.UniformBuffer),
            });

        pass.Data.Bindings.Should().HaveCount(3);
        pass.GetReadResources().ToArray().Should().BeEquivalentTo(ComputeBindingResourceNames);

        shader.Dispose();
    }

    [Fact]
    public void ComputePass_Validate_DoesNotThrowWithValidConfig()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = ComputePass.Create("compute", shader, groupCountX: 4, groupCountY: 4);

        var action = () => pass.Validate();

        action.Should().NotThrow();

        shader.Dispose();
    }

    // =========================================================================
    // FullscreenQuadPass Tests
    // =========================================================================

    [Fact]
    public void FullscreenQuadPass_Create_SetsCorrectNameAndKind()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create("fullscreen", shader);

        pass.Name.Should().Be("fullscreen");
        pass.Kind.Should().Be(FramePassKind.FullscreenQuad);
        pass.Data.Shader.Should().BeSameAs(shader);

        shader.Dispose();
    }

    [Fact]
    public void FullscreenQuadPass_TextureBindings_AddsTextureBinding()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create(
            "fullscreen",
            shader,
            textureBindings: new[] { (0, "inputTex") });

        pass.Data.TextureBindings.Should().HaveCount(1);
        pass.Data.TextureBindings[0].Unit.Should().Be(0);
        pass.Data.TextureBindings[0].TextureName.Should().Be("inputTex");
        pass.GetReadResources().ToArray().Should().Contain("inputTex");

        shader.Dispose();
    }

    [Fact]
    public void FullscreenQuadPass_MultipleTextureBindings_AllTracked()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create(
            "fullscreen",
            shader,
            textureBindings: new[] { (0, "tex0"), (1, "tex1"), (2, "tex2") });

        pass.Data.TextureBindings.Should().HaveCount(3);
        pass.GetReadResources().ToArray().Should().BeEquivalentTo(FullscreenTextureNames);

        shader.Dispose();
    }

    [Fact]
    public void FullscreenQuadPass_Validate_ThrowsWhenTextureUnitOutOfRange()
    {
        var shader = new GLProgram(_context, "vs", "fs");

        // 32 is out of [0, 31]
        var pass = FullscreenQuadPass.Create(
            "fullscreen",
            shader,
            textureBindings: new[] { (32, "inputTex") });

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);

        shader.Dispose();
    }

    [Fact]
    public void FullscreenQuadPass_Validate_ThrowsWhenTextureUnitNegative()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create(
            "fullscreen",
            shader,
            textureBindings: new[] { (-1, "inputTex") });

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);

        shader.Dispose();
    }

    [Fact]
    public void FullscreenQuadPass_OutputFramebufferName_SetsOutputFramebuffer()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create("fullscreen", shader, "output_fbo");

        pass.Data.OutputFramebufferName.Should().Be("output_fbo");
        pass.GetWrittenResources().ToArray().Should().Contain("output_fbo");

        shader.Dispose();
    }

    [Fact]
    public void FullscreenQuadPass_OutputFramebufferName_DefaultsToNull()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create("fullscreen", shader);

        pass.Data.OutputFramebufferName.Should().BeNull();

        shader.Dispose();
    }

    [Fact]
    public void FullscreenQuadPass_UniformCallback_IsCapturedInPayload()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        Action<GLContext, GLProgram> uniformCallback = (ctx, prog) => { };
        var pass = FullscreenQuadPass.Create("fullscreen", shader, uniformCallback: uniformCallback);

        pass.Data.UniformCallback.Should().BeSameAs(uniformCallback);

        shader.Dispose();
    }

    [Fact]
    public void FullscreenQuadPass_Validate_DoesNotThrowWithValidConfig()
    {
        var shader = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create(
            "fullscreen",
            shader,
            textureBindings: new[] { (0, "inputTex") });

        var action = () => pass.Validate();

        action.Should().NotThrow();

        shader.Dispose();
    }

    // =========================================================================
    // BlitPass Tests
    // =========================================================================

    [Fact]
    public void BlitPass_Create_SetsCorrectNameAndKind()
    {
        var pass = BlitPass.Create("blit", "source_fbo", "dest_fbo");

        pass.Name.Should().Be("blit");
        pass.Kind.Should().Be(FramePassKind.Blit);
    }

    [Fact]
    public void BlitPass_Validate_ThrowsWhenSourceAndDestinationAreSame()
    {
        var pass = BlitPass.Create("blit", "same_fbo", "same_fbo");

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);
    }

    [Fact]
    public void BlitPass_Validate_DoesNotThrowWhenDifferent()
    {
        var pass = BlitPass.Create("blit", "source_fbo", "dest_fbo");

        var action = () => pass.Validate();

        action.Should().NotThrow();
    }

    [Fact]
    public void BlitPass_DeclaresCorrectResourceDependencies()
    {
        var pass = BlitPass.Create("blit", "source_fbo", "dest_fbo");

        pass.GetReadResources().ToArray().Should().Contain("source_fbo");
        pass.GetWrittenResources().ToArray().Should().Contain("dest_fbo");
    }

    // =========================================================================
    // CustomPass Tests
    // =========================================================================

    [Fact]
    public void CustomPass_Create_SetsCorrectNameAndKind()
    {
        var pass = CustomPass.Create("custom", FramePassKind.Custom, (ctx, execCtx) => { });

        pass.Name.Should().Be("custom");
        pass.Kind.Should().Be(FramePassKind.Custom);
    }

    [Fact]
    public void CustomPass_Create_AcceptsAnyPassKind()
    {
        var pass = CustomPass.Create("custom_post", FramePassKind.PostProcess, (ctx, execCtx) => { });

        pass.Kind.Should().Be(FramePassKind.PostProcess);
    }

    [Fact]
    public void CustomPass_ExecuteCallback_IsAccessible()
    {
        Action<GLContext, PassExecutionContext> callback = (ctx, execCtx) => { };
        var pass = CustomPass.Create("custom", FramePassKind.Custom, callback);

        pass.Data.ExecuteCallback.Should().BeSameAs(callback);
    }

    [Fact]
    public void CustomPass_Validate_InvokesValidateCallback()
    {
        bool validateInvoked = false;
        var pass = CustomPass.Create(
            "custom",
            FramePassKind.Custom,
            (ctx, execCtx) => { },
            () => { validateInvoked = true; });

        pass.Validate();

        validateInvoked.Should().BeTrue();
    }

    [Fact]
    public void CustomPass_ValidateCallback_IsAccessible()
    {
        Action validateCallback = () => { };
        var pass = CustomPass.Create(
            "custom",
            FramePassKind.Custom,
            (ctx, execCtx) => { },
            validateCallback);

        pass.Data.ValidateCallback.Should().BeSameAs(validateCallback);
    }

    [Fact]
    public void CustomPass_ValidateCallbackIsNull_DoesNotThrow()
    {
        var pass = CustomPass.Create("custom", FramePassKind.Custom, (ctx, execCtx) => { });

        var action = () => pass.Validate();

        action.Should().NotThrow();
    }

    [Fact]
    public void CustomPass_Reads_DeclaresReadResource()
    {
        var pass = CustomPass.Create(
            "custom",
            FramePassKind.Custom,
            (ctx, execCtx) => { },
            reads: CustomReadResources);

        pass.GetReadResources().ToArray().Should().Contain("input_texture");
    }

    [Fact]
    public void CustomPass_Writes_DeclaresWrittenResource()
    {
        var pass = CustomPass.Create(
            "custom",
            FramePassKind.Custom,
            (ctx, execCtx) => { },
            writes: CustomWriteResources);

        pass.GetWrittenResources().ToArray().Should().Contain("output_texture");
    }

    // =========================================================================
    // ShadowPass Tests
    // =========================================================================

    [Fact]
    public void ShadowPass_Create_SetsCorrectNameAndKind()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = ShadowPass.Create(
            "shadow",
            program,
            "shadow_map",
            "shadow_fbo",
            Mat4.Identity);

        pass.Name.Should().Be("shadow");
        pass.Kind.Should().Be(FramePassKind.Shadow);
        pass.Data.DepthProgram.Should().BeSameAs(program);
        pass.Data.LightViewProjection.Should().Be(Mat4.Identity);
        pass.Data.ShadowMapWidth.Should().Be(2048);
        pass.Data.ShadowMapHeight.Should().Be(2048);

        program.Dispose();
    }

    [Fact]
    public void ShadowPass_LightViewProjection_IsMutableForPerFrameUpdates()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = ShadowPass.Create(
            "shadow",
            program,
            "shadow_map",
            "shadow_fbo",
            Mat4.Identity);

        Mat4 updated = Mat4.CreateTranslation(1f, 2f, 3f);
        pass.Data.LightViewProjection = updated;

        pass.Data.LightViewProjection.Should().Be(updated);

        program.Dispose();
    }

    [Fact]
    public void ShadowPass_Validate_ThrowsWhenProgramDisposed()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = ShadowPass.Create(
            "shadow",
            program,
            "shadow_map",
            "shadow_fbo",
            Mat4.Identity);
        program.Dispose();

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);
    }

    [Fact]
    public void ShadowPass_Validate_DoesNotThrowWithValidProgram()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = ShadowPass.Create(
            "shadow",
            program,
            "shadow_map",
            "shadow_fbo",
            Mat4.Identity);

        var action = () => pass.Validate();

        action.Should().NotThrow();

        program.Dispose();
    }

    [Fact]
    public void ShadowPass_DeclaresCorrectResourceDependencies()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = ShadowPass.Create(
            "shadow",
            program,
            "shadow_map",
            "shadow_fbo",
            Mat4.Identity);

        pass.GetWrittenResources().ToArray().Should().Contain("shadow_map");
        pass.GetWrittenResources().ToArray().Should().Contain("shadow_fbo");

        program.Dispose();
    }

    [Fact]
    public void ShadowPass_CascadeFactory_KeepsLegacyPathSeparate()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var cascades = NewCascadeFrame();
        var pass = ShadowPass.Create(
            "cascaded-shadow",
            program,
            "shadow_map",
            "shadow_fbo",
            cascades,
            2048,
            2048);

        pass.Data.Cascades.Should().BeSameAs(cascades);
        pass.Data.Meshes.Should().NotBeNull();
        var legacyPass = ShadowPass.Create(
            "legacy-shadow",
            program,
            "shadow_map",
            "shadow_fbo",
            Mat4.Identity);
        legacyPass.Data.Cascades.Should().BeNull();

        program.Dispose();
    }

    [Fact]
    public void ShadowPass_CascadeValidate_RejectsMismatchedAtlas()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var cascades = NewCascadeFrame();
        var data = new ShadowPassData
        {
            DepthProgram = program,
            ShadowMapTextureName = "shadow_map",
            ShadowFramebufferName = "shadow_fbo",
            Cascades = cascades,
            ShadowMapWidth = 1024,
            ShadowMapHeight = 2048,
            Meshes = []
        };

        Action validate = () => ShadowPassData.Validate(in data);
        validate.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);

        program.Dispose();
    }

    [Fact]
    public void ShadowPass_CascadeValidate_AcceptsFourByFourGrid()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var cascades = NewCascadeFrame();
        var data = new ShadowPassData
        {
            DepthProgram = program,
            ShadowMapTextureName = "shadow_map",
            ShadowFramebufferName = "shadow_fbo",
            Cascades = cascades,
            ShadowMapWidth = 2048,
            ShadowMapHeight = 2048,
            Meshes = []
        };

        Action validate = () => ShadowPassData.Validate(in data);
        validate.Should().NotThrow();

        program.Dispose();
    }

    private static ShadowFrameData NewCascadeFrame()
    {
        var frame = new ShadowFrameData();
        var camera = new ShadowCameraParameters(
            Vec3.Zero,
            new Vec3(0.0f, 0.0f, -1.0f),
            Vec3.UnitY,
            Vec3.UnitX,
            MathF.PI / 3.0f,
            1.0f,
            0.1f,
            500.0f);
        Vec3 lightDirection = new(-0.35f, -0.9f, -0.25f);
        ShadowCascadeFrameBuilder.Build(
            frame,
            ShadowSettings.Default,
            in camera,
            in lightDirection,
            2048,
            2048);
        return frame;
    }

    // =========================================================================
    // PostProcessPass Tests
    // =========================================================================

    [Fact]
    public void PostProcessPass_Create_SetsCorrectNameAndKind()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = PostProcessPass.Create("postprocess", program, "input_tex");

        pass.Name.Should().Be("postprocess");
        pass.Kind.Should().Be(FramePassKind.PostProcess);
        pass.Data.Program.Should().BeSameAs(program);
        pass.Data.InputTextureName.Should().Be("input_tex");
        pass.Data.Phase.Should().Be(PostProcessPhase.AfterTonemap);

        program.Dispose();
    }

    [Fact]
    public void PostProcessPass_Validate_ThrowsWhenProgramDisposed()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = PostProcessPass.Create("postprocess", program, "input_tex");
        program.Dispose();

        var action = () => pass.Validate();

        action.Should().Throw<RenderException>()
            .Where(e => e.Code == RenderErrorCode.InvalidPassConfiguration);
    }

    [Fact]
    public void PostProcessPass_Validate_DoesNotThrowWithValidProgram()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = PostProcessPass.Create("postprocess", program, "input_tex");

        var action = () => pass.Validate();

        action.Should().NotThrow();

        program.Dispose();
    }

    [Fact]
    public void PostProcessPass_UniformSetter_IsStoredInPayload()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = PostProcessPass.Create("postprocess", program, "input_tex");

        pass.Data.UniformSetters["u_param"] = (ctx, prog) => { };

        pass.Data.UniformSetters.Should().ContainKey("u_param");

        program.Dispose();
    }

    [Fact]
    public void PostProcessPass_DeclaresCorrectReadResource()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = PostProcessPass.Create("postprocess", program, "input_tex");

        pass.GetReadResources().ToArray().Should().Contain("input_tex");

        program.Dispose();
    }

    [Fact]
    public void PostProcessPass_OutputFramebuffer_DeclaresWriteResource()
    {
        var program = new GLProgram(_context, "vs", "fs");
        var pass = PostProcessPass.Create("postprocess", program, "input_tex", "output_fbo");

        pass.Data.OutputFramebufferName.Should().Be("output_fbo");
        pass.GetWrittenResources().ToArray().Should().Contain("output_fbo");

        program.Dispose();
    }

    public void Dispose()
    {
        _context.Dispose();
    }
}
