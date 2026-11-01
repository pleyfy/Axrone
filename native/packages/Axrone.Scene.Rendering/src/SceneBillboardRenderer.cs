namespace Axrone.Scene.Rendering;

/// <summary>Camera-facing orientation used by a billboard.</summary>
public enum SceneBillboardMode : byte
{
    /// <summary>Faces the camera on all axes.</summary>
    Spherical = 0,

    /// <summary>Rotates around the world Y axis only.</summary>
    Cylindrical = 1
}

/// <summary>
/// Camera-facing quad data component. The component carries the atlas window,
/// tint and queue hints; <see cref="SceneBillboardItemCollector"/> resolves
/// culling and writes the compact planning record.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneBillboardRenderer : ISceneDataComponent
{
    /// <summary>Billboard texture asset id.</summary>
    public SceneAssetId<TextureAssetTag> TextureId;

    /// <summary>Optional material override.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Render pass membership.</summary>
    public SceneAssetId<RenderPassAssetTag> PassId;

    /// <summary>Whether the renderer emits items.</summary>
    public bool Enabled;

    /// <summary>Whether the billboard is visible.</summary>
    public bool Visible;

    /// <summary>Mirror horizontally.</summary>
    public bool FlipX;

    /// <summary>Mirror vertically.</summary>
    public bool FlipY;

    /// <summary>Facing mode.</summary>
    public SceneBillboardMode Mode;

    /// <summary>Sorting layer; lower layers draw first.</summary>
    public int SortingLayer;

    /// <summary>Order inside the sorting layer.</summary>
    public int RenderOrder;

    /// <summary>World-space quad size.</summary>
    public Vec2 Size;

    /// <summary>Anchor in normalized quad space.</summary>
    public Vec2 Anchor;

    /// <summary>Tint color.</summary>
    public Vec4 Color;

    /// <summary>Atlas window as (x, y, width, height) in normalized UV space.</summary>
    public Vec4 UvRect;

    /// <summary>Depth inside the layer and order.</summary>
    public float Depth;

    /// <summary>Default billboard: visible, main pass, unit size, centered anchor.</summary>
    public static SceneBillboardRenderer Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            TextureId = default,
            MaterialId = default,
            PassId = SceneRenderPassIds.Main,
            Enabled = true,
            Visible = true,
            FlipX = false,
            FlipY = false,
            Mode = SceneBillboardMode.Spherical,
            SortingLayer = 0,
            RenderOrder = 0,
            Size = Vec2.One,
            Anchor = new Vec2(0.5f, 0.5f),
            Color = Vec4.One,
            UvRect = new Vec4(0.0f, 0.0f, 1.0f, 1.0f),
            Depth = 0.0f
        };
    }

    /// <summary>Whether the renderer references a texture.</summary>
    public bool HasRenderableSource
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => TextureId.IsValid;
    }

    /// <summary>Computes the local bounds sphere used for culling.</summary>
    public BoundingSphere3 GetLocalBounds()
    {
        float radius = 0.5f * MathF.Sqrt((Size.X * Size.X) + (Size.Y * Size.Y));
        return new BoundingSphere3(Vec3.Zero, radius);
    }
}

/// <summary>Compact planning record for one billboard.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneBillboardRenderItem
{
    /// <summary>Owning actor; the batch renderer fetches its world position.</summary>
    public SceneActor Actor;

    /// <summary>Billboard texture asset id.</summary>
    public SceneAssetId<TextureAssetTag> TextureId;

    /// <summary>Material override id.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Sorting layer.</summary>
    public int SortingLayer;

    /// <summary>Order inside the layer.</summary>
    public int RenderOrder;

    /// <summary>Depth inside the layer and order.</summary>
    public float Depth;

    /// <summary>Stable collection order used as the final tie-breaker.</summary>
    public int Sequence;

    /// <summary>World-space quad size.</summary>
    public Vec2 Size;

    /// <summary>Normalized anchor.</summary>
    public Vec2 Anchor;

    /// <summary>Tint color.</summary>
    public Vec4 Color;

    /// <summary>Atlas window.</summary>
    public Vec4 UvRect;

    /// <summary>Facing mode.</summary>
    public SceneBillboardMode Mode;

    /// <summary>Horizontal mirror flag.</summary>
    public bool FlipX;

    /// <summary>Vertical mirror flag.</summary>
    public bool FlipY;
}

/// <summary>
/// Collects, frustum-culls and sorts billboard renderers for one pass. The item
/// buffer is reused, so a warmed frame allocates nothing.
/// </summary>
public sealed class SceneBillboardItemCollector
{
    private SceneBillboardRenderItem[] _items;
    private int _count;
    private readonly BillboardItemComparer _comparer;

    /// <summary>Billboards rejected by frustum culling during the last collect.</summary>
    public int CulledCount { get; private set; }

    /// <summary>Creates a collector with an initial capacity.</summary>
    public SceneBillboardItemCollector(int initialCapacity = 256)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Billboard-item capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneBillboardRenderItem[Math.Max(initialCapacity, 16)];
        _comparer = new BillboardItemComparer();
    }

    /// <summary>Current number of planned items.</summary>
    public int Count => _count;

    /// <summary>Planned items in draw order.</summary>
    public ReadOnlySpan<SceneBillboardRenderItem> Items => _items.AsSpan(0, _count);

    /// <summary>Collects, culls and sorts billboard items for one pass.</summary>
    public int Collect(
        SceneWorld world,
        SceneCameraFrame cameraFrame,
        SceneAssetId<RenderPassAssetTag> passId,
        bool cull = true)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(cameraFrame);

        _count = 0;
        CulledCount = 0;
        EnsureCapacity(Math.Max(world.ActorCount, 16));

        CameraFrustum frustum = cameraFrame.Frustum;

        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneBillboardRenderer billboard) ||
                !billboard.Enabled ||
                !billboard.Visible ||
                !billboard.HasRenderableSource ||
                billboard.PassId != passId)
            {
                continue;
            }

            if (cull)
            {
                Vec3 position = world.HasTransform3D
                    ? world.GetWorldPosition3D(actor)
                    : ToWorld2D(world.GetWorldPosition2D(actor));
                BoundingSphere3 bounds = new(position, billboard.GetLocalBounds().Radius);
                if (!frustum.IntersectsSphere(in bounds))
                {
                    CulledCount++;
                    continue;
                }
            }

            if (_count == _items.Length)
            {
                Grow();
            }

            ref SceneBillboardRenderItem item = ref _items[_count];
            item.Actor = actor;
            item.TextureId = billboard.TextureId;
            item.MaterialId = billboard.MaterialId;
            item.SortingLayer = billboard.SortingLayer;
            item.RenderOrder = billboard.RenderOrder;
            item.Depth = billboard.Depth;
            item.Sequence = _count;
            item.Size = billboard.Size;
            item.Anchor = billboard.Anchor;
            item.Color = billboard.Color;
            item.UvRect = billboard.UvRect;
            item.Mode = billboard.Mode;
            item.FlipX = billboard.FlipX;
            item.FlipY = billboard.FlipY;
            _count++;
        }

        SceneIntroSort<SceneBillboardRenderItem, BillboardItemComparer>.Sort(
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
        if (required > _items.Length)
        {
            GrowTo(required);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec3 ToWorld2D(in Vec2 position) => new(position.X, position.Y, 0.0f);

    private void Grow()
    {
        if (_items.Length > int.MaxValue / 2)
        {
            throw new SceneConfigurationException("Billboard-item capacity overflow.");
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
                throw new SceneConfigurationException("Billboard-item capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }

    private readonly struct BillboardItemComparer : IComparer<SceneBillboardRenderItem>
    {
        public int Compare(SceneBillboardRenderItem left, SceneBillboardRenderItem right)
        {
            int layer = left.SortingLayer.CompareTo(right.SortingLayer);
            if (layer != 0)
            {
                return layer;
            }

            int order = left.RenderOrder.CompareTo(right.RenderOrder);
            if (order != 0)
            {
                return order;
            }

            int depth = left.Depth.CompareTo(right.Depth);
            return depth != 0 ? depth : left.Sequence.CompareTo(right.Sequence);
        }
    }
}
