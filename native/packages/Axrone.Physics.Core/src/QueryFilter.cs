namespace Axrone.Physics.Core;

/// <summary>
/// Filter a spatial query carries: category/mask bits select which shapes the
/// query may report, and a shared group index overrides them (positive pins
/// the pair together, negative keeps a pair apart). A query without a filter
/// (a value whose mask is unset) reports every shape. The broadphase only
/// prunes bounds; the match is decided per shape with <see cref="Matches"/>
/// on the hot path without allocating.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct QueryFilter(uint Category, uint Mask, int Group)
{
    /// <summary>No-filter value: a unset mask reports every shape.</summary>
    public static QueryFilter None => default;

    /// <summary>Match-everything filter: default category, all masks, no group pin.</summary>
    public static QueryFilter Default => new((uint)CollisionCategory.Default, (uint)CollisionCategory.All, 0);

    /// <summary>Whether this value carries no filtering at all.</summary>
    public bool IsEmpty
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => Mask == 0;
    }

    /// <summary>
    /// Determines whether a shape owning <paramref name="shape"/> may be
    /// reported to a query carrying <paramref name="query"/>. An empty query
    /// filter matches everything; a pinned non-zero query group restricts the
    /// answer to shapes of that group (positive includes, negative excludes),
    /// and shapes without a group pin must cross-match the category/mask
    /// pair: the shape is visible to the query and the query is visible to
    /// the shape.
    /// </summary>
    /// <param name="shape">The filter stored on the candidate shape.</param>
    /// <param name="query">The filter carried by the query.</param>
    /// <returns><see langword="true"/> when the shape passes the query filter.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static bool Matches(in CollisionFilter shape, in QueryFilter query)
    {
        if (query.IsEmpty)
        {
            return true;
        }

        if (query.Group != 0)
        {
            if (shape.Group != query.Group)
            {
                return false;
            }

            return query.Group > 0;
        }

        return ((shape.Category & query.Mask) != 0) && ((query.Category & shape.Mask) != 0);
    }
}
