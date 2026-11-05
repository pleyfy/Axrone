namespace Axrone.Physics3D;

/// <summary>Stored collider kind; selects the active geometry of a shape record.</summary>
public enum ColliderKind : byte
{
    /// <summary>Ball collider.</summary>
    Sphere = 0,

    /// <summary>Axis-aligned box collider.</summary>
    Box = 1,

    /// <summary>Stadium-solid collider.</summary>
    Capsule = 2,

    /// <summary>Cylinder collider around a principal axis.</summary>
    Cylinder = 3,

    /// <summary>Cone collider around a principal axis.</summary>
    Cone = 4,

    /// <summary>Convex point-cloud collider.</summary>
    Hull = 5,

    /// <summary>Triangle-soup collider; convex-approximated in contact.</summary>
    Mesh = 6,

    /// <summary>Terrain-grid collider.</summary>
    Heightfield = 7,
}

/// <summary>
/// One attached collider: the owning body, the local frame it sits in, the
/// local geometry (exactly one variant is live, selected by
/// <see cref="Kind"/>), density/filter/material, the cached world frame plus
/// world bounds (refreshed by sync, never allocated after attach), and the
/// broadphase item. Mutable storage owned by <see cref="ShapeStore"/>.
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
    public RigidTransform3D LocalFrame;

    /// <summary>Mass per unit volume; always positive.</summary>
    public float Density;

    /// <summary>Collision filtering.</summary>
    public CollisionFilter Filter;

    /// <summary>Contact response.</summary>
    public PhysicsMaterial Material;
    /// <summary>Trigger-only collider: overlaps report but never push.</summary>
    public bool IsSensor;

    /// <summary>Local ball; live when <see cref="Kind"/> is <see cref="ColliderKind.Sphere"/>.</summary>
    public Sphere3 LocalSphere;

    /// <summary>Local box; live when <see cref="Kind"/> is <see cref="ColliderKind.Box"/>.</summary>
    public Box3 LocalBox;

    /// <summary>Local capsule; live when <see cref="Kind"/> is <see cref="ColliderKind.Capsule"/>.</summary>
    public Capsule3 LocalCapsule;

    /// <summary>Local cylinder; live when <see cref="Kind"/> is <see cref="ColliderKind.Cylinder"/>.</summary>
    public Cylinder3 LocalCylinder;

    /// <summary>Local cone; live when <see cref="Kind"/> is <see cref="ColliderKind.Cone"/>.</summary>
    public Cone3 LocalCone;

    /// <summary>Local hull; live when <see cref="Kind"/> is <see cref="ColliderKind.Hull"/>.</summary>
    public Hull3D LocalHull;

    /// <summary>Local mesh; live when <see cref="Kind"/> is <see cref="ColliderKind.Mesh"/>.</summary>
    public Mesh3D LocalMesh;

    /// <summary>Local heightfield; live when <see cref="Kind"/> is <see cref="ColliderKind.Heightfield"/>.</summary>
    public Heightfield3D LocalHeightfield;

    /// <summary>World frame; refreshed on sync.</summary>
    public RigidTransform3D WorldFrame;

    /// <summary>World centroid; refreshed on sync.</summary>
    public Vec3 WorldCentroid;

    /// <summary>World bounds; refreshed on sync.</summary>
    public Aabb3D WorldAabb;

    /// <summary>Broadphase item; invalid until inserted.</summary>
    public SpatialItemId TreeItem;

    /// <summary>Next shape of the owning body; -1 at the tail.</summary>
    public int NextShape;
}

/// <summary>
/// Dense slot store of attached colliders: local-frame geometry per body,
/// cached world frames plus bounds (no allocation after attach), automatic
/// mass accumulation into the owning body with center-of-mass tracking, and
/// broadphase insert/update/remove wired to the 3D tree. Identities are slot
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

    /// <summary>Attaches a ball to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachSphere<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec3 center,
        float radius,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec3 localOffset = default,
        Quat localRotation = default,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Sphere3(center, radius);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Sphere, density, filter, material, localOffset, localRotation, isSensor);
        _shapes[slot].LocalSphere = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches an axis-aligned box to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachBox<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec3 center,
        Vec3 halfExtents,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec3 localOffset = default,
        Quat localRotation = default,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Box3(center, halfExtents);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Box, density, filter, material, localOffset, localRotation, isSensor);
        _shapes[slot].LocalBox = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a stadium solid to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachCapsule<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec3 p0,
        Vec3 p1,
        float radius,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec3 localOffset = default,
        Quat localRotation = default,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Capsule3(p0, p1, radius);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Capsule, density, filter, material, localOffset, localRotation, isSensor);
        _shapes[slot].LocalCapsule = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a cylinder to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachCylinder<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec3 center,
        float radius,
        float height,
        ShapeAxis3D axis = ShapeAxis3D.Y,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec3 localOffset = default,
        Quat localRotation = default,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Cylinder3(center, radius, height, axis);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Cylinder, density, filter, material, localOffset, localRotation, isSensor);
        _shapes[slot].LocalCylinder = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a cone to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachCone<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec3 center,
        float radius,
        float height,
        ShapeAxis3D axis = ShapeAxis3D.Y,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec3 localOffset = default,
        Quat localRotation = default,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Cone3(center, radius, height, axis);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Cone, density, filter, material, localOffset, localRotation, isSensor);
        _shapes[slot].LocalCone = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a convex hull to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachHull<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec3[] vertices,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec3 localOffset = default,
        Quat localRotation = default,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Hull3D(vertices);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Hull, density, filter, material, localOffset, localRotation, isSensor);
        _shapes[slot].LocalHull = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a triangle mesh to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachMesh<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        Vec3[] vertices,
        int[] indices,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec3 localOffset = default,
        Quat localRotation = default,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Mesh3D(vertices, indices);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Mesh, density, filter, material, localOffset, localRotation, isSensor);
        _shapes[slot].LocalMesh = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Attaches a heightfield to <paramref name="bodyId"/> and inserts it into <paramref name="tree"/>.</summary>
    public ShapeId AttachHeightfield<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId,
        float[] heights,
        int width,
        int depth,
        float scaleX = 1.0f,
        float scaleY = 1.0f,
        float scaleZ = 1.0f,
        float density = 1.0f,
        CollisionFilter filter = default,
        PhysicsMaterial material = default,
        Vec3 localOffset = default,
        Quat localRotation = default,
        bool isSensor = false)
        where TStrategy : struct, ISpatialPartitionStrategy
        where TMetrics : struct, ISpatialMetricsSink
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(tree);
        var local = new Heightfield3D(heights, width, depth, scaleX, scaleY, scaleZ);
        int slot = InsertRecord(bodies, bodyId, ColliderKind.Heightfield, density, filter, material, localOffset, localRotation, isSensor);
        _shapes[slot].LocalHeightfield = local;
        FinishAttach(bodies, tree, slot);
        return ShapeId.FromIndex(slot);
    }

    /// <summary>Drops a shape, unlinks it from its body, pulls it from the tree and re-sums the body mass.</summary>
    public void Detach<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        ShapeId id)
        where TStrategy : struct, ISpatialPartitionStrategy
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

    /// <summary>Refreshes the world frame, bounds and tree placement of one shape.</summary>
    public void SyncShape<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        ShapeId id)
        where TStrategy : struct, ISpatialPartitionStrategy
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
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        BodyId bodyId)
        where TStrategy : struct, ISpatialPartitionStrategy
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

    /// <summary>Reads the collider kind of a shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ColliderKind GetKind(ShapeId id) => _shapes[Validate(id)].Kind;

    /// <summary>Reads the world frame of a shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public RigidTransform3D GetWorldFrame(ShapeId id) => _shapes[Validate(id)].WorldFrame;

    /// <summary>Reads the world ball of a sphere shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Sphere3 GetWorldSphere(ShapeId id)
    {
        ref readonly ShapeRecord shape = ref _shapes[Validate(id)];
        return new Sphere3(shape.WorldFrame.TransformPoint(shape.LocalSphere.Center), shape.LocalSphere.Radius);
    }

    /// <summary>Reads the world box of a box shape: center in world, extents and orientation via <see cref="GetWorldFrame"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Box3 GetWorldBox(ShapeId id)
    {
        ref readonly ShapeRecord shape = ref _shapes[Validate(id)];
        return new Box3(shape.WorldFrame.TransformPoint(shape.LocalBox.Center), shape.LocalBox.HalfExtents);
    }

    /// <summary>Reads the local capsule of a capsule shape; orientation via <see cref="GetWorldFrame"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Capsule3 GetCapsule(ShapeId id) => _shapes[Validate(id)].LocalCapsule;

    /// <summary>Reads the world capsule of a capsule shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Capsule3 GetWorldCapsule(ShapeId id)
    {
        ref readonly ShapeRecord shape = ref _shapes[Validate(id)];
        RigidTransform3D frame = shape.WorldFrame;
        return new Capsule3(frame.TransformPoint(shape.LocalCapsule.P0), frame.TransformPoint(shape.LocalCapsule.P1), shape.LocalCapsule.Radius);
    }

    /// <summary>Reads the local cylinder of a cylinder shape; orientation via <see cref="GetWorldFrame"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Cylinder3 GetCylinder(ShapeId id) => _shapes[Validate(id)].LocalCylinder;

    /// <summary>Reads the local cone of a cone shape; orientation via <see cref="GetWorldFrame"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Cone3 GetCone(ShapeId id) => _shapes[Validate(id)].LocalCone;

    /// <summary>Reads the local hull of a hull shape; orientation via <see cref="GetWorldFrame"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Hull3D GetHull(ShapeId id) => _shapes[Validate(id)].LocalHull;

    /// <summary>Reads the local mesh of a mesh shape; orientation via <see cref="GetWorldFrame"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Mesh3D GetMesh(ShapeId id) => _shapes[Validate(id)].LocalMesh;

    /// <summary>Reads the local heightfield of a heightfield shape; orientation via <see cref="GetWorldFrame"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Heightfield3D GetHeightfield(ShapeId id) => _shapes[Validate(id)].LocalHeightfield;

    /// <summary>Reads the world bounds of a shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Aabb3D GetWorldAabb(ShapeId id) => _shapes[Validate(id)].WorldAabb;

    /// <summary>Whether the shape is a trigger-only sensor.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool IsSensor(ShapeId id) => _shapes[Validate(id)].IsSensor;

    /// <summary>Marks a shape as a trigger-only sensor or a solid collider.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void SetSensor(ShapeId id, bool isSensor)
    {
        _shapes[Validate(id)].IsSensor = isSensor;
    }

    /// <summary>Internal record access for the world and the solver; validated.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal ref ShapeRecord Record(ShapeId id) => ref _shapes[Validate(id)];

    private void FinishAttach<TStrategy, TMetrics>(
        BodyStore bodies,
        DynamicAabbTree<ShapeId, TStrategy, TMetrics> tree,
        int slot)
        where TStrategy : struct, ISpatialPartitionStrategy
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
        Vec3 localOffset,
        Quat localRotation,
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

        if (localRotation.Equals(default(Quat)))
        {
            localRotation = Quat.Identity;
        }

        int slot = AllocateSlot();
        ref ShapeRecord shape = ref _shapes[slot];

        shape = default;
        shape.Live = true;
        shape.Kind = kind;
        shape.Body = bodyId;
        shape.LocalFrame = new RigidTransform3D(localOffset, localRotation);
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
        var bodyFrame = new RigidTransform3D(body.Position, body.Rotation);
        RigidTransform3D world = RigidTransform3D.Concat(bodyFrame, shape.LocalFrame);
        shape.WorldFrame = world;

        if (shape.Kind == ColliderKind.Sphere)
        {
            shape.WorldCentroid = world.TransformPoint(shape.LocalSphere.Center);
            shape.WorldAabb = Sphere3.ComputeBounds(new Sphere3(shape.WorldCentroid, shape.LocalSphere.Radius));
            return;
        }

        if (shape.Kind == ColliderKind.Capsule)
        {
            Vec3 p0 = world.TransformPoint(shape.LocalCapsule.P0);
            Vec3 p1 = world.TransformPoint(shape.LocalCapsule.P1);
            shape.WorldCentroid = (p0 + p1) * 0.5f;
            shape.WorldAabb = Capsule3.ComputeBounds(new Capsule3(p0, p1, shape.LocalCapsule.Radius));
            return;
        }

        if (shape.Kind == ColliderKind.Cylinder)
        {
            Vec3 shapeCenter = world.TransformPoint(shape.LocalCylinder.Center);
            shape.WorldCentroid = shapeCenter;
            shape.WorldAabb = RotatedBoxBounds(
                shapeCenter, world.Rotation,
                ShapeAxis.Extents(shape.LocalCylinder.Radius, shape.LocalCylinder.Height * 0.5f, shape.LocalCylinder.Axis));
            return;
        }

        if (shape.Kind == ColliderKind.Cone)
        {
            Vec3 shapeCenter = world.TransformPoint(shape.LocalCone.Center);
            shape.WorldCentroid = shapeCenter;
            Vec3 localAxis = ShapeAxis.Vector(shape.LocalCone.Axis);
            Vec3 boundsCenter = world.TransformPoint(shape.LocalCone.Center + (localAxis * (shape.LocalCone.Height * 0.25f)));
            shape.WorldAabb = RotatedBoxBounds(
                boundsCenter, world.Rotation,
                ShapeAxis.Extents(shape.LocalCone.Radius, shape.LocalCone.Height * 0.5f, shape.LocalCone.Axis));
            return;
        }

        if (shape.Kind == ColliderKind.Hull)
        {
            Vec3[] vertices = shape.LocalHull.Vertices;
            Vec3 min = new(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity);
            Vec3 max = new(float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity);
            Vec3 sum = Vec3.Zero;
            for (int i = 0; i < vertices.Length; i++)
            {
                Vec3 w = world.TransformPoint(vertices[i]);
                min = Vec3.Min(min, w);
                max = Vec3.Max(max, w);
                sum += w;
            }

            shape.WorldCentroid = sum * (1.0f / vertices.Length);
            shape.WorldAabb = new Aabb3D(min, max);
            return;
        }

        if (shape.Kind == ColliderKind.Mesh)
        {
            Vec3[] vertices = shape.LocalMesh.Vertices;
            Vec3 min = new(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity);
            Vec3 max = new(float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity);
            Vec3 sum = Vec3.Zero;
            for (int i = 0; i < vertices.Length; i++)
            {
                Vec3 w = world.TransformPoint(vertices[i]);
                min = Vec3.Min(min, w);
                max = Vec3.Max(max, w);
                sum += w;
            }

            shape.WorldCentroid = sum * (1.0f / vertices.Length);
            shape.WorldAabb = new Aabb3D(min, max);
            return;
        }

        if (shape.Kind == ColliderKind.Heightfield)
        {
            Heightfield3D field = shape.LocalHeightfield;
            Vec3 min = new(float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity);
            Vec3 max = new(float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity);
            Vec3 sum = Vec3.Zero;
            int total = field.Width * field.Depth;
            for (int z = 0; z < field.Depth; z++)
            {
                for (int x = 0; x < field.Width; x++)
                {
                    Vec3 w = world.TransformPoint(field.Vertex(x, z));
                    min = Vec3.Min(min, w);
                    max = Vec3.Max(max, w);
                    sum += w;
                }
            }

            shape.WorldCentroid = sum * (1.0f / total);
            shape.WorldAabb = new Aabb3D(min, max);
            return;
        }

        Vec3 center = world.TransformPoint(shape.LocalBox.Center);
        shape.WorldCentroid = center;
        shape.WorldAabb = RotatedBoxBounds(center, world.Rotation, shape.LocalBox.HalfExtents);
    }

    /// <summary>Bounds of a box rotated by <paramref name="rotation"/>: projects each half-axis and sums the absolute spans.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static Aabb3D RotatedBoxBounds(Vec3 center, Quat rotation, Vec3 halfExtents)
    {
        Vec3 ax = rotation * new Vec3(halfExtents.X, 0.0f, 0.0f);
        Vec3 ay = rotation * new Vec3(0.0f, halfExtents.Y, 0.0f);
        Vec3 az = rotation * new Vec3(0.0f, 0.0f, halfExtents.Z);
        var span = new Vec3(
            MathF.Abs(ax.X) + MathF.Abs(ay.X) + MathF.Abs(az.X),
            MathF.Abs(ax.Y) + MathF.Abs(ay.Y) + MathF.Abs(az.Y),
            MathF.Abs(ax.Z) + MathF.Abs(ay.Z) + MathF.Abs(az.Z));
        return Aabb3D.FromCenterExtents(center, span);
    }

    /// <summary>
    /// Re-sums a body's mass from its shapes with parallel-axis transfer to
    /// the center of mass. Shapeless bodies keep zero mass (infinite
    /// response); locked rotation pins the inverse inertia. Shapes are
    /// authored axis-aligned: a rotated local frame moves the centroid
    /// exactly but its inertia stays in the canonical diagonal, so attach
    /// rotated boxes only when the approximation is acceptable.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    internal void RecalculateMass(BodyStore bodies, BodyId bodyId)
    {
        ref BodyState body = ref bodies.Slot(bodyId);

        float totalMass = 0.0f;
        Vec3 weightedCenter = Vec3.Zero;
        Vec3 inertiaOrigin = Vec3.Zero;

        int current = body.FirstShape;
        while (current != -1)
        {
            ref readonly ShapeRecord shape = ref _shapes[current];
            MassData3D data = shape.Kind switch
            {
                ColliderKind.Sphere => LocalMassSphere(in shape),
                ColliderKind.Capsule => LocalMassCapsule(in shape),
                ColliderKind.Cylinder => LocalMassCylinder(in shape),
                ColliderKind.Cone => LocalMassCone(in shape),
                ColliderKind.Hull => LocalMassHull(in shape),
                ColliderKind.Mesh => LocalMassMesh(in shape),
                ColliderKind.Heightfield => LocalMassHeightfield(in shape),
                _ => LocalMassBox(in shape),
            };

            totalMass += data.Mass;
            weightedCenter += data.Centroid * data.Mass;
            inertiaOrigin += data.InertiaDiagonal + (data.Mass * OffsetSquares(data.Centroid));
            current = shape.NextShape;
        }

        if (totalMass <= 0.0f)
        {
            body.Mass = 0.0f;
            body.InverseMass = 0.0f;
            body.InertiaDiagonal = Vec3.Zero;
            body.InverseInertia = Vec3.Zero;
            body.LocalCenter = Vec3.Zero;
            return;
        }

        Vec3 center = weightedCenter * (1.0f / totalMass);
        Vec3 inertia = inertiaOrigin - (totalMass * OffsetSquares(center));
        inertia = new Vec3(
            MathF.Max(inertia.X, 0.0f),
            MathF.Max(inertia.Y, 0.0f),
            MathF.Max(inertia.Z, 0.0f));

        // Static and kinematic bodies answer with infinite mass no matter
        // what is attached: the raw total stays readable, but the inverse
        // that the solver multiplies by is pinned to zero.
        bool infinite = body.Type != BodyType.Dynamic;
        bool locked = (body.Flags & BodyFlags.FixedRotation) != 0;
        body.Mass = totalMass;
        body.InverseMass = !infinite ? 1.0f / totalMass : 0.0f;
        body.InverseInertia = new Vec3(
            !infinite && !locked && inertia.X > 0.0f ? 1.0f / inertia.X : 0.0f,
            !infinite && !locked && inertia.Y > 0.0f ? 1.0f / inertia.Y : 0.0f,
            !infinite && !locked && inertia.Z > 0.0f ? 1.0f / inertia.Z : 0.0f);
        body.LocalCenter = center;
    }

    /// <summary>Per-axis parallel-axis offsets: (dy^2+dz^2, dx^2+dz^2, dx^2+dy^2).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static Vec3 OffsetSquares(Vec3 offset) => new(
        (offset.Y * offset.Y) + (offset.Z * offset.Z),
        (offset.X * offset.X) + (offset.Z * offset.Z),
        (offset.X * offset.X) + (offset.Y * offset.Y));

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData3D LocalMassSphere(in ShapeRecord shape)
    {
        Vec3 center = shape.LocalFrame.TransformPoint(shape.LocalSphere.Center);
        float mass = (4.0f / 3.0f) * MathF.PI * shape.LocalSphere.Radius * shape.LocalSphere.Radius * shape.LocalSphere.Radius * shape.Density;
        if (mass <= 0.0f)
        {
            return MassData3D.Zero;
        }

        float inertia = 0.4f * mass * shape.LocalSphere.Radius * shape.LocalSphere.Radius;
        var diagonal = new Vec3(inertia, inertia, inertia);
        return new MassData3D(mass, 0.0f, diagonal, Vec3.Zero, center);
    }

    /// <summary>Mass of a capsule moved into the body frame; isotropic per the web descriptors.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData3D LocalMassCapsule(in ShapeRecord shape)
    {
        Vec3 p0 = shape.LocalFrame.TransformPoint(shape.LocalCapsule.P0);
        Vec3 p1 = shape.LocalFrame.TransformPoint(shape.LocalCapsule.P1);
        var moved = new Capsule3(p0, p1, shape.LocalCapsule.Radius);
        MassData3D data = moved.ComputeMass(shape.Density);
        return new MassData3D(data.Mass, 0.0f, data.InertiaDiagonal, Vec3.Zero, data.Centroid);
    }

    /// <summary>Mass of a cylinder moved into the body frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData3D LocalMassCylinder(in ShapeRecord shape)
    {
        Vec3 center = shape.LocalFrame.TransformPoint(shape.LocalCylinder.Center);
        var moved = new Cylinder3(center, shape.LocalCylinder.Radius, shape.LocalCylinder.Height, shape.LocalCylinder.Axis);
        MassData3D data = moved.ComputeMass(shape.Density);
        return new MassData3D(data.Mass, 0.0f, data.InertiaDiagonal, Vec3.Zero, data.Centroid);
    }

    /// <summary>Mass of a cone moved into the body frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData3D LocalMassCone(in ShapeRecord shape)
    {
        Vec3 center = shape.LocalFrame.TransformPoint(shape.LocalCone.Center);
        var moved = new Cone3(center, shape.LocalCone.Radius, shape.LocalCone.Height, shape.LocalCone.Axis);
        MassData3D data = moved.ComputeMass(shape.Density);
        return new MassData3D(data.Mass, 0.0f, data.InertiaDiagonal, Vec3.Zero, data.Centroid);
    }

    /// <summary>Mass of a hull moved into the body frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData3D LocalMassHull(in ShapeRecord shape)
    {
        MassData3D data = new Hull3D(shape.LocalHull.Vertices).ComputeMass(shape.Density);
        Vec3 centroid = shape.LocalFrame.TransformPoint(data.Centroid);
        return new MassData3D(data.Mass, 0.0f, data.InertiaDiagonal, Vec3.Zero, centroid);
    }

    /// <summary>Mass of a mesh moved into the body frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData3D LocalMassMesh(in ShapeRecord shape)
    {
        MassData3D data = new Mesh3D(shape.LocalMesh.Vertices, shape.LocalMesh.Indices).ComputeMass(shape.Density);
        Vec3 centroid = shape.LocalFrame.TransformPoint(data.Centroid);
        return new MassData3D(data.Mass, 0.0f, data.InertiaDiagonal, Vec3.Zero, centroid);
    }

    /// <summary>Mass of a heightfield moved into the body frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData3D LocalMassHeightfield(in ShapeRecord shape)
    {
        Heightfield3D field = shape.LocalHeightfield;
        MassData3D data = new Heightfield3D(
            field.Heights, field.Width, field.Depth, field.ScaleX, field.ScaleY, field.ScaleZ).ComputeMass(shape.Density);
        Vec3 centroid = shape.LocalFrame.TransformPoint(data.Centroid);
        return new MassData3D(data.Mass, 0.0f, data.InertiaDiagonal, Vec3.Zero, centroid);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static MassData3D LocalMassBox(in ShapeRecord shape)
    {
        Vec3 center = shape.LocalFrame.TransformPoint(shape.LocalBox.Center);
        Vec3 h = shape.LocalBox.HalfExtents;
        float mass = 8.0f * h.X * h.Y * h.Z * shape.Density;
        if (mass <= 0.0f)
        {
            return MassData3D.Zero;
        }

        var diagonal = new Vec3(
            (mass / 3.0f) * ((h.Y * h.Y) + (h.Z * h.Z)),
            (mass / 3.0f) * ((h.X * h.X) + (h.Z * h.Z)),
            (mass / 3.0f) * ((h.X * h.X) + (h.Y * h.Y)));
        return new MassData3D(mass, 0.0f, diagonal, Vec3.Zero, center);
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
            ThrowHelper.ThrowShapeNotFound(id);
        }

        return slot;
    }
}
