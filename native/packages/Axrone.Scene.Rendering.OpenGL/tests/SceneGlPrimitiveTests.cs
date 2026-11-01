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

public sealed class SceneGlPrimitiveTests
{
    [Fact]
    public void BillboardBatchDrawsOneTextureRun()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(assets, "texture/billboard");
        SceneRenderPassDefinition pass = CreatePass();

        using SceneWorld world = CreateWorld(SceneRenderableFeatures.Billboard);
        SceneCameraFrame frame = CreateCameraFrame(world);

        SceneActor actor = world.CreateActor("Billboard");
        SceneBillboardRenderer billboard = SceneBillboardRenderer.Default;
        billboard.TextureId = texture;
        world.AddData(actor, billboard);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneBillboardItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(1);

        using var renderer = new SceneGlPrimitiveBatchRenderer(context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        int drawCalls = renderer.RenderBillboards(world, frame, collector.Items, pass, state);

        drawCalls.Should().Be(1);
        renderer.LastQuadCount.Should().Be(1);
        state.DrawCalls.Should().Be(1);
        state.TrianglesSubmitted.Should().Be(2);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
        api.BufferStorage.Values.Should().Contain(storage => storage.Length == 4 * 36);
    }

    [Fact]
    public void LineBatchDrawsRibbonQuads()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        using SceneWorld world = CreateWorld(SceneRenderableFeatures.Line);
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneRenderPassDefinition pass = CreatePass();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        ReadOnlySpan<SceneLineRenderItem> items =
        [
            new SceneLineRenderItem
            {
                Start = new Vec3(-1, 0, 0),
                End = new Vec3(1, 0, 0),
                Width = 0.1f,
                Color = Vec4.One,
                Cap = SceneLineCap.Butt,
                Join = SceneLineJoin.Miter
            }
        ];

        using var renderer = new SceneGlPrimitiveBatchRenderer(context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.RenderLines(frame, items, pass, state).Should().Be(1);
        renderer.LastQuadCount.Should().Be(1);
        state.TrianglesSubmitted.Should().Be(2);
    }

    [Fact]
    public void TrailBatchCarriesPerEndpointAlpha()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        using SceneWorld world = CreateWorld(SceneRenderableFeatures.Trail);
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneRenderPassDefinition pass = CreatePass();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        ReadOnlySpan<SceneTrailRenderItem> items =
        [
            new SceneTrailRenderItem
            {
                Start = new Vec3(-1, 0, 0),
                End = new Vec3(0, 0, 0),
                Width = 0.2f,
                Color = Vec4.One,
                StartAlpha = 0.0f,
                EndAlpha = 0.5f
            }
        ];

        using var renderer = new SceneGlPrimitiveBatchRenderer(context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.RenderTrails(frame, items, pass, state).Should().Be(1);
        renderer.LastQuadCount.Should().Be(1);
        state.TrianglesSubmitted.Should().Be(2);
    }

    [Fact]
    public void EmptyPlansIssueNoDraws()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        using SceneWorld world = CreateWorld(SceneRenderableFeatures.Trail);
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneRenderPassDefinition pass = CreatePass();

        using var cache = new SceneGlAssetCache(context, assets);
        using var renderer = new SceneGlPrimitiveBatchRenderer(context, cache);
        var state = new SceneRenderFrameState();
        state.Begin(0);

        renderer.RenderLines(frame, [], pass, state).Should().Be(0);
        renderer.RenderTrails(frame, [], pass, state).Should().Be(0);
        state.DrawCalls.Should().Be(0);
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
    }

    private static SceneWorld CreateWorld(SceneRenderableFeatures features) =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-primitive")))
            .AddTransform3D()
            .AddRendering3D()
            .AddSceneRenderables(features)
            .Build()
            .CreateWorld();

    private static SceneCameraFrame CreateCameraFrame(SceneWorld world)
    {
        SceneActor actor = world.CreateActor("Camera");
        world.GetTransform3D(actor).SetPosition(new Vec3(0, 0, 10));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(actor, camera);
        world.UpdateTransforms();
        return new SceneCameraFrameCollector().Collect(world, actor, 800, 600)!;
    }

    private static SceneRenderPassDefinition CreatePass() => new(
        SceneRenderPassIds.Main,
        clearMask: SceneClearMask.Color,
        clearColor: Vec4.One,
        depthTest: false,
        blend: true);

    private static SceneAssetId<TextureAssetTag> RegisterTexture(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<TextureAssetTag> id = assets.CreateId<TextureAssetTag>(name);
        assets.Textures.Register(new SceneTextureDefinition(id, new SceneTextureColor(Vec4.One, 8, 8)));
        return id;
    }
}
