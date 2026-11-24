namespace Axrone.Scene;

using System.Buffers;
using System.Text;
using Axrone.Hash;

/// <summary>
/// Stable symbol for entity, tag, asset and component names. The value is a
/// 64-bit FNV-1a digest, so it is deterministic across processes and can be
/// compared in hot paths without touching the original string.
/// </summary>
/// <remarks>
/// <c>SceneNameTable</c> owns reverse lookup and collision detection.
/// Registration-time hashing may rent a temporary UTF-8 buffer; steady-state
/// comparisons are single <see cref="ulong"/> compares.
/// </remarks>
[StructLayout(LayoutKind.Sequential, Pack = 8)]
public readonly record struct SceneStringId(ulong Value) :
    IComparable<SceneStringId>,
    IComparisonOperators<SceneStringId, SceneStringId, bool>
{
    private const int StackUtf8Budget = 256;

    /// <summary>Sentinel for an absent name.</summary>
    public static SceneStringId Invalid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new(0UL);
    }

    /// <summary>Whether the symbol names a non-empty string.</summary>
    public bool IsValid
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Value != 0UL;
    }

    /// <summary>Hashes a UTF-16 name through UTF-8.</summary>
    public static SceneStringId FromName(ReadOnlySpan<char> name)
    {
        if (name.IsEmpty)
        {
            return Invalid;
        }

        int maxByteCount = Encoding.UTF8.GetMaxByteCount(name.Length);
        byte[]? rented = null;
        Span<byte> buffer = maxByteCount <= StackUtf8Budget
            ? stackalloc byte[StackUtf8Budget]
            : (rented = ArrayPool<byte>.Shared.Rent(maxByteCount));

        try
        {
            int written = Encoding.UTF8.GetBytes(name, buffer);
            return FromUtf8(buffer[..written]);
        }
        finally
        {
            if (rented is not null)
            {
                ArrayPool<byte>.Shared.Return(rented);
            }
        }
    }

    /// <summary>Hashes an already encoded UTF-8 name.</summary>
    public static SceneStringId FromUtf8(ReadOnlySpan<byte> utf8Name)
    {
        if (utf8Name.IsEmpty)
        {
            return Invalid;
        }

        ulong hash = Fnv1a64Algorithm.Hash(utf8Name).Value;
        // Zero is the absent sentinel. FNV-1a reaching zero is a 1-in-2^64
        // event; remap it rather than losing the name entirely.
        return new SceneStringId(hash == 0UL ? 1UL : hash);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int CompareTo(SceneStringId other) => Value.CompareTo(other.Value);

    /// <summary>Determines whether the left symbol sorts before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <(SceneStringId left, SceneStringId right) => left.Value < right.Value;

    /// <summary>Determines whether the left symbol sorts at or before the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator <=(SceneStringId left, SceneStringId right) => left.Value <= right.Value;

    /// <summary>Determines whether the left symbol sorts after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >(SceneStringId left, SceneStringId right) => left.Value > right.Value;

    /// <summary>Determines whether the left symbol sorts at or after the right one.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator >=(SceneStringId left, SceneStringId right) => left.Value >= right.Value;

    /// <inheritdoc/>
    public override string ToString() => Value == 0UL
        ? "SceneStringId[Invalid]"
        : string.Create(CultureInfo.InvariantCulture, $"SceneStringId[{Value:X16}]");
}
