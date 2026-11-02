using System.Collections.Concurrent;
using System.Reflection;

namespace Axrone.Random.Tests;

/// <summary>
/// Facade-layer contracts of <see cref="RandomEngine{TEngine}"/>: determinism under a fixed
/// seed, the bounded-draw range contract, exclusive-bound closing, and the bulk APIs
/// (<see cref="RandomEngine{TEngine}.NextBytes(Span{byte})"/>, <c>Fill</c>, <c>Shuffle</c>,
/// <c>Choice</c>).
/// </summary>
public class RandomEngineFacadeTests
{
    private const ulong DeterminismSeed = 0x0123456789ABCDEFUL;
    private const int DrawCount = 5_000;

    [Fact]
    public void Create_SameSeed_ReplaysIdenticalRawSequence()
    {
        var first = Random.Create(DeterminismSeed);
        var second = Random.Create(DeterminismSeed);

        for (int i = 0; i < 1_000; i++)
        {
            first.NextUInt64().Should().Be(second.NextUInt64());
            first.NextUInt32().Should().Be(second.NextUInt32());
        }
    }

    [Fact]
    public void Create_SameSeed_ReplaysIdenticalDistributionSequence()
    {
        var first = Random.Create(DeterminismSeed);
        var second = Random.Create(DeterminismSeed);

        for (int i = 0; i < 1_000; i++)
        {
            first.NextInt32(7, 4_000).Should().Be(second.NextInt32(7, 4_000));
            first.NextDouble(-3.5, 12.25).Should().Be(second.NextDouble(-3.5, 12.25));
            first.NextBool(0.25).Should().Be(second.NextBool(0.25));
        }
    }

    [Fact]
    public void EngineWrapper_SameSeed_ReplaysIdenticalSequence()
    {
        var first = new RandomEngine<Xoshiro256PlusPlus>(DeterminismSeed);
        var second = new RandomEngine<Xoshiro256PlusPlus>(DeterminismSeed);

        for (int i = 0; i < 1_000; i++)
        {
            first.NextUInt64().Should().Be(second.NextUInt64());
        }
    }

    [Fact]
    public void EngineWrapper_GenericCreate_SameSeed_ReplaysIdenticalSequence()
    {
        var first = Random.Create<WyRand>(DeterminismSeed);
        var second = Random.Create<WyRand>(DeterminismSeed);

        for (int i = 0; i < 1_000; i++)
        {
            first.NextUInt64().Should().Be(second.NextUInt64());
        }
    }

    [Fact]
    public void Create_DifferentSeed_ProducesDifferentSequence()
    {
        var first = Random.Create(DeterminismSeed);
        var second = Random.Create(DeterminismSeed + 1);

        ulong[] left = new ulong[64];
        ulong[] right = new ulong[64];
        for (int i = 0; i < left.Length; i++)
        {
            left[i] = first.NextUInt64();
            right[i] = second.NextUInt64();
        }

        left.Should().NotEqual(right);
    }

    [Fact]
    public void EngineWrapper_Copy_ForksTheStream()
    {
        var original = Random.Create(DeterminismSeed);
        var fork = original;

        fork.NextUInt64();
        fork.NextUInt64();
        original.NextUInt64().Should().NotBe(fork.NextUInt64());
    }

    [Theory]
    [InlineData(1u)]
    [InlineData(2u)]
    [InlineData(3u)]
    [InlineData(5u)]
    [InlineData(6u)]
    [InlineData(7u)]
    [InlineData(10u)]
    [InlineData(999u)]
    [InlineData(1_000u)]
    [InlineData(65_535u)]
    [InlineData(65_536u)]
    [InlineData(65_537u)]
    [InlineData(1_000_003u)]
    [InlineData(int.MaxValue)]
    [InlineData(uint.MaxValue - 1u)]
    [InlineData(uint.MaxValue)]
    public void NextUInt32_Max_StaysBelowExclusiveBound(uint max)
    {
        var engine = Random.Create(DeterminismSeed ^ max);

        for (int i = 0; i < DrawCount; i++)
        {
            uint value = engine.NextUInt32(max);
            value.Should().BeLessThan(max);
        }
    }

    [Fact]
    public void NextUInt32_ZeroBound_ReturnsZero()
    {
        var engine = Random.Create(DeterminismSeed);
        engine.NextUInt32(0u).Should().Be(0u);
    }

    [Theory]
    [InlineData(3UL)]
    [InlineData(7UL)]
    [InlineData(1_000_003UL)]
    [InlineData(long.MaxValue)]
    [InlineData(ulong.MaxValue - 1UL)]
    [InlineData(ulong.MaxValue)]
    public void NextUInt64_Max_StaysBelowExclusiveBound(ulong max)
    {
        var engine = Random.Create(DeterminismSeed ^ max);

        for (int i = 0; i < DrawCount; i++)
        {
            ulong value = engine.NextUInt64(max);
            value.Should().BeLessThan(max);
        }
    }

    [Fact]
    public void NextInt32_Range_StaysInsideInclusiveMinExclusiveMax()
    {
        var engine = Random.Create(DeterminismSeed);
        (int Min, int Max)[] ranges =
        [
            (int.MinValue, int.MaxValue),
            (-1, 1),
            (0, 1),
            (-2_000_000_000, 2_000_000_000),
            (17, 17),
            (int.MaxValue - 3, int.MaxValue),
        ];

        foreach ((int min, int max) in ranges)
        {
            for (int i = 0; i < DrawCount; i++)
            {
                int value = engine.NextInt32(min, max);
                value.Should().BeGreaterThanOrEqualTo(min);
                if (min != max)
                {
                    value.Should().BeLessThan(max);
                }
            }
        }
    }

    [Fact]
    public void NextInt64_Range_StaysInsideInclusiveMinExclusiveMax()
    {
        var engine = Random.Create(DeterminismSeed);
        (long Min, long Max)[] ranges =
        [
            (long.MinValue, long.MaxValue),
            (-1L, 1L),
            (0L, 1L),
            (long.MaxValue - 5, long.MaxValue),
        ];

        foreach ((long min, long max) in ranges)
        {
            for (int i = 0; i < DrawCount; i++)
            {
                long value = engine.NextInt64(min, max);
                value.Should().BeGreaterThanOrEqualTo(min);
                value.Should().BeLessThan(max);
            }
        }
    }

    [Fact]
    public void NextInt32_InvertedRange_Throws()
    {
        var engine = Random.Create(DeterminismSeed);

        Action act = () => engine.NextInt32(10, 0);
        act.Should().Throw<ArgumentOutOfRangeException>();

        Action longAct = () => engine.NextInt64(10L, 0L);
        longAct.Should().Throw<ArgumentOutOfRangeException>();

        // A single-argument bound has no inclusive lower end, so a negative bound is rejected
        // rather than silently answered with zero.
        Action negativeMax = () => engine.NextInt32(-1);
        negativeMax.Should().Throw<ArgumentOutOfRangeException>();

        Action negativeLongMax = () => engine.NextInt64(-1L);
        negativeLongMax.Should().Throw<ArgumentOutOfRangeException>();

        engine.NextInt32(0).Should().Be(0);
        engine.NextInt64(0L).Should().Be(0L);
    }

    [Fact]
    public void NextDouble_UnitRange_NeverReachesOne()
    {
        var engine = Random.Create(DeterminismSeed);

        for (int i = 0; i < DrawCount; i++)
        {
            double value = engine.NextDouble();
            value.Should().BeGreaterThanOrEqualTo(0.0);
            value.Should().BeLessThan(1.0);
        }
    }

    [Fact]
    public void NextSingle_UnitRange_NeverReachesOne()
    {
        var engine = Random.Create(DeterminismSeed);

        for (int i = 0; i < DrawCount; i++)
        {
            float value = engine.NextSingle();
            value.Should().BeGreaterThanOrEqualTo(0.0f);
            value.Should().BeLessThan(1.0f);
        }
    }

    [Fact]
    public void NextDouble_Range_StaysInsideHalfOpenInterval()
    {
        var engine = Random.Create(DeterminismSeed);
        (double Min, double Max)[] ranges =
        [
            (0.0, 1.0),
            (-1.0, 1.0),
            (-3.75, 12.25),
            (double.MinValue, double.MaxValue),
            (-double.Epsilon, double.Epsilon),
            (1e-300, 1e300),
        ];

        foreach ((double min, double max) in ranges)
        {
            double closed = Math.BitDecrement(max);
            for (int i = 0; i < DrawCount; i++)
            {
                double value = engine.NextDouble(min, max);
                value.Should().BeGreaterThanOrEqualTo(min);
                value.Should().BeLessThanOrEqualTo(closed);
            }
        }
    }

    [Fact]
    public void NextSingle_Range_StaysInsideHalfOpenInterval()
    {
        var engine = Random.Create(DeterminismSeed);
        (float Min, float Max)[] ranges =
        [
            (0.0f, 1.0f),
            (-1.0f, 1.0f),
            (-3.75f, 12.25f),
            (float.MinValue, float.MaxValue),
            (1e-30f, 1e30f),
        ];

        foreach ((float min, float max) in ranges)
        {
            float closed = MathF.BitDecrement(max);
            for (int i = 0; i < DrawCount; i++)
            {
                float value = engine.NextSingle(min, max);
                value.Should().BeGreaterThanOrEqualTo(min);
                value.Should().BeLessThanOrEqualTo(closed);
            }
        }
    }

    [Fact]
    public void NextDouble_InvertedOrNaNRange_Throws()
    {
        var engine = Random.Create(DeterminismSeed);

        Action act = () => engine.NextDouble(1.0, -1.0);
        act.Should().Throw<ArgumentOutOfRangeException>();

        Action nanAct = () => engine.NextDouble(double.NaN, 1.0);
        nanAct.Should().Throw<ArgumentOutOfRangeException>();

        Action singleAct = () => engine.NextSingle(1.0f, -1.0f);
        singleAct.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void NextDouble_DegenerateRange_ReturnsTheSinglePoint()
    {
        var engine = Random.Create(DeterminismSeed);
        engine.NextDouble(2.5, 2.5).Should().Be(2.5);
        engine.NextSingle(2.5f, 2.5f).Should().Be(2.5f);
    }

    [Fact]
    public void NextNormal_IsCentredAndSpreadAsRequested()
    {
        var engine = Random.Create(DeterminismSeed);
        var config = new RandomConfig(maxHoistableStateBytes: 0, stripedSlotCount: 1, cacheNormalPair: true);

        var cached = new RandomEngine<Xoshiro256PlusPlus>(DeterminismSeed, config);
        var uncached = new RandomEngine<Xoshiro256PlusPlus>(DeterminismSeed, new RandomConfig(0, 1, cacheNormalPair: false));

        const int Samples = 50_000;
        double sum = 0.0;
        double sumSquares = 0.0;
        for (int i = 0; i < Samples; i++)
        {
            double value = cached.NextNormal(10.0, 2.0);
            double.IsFinite(value).Should().BeTrue();
            sum += value;
            sumSquares += value * value;
        }

        double mean = sum / Samples;
        double variance = (sumSquares / Samples) - (mean * mean);
        mean.Should().BeApproximately(10.0, 0.1);
        Math.Sqrt(variance).Should().BeApproximately(2.0, 0.1);

        // The cache must not change the distribution, only how often the transcendentals run.
        for (int i = 0; i < 1_000; i++)
        {
            double value = uncached.NextNormal(0.0, 1.0);
            double.IsFinite(value).Should().BeTrue();
        }
    }

    [Fact]
    public void NextNormal_InvalidStandardDeviation_Throws()
    {
        var engine = Random.Create(DeterminismSeed);

        Action negative = () => engine.NextNormal(0.0, -1.0);
        negative.Should().Throw<ArgumentOutOfRangeException>();

        Action infinite = () => engine.NextNormal(0.0, double.PositiveInfinity);
        infinite.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void NextExponential_IsPositiveAndDecays()
    {
        var engine = Random.Create(DeterminismSeed);

        const int Samples = 20_000;
        double sum = 0.0;
        for (int i = 0; i < Samples; i++)
        {
            double value = engine.NextExponential(2.0);
            value.Should().BeGreaterThanOrEqualTo(0.0);
            sum += value;
        }

        // Mean of an exponential with rate 2 is 1/2.
        (sum / Samples).Should().BeApproximately(0.5, 0.05);

        Action act = () => engine.NextExponential(0.0);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void NextBool_Probability_IsRespected()
    {
        var engine = Random.Create(DeterminismSeed);

        int trueCount = 0;
        const int Samples = 20_000;
        for (int i = 0; i < Samples; i++)
        {
            if (engine.NextBool(0.25))
            {
                trueCount++;
            }
        }

        (trueCount / (double)Samples).Should().BeApproximately(0.25, 0.02);

        engine.NextBool(0.0).Should().BeFalse();
        engine.NextBool(1.0).Should().BeTrue();

        Action act = () => engine.NextBool(1.5);
        act.Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void NextBytes_OverwritesEveryByte_ForEveryRemainder()
    {
        var engine = Random.Create(DeterminismSeed);
        byte[] buffer = new byte[128];

        // An empty span is a documented no-op.
        buffer.AsSpan().Clear();
        engine.NextBytes(buffer.AsSpan(0, 0));
        buffer.Should().AllBeEquivalentTo((byte)0);

        for (int length = 1; length <= buffer.Length; length++)
        {
            buffer.AsSpan().Clear();
            engine.NextBytes(buffer.AsSpan(0, length));

            // A filled buffer must not stay all zeros, and the untouched tail must stay zero.
            byte[] filled = buffer.AsSpan(0, length).ToArray();
            filled.Should().NotBeEquivalentTo(new byte[length]);
            buffer.AsSpan(length).ToArray().Should().AllBeEquivalentTo((byte)0);
        }
    }

    [Fact]
    public void NextBytes_HoistGateOff_ProducesTheSameBytes()
    {
        var hoisting = new RandomEngine<Xoshiro256PlusPlus>(DeterminismSeed, new RandomConfig(64, 1, true));
        var notHoisting = new RandomEngine<Xoshiro256PlusPlus>(DeterminismSeed, RandomConfig.Minimal);

        byte[] left = new byte[1024];
        byte[] right = new byte[1024];
        hoisting.NextBytes(left);
        notHoisting.NextBytes(right);

        left.Should().Equal(right);
    }

    [Fact]
    public void NextBytes_NullArray_Throws()
    {
        var engine = Random.Create(DeterminismSeed);

        Action act = () => engine.NextBytes((byte[])null!);
        act.Should().Throw<ArgumentNullException>();
    }

    [Fact]
    public void Fill_StaysInsideTheRequestedRange()
    {
        var engine = Random.Create(DeterminismSeed);

        int[] ints = new int[1_024];
        engine.Fill(ints);
        ints.Distinct().Should().HaveCountGreaterThan(1_000, "a full-range 32-bit fill does not repeat");

        double[] doubles = new double[1_024];
        engine.Fill(doubles, -5.5, 5.5);
        doubles.Should().OnlyContain(value => value >= -5.5 && value < 5.5);

        float[] floats = new float[1_024];
        engine.Fill(floats, 2.0f, 3.0f);
        floats.Should().OnlyContain(value => value >= 2.0f && value < 3.0f);
    }

    [Fact]
    public void Shuffle_PermutesTheMultisetInPlace()
    {
        var engine = Random.Create(DeterminismSeed);
        int[] values = [.. Enumerable.Range(0, 512)];

        engine.Shuffle<int>(values);

        values.Should().BeEquivalentTo(Enumerable.Range(0, 512));
        values.Should().NotEqual(Enumerable.Range(0, 512).ToArray(), "Fisher-Yates on 512 distinct values is not the identity with probability ~1");
    }

    [Fact]
    public void Shuffle_ShortSpans_AreNoOps()
    {
        var engine = Random.Create(DeterminismSeed);

        int[] empty = [];
        engine.Shuffle<int>(empty);
        empty.Should().BeEmpty();

        int[] single = [42];
        engine.Shuffle<int>(single);
        single.Should().Equal(42);
    }

    [Fact]
    public void Choice_VisitsEveryElementAndStaysInRange()
    {
        var engine = Random.Create(DeterminismSeed);
        int[] items = [.. Enumerable.Range(0, 8)];
        var histogram = new int[items.Length];

        const int Samples = 40_000;
        for (int i = 0; i < Samples; i++)
        {
            int picked = engine.Choice<int>(items);
            picked.Should().BeInRange(0, items.Length - 1);
            histogram[picked]++;
        }

        histogram.Should().OnlyContain(count => count > 0, "every element of a uniform choice is reachable");

        // 40k draws over 8 buckets: expected 5000, 5 sigma is ~150.
        foreach (int count in histogram)
        {
            count.Should().BeInRange(4_850, 5_150);
        }
    }

    [Fact]
    public void Choice_EmptySequence_Throws()
    {
        var engine = Random.Create(DeterminismSeed);

        Action act = () => engine.Choice<int>([]);
        act.Should().Throw<ArgumentException>();
    }
}

/// <summary>
/// Contracts of the ambient static <see cref="Random"/> facade: per-thread state, the
/// process-wide draw surface, and the seeded factories.
/// </summary>
public class RandomStaticFacadeTests
{
    [Fact]
    public void NextUInt64_SuccessiveCalls_ProduceDifferentWords()
    {
        Span<ulong> draws = stackalloc ulong[256];
        for (int i = 0; i < draws.Length; i++)
        {
            draws[i] = Random.NextUInt64();
        }

        var distinct = new HashSet<ulong>(draws.ToArray());
        distinct.Count.Should().BeGreaterThan(draws.Length - 16, "a 64-bit draw almost never repeats");
    }

    [Fact]
    public void NextInt32_And_NextBool_ProduceMixedStreams()
    {
        var bools = new bool[1_000];
        for (int i = 0; i < bools.Length; i++)
        {
            Random.NextInt32();
            bools[i] = Random.NextBool();
        }

        bools.Should().Contain(true).And.Contain(false);
    }

    [Fact]
    public void BoundedDraws_RespectTheirBounds()
    {
        for (int i = 0; i < 1_000; i++)
        {
            Random.NextUInt32(7u).Should().BeLessThan(7u);
            Random.NextUInt64(7UL).Should().BeLessThan(7UL);
            Random.NextInt32(-5, 5).Should().BeInRange(-5, 4);
            Random.NextInt64(-5L, 5L).Should().BeInRange(-5L, 4L);
            Random.NextDouble(-2.0, 2.0).Should().BeGreaterThanOrEqualTo(-2.0).And.BeLessThanOrEqualTo(Math.BitDecrement(2.0));
            Random.NextSingle(-2.0f, 2.0f).Should().BeGreaterThanOrEqualTo(-2.0f).And.BeLessThanOrEqualTo(MathF.BitDecrement(2.0f));
        }
    }

    [Fact]
    public void DistributionDraws_AreFinite()
    {
        for (int i = 0; i < 1_000; i++)
        {
            double.IsFinite(Random.NextNormal(3.0, 0.5)).Should().BeTrue();
            Random.NextExponential(1.5).Should().BeGreaterThanOrEqualTo(0.0);
        }
    }

    [Fact]
    public void NextBytes_FillsTheWholeArray()
    {
        byte[] buffer = new byte[4_096];
        Random.NextBytes(buffer);

        // Every byte is overwritten, so the buffer cannot still be the zero fill and covers
        // almost the whole byte alphabet (a single 0x00 in 4096 draws is expected, not a bug).
        buffer.Should().NotBeEquivalentTo(new byte[4_096]);
        buffer.Distinct().Should().HaveCountGreaterThan(200);
    }

    [Fact]
    public void NextBytes_EmptyBuffer_IsANoOp()
    {
        byte[] buffer = [];
        Random.NextBytes(buffer);
        buffer.Should().BeEmpty();
    }

    [Fact]
    public void Shuffle_PermutesTheMultiset()
    {
        int[] values = [.. Enumerable.Range(0, 256)];

        Random.Shuffle<int>(values);

        values.Should().BeEquivalentTo(Enumerable.Range(0, 256));
        values.Should().NotEqual(Enumerable.Range(0, 256).ToArray());
    }

    [Fact]
    public void Fill_StaysInsideTheRequestedRange()
    {
        double[] values = new double[512];
        Random.Fill(values, -1.0, 1.0);
        values.Should().OnlyContain(value => value >= -1.0 && value < 1.0);

        int[] ints = new int[512];
        Random.Fill(ints);
        ints.Distinct().Should().HaveCountGreaterThan(500, "a full-range 32-bit fill does not repeat");

        float[] floats = new float[512];
        Random.Fill(floats, 10.0f, 11.0f);
        floats.Should().OnlyContain(value => value >= 10.0f && value < 11.0f);
    }

    [Fact]
    public void Choice_ReturnsAMemberOfTheSequence()
    {
        string[] items = ["alpha", "beta", "gamma"];
        for (int i = 0; i < 1_000; i++)
        {
            Random.Choice<string>(items).Should().BeOneOf(items);
        }

        Action act = () => Random.Choice<string>([]);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Create_Generic_SameSeed_ReplaysIdenticalSequence()
    {
        var first = Random.Create<WyRand>(0xDEADBEEFCAFEBABEUL);
        var second = Random.Create<WyRand>(0xDEADBEEFCAFEBABEUL);

        for (int i = 0; i < 256; i++)
        {
            first.NextUInt64().Should().Be(second.NextUInt64());
        }
    }

    [Fact]
    public void PerThreadStreams_DifferBetweenThreads()
    {
        ulong[] perThread = new ulong[8];
        var threads = new Thread[perThread.Length];
        for (int i = 0; i < perThread.Length; i++)
        {
            int index = i;
            threads[i] = new Thread(() => perThread[index] = Random.NextUInt64());
            threads[i].Start();
        }

        foreach (Thread thread in threads)
        {
            thread.Join();
        }

        perThread.Distinct().Should().HaveCount(perThread.Length, "each thread owns a separately seeded stream");
    }
}

/// <summary>
/// Contracts of the striped <see cref="ConcurrentRandom"/> facade: liveness and bounds under
/// contention, and the complete/drain/dispose lifecycle. Cross-thread determinism is
/// deliberately not asserted - the stripe a thread lands on depends on scheduling.
/// </summary>
public class RandomConcurrentFacadeTests
{
    [Fact]
    public async Task StripedSlots_AreCacheLineSeparated()
    {
        var source = new ConcurrentRandom(RandomConfig.Default, 1UL);
        try
        {
            source.SlotCount.Should().Be(RandomConfig.Default.StripedSlotCount);
            source.SlotCount.Should().BeGreaterThan(1);
        }
        finally
        {
            await source.DisposeAsync();
        }
    }

    [Fact]
    public void MultithreadedDraws_CompleteAndRespectBounds()
    {
        const int ThreadCount = 8;
        const int DrawsPerThread = 25_000;

        using var source = new ConcurrentRandom(0x0123456789ABCDEFUL);
        var failures = new ConcurrentBag<string>();
        var threads = new Thread[ThreadCount];

        for (int t = 0; t < ThreadCount; t++)
        {
            int index = t;
            threads[t] = new Thread(() =>
            {
                try
                {
                    for (int i = 0; i < DrawsPerThread; i++)
                    {
                        if (source.NextUInt32(1_000u) >= 1_000u)
                        {
                            failures.Add("NextUInt32 escaped its bound");
                            return;
                        }

                        double value = source.NextDouble(-1.0, 1.0);
                        if (value < -1.0 || value > Math.BitDecrement(1.0))
                        {
                            failures.Add("NextDouble escaped its bound");
                            return;
                        }

                        if (source.NextInt32(-4, 4) is < -4 or >= 4)
                        {
                            failures.Add("NextInt32 escaped its bound");
                            return;
                        }

                        source.NextUInt64();
                        source.NextBool();
                    }
                }
                catch (Exception ex)
                {
                    failures.Add($"thread {index} threw {ex.GetType().Name}");
                }
            });

            threads[t].Start();
        }

        foreach (Thread thread in threads)
        {
            thread.Join(TimeSpan.FromSeconds(60)).Should().BeTrue("a striped draw must never deadlock");
        }

        failures.Should().BeEmpty();
        source.IsRunning.Should().BeTrue();
    }

    [Fact]
    public void MultithreadedDraws_ProduceDistinctValues()
    {
        const int ThreadCount = 4;
        const int DrawsPerThread = 4_000;

        using var source = new ConcurrentRandom(0xABCDEF0123456789UL);
        var buckets = new ulong[ThreadCount][];
        var threads = new Thread[ThreadCount];

        for (int t = 0; t < ThreadCount; t++)
        {
            int index = t;
            buckets[index] = new ulong[DrawsPerThread];
            threads[index] = new Thread(() =>
            {
                for (int i = 0; i < DrawsPerThread; i++)
                {
                    buckets[index][i] = source.NextUInt64();
                }
            });
            threads[index].Start();
        }

        foreach (Thread thread in threads)
        {
            thread.Join();
        }

        var all = buckets.SelectMany(static bucket => bucket).ToArray();
        all.Distinct().Should().HaveCount(all.Length, "a 64-bit draw never repeats");
    }

    [Fact]
    public void MultithreadedBulkApis_Complete()
    {
        using var source = new ConcurrentRandom(0x55AA55AA55AA55AAUL);
        var threads = new Thread[4];

        for (int t = 0; t < threads.Length; t++)
        {
            threads[t] = new Thread(() =>
            {
                byte[] buffer = new byte[4_096];
                source.NextBytes(buffer);
                int[] values = [.. Enumerable.Range(0, 128)];
                source.Shuffle<int>(values);
                values.Should().BeEquivalentTo(Enumerable.Range(0, 128));
                source.Choice<string>(["a", "b"]).Should().BeOneOf("a", "b");
                double.IsFinite(source.NextNormal(0.0, 1.0)).Should().BeTrue();
            });
            threads[t].Start();
        }

        foreach (Thread thread in threads)
        {
            thread.Join(TimeSpan.FromSeconds(60)).Should().BeTrue();
        }
    }

    [Fact]
    public async Task Complete_MakesDrawsThrowObjectDisposed()
    {
        var source = new ConcurrentRandom(7UL);
        source.IsRunning.Should().BeTrue();

        source.Complete();
        source.Complete(); // idempotent

        source.IsRunning.Should().BeFalse();
        AssertObjectDisposed(() => source.NextUInt64());
        AssertObjectDisposed(() => source.NextUInt32());
        AssertObjectDisposed(() => source.NextUInt32(10u));
        AssertObjectDisposed(() => source.NextUInt64(10UL));
        AssertObjectDisposed(() => source.NextInt32());
        AssertObjectDisposed(() => source.NextInt32(10));
        AssertObjectDisposed(() => source.NextInt32(0, 10));
        AssertObjectDisposed(() => source.NextInt64());
        AssertObjectDisposed(() => source.NextInt64(10L));
        AssertObjectDisposed(() => source.NextInt64(0L, 10L));
        AssertObjectDisposed(() => source.NextSingle());
        AssertObjectDisposed(() => source.NextSingle(0.0f, 1.0f));
        AssertObjectDisposed(() => source.NextDouble());
        AssertObjectDisposed(() => source.NextDouble(0.0, 1.0));
        AssertObjectDisposed(() => source.NextBool());
        AssertObjectDisposed(() => source.NextBool(0.5));
        AssertObjectDisposed(() => source.NextNormal());
        AssertObjectDisposed(() => source.NextExponential());
        AssertObjectDisposed(() => source.NextBytes(new byte[8]));
        AssertObjectDisposed(() => source.Shuffle<int>([1, 2, 3]));
        AssertObjectDisposed(() => source.Choice<int>([1, 2, 3]));

        await source.DisposeAsync();
    }

    [Fact]
    public async Task DrainAsync_CompletesAndThenDrawsThrow()
    {
        var source = new ConcurrentRandom(11UL);
        source.NextUInt64();

        await source.DrainAsync();

        AssertObjectDisposed(() => source.NextUInt64());

        await source.DisposeAsync();
        AssertObjectDisposed(() => source.NextUInt64());
    }

    [Fact]
    public async Task DrainAsync_WaitsForInFlightDraws()
    {
        var source = new ConcurrentRandom(13UL);
        var gate = new ManualResetEventSlim(false);
        var started = new ManualResetEventSlim(false);
        var stop = new ManualResetEventSlim(false);
        byte[] payload = new byte[64 * 1024 * 1024];
        Exception? workerError = null;
        int completedDraws = 0;

        var worker = new Thread(() =>
        {
            try
            {
                started.Set();
                gate.Wait();
                while (!stop.IsSet)
                {
                    source.NextBytes(payload);
                    Interlocked.Increment(ref completedDraws);
                }
            }
            catch (ObjectDisposedException)
            {
                // The drain completed between two loop iterations; the next draw must throw.
            }
            catch (Exception exception)
            {
                workerError = exception;
            }
        })
        {
            IsBackground = true,
        };

        // The counter is the only observable proof that a draw owns a stripe. Reading it keeps
        // the test deterministic: DrainAsync must not be called until the worker is counted.
        FieldInfo activeDraws = typeof(ConcurrentRandom).GetField(
            "_activeDraws",
            BindingFlags.Instance | BindingFlags.NonPublic)!;

        worker.Start();
        started.Wait();
        gate.Set();

        try
        {
            bool observed = WaitForInFlightDraw(activeDraws, source, timeoutMilliseconds: 15_000);
            observed.Should().BeTrue("the worker draw must be in flight before draining");

            await source.DrainAsync();

            ((int)activeDraws.GetValue(source)!).Should().Be(0);
            AssertObjectDisposed(() => source.NextUInt64());

            worker.Join(TimeSpan.FromSeconds(60)).Should().BeTrue();
            workerError.Should().BeNull();
            Volatile.Read(ref completedDraws).Should().BeGreaterThan(0);
        }
        finally
        {
            stop.Set();
            gate.Set();
            worker.Join(TimeSpan.FromSeconds(60));
            await source.DisposeAsync();
        }
    }

    [Fact]
    public async Task Dispose_IsIdempotentAndStopsDraws()
    {
        var source = new ConcurrentRandom(17UL);
        await source.DisposeAsync();
        await source.DisposeAsync();

        AssertObjectDisposed(() => source.NextUInt64());
    }

    private static void AssertObjectDisposed(Action draw) =>
        Assert.Throws<ObjectDisposedException>(() => draw());

    private static bool WaitForInFlightDraw(
        FieldInfo activeDraws,
        ConcurrentRandom source,
        int timeoutMilliseconds)
    {
        long deadline = Environment.TickCount64 + timeoutMilliseconds;
        while (Environment.TickCount64 < deadline)
        {
            if ((int)activeDraws.GetValue(source)! != 0)
            {
                return true;
            }

            // Sleep grants the worker a slice on constrained machines; a tight Yield loop can
            // starve it and make the observation window unreachable.
            Thread.Sleep(1);
        }

        return false;
    }
}

/// <summary>
/// Getter-side normalisation contracts of <see cref="RandomConfig"/>.
/// </summary>
public class RandomConfigTests
{
    [Fact]
    public void DefaultStruct_NormalisesToTheDocumentedDefaults()
    {
        RandomConfig config = default;

        config.MaxHoistableStateBytes.Should().Be(RandomConfig.DefaultMaxHoistableStateBytes);
        config.StripedSlotCount.Should().Be(RandomConfig.DefaultStripedSlotCount);
        config.CacheNormalPair.Should().BeTrue();
        config.Should().Be(RandomConfig.Default);
        config.Should().Be(new RandomConfig());
    }

    [Theory]
    [InlineData(-64, 0)]
    [InlineData(-1, 0)]
    [InlineData(0, 0)]
    [InlineData(1, 1)]
    [InlineData(32, 32)]
    [InlineData(1024, RandomConfig.MaximumHoistableStateBytes)]
    public void MaxHoistableStateBytes_IsClamped(int requested, int expected)
    {
        new RandomConfig(requested, 1, true).MaxHoistableStateBytes.Should().Be(expected);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(1, 1)]
    [InlineData(3, 4)]
    [InlineData(5, 8)]
    [InlineData(16, 16)]
    [InlineData(17, 32)]
    [InlineData(8192, RandomConfig.MaximumStripedSlotCount)]
    [InlineData(-7, 1)]
    public void StripedSlotCount_IsClampedAndRoundedUpToAPowerOfTwo(int requested, int expected)
    {
        new RandomConfig(32, requested, true).StripedSlotCount.Should().Be(expected);
    }

    [Fact]
    public void CacheNormalPair_IsHonouredAndDefaultsToEnabled()
    {
        new RandomConfig(32, 1, cacheNormalPair: false).CacheNormalPair.Should().BeFalse();
        new RandomConfig(32, 1, cacheNormalPair: true).CacheNormalPair.Should().BeTrue();
        RandomConfig.Minimal.CacheNormalPair.Should().BeFalse();
        RandomConfig.Minimal.MaxHoistableStateBytes.Should().Be(0);
        RandomConfig.Minimal.StripedSlotCount.Should().Be(1);
    }

    [Fact]
    public void Equality_ComparesNormalisedKnobs()
    {
        (new RandomConfig(1, 3, true)).Should().Be(new RandomConfig(1, 4, true));
        (new RandomConfig(1, 3, true)).Should().NotBe(new RandomConfig(1, 3, false));
        (new RandomConfig(1, 3, true) == new RandomConfig(1, 4, true)).Should().BeTrue();
        (new RandomConfig(1, 3, true) != new RandomConfig(2, 4, true)).Should().BeTrue();
    }
}
