namespace Axrone.Scene.Rendering;

/// <summary>
/// Collects visible mesh renderers for one pass, resolves bounds, frustum-culls
/// and sorts the queue. The item array is reused and only grows on structural
/// changes, so a warmed frame allocates nothing.
/// </summary>
public sealed class SceneRenderItemCollector
{
    private SceneRenderItem[] _items;
    private int _count;
    private readonly RenderItemComparer _comparer;

    /// <summary>Items rejected by frustum culling during the last collect.</summary>
    public int CulledCount { get; private set; }

    /// <summary>Creates a collector with an initial item capacity.</summary>
    public SceneRenderItemCollector(int initialCapacity = 256)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Render-item capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneRenderItem[Math.Max(initialCapacity, 16)];
        _comparer = new RenderItemComparer();
    }

    /// <summary>Current number of planned items.</summary>
    public int Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _count;
    }

    /// <summary>Planned items in queue order.</summary>
    public ReadOnlySpan<SceneRenderItem> Items
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _items.AsSpan(0, _count);
    }

    /// <summary>Collects and sorts render items for one pass.</summary>
    /// <returns>Number of planned items.</returns>
    public int Collect(
        SceneWorld world,
        SceneCameraFrame cameraFrame,
        SceneAssetId<RenderPassAssetTag> passId,
        SceneAssetRegistry? assets = null,
        bool cull = true)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(cameraFrame);

        _count = 0;
        CulledCount = 0;
        EnsureCapacity(Math.Max(world.EntityCount, 16));

        CameraFrustum frustum = cameraFrame.Frustum;
        Vec3 cameraPosition = cameraFrame.Position;

        foreach (SceneEntity entity in world.Entities)
        {
            if (!world.IsActiveInHierarchy(entity) ||
                !world.TryGetData(entity, out SceneMeshRenderer renderer) ||
                !renderer.Visible ||
                !renderer.MeshId.IsValid ||
                !renderer.MaterialId.IsValid ||
                renderer.PassId != passId)
            {
                continue;
            }

            BoundingSphere3 worldBounds = default;
            bool hasWorldBounds = false;
            BoundingSphere3 localBounds = default;
            bool hasLocalBounds = false;

            if (renderer.Bounds is { } explicitBounds)
            {
                localBounds = explicitBounds;
                hasLocalBounds = true;
            }
            else if (assets is not null &&
                     assets.Meshes.TryGet(renderer.MeshId, out SceneMeshDefinition? mesh) &&
                     mesh.Bounds is { } meshBounds)
            {
                localBounds = meshBounds;
                hasLocalBounds = true;
            }

            if (hasLocalBounds)
            {
                Mat4 worldMatrix = world.GetWorldMatrix3D(entity);
                worldBounds = SceneBounds.TransformSphere(in worldMatrix, in localBounds);
                hasWorldBounds = true;
            }

            if (cull && hasWorldBounds && !frustum.IntersectsSphere(in worldBounds))
            {
                CulledCount++;
                continue;
            }

            Vec3 worldPosition = world.GetWorldPosition3D(entity);
            float dx = worldPosition.X - cameraPosition.X;
            float dy = worldPosition.Y - cameraPosition.Y;
            float dz = worldPosition.Z - cameraPosition.Z;

            if (_count == _items.Length)
            {
                Grow();
            }

            ref SceneRenderItem item = ref _items[_count];
            item.Entity = entity;
            item.MeshId = renderer.MeshId;
            item.MaterialId = renderer.MaterialId;
            item.RenderOrder = renderer.RenderOrder;
            item.DistanceSquared = (dx * dx) + (dy * dy) + (dz * dz);
            item.Transparent = renderer.Transparent;
            item.ReceiveLighting = renderer.ReceiveLighting;
            item.HasBounds = hasWorldBounds;
            item.WorldBounds = worldBounds;
            _count++;
        }

        SortPlannedItems();
        return _count;
    }

    /// <summary>Drops the current plan without releasing the buffer.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Clear()
    {
        _count = 0;
        CulledCount = 0;
    }

    private void EnsureCapacity(int required)
    {
        if (required <= _items.Length)
        {
            return;
        }

        GrowTo(required);
    }

    private void Grow()
    {
        if (_items.Length > int.MaxValue / 2)
        {
            throw new SceneConfigurationException("Render-item capacity overflow.");
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
                throw new SceneConfigurationException("Render-item capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }
    /// <summary>
    /// Allocation-free introsort over the planned queue. The BCL span sort
    /// boxes struct comparers, which would break the zero-allocation contract.
    /// </summary>
    private void SortPlannedItems() =>
        SceneIntroSort<SceneRenderItem, RenderItemComparer>.Sort(
            _items.AsSpan(0, _count),
            _comparer);

    private readonly struct RenderItemComparer : IComparer<SceneRenderItem>
    {
        public int Compare(SceneRenderItem left, SceneRenderItem right)
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
            return mesh != 0 ? mesh : left.Entity.CompareTo(right.Entity);
        }
    }
}
