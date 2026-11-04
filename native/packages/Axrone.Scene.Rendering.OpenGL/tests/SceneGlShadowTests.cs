namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Lighting;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Render.OpenGL.Shading;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlShadowTests
{
    private const int TileEdge = 1024;
    private const int AtlasEdge = 2048;

    private const string VertexShader = """
        #version 330 core
        void main()
        {
            gl_Position = vec4(0.0);
        }
        """;

    private static readonly string[] ShadowUniformNames =
    [
        "u_ShadowMap",
        "u_ShadowEnabled",
        "u_ShadowCascadeCount",
        "u_ShadowFilter",
        "u_ShadowSplits",
        "u_ShadowTiles[0]",
        "u_ShadowLightMatrices[0]",
        "u_ShadowTexelSize",
        "u_ShadowDepthBias",
        "u_ShadowNormalBias",
    ];

    private static readonly string[] FogUniformNames =
    [
        "u_HeightFogEnabled",
        "u_HeightFogColor",
        "u_HeightFogDensity",
        "u_HeightFogFalloff",
        "u_HeightFogGroundHeight",
    ];

    private const string ShadowFragmentShader = """
        #version 330 core
        uniform sampler2D u_ShadowMap;
        uniform int u_ShadowEnabled;
        uniform int u_ShadowCascadeCount;
        uniform int u_ShadowFilter;
        uniform vec4 u_ShadowSplits;
        uniform vec4 u_ShadowTiles[4];
        uniform mat4 u_ShadowLightMatrices[4];
        uniform vec2 u_ShadowTexelSize;
        uniform float u_ShadowDepthBias;
        uniform float u_ShadowNormalBias;
        out vec4 o_FragColor;
        void main()
        {
            o_FragColor = vec4(texture(u_ShadowMap, vec2(0.5)).r, float(u_ShadowEnabled), u_ShadowFilter, 1.0);
        }
        """;

    private const string FogOnlyFragmentShader = """
        #version 330 core
        uniform int u_HeightFogEnabled;
        uniform vec3 u_HeightFogColor;
        uniform float u_HeightFogDensity;
        uniform float u_HeightFogFalloff;
        uniform float u_HeightFogGroundHeight;
        out vec4 o_FragColor;
        void main()
        {
            o_FragColor = vec4(float(u_HeightFogEnabled));
        }
        """;

    private const string PlainFragmentShader = """
        #version 330 core
        out vec4 o_FragColor;
        void main()
        {
            o_FragColor = vec4(1.0);
        }
        """;

    [Fact]
    public void AtlasValidatesEdgeAndDisposesIdempotently()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);

        Action tooSmall = () => _ = new SceneGlShadowAtlas(context, 256);
        tooSmall.Should().Throw<SceneConfigurationException>();

        Action tooLarge = () => _ = new SceneGlShadowAtlas(context, 999999);
        tooLarge.Should().Throw<SceneConfigurationException>();

        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        atlas.Edge.Should().Be(AtlasEdge);
        atlas.IsAvailable.Should().BeTrue();
        api.CallLog.Should().Contain(call => call.StartsWith("CheckFramebufferStatus(", StringComparison.Ordinal));

        atlas.Dispose();
        atlas.Dispose();
        atlas.IsAvailable.Should().BeFalse();
        Action afterDispose = () => atlas.BeginFullClear();
        afterDispose.Should().Throw<SceneDisposedException>();
    }

    [Fact]
    public void AtlasRejectsIncompleteFramebuffer()
    {
        var api = new MockGLApi { EnableCallLogging = false, FramebufferStatus = 0x8CD4 };
        using var context = new GLContext(api);

        Action create = () => _ = new SceneGlShadowAtlas(context, AtlasEdge);
        create.Should().Throw<SceneConfigurationException>()
            .WithMessage("*incomplete*");
    }

    [Fact]
    public void TextureUnitPlanKeepsShadowUnitOutsideSceneRange()
    {
        SceneGlShadowBinder.TextureUnit.Should().Be(16);
        SceneGlShadowBinder.TextureUnit.Should().BeGreaterThanOrEqualTo(SceneGlTextureUnits.SceneUnitCount);
        SceneGlShadowBinder.TextureUnit.Should()
            .NotBe(SceneGlTextureUnits.ReflectionProbe)
            .And.NotBe(SceneGlTextureUnits.Skinning);

        SceneGlTextureUnits.IsReservedUnit(SceneGlTextureUnits.ReflectionProbe).Should().BeTrue();
        SceneGlTextureUnits.IsReservedUnit(SceneGlTextureUnits.Skinning).Should().BeTrue();
        SceneGlTextureUnits.IsReservedUnit(SceneGlShadowBinder.TextureUnit).Should().BeFalse();
    }

    [Fact]
    public void MaterialValidatorRejectsOutOfRangeAndReservedUnits()
    {
        SceneAssetId<MaterialAssetTag> materialId = SceneAssetId<MaterialAssetTag>.FromName("mat/test");

        Action aboveRange = () => SceneGlTextureUnits.ValidateMaterialSlot(16, extension: false, "u_Map", materialId);
        aboveRange.Should().Throw<SceneAssetException>();

        Action reserved = () => SceneGlTextureUnits.ValidateMaterialSlot(
            SceneGlTextureUnits.ReflectionProbe, extension: false, "u_Map", materialId);
        reserved.Should().Throw<SceneAssetException>();

        Action withinRange = () => SceneGlTextureUnits.ValidateMaterialSlot(4, extension: false, "u_Map", materialId);
        withinRange.Should().NotThrow();
    }

    [Fact]
    public void BinderBindsAtlasSamplerAndCascadeArraysOnShadowShader()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        using var shader = new SceneGlShader(context, "shadow-sampling", VertexShader, ShadowFragmentShader);
        ShadowFrameData frame = CreateEnabledFrame(ShadowCascadeCount.Four);
        api.SetActiveUniforms(shader.Program.Id, ToUniformEntries(ShadowUniformNames));

        SceneGlShadowBinder.Bind(context, shader, atlas, frame).Should().BeTrue();

        api.CallLog.Should().Contain(
            $"BindSampler({SceneGlShadowBinder.TextureUnit}, {atlas.Sampler.Id})");
        api.CallLog.Should().Contain(
            $"BindTexture(3553, {atlas.Texture.Id})");
        api.CallLog.Should().Contain(call => call.StartsWith("UniformMatrix4(", StringComparison.Ordinal));
        api.CallLog.Should().Contain(call => call.StartsWith("Uniform4(", StringComparison.Ordinal));
    }

    [Fact]
    public void BinderDisablesContractWhenFrameHasNoCascades()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        using var shader = new SceneGlShader(context, "shadow-disabled", VertexShader, ShadowFragmentShader);
        var frame = new ShadowFrameData();
        api.SetActiveUniforms(shader.Program.Id, ToUniformEntries(ShadowUniformNames));

        SceneGlShadowBinder.Bind(context, shader, atlas, frame).Should().BeFalse();

        int enabledLocation = shader.GetUniformLocation("u_ShadowEnabled");
        int countLocation = shader.GetUniformLocation("u_ShadowCascadeCount");
        api.CallLog.Should().Contain($"Uniform1({enabledLocation}, 0)");
        api.CallLog.Should().Contain($"Uniform1({countLocation}, 0)");
        api.CallLog.Should().NotContain(call => call.StartsWith("BindSampler(", StringComparison.Ordinal));
    }

    [Fact]
    public void BinderLeavesShaderWithoutShadowContractUntouched()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        using var shader = new SceneGlShader(context, "plain", VertexShader, PlainFragmentShader);
        ShadowFrameData frame = CreateEnabledFrame(ShadowCascadeCount.Four);

        SceneGlShadowBinder.Bind(context, shader, atlas, frame).Should().BeFalse();

        api.CallLog.Should().NotContain(call => call.StartsWith("BindSampler(", StringComparison.Ordinal));
        api.CallLog.Should().NotContain(call => call.StartsWith("Uniform4(", StringComparison.Ordinal));
    }

    [Fact]
    public void BinderBindsHeightFogAndSkipsShaderWithoutFogContract()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var fogShader = new SceneGlShader(context, "fog-only", VertexShader, FogOnlyFragmentShader);
        using var plainShader = new SceneGlShader(context, "plain-fog", VertexShader, PlainFragmentShader);
        api.SetActiveUniforms(fogShader.Program.Id, ToUniformEntries(FogUniformNames));
        var heightFog = new HeightFogSettings(enabled: true, density: 0.05f, falloff: 0.2f, groundHeight: 1.5f);

        SceneGlShadowBinder.BindHeightFog(fogShader, in heightFog);

        int enabledLocation = fogShader.GetUniformLocation("u_HeightFogEnabled");
        enabledLocation.Should().BeGreaterThanOrEqualTo(0);
        api.CallLog.Should().Contain($"Uniform1({enabledLocation}, 1)");

        plainShader.GetUniformLocation("u_HeightFogEnabled").Should().Be(-1);
        int callsBeforeSecondBind = api.CallLog.Count;
        SceneGlShadowBinder.BindHeightFog(plainShader, in heightFog);
        api.CallLog.Count.Should().Be(callsBeforeSecondBind);
    }

    [Fact]
    public void RendererPopulatesCascadesAndTilesAtlasViewport()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var fixture = new SceneGlFixture();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out SceneActor rendererActor);
        using var cache = new SceneGlAssetCache(context, fixture.Assets);
        _ = cache.UploadAll();
        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        using var renderer = new SceneGlShadowRenderer(context, cache, atlas);
        renderer.Settings = EnabledSettings(ShadowCascadeCount.Four);
        SceneCameraFrame camera = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        LightingSelectionState lighting = CreateDirectionalLighting();
        var casters = new SceneRenderItem[] { fixture.CreateItem(rendererActor) };

        int drawCalls = renderer.Render(world, camera, lighting, casters);

        renderer.LastCascadeCount.Should().Be(4);
        renderer.Frame.IsEnabled.Should().BeTrue();
        drawCalls.Should().Be(4);
        renderer.LastDrawCalls.Should().Be(4);
        api.CallLog.Should().Contain($"Viewport(0, 0, {TileEdge}, {TileEdge})");
        api.CallLog.Should().Contain($"Viewport({TileEdge}, {TileEdge}, {TileEdge}, {TileEdge})");
        api.CallLog.Should().Contain(call => call.StartsWith("Clear(", StringComparison.Ordinal));
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements", StringComparison.Ordinal));
    }

    [Fact]
    public void RendererStopsWithoutEnabledSettingsOrDirectionalLight()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var fixture = new SceneGlFixture();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out SceneActor rendererActor);
        using var cache = new SceneGlAssetCache(context, fixture.Assets);
        _ = cache.UploadAll();
        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        var rendererDefault = new SceneGlShadowRenderer(context, cache, atlas);
        rendererDefault.Settings.Enabled.Should().BeTrue();
        rendererDefault.Dispose();

        using var renderer = new SceneGlShadowRenderer(
            context, cache, atlas, depthProgram: null, settings: ShadowSettings.Disabled);
        SceneCameraFrame camera = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        var casters = new SceneRenderItem[] { fixture.CreateItem(rendererActor) };

        renderer.Render(world, camera, CreateDirectionalLighting(), casters).Should().Be(0);
        renderer.LastCascadeCount.Should().Be(0);
        renderer.Frame.IsEnabled.Should().BeFalse();
        api.CallLog.Should().NotContain(call => call.StartsWith("Clear(", StringComparison.Ordinal));

        renderer.Settings = EnabledSettings(ShadowCascadeCount.Four);
        renderer.Render(world, camera, lighting: null, casters).Should().Be(0);

        using var darkRig = RigBuilder<StageInitial>.Create().Seal().Build();
        var resolver = new LightingFrameResolver(new LightingCapacity(
            maxDirectionalLights: 4, maxPointLights: 0, maxSpotLights: 0, maxLocalLights: 0));
        LightingSelectionState dark = resolver.Resolve(
            darkRig, new ResolveOptions(Vec3.Zero, LightSortStrategy.None));
        renderer.Render(world, camera, dark, casters).Should().Be(0);
        renderer.LastCascadeCount.Should().Be(0);
    }

    [Fact]
    public void RendererDisposesOwnedProgramAndRejectsUseAfterDispose()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var fixture = new SceneGlFixture();
        using SceneWorld world = fixture.CreateWorld(out _, out _);
        using var cache = new SceneGlAssetCache(context, fixture.Assets);
        _ = cache.UploadAll();
        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        var renderer = new SceneGlShadowRenderer(context, cache, atlas);
        uint programId = OwnedDepthProgramId(renderer);
        programId.Should().NotBe(0u);

        renderer.Dispose();
        renderer.Dispose();
        renderer.IsAvailable.Should().BeFalse();
        api.CallLog.Should().Contain($"DeleteProgram({programId})");

        SceneCameraFrame camera = new SceneCameraFrameCollector().Collect(world, world.CreateActor("Cam"), 800, 600)!;
        Action render = () => renderer.Render(world, camera, lighting: null, []);
        render.Should().Throw<SceneDisposedException>();
    }

    [Fact]
    public void RendererBindsShadowForSamplingShaderAndFallsBackToFogOnly()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var fixture = new SceneGlFixture();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out _);
        using var cache = new SceneGlAssetCache(context, fixture.Assets);
        _ = cache.UploadAll();
        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        using var renderer = new SceneGlShadowRenderer(context, cache, atlas);
        renderer.Settings = EnabledSettings(ShadowCascadeCount.Four);
        renderer.HeightFog = new HeightFogSettings(enabled: true, density: 0.05f, falloff: 0.2f, groundHeight: 0.0f);
        SceneCameraFrame camera = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        _ = renderer.Render(world, camera, CreateDirectionalLighting(), []);

        using var shadowShader = new SceneGlShader(context, "bind-shadow", VertexShader, ShadowFragmentShader);
        api.SetActiveUniforms(shadowShader.Program.Id, ToUniformEntries(ShadowUniformNames));
        renderer.TryBind(context, shadowShader).Should().BeTrue();

        using var fogShader = new SceneGlShader(context, "bind-fog", VertexShader, FogOnlyFragmentShader);
        api.SetActiveUniforms(fogShader.Program.Id, ToUniformEntries(FogUniformNames));
        renderer.TryBind(context, fogShader).Should().BeFalse();
        int fogLocation = fogShader.GetUniformLocation("u_HeightFogEnabled");
        api.CallLog.Should().Contain($"Uniform1({fogLocation}, 1)");

        using var freshFogShader = new SceneGlShader(context, "bind-fog-again", VertexShader, FogOnlyFragmentShader);
        api.SetActiveUniforms(freshFogShader.Program.Id, ToUniformEntries(FogUniformNames));
        renderer.BindFogOnly(freshFogShader);
        int freshLocation = freshFogShader.GetUniformLocation("u_HeightFogEnabled");
        api.CallLog.Should().Contain($"Uniform1({freshLocation}, 1)");
    }

    [Fact]
    public void WarmShadowFramePipelineDoesNotSteadyStateAllocate()
    {
        // MockGLApi interpolates a log string at every call site regardless of
        // EnableCallLogging, so the 0 B guard covers the GL-free hot path:
        // per-frame cascade rebuild plus the uniform reads the binder consumes.
        var frame = new ShadowFrameData();
        var camera = new ShadowCameraParameters(
            Vec3.Zero,
            new Vec3(0.0f, 0.0f, -1.0f),
            Vec3.UnitY,
            Vec3.UnitX,
            MathF.PI / 3.0f,
            1.333f,
            0.1f,
            500.0f);
        Vec3 lightDirection = new(-0.35f, -0.9f, -0.25f);
        ShadowSettings settings = EnabledSettings(ShadowCascadeCount.Four);
        float sum = 0.0f;

        for (int i = 0; i < 300; i++)
        {
            ShadowCascadeFrameBuilder.Build(frame, settings, in camera, in lightDirection, AtlasEdge, AtlasEdge);
        }

        // Thread-local accounting keeps concurrent test collections out of the
        // measurement; every window must be exactly clean, not just the
        // quietest one, so a single sporadic allocation cannot hide.
        var buildWindow = new Action(() => RebuildShadowWindows(
            frame, settings, in camera, in lightDirection, ref sum));

        // Prime once with the measured loop shape itself (delegate invoke,
        // closure reads, thread-local counter access) so JIT tier promotion
        // cannot land inside a timed window.
        long primeBefore = GC.GetAllocatedBytesForCurrentThread();
        buildWindow();
        _ = GC.GetAllocatedBytesForCurrentThread() - primeBefore;

        for (int window = 0; window < 8; window++)
        {
            long before = GC.GetAllocatedBytesForCurrentThread();
            buildWindow();
            long delta = GC.GetAllocatedBytesForCurrentThread() - before;
            delta.Should().Be(
                0L,
                $"window {window}: cascade rebuild hot path must allocate zero bytes on the measured thread");
        }

        sum.Should().NotBe(0.0f);
        frame.ActiveCascadeCount.Should().Be(4);
    }

    private static void RebuildShadowWindows(
        ShadowFrameData frame,
        ShadowSettings settings,
        in ShadowCameraParameters camera,
        in Vec3 lightDirection,
        ref float sum)
    {
        for (int i = 0; i < 128; i++)
        {
            int count = ShadowCascadeFrameBuilder.Build(
                frame, settings, in camera, in lightDirection, AtlasEdge, AtlasEdge);
            for (int cascade = 0; cascade < count; cascade++)
            {
                Vec4 tile = frame.GetAtlasTile(cascade);
                Mat4 matrix = frame.GetLightViewProjection(cascade);
                sum += tile.X + tile.Z + matrix.M11 + frame.GetSplitDepth(cascade);
            }
        }
    }

    [Theory]
    [InlineData(ShadowFilterMode.Hard, 0)]
    [InlineData(ShadowFilterMode.Pcf, 1)]
    [InlineData(ShadowFilterMode.Pcss, 2)]
    [InlineData(ShadowFilterMode.Esm, 3)]
    [InlineData(ShadowFilterMode.Vsm, 4)]
    public void BinderPropagatesFilterSelectorToShader(ShadowFilterMode filter, int expectedSelector)
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var atlas = new SceneGlShadowAtlas(context, AtlasEdge);
        using var shader = new SceneGlShader(context, $"filter-{filter}", VertexShader, ShadowFragmentShader);
        ShadowFrameData frame = CreateEnabledFrame(ShadowCascadeCount.Four, filter);
        api.SetActiveUniforms(shader.Program.Id, ToUniformEntries(ShadowUniformNames));
        shader.Bind();

        SceneGlShadowBinder.Bind(context, shader, atlas, frame).Should().BeTrue();

        int filterLocation = shader.GetUniformLocation("u_ShadowFilter");
        api.CallLog.Should().Contain($"Uniform1({filterLocation}, {expectedSelector})");
    }

    [Fact]
    public void OrchestratorRoutesMeshDrawsThroughShadowSource()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var fixture = new SceneGlFixture();
        using SceneWorld world = fixture.CreateWorld(out SceneActor cameraActor, out SceneActor rendererActor);
        using var cache = new SceneGlAssetCache(context, fixture.Assets);
        _ = cache.UploadAll();
        var source = new RecordingShadowSource(available: true);
        using var orchestrator = new SceneGlRenderOrchestrator(
            context, cache, world, shadow: source);
        SceneCameraFrame camera = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;
        var pass = new SceneRenderPassDefinition(SceneRenderPassIds.Main, clearMask: SceneClearMask.None);
        var items = new SceneRenderItem[] { fixture.CreateItem(rendererActor) };
        var frameSource = new MeshOnlySource(items);
        var frameState = new SceneRenderFrameState();

        _ = orchestrator.RenderFrame(world, camera, frameSource, [pass], frameState);

        source.BindAttempts.Should().Be(items.Length);
        source.FogFallbacks.Should().Be(0);

        var fogSource = new RecordingShadowSource(available: false);
        using var fogOrchestrator = new SceneGlRenderOrchestrator(
            context, cache, world, shadow: fogSource);
        _ = fogOrchestrator.RenderFrame(world, camera, frameSource, [pass], new SceneRenderFrameState());
        fogSource.BindAttempts.Should().Be(items.Length);
        fogSource.FogFallbacks.Should().Be(items.Length);
    }

    private sealed class RecordingShadowSource : ISceneGlShadowSource
    {
        private readonly bool _available;

        public RecordingShadowSource(bool available) => _available = available;

        public int BindAttempts { get; private set; }

        public int FogFallbacks { get; private set; }

        public bool IsAvailable => _available;

        public bool TryBind(GLContext context, SceneGlShader shader)
        {
            BindAttempts++;
            return _available;
        }

        public void BindFogOnly(SceneGlShader shader) => FogFallbacks++;
    }

    private sealed class MeshOnlySource(SceneRenderItem[] meshes) : ISceneFrameItemSource
    {
        public LightingSelectionState? Lighting => null;

        public SceneFogState Fog => SceneFogState.Default;

        public ReadOnlySpan<SceneRenderItem> CollectMeshes(SceneAssetId<RenderPassAssetTag> passId) => meshes;

        public ReadOnlySpan<SceneSpriteRenderItem> CollectSprites(SceneAssetId<RenderPassAssetTag> passId) => [];
    }

    private static uint OwnedDepthProgramId(SceneGlShadowRenderer renderer)
    {
        var field = typeof(SceneGlShadowRenderer)
            .GetField("_depthProgram", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
        var program = (GLProgram?)field?.GetValue(renderer);
        return program?.Id ?? 0u;
    }

    private static LightingSelectionState CreateDirectionalLighting()
    {
        var rig = RigBuilder<StageInitial>.Create().Seal().Build();
        rig.Add(LightData.CreateDirectional(
            rig.NextLightId(), 1,
            new Vec3(-0.35f, -0.9f, -0.25f), Vec3.One, Vec3.Zero,
            new LightIntensity(2.0f), LightPriority.Zero));
        var resolver = new LightingFrameResolver(new LightingCapacity(
            maxDirectionalLights: 4, maxPointLights: 0, maxSpotLights: 0, maxLocalLights: 0));
        return resolver.Resolve(rig, new ResolveOptions(Vec3.Zero, LightSortStrategy.None));
    }

    private static ShadowFrameData CreateEnabledFrame(ShadowCascadeCount count, ShadowFilterMode? filter = null)
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
            EnabledSettings(count, filter ?? ShadowFilterMode.Pcf),
            in camera,
            in lightDirection,
            AtlasEdge,
            AtlasEdge);
        return frame;
    }

    private static ShadowSettings EnabledSettings(
        ShadowCascadeCount count,
        ShadowFilterMode filter = ShadowFilterMode.Pcf) => new(
        enabled: true,
        atlasSize: AtlasEdge,
        cascadeCount: count,
        cascadeSplitLambda: 0.7f,
        maxShadowedLights: 3,
        maxDistance: 150.0f,
        bias: ShadowBias.Default,
        filter: filter);

    private static (string Name, int Size, uint Type)[] ToUniformEntries(string[] names)
    {
        var entries = new (string, int, uint)[names.Length];
        for (int i = 0; i < names.Length; i++)
        {
            entries[i] = (names[i], 1, 0x8B51);
        }

        return entries;
    }
}
