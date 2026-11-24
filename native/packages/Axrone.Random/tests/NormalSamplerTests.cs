namespace Axrone.Random.Tests;

/// <summary>
/// The bounded and in-range normal samplers: closed supports, degenerate windows and the guards
/// on windows that cannot be drawn into.
/// </summary>
public sealed class NormalSamplerTests
{
    [Fact]
    public void BoundedNormal_NeverLeavesTheWindow()
    {
        var engine = new RandomEngine<Xoshiro256PlusPlus>(Xoshiro256PlusPlus.Create(0xC0FFEE0DCAFEUL));

        for (int i = 0; i < 5_000; i++)
        {
            engine.NextBoundedNormal(-2.0, 2.0).Should().BeInRange(-2.0, 2.0);
        }
    }

    [Fact]
    public void BoundedNormal_CollapsedWindowDrawsItsSinglePoint()
    {
        var engine = new RandomEngine<Xoshiro256PlusPlus>(Xoshiro256PlusPlus.Create(1UL));
        engine.NextBoundedNormal(0.5, 0.5).Should().Be(0.5);
    }

    [Fact]
    public void BoundedNormal_KeepsBothTailBranches()
    {
        var engine = new RandomEngine<Xoshiro256PlusPlus>(Xoshiro256PlusPlus.Create(0x5EEDUL));
        int low = 0;
        int high = 0;

        for (int i = 0; i < 20_000; i++)
        {
            double value = engine.NextBoundedNormal(-0.05, 0.05);
            if (value <= -0.05)
            {
                low++;
            }
            else if (value >= 0.05)
            {
                high++;
            }
        }

        low.Should().BeGreaterThan(0, "a three-sigma-narrow window must show the lower clamp");
        high.Should().BeGreaterThan(0, "and the upper clamp");
        (low + high).Should().BeGreaterThan(15_000, "almost every deviate falls outside a 0.1-wide window");
    }

    [Theory]
    [InlineData(double.NaN, 1.0)]
    [InlineData(1.0, double.NaN)]
    [InlineData(2.0, 1.0)]
    public void BoundedNormal_RejectsUnusableWindows(double min, double max)
    {
        var engine = new RandomEngine<Xoshiro256PlusPlus>(Xoshiro256PlusPlus.Create(7UL));
        Action attempt = () => engine.NextBoundedNormal(min, max);
        attempt.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void NormalInRange_StaysInsideItsIntervalAndCentresOnTheMidpoint()
    {
        var engine = new RandomEngine<Xoshiro256PlusPlus>(Xoshiro256PlusPlus.Create(0x1234ABCDUL));
        double total = 0.0;
        const int Samples = 20_000;

        for (int i = 0; i < Samples; i++)
        {
            double value = engine.NextNormalInRange(10.0, 6.0);
            value.Should().BeInRange(7.0, 13.0);
            total += value;
        }

        (total / Samples).Should().BeApproximately(10.0, 0.1);
    }

    [Fact]
    public void NormalInRange_ZeroRangeDrawsTheCentre()
    {
        var engine = new RandomEngine<Xoshiro256PlusPlus>(Xoshiro256PlusPlus.Create(3UL));
        for (int i = 0; i < 32; i++)
        {
            engine.NextNormalInRange(-4.5, 0.0).Should().Be(-4.5);
        }
    }

    [Theory]
    [InlineData(0.0, double.NaN)]
    [InlineData(0.0, double.PositiveInfinity)]
    [InlineData(0.0, -1.0)]
    public void NormalInRange_RejectsUnusableWidths(double center, double range)
    {
        var engine = new RandomEngine<Xoshiro256PlusPlus>(Xoshiro256PlusPlus.Create(9UL));
        Action attempt = () => engine.NextNormalInRange(center, range);
        attempt.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Facade_ExposesBothSamplersOnTheAmbientStream()
    {
        for (int i = 0; i < 200; i++)
        {
            Random.NextBoundedNormal().Should().BeInRange(-1.0, 1.0);
            Random.NextNormalInRange(0.0, 12.0).Should().BeInRange(-6.0, 6.0);
        }
    }
}
