namespace Scene2DTests;

public class Scene2DRendererBridgeTests
{
    [Fact]
    public void LeanProfileResolvesToStagingMode()
    {
        Scene2DRendererBridge.ResolveMode(Scene2DProfiles.LeanTwoDProfile.Profile)
            .Should()
            .Be(Scene2DComponentMode.LeanStaging);

        using Scene2D scene = Scene2D.Create();
        scene.Mode.Should().Be(Scene2DComponentMode.LeanStaging);
    }

    [Fact]
    public void TwoDProfileResolvesToRendererMode()
    {
        Scene2DRendererBridge.ResolveMode(SceneRuntimeProfiles.TwoD.Profile)
            .Should()
            .Be(Scene2DComponentMode.Renderer);

        using Scene2D scene = CreateRendererScene();
        scene.Mode.Should().Be(Scene2DComponentMode.Renderer);
    }

    [Fact]
    public void RendererCameraActorUsesRendererDefaults()
    {
        using Scene2D scene = CreateRendererScene();
        SceneActor actor = scene.CreateCameraActor(
            new SceneActorConfig("Camera"),
            new Scene2DCameraConfig());

        scene.World.TryGetData(actor, out SceneCamera camera).Should().BeTrue();
        SceneCamera expected = SceneCamera2DDefaults.CreateCamera();
        camera.Orthographic.Should().Be(expected.Orthographic);
        camera.Primary.Should().Be(expected.Primary);
        camera.Enabled.Should().Be(expected.Enabled);
        camera.Near.Should().Be(expected.Near);
        camera.Far.Should().Be(expected.Far);
        camera.OrthographicSize.Should().Be(expected.OrthographicSize);
        camera.ClearMask.Should().Be(expected.ClearMask);
        camera.ClearColor.Should().Be(expected.ClearColor);

        scene.World.TryGetData(actor, out SceneCamera2D camera2D).Should().BeTrue();
        camera2D.Depth.Should().Be(SceneCamera2DDefaults.Depth);
        scene.World.HasData<Scene2DCamera>(actor).Should().BeFalse();
        scene.World.HasData<Scene2DCamera2D>(actor).Should().BeFalse();
    }

    [Fact]
    public void RendererSpriteActorBridgesEveryField()
    {
        using Scene2D scene = CreateRendererScene();
        SceneStringId texture = SceneStringId.FromName("texture/hero");
        SceneStringId material = SceneStringId.FromName("material/hero");
        var config = new Scene2DSpriteConfig
        {
            TextureId = texture,
            MaterialId = material,
            Enabled = true,
            Visible = false,
            FlipX = true,
            FlipY = true,
            SortingLayer = 4,
            RenderOrder = 9,
            Size = new Vec2(2.0f, 3.0f),
            SourceSize = new Vec2(4.0f, 6.0f),
            Anchor = new Vec2(0.25f, 0.75f),
            Color = new Vec4(1.0f, 0.5f, 0.25f, 0.8f),
            UvRect = new Vec4(0.1f, 0.2f, 0.3f, 0.4f),
            Depth = 0.25f
        };

        SceneActor actor = scene.CreateSpriteActor(new SceneActorConfig("Hero"), config);

        scene.World.TryGetData(actor, out SceneSpriteRenderer renderer).Should().BeTrue();
        renderer.TextureId.Should().Be(SceneAssetId<TextureAssetTag>.FromSymbol(texture));
        renderer.MaterialId.Should().Be(SceneAssetId<MaterialAssetTag>.FromSymbol(material));
        renderer.PassId.Should().Be(SceneAssetId<RenderPassAssetTag>.FromSymbol(config.PassId));
        renderer.Enabled.Should().BeTrue();
        renderer.Visible.Should().BeFalse();
        renderer.FlipX.Should().BeTrue();
        renderer.FlipY.Should().BeTrue();
        renderer.SortingLayer.Should().Be(4);
        renderer.RenderOrder.Should().Be(9);
        renderer.Size.Should().Be(new Vec2(2.0f, 3.0f));
        renderer.SourceSize.Should().Be(new Vec2(4.0f, 6.0f));
        renderer.Anchor.Should().Be(new Vec2(0.25f, 0.75f));
        renderer.Color.Should().Be(new Vec4(1.0f, 0.5f, 0.25f, 0.8f));
        renderer.UvRect.Should().Be(new Vec4(0.1f, 0.2f, 0.3f, 0.4f));
        renderer.Depth.Should().Be(0.25f);
        scene.World.HasData<Scene2DSpriteRenderer>(actor).Should().BeFalse();
    }

    [Fact]
    public void RendererAnimatorAppliesClipAndStagedFrame()
    {
        using Scene2D scene = CreateRendererScene();
        var clip = new SceneSpriteAnimationClip(
            "idle",
            [
                new SceneSpriteAnimationFrame(new Vec4(0.0f, 0.0f, 0.5f, 1.0f), 0.1f),
                new SceneSpriteAnimationFrame(new Vec4(0.5f, 0.0f, 0.5f, 1.0f), 0.1f)
            ]);
        var animatorConfig = new Scene2DSpriteAnimatorConfig
        {
            Clip = clip,
            ClipId = SceneStringId.FromName("clip/idle"),
            FrameIndex = 1,
            ElapsedSeconds = 0.01f,
            Speed = 2.0f,
            Playing = false,
            Loop = false
        };

        SceneActor actor = scene.CreateAnimatedSpriteActor(
            new SceneActorConfig("Animated"),
            new Scene2DSpriteConfig(),
            animatorConfig);

        SceneSpriteAnimatorBehaviour? animator = scene.World.GetBehaviour<SceneSpriteAnimatorBehaviour>(actor);
        animator.Should().NotBeNull();
        animator!.Clip.Should().BeSameAs(clip);
        animator.FrameIndex.Should().Be(1);
        animator.ElapsedSeconds.Should().BeApproximately(0.01f, 1e-4f);
        animator.Playing.Should().BeFalse();
        animator.Speed.Should().Be(2.0f);
        animator.Loop.Should().BeFalse();

        scene.World.TryGetData(actor, out SceneSpriteRenderer renderer).Should().BeTrue();
        renderer.UvRect.Should().Be(clip.Frames[1].UvRect);
        scene.World.HasData<Scene2DSpriteAnimator>(actor).Should().BeFalse();
    }

    [Fact]
    public void RendererMaskResolvesThroughHierarchy()
    {
        using Scene2D scene = CreateRendererScene();
        var maskConfig = new Scene2DSpriteMaskConfig
        {
            Kind = Scene2DSpriteMaskKind.Ellipse,
            Rect = new Vec4(0.2f, 0.1f, 0.6f, 0.8f),
            Feather = 0.05f,
            CornerRadius = 0.2f,
            Invert = true
        };
        SceneActor maskActor = scene.CreateMaskActor(new SceneActorConfig("Mask"), maskConfig);
        SceneActor spriteActor = scene.CreateSpriteActor(new SceneActorConfig("Sprite"), new Scene2DSpriteConfig());
        scene.World.Hierarchy.SetParent(spriteActor, maskActor);

        SceneSpriteMaskResolver.TryResolve(scene.World, spriteActor, out SceneSpriteMask resolved).Should().BeTrue();
        resolved.Kind.Should().Be(SceneSpriteMaskKind.Ellipse);
        resolved.Rect.Should().Be(new Vec4(0.2f, 0.1f, 0.6f, 0.8f));
        resolved.Feather.Should().Be(0.05f);
        resolved.CornerRadius.Should().Be(0.2f);
        resolved.Invert.Should().BeTrue();
        scene.World.HasData<Scene2DSpriteMask>(maskActor).Should().BeFalse();
    }

    [Fact]
    public void BridgeConversionsAreZeroAllocation()
    {
        var cameraConfig = new Scene2DCameraConfig();
        Scene2DCamera camera = cameraConfig.ToComponent();
        Scene2DCamera2D camera2D = cameraConfig.ToDepthComponent();
        Scene2DSpriteRenderer sprite = new Scene2DSpriteConfig
        {
            TextureId = SceneStringId.FromName("texture/warm"),
            Color = new Vec4(1.0f, 0.5f, 0.25f, 1.0f)
        }.ToComponent();
        Scene2DSpriteMask mask = new Scene2DSpriteMaskConfig().ToComponent();

        _ = Scene2DRendererBridge.ToSceneCamera(in camera);
        _ = Scene2DRendererBridge.ToSceneCamera2D(in camera2D);
        _ = Scene2DRendererBridge.ToSceneSpriteRenderer(in sprite);
        _ = Scene2DRendererBridge.ToSceneSpriteMask(in mask);

        long before = GC.GetAllocatedBytesForCurrentThread();
        float checksum = 0.0f;
        for (int i = 0; i < 256; i++)
        {
            SceneCamera convertedCamera = Scene2DRendererBridge.ToSceneCamera(in camera);
            SceneCamera2D convertedCamera2D = Scene2DRendererBridge.ToSceneCamera2D(in camera2D);
            SceneSpriteRenderer convertedSprite = Scene2DRendererBridge.ToSceneSpriteRenderer(in sprite);
            SceneSpriteMask convertedMask = Scene2DRendererBridge.ToSceneSpriteMask(in mask);
            checksum += convertedCamera.Near + convertedCamera2D.Depth;
            checksum += convertedSprite.Size.X + convertedMask.Rect.Z;
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        checksum.Should().BeGreaterThan(0.0f);
        delta.Should().Be(0);
    }

    [Fact]
    public void RendererBulkMatchesIndividualCreationState()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(8);
        using Scene2D bulkScene = CreateRendererScene();
        using Scene2D singleScene = CreateRendererScene();

        var bulkActors = new SceneActor[specs.Length];
        bulkScene.CreateSprites(specs, bulkActors).Should().Be(specs.Length);

        var singleActors = new SceneActor[specs.Length];
        for (int i = 0; i < specs.Length; i++)
        {
            SceneActorConfig actorConfig = specs[i].ActorConfig;
            Scene2DSpriteConfig spriteConfig = specs[i].Sprite;
            SceneActor actor = singleScene.CreateSpriteActor(in actorConfig, in spriteConfig);
            Vec2 position = specs[i].Position;
            singleScene.World.GetTransform2D(actor).SetPosition(in position);
            singleActors[i] = actor;
        }

        singleScene.World.UpdateTransforms();
        bulkScene.ActorCount.Should().Be(singleScene.ActorCount);
        bulkScene.Capacity.Should().Be(singleScene.Capacity);

        for (int i = 0; i < specs.Length; i++)
        {
            bulkActors[i].Should().Be(singleActors[i]);
            bulkScene.World.GetWorldPosition2D(bulkActors[i])
                .Should()
                .Be(singleScene.World.GetWorldPosition2D(singleActors[i]));
            bulkScene.World.TryGetData(bulkActors[i], out SceneSpriteRenderer bulkRenderer).Should().BeTrue();
            singleScene.World.TryGetData(singleActors[i], out SceneSpriteRenderer singleRenderer).Should().BeTrue();
            bulkRenderer.TextureId.Should().Be(singleRenderer.TextureId);
            bulkRenderer.PassId.Should().Be(singleRenderer.PassId);
            bulkRenderer.Size.Should().Be(singleRenderer.Size);
            bulkRenderer.SourceSize.Should().Be(singleRenderer.SourceSize);
            bulkRenderer.Anchor.Should().Be(singleRenderer.Anchor);
            bulkRenderer.Color.Should().Be(singleRenderer.Color);
            bulkRenderer.UvRect.Should().Be(singleRenderer.UvRect);
            bulkRenderer.SortingLayer.Should().Be(singleRenderer.SortingLayer);
            bulkRenderer.RenderOrder.Should().Be(singleRenderer.RenderOrder);
            bulkRenderer.Depth.Should().Be(singleRenderer.Depth);
        }
    }

    [Fact]
    public void RendererBulkWarmAllocationIsZero()
    {
        using Scene2D scene = CreateRendererScene(new SceneWorldOptions(32));
        Scene2DSpriteSpec[] specs = CreateSpecs(16);
        var actors = new SceneActor[specs.Length];

        scene.CreateSprites(specs, actors);
        scene.World.DestroyAllActors();
        scene.CreateSprites(specs, actors);
        scene.World.DestroyAllActors();

        long before = GC.GetAllocatedBytesForCurrentThread();
        int created = scene.CreateSprites(specs, actors);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        created.Should().Be(specs.Length);
        delta.Should().Be(0);
    }

    [Fact]
    public void LeanProfileRejectsManagedClipsBeforeActorAllocation()
    {
        using Scene2D scene = Scene2D.Create();
        var clip = new SceneSpriteAnimationClip(
            "idle",
            [new SceneSpriteAnimationFrame(new Vec4(0.0f, 0.0f, 1.0f, 1.0f), 0.1f)]);

        Action create = () => scene.CreateAnimatedSpriteActor(
            new SceneActorConfig("Animated"),
            new Scene2DSpriteConfig(),
            new Scene2DSpriteAnimatorConfig { Clip = clip });

        create.Should().Throw<SceneCapabilityException>().Which.Capability.Should().Be("SpriteAnimatorClip");
        scene.ActorCount.Should().Be(0);
    }

    [Fact]
    public void RendererAnimatorProgressRequiresClip()
    {
        using Scene2D scene = CreateRendererScene();

        Action create = () => scene.CreateAnimatedSpriteActor(
            new SceneActorConfig("Animated"),
            new Scene2DSpriteConfig(),
            new Scene2DSpriteAnimatorConfig { FrameIndex = 1 });

        create.Should().Throw<SceneValidationException>();
        scene.ActorCount.Should().Be(0);
    }

    [Fact]
    public void RendererAnimatorClipIdWithoutClipIsRejected()
    {
        using Scene2D scene = CreateRendererScene();

        Action create = () => scene.CreateAnimatedSpriteActor(
            new SceneActorConfig("Animated"),
            new Scene2DSpriteConfig(),
            new Scene2DSpriteAnimatorConfig { ClipId = SceneStringId.FromName("clip/idle") });

        create.Should().Throw<SceneValidationException>();
        scene.ActorCount.Should().Be(0);
    }

    [Fact]
    public void PartialRendererProfileIsRejectedAtCreation()
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/partial-renderer")));
        SceneProfile profile = builder
            .AddTransform2D()
            .AddRendering2D()
            .Build();
        var runtime = SceneRuntimeProfiles.CreateCustom("test/partial-renderer", profile);

        Action create = () => Scene2D.Create(new Scene2DCreateOptions { RuntimeProfile = runtime });

        create.Should().Throw<SceneCapabilityException>().Which.Capability.Should().Be("Scene2D");
    }

    [Fact]
    public void MixedPayloadOwnersAreRejectedAtCreation()
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/mixed-owner")));
        SceneProfile profile = builder
            .AddTransform2D()
            .AddData<Scene2DSpriteRenderer>("StageSprite")
            .AddRendering2D()
            .AddSceneRenderables(SceneRenderableFeatures.SpriteMask)
            .Build();
        var runtime = SceneRuntimeProfiles.CreateCustom("test/mixed-owner", profile);

        Action create = () => Scene2D.Create(new Scene2DCreateOptions { RuntimeProfile = runtime });

        create.Should().Throw<SceneConfigurationException>();
    }

    [Fact]
    public void StagingAndRendererNamesCannotBeRegisteredTogether()
    {
        var builder = new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/duplicate-names")));

        Action build = () => builder
            .AddTransform2D()
            .AddScene2D()
            .AddRendering2D()
            .Build();

        build.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void RendererFacadeDisposeBlocksReuse()
    {
        Scene2D scene = CreateRendererScene();
        _ = scene.CreateSpriteActor(new SceneActorConfig("Sprite"), new Scene2DSpriteConfig());
        scene.Dispose();

        scene.World.IsDisposed.Should().BeTrue();
        Action create = () => scene.CreateSpriteActor(new SceneActorConfig("Sprite"), new Scene2DSpriteConfig());
        create.Should().Throw<SceneDisposedException>();
        scene.Dispose();
    }

    private static Scene2D CreateRendererScene(SceneWorldOptions? worldOptions = null) =>
        Scene2D.Create(new Scene2DCreateOptions
        {
            RuntimeProfile = SceneRuntimeProfiles.TwoD,
            WorldOptions = worldOptions ?? new SceneWorldOptions()
        });

    private static Scene2DSpriteSpec[] CreateSpecs(int count)
    {
        var specs = new Scene2DSpriteSpec[count];
        for (int i = 0; i < count; i++)
        {
            specs[i] = new Scene2DSpriteSpec
            {
                ActorConfig = new SceneActorConfig("Sprite"),
                Sprite = new Scene2DSpriteConfig
                {
                    TextureId = SceneStringId.FromName("texture/hero"),
                    Size = new Vec2(1.0f + i, 2.0f),
                    SourceSize = new Vec2(8.0f, 8.0f),
                    Anchor = new Vec2(0.25f, 0.75f),
                    Color = new Vec4(1.0f, 0.5f, 0.25f, 1.0f),
                    UvRect = new Vec4(0.0f, 0.0f, 0.5f, 1.0f),
                    SortingLayer = i % 3,
                    RenderOrder = i,
                    Depth = i * 0.01f
                },
                Position = new Vec2(i, i * 0.5f)
            };
        }

        return specs;
    }
}
