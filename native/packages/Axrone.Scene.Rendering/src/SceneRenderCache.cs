namespace Axrone.Scene.Rendering;

/// <summary>
/// Cache identity for a planned render frame. Version fields are supplied by the
/// caller (world structural version, settings hash) so the cache never guesses
/// invalidation; equal keys guarantee an identical item stream.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneRenderCacheKey(
    ulong WorldVersion,
    SceneAssetId<RenderPassAssetTag> Pass,
    ulong SettingsHash);

/// <summary>
/// Reusable item cache for one pass. Storing copies the span into a retained
/// buffer; after the buffer reaches the steady-state size, store and lookup
/// allocate nothing. Any key change or explicit invalidation is a miss.
/// </summary>
/// <typeparam name="TItem">Planning record or pass type; structs and classes are both supported.</typeparam>
public sealed class SceneRenderCache<TItem>
    where TItem : notnull
{
    private TItem[] _items = [];
    private int _count;
    private SceneRenderCacheKey _key;
    private bool _valid;

    /// <summary>Gets the cached item count.</summary>
    public int Count => _count;

    /// <summary>Gets whether the cache currently holds a valid entry.</summary>
    public bool IsValid => _valid;

    /// <summary>Gets the key of the cached entry.</summary>
    public SceneRenderCacheKey Key => _key;

    /// <summary>Looks up a cached entry by exact key.</summary>
    public bool TryGet(in SceneRenderCacheKey key, out ReadOnlySpan<TItem> items)
    {
        if (_valid && _key == key)
        {
            items = _items.AsSpan(0, _count);
            return true;
        }

        items = default;
        return false;
    }

    /// <summary>Stores an item stream under a key, replacing any previous entry.</summary>
    public void Store(in SceneRenderCacheKey key, ReadOnlySpan<TItem> items)
    {
        EnsureCapacity(items.Length);
        items.CopyTo(_items);
        _count = items.Length;
        _key = key;
        _valid = true;
    }

    /// <summary>Invalidates the current entry without releasing the buffer.</summary>
    public void Invalidate()
    {
        _valid = false;
        _count = 0;
    }

    private void EnsureCapacity(int required)
    {
        if (required <= _items.Length)
        {
            return;
        }

        int capacity = Math.Max(_items.Length, 16);
        while (capacity < required)
        {
            if (capacity > int.MaxValue / 2)
            {
                throw new SceneConfigurationException("Render-cache capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }
}
