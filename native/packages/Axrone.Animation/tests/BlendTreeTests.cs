namespace Axrone.Animation.Tests;

public class BlendTreeTests
{
    private static Rig TwoBone() => new(new RigId("r"), [
        new BoneInfo { Name = "root", ParentIndex = -1 },
        new BoneInfo { Name = "child", ParentIndex = 0 },
    ]);

    private static Dictionary<CurveId, int> NoCurves() => new();

    private static Dictionary<string, ParameterType> Params() => new()
    {
        ["speed"] = ParameterType.Float,
        ["aimX"] = ParameterType.Float,
        ["aimY"] = ParameterType.Float,
        ["fire"] = ParameterType.Float,
        ["addW"] = ParameterType.Float,
    };

    private static AnimationClip SlideClip(float fromX, float toX) => new(
        new ClipId($"slide-{fromX}-{toX}"), 1.0f,
        [new AnimationChannel(1, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [fromX, 0.0f, 0.0f, toX, 0.0f, 0.0f])]);

    [Fact]
    public void ClipNode_HonorsTimeScale()
    {
        Rig rig = TwoBone();
        var clip = SlideClip(0.0f, 10.0f);
        var node = new ClipMotionNode(clip) { TimeScale = 2.0f };
        node.GetDuration().Should().BeApproximately(0.5f, 1e-6f);

        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves());
        var parameters = new ParameterStore(Params());
        node.Evaluate(0.25f, frame, arena, rig, parameters, 0);
        frame.ReadTranslations()[1].X.Should().BeApproximately(5.0f, 1e-5f);
    }

    [Fact]
    public void ClipNode_RootDeltaWrapsCorrectly()
    {
        Rig rig = TwoBone();
        var clip = new AnimationClip(
            new ClipId("loop"), 1.0f,
            [
                new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 4.0f, 0.0f, 0.0f]),
                new AnimationChannel(0, ChannelTarget.Rotation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 1.0f]),
            ]);
        var node = new ClipMotionNode(clip);
        node.ComputeRootDelta(0.75f, 0.25f, rig, out Vec3 delta, out _);
        delta.X.Should().BeApproximately(2.0f, 1e-4f);
    }

    [Fact]
    public void ClipNode_RootDeltaUsesLocalRotationOrder()
    {
        Rig rig = TwoBone();
        Quat q0 = Quat.CreateFromAxisAngle(Vec3.UnitX, 1.1f);
        Quat q1 = Quat.CreateFromAxisAngle(Vec3.UnitY, 0.9f);
        var clip = new AnimationClip(
            new ClipId("turn"), 1.0f,
            [new AnimationChannel(0, ChannelTarget.Rotation, InterpolationMode.Linear, [0.0f, 1.0f],
                [q0.X, q0.Y, q0.Z, q0.W, q1.X, q1.Y, q1.Z, q1.W])]);
        var node = new ClipMotionNode(clip) { IsLooping = false };

        node.ComputeRootDelta(0.0f, 1.0f, rig, out _, out Quat delta);

        Quat expected = Quat.Normalize(Quat.Inverse(q0) * q1);
        MathF.Abs(Quat.Dot(delta, expected)).Should().BeApproximately(1.0f, 1e-5f);
    }

    [Fact]
    public void ClipNode_ClearsLanesMissingFromClip()
    {
        Rig rig = TwoBone();
        var clip = new AnimationClip(
            new ClipId("partial"), 1.0f,
            [new AnimationChannel(1, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 4.0f, 0.0f, 0.0f])]);
        var node = new ClipMotionNode(clip);
        var frame = new AnimationFrame(2, NoCurves());
        frame.GetTranslations()[0] = new Vec3(9.0f, 0.0f, 0.0f);

        node.Evaluate(0.5f, frame, new FrameArena(2, NoCurves(), capacity: 4), rig, new ParameterStore(Params()), 0);

        frame.ReadTranslations()[0].Should().Be(Vec3.Zero);
    }

    [Fact]
    public void Blend1D_SelectsAndBlends()
    {
        Rig rig = TwoBone();
        var node = new Blend1DMotionNode("speed", [
            (0.0f, (MotionNode)new ClipMotionNode(SlideClip(0.0f, 0.0f))),
            ((float)10.0, (MotionNode)new ClipMotionNode(SlideClip(0.0f, 10.0f))),
        ]);

        node.FindSegment(-5.0f).Should().Be(new Blend1DSegment(0, 0, 1.0f));
        node.FindSegment(25.0f).Should().Be(new Blend1DSegment(1, 1, 1.0f));
        Blend1DSegment mid = node.FindSegment(2.5f);
        mid.Index0.Should().Be(0);
        mid.Index1.Should().Be(1);
        mid.Weight.Should().BeApproximately(0.25f, 1e-6f);

        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 8);
        var parameters = new ParameterStore(Params());
        parameters.SetFloat("speed", 5.0f);
        node.Evaluate(0.5f, frame, arena, rig, parameters, 0);
        frame.ReadTranslations()[1].X.Should().BeApproximately(2.5f, 1e-4f);
    }

    [Fact]
    public void Blend1D_UsesSegmentDurationAndRootDelta()
    {
        Rig rig = TwoBone();
        var slow = new AnimationClip(
            new ClipId("slow"), 2.0f,
            [new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 2.0f], [0.0f, 0.0f, 0.0f, 2.0f, 0.0f, 0.0f])]);
        var fast = new AnimationClip(
            new ClipId("fast"), 1.0f,
            [new AnimationChannel(0, ChannelTarget.Translation, InterpolationMode.Linear, [0.0f, 1.0f], [0.0f, 0.0f, 0.0f, 4.0f, 0.0f, 0.0f])]);
        var node = new Blend1DMotionNode("speed", [
            (0.0f, (MotionNode)new ClipMotionNode(slow) { IsLooping = false }),
            (10.0f, (MotionNode)new ClipMotionNode(fast) { IsLooping = false }),
        ]);
        var parameters = new ParameterStore(Params());
        parameters.SetFloat("speed", 5.0f);

        node.GetDuration(parameters).Should().BeApproximately(1.5f, 1e-5f);
        node.ComputeRootDelta(0.0f, 0.5f, rig, parameters, out Vec3 delta, out _);
        delta.X.Should().BeApproximately(1.5f, 1e-4f);
    }

    [Fact]
    public void Blend1D_RejectsEmptyChildren()
    {
        Action build = () => { _ = new Blend1DMotionNode("speed", []); };
        build.Should().Throw<CompilationException>();
    }

    [Fact]
    public void Blend2D_ExactHitShortCircuits()
    {
        Rig rig = TwoBone();
        var node = new Blend2DMotionNode("aimX", "aimY", [
            (new Vec2(0.0f, 0.0f), (MotionNode)new ClipMotionNode(SlideClip(1.0f, 1.0f))),
            (new Vec2(1.0f, 0.0f), (MotionNode)new ClipMotionNode(SlideClip(2.0f, 2.0f))),
        ]);

        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 8);
        var parameters = new ParameterStore(Params());
        parameters.SetFloat("aimX", 1.0f);
        parameters.SetFloat("aimY", 0.0f);
        node.Evaluate(1.0f, frame, arena, rig, parameters, 0);
        frame.ReadTranslations()[1].X.Should().BeApproximately(2.0f, 1e-5f);
    }

    [Fact]
    public void Blend2D_FreeformInterpolatesInsideHull()
    {
        Rig rig = TwoBone();
        var node = new Blend2DMotionNode(
            "aimX",
            "aimY",
            [
                (new Vec2(0.0f, 0.0f), (MotionNode)new ClipMotionNode(SlideClip(0.0f, 0.0f)) { IsLooping = false }),
                (new Vec2(1.0f, 0.0f), (MotionNode)new ClipMotionNode(SlideClip(0.0f, 4.0f)) { IsLooping = false }),
                (new Vec2(0.0f, 1.0f), (MotionNode)new ClipMotionNode(SlideClip(0.0f, 8.0f)) { IsLooping = false }),
                (new Vec2(1.0f, 1.0f), (MotionNode)new ClipMotionNode(SlideClip(0.0f, 12.0f)) { IsLooping = false }),
            ],
            Blend2DMode.Freeform);

        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 8);
        var parameters = new ParameterStore(Params());
        parameters.SetFloat("aimX", 0.5f);
        parameters.SetFloat("aimY", 0.5f);

        node.Evaluate(1.0f, frame, arena, rig, parameters, 0);

        frame.ReadTranslations()[1].X.Should().BeApproximately(6.0f, 1e-4f);
    }

    [Fact]
    public void Blend2D_FreeformRejectsDuplicatePoints()
    {
        Action build = () => _ = new Blend2DMotionNode(
            "aimX",
            "aimY",
            [
                (new Vec2(0.0f, 0.0f), (MotionNode)new ClipMotionNode(SlideClip(0.0f, 0.0f))),
                (new Vec2(0.0f, 0.0f), (MotionNode)new ClipMotionNode(SlideClip(1.0f, 1.0f))),
                (new Vec2(1.0f, 1.0f), (MotionNode)new ClipMotionNode(SlideClip(2.0f, 2.0f))),
            ],
            Blend2DMode.Freeform);

        build.Should().Throw<CompilationException>()
            .Where(e => e.Code == AnimationErrorCode.CompilationBlendDegenerate);
    }

    [Fact]
    public void Direct_SingleActiveFastPath()
    {
        Rig rig = TwoBone();
        var node = new DirectMotionNode([
            ("fire", (MotionNode)new ClipMotionNode(SlideClip(9.0f, 9.0f))),
            ("idle", (MotionNode)new ClipMotionNode(SlideClip(1.0f, 1.0f))),
        ]);

        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 8);
        var store = new ParameterStore(new Dictionary<string, ParameterType> { ["fire"] = ParameterType.Float, ["idle"] = ParameterType.Float });
        store.SetFloat("fire", 1.0f);
        node.Evaluate(1.0f, frame, arena, rig, store, 0);
        frame.ReadTranslations()[1].X.Should().BeApproximately(9.0f, 1e-5f);

        store.SetFloat("fire", 0.0f);
        store.SetFloat("idle", 0.0f);
        node.Evaluate(1.0f, frame, arena, rig, store, 0);
        frame.ReadTranslations()[1].Should().Be(Vec3.Zero);
    }

    [Fact]
    public void Additive_ZeroWeightSkipsOverlay()
    {
        Rig rig = TwoBone();
        var node = new AdditiveMotionNode(
            new ClipMotionNode(SlideClip(4.0f, 4.0f)),
            new ClipMotionNode(SlideClip(100.0f, 100.0f)),
            "addW");

        var frame = new AnimationFrame(2, NoCurves());
        var arena = new FrameArena(2, NoCurves(), capacity: 8);
        var parameters = new ParameterStore(Params());
        parameters.SetFloat("addW", 0.0f);
        node.Evaluate(1.0f, frame, arena, rig, parameters, 0);
        frame.ReadTranslations()[1].X.Should().BeApproximately(4.0f, 1e-5f);
    }
}
