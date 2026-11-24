namespace Axrone.Animation.Tests;

public class RetargetTests
{
    private static Rig SourceRig() => new(new RigId("src"), [
        new BoneInfo { Name = "root", ParentIndex = -1 },
        new BoneInfo { Name = "arm", ParentIndex = 0, RestTranslation = new Vec3(1.0f, 0.0f, 0.0f) },
    ]);

    private static Rig ScaledTargetRig() => new(new RigId("dst"), [
        new BoneInfo { Name = "root", ParentIndex = -1 },
        new BoneInfo { Name = "arm", ParentIndex = 0, RestTranslation = new Vec3(2.0f, 0.0f, 0.0f) },
    ]);

    private static Dictionary<CurveId, int> NoCurves() => new();

    [Fact]
    public void NameMatching_ResolvesAllBones()
    {
        var profile = new RetargetProfile(SourceRig(), ScaledTargetRig());
        profile.SourceToTargetMap.ToArray().Should().Equal(0, 1);
    }

    [Fact]
    public void ExplicitMapping_PartialOk()
    {
        var profile = new RetargetProfile(SourceRig(), ScaledTargetRig(), [("arm", "arm")]);
        profile.SourceToTargetMap.ToArray().Should().Equal(-1, 1);
    }

    [Fact]
    public void Bindings_ContainMappedBonesOnly()
    {
        var full = new RetargetProfile(SourceRig(), ScaledTargetRig());
        full.Bindings.Length.Should().Be(2);

        var partial = new RetargetProfile(SourceRig(), ScaledTargetRig(), [("arm", "arm")]);
        partial.Bindings.Length.Should().Be(1);
        partial.Bindings[0].SourceIndex.Should().Be(1);
        partial.Bindings[0].TargetIndex.Should().Be(1);
        partial.Bindings[0].LengthRatio.Should().BeApproximately(2.0f, 1e-6f);
    }

    [Fact]
    public void AllModePairs_ExecuteWithoutThrowing()
    {
        Rig source = SourceRig();
        Rig target = ScaledTargetRig();
        var translationModes = new RetargetTranslationMode[]
        {
            RetargetTranslationMode.None,
            RetargetTranslationMode.Absolute,
            RetargetTranslationMode.Scaled,
        };
        var rotationModes = new RetargetRotationMode[]
        {
            RetargetRotationMode.Copy,
            RetargetRotationMode.Offset,
        };

        foreach (RetargetTranslationMode translation in translationModes)
        {
            foreach (RetargetRotationMode rotation in rotationModes)
            {
                var profile = new RetargetProfile(source, target)
                {
                    TranslationMode = translation,
                    RotationMode = rotation,
                };
                var sourceFrame = new AnimationFrame(2, NoCurves());
                var targetFrame = new AnimationFrame(2, NoCurves());
                Action retarget = () => profile.RetargetFrame(sourceFrame, targetFrame);
                retarget.Should().NotThrow();
            }
        }
    }

    [Fact]
    public void RetargetFrame_RestoresUnmappedTargetBones()
    {
        var profile = new RetargetProfile(SourceRig(), ScaledTargetRig(), [("arm", "arm")]);
        var sourceFrame = new AnimationFrame(2, NoCurves());
        var targetFrame = new AnimationFrame(2, NoCurves());
        targetFrame.GetTranslations()[0] = new Vec3(9.0f, 9.0f, 9.0f);
        targetFrame.GetRotations()[0] = Quat.CreateFromAxisAngle(Vec3.UnitX, 1.0f);
        targetFrame.GetScales()[0] = new Vec3(3.0f, 3.0f, 3.0f);

        profile.RetargetFrame(sourceFrame, targetFrame);

        targetFrame.ReadTranslations()[0].Should().Be(Vec3.Zero);
        targetFrame.ReadRotations()[0].Should().Be(Quat.Identity);
        targetFrame.ReadScales()[0].Should().Be(Vec3.One);
    }

    [Fact]
    public void RetargetView_WorksOverStackLanes()
    {
        var profile = new RetargetProfile(SourceRig(), ScaledTargetRig());

        Span<Vec3> srcT = stackalloc Vec3[2];
        Span<Quat> srcR = stackalloc Quat[2];
        Span<Vec3> srcS = stackalloc Vec3[2];
        srcR[0] = Quat.Identity;
        srcR[1] = Quat.Identity;
        srcS[0] = Vec3.One;
        srcS[1] = Vec3.One;
        srcT[1] = new Vec3(3.0f, 0.0f, 0.0f);

        Span<Vec3> dstT = stackalloc Vec3[2];
        Span<Quat> dstR = stackalloc Quat[2];
        Span<Vec3> dstS = stackalloc Vec3[2];

        var source = new AnimationFrameView(srcT, srcR, srcS);
        var target = new AnimationFrameView(dstT, dstR, dstS);
        profile.RetargetView(in source, in target);

        dstT[1].X.Should().BeApproximately(6.0f, 1e-5f);
    }

    [Fact]
    public void NonUnitRestRotation_BuildsWithoutNaN()
    {
        var source = new Rig(new RigId("src"), [
            new BoneInfo { Name = "root", ParentIndex = -1 },
            new BoneInfo { Name = "arm", ParentIndex = 0, RestRotation = new Quat(0, 0, 0, 2.0f) },
        ]);
        var profile = new RetargetProfile(source, ScaledTargetRig());

        var sourceFrame = new AnimationFrame(2, NoCurves());
        var targetFrame = new AnimationFrame(2, NoCurves());
        profile.RetargetFrame(sourceFrame, targetFrame);

        // Zero source rotation must sanitize to identity, never NaN.
        Quat output = targetFrame.ReadRotations()[1];
        output.Should().Be(Quat.Identity);
        FastMath.InvertSafe(new Quat(0, 0, 0, 0)).Should().Be(Quat.Identity);
    }

    [Fact]
    public void InvalidModes_ThrowAtConstruction()
    {
        Action badTranslation = () =>
        {
            _ = new RetargetProfile(SourceRig(), ScaledTargetRig())
            {
                TranslationMode = (RetargetTranslationMode)99,
            };
        };
        badTranslation.Should().Throw<ValidationException>()
            .Where(ex => ex.Code == AnimationErrorCode.ValidationInvalidArgument);

        Action badRotation = () =>
        {
            _ = new RetargetProfile(SourceRig(), ScaledTargetRig())
            {
                RotationMode = (RetargetRotationMode)99,
            };
        };
        badRotation.Should().Throw<ValidationException>()
            .Where(ex => ex.Code == AnimationErrorCode.ValidationInvalidArgument);
    }

    [Fact]
    public void ExplicitStructMapping_WorksLikeTuples()
    {
        var profile = new RetargetProfile(SourceRig(), ScaledTargetRig(), new ExplicitBoneMapping("arm", "arm"));
        profile.SourceToTargetMap.ToArray().Should().Equal(-1, 1);
        profile.Bindings.Length.Should().Be(1);
    }

    [Fact]
    public void ZeroMappings_Throw()
    {
        var other = new Rig(new RigId("other"), [
            new BoneInfo { Name = "x", ParentIndex = -1 },
        ]);
        Action build = () => { _ = new RetargetProfile(SourceRig(), other); };
        build.Should().Throw<RetargetingException>()
            .Where(e => e.Code == AnimationErrorCode.RetargetingNoMapping);
    }

    [Fact]
    public void ScaledMode_ScalesTranslationByRestRatio()
    {
        Rig source = SourceRig();
        Rig target = ScaledTargetRig();
        var profile = new RetargetProfile(source, target) { TranslationMode = RetargetTranslationMode.Scaled };

        var sourceFrame = new AnimationFrame(2, NoCurves());
        sourceFrame.GetTranslations()[1] = new Vec3(3.0f, 0.0f, 0.0f);
        sourceFrame.GetRotations()[1] = Quat.Identity;
        var targetFrame = new AnimationFrame(2, NoCurves());

        profile.RetargetFrame(sourceFrame, targetFrame);
        targetFrame.ReadTranslations()[1].X.Should().BeApproximately(6.0f, 1e-5f);
    }

    [Fact]
    public void CopyMode_PassesRotationThrough()
    {
        Rig source = SourceRig();
        Rig target = ScaledTargetRig();
        var profile = new RetargetProfile(source, target) { RotationMode = RetargetRotationMode.Copy };

        var sourceFrame = new AnimationFrame(2, NoCurves());
        var twisted = Quat.CreateFromAxisAngle(Vec3.UnitY, 1.0f);
        sourceFrame.GetRotations()[1] = twisted;
        var targetFrame = new AnimationFrame(2, NoCurves());

        profile.RetargetFrame(sourceFrame, targetFrame);
        Quat result = targetFrame.ReadRotations()[1];
        result.X.Should().BeApproximately(twisted.X, 1e-6f);
        result.W.Should().BeApproximately(twisted.W, 1e-6f);
    }
}
