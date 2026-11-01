namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Geometry;
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

public sealed class SceneGlWiringTests
{
    [Fact]
    public void LodMeshItemsAreDrawnThroughTheMeshExecutor()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<MeshAssetTag> mesh = RegisterMesh(assets);
        SceneAssetId<MaterialAssetTag> material = RegisterMaterial(assets);
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld(SceneRenderableFeatures.LodGroup);
        SceneCameraFrame frame = CreateCameraFrame(world);
        SceneActor actor = world.CreateActor("Lod");
        world.UpdateTransforms();

        var source = new LodSource(actor, mesh, material);
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        using var orchestrator = new SceneGlRenderOrchestrator(context, cache, world);
        var state = new SceneRenderFrameState();
        state.Begin(0);
        ReadOnlySpan<SceneRenderPassDefinition> passes = [pass];

        SceneRenderStats stats = orchestrator.RenderFrame(world, frame, source, passes, state);

        stats.DrawCalls.Should().Be(1);
        stats.TrianglesSubmitted.Should().Be(1);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
    }

    [Fact]
    public void EmptyLodSourceAddsNoDraw()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld(SceneRenderableFeatures.LodGroup);
        SceneCameraFrame frame = CreateCameraFrame(world);
        var source = new LodSource(default, default, default);
        using var cache = new SceneGlAssetCache(context, assets);
        using var orchestrator = new SceneGlRenderOrchestrator(context, cache, world);
        var state = new SceneRenderFrameState();
        state.Begin(0);
        ReadOnlySpan<SceneRenderPassDefinition> passes = [pass];

        SceneRenderStats stats = orchestrator.RenderFrame(world, frame, source, passes, state);

        stats.DrawCalls.Should().Be(0);
        api.CallLog.Should().NotContain(call => call.StartsWith("DrawElements(", StringComparison.Ordinal));
    }

    [Fact]
    public void PrimitiveDrawsFollowSpritesInDeterministicOrder()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        var assets = new SceneAssetRegistry();
        SceneAssetId<TextureAssetTag> spriteTexture = RegisterTexture(assets, "texture/sprite");
        SceneAssetId<TextureAssetTag> billboardTexture = RegisterTexture(assets, "texture/billboard");
        SceneRenderPassDefinition pass = RegisterPass(assets);

        using SceneWorld world = CreateWorld(SceneRenderableFeatures.Billboard);
        SceneCameraFrame frame = CreateCameraFrame(world);

        SceneActor spriteActor = world.CreateActor("Sprite");
        SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
        sprite.TextureId = spriteTexture;
        world.AddData(spriteActor, sprite);

        SceneActor billboardActor = world.CreateActor("Billboard");
        SceneBillboardRenderer billboard = SceneBillboardRenderer.Default;
        billboard.TextureId = billboardTexture;
        world.AddData(billboardActor, billboard);
        world.UpdateTransforms();

        var source = new PrimitiveSource(spriteActor, billboardActor, spriteTexture, billboardTexture);
        using var cache = new SceneGlAssetCache(context, assets);
        cache.UploadAll();
        api.EnableCallLogging = true;

        using var orchestrator = new SceneGlRenderOrchestrator(context, cache, world);
        var state = new SceneRenderFrameState();
        state.Begin(0);
        ReadOnlySpan<SceneRenderPassDefinition> passes = [pass];

        SceneRenderStats stats = orchestrator.RenderFrame(world, frame, source, passes, state);

        stats.DrawCalls.Should().Be(4);
        stats.TrianglesSubmitted.Should().Be(8);

        List<int> draws = new();
        List<int> binds = new();
        for (int i = 0; i < api.CallLog.Count; i++)
        {
            string call = api.CallLog[i];
            if (call.StartsWith("DrawElements(", StringComparison.Ordinal))
            {
                draws.Add(i);
            }
            else if (call.StartsWith("BindTexture(", StringComparison.Ordinal))
            {
                binds.Add(i);
            }
        }

        draws.Should().HaveCount(4);
        binds.Should().HaveCount(2);
        binds[0].Should().BeLessThan(draws[0]);
        binds[1].Should().BeGreaterThan(draws[0]).And.BeLessThan(draws[1]);
        (binds[1] > draws[1]).Should().BeFalse();

        state.Begin(1);
        SceneRenderStats second = orchestrator.RenderFrame(world, frame, source, passes, state);
        second.DrawCalls.Should().Be(stats.DrawCalls);
        second.TrianglesSubmitted.Should().Be(stats.TrianglesSubmitted);
    }

    private sealed class LodSource(SceneActor actor, SceneAssetId<MeshAssetTag> mesh, SceneAssetId<MaterialAssetTag> material)
        : ISceneFrameItemSource, ISceneLodFrameItemSource
    {
        private readonly SceneRenderItem[] _items = actor.IsValid
            ?
            [
                new SceneRenderItem
                {
                    Actor = actor,
                    MeshId = mesh,
                    MaterialId = material,
                    RenderOrder = 0,
                    Transparent = false,
                    ReceiveLighting = false,
                    HasBounds = false
                }
            ]
            : [];

        public LightingSelectionState? Lighting => null;

        public SceneFogState Fog { get; set; } = SceneFogState.Default;

        public ReadOnlySpan<SceneRenderItem> CollectMeshes(SceneAssetId<RenderPassAssetTag> passId) => [];

        public ReadOnlySpan<SceneSpriteRenderItem> CollectSprites(SceneAssetId<RenderPassAssetTag> passId) => [];

        public ReadOnlySpan<SceneRenderItem> CollectLodMeshItems(SceneAssetId<RenderPassAssetTag> passId) => _items;
    }

    private sealed class PrimitiveSource(
        SceneActor spriteActor,
        SceneActor billboardActor,
        SceneAssetId<TextureAssetTag> spriteTexture,
        SceneAssetId<TextureAssetTag> billboardTexture)
        : ISceneFrameItemSource, IScenePrimitiveFrameItemSource
    {
        private readonly SceneSpriteRenderItem[] _sprites =
        [
            new SceneSpriteRenderItem
            {
                Actor = spriteActor,
                TextureId = spriteTexture,
                MaterialId = default,
                Size = Vec2.One,
                Anchor = new Vec2(0.5f, 0.5f),
                Color = Vec4.One,
                UvRect = new Vec4(0, 0, 1, 1)
            }
        ];

        private readonly SceneBillboardRenderItem[] _billboards =
        [
            new SceneBillboardRenderItem
            {
                Actor = billboardActor,
                TextureId = billboardTexture,
                MaterialId = default,
                Size = Vec2.One,
                Anchor = new Vec2(0.5f, 0.5f),
                Color = Vec4.One,
                UvRect = new Vec4(0, 0, 1, 1),
                Mode = SceneBillboardMode.Spherical
            }
        ];

        private readonly SceneLineRenderItem[] _lines =
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

        private readonly SceneTrailRenderItem[] _trails =
        [
            new SceneTrailRenderItem
            {
                Start = new Vec3(-1, 0, 0),
                End = new Vec3(0, 0, 0),
                Width = 0.2f,
                Color = Vec4.One,
                StartAlpha = 1.0f,
                EndAlpha = 0.5f
            }
        ];

        public LightingSelectionState? Lighting => null;

        public SceneFogState Fog { get; set; } = SceneFogState.Default;

        public ReadOnlySpan<SceneRenderItem> CollectMeshes(SceneAssetId<RenderPassAssetTag> passId) => [];

        public ReadOnlySpan<SceneSpriteRenderItem> CollectSprites(SceneAssetId<RenderPassAssetTag> passId) => _sprites;

        public ReadOnlySpan<SceneBillboardRenderItem> CollectBillboards(SceneAssetId<RenderPassAssetTag> passId) => _billboards;

        public ReadOnlySpan<SceneLineRenderItem> CollectLines(SceneAssetId<RenderPassAssetTag> passId) => _lines;

        public ReadOnlySpan<SceneTrailRenderItem> CollectTrails(SceneAssetId<RenderPassAssetTag> passId) => _trails;
    }

    private static SceneWorld CreateWorld(SceneRenderableFeatures features) =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/gl-wiring")))
            .AddTransform3D()
            .AddRendering3D()
            .AddRendering2D(includeCamera: false)
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

    private static SceneAssetId<MeshAssetTag> RegisterMesh(SceneAssetRegistry assets)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>("mesh/wiring");
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)
        ];
        assets.Meshes.Register(new SceneMeshDefinition(
            id,
            new byte[36],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));
        return id;
    }

    private static SceneAssetId<MaterialAssetTag> RegisterMaterial(SceneAssetRegistry assets)
    {
        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("shader/wiring");
        assets.Shaders.Register(new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}"));
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("material/wiring");
        assets.Materials.Register(new SceneMaterialDefinition(materialId, shaderId, new SceneMaterialSurface()));
        return materialId;
    }

    private static SceneAssetId<TextureAssetTag> RegisterTexture(SceneAssetRegistry assets, string name)
    {
        SceneAssetId<TextureAssetTag> id = assets.CreateId<TextureAssetTag>(name);
        assets.Textures.Register(new SceneTextureDefinition(id, new SceneTextureColor(Vec4.One, 8, 8)));
        return id;
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
}
