namespace Axrone.Scene.Runtime.Tests;

using Axrone.Animation;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneAnimatorBridgeTests
{
    private static readonly float[] s_timeKeys = [0.0f, 1.0f];
    private static readonly float[] s_translationKeys = [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f];
    private static readonly float[] s_curveValues = [0.0f, 1.0f];
    private static readonly AnimationChannel[] s_cueChannels =
    [
        new(0, ChannelTarget.Translation, InterpolationMode.Linear, s_timeKeys, s_translationKeys),
    ];
    private static readonly ClipEvent[] s_cueEvents = [new(0.1f, "hit", "arm")];

    [Fact]
    public void BindRequiresAnimatorComponent()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);

        SceneEntity entity = world.CreateEntity("Animated");

        bridge.Bind(entity, controller).Should().BeFalse();
        bridge.Count.Should().Be(0);

        world.AddData(entity, SceneAnimator.Default);
        bridge.Bind(entity, controller).Should().BeTrue();
        bridge.Count.Should().Be(1);

        world.TryGetData(entity, out SceneAnimator component).Should().BeTrue();
        component.Handle.IsValid.Should().BeTrue();
        bridge.GetStatus(entity).Should().Be(SceneAnimatorStatus.Playing);
    }

    [Fact]
    public void StepAdvancesClipAndPublishesPose()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);
        RecordingPoseSink sink = new();

        bridge.Step(0.5f, sink);

        sink.Count.Should().Be(1);
        sink.Entity.Should().Be(entity);
        sink.LocalPose.Length.Should().Be(1);
        sink.LocalPose[0].Translation.X.Should().BeApproximately(0.5f, 0.001f);
        sink.WorldPalette[0].M14.Should().BeApproximately(0.5f, 0.001f);
    }

    [Fact]
    public void StepDeliversClipEventsToGameplaySink()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        Rig rig = CreateRig();
        ParameterStore parameters = new(Array.Empty<KeyValuePair<string, ParameterType>>());
        AnimationController controller = new(rig, parameters, new CurveLayout(new Dictionary<CurveId, int>()));
        AnimationClip clip = new(
            new ClipId("cue"), 1.0f, s_cueChannels,
            events: s_cueEvents);
        controller.AddLayer(new AnimationLayer(new LayerId("base"), CreateMachine(new ClipMotionNode(clip))));
        SceneEntity entity = BindEntity(world, bridge, controller);
        RecordingEventSink sink = new();

        bridge.Step(0.25f, null, sink);

        sink.Entity.Should().Be(entity);
        sink.Events.Should().ContainSingle();
        sink.Events[0].Name.Should().Be("hit");
        sink.Events[0].Payload.Should().Be("arm");
    }

    [Fact]
    public void SamplePoseInterpolatesBetweenFixedSteps()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);

        bridge.Step(0.25f);
        bridge.Step(0.25f);

        Span<LocalTransform> local = stackalloc LocalTransform[1];
        Span<Mat4> palette = stackalloc Mat4[1];

        bridge.TrySamplePose(entity, 0.0f, local, palette).Should().BeTrue();
        local[0].Translation.X.Should().BeApproximately(0.25f, 1e-4f);

        bridge.TrySamplePose(entity, 0.5f, local, palette).Should().BeTrue();
        local[0].Translation.X.Should().BeApproximately(0.375f, 1e-4f);
        palette[0].M14.Should().BeApproximately(0.375f, 1e-4f);

        bridge.TrySamplePose(entity, 1.0f, local, palette).Should().BeTrue();
        local[0].Translation.X.Should().BeApproximately(0.5f, 1e-4f);
    }

    [Fact]
    public void LodDefersDistantAnimatorUntilIntervalElapses()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);
        world.UpdateTransforms();
        bridge.Lod = new SceneAnimatorLodSettings(
            new Vec3(1000.0f, 0.0f, 0.0f),
            mediumDistance: 10.0f,
            farDistance: 20.0f,
            mediumInterval: 0.05f,
            farInterval: 0.1f);

        Span<LocalTransform> pose = stackalloc LocalTransform[1];
        Span<Mat4> palette = stackalloc Mat4[1];

        bridge.Step(0.04f);
        bridge.TryCopyPose(entity, pose, palette).Should().BeFalse();

        bridge.Step(0.04f);
        bridge.TryCopyPose(entity, pose, palette).Should().BeFalse();

        bridge.Step(0.03f);
        bridge.TryCopyPose(entity, pose, palette).Should().BeTrue();
        pose[0].Translation.X.Should().BeApproximately(0.11f, 0.001f);
    }

    [Fact]
    public void PublishInterpolatedPosesFeedsTheRenderSink()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        _ = BindEntity(world, bridge, controller);
        RecordingPoseSink sink = new();

        bridge.Step(0.25f);
        bridge.Step(0.25f);
        bridge.PublishInterpolatedPoses(0.5f, sink);

        sink.Count.Should().Be(1);
        sink.LocalPose[0].Translation.X.Should().BeApproximately(0.375f, 1e-4f);
        sink.WorldPalette[0].M14.Should().BeApproximately(0.375f, 1e-4f);
    }

    [Fact]
    public void StepIsAllocationFreeInSteadyState()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        _ = BindEntity(world, bridge, controller);

        for (int i = 0; i < 16; i++)
        {
            bridge.Step(0.016f);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            bridge.Step(0.016f);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void PauseHoldsTheLastPose()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);

        bridge.Step(0.25f);
        Span<LocalTransform> before = stackalloc LocalTransform[1];
        Span<Mat4> beforePalette = stackalloc Mat4[1];
        bridge.TryCopyPose(entity, before, beforePalette).Should().BeTrue();

        ref SceneAnimator component = ref world.GetData<SceneAnimator>(entity);
        component.Paused = true;

        bridge.Step(0.5f);

        bridge.GetStatus(entity).Should().Be(SceneAnimatorStatus.Paused);
        Span<LocalTransform> after = stackalloc LocalTransform[1];
        Span<Mat4> afterPalette = stackalloc Mat4[1];
        bridge.TryCopyPose(entity, after, afterPalette).Should().BeTrue();
        after[0].Should().Be(before[0]);
    }

    [Fact]
    public void CompleteIsTerminalAndResetResumes()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);

        bridge.Step(0.25f);
        bridge.Complete(entity).Should().BeTrue();
        bridge.GetStatus(entity).Should().Be(SceneAnimatorStatus.Completed);

        Span<LocalTransform> completedPose = stackalloc LocalTransform[1];
        Span<Mat4> completedPalette = stackalloc Mat4[1];
        bridge.TryCopyPose(entity, completedPose, completedPalette).Should().BeTrue();

        bridge.Step(0.5f);
        Span<LocalTransform> heldPose = stackalloc LocalTransform[1];
        Span<Mat4> heldPalette = stackalloc Mat4[1];
        bridge.TryCopyPose(entity, heldPose, heldPalette).Should().BeTrue();
        heldPose[0].Should().Be(completedPose[0]);

        bridge.Reset(entity).Should().BeTrue();
        bridge.Step(0.25f);
        bridge.GetStatus(entity).Should().Be(SceneAnimatorStatus.Playing);
        Span<LocalTransform> resumedPose = stackalloc LocalTransform[1];
        Span<Mat4> resumedPalette = stackalloc Mat4[1];
        bridge.TryCopyPose(entity, resumedPose, resumedPalette).Should().BeTrue();
        resumedPose[0].Translation.X.Should().BeGreaterThan(completedPose[0].Translation.X);
    }

    [Fact]
    public void ParametersDriveStateTransitions()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateTransitionController(out ParameterHandle go, out AnimationLayer layer);
        SceneEntity entity = BindEntity(world, bridge, controller);
        bridge.BindLayer(entity, layer);

        bridge.TryGetState(entity, out SceneAnimatorStateSnapshot initial).Should().BeTrue();
        initial.StateIndex.Should().Be(0);

        bridge.TrySetFloat(entity, in go, 1.0f).Should().BeTrue();
        bridge.Step(0.1f);
        bridge.Step(0.1f);

        bridge.TryGetState(entity, out SceneAnimatorStateSnapshot moved).Should().BeTrue();
        moved.StateIndex.Should().Be(1);
    }

    [Fact]
    public void LayerWeightIsClampedAndValidated()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out AnimationLayer existingLayer);
        SceneEntity entity = BindEntity(world, bridge, controller);
        bridge.BindLayer(entity, existingLayer);

        bridge.TrySetLayerWeight(entity, 0, 0.4f).Should().BeTrue();
        bridge.TryGetLayerWeight(entity, 0, out float weight).Should().BeTrue();
        weight.Should().BeApproximately(0.4f, 0.0001f);

        bridge.TrySetLayerWeight(entity, 0, 5.0f).Should().BeTrue();
        bridge.TryGetLayerWeight(entity, 0, out weight).Should().BeTrue();
        weight.Should().Be(1.0f);

        bridge.TrySetLayerWeight(entity, 0, float.NaN).Should().BeFalse();
        bridge.TryGetLayerWeight(entity, 1, out _).Should().BeFalse();
    }

    [Fact]
    public void PoseSinkFailureIsIsolatedPerEntity()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController first = CreateController(out _, out _);
        AnimationController second = CreateController(out _, out _);
        SceneEntity faultyEntity = BindEntity(world, bridge, first);
        SceneEntity healthyEntity = BindEntity(world, bridge, second);
        ThrowingPoseSink sink = new(faultyEntity);

        bridge.Step(0.5f, sink);

        bridge.GetStatus(faultyEntity).Should().Be(SceneAnimatorStatus.Faulted);
        bridge.TryGetFault(faultyEntity, out Exception? fault).Should().BeTrue();
        fault.Should().BeOfType<InvalidOperationException>();
        bridge.GetStatus(healthyEntity).Should().Be(SceneAnimatorStatus.Playing);

        Span<LocalTransform> healthyPose = stackalloc LocalTransform[1];
        Span<Mat4> healthyPalette = stackalloc Mat4[1];
        bridge.TryCopyPose(healthyEntity, healthyPose, healthyPalette).Should().BeTrue();
        healthyPose[0].Translation.X.Should().BeApproximately(0.5f, 0.001f);

        bridge.Reset(faultyEntity).Should().BeTrue();
        bridge.GetStatus(faultyEntity).Should().Be(SceneAnimatorStatus.Playing);
        bridge.TryGetFault(faultyEntity, out _).Should().BeFalse();
    }

    [Fact]
    public void UnbindInvalidatesHandleAndRebindUsesNewGeneration()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController first = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, first);
        world.TryGetData(entity, out SceneAnimator firstComponent);
        SceneAnimatorHandle firstHandle = firstComponent.Handle;

        bridge.Unbind(entity).Should().BeTrue();
        bridge.Count.Should().Be(0);
        world.TryGetData(entity, out SceneAnimator unbound);
        unbound.Handle.IsValid.Should().BeFalse();

        AnimationController second = CreateController(out _, out _);
        bridge.Bind(entity, second).Should().BeTrue();
        world.TryGetData(entity, out SceneAnimator rebound);
        rebound.Handle.Should().NotBe(firstHandle);
        bridge.GetStatus(entity).Should().Be(SceneAnimatorStatus.Playing);
    }

    [Fact]
    public void StaleHandleDoesNotResolve()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);
        world.TryGetData(entity, out SceneAnimator component);

        ref SceneAnimator live = ref world.GetData<SceneAnimator>(entity);
        live.Handle = new SceneAnimatorHandle(component.Handle.Slot, component.Handle.Generation + 1);

        bridge.GetStatus(entity).Should().Be(SceneAnimatorStatus.Unbound);
        bridge.TrySetFloat(entity, new ParameterHandle(0), 1.0f).Should().BeFalse();
    }

    [Fact]
    public void RootMotionIsAppliedWhenEnabled()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);

        ref SceneAnimator component = ref world.GetData<SceneAnimator>(entity);
        component.ApplyRootMotion = true;

        bridge.Step(0.5f);

        world.GetData<SceneTransform3D>(entity).Position.X.Should().BeApproximately(0.5f, 0.001f);
    }

    [Fact]
    public void StepPublishesMorphWeightsToTheRenderStore()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        Rig rig = CreateRig();
        var layout = new CurveLayout(new Dictionary<CurveId, int> { [new CurveId("morph/0")] = 0 });
        var parameters = new ParameterStore(Array.Empty<KeyValuePair<string, ParameterType>>());
        var controller = new AnimationController(rig, parameters, layout);
        var channel = new AnimationChannel(
            -1,
            ChannelTarget.Curve,
            InterpolationMode.Linear,
            s_timeKeys,
            s_curveValues,
            new CurveId("morph/0"));
        var clip = new AnimationClip(new ClipId("morph"), 1.0f, [channel]);
        controller.AddLayer(new AnimationLayer(new LayerId("base"), CreateMachine(new ClipMotionNode(clip))));
        SceneEntity entity = BindEntity(world, bridge, controller);
        ref SceneAnimator component = ref world.GetData<SceneAnimator>(entity);
        component.MorphCurveOffset = 0;
        component.MorphCurveCount = 1;
        var store = new SceneMorphWeightStore();

        bridge.Step(0.5f, null, null, store);

        store.TryGetMorphWeights(entity, out ReadOnlySpan<float> weights).Should().BeTrue();
        weights.Length.Should().Be(1);
        weights[0].Should().BeApproximately(0.5f, 1e-4f);
    }

    [Fact]
    public void PlayMontageRoutesEventsThroughTheBridge()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);
        var clip = new AnimationClip(
            new ClipId("montage"), 1.0f, s_cueChannels,
            events: s_cueEvents);
        RecordingEventSink events = new();

        AnimationMontage? montage = bridge.PlayMontage(
            entity,
            clip,
            new AnimationMontageOptions(FadeInSeconds: 0.0f, FadeOutSeconds: 0.0f));
        montage.Should().NotBeNull();

        bridge.Step(0.2f, null, events);

        events.Events.Should().ContainSingle(e => e.Name == "hit");
        montage!.Status.Should().Be(AnimationMontageStatus.Playing);
        controller.ActiveMontageCount.Should().Be(1);

        bridge.Step(1.0f);
        montage.Status.Should().Be(AnimationMontageStatus.Completed);
        controller.ActiveMontageCount.Should().Be(0);
    }

    [Fact]
    public void RootMotionConsumerTakesPrecedenceOverTransform()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);
        ref SceneAnimator component = ref world.GetData<SceneAnimator>(entity);
        component.ApplyRootMotion = true;
        RecordingRootMotionConsumer consumer = new();
        bridge.RootMotionConsumer = consumer;

        bridge.Step(0.5f);

        consumer.Entity.Should().Be(entity);
        consumer.Position.X.Should().BeApproximately(0.5f, 0.001f);
        world.GetData<SceneTransform3D>(entity).Position.X.Should().Be(0.0f);
    }

    [Fact]
    public void CopyPoseRejectsUndersizedSpans()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);
        bridge.Step(0.1f);

        Span<LocalTransform> shortLocal = stackalloc LocalTransform[0];
        Span<Mat4> palette = stackalloc Mat4[1];
        bridge.TryCopyPose(entity, shortLocal, palette).Should().BeFalse();
    }

    [Fact]
    public void RemovedComponentIsReleasedOnSync()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);

        world.RemoveData<SceneAnimator>(entity);
        bridge.Sync();

        bridge.Count.Should().Be(0);
        bridge.GetStatus(entity).Should().Be(SceneAnimatorStatus.Unbound);
    }

    [Fact]
    public void SteppingIsDeterministic()
    {
        using SceneWorld firstWorld = CreateWorld();
        using SceneWorld secondWorld = CreateWorld();
        using SceneAnimatorBridge firstBridge = new(firstWorld);
        using SceneAnimatorBridge secondBridge = new(secondWorld);
        AnimationController firstController = CreateController(out _, out _);
        AnimationController secondController = CreateController(out _, out _);
        SceneEntity firstEntity = BindEntity(firstWorld, firstBridge, firstController);
        SceneEntity secondEntity = BindEntity(secondWorld, secondBridge, secondController);

        for (int i = 0; i < 8; i++)
        {
            firstBridge.Step(0.1f);
            secondBridge.Step(0.1f);
        }

        Span<LocalTransform> firstPose = stackalloc LocalTransform[1];
        Span<Mat4> firstPalette = stackalloc Mat4[1];
        Span<LocalTransform> secondPose = stackalloc LocalTransform[1];
        Span<Mat4> secondPalette = stackalloc Mat4[1];
        firstBridge.TryCopyPose(firstEntity, firstPose, firstPalette).Should().BeTrue();
        secondBridge.TryCopyPose(secondEntity, secondPose, secondPalette).Should().BeTrue();

        firstPose[0].Should().Be(secondPose[0]);
        firstPalette[0].Should().Be(secondPalette[0]);
    }

    [Fact]
    public void SteadyStateSteppingAllocatesNothing()
    {
        using SceneWorld world = CreateWorld();
        using SceneAnimatorBridge bridge = new(world);
        AnimationController controller = CreateController(out _, out _);
        SceneEntity entity = BindEntity(world, bridge, controller);
        CountingPoseSink sink = new();
        _ = entity;

        for (int i = 0; i < 4; i++)
        {
            bridge.Step(0.016f, sink);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            bridge.Step(0.016f, sink);
        }

        long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
        allocated.Should().Be(0);
        sink.Count.Should().Be(104);
    }

    private static SceneWorld CreateWorld() =>
        new SceneProfileBuilder(new SceneProfileId(SceneStringId.FromName("test/animator")))
            .AddTransform3D()
            .AddAnimators3D()
            .Build()
            .CreateWorld();

    private static SceneEntity BindEntity(SceneWorld world, SceneAnimatorBridge bridge, AnimationController controller)
    {
        SceneEntity entity = world.CreateEntity("Animated");
        world.GetTransform3D(entity).SetPosition(Vec3.Zero);
        world.AddData(entity, SceneAnimator.Default);
        bridge.Bind(entity, controller).Should().BeTrue();
        return entity;
    }

    private static AnimationController CreateController(out ParameterStore parameters, out AnimationLayer layer)
    {
        Rig rig = CreateRig();
        parameters = new ParameterStore(Array.Empty<KeyValuePair<string, ParameterType>>());
        AnimationController controller = new(rig, parameters, new CurveLayout(new Dictionary<CurveId, int>()));
        layer = new AnimationLayer(new LayerId("base"), CreateMachine(CreateClip("move", 1.0f)));
        controller.AddLayer(layer);
        controller.BindAll();
        return controller;
    }

    private static AnimationController CreateTransitionController(out ParameterHandle go, out AnimationLayer layer)
    {
        Rig rig = CreateRig();
        ParameterStore parameters = new(new[]
        {
            new KeyValuePair<string, ParameterType>("go", ParameterType.Float),
        });
        AnimationController controller = new(rig, parameters, new CurveLayout(new Dictionary<CurveId, int>()));
        go = parameters.ResolveHandle("go");

        StateTransition transition = new(1, 0.0f, new ParameterCondition("go", ConditionOperator.GreaterThan, 0.5f));
        AnimationState first = new(new StateId("idle"), CreateClip("idle", 1.0f), transition);
        AnimationState second = new(new StateId("run"), CreateClip("run", 2.0f));
        StateMachineInstance machine = new(new[] { first, second }, Array.Empty<StateTransition>(), 0);
        layer = new AnimationLayer(new LayerId("base"), machine);
        controller.AddLayer(layer);
        controller.BindAll();
        return controller;
    }

    private static StateMachineInstance CreateMachine(ClipMotionNode motion) =>
        new(
            new[] { new AnimationState(new StateId("state"), motion) },
            Array.Empty<StateTransition>(),
            0);

    private static Rig CreateRig() =>
        new(new RigId("test-rig"), new BoneInfo { Name = "root", ParentIndex = -1 });

    private static ClipMotionNode CreateClip(string id, float duration)
    {
        AnimationChannel channel = new(
            0,
            ChannelTarget.Translation,
            InterpolationMode.Linear,
            new[] { 0.0f, duration },
            new[] { 0.0f, 0.0f, 0.0f, duration, 0.0f, 0.0f });
        AnimationClip clip = new(new ClipId(id), duration, new[] { channel });
        return new ClipMotionNode(clip);
    }

    private sealed class RecordingPoseSink : IScenePoseSink
    {
        public int Count { get; private set; }

        public SceneEntity Entity { get; private set; }

        public LocalTransform[] LocalPose { get; private set; } = [];

        public Mat4[] WorldPalette { get; private set; } = [];

        public void ApplyPose(SceneEntity entity, ReadOnlySpan<LocalTransform> localPose, ReadOnlySpan<Mat4> worldPalette)
        {
            Count++;
            Entity = entity;
            LocalPose = localPose.ToArray();
            WorldPalette = worldPalette.ToArray();
        }
    }

    private sealed class RecordingEventSink : ISceneAnimatorEventSink
    {
        public SceneEntity Entity { get; private set; }

        public List<ClipEvent> Events { get; } = [];

        public void OnClipEvent(SceneEntity entity, in ClipEvent clipEvent)
        {
            Entity = entity;
            Events.Add(clipEvent);
        }
    }

    private sealed class RecordingRootMotionConsumer : ISceneRootMotionConsumer
    {
        public SceneEntity Entity { get; private set; }

        public Vec3 Position { get; private set; }

        public Quat Rotation { get; private set; }

        public void ConsumeRootMotion(SceneEntity entity, in Vec3 deltaPosition, in Quat deltaRotation)
        {
            Entity = entity;
            Position += deltaPosition;
            Rotation = Quat.Normalize(Rotation * deltaRotation);
        }
    }

    private sealed class CountingPoseSink : IScenePoseSink
    {
        public int Count { get; private set; }

        public void ApplyPose(SceneEntity entity, ReadOnlySpan<LocalTransform> localPose, ReadOnlySpan<Mat4> worldPalette)
        {
            _ = entity;
            _ = localPose;
            _ = worldPalette;
            Count++;
        }
    }

    private sealed class ThrowingPoseSink : IScenePoseSink
    {
        private readonly SceneEntity _faultyEntity;

        public ThrowingPoseSink(SceneEntity faultyEntity) => _faultyEntity = faultyEntity;

        public void ApplyPose(SceneEntity entity, ReadOnlySpan<LocalTransform> localPose, ReadOnlySpan<Mat4> worldPalette)
        {
            _ = localPose;
            _ = worldPalette;
            if (entity == _faultyEntity)
            {
                throw new InvalidOperationException("pose sink rejected the entity");
            }
        }
    }
}
