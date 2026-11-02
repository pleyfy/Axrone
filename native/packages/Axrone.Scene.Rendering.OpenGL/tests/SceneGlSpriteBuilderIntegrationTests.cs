namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Render2D;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlSpriteBuilderIntegrationTests
{
    [Fact]
    public void UploadedVerticesMatchBuilderOutput()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        var submission = new Render2DSpriteSubmission(
            Render2DSpriteSource.Texture(texture.Value.Value),
            Mat4.CreateTranslation(1.0f, 2.0f, 0.0f),
            new Vec2(10.0f, 10.0f),
            new Vec2(0.5f, 0.5f),
            new Rect(0.0f, 0.0f, 1.0f, 1.0f),
            Vec4.One);
        var builder = new Render2DSpriteBatchBuilder();
        Render2DSpriteBatchBuildResult expected = builder.Build([submission]);

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);
        renderer.RenderSubmissions(frame, [submission], pass, frameState).Should().Be(1);

        byte[] expectedBytes = expected.VertexData.ToArray();
        api.BufferStorage.Values
            .Any(storage => storage.Length >= expectedBytes.Length &&
                storage.AsSpan(0, expectedBytes.Length).SequenceEqual(expectedBytes))
            .Should().BeTrue();
        renderer.LastSpriteCount.Should().Be(1);
        renderer.LastBatchCount.Should().Be(1);
        renderer.LastUsesUint32Indices.Should().BeFalse();
    }

    [Fact]
    public void UsesUint32IndexTypeAboveSixteenBitVertices()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        var submissions = new Render2DSpriteSubmission[16385];
        for (int i = 0; i < submissions.Length; i++)
        {
            submissions[i] = new Render2DSpriteSubmission(
                Render2DSpriteSource.Texture(texture.Value.Value),
                Mat4.Identity,
                new Vec2(1.0f, 1.0f),
                new Vec2(0.5f, 0.5f),
                new Rect(0.0f, 0.0f, 1.0f, 1.0f),
                Vec4.One);
        }

        using var renderer = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 100000);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);
        renderer.RenderSubmissions(frame, submissions, pass, frameState).Should().BeGreaterThan(0);

        renderer.LastUsesUint32Indices.Should().BeTrue();
        renderer.LastSpriteCount.Should().Be(16385);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements(4, ", StringComparison.Ordinal) && call.Contains(", 5125)", StringComparison.Ordinal));
    }

    [Fact]
    public void SupportedMaterialBindsItsTint()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out SceneAssetId<MaterialAssetTag> material, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        Render2DSpriteSubmission submission = CreateSubmission(texture, material.Value.Value);
        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.RenderSubmissions(frame, [submission], pass, frameState).Should().Be(1);

        renderer.LastMaterialTint.Should().Be(new Vec4(0.25f, 0.5f, 0.75f, 1.0f));
        renderer.SkippedMaterialBatches.Should().Be(0);
    }

    [Fact]
    public void UnsupportedMaterialIsRejectedWithoutDrawing()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out SceneAssetId<MaterialAssetTag> unsupported);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        Render2DSpriteSubmission submission = CreateSubmission(texture, unsupported.Value.Value);
        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.RenderSubmissions(frame, [submission], pass, frameState).Should().Be(0);

        renderer.SkippedMaterialBatches.Should().Be(1);
        renderer.LastMaterialFailure.Should().Be(SceneGlSpriteMaterialFailure.UnsupportedShader);
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
    }

    [Fact]
    public void MissingMaterialIsRejectedWithoutDrawing()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        Render2DSpriteSubmission submission = CreateSubmission(
            texture,
            SceneAssetId<MaterialAssetTag>.FromName("material/missing").Value.Value);
        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.RenderSubmissions(frame, [submission], pass, frameState).Should().Be(0);

        renderer.SkippedMaterialBatches.Should().Be(1);
        renderer.LastMaterialFailure.Should().Be(SceneGlSpriteMaterialFailure.MissingMaterial);
    }

    [Fact]
    public void SlicedSpriteUsesExpandedImmediateGeometry()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out SceneAssetId<TextureAssetTag> texture, out _, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();

        var submission = new Render2DSpriteSubmission(
            Render2DSpriteSource.Texture(texture.Value.Value),
            Mat4.Identity,
            new Vec2(10.0f, 10.0f),
            new Vec2(0.5f, 0.5f),
            new Rect(0.0f, 0.0f, 1.0f, 1.0f),
            Vec4.One,
            HasSlice: true,
            Slice: new Render2DSpriteSlice(new Vec2(8.0f, 8.0f), new Render2DBorder(2.0f, 2.0f, 2.0f, 2.0f)));
        using var renderer = new SceneGlSpriteBatchRenderer(context, cache, minInstancesForFastPath: 1);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.RenderSubmissions(frame, [submission], pass, frameState).Should().Be(1);

        renderer.LastImmediateRunCount.Should().Be(1);
        renderer.LastInstancedRunCount.Should().Be(0);
        renderer.LastImmediateSpriteCount.Should().Be(1);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements(4, 54, ", StringComparison.Ordinal));
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawElementsInstanced(", StringComparison.Ordinal));
    }

    [Fact]
    public void EmptySubmissionPlanDrawsNothing()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        SceneAssetRegistry assets = CreateAssets(out SceneRenderPassDefinition pass, out _, out _, out _);
        using SceneWorld world = CreateWorld(out SceneCameraFrame frame);
        using var cache = new SceneGlAssetCache(context, assets);
        using var renderer = new SceneGlSpriteBatchRenderer(context, cache);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(0);

        renderer.RenderSubmissions(frame, [], pass, frameState).Should().Be(0);
        renderer.LastBatchCount.Should().Be(0);
        renderer.LastSpriteCount.Should().Be(0);
    }

    private static Render2DSpriteSubmission CreateSubmission(
        SceneAssetId<TextureAssetTag> texture,
        ulong materialId) =>
        new(
            Render2DSpriteSource.Texture(texture.Value.Value),
            Mat4.Identity,
            new Vec2(10.0f, 10.0f),
            new Vec2(0.5f, 0.5f),
            new Rect(0.0f, 0.0f, 1.0f, 1.0f),
            Vec4.One,
            MaterialId: materialId);

    private static SceneAssetRegistry CreateAssets(
        out SceneRenderPassDefinition pass,
        out SceneAssetId<TextureAssetTag> texture,
        out SceneAssetId<MaterialAssetTag> material,
        out SceneAssetId<MaterialAssetTag> unsupportedMaterial)
    {
        var assets = new SceneAssetRegistry();

        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>(Render2DSpriteShaderContract.DefaultShaderId);
        assets.Shaders.Register(new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}"));

        SceneAssetId<ShaderAssetTag> otherShaderId = assets.CreateId<ShaderAssetTag>("test/other-shader");
        assets.Shaders.Register(new SceneShaderDefinition(otherShaderId, "void main(){}", "void main(){}"));

        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("main");
        pass = new SceneRenderPassDefinition(
            passId,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.05f, 0.06f, 0.08f, 1.0f),
            depthTest: false,
            blend: true);
        assets.RenderPasses.Register(pass);

        texture = assets.CreateId<TextureAssetTag>("texture/a");
        assets.Textures.Register(new SceneTextureDefinition(texture, new SceneTextureColor(Vec4.One, 8, 8)));

        material = assets.CreateId<MaterialAssetTag>("material/sprite");
        assets.Materials.Register(new SceneMaterialDefinition(
            material,
            shaderId,
            new SceneMaterialSurface { Albedo = new Vec4(0.25f, 0.5f, 0.75f, 1.0f) }));

        unsupportedMaterial = assets.CreateId<MaterialAssetTag>("material/other");
        assets.Materials.Register(new SceneMaterialDefinition(
            unsupportedMaterial,
            otherShaderId,
            new SceneMaterialSurface()));
        return assets;
    }

    private static SceneWorld CreateWorld(out SceneCameraFrame frame)
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-sprite-builder")));
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
}
