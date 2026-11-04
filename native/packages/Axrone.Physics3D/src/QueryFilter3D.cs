namespace Axrone.Physics3D;

/// <summary>
/// Opt-in pruning for world queries. Each set field must pass for a shape to
/// be considered; unset fields accept everything. Group is an exact identity
/// match, category and mask are bitwise AND tests — the single web-reference
/// query semantics. Pairwise collision keeps its own mutual group-sign
/// semantics on the shared collision filter.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct QueryFilter3D(uint? Category, uint? Mask, int? Group)
{
    /// <summary>Accepts every shape; what queries run when no filter is passed.</summary>
    public static QueryFilter3D Any => default;

    /// <summary>Whether a shape carrying <paramref name="shape"/> survives this query filter.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public readonly bool Matches(in CollisionFilter shape)
    {
        if (Group is int group && shape.Group != group)
        {
            return false;
        }

        if (Category is uint category && (shape.Category & category) == 0u)
        {
            return false;
        }

        if (Mask is uint mask && (shape.Mask & mask) == 0u)
        {
            return false;
        }

        return true;
    }
}
