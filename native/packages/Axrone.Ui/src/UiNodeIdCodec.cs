namespace Axrone.Ui;

/// <summary>
/// Bit layout of <see cref="UiNodeId"/>: 20 slot bits above a reserved one-based
/// index, 12 generation bits above that. A stale slot that was recycled carries
/// the old generation and therefore fails identity comparison instead of
/// aliasing the new occupant.
/// </summary>
internal static class UiNodeIdCodec
{
    /// <summary>Bits reserved for the generation counter.</summary>
    internal const int GenerationBits = 12;

    /// <summary>Highest representable generation before a slot retires.</summary>
    internal const uint MaxGeneration = (1U << GenerationBits) - 1;

    /// <summary>Highest representable slot index.</summary>
    internal const int MaxIndex = (1 << (32 - GenerationBits)) - 1;

    private const int IndexShift = 0;
    private const int GenerationShift = 32 - GenerationBits;
    private const uint IndexMask = (1U << (32 - GenerationBits)) - 1;

    /// <summary>Builds an identifier from a slot index and its generation.</summary>
    public static UiNodeId Create(int index, uint generation)
    {
        return new UiNodeId(((generation & MaxGeneration) << GenerationShift) | (uint)(index + 1));
    }

    /// <summary>Extracts the slot index; only valid for a non-zero identifier.</summary>
    public static int GetIndex(UiNodeId id) => (int)((id.Value >> IndexShift) & IndexMask) - 1;

    /// <summary>Extracts the generation counter.</summary>
    public static uint GetGeneration(UiNodeId id) => id.Value >> GenerationShift;
}
