using Axrone.Render.Core.Abstractions;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.FrameGraph;
using Axrone.Render.OpenGL.FrameGraph.Passes;
using Axrone.Render.OpenGL.Native;
using Axrone.Render.OpenGL.Resources;
using Axrone.Render.OpenGL.Shading;
using Axrone.Render.OpenGL.Texture;

namespace Axrone.Render.OpenGL.Tests;

/// <summary>
/// Covers the monomorphic (static-abstract, zero-vtable) fullscreen command path:
/// dispatch mechanics, the recording-invoker contract, blend restoration through
/// the state cache, and the <see cref="FullscreenQuadPass"/> proof path.
/// </summary>
public sealed class FullscreenCommandTests : IDisposable
{
    private const string DrawArraysCall = "DrawArrays(4, 0, 3)"; // GL_TRIANGLES, first 0, count 3
    private const string DisableBlendCall = "Disable(3042)";       // 0x0BE2 = GL_BLEND

    private readonly MockGLApi _mock;
    private readonly GLContext _context;

    public FullscreenCommandTests()
    {
        _mock = new MockGLApi();
        _context = new GLContext(_mock);
    }

    /// <summary>
    /// Runs one pass on the direct leg: the same
    /// <see cref="IRenderContext"/>-native seam the frame graph uses, built over
    /// the pass's own <see cref="PassExecutionContext"/>. The pass itself decides
    /// whether the monomorphic command path or the established one runs.
    /// </summary>
    private void ExecutePass(IRenderPass pass, PassExecutionContext execCtx)
    {
        var renderCtx = new GLRenderContext(_context, execCtx);
        pass.Execute(renderCtx);
    }

    // =========================================================================
    // Dispatch mechanics — recording invoker, no vtable, no heap
    // =========================================================================

    [Fact]
    public void Dispatch_InvokesEveryInvokerMember_ExactlyOnce()
    {
        var recorder = new CallRecorder();
        var invoker = new RecordingInvoker(recorder);
        var command = new FullscreenTriangleCommand<RecordingInvoker>(42u);
        command.AddTextureBind(3u, 99u);
        command.AddUniform1f(7, 1.5f);
        command.BlendEnabled = true;
        command.BlendSrcFactor = 0x0302; // GLConst.SrcAlpha
        command.BlendDstFactor = 0x0303; // GLConst.OneMinusSrcAlpha

        FullscreenDispatcher.Dispatch(ref invoker, ref command);

        recorder.ProgramCalls.Should().Be(1);
        recorder.TextureCalls.Should().Be(1);
        recorder.UniformCalls.Should().Be(1);
        recorder.BlendCalls.Should().Be(1);
        recorder.DrawCalls.Should().Be(1);

        recorder.LastProgram.Should().Be(42u);
        recorder.LastUnit.Should().Be(3u);
        recorder.LastTexture.Should().Be(99u);
        recorder.LastLocation.Should().Be(7);
        recorder.LastUniformValue.Should().Be(1.5f);
        recorder.LastBlendEnabled.Should().BeTrue();
        recorder.LastSrcFactor.Should().Be(0x0302u);
        recorder.LastDstFactor.Should().Be(0x0303u);
    }

    [Fact]
    public void Dispatch_ReplaysInFullscreenOrder_ProgramTexturesUniformsBlendDraw()
    {
        var recorder = new CallRecorder();
        var invoker = new RecordingInvoker(recorder);
        var command = new FullscreenTriangleCommand<RecordingInvoker>(1u);
        command.AddTextureBind(0u, 2u);
        command.AddUniform1f(0, 1f);

        FullscreenDispatcher.Dispatch(ref invoker, ref command);

        recorder.ProgramStep.Should().BeLessThan(recorder.TextureStep);
        recorder.TextureStep.Should().BeLessThan(recorder.UniformStep);
        recorder.UniformStep.Should().BeLessThan(recorder.BlendStep);
        recorder.BlendStep.Should().BeLessThan(recorder.DrawStep);
    }

    [Fact]
    public void Dispatch_ReusesInvokerAcrossCommands()
    {
        var recorder = new CallRecorder();
        var invoker = new RecordingInvoker(recorder);
        var first = new FullscreenTriangleCommand<RecordingInvoker>(1u);
        var second = new FullscreenTriangleCommand<RecordingInvoker>(2u);

        FullscreenDispatcher.Dispatch(ref invoker, ref first);
        FullscreenDispatcher.Dispatch(ref invoker, ref second);

        recorder.ProgramCalls.Should().Be(2);
        recorder.DrawCalls.Should().Be(2);
        recorder.LastProgram.Should().Be(2u);
    }

    [Fact]
    public void Dispatch_OverManyCommands_AllocatesNothing()
    {
        var recorder = new CallRecorder();
        var invoker = new RecordingInvoker(recorder);
        var command = new FullscreenTriangleCommand<RecordingInvoker>(5u);
        command.AddTextureBind(1u, 11u);
        command.AddUniform1f(2, 0.5f);

        // Warm the JIT so tier-0 recompilation cannot pollute the measurement.
        FullscreenDispatcher.Dispatch(ref invoker, ref command);

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1_000; i++)
        {
            FullscreenDispatcher.Dispatch(ref invoker, ref command);
        }
        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;

        allocated.Should().Be(0, "monomorphic dispatch must not box the struct invoker or allocate");
        recorder.DrawCalls.Should().Be(1_001);
    }

    [Fact]
    public void Command_RejectsBindsBeyondInlineCapacity()
    {
        var command = new FullscreenTriangleCommand<RecordingInvoker>(1u);
        for (int i = 0; i < FullscreenCommandLimits.MaxTextureBinds; i++)
        {
            command.AddTextureBind((uint)i, (uint)i);
        }

        Action overflow = () => command.AddTextureBind(9u, 9u);

        overflow.Should().Throw<ArgumentException>();
        command.TextureBindCount.Should().Be(FullscreenCommandLimits.MaxTextureBinds);
    }

    [Fact]
    public void Command_RejectsUniformsBeyondInlineCapacity()
    {
        var command = new FullscreenTriangleCommand<RecordingInvoker>(1u);
        for (int i = 0; i < FullscreenCommandLimits.MaxUniforms; i++)
        {
            command.AddUniform1f(i, i);
        }

        Action overflow = () => command.AddUniform1f(9, 9f);

        overflow.Should().Throw<ArgumentException>();
        command.UniformCount.Should().Be(FullscreenCommandLimits.MaxUniforms);
    }

    [Fact]
    public void GLContextInvoker_RejectsNullContext()
    {
        Action construct = () => _ = new GLContextInvoker(null!);

        construct.Should().Throw<ArgumentNullException>();
    }

    // =========================================================================
    // GLContextInvoker — blend restoration through the state cache
    // =========================================================================

    [Fact]
    public void GLContextInvoker_BlendDisable_IssuesFuncAndDisableBeforeDraw_AndUpdatesCache()
    {
        // A preceding geometry pass left blending on with alpha fentities.
        _context.State.SetBlendFuncSeparate(GLConst.SrcAlpha, GLConst.OneMinusSrcAlpha,
            GLConst.SrcAlpha, GLConst.OneMinusSrcAlpha);
        _context.State.SetBlend(true);
        _mock.ClearCallLog();

        var invoker = new GLContextInvoker(_context);
        var command = new FullscreenTriangleCommand<GLContextInvoker>(1u); // default: blend off, One/Zero

        FullscreenDispatcher.Dispatch(ref invoker, ref command);

        _context.State.BlendEnabled.Should().BeFalse("blend disable must go through the state cache");

        int funcIndex = _mock.CallLog.ToList().FindIndex(e => e.StartsWith("BlendFuncSeparate(", StringComparison.Ordinal));
        int disableIndex = _mock.CallLog.ToList().FindIndex(e => e == DisableBlendCall);
        int drawIndex = _mock.CallLog.ToList().FindIndex(e => e == DrawArraysCall);

        funcIndex.Should().BeGreaterThanOrEqualTo(0);
        disableIndex.Should().BeGreaterThan(funcIndex, "blend func must be pushed before the enable bit changes");
        drawIndex.Should().BeGreaterThan(disableIndex, "state must be restored before the draw is issued");
    }

    [Fact]
    public void GLContextInvoker_BlendReEnable_AfterFullscreenPass_ReprogramsFentitiesOnce()
    {
        // A valid (non-invalidated) cache is what a real frame sees after Reset().
        _context.State.Reset();

        // Fullscreen pass disables blending and records One/Zero.
        var invoker = new GLContextInvoker(_context);
        var fullscreen = new FullscreenTriangleCommand<GLContextInvoker>(1u);
        FullscreenDispatcher.Dispatch(ref invoker, ref fullscreen);

        // A later blended pass re-enables with the same fentities the fullscreen pass
        // left behind: the cache dedupes, so the driver sees exactly one factor change.
        _mock.ClearCallLog();
        var blended = new FullscreenTriangleCommand<GLContextInvoker>(1u);
        blended.BlendEnabled = true;
        blended.BlendSrcFactor = GLConst.One;
        blended.BlendDstFactor = GLConst.Zero;
        FullscreenDispatcher.Dispatch(ref invoker, ref blended);

        _mock.CallLog.Should().NotContain(e => e.StartsWith("BlendFuncSeparate(", StringComparison.Ordinal));
        _mock.CallLog.Should().Contain("Enable(3042)");
        _mock.CallLog.Should().Contain(DrawArraysCall);
    }

    [Fact]
    public void GLContextInvoker_Commands_ReachMockApiWithExpectedArguments()
    {
        var invoker = new GLContextInvoker(_context);
        var command = new FullscreenTriangleCommand<GLContextInvoker>(77u);
        command.AddTextureBind(2u, 88u);
        command.AddUniform1f(4, 0.25f);
        command.BlendEnabled = true;
        command.BlendSrcFactor = GLConst.SrcAlpha;
        command.BlendDstFactor = GLConst.OneMinusSrcAlpha;
        _mock.ClearCallLog();

        FullscreenDispatcher.Dispatch(ref invoker, ref command);

        _mock.CallLog.Should().Contain("UseProgram(77)");
        _mock.CallLog.Should().Contain("ActiveTexture(33986)"); // GL_TEXTURE0 + 2
        _mock.CallLog.Should().Contain($"BindTexture({GLConst.Texture2D}, 88)");
        _mock.CallLog.Should().Contain("Uniform1(4, 0.25)");
        _mock.CallLog.Should().Contain($"BlendFuncSeparate({GLConst.SrcAlpha}, {GLConst.OneMinusSrcAlpha}, {GLConst.SrcAlpha}, {GLConst.OneMinusSrcAlpha})");
        _mock.CallLog.Should().Contain(DrawArraysCall);
    }

    // =========================================================================
    // Proof path — FullscreenQuadPass routed through the dispatcher
    // =========================================================================

    [Fact]
    public void FullscreenQuadPass_ExecuteMonomorphic_IssuesProgramBindAndDraw()
    {
        using var program = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create("fullscreen", program);
        var execCtx = new PassExecutionContext(_context);
        _mock.ClearCallLog();

        ExecutePass(pass, execCtx);

        _mock.CallLog.Should().Contain($"UseProgram({program.Id})");
        _mock.CallLog.Should().Contain(DrawArraysCall);
        _mock.CallLog.ToList().FindIndex(e => e.StartsWith("UseProgram(", StringComparison.Ordinal))
            .Should().BeLessThan(_mock.CallLog.ToList().FindIndex(e => e == DrawArraysCall));
    }

    [Fact]
    public void FullscreenQuadPass_ExecuteMonomorphic_MatchesBaselineCallSequence()
    {
        using var program = new GLProgram(_context, "vs", "fs");
        var texture = new GLTexture(_context, GLConst.Texture2D, TextureFormat.Rgba8, 8, 8);
        var execCtx = new PassExecutionContext(_context);
        execCtx.SetResource("input", texture);

        List<(int Unit, string TextureName)> bindings = [(1, "input")];

        // No uniform callback and one inline texture bind: the fast path.
        var monomorphic = FullscreenQuadPass.Create("fullscreen", program, textureBindings: bindings);
        // A uniform callback is outside the command vocabulary: the established path.
        var established = FullscreenQuadPass.Create("fullscreen", program, textureBindings: bindings,
            uniformCallback: (_, _) => { });

        // Invalidate the state cache before each leg so both replay the same
        // driver traffic instead of deduping the second one against the first.
        _context.State.Invalidate();
        _mock.ClearCallLog();
        ExecutePass(monomorphic, execCtx);
        List<string> monomorphicLines = _mock.CallLog.ToList();

        _context.State.Invalidate();
        _mock.ClearCallLog();
        ExecutePass(established, execCtx);
        List<string> baseline = _mock.CallLog.ToList();

        monomorphicLines.Should().NotBeEmpty("a vacuous pass would compare equal against anything");
        baseline.Should().NotBeEmpty("a vacuous pass would compare equal against anything");
        monomorphicLines.Should().Contain(baseline, "the monomorphic path must issue the same GL traffic");
    }

    [Fact]
    public void FullscreenQuadPass_ExecuteMonomorphic_BindsTexturesAndDisablesBlend()
    {
        using var program = new GLProgram(_context, "vs", "fs");
        var texture = new GLTexture(_context, GLConst.Texture2D, TextureFormat.Rgba8, 8, 8);
        List<(int Unit, string TextureName)> bindings = [(0, "input")];
        var pass = FullscreenQuadPass.Create("fullscreen", program, textureBindings: bindings);
        var execCtx = new PassExecutionContext(_context);
        execCtx.SetResource("input", texture);

        _context.State.SetBlend(true);
        _mock.ClearCallLog();

        ExecutePass(pass, execCtx);

        _mock.CallLog.Should().Contain($"BindTexture({GLConst.Texture2D}, {texture.Id})");
        _mock.CallLog.Should().Contain(DisableBlendCall);
        _context.State.BlendEnabled.Should().BeFalse();
    }

    [Fact]
    public void FullscreenQuadPass_Execute_WithUniformCallback_TakesEstablishedPath()
    {
        using var program = new GLProgram(_context, "vs", "fs");
        bool callbackInvoked = false;
        var pass = FullscreenQuadPass.Create("fullscreen", program,
            uniformCallback: (_, _) => callbackInvoked = true);
        var execCtx = new PassExecutionContext(_context);
        _mock.ClearCallLog();

        ExecutePass(pass, execCtx);

        callbackInvoked.Should().BeTrue("a custom uniform callback is outside the command vocabulary");
        _mock.CallLog.Should().Contain(DrawArraysCall);
    }

    [Fact]
    public void FullscreenQuadPass_ExecuteMonomorphic_BeyondInlineCapacity_TakesEstablishedPath()
    {
        using var program = new GLProgram(_context, "vs", "fs");
        var execCtx = new PassExecutionContext(_context);
        List<(int Unit, string TextureName)> bindings = [];
        for (int i = 0; i <= FullscreenCommandLimits.MaxTextureBinds; i++)
        {
            string name = $"tex{i}";
            bindings.Add((i, name));
            execCtx.SetResource(name, new GLTexture(_context, GLConst.Texture2D, TextureFormat.Rgba8, 8, 8));
        }

        var pass = FullscreenQuadPass.Create("fullscreen", program, textureBindings: bindings);

        _mock.ClearCallLog();

        ExecutePass(pass, execCtx);

        _mock.CallLog.Should().Contain(DrawArraysCall);
    }

    [Fact]
    public void FullscreenQuadPass_Execute_WithUniformCallback_LeavesBlendStateUntouched()
    {
        using var program = new GLProgram(_context, "vs", "fs");
        var pass = FullscreenQuadPass.Create("fullscreen", program, uniformCallback: (_, _) => { });
        var execCtx = new PassExecutionContext(_context);
        _context.State.SetBlend(true);
        _mock.ClearCallLog();

        ExecutePass(pass, execCtx);

        // The established path must not gain blend bookkeeping from this slice.
        _mock.CallLog.Should().NotContain(DisableBlendCall);
        _context.State.BlendEnabled.Should().BeTrue();
        _mock.CallLog.Should().Contain(DrawArraysCall);
    }

    public void Dispose()
    {
        _context.Dispose();
    }

    /// <summary>
    /// Hand-written invoker that records every call. The counters live in a
    /// pre-allocated recorder (allocated once by the test, never by a dispatch)
    /// because an <c>in</c> context is a readonly reference: a static abstract
    /// member may mutate what the invoker points at, but may not assign to the
    /// invoker's own fields.
    /// </summary>
    private readonly struct RecordingInvoker : IGLFullscreenInvoker<RecordingInvoker>
    {
        private readonly CallRecorder _recorder;

        public RecordingInvoker(CallRecorder recorder)
        {
            _recorder = recorder;
        }

        public static void UseProgram(in RecordingInvoker ctx, uint program)
        {
            CallRecorder recorder = ctx._recorder;
            recorder.ProgramCalls++;
            recorder.LastProgram = program;
            recorder.ProgramStep = ++recorder.Step;
        }

        public static void BindTextureUnit(in RecordingInvoker ctx, uint unit, uint texture)
        {
            CallRecorder recorder = ctx._recorder;
            recorder.TextureCalls++;
            recorder.LastUnit = unit;
            recorder.LastTexture = texture;
            recorder.TextureStep = ++recorder.Step;
        }

        public static void SetBlendState(in RecordingInvoker ctx, bool enable, uint srcFactor, uint dstFactor)
        {
            CallRecorder recorder = ctx._recorder;
            recorder.BlendCalls++;
            recorder.LastBlendEnabled = enable;
            recorder.LastSrcFactor = srcFactor;
            recorder.LastDstFactor = dstFactor;
            recorder.BlendStep = ++recorder.Step;
        }

        public static void SetUniform1f(in RecordingInvoker ctx, int location, float v)
        {
            CallRecorder recorder = ctx._recorder;
            recorder.UniformCalls++;
            recorder.LastLocation = location;
            recorder.LastUniformValue = v;
            recorder.UniformStep = ++recorder.Step;
        }

        public static void DrawFullscreenTriangle(in RecordingInvoker ctx)
        {
            CallRecorder recorder = ctx._recorder;
            recorder.DrawCalls++;
            recorder.DrawStep = ++recorder.Step;
        }
    }

    /// <summary>Call counters shared by the recording invoker.</summary>
    private sealed class CallRecorder
    {
        public int Step;
        public int ProgramCalls;
        public int TextureCalls;
        public int UniformCalls;
        public int BlendCalls;
        public int DrawCalls;
        public int ProgramStep;
        public int TextureStep;
        public int UniformStep;
        public int BlendStep;
        public int DrawStep;
        public uint LastProgram;
        public uint LastUnit;
        public uint LastTexture;
        public int LastLocation;
        public float LastUniformValue;
        public bool LastBlendEnabled;
        public uint LastSrcFactor;
        public uint LastDstFactor;
    }
}
