namespace Axrone.Random;

using System.Diagnostics;
using System.Security.Cryptography;

/// <summary>
/// A random SOURCE engine core: a value-type state machine that turns a seed into a stream
/// of 64-bit and 32-bit words. Implementations are consumed through
/// <c>static abstract</c> members that take the state by <see langword="ref"/>, so a draw
/// mutates the caller's own state in place, never a copy and never a boxed instance.
/// </summary>
/// <typeparam name="TSelf">
/// The implementing state type. <c>allows ref struct</c> is deliberate: the same contract can
/// then be satisfied by a ref struct state, whose <c>ref</c> passing is the only way to advance
/// it, and by an ordinary struct, which <c>RandomEngine{TEngine}</c> embeds as a value.
/// </typeparam>
/// <remarks>
/// <para>Every engine is a value type, so a copy is an independent stream: seeding once and
/// copying is how a stream is forked, and a <c>ref</c> draw is how it is advanced.</para>
/// <para>Engines do not promise cryptographic quality. They are deterministic, fast and
/// reproducible; the facade layer adds distributions on top.</para>
/// </remarks>
public interface IRandomSource<TSelf>
    where TSelf : allows ref struct
{
    /// <summary>Creates a state seeded deterministically from <paramref name="seed"/>.</summary>
    /// <param name="seed">The seed. The same seed always yields the same stream.</param>
    /// <returns>A fresh, ready-to-draw state.</returns>
    static abstract TSelf Create(ulong seed);

    /// <summary>Advances <paramref name="source"/> by one step and returns a full 64-bit word.</summary>
    /// <param name="source">The state to advance. It is mutated in place.</param>
    /// <returns>The next 64-bit word of the stream.</returns>
    static abstract ulong NextUInt64(ref TSelf source);

    /// <summary>Advances <paramref name="source"/> by one step and returns a full 32-bit word.</summary>
    /// <param name="source">The state to advance. It is mutated in place.</param>
    /// <returns>The next 32-bit word of the stream.</returns>
    static abstract uint NextUInt32(ref TSelf source);
}

/// <summary>
/// A random source whose state space is a vector over GF(2), so the state can be advanced by
/// 2^k steps in O(k) instead of O(2^k) draws. The two jumps are the non-overlapping stream
/// primitives of the xoshiro family: <see cref="Jump"/> walks 2^64 (or 2^128) states forward
/// and <see cref="LongJump"/> walks a further 2^96 (or 2^192), so a lane decomposition can
/// hand every worker a disjoint slice of one logical stream.
/// </summary>
/// <typeparam name="TSelf">The implementing state type; see <see cref="IRandomSource{TSelf}"/>.</typeparam>
public interface IJumpableRandomSource<TSelf> : IRandomSource<TSelf>
    where TSelf : allows ref struct
{
    /// <summary>
    /// Advances the state by the engine's jump distance - 2^64 draws for xoroshiro128++,
    /// 2^128 for xoshiro256++ - without producing the intermediate words.
    /// </summary>
    /// <param name="source">The state to advance. It is mutated in place.</param>
    static abstract void Jump(ref TSelf source);

    /// <summary>
    /// Advances the state by the engine's long-jump distance - 2^96 draws for
    /// xoroshiro128++, 2^192 for xoshiro256++ - without producing the intermediate words.
    /// </summary>
    /// <param name="source">The state to advance. It is mutated in place.</param>
    static abstract void LongJump(ref TSelf source);
}

/// <summary>
/// A random source whose entire state fits a fixed number of 64-bit words, so the state can be
/// exported to a span and rebuilt from one - the primitive a deterministic replay, a save/load
/// or a crash-recovery checkpoint is written against.
/// </summary>
/// <typeparam name="TSelf">The implementing state type; see <see cref="IRandomSource{TSelf}"/>.</typeparam>
/// <remarks>
/// <para><b>The contract.</b> <see cref="WordCount"/> words are written in the engine's own state
/// word order, first word first; a span longer than <see cref="WordCount"/> is filled only up to
/// that point. <see cref="FromState(ReadOnlySpan{ulong})"/> accepts <em>exactly</em>
/// that many words and nothing else, so a buffer built for one engine can never be silently
/// restored into another. The pair of members is the inverse of each other:
/// <c>FromState(words)</c> after <c>CopyStateTo(words)</c> reproduces a state that compares equal
/// and therefore continues the stream identically.</para>
/// <para><b>Eligibility.</b> The contract is deliberately limited to the engines whose state is a
/// fixed word vector - <see cref="WyRand"/> (one word), <see cref="Xoroshiro128PlusPlus"/> and
/// <see cref="PcgEngine"/> (two words each), <see cref="Xoshiro256PlusPlus"/> (four words) and
/// <see cref="ChaCha20Source"/> (nine: the sixteen state words plus the buffer cursor) - so one
/// <c>stackalloc</c> of at most nine words covers every eligible engine and the buffer
/// size is a compile-time constant per engine.</para>
/// <para><b>Mersenne Twister is exempt, by design.</b> Its state is 624 32-bit words
/// (2 496 bytes) plus a read cursor: it cannot be expressed in the uniform 64-bit word contract
/// without either 312 <see langword="ulong"/> words per snapshot or a packing scheme that would
/// silently lose the cursor and invite a lossy round trip. Its snapshot API is therefore the
/// engine's own <see cref="MersenneTwister.CopyStateTo(Span{uint})"/>, which already exports the
/// full state in its native word type. <see cref="RandomEngineTypeExtensions.GetWordCount"/>
/// reports <c>0</c> for it, which is how a caller discovers the exemption at runtime without
/// a type test. <see cref="OperatingSystemEntropySource"/> is exempt for the opposite reason: it
/// has no state to export.</para>
/// <para>Snapshot and restore are <em>cold</em> paths: they guard their span and can throw, so
/// they are never inlined into a draw loop and allocate nothing.</para>
/// </remarks>
public interface IRandomStateSnapshot<TSelf>
    where TSelf : allows ref struct
{
    /// <summary>Gets the number of 64-bit words one state snapshot occupies.</summary>
    static abstract int WordCount { get; }

    /// <summary>Copies the raw state words into <paramref name="destination"/>.</summary>
    /// <param name="destination">
    /// The span to fill. Must hold at least <see cref="WordCount"/> entries; entries past that
    /// are left untouched.
    /// </param>
    /// <exception cref="ArgumentException">
    /// <paramref name="destination"/> is shorter than <see cref="WordCount"/>.
    /// </exception>
    void CopyStateTo(Span<ulong> destination);

    /// <summary>Rebuilds a state from words previously written by <see cref="CopyStateTo"/>.</summary>
    /// <param name="state">The exported words, in export order.</param>
    /// <returns>A state that continues exactly where the exported one stood.</returns>
    /// <exception cref="ArgumentException">
    /// <paramref name="state"/> does not hold exactly <see cref="WordCount"/> words, or holds a
    /// word sequence this engine cannot resume from.
    /// </exception>
    static abstract TSelf FromState(ReadOnlySpan<ulong> state);
}

/// <summary>
/// Cold-path exception factory for the source engines. Every entry is non-inlined and never
/// returns, so no throw site, message or <see cref="ArgumentException"/> construction can
/// reach a draw.
/// </summary>
internal static class RandomThrowHelper
{
    /// <summary>Throws for an empty Mersenne Twister seed key.</summary>
    /// <param name="paramName">The name of the rejected parameter.</param>
    [DoesNotReturn]
    [StackTraceHidden]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowKeyMustNotBeEmpty(string paramName) =>
        throw new ArgumentException("A Mersenne Twister seed key must contain at least one word.", paramName);

    /// <summary>Throws for a destination span that cannot hold the engine state.</summary>
    /// <param name="required">The number of words the state export needs.</param>
    /// <param name="paramName">The name of the rejected parameter.</param>
    [DoesNotReturn]
    [StackTraceHidden]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowDestinationTooShortForState(int required, string paramName) =>
        throw new ArgumentException($"Destination span must hold at least {required} words of engine state.", paramName);

    /// <summary>Throws for a source span whose length is not the engine's snapshot word count.</summary>
    /// <param name="required">The number of words a snapshot of this engine holds.</param>
    /// <param name="actual">The length the caller supplied.</param>
    /// <param name="paramName">The name of the rejected parameter.</param>
    [DoesNotReturn]
    [StackTraceHidden]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowStateSpanLengthMismatch(int required, int actual, string paramName) =>
        throw new ArgumentException(
            $"An engine state snapshot must hold exactly {required} words, but {actual} were supplied.",
            paramName);

    /// <summary>Throws for a restored PCG stream increment that is not odd.</summary>
    /// <param name="paramName">The name of the rejected parameter.</param>
    [DoesNotReturn]
    [StackTraceHidden]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowStreamIncrementMustBeOdd(string paramName) =>
        throw new ArgumentException("A PCG stream increment must be odd, otherwise the LCG does not run at full period.", paramName);

    /// <summary>Throws for a ChaCha20 key longer than the eight words the state carries.</summary>
    /// <param name="length">The word count supplied.</param>
    /// <param name="paramName">The name of the rejected parameter.</param>
    [DoesNotReturn]
    [StackTraceHidden]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowKeyTooLong(int length, string paramName) =>
        throw new ArgumentException($"A ChaCha20 key holds eight words, but {length} were supplied.", paramName);

    /// <summary>Throws for a ChaCha20 nonce longer than the three words the state carries.</summary>
    /// <param name="length">The word count supplied.</param>
    /// <param name="paramName">The name of the rejected parameter.</param>
    [DoesNotReturn]
    [StackTraceHidden]
    [MethodImpl(MethodImplOptions.NoInlining)]
    internal static void ThrowNonceTooLong(int length, string paramName) =>
        throw new ArgumentException($"A ChaCha20 nonce holds three words, but {length} were supplied.", paramName);
}

/// <summary>
/// Operating-system entropy for the engines' zero-state fallback. The engines are seeded from
/// entropy on exactly one path - an all-zero (default-constructed) state, which would otherwise
/// stream zeros forever - so the cost is paid once per unseeded instance and never on a hot draw.
/// </summary>
internal static class RandomEntropy
{
    /// <summary>Reads 64 bits of operating-system entropy.</summary>
    /// <returns>A non-deterministic 64-bit word.</returns>
    internal static ulong NextUInt64()
    {
        Span<byte> bytes = stackalloc byte[sizeof(ulong)];
        RandomNumberGenerator.Fill(bytes);
        return BinaryPrimitives.ReadUInt64LittleEndian(bytes);
    }

    /// <summary>Fills <paramref name="words"/> with operating-system entropy.</summary>
    /// <param name="words">The words to overwrite. Must not be empty.</param>
    internal static void Fill(Span<uint> words)
    {
        Span<byte> bytes = stackalloc byte[words.Length * sizeof(uint)];
        RandomNumberGenerator.Fill(bytes);
        for (int i = 0; i < words.Length; i++)
        {
            words[i] = BinaryPrimitives.ReadUInt32LittleEndian(bytes.Slice(i * sizeof(uint)));
        }
    }
}
