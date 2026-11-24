namespace Axrone.Random;

using System.Security.Cryptography;

/// <summary>
/// The operating-system entropy source: the web engine's <c>CryptoEngine</c> counterpart, whose
/// draws come from <see cref="RandomNumberGenerator.Fill(Span{byte})"/> instead of a recurrence.
/// </summary>
/// <remarks>
/// <para><b>Nothing to be in.</b> The state is empty because there is no stream to carry: entropy
/// comes from the operating system on every draw. That makes this the one engine in the package
/// that is <em>not</em> reproducible, so <see cref="Create(ulong)"/> ignores its seed, equality is
/// vacuous, and it offers no <see cref="IRandomStateSnapshot{TSelf}"/> surface -
/// <see cref="RandomEngineTypeExtensions.GetWordCount"/> reports zero for it.</para>
/// <para>Use it for tokens, salts and key material. Do not use it for a deterministic simulation
/// replay, and do not expect the throughput of the arithmetic engines: each draw is a syscall-level
/// entropy read.</para>
/// </remarks>
public readonly struct OperatingSystemEntropySource : IRandomSource<OperatingSystemEntropySource>, IEquatable<OperatingSystemEntropySource>
{
    /// <summary>Returns the single state this source has; the seed is ignored on purpose.</summary>
    /// <param name="seed">Unused. Entropy cannot be seeded.</param>
    /// <returns>A default value.</returns>
    public static OperatingSystemEntropySource Create(ulong seed) => default;

    /// <summary>Draws 64 bits of operating-system entropy.</summary>
    /// <param name="source">The empty state, accepted for the engine contract and never read.</param>
    /// <returns>A non-deterministic 64-bit word.</returns>
    public static ulong NextUInt64(ref OperatingSystemEntropySource source)
    {
        Span<byte> bytes = stackalloc byte[sizeof(ulong)];
        RandomNumberGenerator.Fill(bytes);
        return BinaryPrimitives.ReadUInt64LittleEndian(bytes);
    }

    /// <summary>Draws 32 bits of operating-system entropy.</summary>
    /// <param name="source">The empty state, accepted for the engine contract and never read.</param>
    /// <returns>A non-deterministic 32-bit word.</returns>
    public static uint NextUInt32(ref OperatingSystemEntropySource source)
    {
        Span<byte> bytes = stackalloc byte[sizeof(uint)];
        RandomNumberGenerator.Fill(bytes);
        return BinaryPrimitives.ReadUInt32LittleEndian(bytes);
    }

    /// <summary>Every value of this source is the same empty state.</summary>
    /// <param name="other">The value to compare with.</param>
    /// <returns><see langword="true"/> always.</returns>
    public readonly bool Equals(OperatingSystemEntropySource other) => true;

    /// <inheritdoc />
    public override readonly bool Equals(object? obj) => obj is OperatingSystemEntropySource;

    /// <inheritdoc />
    public override readonly int GetHashCode() => 0;

    /// <summary>Always true: the source has no state to differ.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/>.</returns>
    public static bool operator ==(OperatingSystemEntropySource left, OperatingSystemEntropySource right) => true;

    /// <summary>Always false: the source has no state to differ.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="false"/>.</returns>
    public static bool operator !=(OperatingSystemEntropySource left, OperatingSystemEntropySource right) => false;
}
