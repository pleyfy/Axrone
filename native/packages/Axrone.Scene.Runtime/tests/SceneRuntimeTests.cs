namespace Axrone.Scene.Runtime.Tests;

using System.Text.Json;
using Axrone.GameLoop;
using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Prefab;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using Axrone.Scene.Snapshot;
using FluentAssertions;
using Xunit;

public sealed class SceneRuntimeTests
{
    [Fact]
    public void Runtime_ComposesWorldAssetsAndCodecs()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });

        runtime.World.Should().NotBeNull();
        runtime.Codecs.TryGet("Transform3D", out _).Should().BeTrue();
        runtime.Codecs.TryGet("Camera", out _).Should().BeTrue();
        runtime.Codecs.TryGet("MeshRenderer", out _).Should().BeTrue();
        runtime.Codecs.TryGet("DirectionalLight", out _).Should().BeTrue();
        runtime.Frame.ViewportWidth.Should().Be(1280);
        runtime.Frame.ViewportHeight.Should().Be(720);
    }

    [Fact]
    public void Runtime_VerifiesViewport()
    {
        Action act = () => _ = new SceneRuntime(new SceneRuntimeOptions
        {
            Profile = CreateProfile(),
            ViewportWidth = 0
        });

        act.Should().Throw<SceneConfigurationException>();
    }

    [Fact]
    public void Runtime_LoadSnapshotInstantiatesPrefabAndAssets()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        SceneSnapshot snapshot = CreateSnapshot(out _);

        ScenePrefabInstantiationResult result = runtime.LoadSnapshot(snapshot);

        result.Entities.Should().HaveCount(2);
        runtime.World.EntityCount.Should().Be(2);
        runtime.Assets.Shaders.Count.Should().Be(1);
        runtime.Assets.Materials.Count.Should().Be(1);
        runtime.Assets.RenderPasses.Count.Should().Be(1);
        runtime.Frame.Passes.Count.Should().Be(1);
    }

    [Fact]
    public void Runtime_ResolvesVariantAndInstantiatesIt()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        ScenePrefabDefinition basePrefab = CreatePrefab("prefab/base");
        runtime.RegisterPrefab(basePrefab);
        runtime.RegisterPrefab(ScenePrefabVariants.CreateVariant(
            "prefab/base",
            "prefab/variant",
            [
                new ScenePrefabSetEntityFieldOperation(
                    "root",
                    ScenePrefabEntityField.Name,
                    ScenePrefabEntityFieldValue.FromString("VariantRoot"))
            ]));

        ScenePrefabDefinition resolved = runtime.ResolvePrefab("prefab/variant");
        ScenePrefabInstantiationResult result = runtime.Instantiate(resolved);

        resolved.Kind.Should().Be(ScenePrefabKind.Resolved);
        result.Entities.Should().HaveCount(2);
        runtime.World.GetName(result.Entities[0]).Should().Be("VariantRoot");
    }

    [Fact]
    public void Pipeline_PlansCameraLightingAndItems()
    {
        using var runtime = CreateRenderableRuntime(out SceneEntity camera, out _);
        _ = camera;

        bool planned = runtime.Frame.Plan(3);

        planned.Should().BeTrue();
        runtime.Frame.Camera.Should().NotBeNull();
        runtime.Frame.Lighting.Should().NotBeNull();
        runtime.Frame.CollectItems(SceneRenderPassIds.Main).Should().Be(1);

        SceneRenderStats stats = runtime.Frame.Complete(1);
        stats.Frame.Should().Be(3);
        stats.PassCount.Should().Be(1);
        stats.OpaqueCount.Should().Be(1);
        stats.TransparentCount.Should().Be(0);
    }

    [Fact]
    public void Pipeline_SteadyStatePlanningDoesNotAllocate()
    {
        using var runtime = CreateRenderableRuntime(out _, out _);

        for (int i = 0; i < 10; i++)
        {
            _ = runtime.Frame.Plan(i);
            _ = runtime.Frame.CollectItems(SceneRenderPassIds.Main);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++)
        {
            _ = runtime.Frame.Plan(i);
            _ = runtime.Frame.CollectItems(SceneRenderPassIds.Main);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void Pipeline_SteadyStatePlanningDoesNotAllocateWithManyRenderers()
    {
        using var runtime = CreateRenderableRuntime(out _, out SceneEntity firstRenderer);
        SceneWorld world = runtime.World;
        SceneMeshRenderer template = world.GetData<SceneMeshRenderer>(firstRenderer);

        for (int i = 1; i < 1000; i++)
        {
            SceneEntity entity = world.CreateEntity("Renderer");
            world.GetTransform3D(entity).SetPosition(new Vec3(i % 32, i / 32, 0.0f));
            world.AddData(entity, template);
        }

        world.UpdateTransforms();

        for (int i = 0; i < 10; i++)
        {
            _ = runtime.Frame.Plan(i);
            _ = runtime.Frame.CollectItems(SceneRenderPassIds.Main);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            _ = runtime.Frame.Plan(i);
            _ = runtime.Frame.CollectItems(SceneRenderPassIds.Main);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void Pipeline_Plans2DScene()
    {
        using var runtime = Create2DRuntime(out SceneAssetRegistry assets);
        SceneAssetId<TextureAssetTag> textureId = assets.CreateId<TextureAssetTag>("texture/sprite");
        SceneWorld world = runtime.World;

        for (int i = 0; i < 3; i++)
        {
            SceneEntity spriteEntity = world.CreateEntity("Sprite");
            world.GetTransform2D(spriteEntity).SetPosition(new Vec2(i - 1.0f, 0.0f));
            SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
            sprite.TextureId = textureId;
            sprite.SortingLayer = i;
            world.AddData(spriteEntity, sprite);
        }

        world.UpdateTransforms();

        runtime.Frame.Plan(0).Should().BeTrue();
        runtime.Frame.Camera!.Position.Should().Be(new Vec3(0.0f, 0.0f, -10.0f));
        runtime.Frame.CollectSprites(SceneRenderPassIds.Main).Should().Be(3);
        runtime.Frame.Complete(1).SpriteCount.Should().Be(3);
    }

    [Fact]
    public void Pipeline_ReportsRenderModes()
    {
        using (var runtime = CreateRenderableRuntime(out _, out _))
        {
            runtime.Frame.Plan(0).Should().BeTrue();
            runtime.Frame.Mode.Should().Be(SceneRenderMode.ThreeD);
        }

        using (var runtime2D = Create2DRuntime(out _))
        {
            runtime2D.Frame.Plan(0).Should().BeTrue();
            runtime2D.Frame.Mode.Should().Be(SceneRenderMode.TwoD);
        }

        using (var mixed = CreateMixedRuntime())
        {
            mixed.Frame.Plan(0).Should().BeTrue();
            mixed.Frame.Mode.Should().Be(SceneRenderMode.Mixed);
        }

        using (var empty = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() }))
        {
            empty.Frame.Plan(0).Should().BeFalse();
            empty.Frame.Mode.Should().Be(SceneRenderMode.None);
        }
    }

    [Fact]
    public void Loop_RecordsProfilerFrames()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions
        {
            Profile = CreateProfile(),
            Profiler = new SceneRuntimeProfilerOptions
            {
                Enabled = true,
                Capacity = 8,
                MemorySampleIntervalMs = 1e9
            }
        });
        using var loop = new SceneRuntimeLoop(runtime);

        loop.Start(GameTime.FromMilliseconds(0.0));
        _ = loop.Tick(GameTime.FromMilliseconds(16.67));

        runtime.Profiler.Count.Should().Be(1);
        SceneRuntimeFrameRecord record = runtime.Profiler.LastRecord!.Value;
        record.Frame.Should().Be(1);
        record.FixedSteps.Should().Be(1);
        record.HasRenderStats.Should().BeTrue();
        record.RenderStats.PassCount.Should().Be(0);
        loop.State.Mode.Should().Be(SceneRenderMode.None);
    }

    [Fact]
    public void Pipeline_RecordsCulledSprites()
    {
        using var runtime = Create2DRuntime(out SceneAssetRegistry assets);
        SceneAssetId<TextureAssetTag> textureId = assets.CreateId<TextureAssetTag>("texture/sprite");
        SceneWorld world = runtime.World;

        SceneEntity visible = world.CreateEntity("Visible");
        world.GetTransform2D(visible).SetPosition(Vec2.Zero);
        SceneSpriteRenderer visibleSprite = SceneSpriteRenderer.Default;
        visibleSprite.TextureId = textureId;
        world.AddData(visible, visibleSprite);

        SceneEntity culled = world.CreateEntity("Culled");
        world.GetTransform2D(culled).SetPosition(new Vec2(100.0f, 0.0f));
        SceneSpriteRenderer culledSprite = SceneSpriteRenderer.Default;
        culledSprite.TextureId = textureId;
        world.AddData(culled, culledSprite);

        world.UpdateTransforms();

        runtime.Frame.Plan(0).Should().BeTrue();
        runtime.Frame.CollectSprites(SceneRenderPassIds.Main).Should().Be(1);
        runtime.Frame.Complete(1).CulledCount.Should().Be(1);
    }

    [Fact]
    public void Pipeline_ResolvesFogState()
    {
        using var runtime = CreateRenderableRuntime(out _, out _);
        SceneEntity fogEntity = runtime.World.CreateEntity("Fog");
        SceneFog fog = SceneFog.Default;
        fog.Enabled = true;
        fog.Mode = SceneFogMode.Exponential;
        fog.Density = 0.5f;
        runtime.World.AddData(fogEntity, fog);

        _ = runtime.Frame.Plan(0);

        runtime.Frame.Fog.Enabled.Should().BeTrue();
        runtime.Frame.Fog.Mode.Should().Be(SceneFogMode.Exponential);
        runtime.Frame.Fog.Density.Should().BeApproximately(0.5f, 1e-6f);
    }

    [Fact]
    public void Pipeline_ReturnsFalseWithoutCamera()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        _ = runtime.World.CreateEntity("NoCamera");

        runtime.Frame.Plan(0).Should().BeFalse();
        runtime.Frame.Camera.Should().BeNull();
        runtime.Frame.Complete(0).DrawCalls.Should().Be(0);
    }

    [Fact]
    public void Pipeline_RejectsItemsBeforePlanning()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });

        Action act = () => runtime.Frame.CollectItems(SceneRenderPassIds.Main);

        act.Should().Throw<SceneLifecycleException>();
    }

    [Fact]
    public void GlRenderer_RendersPlannedPasses()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var runtime = CreateRenderableRuntime(out _, out _);
        using var renderer = new SceneGlFrameRenderer(context, runtime);

        renderer.UploadAssets();
        SceneRenderStats stats = renderer.Render(0);

        stats.DrawCalls.Should().Be(1);
        stats.OpaqueCount.Should().Be(1);
        stats.PassCount.Should().Be(1);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements", StringComparison.Ordinal));
    }

    [Fact]
    public void GlRenderer_ReservesShadowAtlasOnlyWhenShadowsEnabled()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var runtime = CreateRenderableRuntime(out _, out _);
        using var renderer = new SceneGlFrameRenderer(context, runtime);
        renderer.UploadAssets();
        api.ClearCallLog();

        runtime.Frame.ShadowSettings.Enabled.Should().BeTrue();
        _ = renderer.Render(0);

        api.CallLog.Should().Contain(
            call => call.StartsWith("CheckFramebufferStatus", StringComparison.Ordinal),
            "the default ShadowSettings must reserve and validate a depth atlas");
    }

    [Fact]
    public void GlRenderer_ReservesNoShadowAtlasWhenShadowsDisabled()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var runtime = CreateRenderableRuntime(out _, out _);
        using var renderer = new SceneGlFrameRenderer(context, runtime);
        renderer.UploadAssets();
        runtime.Frame.ShadowSettings = Axrone.Lighting.ShadowSettings.Disabled;
        api.ClearCallLog();

        SceneRenderStats stats = renderer.Render(0);

        stats.DrawCalls.Should().Be(1);
        api.CallLog.Should().NotContain(
            call => call.StartsWith("CheckFramebufferStatus", StringComparison.Ordinal),
            "a scene that opts out of shadows must not pay for a depth atlas");
    }

    [Fact]
    public void GlRenderer_ShadowPassDoesNotInflateFrameStatistics()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        using var runtime = CreateRenderableRuntime(out _, out _);
        using var renderer = new SceneGlFrameRenderer(context, runtime);
        renderer.UploadAssets();

        SceneRenderStats withShadows = renderer.Render(0);
        withShadows.OpaqueCount.Should().Be(1, "the shadow caster gather must not re-record queues");
        withShadows.DrawCalls.Should().Be(1, "depth draws are not scene draw calls");

        runtime.Frame.ShadowSettings = Axrone.Lighting.ShadowSettings.Disabled;
        SceneRenderStats withoutShadows = renderer.Render(1);
        withoutShadows.OpaqueCount.Should().Be(withShadows.OpaqueCount);
        withoutShadows.DrawCalls.Should().Be(withShadows.DrawCalls);
    }

    [Fact]
    public void GlRenderer_Renders2DSprites()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var runtime = Create2DRuntime(out SceneAssetRegistry assets);

        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("main");
        assets.RenderPasses.Register(new SceneRenderPassDefinition(
            passId,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.05f, 0.06f, 0.08f, 1.0f),
            depthTest: false,
            blend: true));
        runtime.Frame.RebuildPasses();

        SceneAssetId<TextureAssetTag> textureId = assets.CreateId<TextureAssetTag>("texture/sprite");
        assets.Textures.Register(new SceneTextureDefinition(
            textureId,
            new SceneTextureColor(Vec4.One, 4, 4)));

        for (int i = 0; i < 2; i++)
        {
            SceneEntity spriteEntity = runtime.World.CreateEntity("Sprite");
            runtime.World.GetTransform2D(spriteEntity).SetPosition(new Vec2(i - 0.5f, 0.0f));
            SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;
            sprite.TextureId = textureId;
            runtime.World.AddData(spriteEntity, sprite);
        }

        runtime.World.UpdateTransforms();

        using var renderer = new SceneGlFrameRenderer(context, runtime);
        renderer.UploadAssets();
        SceneRenderStats stats = renderer.Render(0);

        stats.SpriteCount.Should().Be(2);
        stats.DrawCalls.Should().Be(1);
        stats.TrianglesSubmitted.Should().Be(4);
        api.CallLog.Should().Contain(call => call.StartsWith("DrawElements", StringComparison.Ordinal));
    }

    [Fact]
    public void Loop_StartsAndStopsWorldLifecycle()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        using var loop = new SceneRuntimeLoop(runtime);

        runtime.World.IsStarted.Should().BeFalse();

        loop.Start(GameTime.FromMilliseconds(0.0));
        runtime.World.IsStarted.Should().BeTrue();

        loop.Stop();
        runtime.World.IsStarted.Should().BeFalse();
    }

    [Fact]
    public void Loop_DispatchesBehavioursAfterStart()
    {
        SceneProfile profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/loop-behaviour")))
            .AddTransform3D()
            .AddBehaviour<CountingBehaviour>("Counting")
            .Build();

        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = profile });
        SceneEntity entity = runtime.World.CreateEntity("Entity");
        CountingBehaviour behaviour = runtime.World.AddBehaviour<CountingBehaviour>(entity);
        using var loop = new SceneRuntimeLoop(runtime);

        _ = loop.Tick(GameTime.FromMilliseconds(16.67));
        behaviour.UpdateCount.Should().Be(0);

        loop.Start(GameTime.FromMilliseconds(0.0));
        _ = loop.Tick(GameTime.FromMilliseconds(16.67));

        behaviour.UpdateCount.Should().Be(1);
        behaviour.FixedUpdateCount.Should().BeGreaterThanOrEqualTo(1);
    }

    [Fact]
    public void Loop_StopThenStart_RerunsStartAndOnEnable()
    {
        SceneProfile profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/loop-restart")))
            .AddTransform3D()
            .AddBehaviour<CountingBehaviour>("Counting")
            .Build();

        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = profile });
        SceneEntity entity = runtime.World.CreateEntity("Entity");
        CountingBehaviour behaviour = runtime.World.AddBehaviour<CountingBehaviour>(entity);
        using var loop = new SceneRuntimeLoop(runtime);

        loop.Start(GameTime.FromMilliseconds(0.0));
        behaviour.StartCount.Should().Be(1);
        behaviour.EnableCount.Should().Be(1);
        loop.Stop();

        loop.Start(GameTime.FromMilliseconds(16.67));
        behaviour.StartCount.Should().Be(2);
        behaviour.EnableCount.Should().Be(2);

        _ = loop.Tick(GameTime.FromMilliseconds(33.34));
        behaviour.UpdateCount.Should().Be(1);
    }

    [Fact]
    public void Loop_DisposeStopsWorld()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        var loop = new SceneRuntimeLoop(runtime);
        loop.Start(GameTime.FromMilliseconds(0.0));
        runtime.World.IsStarted.Should().BeTrue();

        loop.Dispose();

        runtime.World.IsStarted.Should().BeFalse();
    }

    [Fact]
    public void Loop_StartIsIdempotent()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        using var loop = new SceneRuntimeLoop(runtime);

        loop.Start(GameTime.FromMilliseconds(0.0));
        loop.Start(GameTime.FromMilliseconds(1.0));

        loop.Status.Should().Be(GameLoopStatus.Running);
        runtime.World.IsStarted.Should().BeTrue();
    }

    [Fact]
    public void Instantiate_ResolvesRegisteredVariant()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        ScenePrefabDefinition basePrefab = CreatePrefab("prefab/base");
        runtime.RegisterPrefab(basePrefab);

        ScenePrefabDefinition variant = ScenePrefabVariants.CreateVariant(
            "prefab/base",
            "prefab/variant",
            [
                new ScenePrefabSetEntityFieldOperation(
                    "root",
                    ScenePrefabEntityField.Name,
                    ScenePrefabEntityFieldValue.FromString("VariantRoot"))
            ]);
        runtime.RegisterPrefab(variant);

        ScenePrefabInstantiationResult result = runtime.Instantiate(variant);

        result.Entities.Should().HaveCount(2);
        runtime.World.GetName(result.NodeMap["root"]).Should().Be("VariantRoot");
    }

    [Fact]
    public void LoadSnapshot_AppliesLiveOverrides()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        SceneSnapshot snapshot = CreateSnapshot(out _);

        ScenePrefabInstantiationResult result = runtime.LoadSnapshot(
            snapshot,
            new SceneSnapshotLoadOptions
            {
                LiveOverrides =
                [
                    new ScenePrefabSetEntityFieldOperation(
                        "root",
                        ScenePrefabEntityField.Tag,
                        ScenePrefabEntityFieldValue.FromString("Live"))
                ]
            });

        result.Entities.Should().HaveCount(2);
        runtime.World.GetTag(result.NodeMap["root"]).Should().Be("Live");
    }

    [Fact]
    public void LoadSnapshot_ResolvesRegisteredVariantPrefab()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        ScenePrefabDefinition basePrefab = CreatePrefab("prefab/base");
        runtime.RegisterPrefab(basePrefab);
        ScenePrefabDefinition variant = ScenePrefabVariants.CreateVariant("prefab/base", "prefab/variant");
        runtime.RegisterPrefab(variant);

        var snapshot = new SceneSnapshot(variant, [], [], [], [], [], []);
        ScenePrefabInstantiationResult result = runtime.LoadSnapshot(snapshot);

        result.Entities.Should().HaveCount(2);
    }

    [Fact]
    public void CaptureSnapshot_RoundTripsIntoAnotherRuntime()
    {
        using var source = CreateRenderableRuntime(out _, out _);
        SceneSnapshot snapshot = source.CaptureSnapshot("prefab/captured");

        using var target = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        ScenePrefabInstantiationResult result = target.LoadSnapshot(snapshot);

        result.Entities.Should().HaveCount(3);
        target.Assets.Shaders.Count.Should().Be(1);
        target.Assets.Meshes.Count.Should().Be(1);
        target.Assets.Materials.Count.Should().Be(1);
        target.Frame.Passes.Count.Should().Be(1);
        target.Frame.Plan(0).Should().BeTrue();
        target.Frame.CollectItems(SceneRenderPassIds.Main).Should().Be(1);
    }

    [Fact]
    public void CaptureSnapshot_RoundTripsRuntimeComponents()
    {
        using var source = new SceneRuntime(new SceneRuntimeOptions
        {
            Profile = CreateRuntimeComponentProfile()
        });

        SceneEntity entity = source.World.CreateEntity("Body");
        source.World.GetTransform3D(entity).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));

        SceneRigidbody3D body = SceneRigidbody3D.Default;
        body.BodyType = SceneBodyType.Kinematic;
        body.LinearVelocity = new Vec3(4.0f, 5.0f, 6.0f);
        body.GravityScale = 0.25f;
        body.Mass = 2.5f;
        source.World.AddData(entity, body);

        SceneCollider3D collider = SceneCollider3D.Box(1.0f, 2.0f, 3.0f, density: 5.0f);
        collider.Friction = 0.75f;
        source.World.AddData(entity, collider);

        SceneParticleSystem particles = SceneParticleSystem.Default;
        particles.EmissionRate = 42.0f;
        particles.StartColor = new Vec4(0.1f, 0.2f, 0.3f, 0.4f);
        particles.MaxParticles = 64;
        source.World.AddData(entity, particles);
        source.World.UpdateTransforms();

        SceneSnapshot snapshot = source.CaptureSnapshot("prefab/runtime-components");

        using var target = new SceneRuntime(new SceneRuntimeOptions
        {
            Profile = CreateRuntimeComponentProfile()
        });
        ScenePrefabInstantiationResult result = target.LoadSnapshot(snapshot);

        result.Entities.Should().ContainSingle();
        SceneEntity loaded = result.Entities[0];
        target.World.GetData<SceneRigidbody3D>(loaded).Should().Be(body);
        target.World.GetData<SceneCollider3D>(loaded).Should().Be(collider);
        target.World.GetData<SceneParticleSystem>(loaded).Should().Be(particles);
    }

    [Fact]
    public void CaptureSnapshot_RoundTrips2DComponents()
    {
        using var source = new SceneRuntime(new SceneRuntimeOptions
        {
            RuntimeProfile = SceneRuntimeProfiles.TwoD
        });

        SceneEntity entity = source.World.CreateEntity("Body2D");
        source.World.GetTransform2D(entity).SetPosition(new Vec2(1.0f, 2.0f));

        SceneRigidbody2D body = SceneRigidbody2D.Default;
        body.Mass = 2.0f;
        body.AngularVelocity = 1.5f;
        source.World.AddData(entity, body);

        SceneCollider2D collider = SceneCollider2D.Box(1.0f, 2.0f, density: 3.0f);
        collider.IsTrigger = true;
        source.World.AddData(entity, collider);
        source.World.UpdateTransforms();

        SceneSnapshot snapshot = source.CaptureSnapshot("prefab/runtime-2d");

        using var target = new SceneRuntime(new SceneRuntimeOptions
        {
            RuntimeProfile = SceneRuntimeProfiles.TwoD
        });
        ScenePrefabInstantiationResult result = target.LoadSnapshot(snapshot);

        result.Entities.Should().ContainSingle();
        SceneEntity loaded = result.Entities[0];
        target.World.GetData<SceneRigidbody2D>(loaded).Should().Be(body);
        target.World.GetData<SceneCollider2D>(loaded).Should().Be(collider);
    }

    [Fact]
    public void Loop_TicksRuntimeAndRenders()
    {
        var api = new MockGLApi { EnableCallLogging = true };
        using var context = new GLContext(api);
        using var runtime = CreateRenderableRuntime(out _, out _);
        using var renderer = new SceneGlFrameRenderer(context, runtime);
        renderer.UploadAssets();
        using var loop = new SceneRuntimeLoop(runtime, renderer);

        loop.Start(GameTime.FromMilliseconds(0.0));
        FrameExecutionOutcome outcome = loop.Tick(GameTime.FromMilliseconds(16.67));

        outcome.Kind.Should().Be(FrameOutcomeKind.Executed);
        outcome.Frame.Value.Should().Be(1);
        loop.State.CameraAvailable.Should().BeTrue();
        loop.State.RenderStats.DrawCalls.Should().Be(1);
        loop.State.RenderStats.PassCount.Should().Be(1);
    }

    [Fact]
    public void Loop_PlansHeadlesslyWithoutRenderer()
    {
        using var runtime = CreateRenderableRuntime(out _, out _);
        using var loop = new SceneRuntimeLoop(runtime);

        loop.Start(GameTime.FromMilliseconds(0.0));
        _ = loop.Tick(GameTime.FromMilliseconds(16.67));

        loop.State.CameraAvailable.Should().BeTrue();
        loop.State.RenderStats.DrawCalls.Should().Be(0);
        loop.State.RenderStats.PassCount.Should().Be(0);
    }

    [Fact]
    public void Loop_HaltsBeforeStart()
    {
        using var runtime = new SceneRuntime(new SceneRuntimeOptions { Profile = CreateProfile() });
        using var loop = new SceneRuntimeLoop(runtime);

        FrameExecutionOutcome outcome = loop.Tick(GameTime.FromMilliseconds(16.67));

        outcome.Kind.Should().Be(FrameOutcomeKind.Halted);
        loop.Status.Should().Be(GameLoopStatus.Idle);
    }

    private sealed class CountingBehaviour : ISceneBehaviour
    {
        public int StartCount { get; private set; }

        public int EnableCount { get; private set; }

        public int UpdateCount { get; private set; }

        public int FixedUpdateCount { get; private set; }

        public void OnAttach(SceneBehaviourContext context)
        {
            context.OnStart(() => StartCount++);
            context.OnEnable(() => EnableCount++);
            context.OnUpdate(_ => UpdateCount++);
            context.OnFixedUpdate(_ => FixedUpdateCount++);
        }
    }

    private static SceneRuntime Create2DRuntime(out SceneAssetRegistry assets)
    {
        SceneProfile profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/runtime-2d")))
            .AddTransform2D()
            .AddRendering2D()
            .Build();

        var runtime = new SceneRuntime(new SceneRuntimeOptions
        {
            Profile = profile,
            ViewportWidth = 320,
            ViewportHeight = 180
        });
        assets = runtime.Assets;

        SceneWorld world = runtime.World;
        SceneEntity cameraEntity = world.CreateEntity("Camera2D");
        world.GetTransform2D(cameraEntity).SetPosition(Vec2.Zero);
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        camera.OrthographicSize = 5.0f;
        world.AddData(cameraEntity, camera);
        world.AddData(cameraEntity, SceneCamera2D.Default);
        world.UpdateTransforms();
        return runtime;
    }

    private static SceneRuntime CreateMixedRuntime()
    {
        var builder = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/runtime-mixed")))
            .AddTransform3D()
            .AddRendering3D();

        builder.AddData<SceneSpriteRenderer>(
            "SpriteRenderer",
            SceneComponentTraits.Singleton | SceneComponentTraits.Serializable,
            priority: 100);

        var runtime = new SceneRuntime(new SceneRuntimeOptions
        {
            Profile = builder.Build(),
            ViewportWidth = 320,
            ViewportHeight = 180
        });

        SceneEntity cameraEntity = runtime.World.CreateEntity("Camera3D");
        runtime.World.GetTransform3D(cameraEntity).SetPosition(new Vec3(0.0f, 0.0f, 10.0f));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        runtime.World.AddData(cameraEntity, camera);
        runtime.World.UpdateTransforms();
        return runtime;
    }

    private static SceneProfile CreateProfile() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/runtime")))
            .AddTransform3D()
            .AddRendering3D()
            .AddLighting3D()
            .Build();

    private static SceneProfile CreateRuntimeComponentProfile() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/runtime-components")))
            .AddTransform3D()
            .AddPhysics3D()
            .AddParticles3D()
            .Build();

    private static SceneRuntime CreateRenderableRuntime(
        out SceneEntity cameraEntity,
        out SceneEntity rendererEntity)
    {
        var runtime = new SceneRuntime(new SceneRuntimeOptions
        {
            Profile = CreateProfile(),
            ViewportWidth = 640,
            ViewportHeight = 360
        });

        SceneAssetRegistry assets = runtime.Assets;
        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("test/shader");
        assets.Shaders.Register(new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}"));

        SceneAssetId<MeshAssetTag> meshId = assets.CreateId<MeshAssetTag>("test/mesh");
        assets.Meshes.Register(new SceneMeshDefinition(
            meshId,
            new byte[36],
            [new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)],
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f)));

        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("test/material");
        assets.Materials.Register(new SceneMaterialDefinition(
            materialId,
            shaderId,
            new SceneMaterialSurface()));

        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("main");
        assets.RenderPasses.Register(new SceneRenderPassDefinition(
            passId,
            clearMask: SceneClearMask.Color | SceneClearMask.Depth,
            clearColor: new Vec4(0.1f, 0.1f, 0.1f, 1.0f)));
        runtime.Frame.RebuildPasses();

        SceneWorld world = runtime.World;
        cameraEntity = world.CreateEntity("Camera");
        world.GetTransform3D(cameraEntity).SetPosition(new Vec3(0.0f, 0.0f, 10.0f));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(cameraEntity, camera);

        rendererEntity = world.CreateEntity("Renderer");
        SceneMeshRenderer renderer = SceneMeshRenderer.Default;
        renderer.MeshId = meshId;
        renderer.MaterialId = materialId;
        renderer.PassId = passId;
        world.AddData(rendererEntity, renderer);

        SceneEntity sun = world.CreateEntity("Sun");
        world.AddData(sun, SceneDirectionalLight.Default);

        world.UpdateTransforms();
        return runtime;
    }

    private static SceneSnapshot CreateSnapshot(out SceneAssetRegistry assets)
    {
        assets = new SceneAssetRegistry();
        SceneAssetId<ShaderAssetTag> shaderId = assets.CreateId<ShaderAssetTag>("snapshot/shader");
        SceneAssetId<MeshAssetTag> meshId = assets.CreateId<MeshAssetTag>("snapshot/mesh");
        SceneAssetId<MaterialAssetTag> materialId = assets.CreateId<MaterialAssetTag>("snapshot/material");
        SceneAssetId<RenderPassAssetTag> passId = assets.CreateId<RenderPassAssetTag>("snapshot/pass");

        return new SceneSnapshot(
            CreatePrefab("prefab/snapshot"),
            [new SceneShaderDefinition(shaderId, "void main(){}", "void main(){}")],
            [
                new SceneMeshDefinition(
                    meshId,
                    new byte[36],
                    [new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)])
            ],
            [
                new SceneMaterialDefinition(
                    materialId,
                    shaderId,
                    new SceneMaterialSurface())
            ],
            [],
            [],
            [new SceneRenderPassDefinition(passId)]);
    }

    private static ScenePrefabDefinition CreatePrefab(string id) => new(
        id,
        [
            Entity("root", "Root"),
            Entity("child", "Child", parentNodeId: "root")
        ]);

    private static SceneEntitySnapshot Entity(string nodeId, string name, string? parentNodeId = null)
    {
        using JsonDocument document = JsonDocument.Parse("""{"position":[0,0,0]}""");
        return new SceneEntitySnapshot(
            nodeId,
            name,
            0,
            "Untagged",
            active: true,
            persistent: false,
            pooled: false,
            [new SceneComponentSnapshot("Transform3D", document.RootElement.Clone())],
            parentNodeId);
    }
}
