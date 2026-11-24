namespace Axrone.Random;

/// <summary>
/// Package-private numeric core shared by the discrete distributions: the 53-bit unit draw
/// off any <see cref="IRandomSource{TSelf}"/> engine, the open-interval variant the inverse-CDF
/// and Box-Muller paths need, the unit-interval guard and the Lanczos log-gamma.
/// </summary>
/// <remarks>
/// Everything here is either a few ALU operations or a handful of transcendentals over a
/// value-type engine passed by <see langword="ref"/>: no allocation, no heap round trip and
/// nothing that reflects over the type parameter, so the distributions stay AOT/trim clean.
/// </remarks>
internal static class DistributionMath
{
    /// <summary>1 / 2^53: the scaling that turns the top 53 bits of a 64-bit draw into [0, 1).</summary>
    private const double InverseTwoTo53 = 1.0 / 9007199254740992.0;

    /// <summary>
    /// Advances <paramref name="engine"/> by one 64-bit step and scales the top 53 bits into
    /// <c>[0, 1)</c> - the same 53-bit construction <see cref="RandomEngine{TEngine}.NextDouble()"/>
    /// uses, reached through the static-abstract shape of <see cref="IRandomSource{TSelf}"/> so
    /// the distributions never depend on the wrapper type.
    /// </summary>
    /// <typeparam name="TEngine">The engine core; the state is advanced in place.</typeparam>
    /// <param name="engine">The engine state to advance. It is a by-ref local, never a field copy.</param>
    /// <returns>A value in <c>[0, 1)</c>; the value 1 is never produced.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static double NextUnitDouble<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine> =>
        (TEngine.NextUInt64(ref engine) >> 11) * InverseTwoTo53;

    /// <summary>
    /// Advances <paramref name="engine"/> and returns a unit draw in the open interval
    /// <c>(0, 1)</c>, which is what a logarithm of a uniform draw requires.
    /// </summary>
    /// <typeparam name="TEngine">The engine core; the state is advanced in place.</typeparam>
    /// <param name="engine">The engine state to advance. It is a by-ref local, never a field copy.</param>
    /// <returns>A value in <c>(0, 1)</c>.</returns>
    /// <remarks>
    /// The all-zero 64-bit word maps to exactly <c>0.0</c>, and a strict inverse-CDF or the
    /// Box-Muller radius would then take <c>log(0)</c>. The closed endpoint is nudged to the
    /// smallest positive double instead: it perturbs one draw in 2^53 and saves a rejection loop
    /// on every call site that would otherwise have to guard for it.
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static double NextOpenUnitDouble<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine>
    {
        double unit = NextUnitDouble(ref engine);
        return unit > 0.0 ? unit : double.Epsilon;
    }

    /// <summary>Rejects a probability that is NaN or outside the closed unit interval.</summary>
    /// <param name="value">The candidate probability.</param>
    /// <param name="paramName">The name of the rejected parameter.</param>
    internal static void ValidateUnitInterval(double value, string paramName)
    {
        if (double.IsNaN(value) || value < 0.0 || value > 1.0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(paramName, "The probability must be within [0, 1].");
        }
    }

    /// <summary>
    /// Evaluates <c>log(1 - value)</c> for <paramref name="value"/> in <c>[0, 1]</c> without
    /// losing the argument to cancellation.
    /// </summary>
    /// <param name="value">The complement to log; <c>1</c> yields <c>-inf</c>.</param>
    /// <returns><c>log(1 - value)</c>, exact to full double precision over the whole range.</returns>
    /// <remarks>
    /// Once <paramref name="value"/> drops under the epsilon at 1, the subtraction <c>1 - value</c>
    /// rounds to exactly 1 and a direct logarithm returns <c>0</c> instead of <c>-value</c> - a
    /// total loss of the argument, not a rounding error. Below the cutoff the truncated series
    /// <c>-x - x^2/2 - x^3/3 - x^4/4</c> carries the value instead; its truncation error at the
    /// cutoff is below <c>1e-20</c> relative. Above the cutoff the subtraction is exact and the
    /// logarithm is the cheaper, better-conditioned operation.
    /// </remarks>
    internal static double LogOneMinus(double value) =>
        value < 1e-4
            ? -value * (1.0 + (value * (0.5 + (value * (0.33333333333333331 + (value * 0.25))))))
            : Math.Log(1.0 - value);

    /// <summary>
    /// Evaluates <c>1 - e^exponent</c> for a non-positive <paramref name="exponent"/> without
    /// losing the exponent to cancellation.
    /// </summary>
    /// <param name="exponent">The exponent; must be non-positive.</param>
    /// <returns>The complement of the exponential, accurate as the exponent goes to zero.</returns>
    /// <remarks>
    /// Near zero the subtraction <c>1 - e^t</c> cancels away most of the significant digits, and
    /// the truncated series <c>t + t^2/2 + t^3/6</c> restores them; its truncation error at the
    /// cutoff is below <c>1e-24</c> relative.
    /// </remarks>
    internal static double OneMinusExp(double exponent) =>
        exponent > -1e-8
            ? -exponent * (1.0 + (exponent * (0.5 + (exponent / 6.0))))
            : 1.0 - Math.Exp(exponent);

    /// <summary>
    /// Evaluates <c>log Gamma(x)</c> with the Lanczos approximation at <c>g = 7</c>
    /// (Numerical Recipes, 14 coefficients reduced to the nine published ones).
    /// </summary>
    /// <param name="value">The argument. It must be finite and non-negative - the whole positive axis,
    /// which is every argument the distributions ever pass (a count plus one, or nothing at all
    /// for the degenerate rates).</param>
    /// <returns>The natural logarithm of the gamma function.</returns>
    /// <remarks>
    /// <para>The coefficients are a local read-only span, so the table lands in the assembly's
    /// data section instead of a static array that a trimming pass would have to reason about.</para>
    /// <para>Accuracy is about 1e-15 relative over the whole positive axis, which is well inside
    /// the resolution a PMF evaluated in log space can report.</para>
    /// </remarks>
    internal static double LogGamma(double value)
    {
        ReadOnlySpan<double> coefficients =
        [
            0.99999999999980993,
            676.5203681218851,
            -1259.1392167224028,
            771.32342877765313,
            -176.61502916214059,
            12.507343278686905,
            -0.13857109526572012,
            9.9843695780195716e-6,
            1.5056327351493116e-7,
        ];

        // Reflection: Gamma(x) * Gamma(1 - x) = pi / sin(pi x). It is only taken below 0.5, so
        // the recursive call always lands in the direct branch and cannot recurse again.
        if (value < 0.5)
        {
            return Math.Log(Math.PI / Math.Sin(Math.PI * value)) - LogGamma(1.0 - value);
        }

        double shifted = value - 1.0;
        double sum = coefficients[0];
        for (int i = 1; i < coefficients.Length; i++)
        {
            sum += coefficients[i] / (shifted + i);
        }

        double t = shifted + 7.5; // g + 0.5
        return (0.5 * Math.Log(2.0 * Math.PI)) + ((shifted + 0.5) * Math.Log(t)) - t + Math.Log(sum);
    }

    /// <summary>
    /// Error function over the whole real line, from two branches that share no fitted table:
    /// the Maclaurin series below 1.5 and Laplace's continued fraction above it.
    /// </summary>
    /// <param name="value">The argument.</param>
    /// <returns><c>erf(value)</c>, odd, saturating to <c>±1</c>.</returns>
    /// <remarks>
    /// <para>Both branches reach the double limit on their own terms. The series at the 1.5 cutoff
    /// is <c>1.5^(2n+1) / (n! (2n+1))</c>: twenty-eight terms carry it below <c>1e-17</c> absolute,
    /// and below that cutoff no term ever exceeds the sum by more than a small factor, so the
    /// alternating sum loses nothing to cancellation. The continued fraction is the complement, so
    /// the tail is never formed by subtracting two nearly equal numbers.</para>
    /// <para>This is a cold query path - a handful of loop iterations, no allocation.</para>
    /// </remarks>
    internal static double Erf(double value)
    {
        if (value == 0.0 || double.IsNaN(value))
        {
            return value;
        }

        double magnitude = Math.Abs(value);
        double result = magnitude < ErfSeriesCutoff ? ErfSeries(magnitude) : 1.0 - ErfcTail(magnitude);
        return value < 0.0 ? -result : result;
    }

    /// <summary>
    /// Complementary error function, evaluated as the complement only where the complement is
    /// safe: the tail branch owns every argument at or above <see cref="ErfSeriesCutoff"/>, so
    /// <c>erfc</c> never cancels.
    /// </summary>
    /// <param name="value">The argument.</param>
    /// <returns><c>1 - erf(value)</c>, in <c>(0, 2)</c>.</returns>
    internal static double Erfc(double value)
    {
        if (double.IsNaN(value))
        {
            return value;
        }

        if (value < 0.0)
        {
            return 2.0 - Erfc(-value);
        }

        return value < ErfSeriesCutoff ? 1.0 - ErfSeries(value) : ErfcTail(value);
    }

    /// <summary>
    /// Standard normal cumulative distribution <c>Phi(z) = 0.5 * erfc(-z / sqrt(2))</c>. The
    /// single expression is what makes both tails safe: a far negative <paramref name="z"/>
    /// evaluates the tail branch, and a far positive one evaluates its complement.
    /// </summary>
    /// <param name="z">The standardized value.</param>
    /// <returns>The probability of drawing at most <paramref name="z"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static double NormalCumulative(double z) => 0.5 * Erfc(-z * InverseSqrt2);

    /// <summary>Standard normal density <c>phi(z) = exp(-z^2 / 2) / sqrt(2 pi)</c>.</summary>
    /// <param name="z">The standardized value.</param>
    /// <returns>The density at <paramref name="z"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static double NormalDensity(double z) => Math.Exp(-0.5 * z * z) * InverseSqrtTwoPi;

    /// <summary>
    /// Standard normal quantile: the published Zelen-Severo seed refined by Halley against
    /// <see cref="NormalCumulative"/> until the step stops changing the answer.
    /// </summary>
    /// <param name="probability">The target cumulative probability, strictly inside <c>(0, 1)</c>.</param>
    /// <returns><c>z</c> with <c>Phi(z) = probability</c>.</returns>
    /// <remarks>
    /// The seed is the closed-form tail approximation (about 3e-4 relative), and each Halley step
    /// squares the distance to the root while the forward function stays exact enough to resolve
    /// it. Four steps are therefore saturating rather than necessary; the loop stops early as soon
    /// as a step cannot move <c>z</c>, which is what binds the accuracy of this inverse to the
    /// accuracy of <see cref="NormalCumulative"/> instead of to the seed.
    /// </remarks>
    internal static double NormalQuantile(double probability)
    {
        if (probability <= 0.0 || probability >= 1.0)
        {
            return probability switch
            {
                0.0 => double.NegativeInfinity,
                1.0 => double.PositiveInfinity,
                _ => double.NaN,
            };
        }

        bool lower = probability < 0.5;
        double tail = lower ? probability : 1.0 - probability;
        double z = SeedStandardNormalQuantile(tail);
        if (lower)
        {
            z = -z;
        }

        for (int step = 0; step < QuantileRefinementSteps; step++)
        {
            double error = (NormalCumulative(z) - probability) / NormalDensity(z);
            double corrected = z - error / (1.0 + (0.5 * z * error));
            if (corrected == z)
            {
                return z;
            }

            z = corrected;
        }

        return z;
    }

    /// <summary>Draws a unit double in <c>[0, 1)</c> scaled into <c>[0, bound)</c> by Lemire multiply-shift.</summary>
    /// <typeparam name="TEngine">The engine core; the state is advanced in place.</typeparam>
    /// <param name="engine">The engine state to advance.</param>
    /// <param name="bound">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value in <c>[0, bound)</c>, exactly uniform over it.</returns>
    internal static ulong NextBoundedUInt64<TEngine>(ref TEngine engine, ulong bound)
        where TEngine : struct, IRandomSource<TEngine>
    {
        if (bound == 0UL)
        {
            return 0UL;
        }

        if (BitOperations.IsPow2(bound))
        {
            return TEngine.NextUInt64(ref engine) & (bound - 1);
        }

        if (bound <= uint.MaxValue)
        {
            return NextBoundedUInt32(ref engine, (uint)bound);
        }

        UInt128 product = (UInt128)TEngine.NextUInt64(ref engine) * bound;
        ulong low = (ulong)product;
        if (low >= bound)
        {
            return (ulong)(product >> 64);
        }

        ulong threshold = unchecked(0UL - bound) % bound;
        while (low < threshold)
        {
            product = (UInt128)TEngine.NextUInt64(ref engine) * bound;
            low = (ulong)product;
        }

        return (ulong)(product >> 64);
    }

    /// <summary>Draws a unit double in <c>[0, 1)</c> scaled into <c>[0, bound)</c> by Lemire multiply-shift.</summary>
    /// <typeparam name="TEngine">The engine core; the state is advanced in place.</typeparam>
    /// <param name="engine">The engine state to advance.</param>
    /// <param name="bound">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value in <c>[0, bound)</c>, exactly uniform over it.</returns>
    internal static uint NextBoundedUInt32<TEngine>(ref TEngine engine, uint bound)
        where TEngine : struct, IRandomSource<TEngine>
    {
        if (bound == 0u)
        {
            return 0u;
        }

        if (BitOperations.IsPow2(bound))
        {
            return TEngine.NextUInt32(ref engine) & (bound - 1);
        }

        ulong product = (ulong)TEngine.NextUInt32(ref engine) * bound;
        uint low = (uint)product;
        if (low >= bound)
        {
            return (uint)(product >> 32);
        }

        uint threshold = unchecked(0u - bound) % bound;
        while (low < threshold)
        {
            product = (ulong)TEngine.NextUInt32(ref engine) * bound;
            low = (uint)product;
        }

        return (uint)(product >> 32);
    }

    /// <summary>The argument at which the series branch hands over to the tail branch.</summary>
    private const double ErfSeriesCutoff = 1.5;

    /// <summary><c>1 / sqrt(2)</c>, the standardisation the normal CDF needs.</summary>
    private const double InverseSqrt2 = 0.70710678118654752440;

    /// <summary><c>1 / sqrt(2 pi)</c>, the normal density's leading factor.</summary>
    private const double InverseSqrtTwoPi = 0.39894228040143267794;

    /// <summary>Halley steps allowed for the quantile before the refinement is declared converged.</summary>
    private const int QuantileRefinementSteps = 4;

    /// <summary>Smallest continued-fraction element, standing in for a zero pivot.</summary>
    private const double ContinuedFractionTiny = 1e-300;

    /// <summary>Convergence test for the continued fraction, one part in 1e-16.</summary>
    private const double ContinuedFractionEpsilon = double.Epsilon;

    /// <summary>Maclaurin series of <c>erf</c> for a non-negative argument below the cutoff.</summary>
    private static double ErfSeries(double magnitude)
    {
        double term = magnitude;
        double sum = term;
        double square = magnitude * magnitude;

        for (int n = 1; n <= 40 && term != 0.0; n++)
        {
            term *= -square * (2.0 * (n - 1) + 1.0) / ((double)n * ((2.0 * n) + 1.0));
            sum += term;
        }

        return sum * (2.0 / Math.Sqrt(Math.PI));
    }

    /// <summary>Laplace's continued fraction for <c>erfc</c> at or above the cutoff, by modified Lentz.</summary>
    private static double ErfcTail(double magnitude)
    {
        double convergent = magnitude;
        double numerator = magnitude;
        double denominator = 0.0;

        for (int j = 1; j <= 300; j++)
        {
            double partial = 0.5 * j;

            denominator = magnitude + (partial * denominator);
            if (Math.Abs(denominator) < ContinuedFractionTiny)
            {
                denominator = ContinuedFractionTiny;
            }

            numerator = magnitude + (partial / numerator);
            if (Math.Abs(numerator) < ContinuedFractionTiny)
            {
                numerator = ContinuedFractionTiny;
            }

            denominator = 1.0 / denominator;
            double delta = numerator * denominator;
            convergent *= delta;
            if (Math.Abs(delta - 1.0) < ContinuedFractionEpsilon)
            {
                break;
            }
        }

        return Math.Exp(-magnitude * magnitude) / (Math.Sqrt(Math.PI) * convergent);
    }

    /// <summary>
    /// Zelen-Severo closed form for the lower-tail standard normal quantile at a probability at
    /// most <c>0.5</c>; the caller mirrors it for the upper half.
    /// </summary>
    private static double SeedStandardNormalQuantile(double tailProbability)
    {
        double t = Math.Sqrt(-2.0 * Math.Log(tailProbability));
        return t - ((2.30753 + (0.270884 * t)) / (1.0 + (0.99229 * t) + (0.044811 * t * t)));
    }
}

/// <summary>
/// Bernoulli(p): the two-point distribution whose support is <c>{0, 1}</c> and whose probability
/// mass function is <c>p^k * (1 - p)^(1 - k)</c>. It is the one-draw leaf every count
/// distribution is built from - <see cref="BinomialDistribution"/> is a summation of it and
/// Poisson's Knuth branch is a multiplication loop over it.
/// </summary>
/// <remarks>
/// <para><b>By-ref sampling is the hoisted form.</b> <see cref="Sample{TEngine}"/> and
/// <see cref="SampleMany{TEngine}"/> take the engine core by <see langword="ref"/>, so the state
/// the loop advances is the caller's own variable: it already lives in a register for the whole
/// batch and there is nothing left to hoist. The hoisting gate
/// (<see cref="RandomConfig.MaxHoistableStateBytes"/>) exists for <see cref="RandomEngine{TEngine}"/>,
/// where the state sits behind a field of a heap-held wrapper and would otherwise be reloaded per
/// draw; by-ref passing removes that indirection instead of paying for it.</para>
/// <para>Cost is one engine step and one comparison per sample: the cheapest surface in the
/// package, and the one to reach for when a spawn, a hit or a loot roll outnumbers the frame cost
/// of everything else.</para>
/// </remarks>
public readonly struct BernoulliDistribution
{
    private readonly double _successProbability;

    /// <summary>Initialises a Bernoulli distribution with the given success probability.</summary>
    /// <param name="successProbability">The probability of the <c>1</c> outcome, in <c>[0, 1]</c>.</param>
    /// <exception cref="ArgumentOutOfRangeException">
    /// <paramref name="successProbability"/> is NaN or outside <c>[0, 1]</c>.
    /// </exception>
    public BernoulliDistribution(double successProbability)
    {
        DistributionMath.ValidateUnitInterval(successProbability, nameof(successProbability));
        _successProbability = successProbability;
    }

    /// <summary>Gets the expected value, <c>p</c>.</summary>
    public double Mean => _successProbability;

    /// <summary>Gets the variance, <c>p (1 - p)</c>.</summary>
    public double Variance => _successProbability * (1.0 - _successProbability);

    /// <summary>Evaluates the probability mass function.</summary>
    /// <param name="k">The outcome: <c>0</c> for failure, <c>1</c> for success.</param>
    /// <returns>The probability of <paramref name="k"/>, and zero outside <c>{0, 1}</c>.</returns>
    /// <remarks>A cold query path: no engine state is read and no draw is consumed.</remarks>
    public double Probability(int k)
    {
        if (k is < 0 or > 1)
        {
            return 0.0;
        }

        return k == 0 ? 1.0 - _successProbability : _successProbability;
    }

    /// <summary>Evaluates the cumulative distribution function.</summary>
    /// <param name="k">The outcome to evaluate at.</param>
    /// <returns>The probability of drawing <c>0</c> or less: zero below <c>1</c>, else <c>p</c>.</returns>
    public double CumulativeProbability(int k) => k < 1 ? 0.0 : _successProbability;

    /// <summary>Inverts the cumulative distribution function.</summary>
    /// <param name="probability">The target cumulative probability, in <c>[0, 1]</c>.</param>
    /// <returns><c>1</c> for any positive probability, <c>0</c> at exactly zero.</returns>
    /// <remarks>
    /// A two-point support has a single step, so the inverse is degenerate by construction:
    /// <c>F(0) = 0</c> and <c>F(1) = p</c>. The target is therefore first saturated at the largest
    /// cumulative probability the distribution can reach - which is what makes the degenerate
    /// <c>p = 0</c> invert to its own point mass at 0 - and then crosses the step. No search, and
    /// never a value outside the support.
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="probability"/> is NaN or outside <c>[0, 1]</c>.</exception>
    public int Quantile(double probability)
    {
        DistributionMath.ValidateUnitInterval(probability, nameof(probability));
        double target = Math.Min(probability, _successProbability);
        return target <= 0.0 ? 0 : 1;
    }

    /// <summary>Draws one outcome: a single unit draw compared against <c>p</c>.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <returns><c>1</c> with probability <c>p</c>, otherwise <c>0</c>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int Sample<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine> =>
        DistributionMath.NextUnitDouble(ref engine) < _successProbability ? 1 : 0;

    /// <summary>Fills the destination with independent outcomes.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <remarks>
    /// The loop hoists nothing because there is nothing left to hoist: <paramref name="engine"/> is
    /// a by-ref local of this frame, so the state is advanced in the caller's own storage for the
    /// whole batch instead of behind a field of a heap-held wrapper. One engine step and one
    /// comparison per element, zero allocations.
    /// </remarks>
    public void SampleMany<TEngine>(ref TEngine engine, Span<int> destination)
        where TEngine : struct, IRandomSource<TEngine>
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = Sample(ref engine);
        }
    }
}

/// <summary>
/// Binomial(n, p): the count of successes in <c>n</c> independent Bernoulli trials. Up to
/// <see cref="ExactSamplingTrialLimit"/> trials the sampler is the exact summation of
/// <see cref="BernoulliDistribution"/> outcomes; above it, the normal approximation with a
/// Box-Muller deviate, clamped to the support.
/// </summary>
/// <remarks>
/// <para><b>Exactness has a cost.</b> The summation spends <c>n</c> engine steps and is exact for
/// any <c>n</c>, but <c>n</c> engine steps is a linear bill, and the normal approximation becomes
/// the cheaper approximation long before it stops being accurate. The threshold is where the two
/// costs cross: at <c>n = 64</c> the exact path is 64 steps, and the approximation's error at that
/// size is below the resolution of the count itself.</para>
/// <para><b>By-ref sampling is the hoisted form.</b> Both branches advance the engine through a
/// by-ref parameter, so the batch loop in <see cref="SampleMany{TEngine}"/> keeps the state in the
/// caller's storage rather than reloading it per draw from a field of a heap-held wrapper.</para>
/// <para>The query paths (<see cref="Probability"/>, <see cref="CumulativeProbability"/>,
/// <see cref="Quantile"/>) are pure math evaluated in log space and deliberately make no
/// hot-path claim; the CDF sums the shorter tail, so it costs
/// <c>O(min(k, n - k))</c> terms.</para>
/// </remarks>
public readonly struct BinomialDistribution
{
    /// <summary>
    /// The largest trial count sampled by exact Bernoulli summation; above it the normal
    /// approximation takes over.
    /// </summary>
    public const int ExactSamplingTrialLimit = 64;

    private readonly int _trials;
    private readonly double _successProbability;
    private readonly double _mean;
    private readonly double _standardDeviation;
    private readonly bool _useNormalApproximation;

    /// <summary>Initialises a binomial distribution.</summary>
    /// <param name="trials">The number of independent trials; must not be negative.</param>
    /// <param name="successProbability">The per-trial success probability, in <c>[0, 1]</c>.</param>
    /// <exception cref="ArgumentOutOfRangeException">
    /// <paramref name="trials"/> is negative, or <paramref name="successProbability"/> is NaN or
    /// outside <c>[0, 1]</c>.
    /// </exception>
    public BinomialDistribution(int trials, double successProbability)
    {
        if (trials < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(trials), "The trial count must not be negative.");
        }

        DistributionMath.ValidateUnitInterval(successProbability, nameof(successProbability));

        _trials = trials;
        _successProbability = successProbability;
        _mean = trials * successProbability;
        _standardDeviation = Math.Sqrt(_mean * (1.0 - successProbability));
        _useNormalApproximation = trials > ExactSamplingTrialLimit;
    }

    /// <summary>Gets the expected value, <c>n p</c>.</summary>
    public double Mean => _mean;

    /// <summary>Gets the variance, <c>n p (1 - p)</c>.</summary>
    public double Variance => _mean * (1.0 - _successProbability);

    /// <summary>Evaluates the probability mass function.</summary>
    /// <param name="k">The number of successes to evaluate at.</param>
    /// <returns>The probability of exactly <paramref name="k"/> successes, zero outside <c>[0, n]</c>.</returns>
    /// <remarks>
    /// Evaluated as <c>exp(lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1) + k log p +
    /// (n - k) log(1 - p))</c>, so neither the binomial coefficient nor the powers overflow. The
    /// two boundary masses take their exact closed form instead, which keeps <c>p^k</c> and
    /// <c>(1 - p)^n</c> free of the log-space rounding the interior masses pay.
    /// </remarks>
    public double Probability(int k) => Mass(_trials, _successProbability, k);

    /// <summary>Evaluates the cumulative distribution function.</summary>
    /// <param name="k">The number of successes to evaluate at.</param>
    /// <returns>The probability of drawing at most <paramref name="k"/> successes.</returns>
    /// <remarks>
    /// A cold summation over <c>0..k</c>, or over the complementary tail through
    /// <c>F(k; n, p) = 1 - F(n - k - 1; n, 1 - p)</c>, whichever covers fewer terms.
    /// </remarks>
    public double CumulativeProbability(int k)
    {
        if (k < 0)
        {
            return 0.0;
        }

        if (k >= _trials)
        {
            return 1.0;
        }

        if ((long)k * 2L <= _trials)
        {
            return Math.Clamp(SumLowerTail(_trials, _successProbability, k), 0.0, 1.0);
        }

        return Math.Clamp(1.0 - SumLowerTail(_trials, 1.0 - _successProbability, _trials - k - 1), 0.0, 1.0);
    }

    /// <summary>Inverts the cumulative distribution function.</summary>
    /// <param name="probability">The target cumulative probability, in <c>[0, 1]</c>.</param>
    /// <returns>The smallest success count whose cumulative probability reaches the target.</returns>
    /// <remarks>
    /// A lower-bound binary search over the support <c>[0, n]</c>. Each probe is one CDF
    /// evaluation, so a quantile costs <c>O(log n)</c> sums - acceptable on a cold query path,
    /// not on a per-frame one. The endpoints are answered directly rather than searched: a
    /// bounded support makes <c>F(0) = 0</c> and <c>F(n) = 1</c> exact, whereas the floating-point
    /// CDF saturates to one several counts early and a search would report that artefact.
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="probability"/> is NaN or outside <c>[0, 1]</c>.</exception>
    public int Quantile(double probability)
    {
        DistributionMath.ValidateUnitInterval(probability, nameof(probability));

        if (probability >= 1.0)
        {
            return _trials;
        }

        int low = 0;
        int high = _trials;
        while (low < high)
        {
            int middle = low + ((high - low) >> 1);
            if (CumulativeProbability(middle) >= probability)
            {
                high = middle;
            }
            else
            {
                low = middle + 1;
            }
        }

        return low;
    }

    /// <summary>Draws one sample.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <returns>A number of successes in <c>[0, n]</c>.</returns>
    /// <remarks>
    /// The exact summation and the normal approximation both sit behind this one inlinable
    /// dispatch, so the branch costs a single compare at the call site while the two leaves stay
    /// out of line.
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int Sample<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine> =>
        _useNormalApproximation ? SampleNormalApproximation(ref engine) : SampleExact(ref engine);

    /// <summary>Fills the destination with independent samples.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <remarks>
    /// The loop hoists nothing because the engine already arrives by reference: the state is
    /// advanced in the caller's storage for the whole batch, with no field reload per draw and no
    /// allocation. The hoisting gate belongs to <see cref="RandomEngine{TEngine}"/>, whose state
    /// hides behind a field; by-ref passing is that hoist, performed by the parameter itself.
    /// </remarks>
    public void SampleMany<TEngine>(ref TEngine engine, Span<int> destination)
        where TEngine : struct, IRandomSource<TEngine>
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = Sample(ref engine);
        }
    }

    /// <summary>Sums the masses of <c>0..k</c> for the given parameters.</summary>
    private static double SumLowerTail(int trials, double successProbability, int k)
    {
        double total = 0.0;
        for (int i = 0; i <= k; i++)
        {
            total += Mass(trials, successProbability, i);
        }

        return total;
    }

    /// <summary>Evaluates the mass of <paramref name="k"/> successes in log space.</summary>
    private static double Mass(int trials, double successProbability, int k)
    {
        if (k < 0 || k > trials)
        {
            return 0.0;
        }

        // The degenerate rates short-circuit: log(0) would otherwise turn k * log(p) into NaN.
        if (successProbability <= 0.0)
        {
            return k == 0 ? 1.0 : 0.0;
        }

        if (successProbability >= 1.0)
        {
            return k == trials ? 1.0 : 0.0;
        }

        // The two boundary masses are plain powers; taking the closed form keeps P(0) = (1 - p)^n
        // and P(n) = p^n exact instead of paying the log-space round trip of four log-gammas.
        if (k == 0)
        {
            return Math.Pow(1.0 - successProbability, trials);
        }

        if (k == trials)
        {
            return Math.Pow(successProbability, trials);
        }

        double failures = trials - k;
        double logMass = DistributionMath.LogGamma(trials + 1.0)
            - DistributionMath.LogGamma(k + 1.0)
            - DistributionMath.LogGamma(failures + 1.0)
            + (k * Math.Log(successProbability))
            + (failures * DistributionMath.LogOneMinus(successProbability));

        return Math.Exp(logMass);
    }

    /// <summary>Sums the configured trial count of Bernoulli outcomes through the by-ref engine.</summary>
    private int SampleExact<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine>
    {
        double threshold = _successProbability;
        int successes = 0;
        for (int trial = 0; trial < _trials; trial++)
        {
            if (DistributionMath.NextUnitDouble(ref engine) < threshold)
            {
                successes++;
            }
        }

        return successes;
    }

    /// <summary>
    /// Draws <c>round(n p + sqrt(n p (1 - p)) * Z)</c> with a standard normal deviate <c>Z</c>,
    /// clamped to <c>[0, n]</c>. <c>Z</c> comes from Box-Muller over two unit draws of the
    /// by-ref engine: the facade's pair cache cannot be reused here because a distribution is a
    /// readonly struct with nowhere to keep the spare deviate.
    /// </summary>
    private int SampleNormalApproximation<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine>
    {
        double u1 = DistributionMath.NextOpenUnitDouble(ref engine);
        double u2 = DistributionMath.NextUnitDouble(ref engine);
        double deviate = Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Cos(2.0 * Math.PI * u2);

        double value = Math.Round(_mean + (_standardDeviation * deviate));
        return value < 0.0 ? 0 : (value > _trials ? _trials : (int)value);
    }
}

/// <summary>
/// Geometric(p), counted as the number of trials up to and including the first success: the
/// support is <c>1, 2, 3, ...</c>, the mean is <c>1 / p</c> and the variance is
/// <c>(1 - p) / p^2</c>. Sampling is the inverse CDF in one logarithm per draw.
/// </summary>
/// <remarks>
/// <para><b>Counting convention.</b> This is the "trials until first success" parameterisation,
/// not the "failures before first success" one: the support starts at 1, and a certain outcome
/// <c>p = 1</c> is the point mass at 1.</para>
/// <para><b>By-ref sampling is the hoisted form.</b> <see cref="Sample{TEngine}"/> and
/// <see cref="SampleMany{TEngine}"/> advance the engine through a by-ref parameter, so a batch
/// loop keeps the state in the caller's own storage - the register-resident form the hoisting gate
/// buys for a heap-held <see cref="RandomEngine{TEngine}"/>, obtained without the copy.</para>
/// </remarks>
public readonly struct GeometricDistribution
{
    private readonly double _successProbability;
    private readonly double _logComplement;

    /// <summary>Initialises a geometric distribution.</summary>
    /// <param name="successProbability">The per-trial success probability, in <c>(0, 1]</c>.</param>
    /// <exception cref="ArgumentOutOfRangeException">
    /// <paramref name="successProbability"/> is NaN, negative or above 1. A zero probability has
    /// no support - the trial count would be unbounded - so it is rejected here rather than
    /// producing an infinite loop at sampling time.
    /// </exception>
    public GeometricDistribution(double successProbability)
    {
        if (double.IsNaN(successProbability) || successProbability <= 0.0 || successProbability > 1.0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(successProbability), "The success probability must be within (0, 1].");
        }

        _successProbability = successProbability;

        // log(1 - p) depends on the rate alone, so it is paid once here rather than per draw. At
        // p = 1 it is -inf, which is what collapses the sampler to the point mass at 1.
        _logComplement = DistributionMath.LogOneMinus(successProbability);
    }

    /// <summary>Gets the expected number of trials, <c>1 / p</c>.</summary>
    public double Mean => 1.0 / _successProbability;

    /// <summary>Gets the variance, <c>(1 - p) / p^2</c>.</summary>
    public double Variance => (1.0 - _successProbability) / (_successProbability * _successProbability);

    /// <summary>Evaluates the probability mass function.</summary>
    /// <param name="k">The trial count to evaluate at.</param>
    /// <returns>The probability of <paramref name="k"/> trials, zero below 1.</returns>
    public double Probability(int k) =>
        k < 1 ? 0.0 : _successProbability * Math.Pow(1.0 - _successProbability, k - 1);

    /// <summary>Evaluates the cumulative distribution function.</summary>
    /// <param name="k">The trial count to evaluate at.</param>
    /// <returns>The probability of finishing within <paramref name="k"/> trials.</returns>
    /// <remarks>
    /// <c>1 - (1 - p)^k</c> evaluated as <c>OneMinusExp(k * log(1 - p))</c> in log space, so the
    /// small tail a tiny <c>p</c> produces is not cancelled against 1.
    /// </remarks>
    public double CumulativeProbability(int k) =>
        k < 1 ? 0.0 : DistributionMath.OneMinusExp(k * _logComplement);

    /// <summary>Inverts the cumulative distribution function in closed form.</summary>
    /// <param name="probability">The target cumulative probability, in <c>[0, 1]</c>.</param>
    /// <returns>
    /// The smallest trial count whose cumulative probability reaches the target, clamped to the
    /// support: 1 at probability zero, <see cref="int.MaxValue"/> at probability one.
    /// </returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="probability"/> is NaN or outside <c>[0, 1]</c>.</exception>
    public int Quantile(double probability)
    {
        DistributionMath.ValidateUnitInterval(probability, nameof(probability));

        if (probability <= 0.0)
        {
            return 1;
        }

        if (probability >= 1.0)
        {
            // The support is unbounded, so no finite trial count reaches probability one; the
            // representable end is the documented clamp rather than an overflowed cast.
            return int.MaxValue;
        }

        // F(k) >= t  <=>  (1 - p)^k <= 1 - t  <=>  k >= log(1 - t) / log(1 - p). Both logarithms are
        // negative, so the division is the increasing branch and the answer is its ceiling.
        double trials = Math.Ceiling(DistributionMath.LogOneMinus(probability) / _logComplement);
        if (trials >= int.MaxValue)
        {
            return int.MaxValue;
        }

        return trials < 1.0 ? 1 : (int)trials;
    }

    /// <summary>
    /// Draws <c>floor(log(1 - u) / log(1 - p)) + 1</c> from one unit draw <c>u</c>.
    /// </summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <returns>A trial count in <c>[1, int.MaxValue]</c>.</returns>
    /// <remarks>
    /// <c>1 - u</c> lies in <c>(0, 1]</c> for a unit draw, so the numerator is never
    /// <c>log(0)</c>, and the result is at least 1 because both logarithms are non-positive. The
    /// denominator is the constructor's <c>log(1 - p)</c>, computed in log space so that a <c>p</c>
    /// near the double epsilon does not collapse to zero. At <c>p = 1</c> it is <c>-inf</c>, the
    /// quotient collapses to zero and the draw is the point mass at 1 - the degenerate
    /// distribution, handled by the algebra rather than by a special case.
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int Sample<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine>
    {
        double unit = DistributionMath.NextUnitDouble(ref engine);
        double trials = Math.Floor(Math.Log(1.0 - unit) / _logComplement) + 1.0;
        return trials >= int.MaxValue ? int.MaxValue : (int)trials;
    }

    /// <summary>Fills the destination with independent samples.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <remarks>
    /// Nothing is hoisted because the engine arrives by reference: the loop advances the caller's
    /// own state in place, which is exactly the hoist the <see cref="RandomConfig.MaxHoistableStateBytes"/>
    /// gate performs for a heap-held engine, minus the copy.
    /// </remarks>
    public void SampleMany<TEngine>(ref TEngine engine, Span<int> destination)
        where TEngine : struct, IRandomSource<TEngine>
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = Sample(ref engine);
        }
    }
}

/// <summary>
/// Poisson(lambda): the count of events in a fixed interval of mean <c>lambda</c>. Sampling
/// switches algorithm at <see cref="PtrsThreshold"/>: Knuth's multiply loop below it, Hörmann's
/// PTRS transformed rejection above it.
/// </summary>
/// <remarks>
/// <para><b>Why the switch.</b> Knuth's method costs one exponential, one multiplication and one
/// logarithm per <em>trial of the acceptance loop</em>, and that loop runs about <c>lambda + 1</c>
/// times - so its cost grows with the rate, and at <c>lambda = 100</c> it would average a hundred
/// engine steps per sample. PTRS replaces the loop with one proposal, two logarithms and an
/// acceptance test, independent of <c>lambda</c>; it needs its constants, and the log-gamma, which
/// is why the crossover sits at 10 rather than at 1.</para>
/// <para><b>By-ref sampling is the hoisted form.</b> Both branches advance the engine through a
/// by-ref parameter, so <see cref="SampleMany{TEngine}"/> keeps the state in the caller's storage
/// for the whole batch instead of reloading it from a field per draw.</para>
/// <para>The PTRS constants depend only on the rate, so they are computed once in the constructor
/// and the rejection loop pays two logarithms per candidate.</para>
/// </remarks>
public readonly struct PoissonDistribution
{
    /// <summary>
    /// The rate at and above which Hörmann's PTRS transformed rejection replaces Knuth's loop.
    /// </summary>
    public const double PtrsThreshold = 10.0;

    private readonly double _lambda;
    private readonly double _logLambda;
    private readonly double _beta;
    private readonly double _alpha;
    private readonly double _acceptanceThreshold;

    /// <summary>Initialises a Poisson distribution.</summary>
    /// <param name="lambda">The mean count; must be finite and non-negative.</param>
    /// <exception cref="ArgumentOutOfRangeException">
    /// <paramref name="lambda"/> is NaN, negative or infinite.
    /// </exception>
    public PoissonDistribution(double lambda)
    {
        if (double.IsNaN(lambda) || lambda < 0.0 || double.IsInfinity(lambda))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(lambda), "The Poisson rate must be finite and non-negative.");
        }

        _lambda = lambda;
        _logLambda = lambda > 0.0 ? Math.Log(lambda) : 0.0;

        if (lambda >= PtrsThreshold)
        {
            // Hörmann's PTRS constants, hoisted out of the rejection loop: they depend on the
            // rate alone, so a candidate pays two logarithms instead of five.
            _beta = Math.PI / Math.Sqrt(3.0 * lambda);
            _alpha = _beta * lambda;
            double squeeze = 0.767 - (3.36 / lambda);
            _acceptanceThreshold = Math.Log(squeeze) - lambda - Math.Log(_beta);
        }
        else
        {
            _beta = 0.0;
            _alpha = 0.0;
            _acceptanceThreshold = 0.0;
        }
    }

    /// <summary>Gets the expected count, <c>lambda</c>.</summary>
    public double Mean => _lambda;

    /// <summary>Gets the variance, <c>lambda</c>.</summary>
    public double Variance => _lambda;

    /// <summary>Evaluates the probability mass function.</summary>
    /// <param name="k">The count to evaluate at.</param>
    /// <returns>The probability of exactly <paramref name="k"/> events, zero below 0.</returns>
    /// <remarks>
    /// <c>exp(-lambda + k log lambda - lgamma(k + 1))</c> in log space, so a rate or a count
    /// that would overflow the factorial never overflows the mass. The empty-count mass takes its
    /// exact closed form <c>exp(-lambda)</c> instead of riding the same round trip.
    /// </remarks>
    public double Probability(int k)
    {
        if (k < 0)
        {
            return 0.0;
        }

        if (_lambda == 0.0)
        {
            return k == 0 ? 1.0 : 0.0;
        }

        return Mass(_lambda, _logLambda, k);
    }

    /// <summary>Evaluates the cumulative distribution function.</summary>
    /// <param name="k">The count to evaluate at.</param>
    /// <returns>The probability of drawing at most <paramref name="k"/> events.</returns>
    /// <remarks>
    /// A cold query path that sums the shorter side: the head <c>0..k</c> when <c>k</c> sits below
    /// the mean, otherwise the geometric tail above <c>k</c>, whose terms decay by
    /// <c>lambda / k</c> per step.
    /// </remarks>
    public double CumulativeProbability(int k)
    {
        if (k < 0)
        {
            return 0.0;
        }

        if (_lambda == 0.0)
        {
            return 1.0;
        }

        if ((double)k + 1.0 <= _lambda)
        {
            double total = 0.0;
            for (int i = 0; i <= k; i++)
            {
                total += Mass(_lambda, _logLambda, i);
            }

            return Math.Clamp(total, 0.0, 1.0);
        }

        // P(X > k) = P(X >= k + 1) * (1 + lambda/(k + 2) + lambda^2/((k + 2)(k + 3)) + ...).
        double index = (double)k + 1.0;
        double term = Mass(_lambda, _logLambda, index);
        double tail = term;
        while (term > 0.0)
        {
            index += 1.0;
            term *= _lambda / index;
            tail += term;
        }

        return Math.Clamp(1.0 - tail, 0.0, 1.0);
    }

    /// <summary>Inverts the cumulative distribution function.</summary>
    /// <param name="probability">The target cumulative probability, in <c>[0, 1]</c>.</param>
    /// <returns>The smallest count whose cumulative probability reaches the target.</returns>
    /// <remarks>
    /// A lower-bound binary search over <c>[0, int.MaxValue]</c>: the tail branch of
    /// <see cref="CumulativeProbability"/> underflows to zero immediately above the mean, so a
    /// probe far outside the bulk costs one logarithm. An unbounded support has no finite
    /// quantile of exactly one, so a target of 1 converges to the smallest count whose
    /// cumulative probability rounds to one - the saturation point of the double, not a search
    /// failure.
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="probability"/> is NaN or outside <c>[0, 1]</c>.</exception>
    public int Quantile(double probability)
    {
        DistributionMath.ValidateUnitInterval(probability, nameof(probability));

        int low = 0;
        int high = int.MaxValue;
        while (low < high)
        {
            int middle = low + ((high - low) >> 1);
            if (CumulativeProbability(middle) >= probability)
            {
                high = middle;
            }
            else
            {
                low = middle + 1;
            }
        }

        return low;
    }

    /// <summary>Draws one sample, dispatching to Knuth or PTRS by rate.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <returns>A non-negative event count.</returns>
    /// <remarks>
    /// The dispatch is the inlinable part; the two samplers stay out of line, so the call site
    /// pays one compare for the algorithm choice and no register pressure for the leaf it picks.
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int Sample<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine> =>
        _lambda < PtrsThreshold ? SampleKnuth(ref engine) : SamplePtrs(ref engine);

    /// <summary>Fills the destination with independent samples.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <remarks>
    /// The loop hoists nothing by design: <paramref name="engine"/> is already a by-ref local, so
    /// the state lives in the caller's storage for the whole batch. The hoisting lesson from
    /// <see cref="RandomEngine{TEngine}.NextBytes(Span{byte})"/> - where a field reload per word
    /// had to be traded off against a per-word state copy - applies only to heap-held engines,
    /// and by-ref passing is that hoist done once by the parameter instead of per word.
    /// </remarks>
    public void SampleMany<TEngine>(ref TEngine engine, Span<int> destination)
        where TEngine : struct, IRandomSource<TEngine>
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = Sample(ref engine);
        }
    }

    /// <summary>Evaluates the mass of a fractional-safe count in log space.</summary>
    private static double Mass(double lambda, double logLambda, double k)
    {
        if (k == 0.0)
        {
            return Math.Exp(-lambda);
        }

        return Math.Exp((-lambda) + (k * logLambda) - DistributionMath.LogGamma(k + 1.0));
    }

    /// <summary>
    /// Knuth's method: multiply unit draws until the running product drops to
    /// <c>exp(-lambda)</c>. The accepted count is one less than the number of draws, because the
    /// product is compared against the limit <em>after</em> the draw that crossed it.
    /// </summary>
    private int SampleKnuth<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine>
    {
        double limit = Math.Exp(-_lambda);
        double product = 1.0;
        int draws = 0;
        do
        {
            draws++;
            product *= DistributionMath.NextUnitDouble(ref engine);
        }
        while (product > limit);

        return draws - 1;
    }

    /// <summary>
    /// Hörmann's PTRS transformed rejection: one proposal per candidate, accepted when the
    /// acceptance function falls below the target mass.
    /// </summary>
    private int SamplePtrs<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine>
    {
        while (true)
        {
            double u = DistributionMath.NextOpenUnitDouble(ref engine);
            double x = (_alpha - Math.Log((1.0 - u) / u)) / _beta;
            double candidate = Math.Floor(x + 0.5);
            if (candidate < 0.0)
            {
                // The proposal reached below zero; the next candidate costs two draws, not a
                // logarithm of the acceptance function.
                continue;
            }

            // Saturate rather than overflow the cast: an out-of-representation candidate is
            // still accepted or rejected by the same test, so the loop always terminates.
            double count = candidate > int.MaxValue ? int.MaxValue : candidate;

            double y = _alpha - (_beta * x);
            double v = DistributionMath.NextOpenUnitDouble(ref engine);

            // log(v / (1 + e^y)^2), written as -2 * log(1 + e^y) + y and then split on the sign of
            // y: the positive branch carries the leading y down itself, so no intermediate
            // exponential can overflow into an unconditional accept, and the leading y terms
            // cannot cancel either.
            double acceptance = y > 0.0
                ? Math.Log(v) - y - (2.0 * Math.Log(1.0 + Math.Exp(-y)))
                : y + Math.Log(v) - (2.0 * Math.Log(1.0 + Math.Exp(y)));
            double target = _acceptanceThreshold + (count * _logLambda) - DistributionMath.LogGamma(count + 1.0);

            if (acceptance <= target)
            {
                return (int)count;
            }
        }
    }
}

/// <summary>
/// Normal(mu, sigma): the continuous bell curve, sampled with the Marsaglia polar method and
/// queried through a series/tail-continued-fraction error function rather than a fitted table.
/// </summary>
/// <remarks>
/// <para><b>Why polar.</b> The polar method is the web distribution's default algorithm, and it is
/// also the cheaper one here: it spends two uniform draws and a square root per accepted deviate
/// against Box-Muller's two transcendentals of a <c>log</c>, and its rejection rate is
/// <c>pi/4</c> - about one draw in six comes back free of <c>Sin</c>/<c>Cos</c> entirely.</para>
/// <para><b>No cached pair.</b> Box-Muller produces deviates in pairs and the web surface parks the
/// spare in a module-level variable. A distribution here is a value type and must stay immutable and
/// shareable, so the spare would have to live in the caller's engine - which is exactly what
/// <see cref="RandomEngine{TEngine}.NextNormal(double, double)"/> already does. Reach for that
/// member when the pair cache matters and for this struct when the query surface does.</para>
/// <para><b>Accuracy.</b> <see cref="Probability(double)"/>, <see cref="CumulativeProbability(double)"/>
/// and <see cref="Quantile(double)"/> inherit the error function's accuracy, which is at the double
/// limit over the series domain and over the whole tail domain.</para>
/// </remarks>
public readonly struct NormalDistribution
{
    private readonly double _mean;
    private readonly double _standardDeviation;

    /// <summary>Initialises the standard normal distribution.</summary>
    public NormalDistribution()
        : this(0.0, 1.0)
    {
    }

    /// <summary>Initialises a normal distribution.</summary>
    /// <param name="mean">The location.</param>
    /// <param name="standardDeviation">The scale; finite and strictly positive.</param>
    /// <exception cref="ArgumentOutOfRangeException">
    /// A parameter is not finite, or <paramref name="standardDeviation"/> is not positive.
    /// </exception>
    public NormalDistribution(double mean = 0.0, double standardDeviation = 1.0)
    {
        if (!double.IsFinite(mean) || !double.IsFinite(standardDeviation) || standardDeviation <= 0.0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(
                nameof(standardDeviation),
                "The mean must be finite and the standard deviation must be finite and positive.");
        }

        _mean = mean;
        _standardDeviation = standardDeviation;
    }

    /// <summary>Gets the location parameter.</summary>
    public double Mean => _mean;

    /// <summary>Gets the scale parameter.</summary>
    public double StandardDeviation => _standardDeviation;

    /// <summary>Gets the variance, <c>sigma^2</c>.</summary>
    public double Variance => _standardDeviation * _standardDeviation;

    /// <summary>Evaluates the probability density function.</summary>
    /// <param name="x">The point, finite.</param>
    /// <returns>The density at <paramref name="x"/>.</returns>
    /// <remarks>A cold query path: it reads no engine state and consumes no draw.</remarks>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="x"/> is not finite.</exception>
    public double Probability(double x)
    {
        if (!double.IsFinite(x))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(x), "The density argument must be finite.");
        }

        double z = (x - _mean) / _standardDeviation;
        return DistributionMath.NormalDensity(z) / _standardDeviation;
    }

    /// <summary>Evaluates the cumulative distribution function.</summary>
    /// <param name="x">The point, finite.</param>
    /// <returns>The probability of drawing at most <paramref name="x"/>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="x"/> is not finite.</exception>
    public double CumulativeProbability(double x)
    {
        if (!double.IsFinite(x))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(x), "The cumulative argument must be finite.");
        }

        return DistributionMath.NormalCumulative((x - _mean) / _standardDeviation);
    }

    /// <summary>Inverts the cumulative distribution function.</summary>
    /// <param name="probability">The target cumulative probability, in <c>[0, 1]</c>.</param>
    /// <returns>
    /// The deviate whose cumulative probability is <paramref name="probability"/>; the endpoints
    /// return the signed infinities, matching the web surface.
    /// </returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="probability"/> is NaN.</exception>
    public double Quantile(double probability)
    {
        if (double.IsNaN(probability))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(probability), "The probability must not be NaN.");
        }

        return _mean + (_standardDeviation * DistributionMath.NormalQuantile(probability));
    }

    /// <summary>Draws one deviate with the Marsaglia polar method.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <returns>A normally distributed value.</returns>
    /// <remarks>
    /// Each attempt costs two 53-bit unit draws, a sum of squares and, on acceptance, one
    /// logarithm and one square root. Rejections are uniform over the unit disc, so the expected
    /// number of attempts is <c>4 / pi</c>.
    /// </remarks>
    public double Sample<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine>
    {
        while (true)
        {
            double u = (2.0 * DistributionMath.NextUnitDouble(ref engine)) - 1.0;
            double v = (2.0 * DistributionMath.NextUnitDouble(ref engine)) - 1.0;
            double radius = (u * u) + (v * v);

            if (radius >= 1.0 || radius == 0.0)
            {
                continue;
            }

            double scale = Math.Sqrt(-2.0 * Math.Log(radius) / radius);
            return _mean + (_standardDeviation * (u * scale));
        }
    }

    /// <summary>Fills the destination with independent deviates.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    public void SampleMany<TEngine>(ref TEngine engine, Span<double> destination)
        where TEngine : struct, IRandomSource<TEngine>
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = Sample(ref engine);
        }
    }
}

/// <summary>
/// Exponential(lambda): the waiting-time distribution with rate <c>lambda</c>, sampled and inverted
/// in closed form.
/// </summary>
/// <remarks>
/// <para><b>No log(0) and no cancellation.</b> The unit draw is taken over the open interval, and
/// the complement arithmetic goes through <see cref="DistributionMath.LogOneMinus"/> and
/// <see cref="DistributionMath.OneMinusExp"/>, so a probability near zero keeps every significant
/// digit instead of rounding <c>1 - p</c> to one.</para>
/// <para>The sampler is one draw and one logarithm; the support is <c>[0, inf)</c>.</para>
/// </remarks>
public readonly struct ExponentialDistribution
{
    private readonly double _lambda;

    /// <summary>Initialises a unit-rate exponential distribution.</summary>
    public ExponentialDistribution()
        : this(1.0)
    {
    }

    /// <summary>Initialises an exponential distribution.</summary>
    /// <param name="lambda">The rate; finite and strictly positive.</param>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="lambda"/> is not finite and positive.</exception>
    public ExponentialDistribution(double lambda = 1.0)
    {
        if (!double.IsFinite(lambda) || lambda <= 0.0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(lambda), "The rate must be finite and positive.");
        }

        _lambda = lambda;
    }

    /// <summary>Gets the rate parameter.</summary>
    public double Lambda => _lambda;

    /// <summary>Gets the mean, <c>1 / lambda</c>.</summary>
    public double Mean => 1.0 / _lambda;

    /// <summary>Gets the standard deviation, which equals the mean.</summary>
    public double StandardDeviation => 1.0 / _lambda;

    /// <summary>Gets the variance, <c>1 / lambda^2</c>.</summary>
    public double Variance => 1.0 / (_lambda * _lambda);

    /// <summary>Evaluates the probability density function.</summary>
    /// <param name="x">The point, finite.</param>
    /// <returns><c>lambda * e^(-lambda x)</c> above zero, and zero below it.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="x"/> is not finite.</exception>
    public double Probability(double x)
    {
        if (!double.IsFinite(x))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(x), "The density argument must be finite.");
        }

        return x < 0.0 ? 0.0 : _lambda * Math.Exp(-_lambda * x);
    }

    /// <summary>Evaluates the cumulative distribution function.</summary>
    /// <param name="x">The point, finite.</param>
    /// <returns><c>1 - e^(-lambda x)</c> for a non-negative argument, else zero.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="x"/> is not finite.</exception>
    public double CumulativeProbability(double x)
    {
        if (!double.IsFinite(x))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(x), "The cumulative argument must be finite.");
        }

        return x <= 0.0 ? 0.0 : DistributionMath.OneMinusExp(-_lambda * x);
    }

    /// <summary>Inverts the cumulative distribution function.</summary>
    /// <param name="probability">The target cumulative probability, in <c>[0, 1]</c>.</param>
    /// <returns>The waiting time whose cumulative probability is <paramref name="probability"/>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="probability"/> is NaN or outside <c>[0, 1]</c>.</exception>
    public double Quantile(double probability)
    {
        DistributionMath.ValidateUnitInterval(probability, nameof(probability));
        return probability >= 1.0 ? double.PositiveInfinity : -DistributionMath.LogOneMinus(probability) / _lambda;
    }

    /// <summary>Draws one deviate by inverse transform sampling.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <returns>A non-negative exponentially distributed value.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public double Sample<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine> =>
        -DistributionMath.LogOneMinus(DistributionMath.NextUnitDouble(ref engine)) / _lambda;

    /// <summary>Fills the destination with independent deviates.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    public void SampleMany<TEngine>(ref TEngine engine, Span<double> destination)
        where TEngine : struct, IRandomSource<TEngine>
    {
        double inverseLambda = 1.0 / _lambda;
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = -DistributionMath.LogOneMinus(DistributionMath.NextUnitDouble(ref engine)) * inverseLambda;
        }
    }
}

/// <summary>
/// Uniform(min, max): every point of the interval is equally likely, and a draw is one unit
/// multiply-add.
/// </summary>
/// <remarks>
/// <para>The web surface ships this distribution as a sampler only, so this one carries no density,
/// cumulative or quantile query: nothing in either engine consumes them, and opening them would be
/// surface without a caller.</para>
/// <para><c>min == max</c> is a legal degenerate support and always draws that point.</para>
/// </remarks>
public readonly struct UniformDistribution
{
    private readonly double _min;
    private readonly double _max;

    /// <summary>Initialises the unit interval.</summary>
    public UniformDistribution()
        : this(0.0, 1.0)
    {
    }

    /// <summary>Initialises a uniform distribution over a closed interval.</summary>
    /// <param name="min">The inclusive lower bound; finite.</param>
    /// <param name="max">The inclusive upper bound; finite and not below <paramref name="min"/>.</param>
    /// <exception cref="ArgumentOutOfRangeException">A bound is not finite, or <paramref name="min"/> exceeds <paramref name="max"/>.</exception>
    public UniformDistribution(double min = 0.0, double max = 1.0)
    {
        if (!double.IsFinite(min) || !double.IsFinite(max) || min > max)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(min), "Both bounds must be finite and min must not exceed max.");
        }

        _min = min;
        _max = max;
    }

    /// <summary>Gets the inclusive lower bound.</summary>
    public double Min => _min;

    /// <summary>Gets the inclusive upper bound.</summary>
    public double Max => _max;

    /// <summary>Gets the interval length, <c>max - min</c>.</summary>
    public double Range => _max - _min;

    /// <summary>Gets the mean, the interval midpoint.</summary>
    public double Mean => 0.5 * (_min + _max);

    /// <summary>Gets the variance, <c>range^2 / 12</c>.</summary>
    public double Variance
    {
        get
        {
            double range = Range;
            return (range * range) / 12.0;
        }
    }

    /// <summary>Draws one value from the interval.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <returns>A value in <c>[min, max]</c>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public double Sample<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine> =>
        _min + (Range * DistributionMath.NextUnitDouble(ref engine));

    /// <summary>Fills the destination with independent values.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    public void SampleMany<TEngine>(ref TEngine engine, Span<double> destination)
        where TEngine : struct, IRandomSource<TEngine>
    {
        double range = Range;
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = _min + (range * DistributionMath.NextUnitDouble(ref engine));
        }
    }
}

/// <summary>
/// Uniform over the inclusive integer interval <c>[min, max]</c>, drawn with Lemire
/// multiply-shift so the result is exactly uniform without a division.
/// </summary>
/// <remarks>
/// <para><b>Inclusive by contract.</b> The web surface counts <c>max - min + 1</c> values, and that
/// single off-by-one is the whole difference between a fair draw and a truncated one; the width is
/// computed with overflow checking and an overflowing interval is refused at
/// construction rather than wrapping into a smaller one.</para>
/// <para>Like the web surface, this distribution is a sampler: no density or cumulative query
/// exists to keep in step.</para>
/// </remarks>
public readonly struct IntegerDistribution
{
    private readonly long _min;
    private readonly ulong _width;

    /// <summary>Initialises a distribution over an inclusive integer interval.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The inclusive upper bound, not below <paramref name="min"/>.</param>
    /// <exception cref="ArgumentOutOfRangeException">
    /// <paramref name="min"/> exceeds <paramref name="max"/>, or the interval holds more distinct
    /// values than <see cref="ulong"/> can count.
    /// </exception>
    public IntegerDistribution(long min, long max)
    {
        if (min > max)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "The inclusive minimum must not exceed the inclusive maximum.");
        }

        try
        {
            _width = checked((ulong)(max - min) + 1UL);
        }
        catch (OverflowException)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "The inclusive interval is too wide to count its values.");
        }

        _min = min;
    }

    /// <summary>Gets the inclusive lower bound.</summary>
    public long Min => _min;

    /// <summary>Gets the inclusive upper bound.</summary>
    public long Max => unchecked(_min + ((long)_width - 1));

    /// <summary>Gets the number of distinct values the interval holds.</summary>
    public ulong Width => _width;

    /// <summary>Gets the arithmetic mean of the support.</summary>
    public double Mean => _min + ((double)(_width - 1) * 0.5);

    /// <summary>Gets the variance of the support, <c>(w^2 - 1) / 12</c>.</summary>
    public double Variance
    {
        get
        {
            double width = _width;
            return ((width * width) - 1.0) / 12.0;
        }
    }

    /// <summary>Draws one value from the interval.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <returns>A value in <c>[min, max]</c>, exactly uniform over it.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public long Sample<TEngine>(ref TEngine engine)
        where TEngine : struct, IRandomSource<TEngine> =>
        unchecked(_min + (long)DistributionMath.NextBoundedUInt64(ref engine, _width));

    /// <summary>Fills the destination with independent values.</summary>
    /// <typeparam name="TEngine">The engine core to draw from.</typeparam>
    /// <param name="engine">The engine state to advance. It is mutated in place.</param>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    public void SampleMany<TEngine>(ref TEngine engine, Span<long> destination)
        where TEngine : struct, IRandomSource<TEngine>
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = Sample(ref engine);
        }
    }
}
