namespace Axrone.Scene.Rendering;

/// <summary>
/// Local-space reflection probe volume. The collector transforms the center and
/// extents into world space; the editor or a reflection pass uses the ordered
/// result to pick the cubemap that affects the camera.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneReflectionProbe : ISceneDataComponent
{
    /// <summary>Cubemap texture asset id.</summary>
    public SceneAssetId<TextureAssetTag> CubemapId;

    /// <summary>Local-space center.</summary>
    public Vec3 LocalCenter;

    /// <summary>Local-space half extents.</summary>
    public Vec3 Extents;

    /// <summary>Intensity multiplier.</summary>
    public float Intensity;

    /// <summary>Selection priority; higher wins.</summary>
    public int Priority;

    /// <summary>Whether the probe participates in collection.</summary>
    public bool Enabled;

    /// <summary>Default probe: enabled, unit extents, white intensity.</summary>
    public static SceneReflectionProbe Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            CubemapId = default,
            LocalCenter = Vec3.Zero,
            Extents = Vec3.One,
            Intensity = 1.0f,
            Priority = 0,
            Enabled = true
        };
    }
}

/// <summary>World-space planning record for one reflection probe.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneReflectionProbeRenderItem
{
    /// <summary>Owning actor.</summary>
    public SceneActor Actor;

    /// <summary>Cubemap texture asset id.</summary>
    public SceneAssetId<TextureAssetTag> CubemapId;

    /// <summary>World-space box center.</summary>
    public Vec3 WorldCenter;

    /// <summary>World-space half extents.</summary>
    public Vec3 WorldExtents;

    /// <summary>Intensity multiplier.</summary>
    public float Intensity;

    /// <summary>Selection priority.</summary>
    public int Priority;

    /// <summary>Whether the camera position lies inside the probe volume.</summary>
    public bool ContainsCamera;

    /// <summary>Squared distance from the camera to the probe center.</summary>
    public float CameraDistanceSquared;
}

/// <summary>
/// Collects reflection probes, orders them by priority, distance and actor, and
/// exposes the highest-priority probe containing the camera. The item array is
/// reused, so a warmed frame allocates nothing.
/// </summary>
public sealed class SceneReflectionProbeCollector
{
    private SceneReflectionProbeRenderItem[] _items;
    private int _count;
    private int _selectedIndex;
    private readonly ProbeComparer _comparer;

    /// <summary>Creates a collector with an initial capacity.</summary>
    public SceneReflectionProbeCollector(int initialCapacity = 32)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Reflection-probe capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneReflectionProbeRenderItem[Math.Max(initialCapacity, 8)];
        _selectedIndex = -1;
        _comparer = new ProbeComparer();
    }

    /// <summary>Current number of planned probes.</summary>
    public int Count => _count;

    /// <summary>Index of the selected probe, or -1.</summary>
    public int SelectedIndex => _selectedIndex;

    /// <summary>Ordered probes.</summary>
    public ReadOnlySpan<SceneReflectionProbeRenderItem> Items => _items.AsSpan(0, _count);

    /// <summary>Collects and orders probes for a camera position.</summary>
    public int Collect(SceneWorld world, in Vec3 cameraPosition)
    {
        ArgumentNullException.ThrowIfNull(world);

        _count = 0;
        _selectedIndex = -1;
        EnsureCapacity(Math.Max(world.ActorCount, 8));

        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneReflectionProbe probe) ||
                !probe.Enabled ||
                !probe.CubemapId.IsValid ||
                probe.Extents.X <= 0.0f ||
                probe.Extents.Y <= 0.0f ||
                probe.Extents.Z <= 0.0f)
            {
                continue;
            }

            Mat4 matrix = world.GetWorldMatrix3D(actor);
            Vec4 localCenter = new(probe.LocalCenter.X, probe.LocalCenter.Y, probe.LocalCenter.Z, 1.0f);
            Vec4 center = matrix * localCenter;
            Vec3 worldCenter = new(center.X, center.Y, center.Z);
            Vec3 worldExtents = TransformExtents(in matrix, in probe.Extents);

            if (_count == _items.Length)
            {
                Grow();
            }

            bool contains =
                MathF.Abs(cameraPosition.X - worldCenter.X) <= worldExtents.X &&
                MathF.Abs(cameraPosition.Y - worldCenter.Y) <= worldExtents.Y &&
                MathF.Abs(cameraPosition.Z - worldCenter.Z) <= worldExtents.Z;

            float dx = worldCenter.X - cameraPosition.X;
            float dy = worldCenter.Y - cameraPosition.Y;
            float dz = worldCenter.Z - cameraPosition.Z;

            ref SceneReflectionProbeRenderItem item = ref _items[_count];
            item.Actor = actor;
            item.CubemapId = probe.CubemapId;
            item.WorldCenter = worldCenter;
            item.WorldExtents = worldExtents;
            item.Intensity = probe.Intensity;
            item.Priority = probe.Priority;
            item.ContainsCamera = contains;
            item.CameraDistanceSquared = (dx * dx) + (dy * dy) + (dz * dz);
            _count++;
        }

        SceneIntroSort<SceneReflectionProbeRenderItem, ProbeComparer>.Sort(
            _items.AsSpan(0, _count),
            _comparer);

        for (int i = 0; i < _count; i++)
        {
            if (_items[i].ContainsCamera)
            {
                _selectedIndex = i;
                break;
            }
        }

        return _count;
    }

    /// <summary>Gets the selected probe.</summary>
    public bool TryGetSelected(out SceneReflectionProbeRenderItem item)
    {
        if ((uint)_selectedIndex < (uint)_count)
        {
            item = _items[_selectedIndex];
            return true;
        }

        item = default;
        return false;
    }

    /// <summary>Drops the current plan without releasing the buffer.</summary>
    public void Clear()
    {
        _count = 0;
        _selectedIndex = -1;
    }

    private static Vec3 TransformExtents(in Mat4 matrix, in Vec3 extents)
    {
        Vec4 x = matrix.Column0;
        Vec4 y = matrix.Column1;
        Vec4 z = matrix.Column2;

        return new Vec3(
            (MathF.Abs(x.X) * extents.X) + (MathF.Abs(y.X) * extents.Y) + (MathF.Abs(z.X) * extents.Z),
            (MathF.Abs(x.Y) * extents.X) + (MathF.Abs(y.Y) * extents.Y) + (MathF.Abs(z.Y) * extents.Z),
            (MathF.Abs(x.Z) * extents.X) + (MathF.Abs(y.Z) * extents.Y) + (MathF.Abs(z.Z) * extents.Z));
    }

    private void EnsureCapacity(int required)
    {
        if (required > _items.Length)
        {
            GrowTo(required);
        }
    }

    private void Grow()
    {
        if (_items.Length > int.MaxValue / 2)
        {
            throw new SceneConfigurationException("Reflection-probe capacity overflow.");
        }

        GrowTo(_items.Length * 2);
    }

    private void GrowTo(int required)
    {
        int capacity = _items.Length;
        while (capacity < required)
        {
            if (capacity > int.MaxValue / 2)
            {
                throw new SceneConfigurationException("Reflection-probe capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }

    private readonly struct ProbeComparer : IComparer<SceneReflectionProbeRenderItem>
    {
        public int Compare(SceneReflectionProbeRenderItem left, SceneReflectionProbeRenderItem right)
        {
            int priority = right.Priority.CompareTo(left.Priority);
            if (priority != 0)
            {
                return priority;
            }

            float leftDistance = left.CameraDistanceSquared;
            float rightDistance = right.CameraDistanceSquared;
            int distance = leftDistance.CompareTo(rightDistance);
            return distance != 0 ? distance : left.Actor.CompareTo(right.Actor);
        }
    }
}
