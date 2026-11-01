namespace Axrone.Scene.Rendering;

/// <summary>One instance transform and tint.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneInstanceTransform(Mat4 Matrix, Vec4 Color);

/// <summary>
/// Local instance transforms keyed by a caller-assigned group id. Each group is
/// a pinned array that only grows, so per-frame reads are allocation-free and
/// the OpenGL uploader can hand the span straight to the buffer.
/// </summary>
public sealed class SceneInstanceRegistry
{
    private readonly Dictionary<uint, InstanceSlot> _slots = new();

    /// <summary>Number of registered groups.</summary>
    public int Count => _slots.Count;

    /// <summary>Registers or replaces a group's instances.</summary>
    public void Register(uint groupId, ReadOnlySpan<SceneInstanceTransform> instances)
    {
        if (groupId == 0)
        {
            throw new SceneConfigurationException("Instance group id zero is reserved for the empty slot.");
        }

        if (!_slots.TryGetValue(groupId, out InstanceSlot? slot))
        {
            slot = new InstanceSlot();
            _slots.Add(groupId, slot);
        }

        slot.Set(instances);
    }

    /// <summary>Removes a group.</summary>
    public bool Remove(uint groupId) => _slots.Remove(groupId);

    /// <summary>Looks up a group's instances.</summary>
    public bool TryGet(uint groupId, out ReadOnlySpan<SceneInstanceTransform> instances)
    {
        if (groupId != 0 && _slots.TryGetValue(groupId, out InstanceSlot? slot))
        {
            instances = slot.Instances;
            return true;
        }

        instances = default;
        return false;
    }

    /// <summary>Removes every group without releasing slot buffers.</summary>
    public void Clear() => _slots.Clear();

    private sealed class InstanceSlot
    {
        private SceneInstanceTransform[] _instances = [];

        public ReadOnlySpan<SceneInstanceTransform> Instances => _instances.AsSpan(0, Count);

        public int Count { get; private set; }

        public void Set(ReadOnlySpan<SceneInstanceTransform> instances)
        {
            if (_instances.Length < instances.Length)
            {
                _instances = GC.AllocateArray<SceneInstanceTransform>(
                    Math.Max(instances.Length, 8),
                    pinned: true);
            }

            instances.CopyTo(_instances);
            Count = instances.Length;
        }
    }
}

/// <summary>
/// Instanced mesh renderer component. The owning actor supplies the group
/// transform; the registry supplies local instance transforms and colors shared
/// by every mesh in the group.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneInstancedMeshRenderer : ISceneDataComponent
{
    /// <summary>Mesh asset id.</summary>
    public SceneAssetId<MeshAssetTag> MeshId;

    /// <summary>Material asset id; the OpenGL batch validates it before drawing.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Render pass membership.</summary>
    public SceneAssetId<RenderPassAssetTag> PassId;

    /// <summary>Instance group in the <see cref="SceneInstanceRegistry"/>.</summary>
    public uint InstanceGroupId;

    /// <summary>Whether the renderer emits items.</summary>
    public bool Visible;

    /// <summary>Whether the batch enters the transparent queue.</summary>
    public bool Transparent;

    /// <summary>Queue order bias.</summary>
    public int RenderOrder;

    /// <summary>Optional local-space bounds covering all instances.</summary>
    public BoundingSphere3? Bounds;

    /// <summary>Default renderer: visible, main pass, no group.</summary>
    public static SceneInstancedMeshRenderer Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            MeshId = default,
            MaterialId = default,
            PassId = SceneRenderPassIds.Main,
            InstanceGroupId = 0,
            Visible = true,
            Transparent = false,
            RenderOrder = 0,
            Bounds = null
        };
    }
}

/// <summary>Planning record for one instanced mesh batch.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneInstancedMeshItem
{
    /// <summary>Owning actor whose world matrix transforms the group.</summary>
    public SceneActor Actor;

    /// <summary>Mesh asset id.</summary>
    public SceneAssetId<MeshAssetTag> MeshId;

    /// <summary>Material asset id.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Instance group id.</summary>
    public uint InstanceGroupId;

    /// <summary>Number of instances to draw.</summary>
    public int InstanceCount;

    /// <summary>Queue order bias.</summary>
    public int RenderOrder;

    /// <summary>Whether the batch enters the transparent queue.</summary>
    public bool Transparent;

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
/// Collects instanced mesh renderers, resolves group bounds from the registry or
/// the component override, culls and sorts them. The item buffer is reused, so a
/// warmed frame allocates nothing.
/// </summary>
public sealed class SceneInstancedMeshItemCollector
{
    private SceneInstancedMeshItem[] _items;
    private int _count;
    private readonly InstancedItemComparer _comparer;

    /// <summary>Batches rejected by frustum culling during the last collect.</summary>
    public int CulledCount { get; private set; }

    /// <summary>Creates a collector with an initial capacity.</summary>
    public SceneInstancedMeshItemCollector(int initialCapacity = 128)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Instanced-item capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneInstancedMeshItem[Math.Max(initialCapacity, 8)];
        _comparer = new InstancedItemComparer();
    }

    /// <summary>Current number of planned batches.</summary>
    public int Count => _count;

    /// <summary>Planned batches in draw order.</summary>
    public ReadOnlySpan<SceneInstancedMeshItem> Items => _items.AsSpan(0, _count);

    /// <summary>Collects, culls and sorts instanced mesh batches for one pass.</summary>
    public int Collect(
        SceneWorld world,
        SceneCameraFrame cameraFrame,
        SceneAssetId<RenderPassAssetTag> passId,
        SceneInstanceRegistry instances,
        bool cull = true)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(cameraFrame);
        ArgumentNullException.ThrowIfNull(instances);

        _count = 0;
        CulledCount = 0;
        EnsureCapacity(Math.Max(world.ActorCount, 8));

        CameraFrustum frustum = cameraFrame.Frustum;
        Vec3 cameraPosition = cameraFrame.Position;

        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneInstancedMeshRenderer renderer) ||
                !renderer.Visible ||
                !renderer.MeshId.IsValid ||
                !renderer.MaterialId.IsValid ||
                renderer.PassId != passId ||
                !instances.TryGet(renderer.InstanceGroupId, out ReadOnlySpan<SceneInstanceTransform> group) ||
                group.Length == 0)
            {
                continue;
            }

            Mat4 matrix = world.GetWorldMatrix3D(actor);
            BoundingSphere3 worldBounds = renderer.Bounds is { } localBounds
                ? SceneBounds.TransformSphere(in matrix, in localBounds)
                : ComputeWorldBounds(in matrix, group);

            if (cull && !frustum.IntersectsSphere(in worldBounds))
            {
                CulledCount++;
                continue;
            }

            Vec3 position = world.GetWorldPosition3D(actor);
            float dx = position.X - cameraPosition.X;
            float dy = position.Y - cameraPosition.Y;
            float dz = position.Z - cameraPosition.Z;

            if (_count == _items.Length)
            {
                Grow();
            }

            ref SceneInstancedMeshItem item = ref _items[_count];
            item.Actor = actor;
            item.MeshId = renderer.MeshId;
            item.MaterialId = renderer.MaterialId;
            item.InstanceGroupId = renderer.InstanceGroupId;
            item.InstanceCount = group.Length;
            item.RenderOrder = renderer.RenderOrder;
            item.Transparent = renderer.Transparent;
            item.DistanceSquared = (dx * dx) + (dy * dy) + (dz * dz);
            item.Sequence = _count;
            item.HasBounds = true;
            item.WorldBounds = worldBounds;
            _count++;
        }

        SceneIntroSort<SceneInstancedMeshItem, InstancedItemComparer>.Sort(
            _items.AsSpan(0, _count),
            _comparer);
        return _count;
    }

    /// <summary>Drops the current plan without releasing the buffer.</summary>
    public void Clear()
    {
        _count = 0;
        CulledCount = 0;
    }

    private static BoundingSphere3 ComputeWorldBounds(in Mat4 matrix, ReadOnlySpan<SceneInstanceTransform> group)
    {
        Vec3 min = new(float.MaxValue);
        Vec3 max = new(float.MinValue);

        for (int i = 0; i < group.Length; i++)
        {
            Vec3 translation = group[i].Matrix.Translation;
            Vec4 position = matrix * new Vec4(translation.X, translation.Y, translation.Z, 1.0f);
            min = Vec3.Min(min, new Vec3(position.X, position.Y, position.Z));
            max = Vec3.Max(max, new Vec3(position.X, position.Y, position.Z));
        }

        Vec3 center = (min + max) * 0.5f;
        float radius = (max - min).Length() * 0.5f;
        return new BoundingSphere3(center, radius);
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
            throw new SceneConfigurationException("Instanced-item capacity overflow.");
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
                throw new SceneConfigurationException("Instanced-item capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }

    private readonly struct InstancedItemComparer : IComparer<SceneInstancedMeshItem>
    {
        public int Compare(SceneInstancedMeshItem left, SceneInstancedMeshItem right)
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

/// <summary>
/// Optional frame-source extension for instanced meshes. Implementers of
/// <see cref="ISceneFrameItemSource"/> opt in by also implementing this
/// interface; sources that do not support instancing remain untouched.
/// </summary>
public interface ISceneInstancedFrameItemSource
{
    /// <summary>Collects instanced batches for one pass.</summary>
    ReadOnlySpan<SceneInstancedMeshItem> CollectInstancedMeshes(SceneAssetId<RenderPassAssetTag> passId);
}
