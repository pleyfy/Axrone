namespace Axrone.Scene.Rendering;

/// <summary>
/// Skinned mesh renderer component. The mesh must carry position, joint-index
/// and joint-weight attributes; the composed bone palette is supplied by the
/// runtime through <see cref="ISceneBonePaletteSource"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSkinnedMeshRenderer : ISceneDataComponent
{
    /// <summary>Skinned mesh asset id.</summary>
    public SceneAssetId<MeshAssetTag> MeshId;

    /// <summary>Material asset id.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Render pass membership.</summary>
    public SceneAssetId<RenderPassAssetTag> PassId;

    /// <summary>Whether the renderer emits items.</summary>
    public bool Visible;

    /// <summary>Whether lighting uniforms would be applied by the material path.</summary>
    public bool ReceiveLighting;

    /// <summary>Whether the item enters the transparent queue.</summary>
    public bool Transparent;

    /// <summary>Queue order bias.</summary>
    public int RenderOrder;

    /// <summary>Optional local-space bounds override.</summary>
    public BoundingSphere3? Bounds;

    /// <summary>Default renderer: visible, main pass, opaque.</summary>
    public static SceneSkinnedMeshRenderer Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            MeshId = default,
            MaterialId = default,
            PassId = SceneRenderPassIds.Main,
            Visible = true,
            ReceiveLighting = true,
            Transparent = false,
            RenderOrder = 0,
            Bounds = null
        };
    }
}

/// <summary>Planning record for one skinned mesh renderer.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSkinnedMeshRenderItem
{
    /// <summary>Owning actor; the renderer fetches its world matrix and palette.</summary>
    public SceneActor Actor;

    /// <summary>Skinned mesh asset id.</summary>
    public SceneAssetId<MeshAssetTag> MeshId;

    /// <summary>Material asset id.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Queue order bias.</summary>
    public int RenderOrder;

    /// <summary>Whether the item enters the transparent queue.</summary>
    public bool Transparent;

    /// <summary>Whether lighting uniforms would be applied.</summary>
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
/// Collects skinned mesh renderers, resolves bounds, frustum-culls and sorts
/// them with the mesh queue ordering. The item buffer is reused, so a warmed
/// frame allocates nothing.
/// </summary>
public sealed class SceneSkinnedMeshItemCollector
{
    private SceneSkinnedMeshRenderItem[] _items;
    private int _count;
    private readonly SkinnedItemComparer _comparer;
    private bool _hasComponent;

    /// <summary>Items rejected by frustum culling during the last collect.</summary>
    public int CulledCount { get; private set; }

    /// <summary>Creates a collector with an initial capacity.</summary>
    public SceneSkinnedMeshItemCollector(int initialCapacity = 64)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Skinned-item capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneSkinnedMeshRenderItem[Math.Max(initialCapacity, 8)];
        _comparer = new SkinnedItemComparer();
    }

    /// <summary>Current number of planned items.</summary>
    public int Count => _count;

    /// <summary>Planned items in draw order.</summary>
    public ReadOnlySpan<SceneSkinnedMeshRenderItem> Items => _items.AsSpan(0, _count);

    /// <summary>
    /// Collects, culls and sorts skinned mesh items for one pass. Returns zero
    /// immediately when the world profile never registered the component.
    /// </summary>
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

        if (!_hasComponent)
        {
            _hasComponent = world.Registry.TryGetDataByType(typeof(SceneSkinnedMeshRenderer), out _);
            if (!_hasComponent)
            {
                return 0;
            }
        }

        EnsureCapacity(Math.Max(world.ActorCount, 8));

        CameraFrustum frustum = cameraFrame.Frustum;
        Vec3 cameraPosition = cameraFrame.Position;

        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneSkinnedMeshRenderer renderer) ||
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
                Mat4 worldMatrix = world.GetWorldMatrix3D(actor);
                worldBounds = SceneBounds.TransformSphere(in worldMatrix, in localBounds);
                hasWorldBounds = true;
            }

            if (cull && hasWorldBounds && !frustum.IntersectsSphere(in worldBounds))
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

            ref SceneSkinnedMeshRenderItem item = ref _items[_count];
            item.Actor = actor;
            item.MeshId = renderer.MeshId;
            item.MaterialId = renderer.MaterialId;
            item.RenderOrder = renderer.RenderOrder;
            item.Transparent = renderer.Transparent;
            item.ReceiveLighting = renderer.ReceiveLighting;
            item.DistanceSquared = (dx * dx) + (dy * dy) + (dz * dz);
            item.Sequence = _count;
            item.HasBounds = hasWorldBounds;
            item.WorldBounds = worldBounds;
            _count++;
        }

        SceneIntroSort<SceneSkinnedMeshRenderItem, SkinnedItemComparer>.Sort(
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

    private void EnsureCapacity(int required)
    {
        if (required <= _items.Length)
        {
            return;
        }

        int capacity = _items.Length;
        while (capacity < required)
        {
            if (capacity > int.MaxValue / 2)
            {
                throw new SceneConfigurationException("Skinned-item capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }

    private void Grow()
    {
        if (_items.Length > int.MaxValue / 2)
        {
            throw new SceneConfigurationException("Skinned-item capacity overflow.");
        }

        EnsureCapacity(_items.Length * 2);
    }

    private readonly struct SkinnedItemComparer : IComparer<SceneSkinnedMeshRenderItem>
    {
        public int Compare(SceneSkinnedMeshRenderItem left, SceneSkinnedMeshRenderItem right)
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
