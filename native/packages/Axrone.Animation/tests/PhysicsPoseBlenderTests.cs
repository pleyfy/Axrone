namespace Axrone.Animation.Tests;

public class PhysicsPoseBlenderTests
{
    private static Rig TwoBone() => new(new RigId("physics-pose"), [
        new BoneInfo { Name = "root", ParentIndex = -1 },
        new BoneInfo { Name = "child", ParentIndex = 0, RestTranslation = new Vec3(0.0f, 1.0f, 0.0f) },
    ]);

    private static AnimationFrame Rest(Rig rig)
    {
        var frame = new AnimationFrame(rig.BoneCount, new CurveLayout(new Dictionary<CurveId, int>()));
        frame.ResetToRest(rig);
        return frame;
    }

    [Fact]
    public void BlendWorldPose_ConvertsToLocalSpace()
    {
        Rig rig = TwoBone();
        AnimationFrame frame = Rest(rig);
        Vec3[] positions = [new Vec3(1.0f, 0.0f, 0.0f), new Vec3(1.0f, 2.0f, 0.0f)];
        Quat[] rotations = [Quat.Identity, Quat.Identity];

        PhysicsPoseBlender.BlendWorldPose(rig, frame, positions, rotations);

        frame.ReadTranslations()[0].Should().Be(new Vec3(1.0f, 0.0f, 0.0f));
        frame.ReadTranslations()[1].Should().Be(new Vec3(0.0f, 2.0f, 0.0f));
        frame.ReadRotations()[1].Should().Be(Quat.Identity);
    }

    [Fact]
    public void BlendWorldPose_RemovesParentRotation()
    {
        Rig rig = TwoBone();
        AnimationFrame frame = Rest(rig);
        Quat rootRotation = Quat.CreateFromAxisAngle(Vec3.UnitZ, MathF.PI * 0.5f);
        Vec3[] positions = [new Vec3(1.0f, 0.0f, 0.0f), new Vec3(-1.0f, 0.0f, 0.0f)];
        Quat[] rotations = [rootRotation, rootRotation];

        PhysicsPoseBlender.BlendWorldPose(rig, frame, positions, rotations);

        frame.ReadTranslations()[1].X.Should().BeApproximately(0.0f, 1e-4f);
        frame.ReadTranslations()[1].Y.Should().BeApproximately(2.0f, 1e-4f);
        MathF.Abs(Quat.Dot(frame.ReadRotations()[1], Quat.Identity)).Should().BeApproximately(1.0f, 1e-4f);
    }

    [Fact]
    public void BlendWorldPose_WeightBlendsWithAnimation()
    {
        Rig rig = TwoBone();
        AnimationFrame frame = Rest(rig);
        Vec3[] positions = [new Vec3(2.0f, 0.0f, 0.0f), new Vec3(2.0f, 1.0f, 0.0f)];
        Quat[] rotations = [Quat.Identity, Quat.Identity];

        PhysicsPoseBlender.BlendWorldPose(rig, frame, positions, rotations, weight: 0.25f);

        frame.ReadTranslations()[0].X.Should().BeApproximately(0.5f, 1e-4f);
        frame.ReadTranslations()[1].X.Should().BeApproximately(0.0f, 1e-4f);
    }

    [Fact]
    public void BlendWorldPose_RejectsMismatchedSpans()
    {
        Rig rig = TwoBone();
        AnimationFrame frame = Rest(rig);

        Action blend = () => PhysicsPoseBlender.BlendWorldPose(
            rig,
            frame,
            [Vec3.Zero],
            [Quat.Identity, Quat.Identity]);

        blend.Should().Throw<ValidationException>();
    }
}
