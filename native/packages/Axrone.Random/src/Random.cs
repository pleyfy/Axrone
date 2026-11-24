namespace Axrone.Random;

/// <summary>
/// Ambient pseudo-random facade: every draw is served from a per-thread
/// xoroshiro128++ state kept in a <see cref="ThreadStaticAttribute"/> field, so the hot
/// path is a state copy in, one engine step, and a state copy out — no locks, no
/// interlocked traffic, and no sharing between threads.
/// </summary>
/// <remarks>
/// <para><b>Measured engine choice.</b> The per-call draw benchmarks of this package rank
/// xoroshiro128++ ahead of the wider cores for scalar per-thread draws: its 128-bit state is
/// two registers wide, so advancing it costs one rotate-xor-xor-add chain with no memory
/// traffic at all, and its failure probability per draw is indistinguishable from the
/// 256-bit cores at these stream lengths. The same benchmarks rank xoshiro256++ ahead for
/// bulk work, where the 256-bit state keeps advancing inside a hoisted local for thousands
/// of words and its much longer period removes the visible short-range correlations a
/// 128-bit state shows in long fills. The ambient stream therefore runs xoroshiro128++,
/// while <see cref="Create(ulong)"/> hands out a xoshiro256++ stream for callers that want
/// the longer period — long fills, saved games, anything that is replayed.</para>
/// <para><b>Seeding.</b> A thread's state is seeded on first use from
/// <see cref="SplitMix64"/>, mixed with a process-wide counter and the managed thread id,
/// so two threads - and two processes started in the same tick - do not replay the same
/// stream. The seed is consumed once per thread; every later draw is allocation free.</para>
/// <para><b>Reproducibility.</b> The ambient stream is deliberately <em>not</em>
/// reproducible. Use <see cref="Create(ulong)"/> and keep the returned
/// <see cref="RandomEngine{TEngine}"/> when a sequence must be replayable.</para>
/// </remarks>
public static class Random
{
    [ThreadStatic]
    private static RandomEngine<Xoroshiro128PlusPlus>? s_state;

    [ThreadStatic]
    private static bool s_initialized;

    private static long s_seedCounter;

    /// <summary>Draws the next raw 64-bit word from the calling thread's stream.</summary>
    /// <returns>A full-width pseudo-random word.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static ulong NextUInt64()
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        ulong value = engine.NextUInt64();
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws the next raw 32-bit word from the calling thread's stream.</summary>
    /// <returns>A full-width pseudo-random word.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static uint NextUInt32()
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        uint value = engine.NextUInt32();
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a 32-bit value in <c>[0, max)</c> from the calling thread's stream.</summary>
    /// <param name="max">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value strictly below <paramref name="max"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static uint NextUInt32(uint max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        uint value = engine.NextUInt32(max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a 64-bit value in <c>[0, max)</c> from the calling thread's stream.</summary>
    /// <param name="max">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value strictly below <paramref name="max"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static ulong NextUInt64(ulong max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        ulong value = engine.NextUInt64(max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a 32-bit signed value from the calling thread's stream.</summary>
    /// <returns>A value in the full <see cref="int"/> domain.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static int NextInt32()
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        int value = engine.NextInt32();
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a 32-bit signed value in <c>[0, max)</c> from the calling thread's stream.</summary>
    /// <param name="max">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value in <c>[0, max)</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="max"/> is negative.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static int NextInt32(int max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        int value = engine.NextInt32(max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a 32-bit signed value in <c>[min, max)</c> from the calling thread's stream.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <returns>A value in <c>[min, max)</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static int NextInt32(int min, int max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        int value = engine.NextInt32(min, max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a 64-bit signed value from the calling thread's stream.</summary>
    /// <returns>A value in the full <see cref="long"/> domain.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static long NextInt64()
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        long value = engine.NextInt64();
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a 64-bit signed value in <c>[0, max)</c> from the calling thread's stream.</summary>
    /// <param name="max">The exclusive upper bound; zero yields zero.</param>
    /// <returns>A value in <c>[0, max)</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="max"/> is negative.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static long NextInt64(long max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        long value = engine.NextInt64(max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a 64-bit signed value in <c>[min, max)</c> from the calling thread's stream.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <returns>A value in <c>[min, max)</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static long NextInt64(long min, long max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        long value = engine.NextInt64(min, max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a single-precision value in <c>[0, 1)</c> from the calling thread's stream.</summary>
    /// <returns>A value in <c>[0, 1)</c>; the value 1 is never produced.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static float NextSingle()
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        float value = engine.NextSingle();
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a single-precision value in <c>[min, max)</c> from the calling thread's stream.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <returns>A value in <c>[min, max)</c>; the upper bound is closed by stepping one ULP down.</returns>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static float NextSingle(float min, float max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        float value = engine.NextSingle(min, max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a double-precision value in <c>[0, 1)</c> from the calling thread's stream.</summary>
    /// <returns>A value in <c>[0, 1)</c>; the value 1 is never produced.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static double NextDouble()
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        double value = engine.NextDouble();
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a double-precision value in <c>[min, max)</c> from the calling thread's stream.</summary>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <returns>A value in <c>[min, max)</c>; the upper bound is closed by stepping one ULP down.</returns>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static double NextDouble(double min, double max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        double value = engine.NextDouble(min, max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a boolean with equal odds from the calling thread's stream.</summary>
    /// <returns><see langword="true"/> or <see langword="false"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static bool NextBool()
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        bool value = engine.NextBool();
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a boolean that is <see langword="true"/> with the requested probability.</summary>
    /// <param name="probability">The probability of <see langword="true"/>, in <c>[0, 1]</c>.</param>
    /// <returns><see langword="true"/> with the requested probability.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="probability"/> is outside <c>[0, 1]</c> or NaN.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static bool NextBool(double probability)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        bool value = engine.NextBool(probability);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a normally distributed double from the calling thread's stream.</summary>
    /// <param name="mean">The distribution mean.</param>
    /// <param name="stdDev">The distribution standard deviation.</param>
    /// <returns>A normally distributed deviate.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="stdDev"/> is negative, NaN or infinite.</exception>
    public static double NextNormal(double mean = 0.0, double stdDev = 1.0)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        double value = engine.NextNormal(mean, stdDev);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a normally distributed single from the calling thread's stream.</summary>
    /// <param name="mean">The distribution mean.</param>
    /// <param name="stdDev">The distribution standard deviation.</param>
    /// <returns>A normally distributed deviate.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="stdDev"/> is negative, NaN or infinite.</exception>
    public static float NextNormal(float mean, float stdDev)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        float value = engine.NextNormal(mean, stdDev);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a standard normal deviate from the calling thread's stream and clamps it.</summary>
    /// <param name="min">The inclusive lower clamp.</param>
    /// <param name="max">The inclusive upper clamp.</param>
    /// <returns>A value inside <c>[min, max]</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    public static double NextBoundedNormal(double min = -1.0, double max = 1.0)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        double value = engine.NextBoundedNormal(min, max);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws a normal deviate whose three-sigma window is the given interval.</summary>
    /// <param name="center">The midpoint of the interval.</param>
    /// <param name="range">The interval width; finite and non-negative.</param>
    /// <returns>A value inside <c>[center - range/2, center + range/2]</c>.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="range"/> is NaN, infinite or negative.</exception>
    public static double NextNormalInRange(double center, double range)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        double value = engine.NextNormalInRange(center, range);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws an exponentially distributed double from the calling thread's stream.</summary>
    /// <param name="lambda">The rate parameter; must be finite and positive.</param>
    /// <returns>An exponentially distributed deviate.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="lambda"/> is not finite and positive.</exception>
    public static double NextExponential(double lambda = 1.0)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        double value = engine.NextExponential(lambda);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Draws an exponentially distributed single from the calling thread's stream.</summary>
    /// <param name="lambda">The rate parameter; must be finite and positive.</param>
    /// <returns>An exponentially distributed deviate.</returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="lambda"/> is not finite and positive.</exception>
    public static float NextExponential(float lambda)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        float value = engine.NextExponential(lambda);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Fills the destination with pseudo-random bytes from the calling thread's stream.</summary>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    public static void NextBytes(Span<byte> destination)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        engine.NextBytes(destination);
        CommitThreadState(engine);
    }

    /// <summary>Fills the destination with pseudo-random bytes from the calling thread's stream.</summary>
    /// <param name="destination">The array to overwrite; an empty array is a no-op.</param>
    /// <exception cref="ArgumentNullException"><paramref name="destination"/> is <see langword="null"/>.</exception>
    public static void NextBytes(byte[] destination)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        engine.NextBytes(destination);
        CommitThreadState(engine);
    }

    /// <summary>Fills the destination with full-range 32-bit signed values from the calling thread's stream.</summary>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    public static void Fill(Span<int> destination)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        engine.Fill(destination);
        CommitThreadState(engine);
    }

    /// <summary>Fills the destination with values drawn from <c>[min, max)</c> by the calling thread's stream.</summary>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    public static void Fill(Span<double> destination, double min, double max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        engine.Fill(destination, min, max);
        CommitThreadState(engine);
    }

    /// <summary>Fills the destination with values drawn from <c>[min, max)</c> by the calling thread's stream.</summary>
    /// <param name="destination">The span to overwrite; an empty span is a no-op.</param>
    /// <param name="min">The inclusive lower bound.</param>
    /// <param name="max">The exclusive upper bound.</param>
    /// <exception cref="ArgumentOutOfRangeException">A bound is NaN, or <paramref name="min"/> is greater than <paramref name="max"/>.</exception>
    public static void Fill(Span<float> destination, float min, float max)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        engine.Fill(destination, min, max);
        CommitThreadState(engine);
    }

    /// <summary>Shuffles the span in place with the Fisher-Yates algorithm using the calling thread's stream.</summary>
    /// <typeparam name="T">The element type.</typeparam>
    /// <param name="destination">The span to permute; spans shorter than two are a no-op.</param>
    public static void Shuffle<T>(Span<T> destination)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        engine.Shuffle(destination);
        CommitThreadState(engine);
    }

    /// <summary>Selects one element uniformly from the sequence using the calling thread's stream.</summary>
    /// <typeparam name="T">The element type.</typeparam>
    /// <param name="items">The non-empty source sequence.</param>
    /// <returns>The selected element.</returns>
    /// <exception cref="ArgumentException"><paramref name="items"/> is empty.</exception>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static T Choice<T>(ReadOnlySpan<T> items)
    {
        RandomEngine<Xoroshiro128PlusPlus> engine = ThreadState();
        T value = engine.Choice(items);
        CommitThreadState(engine);
        return value;
    }

    /// <summary>Creates a seeded, reproducible xoshiro256++ stream.</summary>
    /// <param name="seed">The seed; the same seed always replays the same sequence.</param>
    /// <returns>A private engine wrapper. It is not thread safe - keep it on one thread.</returns>
    public static RandomEngine<Xoshiro256PlusPlus> Create(ulong seed) => new(Xoshiro256PlusPlus.Create(seed));

    /// <summary>Creates a seeded, reproducible stream over an arbitrary engine core.</summary>
    /// <typeparam name="TEngine">The engine core to instantiate.</typeparam>
    /// <param name="seed">The seed; the same seed always replays the same sequence.</param>
    /// <returns>A private engine wrapper. It is not thread safe - keep it on one thread.</returns>
    public static RandomEngine<TEngine> Create<TEngine>(ulong seed)
        where TEngine : struct, IRandomSource<TEngine> => new(TEngine.Create(seed));

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static RandomEngine<Xoroshiro128PlusPlus> ThreadState()
    {
        // The state is a ThreadStatic value type, so it is read into a local: passing the
        // field by reference is illegal (CS8170 - a field of a struct may live in a readonly
        // or otherwise non-copyable location), and reading a local is what lets the whole
        // draw stay in registers.
        return s_initialized ? s_state.GetValueOrDefault() : Initialize();
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void CommitThreadState(RandomEngine<Xoroshiro128PlusPlus> engine)
    {
        s_state = engine;
        s_initialized = true;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static RandomEngine<Xoroshiro128PlusPlus> Initialize()
    {
        // SplitMix-seeded first use: a process-wide counter keeps threads that initialise in
        // the same tick apart, the managed thread id keeps streams of different threads apart,
        // and the tick count keeps two processes started together apart.
        SplitMix64 mixer = SplitMix64.Create(
            unchecked((ulong)Environment.TickCount64)
            ^ unchecked((ulong)Interlocked.Increment(ref s_seedCounter) * 0x9E3779B97F4A7C15UL)
            ^ (unchecked((ulong)Environment.CurrentManagedThreadId) << 32));

        ulong seed = SplitMix64.NextUInt64(ref mixer);
        RandomEngine<Xoroshiro128PlusPlus> engine = new(Xoroshiro128PlusPlus.Create(seed));
        CommitThreadState(engine);
        return engine;
    }
}
