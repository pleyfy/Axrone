namespace Axrone.Scene.Rendering;

/// <summary>How a trail fades with age.</summary>
public enum SceneTrailFade : byte
{
    /// <summary>Alpha falls linearly to zero at the lifetime limit.</summary>
    Linear = 0,

    /// <summary>Alpha stays constant until the point expires.</summary>
    Constant = 1
}

/// <summary>
/// Trail renderer data component. Points are pushed into a
/// <see cref="SceneTrailRegistry"/> ring; the collector turns the surviving
/// history into fading world-space segments.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneTrailRenderer : ISceneDataComponent
{
    /// <summary>Trail identity in the trail registry; zero is invalid.</summary>
    public uint TrailId;

    /// <summary>Render pass membership.</summary>
    public SceneAssetId<RenderPassAssetTag> PassId;

    /// <summary>Whether the renderer emits items.</summary>
    public bool Enabled;

    /// <summary>Whether the trail is visible.</summary>
    public bool Visible;

    /// <summary>Ribbon width in world units.</summary>
    public float Width;

    /// <summary>Point lifetime in seconds.</summary>
    public float LifetimeSeconds;

    /// <summary>Base color; alpha is multiplied by the age fade.</summary>
    public Vec4 Color;

    /// <summary>Age fade mode.</summary>
    public SceneTrailFade Fade;

    /// <summary>Sorting layer; lower layers draw first.</summary>
    public int SortingLayer;

    /// <summary>Order inside the sorting layer.</summary>
    public int RenderOrder;

    /// <summary>Depth inside the layer and order.</summary>
    public float Depth;

    /// <summary>Default trail: visible, main pass, one-second linear fade.</summary>
    public static SceneTrailRenderer Default
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => new()
        {
            TrailId = 0,
            PassId = SceneRenderPassIds.Main,
            Enabled = true,
            Visible = true,
            Width = 0.05f,
            LifetimeSeconds = 1.0f,
            Color = Vec4.One,
            Fade = SceneTrailFade.Linear,
            SortingLayer = 0,
            RenderOrder = 0,
            Depth = 0.0f
        };
    }
}

/// <summary>One world-space trail segment with per-endpoint fade.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct SceneTrailRenderItem
{
    /// <summary>Owning actor.</summary>
    public SceneActor Actor;

    /// <summary>World-space segment start.</summary>
    public Vec3 Start;

    /// <summary>World-space segment end.</summary>
    public Vec3 End;

    /// <summary>Ribbon width in world units.</summary>
    public float Width;

    /// <summary>Base color.</summary>
    public Vec4 Color;

    /// <summary>Alpha multiplier at the start point.</summary>
    public float StartAlpha;

    /// <summary>Alpha multiplier at the end point.</summary>
    public float EndAlpha;

    /// <summary>Sorting layer.</summary>
    public int SortingLayer;

    /// <summary>Order inside the layer.</summary>
    public int RenderOrder;

    /// <summary>Depth inside the layer and order.</summary>
    public float Depth;

    /// <summary>Stable collection order used as the final tie-breaker.</summary>
    public int Sequence;
}

/// <summary>
/// Collects trail histories, trims expired points, emits fading segments and
/// sorts them by queue. The point scratch buffer is reused, so a warmed frame
/// allocates nothing.
/// </summary>
public sealed class SceneTrailItemCollector
{
    private SceneTrailRenderItem[] _items;
    private SceneTrailPoint[] _scratch;
    private int _count;
    private readonly TrailItemComparer _comparer;

    /// <summary>Segments rejected by frustum culling during the last collect.</summary>
    public int CulledCount { get; private set; }

    /// <summary>Creates a collector with an initial capacity.</summary>
    public SceneTrailItemCollector(int initialCapacity = 256)
    {
        if (initialCapacity <= 0)
        {
            throw new SceneConfigurationException(
                $"Trail-item capacity must be positive; received {initialCapacity}.");
        }

        _items = new SceneTrailRenderItem[Math.Max(initialCapacity, 16)];
        _scratch = new SceneTrailPoint[Math.Max(initialCapacity, 16)];
        _comparer = new TrailItemComparer();
    }

    /// <summary>Current number of planned segments.</summary>
    public int Count => _count;

    /// <summary>Planned segments in draw order.</summary>
    public ReadOnlySpan<SceneTrailRenderItem> Items => _items.AsSpan(0, _count);

    /// <summary>Collects, trims and sorts trail segments for one pass.</summary>
    /// <param name="world">Scene world.</param>
    /// <param name="cameraFrame">Camera frame.</param>
    /// <param name="passId">Pass being collected.</param>
    /// <param name="trails">Trail point storage.</param>
    /// <param name="time">Current time in seconds.</param>
    /// <param name="cull">Whether frustum culling is applied.</param>
    public int Collect(
        SceneWorld world,
        SceneCameraFrame cameraFrame,
        SceneAssetId<RenderPassAssetTag> passId,
        SceneTrailRegistry trails,
        float time,
        bool cull = true)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(cameraFrame);
        ArgumentNullException.ThrowIfNull(trails);

        _count = 0;
        CulledCount = 0;
        EnsureCapacity(Math.Max(world.ActorCount, 16));

        CameraFrustum frustum = cameraFrame.Frustum;

        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor) ||
                !world.TryGetData(actor, out SceneTrailRenderer trail) ||
                !trail.Enabled ||
                !trail.Visible ||
                trail.Width <= 0.0f ||
                trail.LifetimeSeconds <= 0.0f ||
                trail.PassId != passId ||
                trail.TrailId == 0 ||
                !trails.TryGetPointCount(trail.TrailId, out int available) ||
                available < 2)
            {
                continue;
            }

            EnsureScratch(available);
            if (!trails.TryCopyPoints(trail.TrailId, _scratch, out int pointCount))
            {
                continue;
            }

            int first = 0;
            float cutoff = time - trail.LifetimeSeconds;
            while (first < pointCount && _scratch[first].Time < cutoff)
            {
                first++;
            }

            int surviving = pointCount - first;
            if (surviving < 2)
            {
                continue;
            }

            for (int i = first; i < pointCount - 1; i++)
            {
                ref readonly SceneTrailPoint startPoint = ref _scratch[i];
                ref readonly SceneTrailPoint endPoint = ref _scratch[i + 1];

                if (cull)
                {
                    Vec3 middle = (startPoint.Position + endPoint.Position) * 0.5f;
                    float halfLength = (endPoint.Position - startPoint.Position).Length() * 0.5f;
                    BoundingSphere3 bounds = new(middle, halfLength + (trail.Width * 0.5f));
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

                ref SceneTrailRenderItem item = ref _items[_count];
                item.Actor = actor;
                item.Start = startPoint.Position;
                item.End = endPoint.Position;
                item.Width = trail.Width;
                item.Color = trail.Color;
                item.StartAlpha = FadeAlpha(trail, time - startPoint.Time);
                item.EndAlpha = FadeAlpha(trail, time - endPoint.Time);
                item.SortingLayer = trail.SortingLayer;
                item.RenderOrder = trail.RenderOrder;
                item.Depth = trail.Depth;
                item.Sequence = _count;
                _count++;
            }
        }

        SceneIntroSort<SceneTrailRenderItem, TrailItemComparer>.Sort(
            _items.AsSpan(0, _count),
            _comparer);
        return _count;
    }

    /// <summary>Drops the current plan without releasing the buffers.</summary>
    public void Clear()
    {
        _count = 0;
        CulledCount = 0;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float FadeAlpha(in SceneTrailRenderer trail, float age)
    {
        if (trail.Fade == SceneTrailFade.Constant)
        {
            return 1.0f;
        }

        return Math.Clamp(1.0f - (age / trail.LifetimeSeconds), 0.0f, 1.0f);
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
            throw new SceneConfigurationException("Trail-item capacity overflow.");
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
                throw new SceneConfigurationException("Trail-item capacity overflow.");
            }

            capacity *= 2;
        }

        Array.Resize(ref _items, capacity);
    }

    private void EnsureScratch(int required)
    {
        if (required > _scratch.Length)
        {
            Array.Resize(ref _scratch, Math.Max(required, _scratch.Length * 2));
        }
    }

    private readonly struct TrailItemComparer : IComparer<SceneTrailRenderItem>
    {
        public int Compare(SceneTrailRenderItem left, SceneTrailRenderItem right)
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

/// <summary>One recorded trail position.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneTrailPoint(Vec3 Position, float Time);

/// <summary>
/// Trail point storage keyed by a caller-assigned id. Each slot is a pinned
/// ring buffer; pushing past capacity overwrites the oldest point, which keeps
/// steady-state memory flat. Non-monotonic timestamps are rejected so the ring
/// stays chronological.
/// </summary>
public sealed class SceneTrailRegistry
{
    private const int DefaultCapacity = 64;

    private readonly Dictionary<uint, TrailSlot> _slots = new();

    /// <summary>Number of registered trails.</summary>
    public int Count => _slots.Count;

    /// <summary>Registers a trail with a ring capacity.</summary>
    public void Register(uint id, int capacity = DefaultCapacity)
    {
        if (id == 0)
        {
            throw new SceneConfigurationException("Trail id zero is reserved for the empty slot.");
        }

        if (capacity < 2)
        {
            throw new SceneConfigurationException(
                $"Trail ring capacity must be at least two; received {capacity}.");
        }

        if (!_slots.TryGetValue(id, out TrailSlot? slot))
        {
            slot = new TrailSlot(capacity);
            _slots.Add(id, slot);
            return;
        }

        slot.EnsureCapacity(capacity);
    }

    /// <summary>Removes a trail.</summary>
    public bool Remove(uint id) => _slots.Remove(id);

    /// <summary>Clears every trail's history without releasing ring buffers.</summary>
    public void Clear()
    {
        foreach (TrailSlot slot in _slots.Values)
        {
            slot.Clear();
        }
    }

    /// <summary>Pushes a position at a monotonically increasing time.</summary>
    /// <returns><see langword="false"/> when the trail is unknown or the time regressed.</returns>
    public bool Push(uint id, in Vec3 position, float time)
    {
        return id != 0 &&
               _slots.TryGetValue(id, out TrailSlot? slot) &&
               slot.Push(in position, time);
    }

    /// <summary>Copies a trail's points in chronological order.</summary>
    /// <param name="id">Trail identity.</param>
    /// <param name="destination">Destination span.</param>
    /// <param name="count">Copied point count.</param>
    /// <returns><see langword="false"/> when the destination is too small or the trail is unknown.</returns>
    public bool TryCopyPoints(uint id, Span<SceneTrailPoint> destination, out int count)
    {
        count = 0;
        if (id == 0 || !_slots.TryGetValue(id, out TrailSlot? slot))
        {
            return false;
        }

        count = slot.Count;
        if (destination.Length < count)
        {
            return false;
        }

        slot.CopyTo(destination);
        return true;
    }

    /// <summary>Gets the number of recorded points, including expired history.</summary>
    public bool TryGetPointCount(uint id, out int count)
    {
        if (id != 0 && _slots.TryGetValue(id, out TrailSlot? slot))
        {
            count = slot.Count;
            return true;
        }

        count = 0;
        return false;
    }

    private sealed class TrailSlot
    {
        private SceneTrailPoint[] _points;
        private int _head;
        private int _count;

        public TrailSlot(int capacity)
        {
            _points = GC.AllocateArray<SceneTrailPoint>(capacity, pinned: true);
        }

        public int Count => _count;

        public void EnsureCapacity(int capacity)
        {
            if (capacity <= _points.Length)
            {
                return;
            }

            SceneTrailPoint[] next = GC.AllocateArray<SceneTrailPoint>(capacity, pinned: true);
            CopyTo(next);
            _points = next;
            _head = 0;
        }

        public bool Push(in Vec3 position, float time)
        {
            if (_count > 0)
            {
                int newestIndex = (_head + _count - 1) % _points.Length;
                if (time < _points[newestIndex].Time)
                {
                    return false;
                }
            }

            if (_count < _points.Length)
            {
                int index = (_head + _count) % _points.Length;
                _points[index] = new SceneTrailPoint(position, time);
                _count++;
                return true;
            }

            _points[_head] = new SceneTrailPoint(position, time);
            _head = (_head + 1) % _points.Length;
            return true;
        }

        public void CopyTo(Span<SceneTrailPoint> destination)
        {
            int firstLength = Math.Min(_count, _points.Length - _head);
            _points.AsSpan(_head, firstLength).CopyTo(destination);
            if (firstLength < _count)
            {
                _points.AsSpan(0, _count - firstLength).CopyTo(destination[firstLength..]);
            }
        }

        public void Clear()
        {
            _head = 0;
            _count = 0;
        }
    }
}
