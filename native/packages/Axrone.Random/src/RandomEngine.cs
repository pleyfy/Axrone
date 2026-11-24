using Axrone.Utility.Internal;

namespace Axrone.Random;

/// <summary>
/// Mutable, allocation-free wrapper around any <see cref="IRandomSource{TSelf}"/> engine
/// core that turns the raw 64-bit/32-bit output of the engine into the distribution
/// surface the engine needs: bounded integers, floats, booleans, normals, exponential
/// deviates, byte fills, shuffles and choices.
/// </summary>
/// <typeparam name="TEngine">
/// The engine core. It is a value type, so the whole wrapper is a value type: copying a
/// <see cref="RandomEngine{TEngine}"/> duplicates the stream, which is what makes a
/// seeded, reproducible sequence possible.
/// </typeparam>
/// <remarks>
/// <para><b>Thread affinity.</b> A <see cref="RandomEngine{TEngine}"/> owns mutable state
/// and is <em>not</em> thread safe. Use <see cref="Random"/> for the ambient thread-local
/// stream and <see cref="ConcurrentRandom"/> for a shared striped stream.</para>
/// <para><b>Bounded draws.</b> Every bounded integer draw uses Lemire's multiply-shift
/// with rejection of the biased low window, and short-circuits to a mask when the range
/// is a power of two (<c>draw &amp; BitOperations.Decrement(range)</c>). Rejection keeps
/// the distribution exactly uniform, and the multiply keeps the accepted draw a single
/// multiply plus one shift.</para>
/// <para><b>Bulk fills.</b> <see cref="NextBytes(Span{byte})"/> hoists the engine state
/// into a local when the state fits the <see cref="RandomConfig.MaxHoistableStateBytes"/>
/// budget, so the loop keeps the state in registers instead of reloading it from the
/// field for every word. Engines whose state exceeds the budget are advanced through the
/// field instead: copying a large state per word would cost more than the reload it
/// avoids.</para>
/// <para><b>Shuffles.</b> <see cref="Shuffle{T}(Span{T})"/> hoists the state the same way,
/// and it matters more there: a permutation writes to its destination on every step, so a
/// state reached through <c>this</c> — an opaque byref the JIT cannot prove disjoint from
/// the destination — is re-materialised into the field around every single swap. Reached
/// through a frame local, the same state stays in registers for the whole permutation.</para>
/// </remarks>
public struct RandomEngine<TEngine> : IEquatable<RandomEngine<TEngine>>
    where TEngine : struct, IRandomSource<TEngine>
{
    private TEngine _engine;
    private double _spareNormal;
    private bool _spareNormalAvailable;
    private readonly RandomConfig _config;

    /// <summary>
    /// Initialises a wrapper around an already seeded engine state.
    /// </summary>
    /// <param name="engine">The seeded engine state to wrap.</param>
    /// <param name="config">
    /// The tuning knobs. A <see langword="default"/> value normalises to
    /// <see cref="RandomConfig.Default"/> on the getter, so it enables hoisting and the
    /// Box-Muller pair cache.
    /// </param>
    public RandomEngine(TEngine engine, RandomConfig config = default)
    {
        _engine = engine;
        _spareNormal = 0d;
        _spareNormalAvailable = false;
        _config = config;
    }

    /// <summary>
    /// Initialises a wrapper around an engine state seeded through
    /// <c>TEngine.Create(seed)</c>.
    /// </summary>
    /// <param name="seed">The seed handed to the engine's static factory.</param>
    /// <param name="config">The tuning knobs; a <see langword="default"/> value is the documented default.</param>
    public RandomEngine(ulong seed, RandomConfig config = default)
        : this(TEngine.Create(seed), config)
    {
    }

    /// <summary>Gets the tuning knobs this wrapper was created with, after getter-side normalisation.</summary>
    public RandomConfig Config => _config;

    /// <summary>Gets the underlying engine state as it stands today.</summary>
    public TEngine Engine => _engine;

    /// <summary>Draws the next raw 64-bit word from the engine.</summary>
    /// <returns>A full-width pseudo-random word.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public ulong NextUInt64()
    {
        // CS8352: a member of an unconstrained type parameter cannot be passed by reference
        // ("it may be in a readonly field or have otherwise non-copyable contents"), so the
        // state is never addressed through the field. It is copied into a local — locals are
        // addressable, so `ref` is legal — advanced through that local and written back
        // exactly once. `in`/readonly parameters are treated the same way: read once into a
        // local and never re-read from the field.
        TEngine engine = _engine;
        ulong value = TEngine.NextUInt64(ref engine);
        _engine = engine;
        return value;
    }

    /// <summary>Draws the next raw 32-bit word from the engine.</summary>
    /// <returns>A full-width pseudo-random word.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public uint NextUInt32()
    {
        TEngine engine = _engine;
        uint value = TEngine.NextUInt32(ref engine);
        _engine = engine;
        return value;
    }

    /// <summary>Draws a 32-bit value in <c>[0, max)</c>.</summary>
    /// <param name="max">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value strictly below <paramref name="max"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public uint NextUInt32(uint max) => max == 0 ? 0u : NextBoundedUInt32(max);

    /// <summary>Draws a 64-bit value in <c>[0, max)</c>.</summary>
    /// <param name="max">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value strictly below <paramref name="max"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public ulong NextUInt64(ulong max) => max == 0 ? 0UL : NextBoundedUInt64(max);

    /// <summary>Draws a non-negative 32-bit signed value.</summary>
    /// <returns>A value in the full <see cref="int"/> domain.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int NextInt32() => unchecked((int)NextUInt32());

    /// <summary>Draws a 32-bit signed value in <c>[0, max)</c>.</summary>
    /// <param name="max">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value in <c>[0, max)</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="max"/> is negative.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int NextInt32(int max)
    {
        if (max < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "A single-argument bound must not be negative.");
        }

        return max == 0 ? 0 : unchecked((int)NextBoundedUInt32((uint)max));
    }

    /// <summary>Draws a 32-bit signed value in <c>[min, max)</c>.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <returns>A value in <c>[min, max)</c>, or <paramref name="min"/> when the range is a single point.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public int NextInt32(int min, int max)
    {
        if (min > max)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "The inclusive minimum must not be greater than the exclusive maximum.");
        }

        if (min == max)
        {
            return min;
        }

        ulong range = (ulong)((long)max - min);
        return unchecked((int)((long)min + (long)NextBoundedUInt64(range)));
    }

    /// <summary>Draws a 64-bit signed value.</summary>
    /// <returns>A value in the full <see cref="long"/> domain.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public long NextInt64() => unchecked((long)NextUInt64());

    /// <summary>Draws a 64-bit signed value in <c>[0, max)</c>.</summary>
    /// <param name="max">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value in <c>[0, max)</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="max"/> is negative.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public long NextInt64(long max)
    {
        if (max < 0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "A single-argument bound must not be negative.");
        }

        return max == 0 ? 0L : unchecked((long)NextBoundedUInt64((ulong)max));
    }

    /// <summary>Draws a 64-bit signed value in <c>[min, max)</c>.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <returns>A value in <c>[min, max)</c>, or <paramref name="min"/> when the range is a single point.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public long NextInt64(long min, long max)
    {
        if (min > max)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "The inclusive minimum must not be greater than the exclusive maximum.");
        }

        if (min == max)
        {
            return min;
        }

        ulong range = (ulong)(max - min);
        return unchecked(min + (long)NextBoundedUInt64(range));
    }

    /// <summary>Draws a single-precision value in <c>[0, 1)</c> at 24 bits of resolution.</summary>
    /// <returns>A value in <c>[0, 1)</c>; the value 1 is never produced.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public float NextSingle() => (NextUInt32() >> 8) * (1.0f / 16777216.0f);

    /// <summary>Draws a single-precision value in <c>[min, max)</c>.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <returns>A value in <c>[min, max)</c>; the upper bound is closed by stepping one ULP down.</returns>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public float NextSingle(float min, float max)
    {
        if (float.IsNaN(min) || float.IsNaN(max))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(min), "Bounds must not be NaN.");
        }

        if (min > max)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "The inclusive minimum must not be greater than the exclusive maximum.");
        }

        if (min == max)
        {
            return min;
        }

        float sample = NextSingle();
        float span = max - min;
        // An inverted or overflowing range (min = -float.MaxValue, max = float.MaxValue) would
        // collapse `min + span * t` to infinity or NaN; lerping the endpoints keeps the
        // interpolation inside [min, max) in that case.
        float value = float.IsFinite(span) ? (min + (span * sample)) : ((min * (1.0f - sample)) + (max * sample));

        // Exclusive-bound closing: rounding can land on max, and never above it.
        if (value >= max)
        {
            return MathF.BitDecrement(max);
        }

        return value < min ? min : value;
    }

    /// <summary>Draws a double-precision value in <c>[0, 1)</c> at 53 bits of resolution.</summary>
    /// <returns>A value in <c>[0, 1)</c>; the value 1 is never produced.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public double NextDouble() => (NextUInt64() >> 11) * (1.0 / 9007199254740992.0);

    /// <summary>Draws a double-precision value in <c>[min, max)</c>.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <returns>A value in <c>[min, max)</c>; the upper bound is closed by stepping one ULP down.</returns>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public double NextDouble(double min, double max)
    {
        if (double.IsNaN(min) || double.IsNaN(max))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(min), "Bounds must not be NaN.");
        }

        if (min > max)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "The inclusive minimum must not be greater than the exclusive maximum.");
        }

        if (min == max)
        {
            return min;
        }

        double sample = NextDouble();
        double span = max - min;
        double value = double.IsFinite(span) ? (min + (span * sample)) : ((min * (1.0 - sample)) + (max * sample));

        // Exclusive-bound closing: rounding can land on max, and never above it.
        if (value >= max)
        {
            return Math.BitDecrement(max);
        }

        return value < min ? min : value;
    }

    /// <summary>Draws a boolean with equal odds.</summary>
    /// <returns><see langword="true"/> or <see langword="false"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool NextBool() => (NextUInt32() & 1u) != 0u;

    /// <summary>Draws a boolean that is <see langword="true"/> with the requested probability.</summary>
    /// <param name="probability">The probability of <see langword="true"/>, in <c>[0, 1]</c>.</param>
    /// <returns><see langword="true"/> with the requested probability.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="probability"/> is outside <c>[0, 1]</c> or NaN.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public bool NextBool(double probability)
    {
        if (double.IsNaN(probability) || probability < 0.0 || probability > 1.0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(probability), "Probability must be within [0, 1].");
        }

        return NextDouble() < probability;
    }

    /// <summary>Draws a normally distributed double via the Box-Muller transform.</summary>
    /// <param name="mean">The distribution mean.</param>
    /// <param name="stdDev">The distribution standard deviation; must be non-negative and finite.</param>
    /// <returns>A normally distributed deviate.</returns>
    /// <remarks>
    /// Box-Muller produces two independent deviates per pair of transcendentals. When
    /// <see cref="RandomConfig.CacheNormalPair"/> is enabled the second deviate is retained
    /// and served by the next call, halving the <c>Log</c>/<c>Sqrt</c>/<c>Sin</c>/<c>Cos</c> cost.
    /// </remarks>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="stdDev"/> is negative, NaN or infinite.</exception>
    public double NextNormal(double mean = 0.0, double stdDev = 1.0)
    {
        if (stdDev < 0.0 || double.IsNaN(stdDev) || double.IsInfinity(stdDev))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(stdDev), "The standard deviation must be finite and non-negative.");
        }

        if (_spareNormalAvailable)
        {
            _spareNormalAvailable = false;
            return mean + (stdDev * _spareNormal);
        }

        double u1;
        do
        {
            u1 = NextDouble();
        }
        while (u1 <= double.Epsilon); // guard log(0)

        double u2 = NextDouble();
        double magnitude = Math.Sqrt(-2.0 * Math.Log(u1));
        double primary = magnitude * Math.Cos(2.0 * Math.PI * u2);
        double secondary = magnitude * Math.Sin(2.0 * Math.PI * u2);

        if (_config.CacheNormalPair)
        {
            _spareNormal = secondary;
            _spareNormalAvailable = true;
        }

        return mean + (stdDev * primary);
    }

    /// <summary>Draws a normally distributed single via the Box-Muller transform.</summary>
    /// <param name="mean">The distribution mean.</param>
    /// <param name="stdDev">The distribution standard deviation; must be non-negative and finite.</param>
    /// <returns>A normally distributed deviate.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="stdDev"/> is negative, NaN or infinite.</exception>
    public float NextNormal(float mean, float stdDev) => (float)NextNormal(mean, stdDev);

    /// <summary>
    /// Draws a standard normal deviate and clamps it into <c>[min, max]</c>, which is the web
    /// engine's bounded-normal sampler: the tails are cut instead of rejected, so the draw is
    /// always defined and the support is the closed interval.
    /// </summary>
    /// <param name="min">The inclusive lower clamp.</param>
    /// <param name="max">The inclusive upper clamp.</param>
    /// <returns>A normal deviate held inside <c>[min, max]</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN or infinite, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    public double NextBoundedNormal(double min = -1.0, double max = 1.0)
    {
        if (double.IsNaN(min) || double.IsNaN(max) || min > max)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(max), "The bounds must be ordered and not NaN.");
        }

        double value = NextNormal();
        if (value < min)
        {
            return min;
        }

        return value > max ? max : value;
    }

    /// <summary>
    /// Draws a normal deviate of one sixth of <paramref name="range"/> and folds it into
    /// <c>center ± range/2</c>, so the interval is the three-sigma window and the support stays
    /// closed - the web engine's in-range normal sampler.
    /// </summary>
    /// <param name="center">The midpoint of the interval.</param>
    /// <param name="range">The interval width; finite and non-negative.</param>
    /// <returns>A value inside <c>[center - range/2, center + range/2]</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="range"/> is NaN, infinite or negative.</exception>
    public double NextNormalInRange(double center, double range)
    {
        if (double.IsNaN(range) || double.IsInfinity(range) || range < 0.0)
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(range), "The range must be finite and non-negative.");
        }

        double half = range * 0.5;
        double deviate = NextNormal(0.0, range / 6.0);
        if (deviate < -half)
        {
            return center - half;
        }

        return deviate > half ? center + half : center + deviate;
    }

    /// <summary>Draws an exponentially distributed double with the given rate.</summary>
    /// <param name="lambda">The rate parameter; must be finite and positive.</param>
    /// <returns>An exponentially distributed deviate.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="lambda"/> is not finite and positive.</exception>
    public double NextExponential(double lambda = 1.0)
    {
        if (lambda <= 0.0 || double.IsNaN(lambda) || double.IsInfinity(lambda))
        {
            ThrowHelper.ThrowArgumentOutOfRangeException(nameof(lambda), "The rate must be finite and positive.");
        }

        // Inverse transform sampling. NextDouble() is in [0, 1), so `1 - sample` is in (0, 1]
        // and log(1) is 0 - never log(0), so no rejection is needed.
        double sample = 1.0 - NextDouble();
        return -Math.Log(sample) / lambda;
    }

    /// <summary>Draws an exponentially distributed single with the given rate.</summary>
    /// <param name="lambda">The rate parameter; must be finite and positive.</param>
    /// <returns>An exponentially distributed deviate.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="lambda"/> is not finite and positive.</exception>
    public float NextExponential(float lambda) => (float)NextExponential((double)lambda);

    /// <summary>Fills the destination with pseudo-random bytes, eight at a time.</summary>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <remarks>
    /// When the engine state fits <see cref="RandomConfig.MaxHoistableStateBytes"/>, the
    /// state is hoisted into a local and the whole loop runs against that local, keeping the
    /// state in registers instead of reloading it from the field per word. Larger states are
    /// advanced through the field: a per-word copy of a large state costs more than the
    /// reload it would avoid.
    /// </remarks>
    public void NextBytes(Span<byte> destination)
    {
        if (destination.IsEmpty)
        {
            return;
        }

        if (Unsafe.SizeOf<TEngine>() <= _config.MaxHoistableStateBytes)
        {
            TEngine engine = _engine;
            FillHoisted(ref engine, destination);
            _engine = engine;
            return;
        }

        FillThroughField(destination);
    }

    /// <summary>Fills the destination with pseudo-random bytes, eight at a time.</summary>
    /// <param name="destination">The array to overwrite; an empty array is a no-op.</param>
    /// <exception cref="ArgumentNullException"><paramref name="destination"/> is <see langword="null"/>.</exception>
    public void NextBytes(byte[] destination)
    {
        ArgumentNullException.ThrowIfNull(destination);
        NextBytes(destination.AsSpan());
    }

    /// <summary>Fills the destination with full-range 32-bit signed values.</summary>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    public void Fill(Span<int> destination)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = NextInt32();
        }
    }

    /// <summary>Fills the destination with values drawn from <c>[min, max)</c>.</summary>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    public void Fill(Span<double> destination, double min, double max)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = NextDouble(min, max);
        }
    }

    /// <summary>Fills the destination with values drawn from <c>[min, max)</c>.</summary>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    public void Fill(Span<float> destination, float min, float max)
    {
        for (int i = 0; i < destination.Length; i++)
        {
            destination[i] = NextSingle(min, max);
        }
    }

    /// <summary>Shuffles the span in place with the Fisher-Yates algorithm.</summary>
    /// <typeparam name="T">The element type.</typeparam>
    /// <param name="destination">The span to permute; spans shorter than two are a no-op.</param>
    /// <remarks>
    /// When the engine state fits <see cref="RandomConfig.MaxHoistableStateBytes"/>, the
    /// state is hoisted into a local for the whole permutation and written back once. This is
    /// a codegen requirement, not a style one: a permutation writes to the destination on
    /// every step, and <c>this</c> is an opaque byref, so a state reached through
    /// <c>this</c> may alias the destination as far as the JIT can prove. The state is
    /// therefore re-materialised into the field before and after each swap. Reached through a
    /// frame local instead, it can never alias the destination, so the loop keeps it in
    /// registers. States above the budget keep advancing through the field, which for a
    /// 2 500-byte Mersenne Twister state is cheaper than the copy it would avoid.
    /// </remarks>
    public void Shuffle<T>(Span<T> destination)
    {
        if (Unsafe.SizeOf<TEngine>() <= _config.MaxHoistableStateBytes)
        {
            TEngine engine = _engine;
            ShuffleHoisted(ref engine, destination);
            _engine = engine;
            return;
        }

        ShuffleThroughField(destination);
    }

    /// <summary>Selects one element uniformly from the sequence.</summary>
    /// <typeparam name="T">The element type.</typeparam>
    /// <param name="items">The non-empty source sequence.</param>
    /// <returns>The selected element.</returns>
    /// <exception cref="ArgumentException"><paramref name="items"/> is empty.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public T Choice<T>(ReadOnlySpan<T> items)
    {
        if (items.IsEmpty)
        {
            ThrowHelper.ThrowArgumentException("Choice requires a non-empty source sequence.");
        }

        return items[(int)NextBoundedUInt32((uint)items.Length)];
    }

    /// <summary>
    /// Compares two wrappers for equality: the normalised configuration, the engine state and
    /// the retained Box-Muller deviate, because the spare deviate is part of what the next
    /// draw will return.
    /// </summary>
    /// <param name="other">The wrapper to compare with.</param>
    /// <returns><see langword="true"/> when both wrappers would produce the same next draw.</returns>
    public bool Equals(RandomEngine<TEngine> other) =>
        _config == other._config
        && _spareNormalAvailable == other._spareNormalAvailable
        && _spareNormal.Equals(other._spareNormal)
        && _engine.Equals(other._engine);

    /// <inheritdoc />
    public override bool Equals(object? obj) => obj is RandomEngine<TEngine> other && Equals(other);

    /// <inheritdoc />
    public override int GetHashCode() => HashCode.Combine(_engine, _config, _spareNormal, _spareNormalAvailable);

    /// <summary>Compares two wrappers for value equality.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when both wrappers would produce the same next draw.</returns>
    public static bool operator ==(RandomEngine<TEngine> left, RandomEngine<TEngine> right) => left.Equals(right);

    /// <summary>Compares two wrappers for value inequality.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when the wrappers would produce different next draws.</returns>
    public static bool operator !=(RandomEngine<TEngine> left, RandomEngine<TEngine> right) => !left.Equals(right);

    /// <summary>
    /// Advances the state in its field and writes one 64-bit word per iteration.
    /// Used when the state exceeds <see cref="RandomConfig.MaxHoistableStateBytes"/>.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private void FillThroughField(Span<byte> destination)
    {
        int offset = 0;
        int limit = destination.Length - (sizeof(ulong) - 1);

        while (offset < limit)
        {
            ulong draw = TEngine.NextUInt64(ref _engine);
            WriteWordLittleEndian(destination, offset, draw);
            offset += sizeof(ulong);
        }

        if (offset < destination.Length)
        {
            ulong tail = TEngine.NextUInt64(ref _engine);
            WriteTailLittleEndian(destination, offset, tail);
        }
    }

    /// <summary>
    /// Advances a hoisted local copy of the state and writes one 64-bit word per iteration.
    /// The state stays in registers for the whole loop and is copied back once at the end.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void FillHoisted(ref TEngine engine, Span<byte> destination)
    {
        int offset = 0;
        int limit = destination.Length - (sizeof(ulong) - 1);

        while (offset < limit)
        {
            ulong draw = TEngine.NextUInt64(ref engine);
            WriteWordLittleEndian(destination, offset, draw);
            offset += sizeof(ulong);
        }

        if (offset < destination.Length)
        {
            ulong tail = TEngine.NextUInt64(ref engine);
            WriteTailLittleEndian(destination, offset, tail);
        }
    }

    /// <summary>
    /// Permutes the span against a hoisted local copy of the state. The state stays in
    /// registers for the whole permutation and is copied back through the caller's reference
    /// exactly once.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void ShuffleHoisted<T>(ref TEngine engine, Span<T> destination)
    {
        for (int i = destination.Length - 1; i > 0; i--)
        {
            int swap = (int)NextBoundedUInt32(ref engine, (uint)(i + 1));
            (destination[i], destination[swap]) = (destination[swap], destination[i]);
        }
    }

    /// <summary>
    /// Permutes the span while advancing the state in its field. Used when the state exceeds
    /// <see cref="RandomConfig.MaxHoistableStateBytes"/>.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private void ShuffleThroughField<T>(Span<T> destination)
    {
        for (int i = destination.Length - 1; i > 0; i--)
        {
            int swap = (int)NextBoundedUInt32((uint)(i + 1));
            (destination[i], destination[swap]) = (destination[swap], destination[i]);
        }
    }

    /// <summary>Writes a 64-bit word little-endian, byte 0 being the least significant.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void WriteWordLittleEndian(Span<byte> destination, int offset, ulong value)
    {
        destination[offset] = (byte)value;
        destination[offset + 1] = (byte)(value >> 8);
        destination[offset + 2] = (byte)(value >> 16);
        destination[offset + 3] = (byte)(value >> 24);
        destination[offset + 4] = (byte)(value >> 32);
        destination[offset + 5] = (byte)(value >> 40);
        destination[offset + 6] = (byte)(value >> 48);
        destination[offset + 7] = (byte)(value >> 56);
    }

    /// <summary>Writes the 1 to 7 remaining bytes of a 64-bit word, least significant byte first.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void WriteTailLittleEndian(Span<byte> destination, int offset, ulong value)
    {
        for (int i = 0; i < destination.Length - offset; i++)
        {
            destination[offset + i] = (byte)(value >> (8 * i));
        }
    }

    /// <summary>
    /// Draws a bounded 32-bit value, reading and writing the state through this wrapper's
    /// field. The state is copied in and out around the draw, exactly as a scalar draw does.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private uint NextBoundedUInt32(uint range)
    {
        TEngine engine = _engine;
        uint value = NextBoundedUInt32(ref engine, range);
        _engine = engine;
        return value;
    }

    /// <summary>
    /// Draws a bounded 32-bit value, advancing the state in place. Taking the state by
    /// reference lets a bulk loop keep it in a local and off the field.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static uint NextBoundedUInt32(ref TEngine engine, uint range)
    {
        if (BitOperations.IsPow2(range))
        {
            // Power-of-two range: the mask closes the exclusive bound with a single AND.
            return TEngine.NextUInt32(ref engine) & (range - 1);
        }

        // Lemire multiply-shift: the accepted draw is one 32x32 multiply and one shift.
        ulong product = (ulong)TEngine.NextUInt32(ref engine) * range;
        uint low = (uint)product;
        if (low >= range)
        {
            return (uint)(product >> 32);
        }

        // The low word under-represents the range; reject draws that land in the biased
        // window [0, threshold) until one lands outside it.
        uint threshold = unchecked(0u - range) % range;
        while (low < threshold)
        {
            product = (ulong)TEngine.NextUInt32(ref engine) * range;
            low = (uint)product;
        }

        return (uint)(product >> 32);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private ulong NextBoundedUInt64(ulong range)
    {
        if (BitOperations.IsPow2(range))
        {
            // Power-of-two range: the mask closes the exclusive bound with a single AND.
            return NextUInt64() & (range - 1);
        }

        if (range <= uint.MaxValue)
        {
            return NextBoundedUInt32((uint)range);
        }

        UInt128 product = (UInt128)NextUInt64() * range;
        ulong low = (ulong)product;
        if (low >= range)
        {
            return (ulong)(product >> 64);
        }

        ulong rejection = unchecked(0UL - range) % range;
        while (low < rejection)
        {
            product = (UInt128)NextUInt64() * range;
            low = (ulong)product;
        }

        return (ulong)(product >> 64);
    }
}
