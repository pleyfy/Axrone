namespace Axrone.Scene.Rendering.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneRendering2DTests
{
    [Fact]
    public void Camera2DFrame_ProjectsScenePlane()
    {
        using SceneWorld world = CreateProfile2D().CreateWorld();
        SceneActor cameraActor = CreateCamera2D(world, new Vec2(0.0f, 0.0f), orthographicSize: 5.0f);
        var collector = new SceneCamera2DFrameCollector();

        SceneCameraFrame? frame = collector.Collect(world, cameraActor, 1280, 720);

        frame.Should().NotBeNull();
        frame!.Position.Should().Be(new Vec3(0.0f, 0.0f, -10.0f));
        frame.AspectRatio.Should().BeApproximately(1280.0f / 720.0f, 1e-5f);
        frame.Frustum.ContainsPoint(Vec3.Zero).Should().BeTrue();
        frame.Frustum.ContainsPoint(new Vec3(20.0f, 0.0f, 0.0f)).Should().BeFalse();
        frame.Frustum.ContainsPoint(new Vec3(0.0f, 0.0f, -50.0f)).Should().BeFalse();
    }

    [Fact]
    public void SpriteItemCollector_FlagsSlicedSprites()
    {
        using SceneWorld world = CreateProfile2D().CreateWorld();
        _ = CreateCamera2D(world, Vec2.Zero);
        SceneAssetId<TextureAssetTag> textureId = TextureId();
        SceneCameraFrame frame = new SceneCamera2DFrameCollector().Collect(world, 640, 360)!;

        SceneActor actor = world.CreateActor("Sliced");
        world.GetTransform2D(actor).SetPosition(Vec2.Zero);
        SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
        sprite.TextureId = textureId;
        sprite.SourceSize = new Vec2(16.0f, 16.0f);
        sprite.SliceBorder = new Vec4(4.0f, 4.0f, 4.0f, 4.0f);
        world.AddData(actor, sprite);
        world.UpdateTransforms();

        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(1);

        collector.Items[0].HasSlice.Should().BeTrue();
        collector.Items[0].SliceBorder.Should().Be(new Vec4(4.0f, 4.0f, 4.0f, 4.0f));
    }

    [Fact]
    public void Camera2DSelector_SelectsPrimaryCamera()
    {
        using SceneWorld world = CreateProfile2D().CreateWorld();
        _ = CreateCamera2D(world, new Vec2(0.0f, 0.0f), primary: false);
        SceneActor primary = CreateCamera2D(world, new Vec2(3.0f, 4.0f), primary: true);

        SceneCamera2DSelector.TrySelect(world, out SceneActor selected).Should().BeTrue();
        selected.Should().Be(primary);
    }

    [Fact]
    public void CameraSelector_SkipsTwoDCameras()
    {
        using SceneWorld world = CreateProfile2D().CreateWorld();
        _ = CreateCamera2D(world, Vec2.Zero, primary: true);

        SceneCameraSelector.TrySelect(world, out _).Should().BeFalse();
    }

    [Fact]
    public void SpriteItemCollector_SortsByLayerAndDepth()
    {
        using SceneWorld world = CreateProfile2D().CreateWorld();
        _ = CreateCamera2D(world, Vec2.Zero);
        SceneAssetId<TextureAssetTag> textureId = TextureId();
        SceneCameraFrame frame = new SceneCamera2DFrameCollector().Collect(world, 640, 360)!;

        SceneActor far = CreateSprite(world, textureId, new Vec2(-1.0f, 0.0f), sortingLayer: 0, depth: 0.5f);
        SceneActor near = CreateSprite(world, textureId, new Vec2(0.0f, 0.0f), sortingLayer: 0, depth: 0.2f);
        SceneActor topLayer = CreateSprite(world, textureId, new Vec2(1.0f, 0.0f), sortingLayer: 1, depth: -1.0f);
        world.UpdateTransforms();

        var collector = new SceneSpriteItemCollector();
        int count = collector.Collect(world, frame, SceneRenderPassIds.Main);

        count.Should().Be(3);
        collector.Items[0].Actor.Should().Be(near);
        collector.Items[1].Actor.Should().Be(far);
        collector.Items[2].Actor.Should().Be(topLayer);
    }

    [Fact]
    public void SpriteItemCollector_CullsOutsideFrustum()
    {
        using SceneWorld world = CreateProfile2D().CreateWorld();
        _ = CreateCamera2D(world, Vec2.Zero);
        SceneAssetId<TextureAssetTag> textureId = TextureId();
        SceneCameraFrame frame = new SceneCamera2DFrameCollector().Collect(world, 640, 360)!;
        _ = CreateSprite(world, textureId, new Vec2(100.0f, 0.0f));
        world.UpdateTransforms();

        var collector = new SceneSpriteItemCollector();

        frame.Frustum.ContainsPoint(new Vec3(100.0f, 0.0f, 0.0f)).Should().BeFalse();
        frame.Frustum.IntersectsSphere(
            new BoundingSphere3(new Vec3(100.0f, 0.0f, 0.0f), 0.7071f))
            .Should().BeFalse();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(0);
        collector.CulledCount.Should().Be(1);
        collector.Collect(world, frame, SceneRenderPassIds.Main, cull: false).Should().Be(1);
        collector.CulledCount.Should().Be(0);
    }

    [Fact]
    public void SpriteItemCollector_SteadyStateDoesNotAllocate()
    {
        using SceneWorld world = CreateProfile2D().CreateWorld();
        _ = CreateCamera2D(world, Vec2.Zero);
        SceneAssetId<TextureAssetTag> textureId = TextureId();
        SceneCameraFrame frame = new SceneCamera2DFrameCollector().Collect(world, 640, 360)!;

        for (int i = 0; i < 100; i++)
        {
            CreateSprite(
                world,
                textureId,
                new Vec2((i % 10) - 5.0f, (i / 10) - 5.0f),
                sortingLayer: i % 3,
                depth: i * 0.01f);
        }

        world.UpdateTransforms();
        var collector = new SceneSpriteItemCollector();

        for (int i = 0; i < 10; i++)
        {
            _ = collector.Collect(world, frame, SceneRenderPassIds.Main);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            _ = collector.Collect(world, frame, SceneRenderPassIds.Main);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void AddRendering2D_RegistersComponents()
    {
        using SceneWorld world = CreateProfile2D().CreateWorld();

        world.Registry.TryGetDataByType(typeof(SceneCamera2D), out _).Should().BeTrue();
        world.Registry.TryGetDataByType(typeof(SceneSpriteRenderer), out _).Should().BeTrue();
    }

    private static SceneProfile CreateProfile2D() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/rendering-2d")))
            .AddTransform2D()
            .AddRendering2D()
            .Build();

    private static SceneActor CreateCamera2D(
        SceneWorld world,
        Vec2 position,
        float orthographicSize = 5.0f,
        bool primary = true)
    {
        SceneActor actor = world.CreateActor("Camera2D");
        world.GetTransform2D(actor).SetPosition(position);

        SceneCamera camera = SceneCamera.Default;
        camera.Primary = primary;
        camera.OrthographicSize = orthographicSize;
        world.AddData(actor, camera);
        world.AddData(actor, SceneCamera2D.Default);
        world.UpdateTransforms();
        return actor;
    }

    private static SceneActor CreateSprite(
        SceneWorld world,
        SceneAssetId<TextureAssetTag> textureId,
        Vec2 position,
        int sortingLayer = 0,
        float depth = 0.0f)
    {
        SceneActor actor = world.CreateActor("Sprite");
        world.GetTransform2D(actor).SetPosition(position);

        SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
        sprite.TextureId = textureId;
        sprite.SortingLayer = sortingLayer;
        sprite.Depth = depth;
        world.AddData(actor, sprite);
        return actor;
    }

    private static SceneAssetId<TextureAssetTag> TextureId() =>
        SceneAssetId<TextureAssetTag>.FromName("texture/sprite");
}
