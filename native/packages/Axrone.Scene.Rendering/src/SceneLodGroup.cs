namespace Axrone.Scene.Rendering;

/// <summary>Metric used to pick a LOD level.</summary>
public enum SceneLodMetric : byte
{
    /// <summary>Camera distance in world units.</summary>
    Distance = 0,

    /// <summary>Projected sphere radius in viewport pixels.</summary>
    ScreenRadius = 1
}

/// <summary>One LOD entry. Threshold meaning depends on the group metric.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneLodLevel(
    SceneAssetId<MeshAssetTag> MeshId,
    SceneAssetId<MaterialAssetTag> MaterialId,
    float Threshold);

/// <summary>Inline storage for up to four LOD levels.</summary>
[InlineArray(SceneLodGroup.MaxLevels)]
public struct SceneLodLevelArray
{
    private SceneLodLevel _element0;
}

/// <summary>
/// Level-of-detail group. Levels are ordered from highest detail (index zero)
/// to lowest; a threshold is either the maximum camera distance or the minimum
/// projected radius in pixels, depending on <see cref="Metric"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneLodGroup : ISceneDataComponent
{
    /// <summary>Maximum number of levels a group can carry.</summary>
    public const int MaxLevels = 4;

    /// <summary>Level entries.</summary>
    public SceneLodLevelArray Levels;

    /// <summary>Number of valid entries in <see cref="Levels"/>.</summary>
    public int LevelCount;

    /// <summary>Metric used for threshold comparisons.</summary>
    public SceneLodMetric Metric;

    /// <summary>Hysteresis fraction applied around thresholds; zero disables it.</summary>
    public float Hysteresis;

    /// <summary>Whether the group participates in collection.</summary>
    public bool Enabled;

    /// <summary>Render pass membership.</summary>
    public SceneAssetId<RenderPassAssetTag> PassId;

    /// <summary>Whether lighting uniforms are applied.</summary>
    public bool ReceiveLighting;

    /// <summary>Whether the item enters the transparent queue.</summary>
    public bool Transparent;

    /// <summary>Queue order bias.</summary>
    public int RenderOrder;

    /// <summary>Local-space bounds center.</summary>
    public Vec3 LocalCenter;

    /// <summary>World-space bounding radius.</summary>
    public float Radius;

    /// <summary>Default group: enabled, distance metric, empty level list.</summary>
    public static SceneLodGroup Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            Levels = default,
            LevelCount = 0,
            Metric = SceneLodMetric.Distance,
            Hysteresis = 0.1f,
            Enabled = true,
            PassId = SceneRenderPassIds.Main,
            ReceiveLighting = true,
            Transparent = false,
            RenderOrder = 0,
            LocalCenter = Vec3.Zero,
            Radius = 1.0f
        };
    }

    /// <summary>Writes one level entry.</summary>
    public void SetLevel(int index, in SceneLodLevel level)
    {
        if ((uint)index >= MaxLevels)
        {
            throw new SceneConfigurationException(
                $"LOD level index {index} is outside the supported range 0..{MaxLevels - 1}.");
        }

        Levels[index] = level;
        if (index >= LevelCount)
        {
            LevelCount = index + 1;
        }
    }

    /// <summary>Reads one level entry.</summary>
    public SceneLodLevel GetLevel(int index) => Levels[index];

    /// <summary>Whether the group has a usable level list.</summary>
    public bool IsValid
    {
        get
        {
            if (LevelCount <= 0 || LevelCount > MaxLevels)
            {
                return false;
            }

            for (int i = 0; i < LevelCount; i++)
            {
                SceneLodLevel level = Levels[i];
                if (!level.MeshId.IsValid || !level.MaterialId.IsValid)
                {
                    return false;
                }
            }

            return true;
        }
    }
}

/// <summary>Planning record for one LOD group.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneLodRenderItem
{
    /// <summary>Owning actor.</summary>
    public SceneActor Actor;

    /// <summary>Selected mesh.</summary>
    public SceneAssetId<MeshAssetTag> MeshId;

    /// <summary>Selected material.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Selected level index.</summary>
    public int Level;

    /// <summary>Queue order bias.</summary>
    public int RenderOrder;

    /// <summary>Whether the item enters the transparent queue.</summary>
    public bool Transparent;

    /// <summary>Whether lighting uniforms are applied.</summary>
    public bool ReceiveLighting;

    /// <summary>Squared camera distance.</summary>
    public float DistanceSquared;

    /// <summary>Stable collection order used as the final tie-breaker.</summary>
    public int Sequence;

    /// <summary>Whether world bounds were resolved.</summary>
    public bool HasBounds;

    /// <summary>World bounds sphere.</summary>
    public BoundingSphere3 WorldBounds;
}

/// <summary>
/// Deterministic LOD selector with per-actor hysteresis state. The first frame
/// evaluates without hysteresis; later frames only switch when the metric
/// crosses a threshold by the configured margin. State arrays are indexed by
/// actor slot with a generation check, so a recycled slot never inherits a
/// stale level.
/// </summary>
public sealed class SceneLodEvaluator
{
    private SceneActor[] _actors = [];
    private int[] _levels = [];

    /// <summary>Resets every tracked selection.</summary>
    public void Reset()
    {
        Array.Clear(_actors);
        Array.Clear(_levels);
    }

    /// <summary>Evaluates every group in the world and returns the selected level of one actor.</summary>
    public int Evaluate(SceneWorld world, SceneCameraFrame camera, SceneActor actor)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);

        EnsureCapacity(world.Capacity);

        if (!world.TryGetData(actor, out SceneLodGroup group) || !group.Enabled || !group.IsValid)
        {
            return -1;
        }

        Vec3 center = world.GetWorldPosition3D(actor) + TransformOffset(world, actor, group.LocalCenter);
        int slot = actor.Slot;
        int previous = _actors[slot] == actor ? _levels[slot] : -1;
        int selected = Select(in group, camera, in center, previous);
        _actors[slot] = actor;
        _levels[slot] = selected;
        return selected;
    }

    /// <summary>Evaluates the whole world; allocation-free after the first frame.</summary>
    public void Evaluate(SceneWorld world, SceneCameraFrame camera)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(camera);

        EnsureCapacity(world.Capacity);
        foreach (SceneActor actor in world.Actors)
        {
            _ = Evaluate(world, camera, actor);
        }
    }

    /// <summary>Gets the last selected level for an actor, or -1 when untracked.</summary>
    public int GetLevel(SceneActor actor)
    {
        int slot = actor.Slot;
        return (uint)slot < (uint)_actors.Length && _actors[slot] == actor ? _levels[slot] : -1;
    }

    /// <summary>Selects a level without mutating evaluator state.</summary>
    public static int Select(in SceneLodGroup group, SceneCameraFrame camera, in Vec3 worldCenter, int currentLevel)
    {
        ArgumentNullException.ThrowIfNull(camera);

        int last = group.LevelCount - 1;
        if (last < 0)
        {
            return -1;
        }

        float metric = group.Metric == SceneLodMetric.Distance
            ? (worldCenter - camera.Position).Length()
            : ComputeScreenRadius(in worldCenter, group.Radius, camera);

        int candidate = group.Metric == SceneLodMetric.Distance
            ? SelectByDistance(in group, metric)
            : SelectByScreenRadius(in group, metric);

        if (currentLevel < 0 || currentLevel > last || candidate == currentLevel)
        {
            return candidate;
        }

        float hysteresis = Math.Clamp(group.Hysteresis, 0.0f, 1.0f);
        bool movingDown = candidate > currentLevel;
        int boundaryLevel = movingDown ? currentLevel : candidate;
        float boundary = group.Levels[boundaryLevel].Threshold;

        if (group.Metric == SceneLodMetric.Distance)
        {
            float limit = movingDown ? boundary * (1.0f + hysteresis) : boundary * (1.0f - hysteresis);
            bool crossed = movingDown ? metric > limit : metric < limit;
            return crossed ? candidate : currentLevel;
        }

        float radiusLimit = movingDown ? boundary * (1.0f - hysteresis) : boundary * (1.0f + hysteresis);
        bool radiusCrossed = movingDown ? metric < radiusLimit : metric > radiusLimit;
        return radiusCrossed ? candidate : currentLevel;
    }

    private static int SelectByDistance(in SceneLodGroup group, float distance)
    {
        for (int i = 0; i < group.LevelCount; i++)
        {
            if (distance <= group.Levels[i].Threshold)
            {
                return i;
            }
        }

        return group.LevelCount - 1;
    }

    private static int SelectByScreenRadius(in SceneLodGroup group, float radius)
    {
        for (int i = 0; i < group.LevelCount; i++)
        {
            if (radius >= group.Levels[i].Threshold)
            {
                return i;
            }
        }

        return group.LevelCount - 1;
    }

    private static float ComputeScreenRadius(in Vec3 center, float worldRadius, SceneCameraFrame camera)
    {
        float halfHeight = camera.ViewportHeight * 0.5f;
        if (camera.Camera.Orthographic)
        {
            float orthographic = MathF.Max(camera.Camera.OrthographicSize, 1e-4f);
            return worldRadius * (halfHeight / orthographic);
        }

        float distance = MathF.Max((center - camera.Position).Length(), 1e-4f);
        float fov = camera.Camera.FieldOfViewDegrees * (MathF.PI / 180.0f);
        float tangent = MathF.Tan(fov * 0.5f);
        if (camera.Camera.FieldOfViewAxis == SceneCameraFovAxis.Horizontal)
        {
            tangent /= MathF.Max(camera.AspectRatio, 1e-4f);
        }

        return worldRadius * halfHeight / (distance * MathF.Max(tangent, 1e-4f));
    }

    private static Vec3 TransformOffset(SceneWorld world, SceneActor actor, in Vec3 localCenter)
    {
        if (localCenter == Vec3.Zero)
        {
            return Vec3.Zero;
        }

        Vec4 offset = world.GetWorldMatrix3D(actor) * new Vec4(localCenter.X, localCenter.Y, localCenter.Z, 0.0f);
        return new Vec3(offset.X, offset.Y, offset.Z);
    }

    private void EnsureCapacity(int capacity)
    {
        if (capacity <= _actors.Length)
        {
            return;
        }

        int size = Math.Max(capacity, Math.Max(16, _actors.Length * 2));
        Array.Resize(ref _actors, size);
        Array.Resize(ref _levels, size);
    }
}

/// <summary>
/// Collects LOD groups, culls them and sorts by the mesh queue order. Besides
/// the level-aware items it exposes <see cref="MeshItems"/>, a parallel span
/// consumable by the existing mesh draw executor.
/// </summary>
public sealed class SceneLodItemCollector
{
    private SceneLodRenderItem[] _items;
    private SceneRenderItem[] _meshItems;
    private int _count;
    private readonly LodItemComparer _comparer;

    /// <summary>Groups rejected by frustum culling during the last collect.</summary>
    public int CulledCount { get; private set; }

    /// <summary>Creates a collector with an initial capacity.</summary>
    public SceneLodItemCollector(int initialCapacity = 256)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"LOD-item capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneLodRenderItem[Math.Max(initialCapacity, 16)];
        _meshItems = new SceneRenderItem[Math.Max(initialCapacity, 16)];
        _comparer = new LodItemComparer();
    }

    /// <summary>Current number of planned items.</summary>
    public int Count => _count;

    /// <summary>Planned items with resolved level indices.</summary>
    public ReadOnlySpan<SceneLodRenderItem> Items => _items.AsSpan(0, _count);

    /// <summary>Mesh planning records in the same order, for the mesh executor.</summary>
    public ReadOnlySpan<SceneRenderItem> MeshItems => _meshItems.AsSpan(0, _count);

    /// <summary>Collects, culls and sorts LOD groups for one pass.</summary>
    public int Collect(
        SceneWorld world,
        SceneCameraFrame cameraFrame,
        SceneAssetId<RenderPassAssetTag> passId,
        SceneLodEvaluator evaluator,
        bool cull = true)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(cameraFrame);
        ArgumentNullException.ThrowIfNull(evaluator);

        _count = 0;
        CulledCount = 0;
        EnsureCapacity(Math.Max(world.ActorCount, 16));

        CameraFrustum frustum = cameraFrame.Frustum;
        Vec3 cameraPosition = cameraFrame.Position;

        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneLodGroup group) ||
                !group.Enabled ||
                !group.IsValid ||
                group.PassId != passId)
            {
                continue;
            }

            Vec3 position = world.GetWorldPosition3D(actor);
            BoundingSphere3 worldBounds = new(position + Offset(world, actor, group.LocalCenter), group.Radius);
            if (cull && !frustum.IntersectsSphere(in worldBounds))
            {
                CulledCount++;
                continue;
            }

            int level = evaluator.Evaluate(world, cameraFrame, actor);
            if (level < 0)
            {
                continue;
            }

            SceneLodLevel selected = group.GetLevel(level);
            float dx = position.X - cameraPosition.X;
            float dy = position.Y - cameraPosition.Y;
            float dz = position.Z - cameraPosition.Z;

            if (_count == _items.Length)
            {
                Grow();
            }

            ref SceneLodRenderItem item = ref _items[_count];
            item.Actor = actor;
            item.MeshId = selected.MeshId;
            item.MaterialId = selected.MaterialId;
            item.Level = level;
            item.RenderOrder = group.RenderOrder;
            item.Transparent = group.Transparent;
            item.ReceiveLighting = group.ReceiveLighting;
            item.DistanceSquared = (dx * dx) + (dy * dy) + (dz * dz);
            item.Sequence = _count;
            item.HasBounds = true;
            item.WorldBounds = worldBounds;
            _count++;
        }

        SceneIntroSort<SceneLodRenderItem, LodItemComparer>.Sort(
            _items.AsSpan(0, _count),
            _comparer);

        for (int i = 0; i < _count; i++)
        {
            ref readonly SceneLodRenderItem item = ref _items[i];
            ref SceneRenderItem mesh = ref _meshItems[i];
            mesh.Actor = item.Actor;
            mesh.MeshId = item.MeshId;
            mesh.MaterialId = item.MaterialId;
            mesh.RenderOrder = item.RenderOrder;
            mesh.DistanceSquared = item.DistanceSquared;
            mesh.Transparent = item.Transparent;
            mesh.ReceiveLighting = item.ReceiveLighting;
            mesh.HasBounds = item.HasBounds;
            mesh.WorldBounds = item.WorldBounds;
        }

        return _count;
    }

    /// <summary>Drops the current plan without releasing the buffers.</summary>
    public void Clear()
    {
        _count = 0;
        CulledCount = 0;
    }

    private static Vec3 Offset(SceneWorld world, SceneActor actor, in Vec3 localCenter)
    {
        if (localCenter == Vec3.Zero)
        {
            return Vec3.Zero;
        }

        Vec4 offset = world.GetWorldMatrix3D(actor) * new Vec4(localCenter.X, localCenter.Y, localCenter.Z, 0.0f);
        return new Vec3(offset.X, offset.Y, offset.Z);
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
            throw new SceneConfigurationException("LOD-item capacity overflow.");
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
                throw new SceneConfigurationException("LOD-item capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
        Array.Resize(ref _meshItems, capacity);
    }

    private readonly struct LodItemComparer : IComparer<SceneLodRenderItem>
    {
        public int Compare(SceneLodRenderItem left, SceneLodRenderItem right)
        {
            int order = left.RenderOrder.CompareTo(right.RenderOrder);
            if (order != 0)
            {
                return order;
            }

            int queue = left.Transparent.CompareTo(right.Transparent);
            if (queue != 0)
            {
                return queue;
            }

            if (left.Transparent)
            {
                int distance = right.DistanceSquared.CompareTo(left.DistanceSquared);
                if (distance != 0)
                {
                    return distance;
                }
            }

            int material = left.MaterialId.CompareTo(right.MaterialId);
            if (material != 0)
            {
                return material;
            }

            int mesh = left.MeshId.CompareTo(right.MeshId);
            return mesh != 0 ? mesh : left.Actor.CompareTo(right.Actor);
        }
    }
}
