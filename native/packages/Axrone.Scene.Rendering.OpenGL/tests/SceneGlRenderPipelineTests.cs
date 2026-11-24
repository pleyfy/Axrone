namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Lighting;
using Axrone.Render.Core;
using Axrone.Render.OpenGL;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Render.OpenGL.Pipeline;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Contract of the scene render pipeline bridge: every enabled pass is dispatched exactly once
/// through the render backend's executor registry, in declared order, and the backend's target
/// state management stays off the scene path until a pass actually needs an offscreen target.
/// </summary>
public sealed class SceneGlRenderPipelineTests
{
    private static RenderExecutionContext Ctx(int frame = 1, int width = 1280, int height = 720) =>
        new(frame, 1.0 / 60.0, width, height);

    private static SceneAssetId<RenderPassAssetTag> PassId(string id) =>
        new(SceneStringId.FromName(id));

    private static SceneRenderPassDefinition Pass(string id, int order = 0) =>
        new(PassId(id), order);

    [Fact]
    public void Execute_CallsTheRegisteredExecutorOncePerPassInDeclaredOrder()
    {
        using var context = new GLContext(new MockGLApi());
        using var pipeline = new SceneGlRenderPipeline(context);
        var seen = new List<SceneAssetId<RenderPassAssetTag>>();
        pipeline.Register(PassKind.Opaque, pass => seen.Add(pass.Id));

        RenderFrameResult result = pipeline.Execute(
            [Pass("pass/opaque", 0), Pass("pass/transparent", 1), Pass("pass/skybox", 2)],
            Ctx());

        seen.Should().Equal(PassId("pass/opaque"), PassId("pass/transparent"), PassId("pass/skybox"));
        result.TotalPassesExecuted.Should().Be(3);
    }

    [Fact]
    public void Execute_WithoutAnExecutorForTheKind_ThrowsInsteadOfSkippingThePass()
    {
        using var context = new GLContext(new MockGLApi());
        using var pipeline = new SceneGlRenderPipeline(context);
        pipeline.KindResolver = pass => pass.Order == 1 ? PassKind.Tonemap : PassKind.Opaque;
        int opaqueRuns = 0;
        pipeline.Register(PassKind.Opaque, _ => opaqueRuns++);

        Action act = () => pipeline.Execute([Pass("pass/opaque", 0), Pass("pass/tonemap", 1)], Ctx());

        act.Should().Throw<RenderException>();
        opaqueRuns.Should().Be(1, "the failure is the tonemap pass, not the one before it");
    }

    [Fact]
    public void ScenePasses_DoNotTouchViewportOrFramebufferState()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var pipeline = new SceneGlRenderPipeline(context);
        pipeline.Register(PassKind.Opaque, _ => { });
        api.ClearCallLog();

        pipeline.Execute([Pass("pass/a"), Pass("pass/b")], Ctx());

        api.CallLog.Should().NotContain(entry => entry.StartsWith("Viewport(", StringComparison.Ordinal));
        api.CallLog.Should().NotContain(entry => entry.StartsWith("BindFramebuffer(", StringComparison.Ordinal));
    }

    [Fact]
    public void PipelineManagedPasses_BindTheTargetAndViewport()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var pipeline = new SceneGlRenderPipeline(context);
        pipeline.Register(PassKind.PostProcess, _ => { });
        pipeline.KindResolver = _ => PassKind.PostProcess;
        api.ClearCallLog();

        pipeline.Execute([Pass("pass/post")], Ctx(width: 800, height: 600), manageTarget: true);

        api.CallLog.Should().Contain("Viewport(0, 0, 800, 600)");
        api.CallLog.Should().Contain(entry => entry.StartsWith("BindFramebuffer(", StringComparison.Ordinal));
    }

    [Fact]
    public void Register_ReplacesTheExecutorForTheSameKind()
    {
        using var context = new GLContext(new MockGLApi());
        using var pipeline = new SceneGlRenderPipeline(context);
        int first = 0;
        int second = 0;
        pipeline.Register(PassKind.Opaque, _ => first++);
        pipeline.Register(PassKind.Opaque, _ => second++);

        pipeline.Execute([Pass("pass/a")], Ctx());

        first.Should().Be(0);
        second.Should().Be(1);
    }

    [Fact]
    public void Execute_AfterDispose_IsRejected()
    {
        using var context = new GLContext(new MockGLApi());
        var pipeline = new SceneGlRenderPipeline(context);
        pipeline.Register(PassKind.Opaque, _ => { });
        pipeline.Dispose();
        pipeline.Dispose();

        Action act = () => pipeline.Execute([Pass("pass/a")], Ctx());
        act.Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void Orchestrator_RendersThroughThePipelineAndReportsTheSamePassCount()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var fixture = new SceneGlFixture();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out _);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 640, 360)!;
        using var orchestrator = new SceneGlRenderOrchestrator(fixture.Context, fixture.Cache, world);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(7);
        api.ClearCallLog();

        SceneRenderStats stats = orchestrator.RenderFrame(
            world,
            frame,
            new EmptyItemSource(),
            [Pass("pass/a"), Pass("pass/b"), Pass("pass/c")],
            frameState);

        stats.PassCount.Should().Be(3);
        orchestrator.Pipeline.ExecutedPasses.Should().Be(3);
        api.CallLog.Should().NotContain(entry => entry.StartsWith("Viewport(", StringComparison.Ordinal),
            "the scene renderer owns target state, so routing through the backend must not add viewport calls");
    }

    private sealed class EmptyItemSource : ISceneFrameItemSource
    {
        public LightingSelectionState? Lighting => null;

        public SceneFogState Fog => SceneFogState.Default;

        public ReadOnlySpan<SceneRenderItem> CollectMeshes(SceneAssetId<RenderPassAssetTag> passId) => [];

        public ReadOnlySpan<SceneSpriteRenderItem> CollectSprites(SceneAssetId<RenderPassAssetTag> passId) => [];
    }
}
