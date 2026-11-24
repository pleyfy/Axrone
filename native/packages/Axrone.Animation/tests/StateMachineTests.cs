namespace Axrone.Animation.Tests;

public class StateMachineTests
{
    private static Rig TwoBone() => new(new RigId("r"), [
        new BoneInfo { Name = "root", ParentIndex = -1 },
        new BoneInfo { Name = "child", ParentIndex = 0 },
    ]);

    private static Dictionary<CurveId, int> NoCurves() => new();

    private static Dictionary<string, ParameterType> Params() => new()
    {
        ["go"] = ParameterType.Trigger,
        ["speed"] = ParameterType.Float,
    };

    private static AnimationClip SlideClip(float toX) => new(
        new ClipId($"slide-{toX}"), 1.0f,
        [new AnimationChannel(1, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, toX, 0.0f, 0.0f])]);

    private static StateMachineInstance TwoState(out ParameterStore parameters)
    {
        parameters = new ParameterStore(Params());
        var idle = new AnimationState(new StateId("idle"), new ClipMotionNode(SlideClip(0.0f)));
        var run = new AnimationState(new StateId("run"), new ClipMotionNode(SlideClip(10.0f)));
        var transition = new StateTransition(1, 0.5f, [new ParameterCondition("go", ConditionOperator.Equal, 0.0f)]);
        idle = new AnimationState(new StateId("idle"), new ClipMotionNode(SlideClip(0.0f)), [transition]);
        return new StateMachineInstance([idle, run], [], 0);
    }

    private static readonly float[] s_halfTimes = new float[] { 0.0f, 1.0f };
    private static readonly float[] s_staticValues = new float[] { 0, 0, 0, 0, 0, 0 };
    private static readonly float[] s_movingValues = new float[] { 0, 0, 0, 2, 0, 0 };

    [Fact]
    public void RootDelta_MixesSourceAndTargetMidBlend()
    {
        var rig = new Rig(new RigId("r"), new BoneInfo[] { new() { Name = "root", ParentIndex = -1 } });
        var parameters = new ParameterStore(Params());
        var staticClip = new AnimationClip(
            new ClipId("still"), 1.0f,
            new AnimationChannel[] { new(0, ChannelTarget.Translation, InterpolationMode.Linear, s_halfTimes, s_staticValues) });
        var movingClip = new AnimationClip(
            new ClipId("move"), 1.0f,
            new AnimationChannel[] { new(0, ChannelTarget.Translation, InterpolationMode.Linear, s_halfTimes, s_movingValues) });
        var machine = new StateMachineInstance(
            new AnimationState[]
            {
                new(new StateId("still"), new ClipMotionNode(staticClip)),
                new(new StateId("move"), new ClipMotionNode(movingClip)),
            },
            Array.Empty<StateTransition>(), 0);

        machine.CrossFade(1, duration: 1.0f);
        machine.HasActiveTransition.Should().BeTrue();
        machine.Update(0.5f, parameters, new List<ClipEvent>(), 1.0f);

        machine.ExtractRootDelta(rig, out Vec3 delta, out _);
        delta.X.Should().BeApproximately(0.5f, 1e-4f);
        delta.Y.Should().BeApproximately(0.0f, 1e-6f);
    }

    [Fact]
    public void EntryState_EvaluatesRest()
    {
        Rig rig = TwoBone();
        StateMachineInstance machine = TwoState(out ParameterStore parameters);
        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 8);
        machine.Evaluate(frame, arena, rig, parameters);
        frame.ReadTranslations()[1].X.Should().Be(0.0f);
    }

    [Fact]
    public void TriggerTransition_BlendsToTarget()
    {
        Rig rig = TwoBone();
        StateMachineInstance machine = TwoState(out ParameterStore parameters);
        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 8);
        var events = new List<ClipEvent>();

        parameters.SetTrigger("go");
        machine.Update(0.25f, parameters, events, 1.0f);
        machine.Evaluate(frame, arena, rig, parameters);
        float mid = frame.ReadTranslations()[1].X;
        mid.Should().BeInRange(0.0f, 10.0f);

        machine.Update(0.5f, parameters, events, 1.0f);
        machine.Evaluate(frame, arena, rig, parameters);
        machine.CurrentStateIndex.Should().Be(1);
    }

    [Fact]
    public void ForceState_SnapsWithoutBlend()
    {
        StateMachineInstance machine = TwoState(out _);
        machine.ForceState(1, 0.5f);
        machine.CurrentStateIndex.Should().Be(1);
        machine.StateNormalizedTime.Should().Be(0.5f);
    }

    [Fact]
    public void CrossFade_CompletesOverDuration()
    {
        Rig rig = TwoBone();
        StateMachineInstance machine = TwoState(out ParameterStore parameters);
        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 8);
        var events = new List<ClipEvent>();

        machine.CrossFade(1, 1.0f);
        machine.Update(0.5f, parameters, events, 1.0f);
        machine.CurrentStateIndex.Should().Be(0);
        machine.Evaluate(frame, arena, rig, parameters);

        machine.Update(0.5f, parameters, events, 1.0f);
        machine.CurrentStateIndex.Should().Be(1);
    }

    [Fact]
    public void InvalidAuthoring_ThrowsCodedValidation()
    {
        Action nanSpeed = () => { _ = new AnimationState(new StateId("x"), new ClipMotionNode(SlideClip(0.0f))) { Speed = float.NaN }; };
        nanSpeed.Should().Throw<ValidationException>()
            .Where(ex => ex.Code == AnimationErrorCode.ValidationInvalidArgument);

        Action negativeDuration = () => { _ = new StateTransition(1, -0.5f); };
        negativeDuration.Should().Throw<ValidationException>()
            .Where(ex => ex.Code == AnimationErrorCode.ValidationInvalidArgument);

        Action nanOffset = () => { _ = new StateTransition(1, 0.1f) { Offset = float.NaN }; };
        nanOffset.Should().Throw<ValidationException>()
            .Where(ex => ex.Code == AnimationErrorCode.ValidationInvalidArgument);
    }

    [Fact]
    public void Transition_EmitsSourceAndTargetEvents()
    {
        var parameters = new ParameterStore(Params());
        var sourceClip = new AnimationClip(
            new ClipId("source"), 1.0f, [],
            events: [new ClipEvent(0.9f, "source", "")]);
        var targetClip = new AnimationClip(
            new ClipId("target"), 1.0f, [],
            events: [new ClipEvent(0.15f, "target", "")]);

        var source = new AnimationState(
            new StateId("source"),
            new ClipMotionNode(sourceClip),
            [new StateTransition(1, 1.0f, [new ParameterCondition("go", ConditionOperator.Equal, 0.0f)])]);
        var target = new AnimationState(new StateId("target"), new ClipMotionNode(targetClip));
        var machine = new StateMachineInstance([source, target], [], 0);
        var events = new List<ClipEvent>();

        parameters.SetTrigger("go");
        machine.Update(0.1f, parameters, events, 1.0f);
        machine.Update(0.2f, parameters, events, 1.0f);
        machine.Update(0.5f, parameters, events, 1.0f);
        machine.Update(0.4f, parameters, events, 1.0f);

        events.Select(e => e.Name).Should().Contain("source");
        events.Select(e => e.Name).Should().Contain("target");
    }

    [Fact]
    public void NegativeStateSpeed_UsesMagnitudeForDuration()
    {
        var parameters = new ParameterStore(Params());
        var state = new AnimationState(new StateId("reverse"), new ClipMotionNode(SlideClip(0.0f))) { Speed = -2.0f };
        var machine = new StateMachineInstance([state], [], 0);

        machine.Update(0.1f, parameters, new List<ClipEvent>(), 1.0f);

        machine.StateNormalizedTime.Should().BeApproximately(0.2f, 1e-4f);
    }

    [Fact]
    public void TransitionEasing_ControlsBlendCurve()
    {
        var parameters = new ParameterStore(Params());
        var idle = new AnimationState(
            new StateId("idle"),
            new ClipMotionNode(SlideClip(0.0f)),
            new StateTransition(1, 1.0f, [new ParameterCondition("go", ConditionOperator.Equal, 0.0f)]) { Easing = TransitionEasing.EaseIn });
        var run = new AnimationState(new StateId("run"), new ClipMotionNode(SlideClip(10.0f)));
        var machine = new StateMachineInstance([idle, run], [], 0);
        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 4);

        parameters.SetTrigger("go");
        machine.Update(0.25f, parameters, new List<ClipEvent>(), 1.0f);
        machine.Update(0.25f, parameters, new List<ClipEvent>(), 1.0f);
        machine.Evaluate(frame, arena, TwoBone(), parameters);

        frame.ReadTranslations()[1].X.Should().BeApproximately(0.15625f, 1e-4f);
    }

    [Fact]
    public void AnyStateSelfTransition_IsAllowed()
    {
        var parameters = new ParameterStore(Params());
        var idle = new AnimationState(new StateId("idle"), new ClipMotionNode(SlideClip(0.0f)));
        var restart = new StateTransition(0, 0.2f, [new ParameterCondition("go", ConditionOperator.Equal, 0.0f)]);
        var machine = new StateMachineInstance([idle], [restart], 0);

        parameters.SetTrigger("go");
        machine.Update(0.1f, parameters, new List<ClipEvent>(), 1.0f);

        machine.HasActiveTransition.Should().BeTrue();
    }

    [Fact]
    public void InvalidTransitionTarget_ThrowsAtConstruction()
    {
        var idle = new AnimationState(
            new StateId("idle"),
            new ClipMotionNode(SlideClip(0.0f)),
            [new StateTransition(7, 0.1f)]);

        Action create = () => _ = new StateMachineInstance([idle], [], 0);

        create.Should().Throw<ValidationException>()
            .Where(ex => ex.Code == AnimationErrorCode.StateMachineInvalidTransition);
    }

    [Fact]
    public void DuplicateStateIds_ThrowAtConstruction()
    {
        var first = new AnimationState(new StateId("same"), new ClipMotionNode(SlideClip(0.0f)));
        var second = new AnimationState(new StateId("same"), new ClipMotionNode(SlideClip(1.0f)));

        Action create = () => _ = new StateMachineInstance([first, second], [], 0);

        create.Should().Throw<ValidationException>()
            .Where(ex => ex.Code == AnimationErrorCode.StateMachineInvalidTransition);
    }

    [Fact]
    public void ExitTime_GatesTransition()
    {
        var parameters = new ParameterStore(Params());
        parameters.SetFloat("speed", 5.0f);
        var idle = new AnimationState(
            new StateId("idle"),
            new ClipMotionNode(SlideClip(0.0f)),
            [new StateTransition(1, 0.1f, [new ParameterCondition("speed", ConditionOperator.GreaterThan, 1.0f)]) { ExitTime = 0.9f }]);
        var run = new AnimationState(new StateId("run"), new ClipMotionNode(SlideClip(10.0f)));
        var machine = new StateMachineInstance([idle, run], [], 0);
        var events = new List<ClipEvent>();

        machine.Update(0.5f, parameters, events, 1.0f);
        machine.CurrentStateIndex.Should().Be(0);

        machine.Update(0.5f, parameters, events, 1.0f);
        machine.CurrentStateIndex.Should().Be(0);

        machine.ForceState(0, 0.95f);
        machine.Update(0.2f, parameters, events, 1.0f);
        machine.HasActiveTransition.Should().BeFalse();

        machine.ForceState(0, 0.85f);
        machine.Update(0.3f, parameters, events, 1.0f);
        machine.HasActiveTransition.Should().BeTrue();
    }
}
