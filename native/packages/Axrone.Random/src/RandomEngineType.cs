namespace Axrone.Random;

/// <summary>
/// The engines this package can be configured with, in the fixed order of the engine registry.
/// A byte-backed tag: it is what a serialized scene, a save file or a command line carries when
/// it says "give me this generator" without naming a type.
/// </summary>
/// <remarks>
/// <para><b>Values are permanent.</b> The numeric value of a member is its serialized form, so
/// members may be appended but never reordered, renumbered or removed. The explicit assignments
/// make the wire contract visible in the source.</para>
/// <para><b>Storage is a byte, deliberately.</b> CA1028 asks for an int, but this tag travels
/// through serialized scene files, save files and command lines, where a one-byte field is the
/// difference between a readable record and a padded word - and the underlying values are
/// compared as bytes anyway. The rule is suppressed here rather than project-wide, so it stays
/// visible that the storage width is a decision rather than an oversight.</para>
/// <para><b>No factory, on purpose.</b> There is deliberately no
/// <c>CreateSource(RandomEngineType, ulong)</c> here. Every hot draw goes through the generic,
/// fully inlined <see cref="RandomEngine{TEngine}"/>, and any factory that could turn this tag
/// into a live stream would have to box the value-type engine, hide the static-abstract
/// dispatch behind an interface call, or return a delegate that allocates - all three put a
/// virtual call or a heap object in front of a multiply. Configuration code that already knows
/// which engine it wants calls <c>TEngine.Create(seed)</c> directly with its own concrete type,
/// and a genuinely data-driven caller switches on the tag once, outside the draw loop. A factory
/// belongs to whichever layer owns the plumbing, not to this package.</para>
/// </remarks>
#pragma warning disable CA1028 // Storage is a byte on purpose: the tag is a serialized wire value, not an int-sized field.

public enum RandomEngineType : byte
{
    /// <summary>WyRand: one word of state, the throughput choice for short streams.</summary>
    WyRand = 0,

    /// <summary>xoroshiro128++: the ambient thread-local stream.</summary>
    Xoroshiro128PlusPlus = 1,

    /// <summary>xoshiro256++: the default choice for long-lived streams and parallel lanes.</summary>
    Xoshiro256PlusPlus = 2,

    /// <summary>PCG-XSH-RR 64/32: the reference stream and the jump-ahead lane primitive.</summary>
    Pcg = 3,

    /// <summary>MT19937: the compatibility engine for reproducing an existing MT stream.</summary>
    MersenneTwister = 4,

    /// <summary>ChaCha20: the deterministic cryptographic stream, RFC 8439 block discipline.</summary>
    ChaCha20 = 5,

    /// <summary>Operating-system entropy: the non-reproducible stream for security-sensitive draws.</summary>
    OperatingSystem = 6
}

#pragma warning restore CA1028

/// <summary>
/// Queries about an engine selected by tag, for code that must stay generic over the choice.
/// </summary>
public static class RandomEngineTypeExtensions
{
    /// <summary>
    /// Gets the number of 64-bit words one <see cref="IRandomStateSnapshot{TSelf}"/> snapshot of
    /// that engine holds.
    /// </summary>
    /// <param name="engineType">The engine to size a snapshot buffer for.</param>
    /// <returns>
    /// The word count, or <c>0</c> for <see cref="RandomEngineType.MersenneTwister"/> and
    /// <see cref="RandomEngineType.OperatingSystem"/>, which are exempt from the uniform word
    /// contract: MT19937's 2 496-byte state cannot be expressed without packing or losing the read
    /// cursor, and the operating-system source holds no state at all. Zero therefore means "no
    /// uniform snapshot" - the caller must branch to the engine's own snapshot API instead of sizing
    /// a buffer.
    /// </returns>
    /// <exception cref="ArgumentOutOfRangeException"><paramref name="engineType"/> is not a defined member.</exception>
    public static int GetWordCount(this RandomEngineType engineType) => engineType switch
    {
        RandomEngineType.WyRand => WyRand.WordCount,
        RandomEngineType.Xoroshiro128PlusPlus => Xoroshiro128PlusPlus.WordCount,
        RandomEngineType.Xoshiro256PlusPlus => Xoshiro256PlusPlus.WordCount,
        RandomEngineType.Pcg => PcgEngine.WordCount,
        RandomEngineType.MersenneTwister => 0,
        RandomEngineType.ChaCha20 => ChaCha20Source.WordCount,
        RandomEngineType.OperatingSystem => 0,
        _ => throw new ArgumentOutOfRangeException(
            nameof(engineType),
            engineType,
            "Unknown random engine type.")
    };

    /// <summary>Gets a value indicating whether that engine can snapshot through the uniform 64-bit word contract.</summary>
    /// <param name="engineType">The engine to test.</param>
    /// <returns>
    /// <see langword="true"/> when <see cref="GetWordCount"/> returns a usable buffer size;
    /// <see langword="false"/> for the exempt MT19937.
    /// </returns>
    public static bool SupportsUniformSnapshot(this RandomEngineType engineType) => engineType.GetWordCount() != 0;
}