namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Lighting;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlParticleTests
{
    [Fact]
    public void ParticleBatch_DrawsOnePointPerParticle()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using SceneWorld world = CreateWorld(out SceneEntity cameraEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 320, 180)!;

        using var renderer = new SceneGlParticleBatchRenderer(context);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        SceneParticleSnapshot snapshot = CreateSnapshot(count: 3);
        int drawCalls = renderer.Render(snapshot, frame, CreatePass(blend: true), frameState);

        drawCalls.Should().Be(1);
        frameState.DrawCalls.Should().Be(1);
        frameState.TrianglesSubmitted.Should().Be(0);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawArrays(0, 0, 3)", StringComparison.Ordinal));
    }

    [Fact]
    public void ParticleBatch_SkipsEmptySystems()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using SceneWorld world = CreateWorld(out SceneEntity cameraEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 320, 180)!;

        using var renderer = new SceneGlParticleBatchRenderer(context);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(CreateSnapshot(count: 0), frame, CreatePass(blend: true), frameState)
            .Should().Be(0);
        frameState.DrawCalls.Should().Be(0);
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawArrays", StringComparison.Ordinal));
    }

    [Fact]
    public void ParticleBatch_ClampsCountToShortestStream()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using SceneWorld world = CreateWorld(out SceneEntity cameraEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 320, 180)!;

        using var renderer = new SceneGlParticleBatchRenderer(context);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        SceneParticleSnapshot snapshot = CreateSnapshot(count: 4, storageLength: 2);
        renderer.Render(snapshot, frame, CreatePass(blend: true), frameState).Should().Be(1);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawArrays(0, 0, 2)", StringComparison.Ordinal));
    }

    [Fact]
    public void Orchestrator_RendersParticlesInBlendingPasses()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using SceneWorld world = CreateWorld(out SceneEntity cameraEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 320, 180)!;
        var assets = new SceneAssetRegistry();
        var source = new FakeParticleSource(CreateSnapshot(count: 5));

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        using var orchestrator = new SceneGlRenderOrchestrator(context, cache, world, source);

        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        SceneRenderStats stats = orchestrator.RenderFrame(
            world,
            frame,
            new EmptyItemSource(),
            [CreatePass(blend: true)],
            frameState);

        stats.DrawCalls.Should().Be(1);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawArrays(0, 0, 5)", StringComparison.Ordinal));
    }

    [Fact]
    public void Orchestrator_SkipsParticlesInDepthOnlyPasses()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using SceneWorld world = CreateWorld(out SceneEntity cameraEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 320, 180)!;
        var assets = new SceneAssetRegistry();
        var source = new FakeParticleSource(CreateSnapshot(count: 5));

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        using var orchestrator = new SceneGlRenderOrchestrator(context, cache, world, source);

        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        SceneRenderStats stats = orchestrator.RenderFrame(
            world,
            frame,
            new EmptyItemSource(),
            [CreatePass(blend: false)],
            frameState);

        stats.DrawCalls.Should().Be(0);
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawArrays", StringComparison.Ordinal));
    }

    private static SceneParticleSnapshot CreateSnapshot(int count, int storageLength = -1)
    {
        int length = storageLength >= 0 ? storageLength : Math.Max(count, 1);
        var x = new float[length];
        var y = new float[length];
        var z = new float[length];
        var r = new float[length];
        var g = new float[length];
        var b = new float[length];
        var a = new float[length];
        var size = new float[length];

        for (int i = 0; i < length; i++)
        {
            x[i] = i;
            y[i] = i * 2;
            z[i] = i * 3;
            r[i] = 1.0f;
            g[i] = 1.0f;
            b[i] = 1.0f;
            a[i] = 1.0f;
            size[i] = 4.0f + i;
        }

        return new SceneParticleSnapshot(default, count, x, y, z, r, g, b, a, size);
    }

    private static SceneRenderPassDefinition CreatePass(bool blend)
    {
        var id = new SceneAssetId<RenderPassAssetTag>(
            SceneStringId.FromName("test/particle-pass"));
        return new SceneRenderPassDefinition(id, depthTest: true, blend: blend);
    }

    private static SceneWorld CreateWorld(out SceneEntity cameraEntity)
    {
        var builder = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/gl-particles")))
            .AddTransform3D()
            .AddRendering3D();

        SceneWorld world = builder.Build().CreateWorld();
        cameraEntity = world.CreateEntity("Camera3D");
        world.GetTransform3D(cameraEntity).SetPosition(new Vec3(0.0f, 0.0f, 10.0f));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(cameraEntity, camera);
        world.UpdateTransforms();
        return world;
    }

    private sealed class FakeParticleSource : ISceneParticleSource
    {
        private readonly float[] _x;
        private readonly float[] _y;
        private readonly float[] _z;
        private readonly float[] _r;
        private readonly float[] _g;
        private readonly float[] _b;
        private readonly float[] _a;
        private readonly float[] _size;
        private readonly int _count;

        public FakeParticleSource(SceneParticleSnapshot prototype)
        {
            _count = prototype.Count;
            _x = prototype.PosX.ToArray();
            _y = prototype.PosY.ToArray();
            _z = prototype.PosZ.ToArray();
            _r = prototype.ColR.ToArray();
            _g = prototype.ColG.ToArray();
            _b = prototype.ColB.ToArray();
            _a = prototype.ColA.ToArray();
            _size = prototype.Size.ToArray();
        }

        public int SystemCount => 1;

        public SceneParticleSnapshot GetSnapshot(int index) =>
            new(default, _count, _x, _y, _z, _r, _g, _b, _a, _size);
    }

    private sealed class EmptyItemSource : ISceneFrameItemSource
    {
        public LightingSelectionState? Lighting => null;

        public SceneFogState Fog => SceneFogState.Default;

        public ReadOnlySpan<SceneRenderItem> CollectMeshes(SceneAssetId<RenderPassAssetTag> passId) =>
            [];

        public ReadOnlySpan<SceneSpriteRenderItem> CollectSprites(SceneAssetId<RenderPassAssetTag> passId) =>
            [];
    }
}
