namespace Axrone.Tween.Tests;

using Axrone.Numeric;

public class InterpolatorTests
{
    [Fact]
    public void Float_MidpointAndEndpoints()
    {
        FloatInterpolator.Interpolate(0f, 10f, 0f).Should().BeApproximately(0f, 1e-6f);
        FloatInterpolator.Interpolate(0f, 10f, 0.5f).Should().BeApproximately(5f, 1e-6f);
        FloatInterpolator.Interpolate(0f, 10f, 1f).Should().BeApproximately(10f, 1e-6f);
    }

    [Fact]
    public void Vec2_Midpoint()
    {
        var result = Vec2Interpolator.Interpolate(new Vec2(0f, 0f), new Vec2(4f, 8f), 0.5f);

        result.X.Should().BeApproximately(2f, 1e-6f);
        result.Y.Should().BeApproximately(4f, 1e-6f);
    }

    [Fact]
    public void Vec3_Midpoint()
    {
        var result = Vec3Interpolator.Interpolate(new Vec3(0f, 0f, 0f), new Vec3(2f, 4f, 6f), 0.5f);

        result.X.Should().BeApproximately(1f, 1e-6f);
        result.Y.Should().BeApproximately(2f, 1e-6f);
        result.Z.Should().BeApproximately(3f, 1e-6f);
    }

    [Fact]
    public void Vec4_Midpoint()
    {
        var result = Vec4Interpolator.Interpolate(new Vec4(0f, 0f, 0f, 0f), new Vec4(2f, 4f, 6f, 8f), 0.5f);

        result.W.Should().BeApproximately(4f, 1e-6f);
    }
}
