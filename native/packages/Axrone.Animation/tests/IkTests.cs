namespace Axrone.Animation.Tests;

public class IkTests
{
    private static Rig Arm() => new(new RigId("arm"), [
        new BoneInfo { Name = "shoulder", ParentIndex = -1 },
        new BoneInfo { Name = "elbow", ParentIndex = 0, RestTranslation = new Vec3(1.0f, 0.0f, 0.0f) },
        new BoneInfo { Name = "wrist", ParentIndex = 1, RestTranslation = new Vec3(1.0f, 0.0f, 0.0f) },
    ]);

    private static Dictionary<CurveId, int> NoCurves() => new();

    private static AnimationFrame RestFrame(Rig rig)
    {
        var frame = new AnimationFrame(rig.BoneCount, NoCurves());
        frame.ResetToRest(rig);
        return frame;
    }

    private static Vec3 TipWorld(Rig rig, AnimationFrame frame, int tip)
    {
        Span<Vec3> worldT = stackalloc Vec3[rig.BoneCount];
        Span<Quat> worldR = stackalloc Quat[rig.BoneCount];
        Span<Vec3> worldS = stackalloc Vec3[rig.BoneCount];
        BlendingKernels.ForwardKinematics(rig, frame, worldT, worldR, worldS);
        return worldT[tip];
    }

    [Fact]
    public void Fabrik_ReachesTarget()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        Span<Vec3> scratch = stackalloc Vec3[3];
        int[] chain = [0, 1, 2];

        IkSolvers.SolveFabrik(rig, frame, chain, new Vec3(1.0f, 1.0f, 0.0f), scratch, maxIterations: 50);
        Vec3 tip = TipWorld(rig, frame, 2);
        Vec3.Distance(tip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f);
    }

    [Fact]
    public void Fabrik_StretchesTowardUnreachable()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        Span<Vec3> scratch = stackalloc Vec3[3];
        int[] chain = [0, 1, 2];

        IkSolvers.SolveFabrik(rig, frame, chain, new Vec3(10.0f, 0.0f, 0.0f), scratch, maxIterations: 10);
        Vec3 tip = TipWorld(rig, frame, 2);
        tip.X.Should().BeGreaterThan(1.5f);
        tip.Y.Should().BeApproximately(0.0f, 1e-4f);
    }

    [Fact]
    public void Fabrik_ReachesDiagonalTargetWithBothJoints()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        Span<Vec3> scratch = stackalloc Vec3[3];
        int[] chain = [0, 1, 2];

        IkSolvers.SolveFabrik(rig, frame, chain, new Vec3(0.0f, 1.0f, 0.0f), scratch, maxIterations: 50);
        Vec3 tip = TipWorld(rig, frame, 2);
        Vec3.Distance(tip, new Vec3(0.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f);
    }

    [Fact]
    public void Fabrik_ZeroWeightHoldsStill()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        Span<Vec3> scratch = stackalloc Vec3[3];
        int[] chain = [0, 1, 2];

        IkSolvers.SolveFabrik(rig, frame, chain, new Vec3(1.0f, 1.0f, 0.0f), scratch, weight: 0.0f);
        TipWorld(rig, frame, 2).Should().Be(new Vec3(2.0f, 0.0f, 0.0f));

        AnimationFrame negative = RestFrame(rig);
        IkSolvers.SolveFabrik(rig, negative, chain, new Vec3(1.0f, 1.0f, 0.0f), scratch, weight: -1.0f);
        TipWorld(rig, negative, 2).Should().Be(new Vec3(2.0f, 0.0f, 0.0f));
    }

    [Fact]
    public void Fabrik_WeightBlendsCorrection()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        Span<Vec3> scratch = stackalloc Vec3[3];
        int[] chain = [0, 1, 2];

        IkSolvers.SolveFabrik(rig, frame, chain, new Vec3(1.0f, 1.0f, 0.0f), scratch, maxIterations: 50, weight: 0.5f);
        Vec3 tip = TipWorld(rig, frame, 2);
        Vec3.Distance(tip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeGreaterThan(0.05f);
        Vec3.Distance(tip, new Vec3(2.0f, 0.0f, 0.0f)).Should().BeGreaterThan(0.05f);
    }

    [Fact]
    public void Ccd_ReachesTargetWithWeight()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        int[] chain = [0, 1, 2];

        IkSolvers.SolveCcd(rig, frame, chain, new Vec3(1.0f, 1.0f, 0.0f), weight: 1.0f, maxIterations: 100);
        Vec3 tip = TipWorld(rig, frame, 2);
        Vec3.Distance(tip, new Vec3(1.0f, 1.0f, 0.0f)).Should().BeLessThan(0.05f);
    }

    [Fact]
    public void Ccd_ZeroWeightHoldsStill()
    {
        Rig rig = Arm();
        AnimationFrame frame = RestFrame(rig);
        int[] chain = [0, 1, 2];

        IkSolvers.SolveCcd(rig, frame, chain, new Vec3(1.0f, 1.0f, 0.0f), weight: 0.0f);
        TipWorld(rig, frame, 2).Should().Be(new Vec3(2.0f, 0.0f, 0.0f));
    }
}
