namespace Axrone.Lighting.Tests;

public class ShadowModelTests
{
    [Fact]
    public void Settings_DefaultsNormalizeRanges()
    {
        ShadowSettings settings = ShadowSettings.Default;
        settings.Enabled.Should().BeTrue();
        settings.AtlasSize.Should().Be(4096);
        settings.CascadeCount.Should().Be(ShadowCascadeCount.Four);
        settings.Filter.Should().Be(ShadowFilterMode.Pcf);
        settings.Bias.Depth.Should().BeApproximately(0.0015f, 1e-7f);

        ShadowBias negative = new(-1f, -2f);
        negative.Depth.Should().Be(0.0f);
        negative.Normal.Should().Be(0.0f);
    }

    [Fact]
    public void Settings_RejectInvalidEnumsAndNonFiniteRanges()
    {
        Action invalidCascade = () => _ = new ShadowSettings(
            true,
            cascadeCount: (ShadowCascadeCount)3);
        invalidCascade.Should().Throw<LightingValidationException>();

        Action invalidFilter = () => _ = new ShadowSettings(
            true,
            filter: (ShadowFilterMode)99);
        invalidFilter.Should().Throw<LightingValidationException>();

        Action invalidLambda = () => _ = new ShadowSettings(true, cascadeSplitLambda: float.NaN);
        invalidLambda.Should().Throw<LightingValidationException>();

        Action invalidBias = () => _ = new ShadowBias(float.PositiveInfinity, 0.0f);
        invalidBias.Should().Throw<LightingValidationException>();
    }

    [Theory]
    [InlineData(0.0f)]
    [InlineData(0.5f)]
    [InlineData(1.0f)]
    public void Splits_AreMonotonicAndCapped(float lambda)
    {
        Span<float> splits = stackalloc float[4];
        ShadowSplits.Compute(0.5f, 1000f, ShadowCascadeCount.Four, lambda, 150f, splits);

        splits[0].Should().BeGreaterThan(0.5f);
        splits[1].Should().BeGreaterThanOrEqualTo(splits[0]);
        splits[2].Should().BeGreaterThanOrEqualTo(splits[1]);
        splits[3].Should().BeApproximately(150.0f, 1e-5f);
    }

    [Fact]
    public void Splits_SameInputsProduceIdenticalBoundaries()
    {
        Span<float> first = stackalloc float[4];
        Span<float> second = stackalloc float[4];
        ShadowSplits.Compute(0.1f, 500f, ShadowCascadeCount.Four, 0.7f, 120f, first);
        ShadowSplits.Compute(0.1f, 500f, ShadowCascadeCount.Four, 0.7f, 120f, second);

        first.ToArray().Should().Equal(second.ToArray());
    }

    [Fact]
    public void Splits_ValidateInputsAndDestination()
    {
        Action smallSpan = () => ShadowSplits.Compute(0.1f, 100f, ShadowCascadeCount.Four, 0.5f, 100f, stackalloc float[3]);
        smallSpan.Should().Throw<LightingValidationException>();

        Action badNear = () => ShadowSplits.Compute(0f, 100f, ShadowCascadeCount.One, 0.5f, 100f, stackalloc float[1]);
        badNear.Should().Throw<LightingValidationException>();

        Action badFar = () => ShadowSplits.Compute(10f, 1f, ShadowCascadeCount.One, 0.5f, 100f, stackalloc float[1]);
        badFar.Should().Throw<LightingValidationException>();
    }

    [Fact]
    public void AtlasLayout_TwoAndFourCoverTheFullAtlas()
    {
        Vec4 firstTwo = ShadowAtlasLayout.GetTile(ShadowCascadeCount.Two, 0);
        Vec4 secondTwo = ShadowAtlasLayout.GetTile(ShadowCascadeCount.Two, 1);
        firstTwo.Z.Should().Be(0.5f);
        secondTwo.X.Should().Be(0.5f);
        (firstTwo.X + secondTwo.X + secondTwo.Z).Should().Be(1.0f);

        ShadowAtlasLayout.GetTile(ShadowCascadeCount.Four, 0).W.Should().Be(0.5f);
        ShadowAtlasLayout.GetTile(ShadowCascadeCount.Four, 3).Should().Be(new Vec4(0.5f, 0.5f, 0.5f, 0.5f));

        Action invalidIndex = () => _ = ShadowAtlasLayout.GetTile(ShadowCascadeCount.One, 1);
        invalidIndex.Should().Throw<LightingValidationException>();
    }

    [Fact]
    public void Frame_StoresOnlyActiveCascades()
    {
        var frame = new ShadowFrameData();
        frame.ApplySettings(ShadowSettings.Default, 2048, 2048);
        frame.LightViewProjections.Length.Should().Be(4);

        frame.GetSplitDepth(1).Should().Be(float.MaxValue);
        Mat4 identity = Mat4.Identity;
        Vec4 fullTile = new(0f, 0f, 1f, 1f);
        Action inactiveWrite = () => frame.SetCascade(
            4,
            in identity,
            1f,
            in fullTile);
        inactiveWrite.Should().Throw<LightingValidationException>();

        Action invalidDepth = () => frame.SetCascade(
            0,
            in identity,
            float.NaN,
            in fullTile);
        invalidDepth.Should().Throw<LightingValidationException>();
    }

    [Fact]
    public void Builder_IsDeterministicAndPopulatesCascades()
    {
        var first = new ShadowFrameData();
        var second = new ShadowFrameData();
        ShadowCameraParameters camera = TestCamera();
        Vec3 lightDirection = new(-0.35f, -0.9f, -0.25f);

        int countA = ShadowCascadeFrameBuilder.Build(first, ShadowSettings.Default, in camera, in lightDirection);
        int countB = ShadowCascadeFrameBuilder.Build(second, ShadowSettings.Default, in camera, in lightDirection);

        countA.Should().Be(4);
        countB.Should().Be(4);
        for (int i = 0; i < 4; i++)
        {
            first.GetLightViewProjection(i).Should().Be(second.GetLightViewProjection(i));
            first.GetSplitDepth(i).Should().Be(second.GetSplitDepth(i));
            first.GetAtlasTile(i).Should().Be(second.GetAtlasTile(i));
            first.GetLightViewProjection(i).IsAllFinite.Should().BeTrue();
        }
    }

    [Fact]
    public void Builder_RejectsUnsupportedGeometry()
    {
        var frame = new ShadowFrameData();
        ShadowCameraParameters camera = TestCamera();

        Action invalidAtlas = () => ShadowCascadeFrameBuilder.Build(
            frame,
            ShadowSettings.Default,
            in camera,
            new Vec3(0f, -1f, 0f),
            256,
            256);
        invalidAtlas.Should().Throw<LightingValidationException>();

        Action invalidCamera = () =>
        {
            _ = new ShadowCameraParameters(
                Vec3.Zero,
                new Vec3(0f, 0f, -1f),
                Vec3.UnitY,
                Vec3.UnitX,
                MathF.PI,
                1f,
                0.1f,
                100f);
        };
        invalidCamera.Should().Throw<LightingValidationException>();
    }

    private static ShadowCameraParameters TestCamera() => new(
        Vec3.Zero,
        new Vec3(0f, 0f, -1f),
        Vec3.UnitY,
        Vec3.UnitX,
        MathF.PI / 3f,
        16.0f / 9.0f,
        0.1f,
        500.0f);
}
