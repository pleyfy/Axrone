namespace Axrone.Scene.Rendering;

/// <summary>
/// Renderer-facing pose sink. Scene animation publishes the composed world bone
/// palette here; the renderer converts it into GPU skinning state. Only the
/// palette crosses the package boundary, so Scene.Rendering never references the
/// animation package.
/// </summary>
public interface ISceneBonePaletteSink
{
    /// <summary>Publishes one actor's world-space bone palette.</summary>
    /// <param name="actor">Animated actor.</param>
    /// <param name="worldPalette">World bone matrices, one per bone.</param>
    void ApplyBonePalette(SceneActor actor, ReadOnlySpan<Mat4> worldPalette);
}

/// <summary>Reads the latest world-space bone palette of an actor.</summary>
public interface ISceneBonePaletteSource
{
    /// <summary>Looks up an actor's current palette.</summary>
    /// <param name="actor">Animated actor.</param>
    /// <param name="worldPalette">World bone matrices, one per bone.</param>
    bool TryGetBonePalette(SceneActor actor, out ReadOnlySpan<Mat4> worldPalette);
}

/// <summary>
/// Actor-keyed palette storage shared by the animator bridge and the skinned
/// mesh renderer. Palettes live in pinned arrays that only grow, so updating an
/// existing actor is allocation-free. An empty palette removes the entry, which
/// makes an unbound animator stop contributing to skinning.
/// </summary>
/// <remarks>
/// The actor index and revision are lock-guarded. <see cref="TryGetBonePalette"/>
/// returns a view over the resident array; consume it before the next write for
/// that actor (the normal same-frame render path does).
/// </remarks>
public sealed class SceneBonePaletteStore : ISceneBonePaletteSink, ISceneBonePaletteSource
{
    private readonly Dictionary<SceneActor, PaletteSlot> _slots = new();
    private readonly Lock _gate = new();
    private long _revision;

    /// <summary>Gets the number of actors with a resident palette.</summary>
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
    public void ApplyBonePalette(SceneActor actor, ReadOnlySpan<Mat4> worldPalette)
    {
        if (!actor.IsValid)
        {
            return;
        }

        lock (_gate)
        {
            if (worldPalette.IsEmpty)
            {
                _ = _slots.Remove(actor);
                _revision++;
                return;
            }

            if (!_slots.TryGetValue(actor, out PaletteSlot? slot))
            {
                slot = new PaletteSlot();
                _slots.Add(actor, slot);
            }

            slot.Set(worldPalette);
            _revision++;
        }
    }

    /// <inheritdoc/>
    public bool TryGetBonePalette(SceneActor actor, out ReadOnlySpan<Mat4> worldPalette)
    {
        lock (_gate)
        {
            if (actor.IsValid && _slots.TryGetValue(actor, out PaletteSlot? slot))
            {
                worldPalette = slot.Palette;
                return true;
            }
        }

        worldPalette = default;
        return false;
    }

    /// <summary>Removes one actor's palette.</summary>
    public bool Remove(SceneActor actor)
    {
        lock (_gate)
        {
            if (!_slots.Remove(actor))
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
