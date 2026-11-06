namespace Axrone.Physics2D;

/// <summary>Stored collider kind; selects the active geometry of a shape record.</summary>
public enum ColliderKind : byte
{
    /// <summary>Disc collider.</summary>
    Circle = 0,

    /// <summary>Stadium collider.</summary>
    Capsule = 1,

    /// <summary>Convex polygon collider.</summary>
    Polygon = 2,

    /// <summary>Thin static segment collider.</summary>
    Edge = 3,
}

/// <summary>
/// One attached collider: the owning body, the local frame it sits in, the
/// local geometry (exactly one variant is live, selected by
/// <see cref="Kind"/>), density/filter/material, the cached world geometry
/// plus world bounds (refreshed by <see cref="ShapeStore.SyncShape"/>, never
/// allocated after attach), and the broadphase item. Mutable storage owned
/// by <see cref="ShapeStore"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct ShapeRecord
{
    /// <summary>Whether the slot holds a live shape.</summary>
    public bool Live;

    /// <summary>Active geometry variant.</summary>
    public ColliderKind Kind;

    /// <summary>Owning body.</summary>
    public BodyId Body;

    /// <summary>Shape frame inside the body frame.</summary>
    public Transform2D LocalFrame;

    /// <summary>Mass per unit area; always positive.</summary>
    public float Density;

    /// <summary>Collision filtering.</summary>
    public CollisionFilter Filter;

    /// <summary>Contact response.</summary>
    public PhysicsMaterial Material;

    /// <summary>Trigger-only collider: overlaps report but never push.</summary>
    public bool IsSensor;

    /// <summary>Local disc; live when <see cref="Kind"/> is <see cref="ColliderKind.Circle"/>.</summary>
    public Circle2 LocalCircle;

    /// <summary>Local stadium; live when <see cref="Kind"/> is <see cref="ColliderKind.Capsule"/>.</summary>
    public Capsule2D LocalCapsule;

    /// <summary>Local polygon; live when <see cref="Kind"/> is <see cref="ColliderKind.Polygon"/>.</summary>
    public Polygon2D LocalPolygon;

    /// <summary>Local segment; live when <see cref="Kind"/> is <see cref="ColliderKind.Edge"/>.</summary>
    public Edge2D LocalEdge;

    /// <summary>World disc; refreshed on sync.</summary>
    public Circle2 WorldCircle;

    /// <summary>World stadium; refreshed on sync.</summary>
    public Capsule2D WorldCapsule;

    /// <summary>World segment; refreshed on sync.</summary>
    public Edge2D WorldEdge;

    /// <summary>World polygon vertices; allocated once at attach.</summary>
    public Vec2[]? WorldVertices;

    /// <summary>World polygon normals; allocated once at attach.</summary>
    public Vec2[]? WorldNormals;

    /// <summary>World polygon view over the cached buffers; refreshed on sync.</summary>
    public Polygon2D WorldPolygon;

    /// <summary>World centroid; refreshed on sync.</summary>
    public Vec2 WorldCentroid;

    /// <summary>World bounds; refreshed on sync.</summary>
    public Aabb2D WorldAabb;

    /// <summary>Broadphase item; invalid until inserted.</summary>
    public SpatialItemId TreeItem;

    /// <summary>Next shape of the owning body; -1 at the tail.</summary>
    public int NextShape;
}

/// <summary>
/// Dense slot store of attached colliders: local-frame geometry per body,
/// cached world geometry plus bounds (no allocation after attach), automatic
/// mass accumulation into the owning body with center-of-mass tracking, and
/// broadphase insert/update/remove wired to the 2D tree. Identities are slot
/// plus one; freed slots recycle.
/// </summary>
public sealed class ShapeStore
{
    private const int InitialCapacity = 16;

    private ShapeRecord[] _shapes;
    private int[] _freeStack;
    private int _freeCount;
    private int _highWater;
    private int _count;
    private int _capacity;

    /// <summary>Creates a store with room for sixteen shapes.</summary>
    public ShapeStore()
    {
        _capacity = InitialCapacity;
        _shapes = new ShapeRecord[_capacity];
        _freeStack = new int[_capacity];
        _freeCount = 0;
        _highWater = 0;
        _count = 0;
    }

    /// <summary>Live shapes.</summary>
    public int Count
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _count;
    }

    /// <summary>Attaches a disc to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachCircle<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec2 center,
        float radius,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec2 localOffset = default,
        float localAngle = 0.0f,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Circle2(center, radius);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Circle, density, filter, material, localOffset, localAngle, isSensor);
        _shapes[slot].LocalCircle = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a stadium to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachCapsule<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec2 p0,
        Vec2 p1,
        float radius,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec2 localOffset = default,
        float localAngle = 0.0f,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Capsule2D(p0, p1, radius);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Capsule, density, filter, material, localOffset, localAngle, isSensor);
        _shapes[slot].LocalCapsule = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a convex polygon to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachPolygon<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        ReadOnlySpan<Vec2> vertices,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec2 localOffset = default,
        float localAngle = 0.0f,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        Polygon2D local = Polygon2D.Create(vertices);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Polygon, density, filter, material, localOffset, localAngle, isSensor);
        _shapes[slot].LocalPolygon = local;
        _shapes[slot].WorldVertices = new Vec2[local.Count];
        _shapes[slot].WorldNormals = new Vec2[local.Count];
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a thin static segment to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachEdge<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec2 p0,
        Vec2 p1,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec2 localOffset = default,
        float localAngle = 0.0f,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Edge2D(p0, p1);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Edge, density, filter, material, localOffset, localAngle, isSensor);
        _shapes[slot].LocalEdge = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>
    /// Attaches a polyline of static segments to <paramref name="bodyId"/>: each
    /// consecutive pair becomes one edge, plus a closing edge when
    /// <paramref name="loop"/> is set. Returns the edge count.
    /// </summary>
    public int AttachChain<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        ReadOnlySpan<Vec2> vertices,
        bool loop,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec2 localOffset = default,
        float localAngle = 0.0f,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        if (vertices.Length < 2)
        {
            ThrowHelper.ThrowTooFewVertices();
        }

        int count = loop ? vertices.Length : vertices.Length - 1;
        for (int i = 0; i < count; i++)
        {
            AttachEdge(bodies, tree, bodyId, vertices[i], vertices[(i + 1) % vertices.Length],
                density, filter, material, localOffset, localAngle, isSensor);
        }

        return count;
    }

    /// <summary>Drops a shape, unlinks it from its body, pulls it from the tree and re-sums the body mass.</summary>
    public void Detach<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        ShapeId id)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        int slot = Validate(id);
        ref ShapeRecord shape = ref _shapes[slot];
        BodyId bodyId = shape.Body;

        tree.Remove(shape.TreeItem);

        ref BodyState body = ref bodies.Slot(bodyId);
        int previous = -1;
        int current = body.FirstShape;
        while (current != -1)
        {
            if (current == slot)
            {
                if (previous == -1)
                {
                    body.FirstShape = shape.NextShape;
                }
                else
                {
                    _shapes[previous].NextShape = shape.NextShape;
                }

                body.ShapeCount--;
                break;
            }

            previous = current;
            current = _shapes[current].NextShape;
        }

        shape = default;
        _freeStack[_freeCount++] = slot;
        _count--;

        RecalculateMass(bodies, bodyId);
    }

    /// <summary>Refreshes the world geometry, bounds and tree placement of one shape.</summary>
    public void SyncShape<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        ShapeId id)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        int slot = Validate(id);
        RefreshWorld(bodies, slot);
        ref ShapeRecord shape = ref _shapes[slot];
        tree.Update(shape.TreeItem, in shape.WorldAabb);
    }

    /// <summary>Refreshes every shape of a body; call after the body moved.</summary>
    public void SyncBody<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        ref BodyState body = ref bodies.Slot(bodyId);
        int current = body.FirstShape;
        while (current != -1)
        {
            RefreshWorld(bodies, current);
            ref ShapeRecord shape = ref _shapes[current];
            tree.Update(shape.TreeItem, in shape.WorldAabb);
            current = shape.NextShape;
        }
    }

    /// <summary>Whether <paramref name="id"/> names a live shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsValid(ShapeId id)
    {
        int slot = id.ToIndex();
        return id.IsValid && slot >= 0 && slot < _capacity && _shapes[slot].Live;
    }

    /// <summary>Reads the owning body of a shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public BodyId GetBody(ShapeId id) => _shapes[Validate(id)].Body;

    /// <summary>Reads the kind of a shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ColliderKind GetKind(ShapeId id) => _shapes[Validate(id)].Kind;

    /// <summary>Reads the world disc of a circle shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Circle2 GetWorldCircle(ShapeId id)
    {
        int slot = Validate(id);
        if (_shapes[slot].Kind != ColliderKind.Circle)
        {
            ThrowHelper.ThrowInvalidOperation("Shape is not a circle.");
        }

        return _shapes[slot].WorldCircle;
    }

    /// <summary>Reads the world stadium of a capsule shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Capsule2D GetWorldCapsule(ShapeId id)
    {
        int slot = Validate(id);
        if (_shapes[slot].Kind != ColliderKind.Capsule)
        {
            ThrowHelper.ThrowInvalidOperation("Shape is not a capsule.");
        }

        return _shapes[slot].WorldCapsule;
    }

    /// <summary>Copies the world vertices of a polygon shape into <paramref name="destination"/>.</summary>
    public void GetWorldVertices(ShapeId id, Span<Vec2> destination)
    {
        int slot = Validate(id);
        ref ShapeRecord shape = ref _shapes[slot];
        if (shape.Kind != ColliderKind.Polygon)
        {
            ThrowHelper.ThrowInvalidOperation("Shape is not a polygon.");
        }

        if (destination.Length < shape.LocalPolygon.Count)
        {
            ThrowHelper.ThrowInvalidOperation("Destination span is shorter than the polygon vertex count.");
        }

        shape.WorldVertices!.AsSpan(0, shape.LocalPolygon.Count).CopyTo(destination);
    }

    /// <summary>Reads the world bounds of a shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Aabb2D GetWorldAabb(ShapeId id) => _shapes[Validate(id)].WorldAabb;

    /// <summary>Reads the world polygon of a polygon shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Polygon2D GetWorldPolygon(ShapeId id)
    {
        int slot = Validate(id);
        if (_shapes[slot].Kind != ColliderKind.Polygon)
        {
            ThrowHelper.ThrowInvalidOperation("Shape is not a polygon.");
        }

        return _shapes[slot].WorldPolygon;
    }

    /// <summary>Reads the world segment of an edge shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Edge2D GetWorldEdge(ShapeId id)
    {
        int slot = Validate(id);
        if (_shapes[slot].Kind != ColliderKind.Edge)
        {
            ThrowHelper.ThrowInvalidOperation("Shape is not an edge.");
        }

        return _shapes[slot].WorldEdge;
    }

    /// <summary>Internal slot access for the world; validated.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal ref ShapeRecord Slot(ShapeId id) => ref _shapes[Validate(id)];

    /// <summary>Slot capacity for internal iteration.</summary>
    internal int SlotCapacity
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _capacity;
    }

    /// <summary>Whether a raw slot holds a live shape; for internal iteration.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal bool IsSlotLive(int slot) => slot >= 0 && slot < _capacity && _shapes[slot].Live;

    /// <summary>Raw slot view for internal iteration; the caller holds the liveness invariant.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal ref ShapeRecord SlotAt(int slot) => ref _shapes[slot];

    /// <summary>Whether a shape is a trigger-only sensor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsSensor(ShapeId id) => _shapes[Validate(id)].IsSensor;

    /// <summary>Reads the collision filter of a shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public CollisionFilter GetFilter(ShapeId id) => _shapes[Validate(id)].Filter;

    /// <summary>Writes the collision filter of a shape; bounds never change, so the tree needs no sync.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetFilter(ShapeId id, in CollisionFilter filter)
    {
        _shapes[Validate(id)].Filter = filter;
    }

    /// <summary>Reads the contact material of a shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public PhysicsMaterial GetMaterial(ShapeId id) => _shapes[Validate(id)].Material;

    /// <summary>Writes the contact material of a shape; the solver reads it from the next pass on.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetMaterial(ShapeId id, in PhysicsMaterial material)
    {
        _shapes[Validate(id)].Material = material;
    }

    /// <summary>Marks a shape as a trigger-only sensor or a solid collider. Bounds never change, so the tree needs no sync.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetSensor(ShapeId id, bool isSensor)
    {
        _shapes[Validate(id)].IsSensor = isSensor;
    }

    private void FinishAttach<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree2D<ShapeId, TStrategy, TMetrics> tree,
        int slot)
        where TStrategy : struct, ISpatialPartitionStrategy2D
        where TMetrics : struct, ISpatialMetricsSink
    {
        RefreshWorld(bodies, slot);
        ref ShapeRecord shape = ref _shapes[slot];
        shape.TreeItem = tree.Insert(in shape.WorldAabb, ShapeId.FromIndex(slot));

        ref BodyState body = ref bodies.Slot(shape.Body);
        shape.NextShape = body.FirstShape;
        body.FirstShape = slot;
        body.ShapeCount++;
        _count++;

        RecalculateMass(bodies, shape.Body);
    }

    private int InsertRecord(
        BodyStore bodies,
        BodyId bodyId,
        ColliderKind kind,
        float density,
        CollisionFilter filter,
        PhysicsMaterial material,
        Vec2 localOffset,
        float localAngle,
        bool isSensor)
    {
        bodies.Slot(bodyId);

        if (!(density > 0.0f) || float.IsNaN(density))
        {
            ThrowHelper.ThrowInvalidOperation("Density must be positive.");
        }

        if (filter.Equals(default))
        {
            filter = CollisionFilter.Default;
        }

        if (material.Equals(default))
        {
            material = PhysicsMaterial.Default;
        }

        int slot = AllocateSlot();
        ref ShapeRecord shape = ref _shapes[slot];

        shape = default;
        shape.Live = true;
        shape.Kind = kind;
        shape.Body = bodyId;
        shape.LocalFrame = new Transform2D(localOffset, localAngle);
        shape.Density = density;
        shape.Filter = filter;
        shape.Material = material;
        shape.IsSensor = isSensor;
        shape.TreeItem = SpatialItemId.Invalid;
        shape.NextShape = -1;
        return slot;
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void RefreshWorld(BodyStore bodies, int slot)
    {
        ref ShapeRecord shape = ref _shapes[slot];
        ref readonly BodyState body = ref bodies.Slot(shape.Body);
        Transform2D bodyFrame = Transform2D.FromRotation(body.Position, body.Cos, body.Sin);
        Transform2D world = Transform2D.Concat(bodyFrame, shape.LocalFrame);

        switch (shape.Kind)
        {
            case ColliderKind.Circle:
                {
                    Vec2 center = world.TransformPoint(shape.LocalCircle.Center);
                    shape.WorldCircle = new Circle2(center, shape.LocalCircle.Radius);
                    shape.WorldCentroid = center;
                    shape.WorldAabb = Circle2.ComputeBounds(in shape.WorldCircle);
                    break;
                }

            case ColliderKind.Capsule:
                {
                    Vec2 p0 = world.TransformPoint(shape.LocalCapsule.P0);
                    Vec2 p1 = world.TransformPoint(shape.LocalCapsule.P1);
                    shape.WorldCapsule = new Capsule2D(p0, p1, shape.LocalCapsule.Radius);
                    shape.WorldCentroid = (p0 + p1) * 0.5f;
                    shape.WorldAabb = Capsule2D.ComputeBounds(in shape.WorldCapsule);
                    break;
                }

            case ColliderKind.Edge:
                {
                    Vec2 p0 = world.TransformPoint(shape.LocalEdge.P0);
                    Vec2 p1 = world.TransformPoint(shape.LocalEdge.P1);
                    shape.WorldEdge = new Edge2D(p0, p1);
                    shape.WorldCentroid = (p0 + p1) * 0.5f;
                    shape.WorldAabb = Edge2D.ComputeBounds(in shape.WorldEdge);
                    break;
                }

            default:
                {
                    ReadOnlySpan<Vec2> localVerts = shape.LocalPolygon.Vertices;
                    ReadOnlySpan<Vec2> localNormals = shape.LocalPolygon.Normals;
                    Vec2[] worldVerts = shape.WorldVertices!;
                    Vec2[] worldNormals = shape.WorldNormals!;
                    Vec2 min = new(float.PositiveInfinity, float.PositiveInfinity);
                    Vec2 max = new(float.NegativeInfinity, float.NegativeInfinity);
                    Vec2 centroid = Vec2.Zero;
                    for (int i = 0; i < localVerts.Length; i++)
                    {
                        Vec2 w = world.TransformPoint(localVerts[i]);
                        worldVerts[i] = w;
                        worldNormals[i] = world.Rotate(localNormals[i]);
                        min = Vec2.Min(min, w);
                        max = Vec2.Max(max, w);
                        centroid += w;
                    }

                    centroid *= 1.0f / localVerts.Length;
                    shape.WorldCentroid = centroid;
                    shape.WorldAabb = new Aabb2D(min, max);
                    shape.WorldPolygon = Polygon2D.CreateTrusted(worldVerts, worldNormals);
                    break;
                }
        }
    }

    /// <summary>
    /// Re-sums a body's mass from its shapes with parallel-axis transfer to
    /// the center of mass. Shapeless bodies keep zero mass (infinite
    /// response); locked rotation pins the inverse inertia.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    internal void RecalculateMass(BodyStore bodies, BodyId bodyId)
    {
        ref BodyState body = ref bodies.Slot(bodyId);

        float totalMass = 0.0f;
        Vec2 weightedCenter = Vec2.Zero;
        float inertiaOrigin = 0.0f;

        int current = body.FirstShape;
        while (current != -1)
        {
            ref readonly ShapeRecord shape = ref _shapes[current];
            MassData data = shape.Kind switch
            {
                ColliderKind.Circle => LocalMassCircle(in shape),
                ColliderKind.Capsule => LocalMassCapsule(in shape),
                ColliderKind.Edge => MassData.Zero,
                _ => LocalMassPolygon(in shape),
            };

            totalMass += data.Mass;
            weightedCenter += data.Centroid * data.Mass;
            inertiaOrigin += data.Inertia + (data.Mass * Vec2.Dot(data.Centroid, data.Centroid));
            current = shape.NextShape;
        }

        if (totalMass <= 0.0f)
        {
            body.Mass = 0.0f;
            body.InverseMass = 0.0f;
            body.Inertia = 0.0f;
            body.InverseInertia = 0.0f;
            body.LocalCenter = Vec2.Zero;
            return;
        }

        Vec2 center = weightedCenter * (1.0f / totalMass);
        float inertia = inertiaOrigin - (totalMass * Vec2.Dot(center, center));
        if (inertia < 0.0f)
        {
            inertia = 0.0f;
        }

        // Static and kinematic bodies answer with infinite mass no matter
        // what is attached: the raw totals stay readable, but the inverses
        // that the solver multiplies by are pinned to zero.
        bool infinite = body.Type != BodyType.Dynamic;
        body.Mass = totalMass;
        body.InverseMass = !infinite ? 1.0f / totalMass : 0.0f;
        body.Inertia = inertia;
        body.InverseInertia = !infinite && (body.Flags & BodyFlags.FixedRotation) == 0 && inertia > 0.0f ? 1.0f / inertia : 0.0f;
        body.LocalCenter = center;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData LocalMassCircle(in ShapeRecord shape)
    {
        Vec2 center = shape.LocalFrame.TransformPoint(shape.LocalCircle.Center);
        float mass = MathF.PI * shape.LocalCircle.Radius * shape.LocalCircle.Radius * shape.Density;
        if (mass <= 0.0f)
        {
            return MassData.Zero;
        }

        float inertia = 0.5f * mass * shape.LocalCircle.Radius * shape.LocalCircle.Radius;
        return new MassData(mass, 0.0f, inertia, 0.0f, center);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData LocalMassCapsule(in ShapeRecord shape)
    {
        Vec2 p0 = shape.LocalFrame.TransformPoint(shape.LocalCapsule.P0);
        Vec2 p1 = shape.LocalFrame.TransformPoint(shape.LocalCapsule.P1);
        var moved = new Capsule2D(p0, p1, shape.LocalCapsule.Radius);
        MassData data = moved.ComputeMass(shape.Density);
        return new MassData(data.Mass, 0.0f, data.Inertia, 0.0f, data.Centroid);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData LocalMassPolygon(in ShapeRecord shape)
    {
        ReadOnlySpan<Vec2> localVerts = shape.LocalPolygon.Vertices;
        int count = localVerts.Length;

        float area2 = 0.0f;
        Vec2 centroidAccum = Vec2.Zero;
        float inertiaOrigin = 0.0f;

        for (int i = 0; i < count; i++)
        {
            Vec2 a = shape.LocalFrame.TransformPoint(localVerts[i]);
            Vec2 b = shape.LocalFrame.TransformPoint(localVerts[(i + 1) % count]);
            float cross = (a.X * b.Y) - (b.X * a.Y);
            area2 += cross;
            centroidAccum += (a + b) * cross;
            inertiaOrigin += cross * (Vec2.Dot(a, a) + Vec2.Dot(a, b) + Vec2.Dot(b, b));
        }

        float area = area2 * 0.5f;
        float mass = area * shape.Density;
        if (mass <= 0.0f)
        {
            return MassData.Zero;
        }

        Vec2 centroid = centroidAccum / (3.0f * area2);
        float inertia = ((shape.Density * inertiaOrigin) / 12.0f) - (mass * Vec2.Dot(centroid, centroid));
        return new MassData(mass, 0.0f, inertia, 0.0f, centroid);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int AllocateSlot()
    {
        if (_freeCount > 0)
        {
            return _freeStack[--_freeCount];
        }

        if (_highWater >= _capacity)
        {
            Grow();
        }

        return _highWater++;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private void Grow()
    {
        int newCapacity = _capacity * 2;
        Array.Resize(ref _shapes, newCapacity);
        Array.Resize(ref _freeStack, newCapacity);
        _capacity = newCapacity;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private int Validate(ShapeId id)
    {
        int slot = id.ToIndex();
        if (!id.IsValid || slot < 0 || slot >= _capacity || !_shapes[slot].Live)
        {
            ThrowHelper.ThrowInvalidOperation("Shape ID is unallocated or has been detached.");
        }

        return slot;
    }
}
