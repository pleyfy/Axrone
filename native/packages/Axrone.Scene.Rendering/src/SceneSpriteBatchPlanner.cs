namespace Axrone.Scene.Rendering;

/// <summary>One contiguous sprite run sharing a texture and material.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneSpriteInstanceGroup(
    SceneAssetId<TextureAssetTag> TextureId,
    SceneAssetId<MaterialAssetTag> MaterialId,
    int FirstItem,
    int Count,
    bool Instanced,
    bool RequiresImmediate = false);

/// <summary>
/// Splits a sorted sprite plan into contiguous runs keyed by texture and
/// material. A run is marked <see cref="SceneSpriteInstanceGroup.Instanced"/>
/// when it reaches the deterministic fast-path threshold. The group buffer is
/// reused, so a warmed plan allocates nothing.
/// </summary>
public sealed class SceneSpriteBatchPlanner
{
    /// <summary>Default run length at which the instanced path takes over.</summary>
    public const int DefaultMinInstancesForFastPath = 32;

    private SceneSpriteInstanceGroup[] _groups;
    private int _count;

    /// <summary>Creates a planner with a group capacity and fast-path threshold.</summary>
    public SceneSpriteBatchPlanner(
        int initialCapacity = 64,
        int minInstancesForFastPath = DefaultMinInstancesForFastPath)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Sprite-group capacity must be positive; received {initialCapacity}.");
        }

        if (minInstancesForFastPath <= 0)
        {
            throw new SceneConfigurationException(
                $"Sprite instancing threshold must be positive; received {minInstancesForFastPath}.");
        }

        _groups = new SceneSpriteInstanceGroup[initialCapacity];
        MinInstancesForFastPath = minInstancesForFastPath;
    }

    /// <summary>Gets the run length at which the instanced path takes over.</summary>
    public int MinInstancesForFastPath { get; }

    /// <summary>Gets the number of planned runs.</summary>
    public int Count => _count;

    /// <summary>Gets the planned runs in draw order.</summary>
    public ReadOnlySpan<SceneSpriteInstanceGroup> Groups => _groups.AsSpan(0, _count);

    /// <summary>Number of runs selected for the instanced path in the last plan.</summary>
    public int InstancedGroupCount { get; private set; }

    /// <summary>Plans contiguous texture/material runs and returns the run count.</summary>
    public int Plan(ReadOnlySpan<SceneSpriteRenderItem> items)
    {
        _count = 0;
        InstancedGroupCount = 0;
        int start = 0;
        while (start < items.Length)
        {
            SceneAssetId<TextureAssetTag> texture = items[start].TextureId;
            SceneAssetId<MaterialAssetTag> material = items[start].MaterialId;
            bool requiresImmediate = items[start].HasSlice;
            int end = start + 1;
            while (end < items.Length &&
                   items[end].TextureId == texture &&
                   items[end].MaterialId == material &&
                   items[end].HasSlice == requiresImmediate)
            {
                end++;
            }

            bool instanced = !requiresImmediate && end - start >= MinInstancesForFastPath;
            if (instanced)
            {
                InstancedGroupCount++;
            }

            if (_count == _groups.Length)
            {
                Grow();
            }

            _groups[_count++] = new SceneSpriteInstanceGroup(
                texture,
                material,
                start,
                end - start,
                instanced,
                requiresImmediate);
            start = end;
        }

        return _count;
    }

    /// <summary>Drops the current plan without releasing the buffer.</summary>
    public void Clear()
    {
        _count = 0;
        InstancedGroupCount = 0;
    }

    private void Grow()
    {
        if (_groups.Length > int.MaxValue / 2)
        {
            throw new SceneConfigurationException("Sprite-group capacity overflow.");
        }

        Array.Resize(ref _groups, _groups.Length * 2);
    }
}
