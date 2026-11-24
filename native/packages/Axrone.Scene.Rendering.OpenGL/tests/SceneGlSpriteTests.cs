namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System.Runtime.InteropServices;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlSpriteTests
{
    [Fact]
    public void SpriteBatch_RendersGroupedTextures()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneRenderPassDefinition pass = RegisterPass(assets);
        SceneAssetId<TextureAssetTag> textureA = RegisterTexture(assets, "texture/a");
        SceneAssetId<TextureAssetTag> textureB = RegisterTexture(assets, "texture/b");

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);
        CreateSprite(world, textureA, new Vec2(-1.0f, 0.0f), sortingLayer: 0);
        CreateSprite(world, textureA, new Vec2(0.0f, 0.0f), sortingLayer: 1);
        CreateSprite(world, textureB, new Vec2(1.0f, 0.0f), sortingLayer: 2);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(3);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        int drawCalls = renderer.Render(world, frame, collector.Items, pass, frameState);

        drawCalls.Should().Be(2);
        renderer.LastSpriteCount.Should().Be(3);
        frameState.DrawCalls.Should().Be(2);
        frameState.TrianglesSubmitted.Should().Be(6);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements", StringComparison.Ordinal));

        // The final batch restarts its vertex base, so its uploaded indices must
        // reference vertices 0..3 of that batch, not the global sprite slot.
        byte[] indexStorage = api.BufferStorage.Values
            .First(storage => storage.Length == sizeof(uint) * 6);
        MemoryMarshal.Cast<byte, uint>(indexStorage.AsSpan()).ToArray()
            .Should().Equal(0u, 1u, 2u, 0u, 2u, 3u);
    }

    [Fact]
    public void SpriteBatch_SkipsEmptyPlans()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(0);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, frameState).Should().Be(0);
        frameState.DrawCalls.Should().Be(0);
    }

    private static SceneProfile CreateProfile() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-sprite")))
            .AddTransform2D()
            .AddRendering2D()
            .Build();

    private static SceneWorld CreateWorld() => CreateProfile().CreateWorld();

    private static SceneCameraFrame CreateCameraFrame(SceneWorld world)
    {
        SceneEntity cameraEntity = world.CreateEntity("Camera2D");
        world.GetTransform2D(cameraEntity).SetPosition(Vec2.Zero);

        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        camera.OrthographicSize = 5.0f;
        world.AddData(cameraEntity, camera);
        world.AddData(cameraEntity, SceneCamera2D.Default);
        world.UpdateTransforms();

        return new SceneCamera2DFrameCollector().Collect(world, 320, 180)!;
    }

    private static SceneRenderPassDefinition RegisterPass(SceneAssetRegistry assets)
    {
        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("main");
        var pass = new SceneRenderPassDefinition(
            passId,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.05f, 0.06f, 0.08f, 1.0f),
            depthTest: false,
            blend: true);
        assets.RenderPasses.Register(pass);
        return pass;
    }

    private static SceneAssetId<TextureAssetTag> RegisterTexture(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<TextureAssetTag> id = assets.CreateId<TextureAssetTag>(name);
        assets.Textures.Register(new SceneTextureDefinition(
            id,
            new SceneTextureColor(Vec4.One, 8, 8)));
        return id;
    }

    private static void CreateSprite(
        SceneWorld world,
        SceneAssetId<TextureAssetTag> textureId,
        Vec2 position,
        int sortingLayer)
    {
        SceneEntity entity = world.CreateEntity("Sprite");
        world.GetTransform2D(entity).SetPosition(position);

        SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
        sprite.TextureId = textureId;
        sprite.SortingLayer = sortingLayer;
        world.AddData(entity, sprite);
    }
}
