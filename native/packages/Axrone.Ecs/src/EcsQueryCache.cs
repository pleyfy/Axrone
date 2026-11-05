namespace Axrone.Ecs;

/// <summary>
/// One cached archetype-index list for an (all, none) mask pair. A null
/// <see cref="Matches"/> marks an unused slot.
/// </summary>
internal struct QueryCacheEntry
{
    internal ComponentMask All;
    internal ComponentMask None;
    internal int[]? Matches;
}

/// <summary>
/// Immutable query resolution snapshot: a version token plus its entry table. A new archetype
/// publishes a new version and the next query rebuilds; hits read one volatile field and an
/// entry scan with mask comparisons.
/// </summary>
/// <remarks>
/// The table is deliberately not a <c>Dictionary</c>: hashing a mask pair goes through
/// <see cref="EqualityComparer{T}.Default"/> for a composite key, and that first-use
/// initialization is allocated into whichever thread triggers it (measured: one deterministic
/// 592 B claim on the first cached resolve of a thread, with the surrounding code claiming
/// zero). Entry scans need no runtime-provided comparer, so a warm hit cannot be charged a
/// lazy-init cost at all.
/// </remarks>
internal sealed class ArchetypeQueryCache
{
    private const int InitialSlots = 8;

    private readonly Lock _gate = new();
    private QueryCacheSnapshot _snapshot = new(-1, new QueryCacheEntry[InitialSlots]);

    /// <summary>Resolves the matching archetype indices for a mask pair.</summary>
    internal int[] Resolve(ComponentMask all, ComponentMask none, ArchetypeGraph graph)
    {
        int version = graph.Version;
        QueryCacheSnapshot snapshot = Volatile.Read(ref _snapshot);
        if (snapshot.Version == version && TryLookup(snapshot.Entries, in all, in none, out int[]? cached))
        {
            return cached;
        }

        lock (_gate)
        {
            snapshot = _snapshot;
            if (snapshot.Version == version && TryLookup(snapshot.Entries, in all, in none, out cached))
            {
                return cached;
            }

            QueryCacheEntry[] entries = snapshot.Version == version
                ? (QueryCacheEntry[])snapshot.Entries.Clone()
                : new QueryCacheEntry[InitialSlots];

            int slot = FreeSlot(entries);
            if (slot < 0)
            {
                entries = Grow(entries);
                slot = FreeSlot(entries);
            }

            entries[slot] = new QueryCacheEntry
            {
                All = all,
                None = none,
                Matches = Build(graph, in all, in none),
            };

            Volatile.Write(ref _snapshot, new QueryCacheSnapshot(version, entries));
            return entries[slot].Matches!;
        }
    }

    private static bool TryLookup(
        QueryCacheEntry[] entries,
        in ComponentMask all,
        in ComponentMask none,
        [NotNullWhen(true)] out int[]? matches)
    {
        for (int index = 0; index < entries.Length; index++)
        {
            ref QueryCacheEntry entry = ref entries[index];
            if (entry.Matches is not null && entry.All == all && entry.None == none)
            {
                matches = entry.Matches;
                return true;
            }
        }

        matches = null;
        return false;
    }

    private static int FreeSlot(QueryCacheEntry[] entries)
    {
        for (int index = 0; index < entries.Length; index++)
        {
            if (entries[index].Matches is null)
            {
                return index;
            }
        }

        return -1;
    }

    private static QueryCacheEntry[] Grow(QueryCacheEntry[] entries)
    {
        QueryCacheEntry[] grown = new QueryCacheEntry[entries.Length * 2];
        Array.Copy(entries, grown, entries.Length);
        return grown;
    }

    private static int[] Build(ArchetypeGraph graph, in ComponentMask all, in ComponentMask none)
    {
        ReadOnlySpan<Archetype> archetypes = graph.AsSpan();
        int[] matches = new int[archetypes.Length];
        int count = 0;
        for (int index = 0; index < archetypes.Length; index++)
        {
            Archetype archetype = archetypes[index];
            if (archetype.Mask.ContainsAll(in all) && !archetype.Mask.ContainsAny(in none))
            {
                matches[count++] = index;
            }
        }

        if (count == matches.Length)
        {
            return matches;
        }

        int[] trimmed = new int[count];
        Array.Copy(matches, trimmed, count);
        return trimmed;
    }

    private sealed class QueryCacheSnapshot(int version, QueryCacheEntry[] entries)
    {
        internal readonly int Version = version;
        internal readonly QueryCacheEntry[] Entries = entries;
    }
}
