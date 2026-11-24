namespace Axrone.Random;

/// <summary>
/// ChaCha20 as a random source: the deterministic cryptographic stream the web engine offers under
/// <c>RandomEngineType.CHACHA20</c>, rebuilt on the package's static-abstract engine shape.
/// </summary>
/// <remarks>
/// <para><b>RFC 8439 block layout.</b> The state is sixteen 32-bit words: four sigma constants,
/// eight key words, a 32-bit block counter at word 12 and a 96-bit nonce at words 13 to 15. One
/// block is twenty rounds over a copy of the state, and the copy is then added back, so the state
/// itself only ever moves through the counter. The counter advances once per sixteen words.</para>
/// <para><b>Deliberate divergence from the web engine.</b> The web implementation increments its
/// counter on every 32-bit word while reusing a sixteen-word buffer, so it spends a block function
/// per eight words and is not the ChaCha20 keystream it names. This engine keeps the published
/// block discipline; the two sequences are not comparable, and neither claims the other's.</para>
/// <para><b>Seeding.</b> <see cref="Create(ulong)"/> expands one word through
/// <see cref="SplitMix64"/> into the whole 256-bit key plus the 96-bit nonce, so a short seed still
/// fills the key. It is a cold path only - draws never re-key.</para>
/// <para><b>Snapshot is logical, not physical.</b> <see cref="WordCount"/> covers the sixteen state
/// words plus one word carrying the buffer cursor; the keystream buffer itself is derived and is
/// rebuilt from the counter on restore. Equality is therefore defined over the logical state, and
/// <see cref="CopyStateTo"/> and <see cref="FromState"/> round-trip exactly.</para>
/// </remarks>
public unsafe struct ChaCha20Source : IRandomSource<ChaCha20Source>, IRandomStateSnapshot<ChaCha20Source>, IEquatable<ChaCha20Source>
{
    private const uint Sigma0 = 0x61707865u;
    private const uint Sigma1 = 0x3320646eu;
    private const uint Sigma2 = 0x79622d32u;
    private const uint Sigma3 = 0x6b206574u;

    private const int StateWords = 16;
    private const int BufferWords = 16;
    private const int Rounds = 20;
    private const int CounterWord = 12;

    private fixed uint _state[StateWords];
    private fixed uint _buffer[BufferWords];
    private int _cursor;

    /// <summary>Initialises the state from a 256-bit key and a 96-bit nonce.</summary>
    /// <param name="keyWords">The key, eight words; a shorter key zero-fills.</param>
    /// <param name="nonceWords">The nonce, three words; a shorter nonce zero-fills.</param>
    /// <exception cref="ArgumentException">Either span is longer than its field width.</exception>
    public ChaCha20Source(ReadOnlySpan<uint> keyWords, ReadOnlySpan<uint> nonceWords)
    {
        if (keyWords.Length > 8)
        {
            RandomThrowHelper.ThrowKeyTooLong(keyWords.Length, nameof(keyWords));
        }

        if (nonceWords.Length > 3)
        {
            RandomThrowHelper.ThrowNonceTooLong(nonceWords.Length, nameof(nonceWords));
        }

        ref uint state = ref _state[0];
        state = Sigma0;
        Unsafe.Add(ref state, 1) = Sigma1;
        Unsafe.Add(ref state, 2) = Sigma2;
        Unsafe.Add(ref state, 3) = Sigma3;

        for (int i = 0; i < 8; i++)
        {
            Unsafe.Add(ref state, 4 + i) = i < keyWords.Length ? keyWords[i] : 0u;
        }

        Unsafe.Add(ref state, CounterWord) = 0u;
        for (int i = 0; i < 3; i++)
        {
            Unsafe.Add(ref state, 13 + i) = i < nonceWords.Length ? nonceWords[i] : 0u;
        }

        _cursor = BufferWords;
    }

    /// <summary>Gets the number of 64-bit words one state snapshot occupies.</summary>
    public static int WordCount => 9;

    /// <summary>Gets the index of the next block the stream will generate.</summary>
    public readonly uint BlockCounter => Unsafe.Add(ref Unsafe.AsRef(in _state[0]), CounterWord);

    /// <summary>Expands one seed word into the key and nonce with <see cref="SplitMix64"/>.</summary>
    /// <param name="seed">The seed.</param>
    /// <returns>A ChaCha20 state ready to draw.</returns>
    public static ChaCha20Source Create(ulong seed)
    {
        SplitMix64 mixer = SplitMix64.Create(seed == 0UL ? RandomEntropy.NextUInt64() : seed);
        Span<uint> key = stackalloc uint[8];
        for (int i = 0; i < 8; i += 2)
        {
            ulong word = SplitMix64.NextUInt64(ref mixer);
            key[i] = (uint)word;
            key[i + 1] = (uint)(word >> 32);
        }

        Span<uint> nonce = stackalloc uint[3];
        ulong extra = SplitMix64.NextUInt64(ref mixer);
        nonce[0] = (uint)extra;
        nonce[1] = (uint)(extra >> 32);
        nonce[2] = (uint)SplitMix64.NextUInt64(ref mixer);
        return new ChaCha20Source(key, nonce);
    }

    /// <summary>Draws the next 64-bit word of the keystream.</summary>
    /// <param name="source">The state to advance. It is mutated in place.</param>
    /// <returns>The next 64-bit word.</returns>
    /// <remarks>
    /// Two 32-bit draws composed, so a 64-bit call that lands on an odd cursor straddles the block
    /// boundary instead of discarding the half word: mixed-width callers consume one stream, not two.
    /// </remarks>
    public static ulong NextUInt64(ref ChaCha20Source source)
    {
        uint low = NextUInt32(ref source);
        uint high = NextUInt32(ref source);
        return low | ((ulong)high << 32);
    }

    /// <summary>Draws the next 32-bit word of the keystream.</summary>
    /// <param name="source">The state to advance. It is mutated in place.</param>
    /// <returns>The next 32-bit word.</returns>
    public static uint NextUInt32(ref ChaCha20Source source)
    {
        if (source._cursor >= BufferWords)
        {
            GenerateBlock(ref source);
        }

        return Unsafe.Add(ref source._buffer[0], source._cursor++);
    }

    /// <summary>
    /// Skips <paramref name="words"/> keystream words without producing them, which is how a lane
    /// decomposition hands each worker a disjoint slice of one logical stream.
    /// </summary>
    /// <param name="source">The state to advance. It is mutated in place.</param>
    /// <param name="words">The number of 32-bit words to skip.</param>
    public static void Advance(ref ChaCha20Source source, ulong words)
    {
        if (words == 0UL)
        {
            return;
        }

        ulong remainingInBlock = (ulong)(BufferWords - source._cursor);
        if (words <= remainingInBlock)
        {
            source._cursor += (int)words;
            return;
        }

        words -= remainingInBlock;
        source._cursor = BufferWords;
        ulong blocks = words / BufferWords;
        if (blocks > 0UL)
        {
            IncrementCounter(ref source, (uint)blocks);
        }

        ulong tail = words % BufferWords;
        if (tail > 0UL)
        {
            GenerateBlock(ref source);
            source._cursor = (int)tail;
        }
    }

    /// <summary>Copies the sixteen state words and the buffer cursor into <paramref name="destination"/>.</summary>
    /// <param name="destination">At least <see cref="WordCount"/> words.</param>
    /// <exception cref="ArgumentException"><paramref name="destination"/> is shorter than nine words.</exception>
    public readonly void CopyStateTo(Span<ulong> destination)
    {
        if (destination.Length < WordCount)
        {
            RandomThrowHelper.ThrowDestinationTooShortForState(WordCount, nameof(destination));
        }

        ref uint state = ref Unsafe.AsRef(in _state[0]);
        for (int i = 0; i < 8; i++)
        {
            destination[i] = Unsafe.Add(ref state, i * 2) | ((ulong)Unsafe.Add(ref state, (i * 2) + 1) << 32);
        }

        destination[8] = (ulong)(uint)_cursor;
    }

    /// <summary>Rebuilds a state from words previously written by <see cref="CopyStateTo"/>.</summary>
    /// <param name="state">Exactly <see cref="WordCount"/> words.</param>
    /// <returns>A state that continues the exported stream position.</returns>
    /// <exception cref="ArgumentException"><paramref name="state"/> does not hold exactly nine words.</exception>
    public static ChaCha20Source FromState(ReadOnlySpan<ulong> state)
    {
        if (state.Length != WordCount)
        {
            RandomThrowHelper.ThrowStateSpanLengthMismatch(WordCount, state.Length, nameof(state));
        }

        ChaCha20Source source = default;
        ref uint target = ref source._state[0];
        for (int i = 0; i < 8; i++)
        {
            Unsafe.Add(ref target, i * 2) = (uint)state[i];
            Unsafe.Add(ref target, (i * 2) + 1) = (uint)(state[i] >> 32);
        }

        int cursor = (int)(uint)state[8];
        if (cursor is < 0 or > BufferWords)
        {
            cursor = BufferWords;
        }

        if (cursor == 0)
        {
            source._cursor = BufferWords;
            return source;
        }

        // The cursor counts words already taken from the block that precedes the counter, so
        // rewinding the counter by one and regenerating reproduces exactly the same keystream.
        source._cursor = BufferWords;
        DecrementCounter(ref source);
        GenerateBlock(ref source);
        source._cursor = cursor;
        return source;
    }

    /// <summary>Compares the logical state; the keystream buffer is derived cache.</summary>
    /// <param name="other">The state to compare with.</param>
    /// <returns><see langword="true"/> when both states stand at the same stream position.</returns>
    public readonly bool Equals(ChaCha20Source other)
    {
        if (_cursor != other._cursor)
        {
            return false;
        }

        ref uint left = ref Unsafe.AsRef(in _state[0]);
        ref uint right = ref Unsafe.AsRef(in other._state[0]);
        for (int i = 0; i < StateWords; i++)
        {
            if (Unsafe.Add(ref left, i) != Unsafe.Add(ref right, i))
            {
                return false;
            }
        }

        return true;
    }

    /// <inheritdoc />
    public override readonly bool Equals(object? obj) => obj is ChaCha20Source other && Equals(other);

    /// <inheritdoc />
    public override readonly int GetHashCode()
    {
        HashCode code = default;
        ref uint state = ref Unsafe.AsRef(in _state[0]);
        for (int i = 0; i < StateWords; i++)
        {
            code.Add(Unsafe.Add(ref state, i));
        }

        code.Add(_cursor);
        return code.ToHashCode();
    }

    /// <summary>Equality over the logical state.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when both states stand at the same stream position.</returns>
    public static bool operator ==(ChaCha20Source left, ChaCha20Source right) => left.Equals(right);

    /// <summary>Inequality over the logical state.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when the states stand at different stream positions.</returns>
    public static bool operator !=(ChaCha20Source left, ChaCha20Source right) => !left.Equals(right);

    /// <summary>Runs one ChaCha20 block and installs it as the live buffer.</summary>
    private static void GenerateBlock(ref ChaCha20Source source)
    {
        Span<uint> working = stackalloc uint[StateWords];
        ref uint head = ref MemoryMarshal.GetReference(working);
        ref uint state = ref source._state[0];
        for (int i = 0; i < StateWords; i++)
        {
            Unsafe.Add(ref head, i) = Unsafe.Add(ref state, i);
        }

        for (int round = 0; round < Rounds; round += 2)
        {
            QuarterRound(ref head, 0, 4, 8, 12);
            QuarterRound(ref head, 1, 5, 9, 13);
            QuarterRound(ref head, 2, 6, 10, 14);
            QuarterRound(ref head, 3, 7, 11, 15);
            QuarterRound(ref head, 0, 5, 10, 15);
            QuarterRound(ref head, 1, 6, 11, 12);
            QuarterRound(ref head, 2, 7, 8, 13);
            QuarterRound(ref head, 3, 4, 9, 14);
        }

        ref uint buffer = ref source._buffer[0];
        for (int i = 0; i < StateWords; i++)
        {
            Unsafe.Add(ref buffer, i) = Unsafe.Add(ref head, i) + Unsafe.Add(ref state, i);
        }

        IncrementCounter(ref source, 1u);
        source._cursor = 0;
    }

    private static void QuarterRound(ref uint head, int a, int b, int c, int d)
    {
        ref uint wa = ref Unsafe.Add(ref head, a);
        ref uint wb = ref Unsafe.Add(ref head, b);
        ref uint wc = ref Unsafe.Add(ref head, c);
        ref uint wd = ref Unsafe.Add(ref head, d);

        wa += wb;
        wd ^= wa;
        wd = BitOperations.RotateLeft(wd, 16);
        wc += wd;
        wb ^= wc;
        wb = BitOperations.RotateLeft(wb, 12);
        wa += wb;
        wd ^= wa;
        wd = BitOperations.RotateLeft(wd, 8);
        wc += wd;
        wb ^= wc;
        wb = BitOperations.RotateLeft(wb, 7);
    }

    private static void IncrementCounter(ref ChaCha20Source source, uint amount) =>
        Unsafe.Add(ref source._state[0], CounterWord) += amount;

    private static void DecrementCounter(ref ChaCha20Source source) =>
        Unsafe.Add(ref source._state[0], CounterWord)--;
}
