namespace Axrone.Scene.Rendering.OpenGL.Tests;

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

public sealed class SceneGlSpriteInstancingTests
{
    [Fact]
    public void MaterialChangeSplitsBatchesInsideOneTexture()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out SceneAssetId<MaterialAssetTag> materialA, out SceneAssetId<MaterialAssetTag> materialB);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        CreateSprite(world, texture, materialA, new Vec2(-1.0f, 0.0f));
        CreateSprite(world, texture, materialB, new Vec2(0.0f, 0.0f));
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(2);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, frameState).Should().Be(2);
        renderer.LastSpriteCount.Should().Be(2);
        renderer.LastImmediateRunCount.Should().Be(2);
        frameState.TrianglesSubmitted.Should().Be(4);
    }

    [Fact]
    public void DefaultMaterialKeepsTextureOnlyGrouping()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out _, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        CreateSprite(world, texture, default, new Vec2(-1.0f, 0.0f));
        CreateSprite(world, texture, default, new Vec2(0.0f, 0.0f));
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(2);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, frameState).Should().Be(1);
        renderer.LastImmediateRunCount.Should().Be(1);
        renderer.LastImmediateSpriteCount.Should().Be(2);
    }

    [Fact]
    public void LongRunUsesTheInstancedPath()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out SceneAssetId<MaterialAssetTag> material, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        for (int i = 0; i < 6; i++)
        {
            CreateSprite(world, texture, material, new Vec2(i, 0.0f));
        }

        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(6);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 4);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, frameState).Should().Be(1);
        renderer.MinInstancesForFastPath.Should().Be(4);
        renderer.LastInstancedRunCount.Should().Be(1);
        renderer.LastInstancedSpriteCount.Should().Be(6);
        renderer.LastImmediateSpriteCount.Should().Be(0);
        frameState.TrianglesSubmitted.Should().Be(12);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElementsInstanced(", StringComparison.Ordinal) && call.Contains(", 6)"));
    }

    [Fact]
    public void ShortRunUsesTheImmediatePath()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out SceneAssetId<MaterialAssetTag> material, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        for (int i = 0; i < 6; i++)
        {
            CreateSprite(world, texture, material, new Vec2(i, 0.0f));
        }

        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(6);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 8);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, frameState).Should().Be(1);
        renderer.LastImmediateSpriteCount.Should().Be(6);
        renderer.LastInstancedSpriteCount.Should().Be(0);
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawElementsInstanced(", StringComparison.Ordinal));
        frameState.TrianglesSubmitted.Should().Be(12);
    }

    [Fact]
    public void InstancedAndImmediatePathsProduceEquivalentPlans()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out SceneAssetId<MaterialAssetTag> material, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        for (int i = 0; i < 6; i++)
        {
            CreateSprite(world, texture, material, new Vec2(i, 0.0f));
        }

        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(6);

        using var instanced = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 1);
        using var immediate = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 1000);
        var instancedState = new SceneRenderFrameState();
        instancedState.Begin(0);
        var immediateState = new SceneRenderFrameState();
        immediateState.Begin(0);

        int instancedDraws = instanced.Render(world, frame, collector.Items, pass, instancedState);
        int immediateDraws = immediate.Render(world, frame, collector.Items, pass, immediateState);

        instancedDraws.Should().Be(immediateDraws);
        instanced.LastSpriteCount.Should().Be(immediate.LastSpriteCount);
        instancedState.TrianglesSubmitted.Should().Be(immediateState.TrianglesSubmitted);
        instancedState.DrawCalls.Should().Be(immediateState.DrawCalls);
    }

    [Fact]
    public void MixedRunsChooseThePathPerGroup()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> textureA, out SceneAssetId<TextureAssetTag> textureB, out SceneAssetId<MaterialAssetTag> material, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        for (int i = 0; i < 5; i++)
        {
            CreateSprite(world, textureA, material, new Vec2(i, 0.0f));
        }

        CreateSprite(world, textureB, material, new Vec2(6.0f, 0.0f));
        CreateSprite(world, textureB, material, new Vec2(7.0f, 0.0f));
        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(7);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 4);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, frameState).Should().Be(2);
        renderer.LastInstancedRunCount.Should().Be(1);
        renderer.LastImmediateRunCount.Should().Be(1);
        renderer.LastInstancedSpriteCount.Should().Be(5);
        renderer.LastImmediateSpriteCount.Should().Be(2);
    }

    [Fact]
    public void LargeInstancedRunGrowsTheInstanceBuffer()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out SceneAssetId<MaterialAssetTag> material, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        for (int i = 0; i < 600; i++)
        {
            CreateSprite(world, texture, material, new Vec2(i % 40, i / 40));
        }

        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector(1024);
        collector.Collect(world, frame, SceneRenderPassIds.Main, cull: false).Should().Be(600);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 1);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, collector.Items, pass, frameState).Should().Be(1);
        renderer.LastInstancedSpriteCount.Should().Be(600);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElementsInstanced(", StringComparison.Ordinal) && call.Contains(", 600)"));
    }

    [Fact]
    public void RepeatRenderIsDeterministic()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out SceneAssetId<MaterialAssetTag> material, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        for (int i = 0; i < 40; i++)
        {
            CreateSprite(world, texture, material, new Vec2(i % 8, i / 8));
        }

        world.UpdateTransforms();

        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(40);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 8);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        int firstStart = api.CallLog.Count;
        int firstDraws = renderer.Render(world, frame, collector.Items, pass, frameState);
        int firstCount = renderer.LastSpriteCount;
        string[] first = api.CallLog.Skip(firstStart).Where(IsDraw).ToArray();
        int secondStart = api.CallLog.Count;
        int secondDraws = renderer.Render(world, frame, collector.Items, pass, frameState);
        string[] second = api.CallLog.Skip(secondStart).Where(IsDraw).ToArray();

        firstDraws.Should().Be(secondDraws);
        renderer.LastSpriteCount.Should().Be(firstCount);
        second.Should().Equal(first);
    }

    [Fact]
    public void EmptyPlanAndDisposeAreIdempotent()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out _, out _, out _, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        using var cache = new SceneGlAssetCache(context, assets);
        SceneGlSpriteBatchRenderer renderer = new(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.Render(world, frame, [], pass, frameState).Should().Be(0);
        renderer.LastSpriteCount.Should().Be(0);

        renderer.Dispose();
        renderer.Dispose();

        Action act = () => renderer.Render(world, frame, [], pass, frameState);
        act.Should().Throw<SceneDisposedException>();
    }

    [Fact]
    public void InvalidThresholdIsRejected()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out _, out _, out _, out _, out _);
        using var cache = new SceneGlAssetCache(context, assets);

        FluentActions.Invoking(() => new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 0))
            .Should().Throw<SceneConfigurationException>();
    }

    private static bool IsDraw(string call) =>
        call.StartsWith("DrawElements", StringComparison.Ordinal);

    private static SceneAssetRegistry CreateAssets(
        out SceneRenderPassDefinition pass,
        out SceneAssetId<TextureAssetTag> textureA,
        out SceneAssetId<TextureAssetTag> textureB,
        out SceneAssetId<MaterialAssetTag> materialA,
        out SceneAssetId<MaterialAssetTag> materialB)
    {
        var assets = new SceneAssetRegistry();

        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>(Render2DSpriteShaderContract.DefaultShaderId);
        assets.Shaders.Register(new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}"));

        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("main");
        pass = new SceneRenderPassDefinition(
            passId,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.05f, 0.06f, 0.08f, 1.0f),
            depthTest: false,
            blend: true);
        assets.RenderPasses.Register(pass);

        textureA = RegisterTexture(assets, "texture/a");
        textureB = RegisterTexture(assets, "texture/b");
        materialA = RegisterMaterial(assets, shaderId, "material/one");
        materialB = RegisterMaterial(assets, shaderId, "material/two");
        return assets;
    }

    private static SceneAssetId<TextureAssetTag> RegisterTexture(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<TextureAssetTag> id = assets.CreateId<TextureAssetTag>(name);
        assets.Textures.Register(new SceneTextureDefinition(
            id,
            new SceneTextureColor(Vec4.One, 8, 8)));
        return id;
    }

    private static SceneAssetId<MaterialAssetTag> RegisterMaterial(SceneAssetRegistry assets, SceneAssetId<ShaderAssetTag> shaderId, string name)
    {
        SceneAssetId<MaterialAssetTag> id = assets.CreateId<MaterialAssetTag>(name);
        assets.Materials.Register(new SceneMaterialDefinition(
            id,
            shaderId,
            new SceneMaterialSurface()));
        return id;
    }

    private static SceneWorld CreateWorld(out SceneCameraFrame frame)
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-sprite-instancing")));
        SceneWorld world = builder.AddTransform2D().AddRendering2D().Build().CreateWorld();

        SceneActor cameraActor = world.CreateActor("Camera2D");
        world.GetTransform2D(cameraActor).SetPosition(Vec2.Zero);

        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        camera.OrthographicSize = 5.0f;
        world.AddData(cameraActor, camera);
        world.AddData(cameraActor, SceneCamera2D.Default);
        world.UpdateTransforms();

        frame = new SceneCamera2DFrameCollector().Collect(world, 320, 180)!;
        return world;
    }

    private static void CreateSprite(
        SceneWorld world,
        SceneAssetId<TextureAssetTag> textureId,
        SceneAssetId<MaterialAssetTag> materialId,
        Vec2 position)
    {
        SceneActor actor = world.CreateActor("Sprite");
        world.GetTransform2D(actor).SetPosition(position);

        SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
        sprite.TextureId = textureId;
        sprite.MaterialId = materialId;
        world.AddData(actor, sprite);
    }
}
