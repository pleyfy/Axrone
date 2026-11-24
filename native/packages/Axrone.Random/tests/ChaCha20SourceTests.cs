namespace Axrone.Random.Tests;

/// <summary>
/// Contracts of <see cref="ChaCha20Source"/>: the published RFC 8439 block vector as ground truth
/// for the round function, then the parts only this engine has to get right - block-boundary
/// continuity, the word skip, the snapshot round trip at every cursor, and one stream shared by
/// both draw widths.
/// </summary>
public sealed class ChaCha20SourceTests
{
    private static readonly uint[] AppendixBlockCounterZero =
    [
        0xade0b876u, 0x903df1a0u, 0xe56a5d40u, 0x28bd8653u,
        0xb819d2bdu, 0x1aed8da0u, 0xccef36a8u, 0xc70d778bu,
        0x7c5941dau, 0x8d485751u, 0x3fe02477u, 0x374ad8b8u,
        0xf4b8436au, 0x1ca11815u, 0x69b687c3u, 0x8665eeb2u,
    ];

    private static readonly uint[] BlockFunctionVectorBlockCounterOne =
    [
        0xe4e7f110u, 0x15593bd1u, 0x1fdd0f50u, 0xc47120a3u,
        0xc7f4d1c7u, 0x0368c033u, 0x9aaa2204u, 0x4e6cd4c3u,
        0x466482d2u, 0x09aa9f07u, 0x05d7c214u, 0xa2028bd9u,
        0xd19c12b5u, 0xb94e16deu, 0xe883d0cbu, 0x4e3c50a2u,
    ];

    private static readonly uint[] BlockFunctionVectorKey =
    [
        0x03020100u, 0x07060504u, 0x0b0a0908u, 0x0f0e0d0cu,
        0x13121110u, 0x17161514u, 0x1b1a1918u, 0x1f1e1d1cu,
    ];

    private static readonly uint[] BlockFunctionVectorNonce = [0x09000000u, 0x4a000000u, 0x00000000u];

    private static ChaCha20Source AppendixState() => new(new uint[8], new uint[3]);

    private static ChaCha20Source BlockFunctionVectorState() =>
        new(BlockFunctionVectorKey, BlockFunctionVectorNonce);

    [Fact]
    public void Block_MatchesTheAppendixVectorOfAnAllZeroState()
    {
        ChaCha20Source source = AppendixState();

        for (int i = 0; i < AppendixBlockCounterZero.Length; i++)
        {
            ChaCha20Source.NextUInt32(ref source).Should()
                .Be(AppendixBlockCounterZero[i], $"word {i} of the appendix block");
        }

        source.BlockCounter.Should().Be(1u, "one block was consumed");
    }

    [Fact]
    public void Block_MatchesThePublishedBlockFunctionVectorAtCounterOne()
    {
        ChaCha20Source source = BlockFunctionVectorState();
        ChaCha20Source.Advance(ref source, 16UL);

        source.BlockCounter.Should().Be(1u, "the skip landed on the second block");
        for (int i = 0; i < BlockFunctionVectorBlockCounterOne.Length; i++)
        {
            ChaCha20Source.NextUInt32(ref source).Should()
                .Be(BlockFunctionVectorBlockCounterOne[i], $"word {i} of the published block");
        }
    }

    [Fact]
    public void Block_AdvancesTheCounterOncePerSixteenWords()
    {
        ChaCha20Source source = AppendixState();

        for (int i = 0; i < 16; i++)
        {
            ChaCha20Source.NextUInt32(ref source);
        }

        uint firstOfNextBlock = ChaCha20Source.NextUInt32(ref source);
        firstOfNextBlock.Should().NotBe(AppendixBlockCounterZero[0]);
        source.BlockCounter.Should().Be(2u, "the second block is now the live one");
    }

    [Fact]
    public void Draws_AreReproduciblePerSeedAndDistinctAcrossSeeds()
    {
        ChaCha20Source first = ChaCha20Source.Create(0x123456789ABCDEF0UL);
        ChaCha20Source second = ChaCha20Source.Create(0x123456789ABCDEF0UL);
        ChaCha20Source third = ChaCha20Source.Create(0x0FEDCBA987654321UL);

        for (int i = 0; i < 64; i++)
        {
            ChaCha20Source.NextUInt64(ref first).Should().Be(ChaCha20Source.NextUInt64(ref second));
        }

        ChaCha20Source.NextUInt64(ref first).Should().NotBe(ChaCha20Source.NextUInt64(ref third));
    }

    [Fact]
    public void MixedWidthDraws_ConsumeOneStreamNotTwo()
    {
        ChaCha20Source composed = AppendixState();
        ChaCha20Source split = AppendixState();

        for (int i = 0; i < 40; i++)
        {
            ulong wide = ChaCha20Source.NextUInt64(ref composed);
            uint low = ChaCha20Source.NextUInt32(ref split);
            uint high = ChaCha20Source.NextUInt32(ref split);
            (low | ((ulong)high << 32)).Should().Be(wide, "a 64-bit draw is two keystream words");
        }
    }

    [Fact]
    public void OddCursor_StraddlesTheBlockBoundaryWithoutDroppingAWord()
    {
        ChaCha20Source source = AppendixState();
        ChaCha20Source reference = AppendixState();

        for (int i = 0; i < 15; i++)
        {
            ChaCha20Source.NextUInt32(ref source).Should().Be(AppendixBlockCounterZero[i]);
            ChaCha20Source.NextUInt32(ref reference);
        }

        ulong straddling = ChaCha20Source.NextUInt64(ref source);
        uint tail = ChaCha20Source.NextUInt32(ref reference);
        uint next = ChaCha20Source.NextUInt32(ref reference);

        (tail | ((ulong)next << 32)).Should().Be(straddling, "word 15 and word 0 of block 1 form the draw");
    }

    [Theory]
    [InlineData(0UL)]
    [InlineData(1UL)]
    [InlineData(15UL)]
    [InlineData(16UL)]
    [InlineData(17UL)]
    [InlineData(31UL)]
    [InlineData(32UL)]
    [InlineData(64UL)]
    [InlineData(1000UL)]
    public void Advance_SkipsExactlyAsManyWordsAsDrawingThem(ulong words)
    {
        ChaCha20Source skipped = ChaCha20Source.Create(0xA5A5A5A5UL);
        ChaCha20Source drawn = ChaCha20Source.Create(0xA5A5A5A5UL);

        for (ulong i = 0; i < words; i++)
        {
            ChaCha20Source.NextUInt32(ref drawn);
        }

        ChaCha20Source.Advance(ref skipped, words);

        for (int i = 0; i < 8; i++)
        {
            ChaCha20Source.NextUInt32(ref skipped).Should().Be(ChaCha20Source.NextUInt32(ref drawn));
        }
    }

    [Fact]
    public void Advance_ZeroWordsIsANoOp()
    {
        ChaCha20Source source = ChaCha20Source.Create(0x1UL);
        ChaCha20Source untouched = source;

        ChaCha20Source.Advance(ref source, 0UL);
        source.Equals(untouched).Should().BeTrue();
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(7)]
    [InlineData(15)]
    [InlineData(16)]
    public void Snapshot_RoundTripsAtEveryCursor(int consumed)
    {
        ChaCha20Source source = ChaCha20Source.Create(0xBEEF00001234UL);
        for (int i = 0; i < consumed; i++)
        {
            ChaCha20Source.NextUInt32(ref source);
        }

        Span<ulong> words = stackalloc ulong[ChaCha20Source.WordCount];
        source.CopyStateTo(words);

        ChaCha20Source restored = ChaCha20Source.FromState(words);
        restored.Equals(source).Should().BeTrue();

        for (int i = 0; i < 40; i++)
        {
            ChaCha20Source.NextUInt32(ref restored).Should()
                .Be(ChaCha20Source.NextUInt32(ref source), $"stream position {consumed}+{i}");
        }
    }

    [Fact]
    public void Snapshot_UsesThePublishedWordCountAndRejectsWrongSizes()
    {
        ChaCha20Source source = ChaCha20Source.Create(0x7UL);

        ChaCha20Source.WordCount.Should().Be(9);

        ulong[] shortDestination = new ulong[4];
        Action tooShort = () => source.CopyStateTo(shortDestination);
        tooShort.Should().Throw<ArgumentException>();

        ulong[] wrongLength = new ulong[8];
        Action wrongRestore = () => ChaCha20Source.FromState(wrongLength);
        wrongRestore.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Constructor_RejectsSpansWiderThanTheStateFields()
    {
        uint[] wide = new uint[9];
        Action tooWideKey = () => _ = new ChaCha20Source(wide, new uint[3]);
        tooWideKey.Should().Throw<ArgumentException>();

        uint[] wideNonce = new uint[4];
        Action tooWideNonce = () => _ = new ChaCha20Source(new uint[8], wideNonce);
        tooWideNonce.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void EngineWrapper_DrivesTheChaChaStreamThroughTheGenericSurface()
    {
        var engine = new RandomEngine<ChaCha20Source>(ChaCha20Source.Create(0x42UL));
        var reference = new RandomEngine<ChaCha20Source>(ChaCha20Source.Create(0x42UL));

        for (int i = 0; i < 32; i++)
        {
            engine.NextUInt32().Should().Be(reference.NextUInt32());
        }

        engine.NextDouble().Should().BeInRange(0.0, 1.0);
        engine.NextInt32(10).Should().BeInRange(0, 9);

        Span<byte> bytes = stackalloc byte[33];
        engine.NextBytes(bytes);
        bytes.ToArray().Distinct().Should().HaveCountGreaterThan(1, "a keystream fill is not one repeated byte");
    }

    [Fact]
    public void EngineType_ReportsTheSnapshotContractForEveryEngine()
    {
        RandomEngineType.ChaCha20.GetWordCount().Should().Be(ChaCha20Source.WordCount);
        RandomEngineType.ChaCha20.SupportsUniformSnapshot().Should().BeTrue();
        RandomEngineType.OperatingSystem.GetWordCount().Should().Be(0);
        RandomEngineType.OperatingSystem.SupportsUniformSnapshot().Should().BeFalse();
    }
}

/// <summary>
/// Contracts of <see cref="OperatingSystemEntropySource"/>: it must actually be non-deterministic,
/// it must ignore the seed it is handed, and it must satisfy the engine contract shape the wrapper
/// needs.
/// </summary>
public sealed class OperatingSystemEntropySourceTests
{
    [Fact]
    public void Draws_AreNotReproducible()
    {
        OperatingSystemEntropySource first = OperatingSystemEntropySource.Create(0x1234UL);
        OperatingSystemEntropySource second = OperatingSystemEntropySource.Create(0x1234UL);

        var collisions = 0;
        for (int i = 0; i < 64; i++)
        {
            if (OperatingSystemEntropySource.NextUInt64(ref first) == OperatingSystemEntropySource.NextUInt64(ref second))
            {
                collisions++;
            }
        }

        collisions.Should().Be(0, "two independent entropy streams must not agree on any word");
    }

    [Fact]
    public void Seed_IsIgnoredBecauseEntropyCannotBeReplayed()
    {
        OperatingSystemEntropySource.Create(0UL).Should().Be(OperatingSystemEntropySource.Create(42UL));
    }

    [Fact]
    public void EngineContract_SuppliesBothWidthsAndFillsSpans()
    {
        var engine = new RandomEngine<OperatingSystemEntropySource>(OperatingSystemEntropySource.Create(0UL));

        engine.NextUInt32().Should().NotBe(0u);
        engine.NextUInt64().Should().NotBe(0UL);

        Span<byte> bytes = stackalloc byte[16];
        engine.NextBytes(bytes);
        bytes.ToArray().Should().NotBeEmpty();
    }

    [Fact]
    public void Distributions_RunOnTheEntropyEngine()
    {
        OperatingSystemEntropySource state = OperatingSystemEntropySource.Create(0UL);
        var uniform = new UniformDistribution(0.0, 1.0);
        var distinct = new HashSet<double>();

        for (int i = 0; i < 8; i++)
        {
            double draw = uniform.Sample(ref state);
            draw.Should().BeInRange(0.0, 1.0);
            distinct.Add(draw);
        }

        distinct.Should().HaveCount(8, "eight entropy-backed draws are not eight copies of one");
    }
}
