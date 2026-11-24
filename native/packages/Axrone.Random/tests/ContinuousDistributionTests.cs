namespace Axrone.Random.Tests;

/// <summary>
/// Analytic and statistical contracts of the continuous distributions and the inclusive integer
/// one: published constants for the density, cumulative and quantile paths, quantile/CDF
/// inversion, transformed-location behaviour, fixed-seed empirical moments, and the guards on
/// parameters that have no support.
/// </summary>
public class ContinuousDistributionTests
{
    private const ulong Seed = 0x0123456789ABCDEFUL;

    [Theory]
    [InlineData(0.0, 0.5)]
    [InlineData(1.0, 0.8413447460685429)]
    [InlineData(-1.0, 0.15865525393145707)]
    [InlineData(1.96, 0.9750021048517795)]
    [InlineData(-2.0, 0.022750131948179207)]
    [InlineData(2.5, 0.9937903346742438)]
    [InlineData(-3.5, 0.00023262907903554013)]
    public void NormalCumulative_MatchesPublishedValues(double z, double expected)
    {
        new NormalDistribution().CumulativeProbability(z).Should()
            .BeApproximately(expected, 1e-12, $"Phi({z}) is a published constant");
    }

    [Theory]
    [InlineData(0.0, 0.3989422804014327)]
    [InlineData(0.5, 0.3520653267642995)]
    [InlineData(1.0, 0.24197072451914337)]
    [InlineData(-1.0, 0.24197072451914337)]
    [InlineData(2.0, 0.05399096651318806)]
    public void NormalDensity_MatchesPublishedValues(double z, double expected)
    {
        new NormalDistribution().Probability(z).Should()
            .BeApproximately(expected, 1e-12, $"phi({z}) is a published constant");
    }

    [Theory]
    [InlineData(0.5, 0.0)]
    [InlineData(0.9, 1.2815515655446004)]
    [InlineData(0.975, 1.959963984540054)]
    [InlineData(0.999, 3.090232306167814)]
    [InlineData(0.01, -2.3263478740408408)]
    [InlineData(0.025, -1.9599639845400545)]
    [InlineData(0.001, -3.090232306167813)]
    public void NormalQuantile_MatchesPublishedValues(double probability, double expected)
    {
        new NormalDistribution().Quantile(probability).Should()
            .BeApproximately(expected, 1e-9, $"z({probability}) is a published constant");
    }

    [Theory]
    [InlineData(0.0001)]
    [InlineData(0.01)]
    [InlineData(0.25)]
    [InlineData(0.5)]
    [InlineData(0.75)]
    [InlineData(0.99)]
    [InlineData(0.9999)]
    public void NormalQuantile_InvertsTheCumulative(double probability)
    {
        var distribution = new NormalDistribution();
        distribution.CumulativeProbability(distribution.Quantile(probability)).Should()
            .BeApproximately(probability, 1e-10, "the quantile must be the inverse of the CDF");
    }

    [Fact]
    public void NormalQuantile_EndpointsAreSignedInfinities()
    {
        var distribution = new NormalDistribution();
        distribution.Quantile(0.0).Should().Be(double.NegativeInfinity);
        distribution.Quantile(1.0).Should().Be(double.PositiveInfinity);
    }

    [Fact]
    public void NormalLocationAndScale_TranslateTheStandardContract()
    {
        var shifted = new NormalDistribution(mean: 5.0, standardDeviation: 2.0);

        shifted.Mean.Should().Be(5.0);
        shifted.Variance.Should().Be(4.0);
        shifted.StandardDeviation.Should().Be(2.0);
        shifted.CumulativeProbability(5.0).Should().BeApproximately(0.5, 1e-12);
        shifted.Quantile(0.9).Should().BeApproximately(7.563103131089201, 1e-9);
        shifted.Probability(5.0).Should().BeApproximately(0.19947114020071635, 1e-12);
    }

    [Fact]
    public void NormalSample_FixedSeedStream_ReproducesTheMoments()
    {
        var distribution = new NormalDistribution(mean: 2.0, standardDeviation: 3.0);
        Xoshiro256PlusPlus engine = Xoshiro256PlusPlus.Create(Seed);

        const int Samples = 100_000;
        double total = 0.0;
        double totalSquares = 0.0;
        Span<double> window = stackalloc double[1];
        for (int i = 0; i < Samples; i++)
        {
            distribution.SampleMany(ref engine, window);
            total += window[0];
            totalSquares += window[0] * window[0];
        }

        double mean = total / Samples;
        double variance = (totalSquares / Samples) - (mean * mean);

        mean.Should().BeApproximately(2.0, 0.05);
        variance.Should().BeApproximately(9.0, 0.3);
    }

    [Fact]
    public void NormalSample_StaysInsideTheSupportAndIsDeterministicPerSeed()
    {
        var distribution = new NormalDistribution();
        Xoshiro256PlusPlus first = Xoshiro256PlusPlus.Create(Seed);
        Xoshiro256PlusPlus second = Xoshiro256PlusPlus.Create(Seed);

        for (int i = 0; i < 200; i++)
        {
            distribution.Sample(ref first).Should().Be(distribution.Sample(ref second));
        }
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(-1.0)]
    [InlineData(0.0)]
    public void NormalConstructor_RejectsAnUnusableScale(double standardDeviation)
    {
        Action attempt = () => _ = new NormalDistribution(0.0, standardDeviation);
        attempt.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void NormalQueries_RejectNonFiniteArguments()
    {
        var distribution = new NormalDistribution();

        Action density = () => distribution.Probability(double.NaN);
        density.Should().Throw<ArgumentOutOfRangeException>();

        Action cumulative = () => distribution.CumulativeProbability(double.PositiveInfinity);
        cumulative.Should().Throw<ArgumentOutOfRangeException>();

        Action quantile = () => distribution.Quantile(double.NaN);
        quantile.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Theory]
    [InlineData(0.0, 0.0)]
    [InlineData(1.0, 0.6321205588285577)]
    [InlineData(2.0, 0.8646647167633873)]
    [InlineData(-0.5, 0.0)]
    public void ExponentialCumulative_MatchesPublishedValues(double x, double expected)
    {
        new ExponentialDistribution().CumulativeProbability(x).Should()
            .BeApproximately(expected, 1e-12, $"F({x}) of Exp(1) is a published constant");
    }

    [Fact]
    public void ExponentialAnalyticPaths_AgreeWithTheClosedForm()
    {
        var distribution = new ExponentialDistribution(lambda: 2.5);

        distribution.Mean.Should().BeApproximately(0.4, 1e-15);
        distribution.Variance.Should().BeApproximately(0.16, 1e-15);
        distribution.StandardDeviation.Should().BeApproximately(0.4, 1e-15);
        distribution.Probability(0.0).Should().BeApproximately(2.5, 1e-15);
        distribution.Probability(-1.0).Should().Be(0.0);
        distribution.Quantile(0.5).Should().BeApproximately(0.2772588722239781, 1e-12);
        distribution.Quantile(0.0).Should().Be(0.0);
        distribution.Quantile(1.0).Should().Be(double.PositiveInfinity);
    }

    [Fact]
    public void ExponentialSample_FixedSeedStream_MatchesTheRate()
    {
        var distribution = new ExponentialDistribution(lambda: 4.0);
        Xoshiro256PlusPlus engine = Xoshiro256PlusPlus.Create(Seed);

        const int Samples = 100_000;
        double total = 0.0;
        int belowZero = 0;
        for (int i = 0; i < Samples; i++)
        {
            double value = distribution.Sample(ref engine);
            if (value < 0.0)
            {
                belowZero++;
            }

            total += value;
        }

        belowZero.Should().Be(0, "the support is [0, inf)");
        (total / Samples).Should().BeApproximately(0.25, 0.02);
    }

    [Fact]
    public void ExponentialQuantile_InvertsTheCumulative()
    {
        var distribution = new ExponentialDistribution(lambda: 1.7);
        foreach (double probability in new[] { 1e-6, 0.01, 0.5, 0.99 })
        {
            distribution.CumulativeProbability(distribution.Quantile(probability)).Should()
                .BeApproximately(probability, 1e-9);
        }
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-1.0)]
    [InlineData(double.PositiveInfinity)]
    public void ExponentialConstructor_RejectsAnUnusableRate(double lambda)
    {
        Action attempt = () => _ = new ExponentialDistribution(lambda);
        attempt.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Uniform_ReportsItsIntervalAndMoments()
    {
        var distribution = new UniformDistribution(min: 2.0, max: 7.0);

        distribution.Min.Should().Be(2.0);
        distribution.Max.Should().Be(7.0);
        distribution.Range.Should().Be(5.0);
        distribution.Mean.Should().Be(4.5);
        distribution.Variance.Should().BeApproximately(25.0 / 12.0, 1e-15);
    }

    [Fact]
    public void UniformSample_StaysInsideTheInterval()
    {
        var distribution = new UniformDistribution(min: -3.0, max: 1.5);
        Xoshiro256PlusPlus engine = Xoshiro256PlusPlus.Create(Seed);

        double lowest = double.PositiveInfinity;
        double highest = double.NegativeInfinity;
        for (int i = 0; i < 10_000; i++)
        {
            double value = distribution.Sample(ref engine);
            lowest = Math.Min(lowest, value);
            highest = Math.Max(highest, value);
        }

        lowest.Should().BeGreaterThanOrEqualTo(-3.0);
        highest.Should().BeLessThanOrEqualTo(1.5);
        lowest.Should().BeLessThan(-2.5, "the support must be reached near both ends");
        highest.Should().BeGreaterThan(1.0);
    }

    [Fact]
    public void UniformDegenerateInterval_AlwaysDrawsItsSinglePoint()
    {
        var distribution = new UniformDistribution(4.0, 4.0);
        Xoshiro256PlusPlus engine = Xoshiro256PlusPlus.Create(Seed);

        distribution.Range.Should().Be(0.0);
        distribution.Variance.Should().Be(0.0);
        distribution.Sample(ref engine).Should().Be(4.0);
    }

    [Fact]
    public void UniformConstructor_RejectsAnInvertedInterval()
    {
        Action attempt = () => _ = new UniformDistribution(1.0, 0.0);
        attempt.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Integer_ReportsAnInclusiveInterval()
    {
        var distribution = new IntegerDistribution(1, 6);

        distribution.Min.Should().Be(1);
        distribution.Max.Should().Be(6);
        distribution.Width.Should().Be(6UL);
        distribution.Mean.Should().Be(3.5);
        distribution.Variance.Should().BeApproximately(35.0 / 12.0, 1e-12);
    }

    [Fact]
    public void IntegerSample_ReachesEveryValueAndStaysInside()
    {
        var distribution = new IntegerDistribution(-2, 2);
        Xoshiro256PlusPlus engine = Xoshiro256PlusPlus.Create(Seed);
        Span<long> draw = stackalloc long[1];
        var seen = new long[5];
        long outside = 0;

        for (int i = 0; i < 50_000; i++)
        {
            distribution.SampleMany(ref engine, draw);
            long value = draw[0];
            if (value is < -2 or > 2)
            {
                outside++;
                continue;
            }

            seen[(int)(value + 2)]++;
        }

        outside.Should().Be(0, "the support is the closed interval");
        foreach (long count in seen)
        {
            count.Should().BeGreaterThan(7_000, "a five-point support must be reached evenly");
        }
    }

    [Fact]
    public void IntegerSample_NarrowIntervalIsExactlyUniform()
    {
        var distribution = new IntegerDistribution(0, 1);
        Xoshiro256PlusPlus engine = Xoshiro256PlusPlus.Create(Seed);

        int ones = 0;
        for (int i = 0; i < 200_000; i++)
        {
            ones += distribution.Sample(ref engine) == 1 ? 1 : 0;
        }

        ones.Should().BeInRange(96_000, 104_000);
    }

    [Fact]
    public void IntegerSingleValueInterval_BehavesLikeAConstant()
    {
        var distribution = new IntegerDistribution(7, 7);
        Xoshiro256PlusPlus engine = Xoshiro256PlusPlus.Create(Seed);

        distribution.Width.Should().Be(1UL);
        distribution.Variance.Should().Be(0.0);
        distribution.Sample(ref engine).Should().Be(7);
    }

    [Fact]
    public void IntegerWideInterval_HonoursItsBounds()
    {
        var distribution = new IntegerDistribution(0, long.MaxValue);
        Xoshiro256PlusPlus engine = Xoshiro256PlusPlus.Create(Seed);

        distribution.Width.Should().Be((ulong)long.MaxValue + 1UL);
        for (int i = 0; i < 1000; i++)
        {
            distribution.Sample(ref engine).Should().BeGreaterThanOrEqualTo(0L);
        }
    }

    [Theory]
    [InlineData(long.MinValue, long.MaxValue)]
    [InlineData(5L, 4L)]
    public void IntegerConstructor_RejectsAnIntervalItCannotCount(long min, long max)
    {
        Action attempt = () => _ = new IntegerDistribution(min, max);
        attempt.Should().Throw<ArgumentOutOfRangeException>();
    }
}
