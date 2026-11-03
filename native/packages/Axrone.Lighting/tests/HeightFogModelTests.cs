namespace Axrone.Lighting.Tests;

public class HeightFogModelTests
{
    [Fact]
    public void HorizontalUniformFog_ScalesWithDistance()
    {
        HeightFogSettings settings = new(true, Vec3.One, 0.1f, 0.0f, 0.0f);
        Vec3 camera = new(0.0f, 1.0f, 0.0f);

        HeightFogModel.OpticalDepth(in camera, new Vec3(0.0f, 1.0f, 10.0f), in settings)
            .Should().BeApproximately(1.0f, 1e-5f);
        HeightFogModel.Factor(in camera, new Vec3(0.0f, 1.0f, 10.0f), in settings)
            .Should().BeApproximately(1.0f - MathF.Exp(-1.0f), 1e-5f);
    }

    [Fact]
    public void HeightFalloff_IsFiniteAndMonotonic()
    {
        HeightFogSettings settings = new(true, Vec3.One, 0.1f, 0.2f, 0.0f);
        Vec3 camera = new(0.0f, 2.0f, 0.0f);

        float up = HeightFogModel.OpticalDepth(in camera, new Vec3(0.0f, 12.0f, 20.0f), in settings);
        float down = HeightFogModel.OpticalDepth(in camera, new Vec3(0.0f, -8.0f, 20.0f), in settings);

        up.Should().BeGreaterThan(0.0f);
        down.Should().BeGreaterThan(up);
        up.Should().BeLessThan(float.MaxValue);
        down.Should().BeLessThan(float.MaxValue);
    }

    [Fact]
    public void HeightFog_NegativeAndDegenerateInputsDisableContribution()
    {
        HeightFogSettings disabled = new(false, Vec3.One, 0.1f, 0.1f, 0.0f);
        HeightFogSettings zeroDensity = new(true, Vec3.One, 0.0f, 0.1f, 0.0f);
        Vec3 point = new(0.0f, 1.0f, 2.0f);

        HeightFogModel.OpticalDepth(in point, point, in disabled).Should().Be(0.0f);
        HeightFogModel.Factor(in point, new Vec3(0.0f, 1.0f, 5.0f), in zeroDensity).Should().Be(0.0f);
        HeightFogModel.Factor(in point, point, in HeightFogSettings.Default).Should().Be(0.0f);
    }

    [Fact]
    public void HeightFog_SettingsRejectNonFiniteValues()
    {
        Action invalidDensity = () => _ = new HeightFogSettings(true, Vec3.One, float.NaN, 0.1f, 0.0f);
        invalidDensity.Should().Throw<LightingValidationException>();

        Action invalidFalloff = () => _ = new HeightFogSettings(true, Vec3.One, 0.1f, float.PositiveInfinity, 0.0f);
        invalidFalloff.Should().Throw<LightingValidationException>();
    }

    [Fact]
    public void HeightFog_SameRayProducesIdenticalOpticalDepth()
    {
        HeightFogSettings settings = new(true, Vec3.One, 0.05f, 0.25f, 0.0f);
        Vec3 camera = new(0.0f, 3.0f, -10.0f);
        Vec3 fragment = new(1.0f, 0.5f, 20.0f);

        HeightFogModel.OpticalDepth(in camera, in fragment, in settings)
            .Should()
            .Be(HeightFogModel.OpticalDepth(in camera, in fragment, in settings));
    }

    [Fact]
    public void SteepRatio_IsAnalyticallyCorrectAndSignAsymmetric()
    {
        // (1 - e^-x) / x through the product x * falloff; the negative branch
        // must NOT mirror the positive branch or downward rays lose density.
        HeightFogModel.SteepRatio(2.0f, 1.0f)
            .Should().BeApproximately((1.0f - MathF.Exp(-2.0f)) / 2.0f, 1e-5f);
        HeightFogModel.SteepRatio(-2.0f, 1.0f)
            .Should().BeApproximately((1.0f - MathF.Exp(2.0f)) / -2.0f, 1e-4f);

        float up = HeightFogModel.SteepRatio(10.0f, 0.2f);
        float down = HeightFogModel.SteepRatio(-10.0f, 0.2f);
        down.Should().BeGreaterThan(up);
        up.Should().NotBe(down);
        down.Should().BeApproximately(3.1945281f, 1e-5f);

        HeightFogModel.SteepRatio(1e-5f, 0.2f).Should().BeApproximately(1.0f, 1e-4f);
        HeightFogModel.SteepRatio(-1e-5f, 0.2f).Should().BeApproximately(1.0f, 1e-4f);

        // Deep downward slopes clamp at exp(80)/80 instead of overflowing.
        HeightFogModel.SteepRatio(-200.0f, 1.0f)
            .Should().BeApproximately(MathF.Exp(80.0f) / 80.0f, MathF.Exp(80.0f) * 1e-4f);
        HeightFogModel.SteepRatio(-200.0f, 1.0f).Should().BeGreaterThan(1e30f);
    }
}
