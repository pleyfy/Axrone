namespace Axrone.Animation.Tests;

public class IkLayerTests
{
    private static Rig Arm() => new(new RigId("arm"), [
        new BoneInfo { Name = "shoulder", ParentIndex = -1 },
        new BoneInfo { Name = "elbow", ParentIndex = 0, RestTranslation = new Vec3(1.0f, 0.0f, 0.0f) },
        new BoneInfo { Name = "wrist", ParentIndex = 1, RestTranslation = new Vec3(1.0f, 0.0f, 0.0f) },
    ]);

    private static Rig ArmWithGoal() => new(new RigId("arm-goal"), [
        new BoneInfo { Name = "shoulder", ParentIndex = -1 },
        new BoneInfo { Name = "elbow", ParentIndex = 0, RestTranslation = new Vec3(1.0f, 0.0f, 0.0f) },
        new BoneInfo { Name = "wrist", ParentIndex = 1, RestTranslation = new Vec3(1.0f, 0.0f, 0.0f) },
        new BoneInfo { Name = "goal", ParentIndex = -1, RestTranslation = new Vec3(0.0f, 1.0f, 0.0f) },
    ]);

    private static AnimationFrame RestFrame(Rig rig)
    {
        var frame = new AnimationFrame(rig.BoneCount, new CurveLayout(new Dictionary<CurveId, int>()));
        frame.ResetToRest(rig);
        return frame;
    }

    private static (Vec3 Position, Quat Rotation) TipWorld(Rig rig, AnimationFrame frame, int tip)
    {
        Span<Vec3> worldT = stackalloc Vec3[rig.BoneCount];
        Span<Quat> worldR = stackalloc Quat[rig.BoneCount];
        Span<Vec3> worldS = stackalloc Vec3[rig.BoneCount];
        BlendingKernels.ForwardKinematics(rig, frame, worldT, worldR, worldS);
        return (worldT[tip], worldR[tip]);
    }

    private static AnimationIkLayer ReachLayer(Rig rig, Vec3 target, float weight = 1.0f, IkSolverKind solver = IkSolverKind.Fabrik) =>
        new(rig, "reach", [
            new AnimationIkJob(
                new IkJobId("wrist"),
                "shoulder",
                "wrist",
                solver,
                TargetPosition: target,
                MaxIterations: 50),
        ], weight);

    [Fact]
    public void FabrikJob_ReachesWorldTarget()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        AnimationIkLayer layer = ReachLayer(rig, new Vec3(1.0f, 1.0f, 0.0f));

        layer.Apply(frame);

        Vec3 tip = TipWorld(rig, frame, 2).Position;
        Vec3.Distance(tip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f);
    }

    [Fact]
    public void CcdJob_ReachesWorldTarget()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        AnimationIkLayer layer = ReachLayer(rig, new Vec3(1.0f, 1.0f, 0.0f), solver: IkSolverKind.Ccd);

        layer.Apply(frame);

        Vec3 tip = TipWorld(rig, frame, 2).Position;
        Vec3.Distance(tip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f);
    }

    [Fact]
    public void LayerWeightAndJobWeight_ScaleCorrection()
    {
        Rig rig = Arm();
        AnimationFrame zeroLayer = RestFrame(rig);
        ReachLayer(rig, new Vec3(1.0f, 1.0f, 0.0f), weight: 0.0f).Apply(zeroLayer);
        TipWorld(rig, zeroLayer, 2).Position.Should().Be(new Vec3(2.0f, 0.0f, 0.0f));

        AnimationFrame negativeLayer = RestFrame(rig);
        ReachLayer(rig, new Vec3(1.0f, 1.0f, 0.0f)).Apply(negativeLayer, -1.0f);
        TipWorld(rig, negativeLayer, 2).Position.Should().Be(new Vec3(2.0f, 0.0f, 0.0f));

        AnimationFrame zeroJob = RestFrame(rig);
        var job = new AnimationIkJob(new IkJobId("j"), "shoulder", "wrist", TargetPosition: new Vec3(1.0f, 1.0f, 0.0f), Weight: 0.0f);
        new AnimationIkLayer(rig, "zero-job", [job]).Apply(zeroJob);
        TipWorld(rig, zeroJob, 2).Position.Should().Be(new Vec3(2.0f, 0.0f, 0.0f));

        AnimationFrame half = RestFrame(rig);
        ReachLayer(rig, new Vec3(1.0f, 1.0f, 0.0f), weight: 0.5f).Apply(half);
        Vec3 halfTip = TipWorld(rig, half, 2).Position;
        Vec3.Distance(halfTip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeGreaterThan(0.05f);
        Vec3.Distance(halfTip, new Vec3(2.0f, 0.0f, 0.0f)).Should().BeGreaterThan(0.05f);
    }

    [Fact]
    public void TargetBone_DrivesTargetFromPose()
    {
        Rig rig = ArmWithGoal();
        AnimationFrame frame = RestFrame(rig);
        var job = new AnimationIkJob(new IkJobId("hand"), "shoulder", "wrist", TargetBone: "goal", MaxIterations: 50);
        var layer = new AnimationIkLayer(rig, "track", [job]);

        layer.Apply(frame);
        Vec3 tip = TipWorld(rig, frame, 2).Position;
        Vec3.Distance(tip, new Vec3(0.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f, $"tip was {tip}");

        frame.GetTranslations()[3] = new Vec3(1.0f, 1.0f, 0.0f);
        layer.Apply(frame);
        Vec3 movedTip = TipWorld(rig, frame, 2).Position;
        Vec3.Distance(movedTip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f);
    }

    [Fact]
    public void PreserveTipRotation_AlignsTipOnlyWhenRequested()
    {
        Rig rig = Arm();
        Quat targetRotation = Quat.CreateFromAxisAngle(Vec3.UnitZ, MathF.PI * 0.5f);

        AnimationFrame aligned = RestFrame(rig);
        var alignedJob = new AnimationIkJob(
            new IkJobId("hand"),
            "shoulder",
            "wrist",
            TargetPosition: new Vec3(2.0f, 0.0f, 0.0f),
            TargetRotation: targetRotation,
            PreserveTipRotation: true);
        new AnimationIkLayer(rig, "aligned", [alignedJob]).Apply(aligned);
        Quat worldRotation = TipWorld(rig, aligned, 2).Rotation;
        MathF.Abs(Quat.Dot(worldRotation, targetRotation)).Should().BeApproximately(1.0f, 1e-4f);

        AnimationFrame untouched = RestFrame(rig);
        var plainJob = alignedJob with { PreserveTipRotation = false };
        new AnimationIkLayer(rig, "plain", [plainJob]).Apply(untouched);
        TipWorld(rig, untouched, 2).Rotation.Should().Be(Quat.Identity);
    }

    [Fact]
    public void SetTarget_UpdatesCompiledPositionAndRotation()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        AnimationIkLayer layer = ReachLayer(rig, new Vec3(10.0f, 0.0f, 0.0f));

        layer.SetTarget(new IkJobId("wrist"), new Vec3(1.0f, 1.0f, 0.0f));
        layer.Apply(frame);

        Vec3 tip = TipWorld(rig, frame, 2).Position;
        Vec3.Distance(tip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f);
    }

    [Fact]
    public void UnknownJob_ThrowsTargetNotFound()
    {
        Rig rig = Arm();
        AnimationIkLayer layer = ReachLayer(rig, Vec3.Zero);

        Action setTarget = () => layer.SetTarget(new IkJobId("missing"), Vec3.Zero);
        setTarget.Should().Throw<IkException>()
            .Which.Code.Should().Be(AnimationErrorCode.IkTargetNotFound);
    }

    [Fact]
    public void UnknownBone_ThrowsTargetNotFound()
    {
        Rig rig = Arm();
        Action create = () =>
        {
            _ = new AnimationIkLayer(rig, "bad", [
                new AnimationIkJob(new IkJobId("j"), "missing", "wrist"),
            ]);
        };

        create.Should().Throw<IkException>()
            .Which.Code.Should().Be(AnimationErrorCode.IkTargetNotFound);
    }

    [Fact]
    public void NonAncestorRoot_ThrowsValidation()
    {
        Rig rig = Arm();
        Action create = () =>
        {
            _ = new AnimationIkLayer(rig, "bad", [
                new AnimationIkJob(new IkJobId("j"), "wrist", "shoulder"),
            ]);
        };

        create.Should().Throw<ValidationException>()
            .Which.Code.Should().Be(AnimationErrorCode.ValidationInvalidArgument);
    }

    [Fact]
    public void DuplicateJobIdOrEmptyLayerId_ThrowsValidation()
    {
        Rig rig = Arm();
        var job = new AnimationIkJob(new IkJobId("same"), "shoulder", "wrist");

        Action duplicates = () => { _ = new AnimationIkLayer(rig, "dup", [job, job]); };
        duplicates.Should().Throw<ValidationException>()
            .Which.Code.Should().Be(AnimationErrorCode.ValidationInvalidArgument);

        Action emptyId = () => { _ = new AnimationIkLayer(rig, string.Empty, [job]); };
        emptyId.Should().Throw<ValidationException>()
            .Which.Code.Should().Be(AnimationErrorCode.ValidationInvalidArgument);

        Action nonFiniteWeight = () => { _ = new AnimationIkLayer(rig, "weight", [job], float.NaN); };
        nonFiniteWeight.Should().Throw<ValidationException>()
            .Which.Code.Should().Be(AnimationErrorCode.ValidationInvalidArgument);
    }

    [Fact]
    public void Apply_ForeignBoneCount_ThrowsValidation()
    {
        Rig rig = Arm();
        AnimationIkLayer layer = ReachLayer(rig, Vec3.Zero);
        var twoBoneRig = new Rig(new RigId("two"), [
            new BoneInfo { Name = "a", ParentIndex = -1 },
            new BoneInfo { Name = "b", ParentIndex = 0 },
        ]);
        AnimationFrame frame = RestFrame(twoBoneRig);

        Action apply = () => layer.Apply(frame);
        apply.Should().Throw<ValidationException>()
            .Which.Code.Should().Be(AnimationErrorCode.ValidationInvalidArgument);
    }

    [Fact]
    public void Controller_AppliesLayerIkAfterEvaluation()
    {
        Rig rig = Arm();
        var parameters = new ParameterStore(Array.Empty<KeyValuePair<string, ParameterType>>());
        var curves = new CurveLayout(new Dictionary<CurveId, int>());
        using var controller = new AnimationController(rig, parameters, curves);
        var clip = new AnimationClip(new ClipId("rest"), 1.0f, []);
        var idle = new AnimationState(new StateId("idle"), new ClipMotionNode(clip));
        var layer = new AnimationLayer(new LayerId("base"), new StateMachineInstance([idle], [], 0));
        layer.AddIkLayer(ReachLayer(rig, new Vec3(1.0f, 1.0f, 0.0f)));
        controller.AddLayer(layer);

        var events = new List<ClipEvent>();
        controller.Update(0.5f, events, out _, out _);

        Vec3 tip = TipWorld(rig, controller.CurrentFrame, 2).Position;
        Vec3.Distance(tip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f);
    }

    [Fact]
    public void WarmApply_AllocatesNothing()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        AnimationIkLayer layer = ReachLayer(rig, new Vec3(1.0f, 1.0f, 0.0f));

        layer.Apply(frame);
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 100; i++)
        {
            layer.Apply(frame);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }
}
