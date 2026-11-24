namespace Axrone.Animation.Tests;

public class ControllerTests
{
    private static Rig TwoBone() => new(new RigId("r"), [
        new BoneInfo { Name = "root", ParentIndex = -1 },
        new BoneInfo { Name = "child", ParentIndex = 0 },
    ]);

    private static Dictionary<string, ParameterType> Params() => new()
    {
        ["go"] = ParameterType.Trigger,
    };

    private static Dictionary<CurveId, int> NoCurves() => new();

    private static AnimationClip SlideClip(float toX) => new(
        new ClipId($"slide-{toX}"), 1.0f,
        [new AnimationChannel(1, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, toX, 0.0f, 0.0f])]);

    private static AnimationController BaseController(Rig rig, ParameterStore parameters)
    {
        var idle = new AnimationState(new StateId("idle"), new ClipMotionNode(SlideClip(0.0f)));
        var machine = new StateMachineInstance([idle], [], 0);
        var controller = new AnimationController(rig, parameters, NoCurves());
        controller.AddLayer(new AnimationLayer(new LayerId("base"), machine));
        return controller;
    }

    [Fact]
    public void BaseLayer_DrivesCurrentFrame()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = BaseController(rig, parameters);
        var events = new List<ClipEvent>();

        controller.Update(0.5f, events, out Vec3 rootPos, out _);
        controller.CurrentFrame.ReadTranslations()[1].X.Should().Be(0.0f);
        rootPos.Should().Be(Vec3.Zero);
    }

    [Fact]
    public void OverrideLayer_BlendsOnTop()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = BaseController(rig, parameters);

        var overlay = new AnimationState(new StateId("over"), new ClipMotionNode(SlideClip(10.0f)));
        var overlayMachine = new StateMachineInstance([overlay], [], 0);
        controller.AddLayer(new AnimationLayer(new LayerId("upper"), overlayMachine) { Weight = 0.5f });

        var events = new List<ClipEvent>();
        controller.Update(0.5f, events, out _, out _);
        controller.CurrentFrame.ReadTranslations()[1].X.Should().BeApproximately(2.5f, 1e-4f);
    }

    [Fact]
    public void AdditiveLayer_AddsRestDelta()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = BaseController(rig, parameters);

        var additive = new AnimationState(new StateId("add"), new ClipMotionNode(SlideClip(4.0f)));
        var additiveMachine = new StateMachineInstance([additive], [], 0);
        controller.AddLayer(new AnimationLayer(new LayerId("add"), additiveMachine) { Mode = LayerMode.Additive, Weight = 1.0f });

        var events = new List<ClipEvent>();
        controller.Update(0.5f, events, out _, out _);
        controller.CurrentFrame.ReadTranslations()[1].X.Should().BeApproximately(2.0f, 1e-4f);
    }

    [Fact]
    public void SyncedLayerFollowsBaseStateTime()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = new AnimationController(rig, parameters, NoCurves());
        var baseLayer = new AnimationLayer(
            new LayerId("base"),
            new StateMachineInstance(
                [new AnimationState(new StateId("locomotion"), new ClipMotionNode(SlideClip(0.0f)))],
                [],
                0));
        var overlay = new AnimationLayer(
            new LayerId("upper"),
            new StateMachineInstance(
                [new AnimationState(new StateId("locomotion"), new ClipMotionNode(SlideClip(10.0f)))],
                [],
                0))
        {
            Weight = 0.5f,
            SyncSource = baseLayer,
        };
        controller.AddLayer(baseLayer);
        controller.AddLayer(overlay);

        controller.Update(0.3f, new List<ClipEvent>(), out _, out _);

        overlay.Machine.StateNormalizedTime.Should().Be(baseLayer.Machine.StateNormalizedTime);
        controller.CurrentFrame.ReadTranslations()[1].X.Should().BeApproximately(1.5f, 1e-4f);
    }

    [Fact]
    public void Controller_UpdateIsAllocationFree()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(new Dictionary<string, ParameterType>
        {
            ["x"] = ParameterType.Float,
            ["y"] = ParameterType.Float,
        });
        using var controller = new AnimationController(rig, parameters, NoCurves());
        var blend = new Blend2DMotionNode("x", "y", [
            (new Vec2(0.0f, 0.0f), (MotionNode)new ClipMotionNode(SlideClip(0.0f))),
            (new Vec2(1.0f, 0.0f), (MotionNode)new ClipMotionNode(SlideClip(10.0f))),
        ]);
        var machine = new StateMachineInstance([new AnimationState(new StateId("blend"), blend)], [], 0);
        controller.AddLayer(new AnimationLayer(new LayerId("base"), machine));
        controller.BindAll();
        parameters.SetFloat("x", 0.5f);
        parameters.SetFloat("y", 0.0f);

        var events = new List<ClipEvent>(4);
        for (int i = 0; i < 16; i++)
        {
            controller.Update(0.016f, events, out _, out _);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            controller.Update(0.016f, events, out _, out _);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void Montage_FadesInPlaysAndCompletes()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = BaseController(rig, parameters);
        AnimationMontage montage = controller.PlayMontage(
            SlideClip(10.0f),
            new AnimationMontageOptions(FadeInSeconds: 0.5f, FadeOutSeconds: 0.5f));
        var events = new List<ClipEvent>();

        controller.LayerCount.Should().Be(2);
        controller.ActiveMontageCount.Should().Be(1);

        controller.Update(0.25f, events, out _, out _);
        montage.Weight.Should().BeApproximately(0.5f, 1e-4f);
        controller.CurrentFrame.ReadTranslations()[1].X.Should().BeApproximately(1.25f, 1e-4f);

        controller.Update(0.5f, events, out _, out _);
        montage.Weight.Should().BeApproximately(0.5f, 1e-4f);
        controller.CurrentFrame.ReadTranslations()[1].X.Should().BeApproximately(3.75f, 1e-4f);

        controller.Update(0.3f, events, out _, out _);
        montage.Status.Should().Be(AnimationMontageStatus.Completed);
        controller.ActiveMontageCount.Should().Be(0);
        controller.LayerCount.Should().Be(1);
        controller.CurrentFrame.ReadTranslations()[1].X.Should().Be(0.0f);
    }

    [Fact]
    public void Montage_StopReleasesLayerOnNextUpdate()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = BaseController(rig, parameters);
        AnimationMontage montage = controller.PlayMontage(SlideClip(10.0f));

        controller.Update(0.1f, new List<ClipEvent>(), out _, out _);
        montage.Stop();
        montage.Status.Should().Be(AnimationMontageStatus.Stopped);
        controller.LayerCount.Should().Be(2);

        controller.Update(0.1f, new List<ClipEvent>(), out _, out _);
        controller.LayerCount.Should().Be(1);
        controller.ActiveMontageCount.Should().Be(0);
    }

    [Fact]
    public void Montage_SpeedDrivesClipPlayback()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = BaseController(rig, parameters);
        AnimationMontage montage = controller.PlayMontage(
            SlideClip(10.0f),
            new AnimationMontageOptions(FadeInSeconds: 0.0f, Speed: 2.0f));

        controller.Update(0.25f, new List<ClipEvent>(), out _, out _);

        montage.NormalizedTime.Should().BeApproximately(0.5f, 1e-3f);
        controller.CurrentFrame.ReadTranslations()[1].X.Should().BeApproximately(5.0f, 1e-3f);
    }

    [Fact]
    public void Montage_LoopWrapsNormalizedTime()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = BaseController(rig, parameters);
        AnimationMontage montage = controller.PlayMontage(
            SlideClip(10.0f),
            new AnimationMontageOptions(FadeInSeconds: 0.0f, Loop: true));

        controller.Update(1.25f, new List<ClipEvent>(), out _, out _);

        montage.Status.Should().Be(AnimationMontageStatus.Playing);
        montage.NormalizedTime.Should().BeApproximately(0.25f, 1e-3f);
        controller.ActiveMontageCount.Should().Be(1);
    }

    [Fact]
    public void Montage_EventsReachTheControllerSink()
    {        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = BaseController(rig, parameters);
        var clip = new AnimationClip(
            new ClipId("cue"), 1.0f,
            [new AnimationChannel(1, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f])],
            events: [new ClipEvent(0.1f, "hit", "montage")]);

        controller.PlayMontage(clip, new AnimationMontageOptions(FadeInSeconds: 0.0f));
        var events = new List<ClipEvent>();
        controller.Update(0.2f, events, out _, out _);

        events.Should().ContainSingle(e => e.Name == "hit" && e.Payload == "montage");
    }

    [Fact]
    public void EmptyController_RestsWithoutLayers()
    {
        Rig rig = TwoBone();
        var parameters = new ParameterStore(Params());
        using var controller = new AnimationController(rig, parameters, NoCurves());
        var events = new List<ClipEvent>();

        controller.Update(1.0f, events, out Vec3 rootPos, out Quat rootRot);
        controller.CurrentFrame.ReadTranslations()[1].Should().Be(Vec3.Zero);
        rootPos.Should().Be(Vec3.Zero);
        rootRot.Should().Be(Quat.Identity);
    }

    [Fact]
    public void RootMotion_ExtractedFromBase()
    {
        var rig = new Rig(new RigId("r"), [
            new BoneInfo { Name = "root", ParentIndex = -1 },
            new BoneInfo { Name = "child", ParentIndex = 0 },
        ]);
        var clip = new AnimationClip(
            new ClipId("move"), 1.0f,
            [new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 3.0f, 0.0f, 0.0f])]);
        var state = new AnimationState(new StateId("move"), new ClipMotionNode(clip));
        var machine = new StateMachineInstance([state], [], 0);
        var parameters = new ParameterStore(Params());
        using var controller = new AnimationController(rig, parameters, NoCurves());
        controller.AddLayer(new AnimationLayer(new LayerId("base"), machine));

        var events = new List<ClipEvent>();
        controller.Update(0.5f, events, out Vec3 rootPos, out _);
        rootPos.X.Should().BeApproximately(1.5f, 1e-4f);
    }
}
