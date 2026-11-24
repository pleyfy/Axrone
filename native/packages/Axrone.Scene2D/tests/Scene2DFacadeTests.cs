namespace Scene2DTests;

public class Scene2DFacadeTests
{
    [Fact]
    public void CameraEntityUsesOrthographicDefaults()
    {
        using Scene2D scene = Scene2D.Create();

        SceneEntity entity = scene.CreateCameraEntity(
            new SceneEntityConfig("Camera"),
            new Scene2DCameraConfig { Primary = true });

        SceneCamera defaults = SceneCamera2DDefaults.CreateCamera();
        scene.World.TryGetData(entity, out Scene2DCamera camera).Should().BeTrue();
        camera.Orthographic.Should().Be(defaults.Orthographic);
        camera.Enabled.Should().Be(defaults.Enabled);
        camera.Primary.Should().Be(defaults.Primary);
        camera.Near.Should().Be(defaults.Near);
        camera.Far.Should().Be(defaults.Far);
        camera.OrthographicSize.Should().Be(defaults.OrthographicSize);
        camera.ClearMask.Should().Be(Scene2DClearMask.Color | Scene2DClearMask.Depth);

        scene.World.TryGetData(entity, out Scene2DCamera2D camera2D).Should().BeTrue();
        camera2D.Depth.Should().Be(SceneCamera2DDefaults.Depth);
        scene.World.GetWorldPosition2D(entity).Should().Be(Vec2.Zero);
        scene.World.GetName(entity).Should().Be("Camera");
    }

    [Fact]
    public void PerspectiveCameraHonorsOverrides()
    {
        using Scene2D scene = Scene2D.Create();

        SceneEntity entity = scene.CreateCameraEntity(
            new SceneEntityConfig("Perspective"),
            new Scene2DCameraConfig
            {
                Orthographic = false,
                FieldOfViewDegrees = 45.0f,
                Near = 0.5f,
                Far = 200.0f,
                Depth = 7.0f
            });

        scene.World.TryGetData(entity, out Scene2DCamera camera).Should().BeTrue();
        camera.Orthographic.Should().BeFalse();
        camera.FieldOfViewDegrees.Should().Be(45.0f);
        camera.Near.Should().Be(0.5f);
        camera.Far.Should().Be(200.0f);
        scene.World.TryGetData(entity, out Scene2DCamera2D camera2D).Should().BeTrue();
        camera2D.Depth.Should().Be(7.0f);
    }

    [Fact]
    public void SpriteEntityCarriesConfiguredRenderer()
    {
        using Scene2D scene = Scene2D.Create();
        SceneStringId texture = SceneStringId.FromName("texture/hero");
        var config = new Scene2DSpriteConfig
        {
            TextureId = texture,
            Size = new Vec2(2.0f, 3.0f),
            Anchor = new Vec2(0.25f, 0.75f),
            Color = new Vec4(1.0f, 0.5f, 0.25f, 0.8f),
            SortingLayer = 2,
            RenderOrder = 7,
            FlipX = true
        };

        SceneEntity entity = scene.CreateSpriteEntity(new SceneEntityConfig("Hero", layer: 3), config);

        scene.World.TryGetData(entity, out Scene2DSpriteRenderer renderer).Should().BeTrue();
        renderer.TextureId.Should().Be(texture);
        renderer.Size.Should().Be(new Vec2(2.0f, 3.0f));
        renderer.Anchor.Should().Be(new Vec2(0.25f, 0.75f));
        renderer.Color.Should().Be(new Vec4(1.0f, 0.5f, 0.25f, 0.8f));
        renderer.SortingLayer.Should().Be(2);
        renderer.RenderOrder.Should().Be(7);
        renderer.FlipX.Should().BeTrue();
        renderer.PassId.Should().Be(SceneStringId.FromName("main"));
        scene.World.GetName(entity).Should().Be("Hero");
        scene.World.LayerOf(entity).Should().Be(3);
    }

    [Fact]
    public void AnimatedSpriteEntityCarriesRendererAndAnimator()
    {
        using Scene2D scene = Scene2D.Create();
        SceneStringId clip = SceneStringId.FromName("clip/idle");
        var sprite = new Scene2DSpriteConfig { TextureId = SceneStringId.FromName("texture/hero") };
        var animator = new Scene2DSpriteAnimatorConfig
        {
            ClipId = clip,
            Speed = 2.0f,
            Loop = false,
            Playing = true
        };

        SceneEntity entity = scene.CreateAnimatedSpriteEntity(
            new SceneEntityConfig("Animated"),
            sprite,
            animator);

        scene.World.HasData<Scene2DSpriteRenderer>(entity).Should().BeTrue();
        scene.World.TryGetData(entity, out Scene2DSpriteAnimator value).Should().BeTrue();
        value.ClipId.Should().Be(clip);
        value.Speed.Should().Be(2.0f);
        value.Loop.Should().BeFalse();
        value.Playing.Should().BeTrue();
    }

    [Fact]
    public void MaskEntityCarriesConfiguredMask()
    {
        using Scene2D scene = Scene2D.Create();
        var config = new Scene2DSpriteMaskConfig
        {
            Kind = Scene2DSpriteMaskKind.RoundedRect,
            Rect = new Vec4(0.1f, 0.2f, 0.5f, 0.6f),
            CornerRadius = 0.25f,
            Feather = 0.05f,
            Invert = true
        };

        SceneEntity entity = scene.CreateMaskEntity(new SceneEntityConfig("Mask"), config);

        scene.World.TryGetData(entity, out Scene2DSpriteMask mask).Should().BeTrue();
        mask.Kind.Should().Be(Scene2DSpriteMaskKind.RoundedRect);
        mask.Rect.Should().Be(new Vec4(0.1f, 0.2f, 0.5f, 0.6f));
        mask.CornerRadius.Should().Be(0.25f);
        mask.Feather.Should().Be(0.05f);
        mask.Invert.Should().BeTrue();
        mask.Enabled.Should().BeTrue();
    }

    [Fact]
    public void DisposeDisposesWorldAndBlocksCreation()
    {
        Scene2D scene = Scene2D.Create();
        scene.Dispose();

        scene.World.IsDisposed.Should().BeTrue();
        Action create = () => scene.CreateSpriteEntity(new SceneEntityConfig("Sprite"), new Scene2DSpriteConfig());
        create.Should().Throw<SceneDisposedException>();
        scene.Dispose();
    }

    [Fact]
    public void ProfileWithoutAnyPayloadFamilyIsRejectedAtCreation()
    {
        var runtime = SceneRuntimeProfiles.CreateCustom("test/core-2d", SceneProfiles.CreateCore2D());

        Action create = () => Scene2D.Create(new Scene2DCreateOptions { RuntimeProfile = runtime });

        create.Should().Throw<SceneCapabilityException>().Which.Capability.Should().Be("Scene2D");
    }

    [Fact]
    public void ProfileWithoutTransform2DIsRejected()
    {
        Action create = () => Scene2D.Create(new Scene2DCreateOptions { RuntimeProfile = SceneRuntimeProfiles.Core });

        create.Should().Throw<SceneCapabilityException>().Which.Capability.Should().Be("Transform2D");
    }

    [Fact]
    public void MalformedConfigsAreRejectedBeforeEntityAllocation()
    {
        using Scene2D scene = Scene2D.Create();

        Action camera = () => scene.CreateCameraEntity(
            new SceneEntityConfig("Camera"),
            new Scene2DCameraConfig { Near = 0.0f });
        camera.Should().Throw<SceneValidationException>();

        Action sprite = () => scene.CreateSpriteEntity(
            new SceneEntityConfig("Sprite"),
            new Scene2DSpriteConfig { Size = new Vec2(float.NaN, 1.0f) });
        sprite.Should().Throw<SceneValidationException>();

        Action mask = () => scene.CreateMaskEntity(
            new SceneEntityConfig("Mask"),
            new Scene2DSpriteMaskConfig { Rect = new Vec4(0.0f, 0.0f, 0.0f, 1.0f) });
        mask.Should().Throw<SceneValidationException>();

        Action animator = () => scene.CreateAnimatedSpriteEntity(
            new SceneEntityConfig("Animated"),
            new Scene2DSpriteConfig(),
            new Scene2DSpriteAnimatorConfig { Speed = -1.0f });
        animator.Should().Throw<SceneValidationException>();

        scene.EntityCount.Should().Be(0);
    }

    [Fact]
    public void ManifestListsBuiltInsInStableOrder()
    {
        Scene2DBuiltInManifest.Id.Should().Be("scene/2d");
        Scene2DBuiltInManifest.Count.Should().Be(5);

        Scene2DBuiltInComponent[] expected =
        [
            Scene2DBuiltInComponent.Camera,
            Scene2DBuiltInComponent.Camera2D,
            Scene2DBuiltInComponent.SpriteRenderer,
            Scene2DBuiltInComponent.SpriteAnimator,
            Scene2DBuiltInComponent.SpriteMask
        ];

        for (int i = 0; i < expected.Length; i++)
        {
            Scene2DBuiltInManifest.Components[i].Should().Be(expected[i]);
            Scene2DBuiltInManifest.Contains(expected[i]).Should().BeTrue();
            Scene2DBuiltInManifest.Contains((Scene2DBuiltInComponent)200).Should().BeFalse();
        }

        Scene2DComponentIds.ToName(Scene2DBuiltInComponent.Camera).Should().Be("Camera");
        Scene2DComponentIds.ToName(Scene2DBuiltInComponent.Camera2D).Should().Be("Camera2D");
        Scene2DComponentIds.ToName(Scene2DBuiltInComponent.SpriteRenderer).Should().Be("SpriteRenderer");
        Scene2DComponentIds.ToName(Scene2DBuiltInComponent.SpriteAnimator).Should().Be("SpriteAnimator");
        Scene2DComponentIds.ToName(Scene2DBuiltInComponent.SpriteMask).Should().Be("SpriteMask");
    }

    [Fact]
    public void ManifestRequireRejectsMissingPayloads()
    {
        using SceneWorld world = SceneProfiles.CreateCore2D().CreateWorld();

        Action require = () => Scene2DBuiltInManifest.Require(world, Scene2DBuiltInComponent.SpriteRenderer);
        require.Should().Throw<SceneCapabilityException>().Which.Capability.Should().Be("SpriteRenderer");
        Scene2DBuiltInManifest.IsRegistered(world, Scene2DBuiltInComponent.SpriteRenderer).Should().BeFalse();
    }
}
