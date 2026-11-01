namespace Axrone.Scene.Runtime.Tests;

using Axrone.Animation;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneBonePaletteWiringTests
{
    private static readonly float[] ChannelTimes = [0.0f, 1.0f];
    private static readonly float[] ChannelValues = [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f];
    [Fact]
    public void AnimatorStepPublishesPaletteIntoStore()
    {
        using SceneRuntime runtime = new(new SceneRuntimeOptions { Profile = CreateSkinnedProfile() });
        runtime.HasAnimators.Should().BeTrue();
        runtime.HasSkinnedMeshes.Should().BeTrue();

        SceneActor actor = CreateAnimatedActor(runtime);
        AnimationController controller = CreateController();
        runtime.Animators!.Bind(actor, controller).Should().BeTrue();

        runtime.Animators.Step(0.5f, runtime.BonePaletteSink);

        runtime.BonePalettes.TryGetBonePalette(actor, out ReadOnlySpan<Mat4> palette).Should().BeTrue();
        palette.Length.Should().Be(1);
        palette[0].M14.Should().BeApproximately(0.5f, 0.001f);
        runtime.BonePalettes.Revision.Should().Be(1);
    }

    [Fact]
    public void ProfileWithoutSkinnedMeshesLeavesStoreEmpty()
    {
        using SceneRuntime runtime = new(new SceneRuntimeOptions
        {
            Profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/animator-only")))
                .AddTransform3D()
                .AddAnimators3D()
                .Build()
        });
        runtime.HasSkinnedMeshes.Should().BeFalse();

        SceneActor actor = CreateAnimatedActor(runtime);
        AnimationController controller = CreateController();
        runtime.Animators!.Bind(actor, controller).Should().BeTrue();

        runtime.Animators.Step(0.5f, null);

        runtime.BonePalettes.Count.Should().Be(0);
        runtime.BonePalettes.TryGetBonePalette(actor, out _).Should().BeFalse();
    }

    [Fact]
    public void PausedAnimatorDoesNotRewritePalette()
    {
        using SceneRuntime runtime = new(new SceneRuntimeOptions { Profile = CreateSkinnedProfile() });
        SceneActor actor = CreateAnimatedActor(runtime);
        runtime.Animators!.Bind(actor, CreateController()).Should().BeTrue();

        runtime.Animators.Step(0.25f, runtime.BonePaletteSink);
        long revision = runtime.BonePalettes.Revision;

        ref SceneAnimator animator = ref runtime.World.GetData<SceneAnimator>(actor);
        animator.Paused = true;
        runtime.Animators.Step(0.5f, runtime.BonePaletteSink);

        runtime.BonePalettes.Revision.Should().Be(revision);
    }

    [Fact]
    public void PalettePublishingIsZeroAllocationAfterWarmup()
    {
        using SceneRuntime runtime = new(new SceneRuntimeOptions { Profile = CreateSkinnedProfile() });
        SceneActor actor = CreateAnimatedActor(runtime);
        runtime.Animators!.Bind(actor, CreateController()).Should().BeTrue();

        for (int i = 0; i < 4; i++)
        {
            runtime.Animators.Step(0.016f, runtime.BonePaletteSink);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            runtime.Animators.Step(0.016f, runtime.BonePaletteSink);
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        delta.Should().Be(0);
        runtime.BonePalettes.Count.Should().Be(1);
    }

    [Fact]
    public void PoseSinkForwardsOnlyTheWorldPalette()
    {
        var store = new SceneBonePaletteStore();
        var sink = new SceneBonePalettePoseSink(store);
        using SceneWorld world = CreateSkinnedProfile().CreateWorld();
        SceneActor actor = world.CreateActor("Animated");
        LocalTransform[] localPose = [new LocalTransform(new Vec3(9, 9, 9), Quat.Identity, Vec3.One)];
        Mat4[] palette = [Mat4.CreateTranslation(3, 0, 0)];

        sink.ApplyPose(actor, localPose, palette);

        store.TryGetBonePalette(actor, out ReadOnlySpan<Mat4> stored).Should().BeTrue();
        stored[0].M41.Should().Be(3.0f);

        sink.ApplyPose(SceneActor.Null, localPose, palette);
        store.Count.Should().Be(1);
    }

    private static SceneProfile CreateSkinnedProfile() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/skinned-wiring")))
            .AddTransform3D()
            .AddAnimators3D()
            .AddSceneRenderables(SceneRenderableFeatures.SkinnedMesh)
            .Build();

    private static SceneActor CreateAnimatedActor(SceneRuntime runtime)
    {
        SceneActor actor = runtime.World.CreateActor("Animated");
        runtime.World.AddData(actor, SceneAnimator.Default);
        return actor;
    }

    private static AnimationController CreateController()
    {
        Rig rig = new(new RigId("test-rig"), new BoneInfo { Name = "root", ParentIndex = -1 });
        var parameters = new ParameterStore(Array.Empty<KeyValuePair<string, ParameterType>>());
        var controller = new AnimationController(rig, parameters, new CurveLayout(new Dictionary<CurveId, int>()));
        var channel = new AnimationChannel(
            0,
            ChannelTarget.Translation,
            InterpolationMode.Linear,
            ChannelTimes,
            ChannelValues);
        var clip = new AnimationClip(new ClipId("move"), 1.0f, new[] { channel });
        var layer = new AnimationLayer(
            new LayerId("base"),
            new StateMachineInstance(
                new[] { new AnimationState(new StateId("state"), new ClipMotionNode(clip)) },
                Array.Empty<StateTransition>(),
                0));
        controller.AddLayer(layer);
        controller.BindAll();
        return controller;
    }
}
