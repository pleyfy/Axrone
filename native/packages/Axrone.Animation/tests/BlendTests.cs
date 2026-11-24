namespace Axrone.Animation.Tests;

public class BlendTests
{
    private static Rig TwoBone() => new(new RigId("r"), [
        new BoneInfo { Name = "root", ParentIndex = -1 },
        new BoneInfo { Name = "child", ParentIndex = 0, RestTranslation = new Vec3(0.0f, 1.0f, 0.0f) },
    ]);

    private static Dictionary<CurveId, int> NoCurves() => new();

    private static AnimationFrame Pose(float x, float qy = 0.0f)
    {
        var frame = new AnimationFrame(2, NoCurves());
        frame.GetTranslations()[1] = new Vec3(x, 0.0f, 0.0f);
        frame.GetRotations()[0] = Quat.Identity;
        frame.GetRotations()[1] = new Quat(0.0f, qy, 0.0f, MathF.Sqrt(MathF.Max(0.0f, 1.0f - (qy * qy))));
        frame.GetScales()[0] = Vec3.One;
        frame.GetScales()[1] = Vec3.One;
        return frame;
    }

    [Fact]
    public void ForwardKinematics_ComposesChain()
    {
        Rig rig = TwoBone();
        AnimationFrame local = Pose(0.0f);
        Span<Vec3> worldT = stackalloc Vec3[2];
        Span<Quat> worldR = stackalloc Quat[2];
        Span<Vec3> worldS = stackalloc Vec3[2];
        local.GetScales()[0] = Vec3.One;
        local.GetScales()[1] = Vec3.One;

        BlendingKernels.ForwardKinematics(rig, local, worldT, worldR, worldS);
        worldT[0].Should().Be(Vec3.Zero);
        worldT[1].Should().Be(Vec3.Zero);

        local.GetTranslations()[1] = new Vec3(0.0f, 1.0f, 0.0f);
        BlendingKernels.ForwardKinematics(rig, local, worldT, worldR, worldS);
        worldT[1].Y.Should().BeApproximately(1.0f, 1e-6f);
    }

    [Fact]
    public void BlendFrame_MidpointAndExtremes()
    {
        var target = new AnimationFrame(2, NoCurves());
        AnimationFrame baseFrame = Pose(0.0f);
        AnimationFrame overlay = Pose(10.0f);

        BlendingKernels.BlendFrame(target, baseFrame, overlay, 0.0f);
        target.ReadTranslations()[1].X.Should().Be(0.0f);

        BlendingKernels.BlendFrame(target, baseFrame, overlay, 1.0f);
        target.ReadTranslations()[1].X.Should().Be(10.0f);

        BlendingKernels.BlendFrame(target, baseFrame, overlay, 0.25f);
        target.ReadTranslations()[1].X.Should().BeApproximately(2.5f, 1e-6f);
    }

    [Fact]
    public void BlendFrame_MaskHoldsDisabledBones()
    {
        var target = new AnimationFrame(2, NoCurves());
        AnimationFrame baseFrame = Pose(0.0f);
        AnimationFrame overlay = Pose(10.0f);
        var mask = new AnimationMask(2, enableAll: false);
        mask.Set(1, true);

        BlendingKernels.BlendFrame(target, baseFrame, overlay, 0.5f, mask);
        target.ReadTranslations()[0].Should().Be(Vec3.Zero);
        target.ReadTranslations()[1].X.Should().BeApproximately(5.0f, 1e-6f);
    }

    [Fact]
    public void BlendWeightedFrames_Averages()
    {
        Rig rig = TwoBone();
        var target = new AnimationFrame(2, NoCurves());
        AnimationFrame[] frames = [Pose(0.0f), Pose(10.0f)];
        float[] weights = [0.25f, 0.75f];

        BlendingKernels.BlendWeightedFrames(target, frames, weights, rig);
        target.ReadTranslations()[1].X.Should().BeApproximately(7.5f, 1e-5f);
    }

    [Fact]
    public void BlendWeightedFrames_ZeroFallsBackToRest()
    {
        Rig rig = TwoBone();
        var target = new AnimationFrame(2, NoCurves());
        AnimationFrame[] frames = [Pose(5.0f)];
        float[] weights = [0.0f];

        BlendingKernels.BlendWeightedFrames(target, frames, weights, rig);
        target.ReadTranslations()[1].Should().Be(new Vec3(0.0f, 1.0f, 0.0f));
    }

    [Fact]
    public void AdditiveFrame_MaskHoldsDisabledBones()
    {
        Rig rig = TwoBone();
        var target = new AnimationFrame(2, NoCurves());
        AnimationFrame baseFrame = Pose(0.0f);
        AnimationFrame additive = Pose(10.0f);
        target.CopyFrom(baseFrame);
        var mask = new AnimationMask(2, enableAll: false);
        mask.Set(0, true);

        BlendingKernels.ApplyAdditiveFrame(target, baseFrame, additive, rig, 1.0f, mask);

        target.ReadTranslations()[0].Should().Be(baseFrame.ReadTranslations()[0]);
        target.ReadTranslations()[1].Should().Be(baseFrame.ReadTranslations()[1]);
    }

    [Fact]
    public void AdditiveFrame_UsesCapturedReferencePose()
    {
        Rig rig = TwoBone();
        var target = new AnimationFrame(2, NoCurves());
        AnimationFrame baseFrame = Pose(0.0f);
        AnimationFrame additive = Pose(10.0f);
        AnimationFrame reference = Pose(10.0f);
        target.CopyFrom(baseFrame);

        BlendingKernels.ApplyAdditiveFrame(target, baseFrame, additive, rig, 1.0f, null, reference);

        target.ReadTranslations()[1].X.Should().Be(0.0f);
    }

    [Fact]
    public void AdditiveFrame_AddsRestRelativeDelta()
    {
        Rig rig = TwoBone();
        var target = new AnimationFrame(2, NoCurves());
        AnimationFrame baseFrame = Pose(0.0f);
        AnimationFrame additive = Pose(0.0f);
        additive.GetTranslations()[1] = new Vec3(0.0f, 2.0f, 0.0f);

        BlendingKernels.ApplyAdditiveFrame(target, baseFrame, additive, rig, 0.5f);
        target.ReadTranslations()[1].Y.Should().BeApproximately(0.5f, 1e-5f);
    }
}
