namespace Axrone.Scene.Rendering;

/// <summary>
/// Renderer-facing pose sink. Scene animation publishes the composed world bone
/// palette here; the renderer converts it into GPU skinning state. Only the
/// palette crosses the package boundary, so Scene.Rendering never references the
/// animation package.
/// </summary>
public interface ISceneBonePaletteSink
{
    /// <summary>Publishes one entity's world-space bone palette.</summary>
    /// <param name="entity">Animated entity.</param>
    /// <param name="worldPalette">World bone matrices, one per bone.</param>
    void ApplyBonePalette(SceneEntity entity, ReadOnlySpan<Mat4> worldPalette);
}

/// <summary>Reads the latest world-space bone palette of an entity.</summary>
public interface ISceneBonePaletteSource
{
    /// <summary>Looks up an entity's current palette.</summary>
    /// <param name="entity">Animated entity.</param>
    /// <param name="worldPalette">World bone matrices, one per bone.</param>
    bool TryGetBonePalette(SceneEntity entity, out ReadOnlySpan<Mat4> worldPalette);
}

/// <summary>
/// Entity-keyed palette storage shared by the animator bridge and the skinned
/// mesh renderer. Palettes live in pinned arrays that only grow, so updating an
/// existing entity is allocation-free. An empty palette removes the entry, which
/// makes an unbound animator stop contributing to skinning.
/// </summary>
/// <remarks>
/// The entity index and revision are lock-guarded. <see cref="TryGetBonePalette"/>
/// returns a view over the resident array; consume it before the next write for
/// that entity (the normal same-frame render path does).
/// </remarks>
public sealed class SceneBonePaletteStore : ISceneBonePaletteSink, ISceneBonePaletteSource
{
    private readonly Dictionary<SceneEntity, PaletteSlot> _slots = new();
    private readonly Lock _gate = new();
    private long _revision;

    /// <summary>Gets the number of entities with a resident palette.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _slots.Count;
            }
        }
    }

    /// <summary>Gets a monotonic revision incremented on every palette write.</summary>
    public long Revision => Volatile.Read(ref _revision);

    /// <inheritdoc/>
    public void ApplyBonePalette(SceneEntity entity, ReadOnlySpan<Mat4> worldPalette)
    {
        if (!entity.IsValid)
        {
            return;
        }

        lock (_gate)
        {
            if (worldPalette.IsEmpty)
            {
                _ = _slots.Remove(entity);
                _revision++;
                return;
            }

            if (!_slots.TryGetValue(entity, out PaletteSlot? slot))
            {
                slot = new PaletteSlot();
                _slots.Add(entity, slot);
            }

            slot.Set(worldPalette);
            _revision++;
        }
    }

    /// <inheritdoc/>
    public bool TryGetBonePalette(SceneEntity entity, out ReadOnlySpan<Mat4> worldPalette)
    {
        lock (_gate)
        {
            if (entity.IsValid && _slots.TryGetValue(entity, out PaletteSlot? slot))
            {
                worldPalette = slot.Palette;
                return true;
            }
        }

        worldPalette = default;
        return false;
    }

    /// <summary>Removes one entity's palette.</summary>
    public bool Remove(SceneEntity entity)
    {
        lock (_gate)
        {
            if (!_slots.Remove(entity))
            {
                return false;
            }

            _revision++;
            return true;
        }
    }

    /// <summary>Removes every palette without releasing slot buffers.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            _slots.Clear();
            _revision++;
        }
    }

    private sealed class PaletteSlot
    {
        private Mat4[] _palette = [];

        public ReadOnlySpan<Mat4> Palette => _palette.AsSpan(0, Count);

        public int Count { get; private set; }

        public void Set(ReadOnlySpan<Mat4> palette)
        {
            if (_palette.Length < palette.Length)
            {
                _palette = GC.AllocateArray<Mat4>(Math.Max(palette.Length, 8), pinned: true);
            }

            palette.CopyTo(_palette);
            Count = palette.Length;
        }
    }
}
