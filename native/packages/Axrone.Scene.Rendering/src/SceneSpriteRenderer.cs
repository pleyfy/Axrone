namespace Axrone.Scene.Rendering;

/// <summary>
/// Sprite renderer data component. The component carries the texture, atlas
/// window and queue hints; the sprite item collector resolves bounds and writes
/// the compact planning record consumed by the batch renderer.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSpriteRenderer : ISceneDataComponent
{
    /// <summary>Sprite texture asset id.</summary>
    public SceneAssetId<TextureAssetTag> TextureId;

    /// <summary>Optional material override.</summary>
    public SceneAssetId<MaterialAssetTag> MaterialId;

    /// <summary>Render pass membership.</summary>
    public SceneAssetId<RenderPassAssetTag> PassId;

    /// <summary>Whether the renderer emits items.</summary>
    public bool Enabled;

    /// <summary>Whether the sprite is visible.</summary>
    public bool Visible;

    /// <summary>Mirror horizontally.</summary>
    public bool FlipX;

    /// <summary>Mirror vertically.</summary>
    public bool FlipY;

    /// <summary>Sorting layer; lower layers draw first.</summary>
    public int SortingLayer;

    /// <summary>Order inside the sorting layer.</summary>
    public int RenderOrder;

    /// <summary>World-space size in units.</summary>
    public Vec2 Size;

    /// <summary>Texture source size used by UV and nine-slice math.</summary>
    public Vec2 SourceSize;

    /// <summary>
    /// Nine-slice border in source pixels as (left, right, top, bottom); zero
    /// disables slicing and keeps the sprite on the instanced fast path.
    /// </summary>
    public Vec4 SliceBorder;

    /// <summary>Anchor in normalized sprite space.</summary>
    public Vec2 Anchor;

    /// <summary>Tint color.</summary>
    public Vec4 Color;

    /// <summary>Atlas window as (x, y, width, height) in normalized UV space.</summary>
    public Vec4 UvRect;

    /// <summary>Depth used to order sprites inside the same layer and order.</summary>
    public float Depth;

    /// <summary>Default sprite: visible, main pass, unit size, centered anchor.</summary>
    public static SceneSpriteRenderer Default
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
            SortingLayer = 0,
            RenderOrder = 0,
            Size = Vec2.One,
            SourceSize = Vec2.One,
            SliceBorder = Vec4.Zero,
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

    /// <summary>Computes the sprite bounds in local space around the anchor.</summary>
    public BoundingSphere3 GetLocalBounds()
    {
        float centerX = (0.5f - Anchor.X) * Size.X;
        float centerY = (0.5f - Anchor.Y) * Size.Y;
        float radius = 0.5f * MathF.Sqrt((Size.X * Size.X) + (Size.Y * Size.Y));
        return new BoundingSphere3(new Vec3(centerX, centerY, 0.0f), radius);
    }
}

/// <summary>Compact planning record for one sprite renderer.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneSpriteRenderItem
{
    /// <summary>Owning actor; the batch renderer fetches its world matrix.</summary>
    public SceneActor Actor;

    /// <summary>Sprite texture asset id.</summary>
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

    /// <summary>World-space size.</summary>
    public Vec2 Size;

    /// <summary>Texture source size used by nine-slice math.</summary>
    public Vec2 SourceSize;

    /// <summary>Normalized anchor.</summary>
    public Vec2 Anchor;

    /// <summary>Tint color.</summary>
    public Vec4 Color;

    /// <summary>Atlas window.</summary>
    public Vec4 UvRect;

    /// <summary>Horizontal mirror flag.</summary>
    public bool FlipX;

    /// <summary>Vertical mirror flag.</summary>
    public bool FlipY;

    /// <summary>Effective mask shape.</summary>
    public SceneSpriteMaskKind MaskKind;

    /// <summary>Effective mask rect in normalized sprite space.</summary>
    public Vec4 MaskRect;

    /// <summary>Whether a mask applies to this sprite.</summary>
    public bool HasMask;

    /// <summary>Whether the mask inside test is inverted.</summary>
    public bool MaskInvert;

    /// <summary>Soft edge width in normalized mask units.</summary>
    public float MaskFeather;

    /// <summary>Rounded mask corner radius in normalized units.</summary>
    public float MaskCornerRadius;

    /// <summary>Whether the sprite carries a nine-slice border.</summary>
    public bool HasSlice;

    /// <summary>Nine-slice border in source pixels as (left, right, top, bottom).</summary>
    public Vec4 SliceBorder;
}

/// <summary>
/// Collects visible sprite renderers for one pass, frustum-culls them and sorts
/// by sorting layer, render order, depth and collection order. The item buffer
/// is reused, so a warmed frame allocates nothing.
/// </summary>
public sealed class SceneSpriteItemCollector
{
    private SceneSpriteRenderItem[] _items;
    private int _count;
    private readonly SpriteItemComparer _comparer;

    /// <summary>Sprites rejected by frustum culling during the last collect.</summary>
    public int CulledCount { get; private set; }

    /// <summary>Creates a collector with an initial item capacity.</summary>
    public SceneSpriteItemCollector(int initialCapacity = 256)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Sprite-item capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneSpriteRenderItem[Math.Max(initialCapacity, 16)];
        _comparer = new SpriteItemComparer();
    }

    /// <summary>Current number of planned items.</summary>
    public int Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _count;
    }

    /// <summary>Planned items in draw order.</summary>
    public ReadOnlySpan<SceneSpriteRenderItem> Items
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _items.AsSpan(0, _count);
    }

    /// <summary>Collects, culls and sorts sprite items for one pass.</summary>
    /// <returns>Number of planned items.</returns>
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
            if ((!world.HasTransform2D && !world.HasTransform3D) ||
                !world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneSpriteRenderer sprite) ||
                !sprite.Enabled ||
                !sprite.Visible ||
                !sprite.HasRenderableSource ||
                sprite.PassId != passId)
            {
                continue;
            }

            if (cull)
            {
                Mat4 worldMatrix = world.HasTransform2D
                    ? SceneBounds.FromAffine2D(world.GetWorldMatrix2D(actor))
                    : world.GetWorldMatrix3D(actor);
                BoundingSphere3 localBounds = sprite.GetLocalBounds();
                BoundingSphere3 worldBounds = SceneBounds.TransformSphere(in worldMatrix, in localBounds);
                if (!frustum.IntersectsSphere(in worldBounds))
                {
                    CulledCount++;
                    continue;
                }
            }

            if (_count == _items.Length)
            {
                Grow();
            }

            bool hasMask = SceneSpriteMaskResolver.TryResolve(world, actor, out SceneSpriteMask mask);

            ref SceneSpriteRenderItem item = ref _items[_count];
            item.Actor = actor;
            item.TextureId = sprite.TextureId;
            item.MaterialId = sprite.MaterialId;
            item.SortingLayer = sprite.SortingLayer;
            item.RenderOrder = sprite.RenderOrder;
            item.Depth = sprite.Depth;
            item.Sequence = _count;
            item.Size = sprite.Size;
            item.SourceSize = sprite.SourceSize;
            item.Anchor = sprite.Anchor;
            item.Color = sprite.Color;
            item.UvRect = sprite.UvRect;
            item.FlipX = sprite.FlipX;
            item.FlipY = sprite.FlipY;
            item.MaskKind = hasMask ? mask.Kind : SceneSpriteMaskKind.Rect;
            item.MaskRect = hasMask ? mask.Rect : default;
            item.HasMask = hasMask;
            item.MaskInvert = hasMask && mask.Invert;
            item.MaskFeather = hasMask ? mask.Feather : 0.0f;
            item.MaskCornerRadius = hasMask ? mask.CornerRadius : 0.0f;
            Vec4 sliceBorder = sprite.SliceBorder;
            item.HasSlice = sliceBorder.X > 0.0f || sliceBorder.Y > 0.0f ||
                sliceBorder.Z > 0.0f || sliceBorder.W > 0.0f;
            item.SliceBorder = item.HasSlice ? sliceBorder : Vec4.Zero;
            _count++;
        }

        SceneIntroSort<SceneSpriteRenderItem, SpriteItemComparer>.Sort(
            _items.AsSpan(0, _count),
            _comparer);
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
            throw new SceneConfigurationException("Sprite-item capacity overflow.");
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
                throw new SceneConfigurationException("Sprite-item capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }

    private readonly struct SpriteItemComparer : IComparer<SceneSpriteRenderItem>
    {
        public int Compare(SceneSpriteRenderItem left, SceneSpriteRenderItem right)
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
