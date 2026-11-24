namespace Axrone.Animation.Tests;

public class AimSolverTests
{
    private static Rig OneBone() => new(new RigId("aim"), [
        new BoneInfo { Name = "head", ParentIndex = -1 },
    ]);

    private static AnimationFrame Rest(Rig rig)
    {
        var frame = new AnimationFrame(rig.BoneCount, new CurveLayout(new Dictionary<CurveId, int>()));
        frame.ResetToRest(rig);
        return frame;
    }

    private static (Vec3 Forward, Vec3 Up) Axes(Rig rig, AnimationFrame frame)
    {
        Span<Vec3> worldT = stackalloc Vec3[rig.BoneCount];
        Span<Quat> worldR = stackalloc Quat[rig.BoneCount];
        Span<Vec3> worldS = stackalloc Vec3[rig.BoneCount];
        BlendingKernels.ForwardKinematics(rig, frame, worldT, worldR, worldS);
        return (Vec3.Normalize(worldR[0] * Vec3.UnitZ), Vec3.Normalize(worldR[0] * Vec3.UnitY));
    }

    [Fact]
    public void AimPointsForwardAtTarget()
    {
        Rig rig = OneBone();
        AnimationFrame frame = Rest(rig);

        bool solved = AimSolver.Solve(rig, frame, 0, new Vec3(1.0f, 0.0f, 0.0f), Vec3.UnitY);

        solved.Should().BeTrue();
        Vec3.Dot(Axes(rig, frame).Forward, Vec3.UnitX).Should().BeApproximately(1.0f, 1e-4f);
    }

    [Fact]
    public void AimRespectsMaximumTurn()
    {
        Rig rig = OneBone();
        AnimationFrame frame = Rest(rig);

        AimSolver.Solve(
            rig,
            frame,
            0,
            new Vec3(1.0f, 0.0f, 0.0f),
            Vec3.UnitY,
            maxAngleRadians: 30.0f * MathF.PI / 180.0f);

        Vec3 forward = Axes(rig, frame).Forward;
        Vec3.Dot(forward, Vec3.UnitX).Should().BeApproximately(0.5f, 1e-4f);
        Vec3.Dot(forward, Vec3.UnitZ).Should().BeApproximately(0.866f, 1e-3f);
    }

    [Fact]
    public void AimWeightBlendsTheTurn()
    {
        Rig rig = OneBone();
        AnimationFrame frame = Rest(rig);

        AimSolver.Solve(rig, frame, 0, new Vec3(1.0f, 0.0f, 0.0f), Vec3.UnitY, weight: 0.5f);

        Vec3.Dot(Axes(rig, frame).Forward, Vec3.UnitX).Should().BeApproximately(0.7071f, 1e-3f);
    }

    [Fact]
    public void AimRollAlignsTheUpAxis()
    {
        Rig rig = OneBone();
        AnimationFrame frame = Rest(rig);

        AimSolver.Solve(rig, frame, 0, new Vec3(1.0f, 0.0f, 0.0f), Vec3.UnitY);

        Vec3.Dot(Axes(rig, frame).Up, Vec3.UnitY).Should().BeApproximately(1.0f, 1e-4f);
    }
}
