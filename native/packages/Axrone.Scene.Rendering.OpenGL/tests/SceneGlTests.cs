namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlTests
{
    [Fact]
    public void AssetCache_UploadsDefinitions()
    {
        using var fixture = new SceneGlFixture();
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);

        SceneGlUploadStats stats = cache.UploadAll();

        stats.Shaders.Should().Be(1);
        stats.Meshes.Should().Be(1);
        stats.Materials.Should().Be(1);
        stats.Textures.Should().Be(0);
        stats.Samplers.Should().Be(0);
        cache.TryGetShader(fixture.Shader.Id, out SceneGlShader? shader).Should().BeTrue();
        shader!.Program.Id.Should().NotBe(0U);
        cache.TryGetMesh(fixture.Mesh.Id, out Axrone.Render.OpenGL.Mesh.GLMesh? mesh).Should().BeTrue();
        mesh!.VertexCount.Should().Be(3);
        mesh.IndexCount.Should().Be(3);
        cache.TryGetMaterial(fixture.Material.Id, out SceneGlMaterial? material).Should().BeTrue();
        material!.TextureSlots.Length.Should().Be(0);
    }

    [Fact]
    public void AssetCache_UploadsColorTextureAndSampler()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<SamplerAssetTag> samplerId = fixture.Assets.CreateId<SamplerAssetTag>("test/sampler");
        fixture.Assets.Samplers.Register(new SceneSamplerDefinition(samplerId));
        SceneAssetId<TextureAssetTag> textureId = fixture.Assets.CreateId<TextureAssetTag>("test/texture");
        fixture.Assets.Textures.Register(new SceneTextureDefinition(
            textureId,
            new SceneTextureColor(new Vec4(1.0f, 0.5f, 0.25f, 1.0f), 2, 2),
            samplerId: samplerId));
        SceneAssetId<MaterialAssetTag> materialId = fixture.Assets.CreateId<MaterialAssetTag>("test/textured");
        fixture.Assets.Materials.Register(new SceneMaterialDefinition(
            materialId,
            fixture.Shader.Id,
            new SceneMaterialSurface
            {
                AlbedoMap = new SceneMaterialTextureBinding(textureId, samplerId)
            }));

        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        SceneGlUploadStats stats = cache.UploadAll();

        stats.Textures.Should().Be(1);
        stats.Samplers.Should().Be(1);
        cache.TryGetMaterial(materialId, out SceneGlMaterial? material).Should().BeTrue();
        material!.TextureSlots.Length.Should().Be(1);
        material.TextureSlots.Span[0].UniformName.Should().Be("u_AlbedoMap");
        material.TextureSlots.Span[0].Unit.Should().Be(0);
        fixture.Api.CallLog.Any(call => call.StartsWith("TexSubImage2D", StringComparison.Ordinal))
            .Should().BeTrue();
    }

    [Fact]
    public void AssetCache_RejectsUrlTextureWithoutLoader()
    {
        using var fixture = new SceneGlFixture();
        SceneAssetId<TextureAssetTag> textureId = fixture.Assets.CreateId<TextureAssetTag>("test/url");
        fixture.Assets.Textures.Register(new SceneTextureDefinition(
            textureId,
            new SceneTextureUrl("texture.png")));
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);

        Action upload = () => { _ = cache.UploadAll(); };

        upload.Should().Throw<SceneAssetException>();
    }

    [Fact]
    public void DrawExecutor_SubmitsIndexedDraw()
    {
        using var fixture = new SceneGlFixture();
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        using SceneWorld world = fixture.CreateWorld(out SceneEntity cameraEntity, out SceneEntity rendererEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;
        var pass = new SceneRenderPassDefinition(SceneRenderPassIds.Main, clearMask: SceneClearMask.None);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(1);
        var items = new[] { fixture.CreateItem(rendererEntity) };
        var executor = new SceneGlDrawExecutor(fixture.Context, cache);

        int draws = executor.Render(world, frame, items, lighting: null, pass, frameState);

        draws.Should().Be(1);
        frameState.DrawCalls.Should().Be(1);
        frameState.TrianglesSubmitted.Should().Be(1);
        fixture.Api.CallLog.Any(call => call.StartsWith("DrawElements", StringComparison.Ordinal))
            .Should().BeTrue();
    }

    [Fact]
    public void DrawExecutor_AppliesFogUniforms()
    {
        using var fixture = new SceneGlFixture();
        RegisterFogUniforms(fixture);
        using var shader = new SceneGlShader(
            fixture.Context,
            "fog-test",
            "void main(){}",
            "void main(){}");
        var fog = new SceneFogState(
            Enabled: true,
            Color: new Vec3(0.5f, 0.6f, 0.7f),
            Mode: SceneFogMode.Linear,
            Density: 0.25f,
            RangeStart: 5.0f,
            RangeEnd: 50.0f);

        fixture.Api.ClearCallLog();
        SceneGlDrawExecutor.ApplyFog(shader, in fog);

        fixture.Api.CallLog.Should().Contain(call => call.StartsWith("Uniform1(", StringComparison.Ordinal));
        fixture.Api.CallLog.Should().Contain(call => call.StartsWith("Uniform2(", StringComparison.Ordinal));
        fixture.Api.CallLog.Should().Contain(call => call.StartsWith("Uniform3(", StringComparison.Ordinal));

        fixture.Api.ClearCallLog();
        SceneGlDrawExecutor.ApplyFog(shader, SceneFogState.Default);

        fixture.Api.CallLog.Should().Contain(call => call.StartsWith("Uniform1(", StringComparison.Ordinal));
        fixture.Api.CallLog.Should().NotContain(call => call.StartsWith("Uniform2(", StringComparison.Ordinal));
        fixture.Api.CallLog.Should().NotContain(call => call.StartsWith("Uniform3(", StringComparison.Ordinal));
    }

    [Fact]
    public void DrawExecutor_RecordsFogState()
    {
        using var fixture = new SceneGlFixture();
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        using SceneWorld world = fixture.CreateWorld(out SceneEntity cameraEntity, out SceneEntity rendererEntity);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;
        var pass = new SceneRenderPassDefinition(SceneRenderPassIds.Main, clearMask: SceneClearMask.None);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(1);
        var items = new[] { fixture.CreateItem(rendererEntity) };
        var executor = new SceneGlDrawExecutor(fixture.Context, cache);
        var fog = new SceneFogState(true, Vec3.One, SceneFogMode.Exponential, 0.5f, 0.0f, 100.0f);

        _ = executor.Render(world, frame, items, lighting: null, pass, frameState, fog: fog);

        executor.LastFog.Should().Be(fog);
    }

    private static void RegisterFogUniforms(SceneGlFixture fixture)
    {
        (string Name, int Size, uint Type)[] uniforms =
        [
            ("u_FogEnabled", 1, 0x1404),
            ("u_FogColor", 1, 0x1406),
            ("u_FogMode", 1, 0x1404),
            ("u_FogDensity", 1, 0x1406),
            ("u_FogStartEnd", 1, 0x1406)
        ];

        for (uint program = 1; program <= 512; program++)
        {
            fixture.Api.SetActiveUniforms(program, uniforms);
        }
    }

    [Fact]
    public void DrawExecutor_ClearsPass()
    {
        using var fixture = new SceneGlFixture();
        using var cache = new SceneGlAssetCache(fixture.Context, fixture.Assets);
        _ = cache.UploadAll();
        using SceneWorld world = fixture.CreateWorld(out SceneEntity cameraEntity, out _);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraEntity, 1280, 720)!;
        var pass = new SceneRenderPassDefinition(
            SceneRenderPassIds.Main,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.1f, 0.2f, 0.3f, 1.0f),
            clearDepth: 1.0f);
        var frameState = new SceneRenderFrameState();
        frameState.Begin(2);
        var executor = new SceneGlDrawExecutor(fixture.Context, cache);

        _ = executor.Render(world, frame, ReadOnlySpan<SceneRenderItem>.Empty, lighting: null, pass, frameState);

        fixture.Api.CallLog.Any(call => call == "Clear(16384)").Should().BeTrue();
        fixture.Api.CallLog.Any(call => call == "Clear(256)").Should().BeTrue();
    }

}
