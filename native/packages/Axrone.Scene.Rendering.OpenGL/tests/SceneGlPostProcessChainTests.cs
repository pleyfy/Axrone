namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System.Globalization;
using Axrone.Lighting;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;

/// <summary>
/// Contract of the offscreen post-process stage: one draw per enabled effect plus one presentation
/// draw, before-tonemap effects first, scratch buffers ping-ponged so no pass reads the texture it
/// writes, the temporal pass double-buffered across frames for the same reason, and a program that
/// does not expose the uniform interface rejected instead of drawn with.
/// </summary>
public sealed class SceneGlPostProcessChainTests
{
    private const string DrawPrefix = "DrawArrays(";
    private const string BindPrefix = "BindFramebuffer(";
    private const int Sampler2D = 0x8B5E;
    private const int Float = 0x1406;
    private const int Int = 0x1404;

    private static readonly (string Name, int Size, uint Type)[] UniformInterface =
    [
        ("u_inputTexture", 1, Sampler2D),
        ("u_history", 1, Sampler2D),
        ("u_depth", 1, Sampler2D),
        ("u_effectMode", 1, Int),
        ("u_primary", 1, Float),
        ("u_secondary", 1, Float),
        ("u_lift", 1, Float),
        ("u_gamma", 1, Float),
        ("u_gain", 1, Float),
        ("u_texel", 1, Float),
        ("u_frameSeed", 1, Float)
    ];

    [Fact]
    public void Ctor_NonPositiveTargetSize_IsRejected()
    {
        using var context = new GLContext(new MockGLApi());
        Action zeroWidth = () => _ = new SceneGlPostProcessChain(context, 0, 8);
        Action zeroHeight = () => _ = new SceneGlPostProcessChain(context, 8, 0);

        zeroWidth.Should().Throw<ArgumentOutOfRangeException>();
        zeroHeight.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Submit_ProgramMissingTheUniformInterface_IsRejectedInsteadOfDrawnBlind()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var chain = new SceneGlPostProcessChain(context, 32, 16);

        Action act = () => chain.Submit(0);

        act.Should().Throw<SceneConfigurationException>()
            .WithMessage("*u_effectMode*");
        DrawCount(api).Should().Be(0);
    }

    [Fact]
    public void Submit_NoEffects_PresentsExactlyOneFullscreenDraw()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        Declare(api, chain);
        api.ClearCallLog();

        int draws = chain.Submit(1);

        draws.Should().Be(1);
        draws.Should().Be(DrawCount(api));
        Targets(api).Should().Equal(0u);
        EffectModes(api).Should().Equal(0);
    }

    [Fact]
    public void Submit_RunsOneDrawPerEffectAndPingPongsTheScratchTargets()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        Declare(api, chain);
        chain.Enable(ScenePostProcessEffect.Fxaa);
        chain.Enable(ScenePostProcessEffect.Vignette);
        chain.Enable(ScenePostProcessEffect.ChromaticAberration);
        api.ClearCallLog();

        int draws = chain.Submit(3);

        draws.Should().Be(4);
        draws.Should().Be(DrawCount(api));
        uint[] targets = Targets(api);
        targets.Should().HaveCount(4);
        targets[0].Should().NotBe(0u);
        targets[1].Should().NotBe(targets[0], "consecutive effects must not write the texture they read");
        targets[2].Should().Be(targets[0], "two scratch buffers are enough for a three-effect chain");
        targets[3].Should().Be(0u, "the last draw is the presentation to the default framebuffer");
        EffectModes(api).Should().Equal(1, 2, 4, 0);
    }

    [Fact]
    public void Submit_ScratchParityRestartsEachFrame()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        Declare(api, chain);
        chain.Enable(ScenePostProcessEffect.Bloom);
        chain.Enable(ScenePostProcessEffect.Fxaa);
        chain.Submit(0);
        api.ClearCallLog();

        chain.Submit(1);
        uint[] first = Targets(api);
        api.ClearCallLog();
        chain.Submit(2);

        Targets(api).Should().Equal(first);
    }

    [Fact]
    public void Submit_TaaWritesTheOppositeHistoryBufferEveryFrame()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        Declare(api, chain);
        chain.Enable(ScenePostProcessEffect.Taa, new Vec4(0.9f, 0.5f, 1f, 0f));
        chain.Submit(0);
        api.ClearCallLog();

        chain.Submit(1);
        uint[] odd = Targets(api);
        api.ClearCallLog();
        chain.Submit(2);
        uint[] nextEven = Targets(api);
        api.ClearCallLog();
        chain.Submit(3);
        uint[] nextOdd = Targets(api);

        odd.Should().HaveCount(2, "one history write plus the presentation draw");
        odd[0].Should().NotBe(0u);
        nextEven[0].Should().NotBe(odd[0], "a frame must not write the history buffer it reads");
        nextOdd[0].Should().Be(odd[0], "history parity follows the frame index");
    }

    [Fact]
    public void Entries_OrderByPhaseWithInsertionOrderInsideEachGroup()
    {
        using var context = new GLContext(new MockGLApi());
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        chain.Enable(ScenePostProcessEffect.Fxaa);
        chain.Enable(ScenePostProcessEffect.Bloom);
        chain.Enable(ScenePostProcessEffect.ColorGrading);
        chain.Enable(ScenePostProcessEffect.Ssao);
        chain.Enable(ScenePostProcessEffect.Vignette);

        chain.Entries.Select(entry => entry.Effect).Should().Equal(
            ScenePostProcessEffect.Bloom,
            ScenePostProcessEffect.Ssao,
            ScenePostProcessEffect.Fxaa,
            ScenePostProcessEffect.ColorGrading,
            ScenePostProcessEffect.Vignette);
    }

    [Fact]
    public void Entries_PhaseOverrideMovesAnAfterTonemapEffectIntoTheLinearGroup()
    {
        using var context = new GLContext(new MockGLApi());
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        chain.Enable(ScenePostProcessEffect.Fxaa);
        chain.Enable(ScenePostProcessEffect.Vignette, phase: ScenePostProcessPhase.BeforeTonemap);

        chain.Entries.Select(entry => entry.Effect).Should().Equal(
            ScenePostProcessEffect.Vignette,
            ScenePostProcessEffect.Fxaa);
    }

    [Fact]
    public void Enable_SameEffect_ReplacesSettingsInsteadOfDuplicating()
    {
        using var context = new GLContext(new MockGLApi());
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        chain.Enable(ScenePostProcessEffect.Bloom, new Vec4(1f, 0.5f, 0.25f, 4f));
        chain.Enable(ScenePostProcessEffect.Bloom, new Vec4(2f, 0.25f, 0.5f, 8f));

        chain.Entries.Should().HaveCount(1);
        Vec4 primary = chain.Entries[0].Primary;
        primary.X.Should().Be(2f);
        primary.W.Should().Be(8f);
    }

    [Fact]
    public void Disable_ReportsWhetherTheEffectHadBeenEnabled()
    {
        using var context = new GLContext(new MockGLApi());
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        chain.Enable(ScenePostProcessEffect.FilmGrain);

        chain.Disable(ScenePostProcessEffect.FilmGrain).Should().BeTrue();
        chain.Disable(ScenePostProcessEffect.FilmGrain).Should().BeFalse();
        chain.Entries.Should().BeEmpty();
    }

    [Fact]
    public void Submit_PacksTheEffectModeAndPrimaryUniforms()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var chain = new SceneGlPostProcessChain(context, 32, 16);
        Declare(api, chain);
        chain.Enable(ScenePostProcessEffect.Vignette, new Vec4(0.75f, 0.5f, 1f, 0f));
        api.ClearCallLog();

        chain.Submit(5);

        api.CallLog.Should().Contain($"Uniform1({Location(api, "u_effectMode")}, 2)");
        api.CallLog.Should().Contain($"Uniform4({Location(api, "u_primary")}, 0.75, 0.5, 1, 0)");
        api.CallLog.Should().Contain($"Uniform1({Location(api, "u_frameSeed")}, 5)");
    }

    [Fact]
    public void Submit_ColorGradingIsTheOnlyEffectThatSetsLiftGammaGain()
    {
        var plain = new MockGLApi { EnableCallLogging = true };
        using (var context = new GLContext(plain))
        using (var chain = new SceneGlPostProcessChain(context, 32, 16))
        {
            Declare(plain, chain);
            chain.Enable(ScenePostProcessEffect.Fxaa);
            plain.ClearCallLog();
            chain.Submit(1);
            plain.CallLog.Should().NotContain(entry => entry.StartsWith("Uniform3(", StringComparison.Ordinal));
        }

        var graded = new MockGLApi { EnableCallLogging = true };
        using (var context = new GLContext(graded))
        using (var chain = new SceneGlPostProcessChain(context, 32, 16))
        {
            Declare(graded, chain);
            chain.Enable(
                ScenePostProcessEffect.ColorGrading,
                new Vec4(0.1f, -0.2f, 1.2f, 0.9f),
                lift: new Vec3(0.01f, 0.02f, 0.03f));
            graded.ClearCallLog();
            chain.Submit(1);
            graded.CallLog.Should().Contain(entry => entry.EndsWith("1, 1, 1)", StringComparison.Ordinal),
                "gamma and gain default to neutral so an unset colour grade cannot black out the frame");
            graded.CallLog.Count(entry => entry.StartsWith("Uniform3(", StringComparison.Ordinal))
                .Should().Be(3, "lift, gamma and gain are one vec3 uniform each");
        }
    }

    [Fact]
    public void BeginScene_BindsTheHdrTargetAndItsViewport()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var chain = new SceneGlPostProcessChain(context, 64, 48);

        chain.BeginScene();

        context.State.BoundDrawFramebuffer.Should().Be(chain.SceneTarget.Id);
        context.State.BoundReadFramebuffer.Should().Be(chain.SceneTarget.Id);
        api.CallLog.Should().Contain("Viewport(0, 0, 64, 48)");
    }

    [Fact]
    public void Dispose_TwiceIsIdempotentAndLaterUseThrows()
    {
        using var context = new GLContext(new MockGLApi());
        var chain = new SceneGlPostProcessChain(context, 32, 16);
        chain.Enable(ScenePostProcessEffect.Fxaa);
        chain.Dispose();
        chain.Dispose();

        Action enable = () => chain.Enable(ScenePostProcessEffect.Vignette);
        Action disable = () => chain.Disable(ScenePostProcessEffect.Vignette);
        Action entries = () => _ = chain.Entries;
        Action begin = () => chain.BeginScene();
        Action submit = () => chain.Submit(0);

        enable.Should().Throw<ObjectDisposedException>();
        disable.Should().Throw<ObjectDisposedException>();
        entries.Should().Throw<ObjectDisposedException>();
        begin.Should().Throw<ObjectDisposedException>();
        submit.Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void Orchestrator_WithAChain_DispatchesOneExtraPassAndPresentsIt()
    {
        using var fixture = new SceneGlFixture();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out _);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 640, 360)!;
        using var chain = new SceneGlPostProcessChain(fixture.Context, 640, 360);
        Declare(fixture.Api, chain);
        chain.Enable(ScenePostProcessEffect.Fxaa);
        using var orchestrator = new SceneGlRenderOrchestrator(
            fixture.Context,
            fixture.Cache,
            world,
            postProcess: chain);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(9);
        fixture.Api.ClearCallLog();

        SceneRenderStats stats = orchestrator.RenderFrame(
            world,
            frame,
            new EmptyItemSource(),
            [new SceneRenderPassDefinition(
                new SceneAssetId<RenderPassAssetTag>(SceneStringId.FromName("pass/main")), 0)],
            frameState,
            backbufferWidth: 640,
            backbufferHeight: 360);

        stats.PassCount.Should().Be(2);
        DrawCount(fixture.Api).Should().Be(2, "one FXAA effect draw plus the presentation draw");
        Targets(fixture.Api)[^1].Should().Be(0u);
        fixture.Api.CallLog.Should().Contain("Viewport(0, 0, 640, 360)");
    }

    [Fact]
    public void Orchestrator_WithoutAChain_PresentsNothingExtra()
    {
        using var fixture = new SceneGlFixture();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out _);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 640, 360)!;
        using var orchestrator = new SceneGlRenderOrchestrator(fixture.Context, fixture.Cache, world);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(9);
        fixture.Api.ClearCallLog();

        SceneRenderStats stats = orchestrator.RenderFrame(
            world,
            frame,
            new EmptyItemSource(),
            [new SceneRenderPassDefinition(
                new SceneAssetId<RenderPassAssetTag>(SceneStringId.FromName("pass/main")), 0)],
            frameState);

        stats.PassCount.Should().Be(1);
        DrawCount(fixture.Api).Should().Be(0);
    }

    private static void Declare(MockGLApi api, SceneGlPostProcessChain chain) =>
        api.SetActiveUniforms(chain.Program.Id, UniformInterface);

    private static int DrawCount(MockGLApi api) =>
        api.CallLog.Count(entry => entry.StartsWith(DrawPrefix, StringComparison.Ordinal));

    private static uint[] Targets(MockGLApi api)
    {
        var ids = new List<uint>();
        foreach (string entry in api.CallLog)
        {
            if (entry.StartsWith(BindPrefix, StringComparison.Ordinal))
            {
                int comma = entry.IndexOf(", ", StringComparison.Ordinal);
                ids.Add(uint.Parse(entry[(comma + 2)..^1], CultureInfo.InvariantCulture));
            }
        }

        return [.. ids];
    }

    private static int[] EffectModes(MockGLApi api)
    {
        string prefix = $"Uniform1({Location(api, "u_effectMode")}, ";
        var modes = new List<int>();
        foreach (string entry in api.CallLog)
        {
            if (entry.StartsWith(prefix, StringComparison.Ordinal))
            {
                modes.Add(int.Parse(entry[prefix.Length..^1], CultureInfo.InvariantCulture));
            }
        }

        return [.. modes];
    }

    private static int Location(MockGLApi api, string uniform)
    {
        string suffix = $", {uniform}) -> ";
        foreach (string entry in api.CallLog)
        {
            int index = entry.IndexOf(suffix, StringComparison.Ordinal);
            if (index >= 0)
            {
                return int.Parse(entry[(index + suffix.Length)..], CultureInfo.InvariantCulture);
            }
        }

        throw new InvalidOperationException($"The mock never resolved a location for {uniform}.");
    }

    private sealed class EmptyItemSource : ISceneFrameItemSource
    {
        public LightingSelectionState? Lighting => null;

        public SceneFogState Fog => SceneFogState.Default;

        public ReadOnlySpan<SceneRenderItem> CollectMeshes(SceneAssetId<RenderPassAssetTag> passId) => [];

        public ReadOnlySpan<SceneSpriteRenderItem> CollectSprites(SceneAssetId<RenderPassAssetTag> passId) => [];
    }
}
