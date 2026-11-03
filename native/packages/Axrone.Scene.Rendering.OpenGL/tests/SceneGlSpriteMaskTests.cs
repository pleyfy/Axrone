namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System.Runtime.InteropServices;
using Axrone.Numeric;
using Axrone.Render2D;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlSpriteMaskTests
{
    [Fact]
    public void MaskedSpriteBindsMaskUniforms()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneRenderPassDefinition pass = RegisterPass(assets);
        SceneAssetId<TextureAssetTag> texture = RegisterTexture(assets, "texture/masked");

        using SceneWorld world = CreateWorld();
        SceneCameraFrame frame = CreateCameraFrame(world);

        SceneActor actor = world.CreateActor("Sprite");
        SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
        sprite.TextureId = texture;
        world.AddData(actor, sprite);

        SceneSpriteMask mask = SceneSpriteMask.Default;
        mask.Kind = SceneSpriteMaskKind.Ellipse;
        mask.Rect = new Vec4(0.1f, 0.2f, 0.3f, 0.4f);
        mask.Invert = true;
        mask.Feather = 0.15f;
        world.AddData(actor, mask);
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(1);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, frameState).Should().Be(1);
        renderer.LastMaskShape.Should().Be(Render2DSpriteShaderContract.MaskShapeCircle);
        renderer.LastBatchCount.Should().Be(1);
        renderer.LastSpriteCount.Should().Be(1);
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-mask")))
            .AddTransform2D()
            .AddRendering2D()
            .AddSceneRenderables(SceneRenderableFeatures.SpriteMask)
            .Build()
            .CreateWorld();

    private static SceneCameraFrame CreateCameraFrame(SceneWorld world)
    {
        SceneActor cameraActor = world.CreateActor("Camera2D");
        world.GetTransform2D(cameraActor).SetPosition(Vec2.Zero);

        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        camera.OrthographicSize = 5.0f;
        world.AddData(cameraActor, camera);
        world.AddData(cameraActor, SceneCamera2D.Default);
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
}
