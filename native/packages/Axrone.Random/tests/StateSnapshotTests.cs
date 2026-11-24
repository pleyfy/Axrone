namespace Axrone.Random.Tests;

/// <summary>
/// Contracts of the engine state snapshot: every compact engine must be exportable to a fixed
/// number of 64-bit words and restorable from exactly that many, and a restored engine must
/// continue the original stream word for word. The wrong-length guards are part of the contract:
/// a snapshot buffer sized for the wrong engine must fail loudly rather than resume a stream
/// from somebody else's words.
/// </summary>
public class StateSnapshotTests
{
    private const ulong SnapshotSeed = 0x0123456789ABCDEFUL;
    private const int PreSnapshotDraws = 37;
    private const int ContinuationDraws = 41;

    [Fact]
    public void WyRand_SnapshotRoundTrip_ReplaysTheOriginalContinuation() => RoundTrip<WyRand>();

    [Fact]
    public void Xoroshiro128PlusPlus_SnapshotRoundTrip_ReplaysTheOriginalContinuation() => RoundTrip<Xoroshiro128PlusPlus>();

    [Fact]
    public void Xoshiro256PlusPlus_SnapshotRoundTrip_ReplaysTheOriginalContinuation() => RoundTrip<Xoshiro256PlusPlus>();

    [Fact]
    public void Pcg_SnapshotRoundTrip_ReplaysTheOriginalContinuation() => RoundTrip<PcgEngine>();

    [Fact]
    public void WyRand_WordCount_IsOne() => WordCountIs<WyRand>(1);

    [Fact]
    public void Xoroshiro128PlusPlus_WordCount_IsTwo() => WordCountIs<Xoroshiro128PlusPlus>(2);

    [Fact]
    public void Xoshiro256PlusPlus_WordCount_IsFour() => WordCountIs<Xoshiro256PlusPlus>(4);

    [Fact]
    public void Pcg_WordCount_IsTwo() => WordCountIs<PcgEngine>(2);

    [Fact]
    public void WyRand_CopyStateTo_ShortSpan_IsRejected() => CopyStateToShortSpanIsRejected<WyRand>();

    [Fact]
    public void Xoroshiro128PlusPlus_CopyStateTo_ShortSpan_IsRejected() => CopyStateToShortSpanIsRejected<Xoroshiro128PlusPlus>();

    [Fact]
    public void Xoshiro256PlusPlus_CopyStateTo_ShortSpan_IsRejected() => CopyStateToShortSpanIsRejected<Xoshiro256PlusPlus>();

    [Fact]
    public void Pcg_CopyStateTo_ShortSpan_IsRejected() => CopyStateToShortSpanIsRejected<PcgEngine>();

    [Fact]
    public void WyRand_CopyStateTo_EmptySpan_IsRejected() => CopyStateToEmptySpanIsRejected<WyRand>();

    [Fact]
    public void Xoshiro256PlusPlus_CopyStateTo_EmptySpan_IsRejected() => CopyStateToEmptySpanIsRejected<Xoshiro256PlusPlus>();

    [Fact]
    public void WyRand_FromState_ShortSpan_IsRejected() => FromStateWrongLengthIsRejected<WyRand>();

    [Fact]
    public void Xoroshiro128PlusPlus_FromState_ShortSpan_IsRejected() => FromStateWrongLengthIsRejected<Xoroshiro128PlusPlus>();

    [Fact]
    public void Xoshiro256PlusPlus_FromState_ShortSpan_IsRejected() => FromStateWrongLengthIsRejected<Xoshiro256PlusPlus>();

    [Fact]
    public void Pcg_FromState_ShortSpan_IsRejected() => FromStateWrongLengthIsRejected<PcgEngine>();

    [Fact]
    public void WyRand_FromState_LongSpan_IsRejected() => FromStateLongSpanIsRejected<WyRand>();

    [Fact]
    public void Xoroshiro128PlusPlus_FromState_LongSpan_IsRejected() => FromStateLongSpanIsRejected<Xoroshiro128PlusPlus>();

    [Fact]
    public void Xoshiro256PlusPlus_FromState_LongSpan_IsRejected() => FromStateLongSpanIsRejected<Xoshiro256PlusPlus>();

    [Fact]
    public void Pcg_FromState_LongSpan_IsRejected() => FromStateLongSpanIsRejected<PcgEngine>();

    [Fact]
    public void Pcg_FromState_EvenIncrement_IsRejected()
    {
        // An even increment is not a resumable PCG state: the LCG would run at a fraction of its
        // period, and increment zero is exactly the unseeded default state. Restoring it silently
        // would produce a stream of zeros.
        Action act = () => _ = PcgEngine.FromState([0UL, 0UL]);

        act.Should().Throw<ArgumentException>().WithParameterName("state");
    }

    [Fact]
    public void CompactEngines_CopyStateTo_LeavesWordsPastTheCountUntouched()
    {
        var engine = Xoshiro256PlusPlus.Create(SnapshotSeed);
        ulong[] destination = new ulong[Xoshiro256PlusPlus.WordCount + 2];
        destination.AsSpan().Fill(0xDEADBEEFDEADBEEFUL);

        engine.CopyStateTo(destination);

        destination[Xoshiro256PlusPlus.WordCount].Should().Be(0xDEADBEEFDEADBEEFUL);
        destination[Xoshiro256PlusPlus.WordCount + 1].Should().Be(0xDEADBEEFDEADBEEFUL);
    }

    [Fact]
    public void CompactEngines_RestoredFromSnapshot_DrawsNoZeroWords()
    {
        // The restore must not resurrect an unseeded state: a snapshot taken from a live engine
        // and restored has to keep producing live words.
        var engine = Xoshiro256PlusPlus.Create(SnapshotSeed);
        for (int i = 0; i < PreSnapshotDraws; i++)
        {
            _ = Xoshiro256PlusPlus.NextUInt64(ref engine);
        }

        ulong[] snapshot = new ulong[Xoshiro256PlusPlus.WordCount];
        engine.CopyStateTo(snapshot);

        Xoshiro256PlusPlus restored = Xoshiro256PlusPlus.FromState(snapshot);
        ulong[] continuation = Draw(ref restored, ContinuationDraws);

        continuation.Should().NotContain(0UL);
        continuation.Distinct().Should().HaveCount(ContinuationDraws);
    }

    [Fact]
    public void EngineType_WordCounts_AreTheSnapshotSizes()
    {
        RandomEngineType.WyRand.GetWordCount().Should().Be(WyRand.WordCount);
        RandomEngineType.Xoroshiro128PlusPlus.GetWordCount().Should().Be(Xoroshiro128PlusPlus.WordCount);
        RandomEngineType.Xoshiro256PlusPlus.GetWordCount().Should().Be(Xoshiro256PlusPlus.WordCount);
        RandomEngineType.Pcg.GetWordCount().Should().Be(PcgEngine.WordCount);
    }

    [Fact]
    public void EngineType_MersenneTwister_IsExemptFromTheUniformSnapshotContract()
    {
        RandomEngineType.MersenneTwister.GetWordCount().Should().Be(0);
        RandomEngineType.MersenneTwister.SupportsUniformSnapshot().Should().BeFalse();
        RandomEngineType.OperatingSystem.GetWordCount().Should().Be(0);
        RandomEngineType.OperatingSystem.SupportsUniformSnapshot().Should().BeFalse();

        RandomEngineType[] exempt = [RandomEngineType.MersenneTwister, RandomEngineType.OperatingSystem];
        foreach (RandomEngineType engineType in Enum.GetValues<RandomEngineType>())
        {
            if (!exempt.Contains(engineType))
            {
                engineType.SupportsUniformSnapshot().Should().BeTrue();
            }
        }
    }

    [Fact]
    public void EngineType_UnknownValue_IsRejected()
    {
        Action act = () => _ = ((RandomEngineType)200).GetWordCount();

        act.Should().Throw<ArgumentOutOfRangeException>().WithParameterName("engineType");
    }

    [Fact]
    public void EngineType_Values_AreTheDocumentedWireContract()
    {
        ((byte)RandomEngineType.WyRand).Should().Be(0);
        ((byte)RandomEngineType.Xoroshiro128PlusPlus).Should().Be(1);
        ((byte)RandomEngineType.Xoshiro256PlusPlus).Should().Be(2);
        ((byte)RandomEngineType.Pcg).Should().Be(3);
        ((byte)RandomEngineType.MersenneTwister).Should().Be(4);
        ((byte)RandomEngineType.ChaCha20).Should().Be(5);
        ((byte)RandomEngineType.OperatingSystem).Should().Be(6);
        Enum.GetValues<RandomEngineType>().Should().HaveCount(7);
    }

    /// <summary>
    /// Draws, snapshots, draws more, restores, and requires the two continuations to be the same
    /// sequence - the replay contract in full: the restored engine must not merely be equal, it
    /// must be indistinguishable from never having been snapshotted.
    /// </summary>
    private static void RoundTrip<TEngine>()
        where TEngine : struct, IRandomSource<TEngine>, IRandomStateSnapshot<TEngine>
    {
        TEngine engine = TEngine.Create(SnapshotSeed);
        for (int i = 0; i < PreSnapshotDraws; i++)
        {
            _ = TEngine.NextUInt64(ref engine);
        }

        TEngine atSnapshot = engine;

        ulong[] snapshot = new ulong[TEngine.WordCount];
        engine.CopyStateTo(snapshot);

        // Exporting twice must be stable: a snapshot is a read of the state, not a step of it.
        ulong[] second = new ulong[TEngine.WordCount];
        engine.CopyStateTo(second);
        second.Should().Equal(snapshot);

        TEngine live = engine;
        ulong[] continuation = Draw(ref live, ContinuationDraws);

        TEngine restored = TEngine.FromState(snapshot);

        restored.Should().Be(atSnapshot);
        restored.GetHashCode().Should().Be(atSnapshot.GetHashCode());

        // The same words must restore the same state every time, before anything advances it.
        TEngine restoredAgain = TEngine.FromState(snapshot);
        restoredAgain.Should().Be(atSnapshot);

        Draw(ref restored, ContinuationDraws).Should().Equal(continuation);
        Draw(ref restoredAgain, ContinuationDraws).Should().Equal(continuation);
    }

    private static void WordCountIs<TEngine>(int expected)
        where TEngine : struct, IRandomSource<TEngine>, IRandomStateSnapshot<TEngine>
    {
        TEngine.WordCount.Should().Be(expected);

        TEngine engine = TEngine.Create(SnapshotSeed);
        ulong[] destination = new ulong[expected];
        Action act = () => engine.CopyStateTo(destination);

        act.Should().NotThrow();
    }

    private static void CopyStateToShortSpanIsRejected<TEngine>()
        where TEngine : struct, IRandomSource<TEngine>, IRandomStateSnapshot<TEngine>
    {
        TEngine engine = TEngine.Create(SnapshotSeed);
        ulong[] destination = new ulong[TEngine.WordCount - 1];

        Action act = () => engine.CopyStateTo(destination);

        act.Should().Throw<ArgumentException>().WithParameterName("destination");
    }

    private static void CopyStateToEmptySpanIsRejected<TEngine>()
        where TEngine : struct, IRandomSource<TEngine>, IRandomStateSnapshot<TEngine>
    {
        TEngine engine = TEngine.Create(SnapshotSeed);

        Action act = () => engine.CopyStateTo([]);

        act.Should().Throw<ArgumentException>().WithParameterName("destination");
    }

    private static void FromStateWrongLengthIsRejected<TEngine>()
        where TEngine : IRandomStateSnapshot<TEngine>
    {
        ulong[] tooShort = new ulong[TEngine.WordCount - 1];

        Action act = () => _ = TEngine.FromState(tooShort);

        act.Should().Throw<ArgumentException>().WithParameterName("state");
    }

    private static void FromStateLongSpanIsRejected<TEngine>()
        where TEngine : IRandomStateSnapshot<TEngine>
    {
        ulong[] tooLong = new ulong[TEngine.WordCount + 1];
        tooLong.AsSpan().Fill(3UL);

        Action act = () => _ = TEngine.FromState(tooLong);

        act.Should().Throw<ArgumentException>().WithParameterName("state");
    }

    private static ulong[] Draw<TEngine>(ref TEngine source, int count)
        where TEngine : struct, IRandomSource<TEngine>
    {
        ulong[] values = new ulong[count];
        for (int i = 0; i < count; i++)
        {
            values[i] = TEngine.NextUInt64(ref source);
        }

        return values;
    }
}