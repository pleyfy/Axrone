namespace Axrone.Scene.Rendering;

/// <summary>Endpoint treatment for a rendered line.</summary>
public enum SceneLineCap : byte
{
    /// <summary>Flat end at the segment endpoint.</summary>
    Butt = 0,

    /// <summary>Extends the end by half the line width.</summary>
    Square = 1,

    /// <summary>Rounded end; approximated by a square extension.</summary>
    Round = 2
}

/// <summary>Corner treatment between polyline segments.</summary>
public enum SceneLineJoin : byte
{
    /// <summary>Sharp corner.</summary>
    Miter = 0,

    /// <summary>Cut corner.</summary>
    Bevel = 1,

    /// <summary>Rounded corner; approximated by a bevel.</summary>
    Round = 2
}

/// <summary>
/// Polyline renderer data component. Points live in a
/// <see cref="ScenePolylineRegistry"/>; the component references one polyline and
/// carries width, color and queue hints.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneLineRenderer : ISceneDataComponent
{
    /// <summary>Polyline identity in the polyline registry; zero is invalid.</summary>
    public uint PolylineId;

    /// <summary>Render pass membership.</summary>
    public SceneAssetId<RenderPassAssetTag> PassId;

    /// <summary>Whether the renderer emits items.</summary>
    public bool Enabled;

    /// <summary>Whether the line is visible.</summary>
    public bool Visible;

    /// <summary>Connects the last point back to the first.</summary>
    public bool Loop;

    /// <summary>Line width in world units.</summary>
    public float Width;

    /// <summary>Line color.</summary>
    public Vec4 Color;

    /// <summary>Sorting layer; lower layers draw first.</summary>
    public int SortingLayer;

    /// <summary>Order inside the sorting layer.</summary>
    public int RenderOrder;

    /// <summary>Depth inside the layer and order.</summary>
    public float Depth;

    /// <summary>Endpoint treatment.</summary>
    public SceneLineCap Cap;

    /// <summary>Corner treatment.</summary>
    public SceneLineJoin Join;

    /// <summary>Default line: visible, main pass, one-unit width, white.</summary>
    public static SceneLineRenderer Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            PolylineId = 0,
            PassId = SceneRenderPassIds.Main,
            Enabled = true,
            Visible = true,
            Loop = false,
            Width = 0.05f,
            Color = Vec4.One,
            SortingLayer = 0,
            RenderOrder = 0,
            Depth = 0.0f,
            Cap = SceneLineCap.Butt,
            Join = SceneLineJoin.Miter
        };
    }
}

/// <summary>One world-space polyline segment produced by the collector.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneLineRenderItem
{
    /// <summary>Owning actor.</summary>
    public SceneActor Actor;

    /// <summary>World-space segment start.</summary>
    public Vec3 Start;

    /// <summary>World-space segment end.</summary>
    public Vec3 End;

    /// <summary>Line width in world units.</summary>
    public float Width;

    /// <summary>Line color.</summary>
    public Vec4 Color;

    /// <summary>Sorting layer.</summary>
    public int SortingLayer;

    /// <summary>Order inside the layer.</summary>
    public int RenderOrder;

    /// <summary>Depth inside the layer and order.</summary>
    public float Depth;

    /// <summary>Stable collection order used as the final tie-breaker.</summary>
    public int Sequence;

    /// <summary>Endpoint treatment.</summary>
    public SceneLineCap Cap;

    /// <summary>Corner treatment.</summary>
    public SceneLineJoin Join;
}

/// <summary>
/// Collects polyline renderers, expands each polyline into world-space segments,
/// frustum-culls them and sorts by queue. Segment arrays and the registry views
/// are reused; a warmed frame allocates nothing.
/// </summary>
public sealed class SceneLineItemCollector
{
    private SceneLineRenderItem[] _items;
    private int _count;
    private readonly LineItemComparer _comparer;

    /// <summary>Segments rejected by frustum culling during the last collect.</summary>
    public int CulledCount { get; private set; }

    /// <summary>Creates a collector with an initial capacity.</summary>
    public SceneLineItemCollector(int initialCapacity = 256)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Line-item capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneLineRenderItem[Math.Max(initialCapacity, 16)];
        _comparer = new LineItemComparer();
    }

    /// <summary>Current number of planned segments.</summary>
    public int Count => _count;

    /// <summary>Planned segments in draw order.</summary>
    public ReadOnlySpan<SceneLineRenderItem> Items => _items.AsSpan(0, _count);

    /// <summary>Collects, culls and sorts polyline segments for one pass.</summary>
    public int Collect(
        SceneWorld world,
        SceneCameraFrame cameraFrame,
        SceneAssetId<RenderPassAssetTag> passId,
        ScenePolylineRegistry polylines,
        bool cull = true)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(cameraFrame);
        ArgumentNullException.ThrowIfNull(polylines);

        _count = 0;
        CulledCount = 0;
        EnsureCapacity(Math.Max(world.ActorCount, 16));

        CameraFrustum frustum = cameraFrame.Frustum;

        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneLineRenderer line) ||
                !line.Enabled ||
                !line.Visible ||
                line.Width <= 0.0f ||
                line.PassId != passId ||
                !polylines.TryGetPoints(line.PolylineId, out ReadOnlySpan<Vec3> points) ||
                points.Length < 2)
            {
                continue;
            }

            Mat4 matrix = world.HasTransform3D
                ? world.GetWorldMatrix3D(actor)
                : SceneBounds.FromAffine2D(world.GetWorldMatrix2D(actor));

            int segmentCount = line.Loop ? points.Length : points.Length - 1;
            for (int i = 0; i < segmentCount; i++)
            {
                Vec3 localStart = points[i];
                Vec3 localEnd = points[(i + 1) % points.Length];
                Vec3 start = TransformPoint(in matrix, in localStart);
                Vec3 end = TransformPoint(in matrix, in localEnd);

                if (cull && !IntersectsFrustum(in frustum, in start, in end, line.Width))
                {
                    CulledCount++;
                    continue;
                }

                if (_count == _items.Length)
                {
                    Grow();
                }

                ref SceneLineRenderItem item = ref _items[_count];
                item.Actor = actor;
                item.Start = start;
                item.End = end;
                item.Width = line.Width;
                item.Color = line.Color;
                item.SortingLayer = line.SortingLayer;
                item.RenderOrder = line.RenderOrder;
                item.Depth = line.Depth;
                item.Sequence = _count;
                item.Cap = line.Cap;
                item.Join = line.Join;
                _count++;
            }
        }

        SceneIntroSort<SceneLineRenderItem, LineItemComparer>.Sort(
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

    private static Vec3 TransformPoint(in Mat4 matrix, in Vec3 point)
    {
        Vec4 transformed = matrix * new Vec4(point.X, point.Y, point.Z, 1.0f);
        return new Vec3(transformed.X, transformed.Y, transformed.Z);
    }

    private static bool IntersectsFrustum(in CameraFrustum frustum, in Vec3 start, in Vec3 end, float width)
    {
        Vec3 middle = (start + end) * 0.5f;
        float halfLength = (end - start).Length() * 0.5f;
        BoundingSphere3 bounds = new(middle, halfLength + (width * 0.5f));
        return frustum.IntersectsSphere(in bounds);
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
            throw new SceneConfigurationException("Line-item capacity overflow.");
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
                throw new SceneConfigurationException("Line-item capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }

    private readonly struct LineItemComparer : IComparer<SceneLineRenderItem>
    {
        public int Compare(SceneLineRenderItem left, SceneLineRenderItem right)
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

/// <summary>
/// Reusable polyline point storage keyed by a caller-assigned id. Point buffers
/// live on the pinned object heap so collection can hand out spans without
/// copying; only registration of a new or larger polyline allocates.
/// </summary>
public sealed class ScenePolylineRegistry
{
    private readonly Dictionary<uint, PolylineSlot> _slots = new();

    /// <summary>Number of registered polylines.</summary>
    public int Count => _slots.Count;

    /// <summary>Registers or replaces a polyline's points.</summary>
    /// <param name="id">Non-zero polyline identity.</param>
    /// <param name="points">Polyline points in local space.</param>
    public void Register(uint id, ReadOnlySpan<Vec3> points)
    {
        if (id == 0)
        {
            throw new SceneConfigurationException("Polyline id zero is reserved for the empty slot.");
        }

        if (!_slots.TryGetValue(id, out PolylineSlot? slot))
        {
            slot = new PolylineSlot();
            _slots.Add(id, slot);
        }

        slot.Set(points);
    }

    /// <summary>Removes a polyline.</summary>
    public bool Remove(uint id) => _slots.Remove(id);

    /// <summary>Looks up the mutable point view of a polyline.</summary>
    public bool TryGetPoints(uint id, out ReadOnlySpan<Vec3> points)
    {
        if (id != 0 && _slots.TryGetValue(id, out PolylineSlot? slot))
        {
            points = slot.Points;
            return true;
        }

        points = default;
        return false;
    }

    /// <summary>Removes every polyline without releasing slot buffers.</summary>
    public void Clear() => _slots.Clear();

    private sealed class PolylineSlot
    {
        private Vec3[] _points = [];

        public ReadOnlySpan<Vec3> Points => _points.AsSpan(0, Count);

        public int Count { get; private set; }

        public void Set(ReadOnlySpan<Vec3> points)
        {
            if (_points.Length < points.Length)
            {
                _points = GC.AllocateArray<Vec3>(Math.Max(points.Length, 4), pinned: true);
            }

            points.CopyTo(_points);
            Count = points.Length;
        }
    }
}

/// <summary>
/// CPU geometry for line and trail ribbons. Expansion is deterministic and
/// allocation-free; degenerate segments produce no geometry.
/// </summary>
public static class SceneLineGeometry
{
    /// <summary>
    /// Builds the four corners of one camera-facing ribbon segment.
    /// </summary>
    /// <param name="start">Segment start.</param>
    /// <param name="end">Segment end.</param>
    /// <param name="width">World-space width.</param>
    /// <param name="viewDirection">Direction from the segment toward the camera.</param>
    /// <param name="cap">Endpoint treatment.</param>
    /// <param name="corners">Destination span for four corners.</param>
    /// <returns>Number of corners written; zero for degenerate input.</returns>
    public static int BuildRibbon(
        in Vec3 start,
        in Vec3 end,
        float width,
        in Vec3 viewDirection,
        SceneLineCap cap,
        Span<Vec3> corners)
    {
        if (corners.Length < 4 || width <= 0.0f || !float.IsFinite(width))
        {
            return 0;
        }

        Vec3 delta = end - start;
        float lengthSquared = delta.LengthSquared();
        if (lengthSquared < 1e-12f)
        {
            return 0;
        }

        float length = MathF.Sqrt(lengthSquared);
        Vec3 direction = delta / length;

        Vec3 side = Vec3.Cross(direction, viewDirection);
        if (side.LengthSquared() < 1e-8f)
        {
            side = Vec3.Cross(direction, Vec3.UnitY);
        }

        if (side.LengthSquared() < 1e-8f)
        {
            side = Vec3.Cross(direction, Vec3.UnitZ);
        }

        side = Vec3.Normalize(side) * (width * 0.5f);
        float extension = cap is SceneLineCap.Square or SceneLineCap.Round ? width * 0.5f : 0.0f;

        Vec3 extendedStart = start - (direction * extension);
        Vec3 extendedEnd = end + (direction * extension);

        corners[0] = extendedStart - side;
        corners[1] = extendedStart + side;
        corners[2] = extendedEnd + side;
        corners[3] = extendedEnd - side;
        return 4;
    }
}
