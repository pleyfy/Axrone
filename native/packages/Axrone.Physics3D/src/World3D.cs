namespace Axrone.Physics3D;

using System.Buffers;
using System.Threading;

/// <summary>
/// Construction parameters of a world: gravity, solver sweeps, sleep tuning
/// and CCD subdivision. Guards live in the properties, so an invalid
/// combination is rejected at assignment.
/// </summary>
public readonly struct WorldDef
{
    /// <summary>Creates default parameters: earth-like gravity, sleeping on.</summary>
    public WorldDef()
    {
    }

    /// <summary>Gravitational acceleration; components must be finite.</summary>
    public Vec3 Gravity
    {
        get => field;
        init
        {
            if (float.IsNaN(value.X + value.Y + value.Z) || float.IsInfinity(value.X + value.Y + value.Z))
            {
                ThrowHelper.ThrowInvalidOperation("Gravity components must be finite.");
            }

            field = value;
        }
    } = new Vec3(0.0f, -10.0f, 0.0f); // Legacy default; web reference is -9.81 (see PhysicsConstants). Switching needs a tuning pass: -9.81 tunnels CylinderWorld_Drops_OnGround.

    /// <summary>Tuning of the broadphase tree.</summary>
    public TreeOptions BroadphaseOptions { get; init; } = new TreeOptions();

    /// <summary>Velocity sweeps per step; zero skips the velocity pass.</summary>
    public int VelocityIterations
    {
        get => field;
        init
        {
            if (value < 0)
            {
                ThrowHelper.ThrowInvalidOperation("Velocity iterations must not be negative.");
            }

            field = value;
        }
    } = 8;

    /// <summary>Position sweeps per step; zero skips the position pass.</summary>
    public int PositionIterations
    {
        get => field;
        init
        {
            if (value < 0)
            {
                ThrowHelper.ThrowInvalidOperation("Position iterations must not be negative.");
            }

            field = value;
        }
    } = 3;

    /// <summary>Quiet seconds before a body sleeps; strictly positive.</summary>
    public float TimeToSleep
    {
        get => field;
        init
        {
            if (!(value > 0.0f) || float.IsNaN(value))
            {
                ThrowHelper.ThrowInvalidOperation("Time to sleep must be positive.");
            }

            field = value;
        }
    } = PhysicsConstants.SleepTime;

    /// <summary>Linear speed below which a body counts as quiet; never negative.</summary>
    public float LinearSleepTolerance
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value))
            {
                ThrowHelper.ThrowInvalidOperation("Linear sleep tolerance must not be negative.");
            }

            field = value;
        }
    } = PhysicsConstants.LinearSleepTolerance;

    /// <summary>Angular speed below which a body counts as quiet; never negative.</summary>
    public float AngularSleepTolerance
    {
        get => field;
        init
        {
            if (value < 0.0f || float.IsNaN(value))
            {
                ThrowHelper.ThrowInvalidOperation("Angular sleep tolerance must not be negative.");
            }

            field = value;
        }
    } = PhysicsConstants.AngularSleepTolerance;

    /// <summary>Bullet translation covered per CCD substep; strictly positive.</summary>
    public float CcdSweepStep
    {
        get => field;
        init
        {
            if (!(value > 0.0f) || float.IsNaN(value) || float.IsInfinity(value))
            {
                ThrowHelper.ThrowInvalidOperation("CCD sweep step must be positive.");
            }

            field = value;
        }
    } = 0.5f;

    /// <summary>CCD substep cap per step; at least one.</summary>
    public int MaxCcdSubsteps
    {
        get => field;
        init
        {
            if (value < 1)
            {
                ThrowHelper.ThrowInvalidOperation("CCD substep cap must be at least one.");
            }

            field = value;
        }
    } = 8;

    /// <summary>Solver capabilities; clearing <see cref="SolverFlags.SleepingBodies"/> skips the sleep pass.</summary>
    public SolverFlags Flags { get; init; } = SolverFlags.Default;

    /// <summary>Whether each step clears accumulated forces after applying them.</summary>
    public bool AutoClearForces { get; init; } = true;
}

/// <summary>
/// Pair lifecycle notice: a shape pair started, persisted or stopped
/// overlapping. Events accumulate across the step and clear at the start of
/// the next one; read them after <see cref="World.Step"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ContactEvent(ShapeId ShapeA, ShapeId ShapeB, BodyId BodyA, BodyId BodyB, ContactEventType Type);

/// <summary>
/// Trigger notice for a sensor pair: enter on first overlap, stay while the
/// overlap persists, exit when it drops out. Events accumulate across the
/// step and clear at the start of the next one; read them after
/// <see cref="World.Step"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SensorEvent(ShapeId ShapeA, ShapeId ShapeB, BodyId BodyA, BodyId BodyB, SensorEventType Type);

/// <summary>
/// Post-solve notice for a solid pair: the impulses the solver accumulated
/// at every contact point. Tangent slots carry the combined magnitude of the
/// two friction channels. Notices accumulate across the step and clear at the
/// start of the next one; read them after <see cref="World.Step(float)"/>.
/// </summary>
public readonly record struct ContactImpulseEvent(
    ShapeId ShapeA,
    ShapeId ShapeB,
    BodyId BodyA,
    BodyId BodyB,
    int PointCount,
    float NormalImpulse0,
    float TangentImpulse0,
    float NormalImpulse1,
    float TangentImpulse1)
{
    /// <summary>Accumulated normal impulse of contact point <paramref name="index"/>.</summary>
    /// <param name="index">Point index, below <see cref="PointCount"/> and at most two slots.</param>
    /// <returns>The normal impulse.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public readonly float NormalAt(int index)
    {
        if (index != 0 && index != 1)
        {
            ThrowHelper.ThrowInvalidOperation("Impulse point index is out of range.");
        }

        return index == 0 ? NormalImpulse0 : NormalImpulse1;
    }

    /// <summary>Accumulated combined tangent impulse of contact point <paramref name="index"/>.</summary>
    /// <param name="index">Point index, below <see cref="PointCount"/> and at most two slots.</param>
    /// <returns>The tangent impulse magnitude.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public readonly float TangentAt(int index)
    {
        if (index != 0 && index != 1)
        {
            ThrowHelper.ThrowInvalidOperation("Impulse point index is out of range.");
        }

        return index == 0 ? TangentImpulse0 : TangentImpulse1;
    }
}

/// <summary>Lifecycle phase of a contact event.</summary>
public enum ContactEventType : byte
{
    /// <summary>A new overlap appeared this step.</summary>
    Began = 0,

    /// <summary>An overlap persisted from the previous step.</summary>
    Stay = 1,

    /// <summary>A previous overlap is gone.</summary>
    Ended = 2,
}

/// <summary>Snapshot of world population counters.</summary>
/// <param name="BodyCount">Live bodies.</param>
/// <param name="ShapeCount">Live shapes.</param>
/// <param name="JointCount">Live joints.</param>
/// <param name="ContactCount">Tracked contacts after the last step.</param>
/// <param name="SleepingBodyCount">Live dynamic bodies currently asleep.</param>
public readonly record struct WorldStatistics3D(int BodyCount, int ShapeCount, int JointCount, int ContactCount, int SleepingBodyCount);

/// <summary>Closest-point hit: the surface point nearest a query.</summary>
/// <param name="Shape">The shape hit.</param>
/// <param name="Body">The owning body.</param>
/// <param name="Point">Closest surface point in world space.</param>
/// <param name="Distance">Distance from the query point.</param>
public readonly record struct ClosestPointHit3D(ShapeId Shape, BodyId Body, Vec3 Point, float Distance);

/// <summary>
/// Simulation world: owns bodies, shapes and the broadphase tree, and runs
/// the step loop — integrate, sync broadphase, collect pairs, evaluate
/// manifolds with filtering and warm-start carry, solve, sleep. Contacts
/// persist across steps by shape-pair identity; separated pairs drop out.
/// Disposable: tears down the broadphase tree.
/// </summary>
public sealed class World : IDisposable
{
    private const int InitialContactCapacity = 16;

    private readonly BodyStore _bodies;
    private readonly ShapeStore _shapes;
    private readonly JointStore _joints;
    private readonly DynamicAabbTree<ShapeId, SurfaceAreaHeuristicStrategy, NullSpatialMetricsSink> _tree;
    private readonly IslandSolver3D<DefaultSleepPolicy3D> _islands = new();
    private Contact3D[] _contacts;
    private Contact3D[] _previous;
    private int _contactCount;
    private int _previousCount;
    private ContactEvent[] _events;
    private int _eventCount;
    private SensorEvent[] _sensorEvents;
    private int _sensorEventCount;
    private ContactImpulseEvent[] _impulseEvents;
    private int _impulseEventCount;
    private BroadPair[] _currentPairs;
    private int _currentPairCount;
    private BroadPair[] _stepPairs;
    private int _stepPairCount;
    private int _disposed;

    /// <summary>Gravity of the world.</summary>
    public Vec3 Gravity { get; set; }

    /// <summary>Velocity sweeps per step.</summary>
    public int VelocityIterations { get; set; }

    /// <summary>Position sweeps per step.</summary>
    public int PositionIterations { get; set; }

    /// <summary>Quiet seconds before a body sleeps.</summary>
    public float TimeToSleep { get; set; }

    /// <summary>Linear speed below which a body counts as quiet.</summary>
    public float LinearSleepTolerance { get; set; }

    /// <summary>Angular speed below which a body counts as quiet.</summary>
    public float AngularSleepTolerance { get; set; }

    /// <summary>Bullet translation covered per CCD substep.</summary>
    public float CcdSweepStep { get; set; }

    /// <summary>CCD substep cap per step.</summary>
    public int MaxCcdSubsteps { get; set; }

    /// <summary>Solver capabilities.</summary>
    public SolverFlags Flags { get; set; }

    /// <summary>Whether each step clears accumulated forces after applying them.</summary>
    public bool AutoClearForces { get; set; }

    /// <summary>Creates a world with default tuning.</summary>
    public World()
        : this(new WorldDef())
    {
    }

    /// <summary>Creates a world with fresh stores and the given tuning.</summary>
    public World(in WorldDef definition)
    {
        Gravity = definition.Gravity;
        VelocityIterations = definition.VelocityIterations;
        PositionIterations = definition.PositionIterations;
        TimeToSleep = definition.TimeToSleep;
        LinearSleepTolerance = definition.LinearSleepTolerance;
        AngularSleepTolerance = definition.AngularSleepTolerance;
        CcdSweepStep = definition.CcdSweepStep;
        MaxCcdSubsteps = definition.MaxCcdSubsteps;
        Flags = definition.Flags;
        AutoClearForces = definition.AutoClearForces;
        _bodies = new BodyStore();
        _shapes = new ShapeStore();
        _joints = new JointStore();
        _tree = new DynamicAabbTree<ShapeId, SurfaceAreaHeuristicStrategy, NullSpatialMetricsSink>(definition.BroadphaseOptions);
        _contacts = new Contact3D[InitialContactCapacity];
        _previous = new Contact3D[InitialContactCapacity];
        _contactCount = 0;
        _previousCount = 0;
        _events = new ContactEvent[InitialContactCapacity];
        _eventCount = 0;
        _sensorEvents = new SensorEvent[InitialContactCapacity];
        _sensorEventCount = 0;
        _impulseEvents = new ContactImpulseEvent[InitialContactCapacity];
        _impulseEventCount = 0;
        _currentPairs = new BroadPair[InitialContactCapacity];
        _currentPairCount = 0;
        _stepPairs = new BroadPair[InitialContactCapacity];
        _stepPairCount = 0;
        _disposed = 0;
    }

    /// <summary>Body registry; create and drive bodies through it.</summary>
    public BodyStore Bodies
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _bodies;
    }

    /// <summary>Shape registry; attach colliders through it.</summary>
    public ShapeStore Shapes
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _shapes;
    }

    /// <summary>Joint registry; constrain bodies through it.</summary>
    public JointStore Joints
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _joints;
    }

    /// <summary>Island solver diagnostics: completed passes and rested bodies.</summary>
    public IslandMetrics3D IslandMetrics
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _islands.Metrics;
    }

    /// <summary>Broadphase tree; the world keeps it in sync every step.</summary>
    public DynamicAabbTree<ShapeId, SurfaceAreaHeuristicStrategy, NullSpatialMetricsSink> Broadphase
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _tree;
    }

    /// <summary>Live contacts after the last step.</summary>
    public int ContactCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _contactCount;
    }

    /// <summary>Reads a tracked contact by index.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Contact3D GetContact(int index) => _contacts[index];

    /// <summary>Pair events raised by the last step.</summary>
    public int ContactEventCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _eventCount;
    }

    /// <summary>Reads a pair event by index.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ContactEvent GetContactEvent(int index) => _events[index];

    /// <summary>Trigger events raised by the last step.</summary>
    public int SensorEventCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _sensorEventCount;
    }

    /// <summary>Reads a trigger event by index.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public SensorEvent GetSensorEvent(int index) => _sensorEvents[index];

    /// <summary>Post-solve impulse notices raised by the last step.</summary>
    public int ContactImpulseEventCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _impulseEventCount;
    }

    /// <summary>Reads a post-solve impulse notice by index.</summary>
    public ContactImpulseEvent GetContactImpulseEvent(int index)
    {
        if ((uint)index >= (uint)_impulseEventCount)
        {
            ThrowHelper.ThrowInvalidOperation("Impulse event index is out of range.");
        }

        return _impulseEvents[index];
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private bool IsShapeQueryable(ref ShapeRecord record, in QueryFilter filter)
    {
        if ((record.Filter.Group != 0 || record.Filter.Category != 0) && !QueryFilter.Matches(in record.Filter, in filter))
        {
            return false;
        }

        return _bodies.IsEnabled(record.Body);
    }

    /// <summary>Casts a ray against filtered shapes; hits sort by ascending distance.</summary>
    /// <param name="ray">The ray.</param>
    /// <param name="maxDistance">The furthest hit kept.</param>
    /// <param name="hits">The destination; truncated when full.</param>
    /// <param name="filter">Query pruning; unset fields accept everything.</param>
    /// <returns>The hits written.</returns>
    public int Raycast(in Ray3D ray, float maxDistance, Span<RaycastHit3D> hits, in QueryFilter filter = default)
    {
        ThrowIfDisposed();

        Span<RayHit> candidates = stackalloc RayHit[128];
        int candidateCount = Math.Min(_tree.RayCast(in ray, candidates, maxDistance), candidates.Length);

        int written = 0;
        for (int i = 0; i < candidateCount; i++)
        {
            ShapeId shapeId = _tree.GetUserData(candidates[i].ItemId);
            if (!_shapes.IsValid(shapeId))
            {
                continue;
            }

            ref ShapeRecord record = ref _shapes.Record(shapeId);
            if (!IsShapeQueryable(ref record, in filter))
            {
                continue;
            }

            bool struck;
            float distance;
            Vec3 normal;
            if (record.Kind == ColliderKind.Sphere)
            {
                Sphere3 world = _shapes.GetWorldSphere(shapeId);
                struck = ShapeRaycast3D.RaySphere(in ray, maxDistance, in world, out distance, out normal);
            }
            else if (record.Kind == ColliderKind.Capsule)
            {
                Capsule3 world = _shapes.GetWorldCapsule(shapeId);
                struck = ShapeRaycast3D.RayCapsule(in ray, maxDistance, in world, out distance, out normal);
            }
            else if (record.Kind == ColliderKind.Mesh)
            {
                Mesh3D local = _shapes.GetMesh(shapeId);
                RigidTransform3D frame = _shapes.GetWorldFrame(shapeId);
                struck = ShapeRaycast3D.RayMesh(in ray, maxDistance, in local, frame, out distance, out normal);
            }
            else if (record.Kind == ColliderKind.Hull)
            {
                Hull3D local = _shapes.GetHull(shapeId);
                RigidTransform3D frame = _shapes.GetWorldFrame(shapeId);
                var world = new OrientedShape<Hull3D>(local, frame);
                struck = ShapeRaycast3D.RaySupport(in ray, maxDistance, in world, out distance, out normal);
            }
            else if (record.Kind == ColliderKind.Heightfield)
            {
                Heightfield3D local = _shapes.GetHeightfield(shapeId);
                RigidTransform3D frame = _shapes.GetWorldFrame(shapeId);
                var world = new OrientedShape<Heightfield3D>(local, frame);
                struck = ShapeRaycast3D.RaySupport(in ray, maxDistance, in world, out distance, out normal);
            }
            else if (record.Kind == ColliderKind.Cylinder)
            {
                Cylinder3 local = _shapes.GetCylinder(shapeId);
                RigidTransform3D frame = _shapes.GetWorldFrame(shapeId);
                var world = new OrientedShape<Cylinder3>(local, frame);
                struck = ShapeRaycast3D.RaySupport(in ray, maxDistance, in world, out distance, out normal);
            }
            else if (record.Kind == ColliderKind.Cone)
            {
                Cone3 local = _shapes.GetCone(shapeId);
                RigidTransform3D frame = _shapes.GetWorldFrame(shapeId);
                var world = new OrientedShape<Cone3>(local, frame);
                struck = ShapeRaycast3D.RaySupport(in ray, maxDistance, in world, out distance, out normal);
            }
            else
            {
                Box3 local = record.LocalBox;
                RigidTransform3D frame = _shapes.GetWorldFrame(shapeId);
                var world = new Box3(frame.TransformPoint(local.Center), local.HalfExtents);
                struck = ShapeRaycast3D.RayBox(in ray, maxDistance, in world, frame, out distance, out normal);
            }

            if (!struck)
            {
                continue;
            }

            var hit = new RaycastHit3D(shapeId, record.Body, ray.Origin + (ray.Direction * distance), normal, distance);
            if (written == hits.Length)
            {
                if (hits.Length == 0 || distance >= hits[written - 1].Distance)
                {
                    continue;
                }

                written--;
            }

            int slot = written;
            while (slot > 0 && hits[slot - 1].Distance > distance)
            {
                hits[slot] = hits[slot - 1];
                slot--;
            }

            hits[slot] = hit;
            written++;
        }

        return written;
    }

    /// <summary>Collects the filtered shapes overlapping a volume; ids sort ascending.</summary>
    /// <param name="box">The query volume.</param>
    /// <param name="results">The destination; truncated when full.</param>
    /// <param name="filter">Query pruning; unset fields accept everything.</param>
    /// <returns>The shapes written.</returns>
    public int OverlapAabb(in Aabb3D box, Span<ShapeId> results, in QueryFilter filter = default)
    {
        ThrowIfDisposed();

        Span<SpatialItemId> candidates = stackalloc SpatialItemId[128];
        int candidateCount = Math.Min(_tree.QueryOverlaps(in box, candidates), candidates.Length);

        int written = 0;
        for (int i = 0; i < candidateCount; i++)
        {
            ShapeId shapeId = _tree.GetUserData(candidates[i]);
            if (!_shapes.IsValid(shapeId))
            {
                continue;
            }

            ref ShapeRecord record = ref _shapes.Record(shapeId);
            if (!IsShapeQueryable(ref record, in filter))
            {
                continue;
            }

            if (written == results.Length)
            {
                if (results.Length == 0 || shapeId > results[written - 1])
                {
                    continue;
                }

                written--;
            }

            int slot = written;
            while (slot > 0 && results[slot - 1] > shapeId)
            {
                results[slot] = results[slot - 1];
                slot--;
            }

            results[slot] = shapeId;
            written++;
        }

        return written;
    }

    /// <summary>Casts a ray and returns only the closest filtered hit.</summary>
    /// <param name="ray">The ray.</param>
    /// <param name="maxDistance">The furthest hit kept.</param>
    /// <param name="hit">The closest hit when one exists.</param>
    /// <param name="filter">Query pruning; unset fields accept everything.</param>
    /// <returns><see langword="true"/> when anything was hit.</returns>
    public bool RaycastClosest(in Ray3D ray, float maxDistance, out RaycastHit3D hit, in QueryFilter filter = default)
    {
        Span<RaycastHit3D> buffer = stackalloc RaycastHit3D[128];
        if (Raycast(in ray, maxDistance, buffer, in filter) == 0)
        {
            hit = default;
            return false;
        }

        hit = buffer[0];
        return true;
    }

    /// <summary>Finds the filtered surface points nearest a query; hits sort by ascending distance.</summary>
    /// <param name="point">The query point.</param>
    /// <param name="maxDistance">The furthest surface kept.</param>
    /// <param name="hits">The destination; truncated when full.</param>
    /// <param name="filter">Query pruning; unset fields accept everything.</param>
    /// <returns>The hits written.</returns>
    public int QueryPoint(Vec3 point, float maxDistance, Span<ClosestPointHit3D> hits, in QueryFilter filter = default)
    {
        ThrowIfDisposed();

        if (!(maxDistance >= 0.0f) || float.IsNaN(maxDistance))
        {
            ThrowHelper.ThrowInvalidOperation("Query distance must not be negative.");
        }

        var margin = new Vec3(maxDistance, maxDistance, maxDistance);
        var volume = new Aabb3D(point - margin, point + margin);

        Span<SpatialItemId> candidates = stackalloc SpatialItemId[128];
        int candidateCount = Math.Min(_tree.QueryOverlaps(volume, candidates), candidates.Length);

        var probe = new Sphere3(point, 0.0f);
        int written = 0;
        for (int i = 0; i < candidateCount; i++)
        {
            ShapeId shapeId = _tree.GetUserData(candidates[i]);
            if (!_shapes.IsValid(shapeId))
            {
                continue;
            }

            ref ShapeRecord record = ref _shapes.Record(shapeId);
            if (!IsShapeQueryable(ref record, in filter))
            {
                continue;
            }

            AnyCollider collider = AnyCollider.FromRecord(in _shapes.Record(shapeId), _shapes.GetWorldFrame(shapeId));
            bool separated = Gjk3D.ComputeDistance(probe, collider, out float distance, out _, out Vec3 surface);
            Vec3 hitPoint;
            float hitDistance;
            if (!separated)
            {
                hitPoint = point;
                hitDistance = 0.0f;
            }
            else
            {
                if (distance > maxDistance)
                {
                    continue;
                }

                hitPoint = surface;
                hitDistance = distance;
            }

            var found = new ClosestPointHit3D(shapeId, _shapes.GetBody(shapeId), hitPoint, hitDistance);
            if (written == hits.Length)
            {
                if (hits.Length == 0 || distance >= hits[written - 1].Distance)
                {
                    continue;
                }

                written--;
            }

            int slot = written;
            while (slot > 0 && hits[slot - 1].Distance > distance)
            {
                hits[slot] = hits[slot - 1];
                slot--;
            }

            hits[slot] = found;
            written++;
        }

        return written;
    }

    /// <summary>Rebases the world by an offset for floating-origin rendering; exact translation.</summary>
    /// <param name="offset">Subtracted from every body position.</param>
    public void ShiftOrigin(Vec3 offset)
    {
        ThrowIfDisposed();

        for (int slot = 0; slot < _bodies.SlotCapacity; slot++)
        {
            if (!_bodies.IsSlotLive(slot))
            {
                continue;
            }

            BodyId bodyId = BodyId.FromIndex(slot);
            ref BodyState body = ref _bodies.Slot(bodyId);
            body.Position -= offset;
            _shapes.SyncBody(_bodies, _tree, bodyId);
        }
    }

    /// <summary>Rebuilds a body's mass properties from its attached shapes, shifting the frame so the world center of mass stays put.</summary>
    /// <param name="bodyId">The body to recompute.</param>
    public void ResetMassData(BodyId bodyId)
    {
        ThrowIfDisposed();

        ref BodyState body = ref _bodies.Slot(bodyId);
        Vec3 previousCenter = body.Position + (body.Rotation * body.LocalCenter);
        _shapes.RecalculateMass(_bodies, bodyId);
        body.Position += previousCenter - (body.Position + (body.Rotation * body.LocalCenter));
        _shapes.SyncBody(_bodies, _tree, bodyId);
    }

    /// <summary>Zeroes accumulated forces and torques on every body.</summary>
    public void ClearForces()
    {
        ThrowIfDisposed();

        _bodies.ClearForces();
    }

    /// <summary>Wakes every live dynamic body.</summary>
    public void WakeAllBodies()
    {
        ThrowIfDisposed();

        _bodies.WakeAllBodies();
    }

    /// <summary>Reads population counters for diagnostics.</summary>
    public WorldStatistics3D GetStatistics()
    {
        ThrowIfDisposed();

        int sleeping = 0;
        for (int slot = 0; slot < _bodies.SlotCapacity; slot++)
        {
            if (!_bodies.IsSlotLive(slot))
            {
                continue;
            }

            BodyId bodyId = BodyId.FromIndex(slot);
            if (_bodies.GetType(bodyId) == BodyType.Dynamic && _bodies.IsSleeping(bodyId))
            {
                sleeping++;
            }
        }

        return new WorldStatistics3D(_bodies.Count, _shapes.Count, _joints.Count, _contactCount, sleeping);
    }

    /// <summary>Walks the reference graph and reports whether every shape, joint and contact names live entities.</summary>
    public bool Validate()
    {
        ThrowIfDisposed();

        for (int slot = 0; slot < _bodies.SlotCapacity; slot++)
        {
            if (!_bodies.IsSlotLive(slot))
            {
                continue;
            }

            ref BodyState body = ref _bodies.Slot(BodyId.FromIndex(slot));
            int current = body.FirstShape;
            while (current != -1)
            {
                ShapeId shapeId = ShapeId.FromIndex(current);
                if (!_shapes.IsValid(shapeId) || _shapes.GetBody(shapeId) != BodyId.FromIndex(slot))
                {
                    return false;
                }

                current = _shapes.Record(shapeId).NextShape;
            }
        }

        for (int slot = 0; slot < _joints.HingeCapacity; slot++)
        {
            ref HingeJointData hinge = ref _joints.Hinge(slot);
            if (hinge.Live && (!_bodies.IsValid(hinge.BodyA) || !_bodies.IsValid(hinge.BodyB)))
            {
                return false;
            }
        }

        for (int slot = 0; slot < _joints.PrismaticCapacity; slot++)
        {
            ref PrismaticJointData prismatic = ref _joints.Prismatic(slot);
            if (prismatic.Live && (!_bodies.IsValid(prismatic.BodyA) || !_bodies.IsValid(prismatic.BodyB)))
            {
                return false;
            }
        }

        for (int i = 0; i < _contactCount; i++)
        {
            if (!_bodies.IsValid(_contacts[i].BodyA) || !_bodies.IsValid(_contacts[i].BodyB)
                || !_shapes.IsValid(_contacts[i].ShapeA) || !_shapes.IsValid(_contacts[i].ShapeB))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>Advances the simulation by <paramref name="dt"/> seconds; the built-in sink records post-solve impulse notices on the last slice.</summary>
    public void Step(float dt)
    {
        ThrowIfDisposed();

        if (!(dt > 0.0f) || float.IsNaN(dt))
        {
            ThrowHelper.ThrowInvalidOperation("Time step must be positive.");
        }

        int slices = CcdSliceCount(dt);
        float h = dt / slices;

        _eventCount = 0;
        _sensorEventCount = 0;
        _impulseEventCount = 0;
        SnapshotStepPairs();

        for (int slice = 0; slice < slices; slice++)
        {
            StepSlice(h, emitImpulseNotices: slice == slices - 1);
        }

        UpdateIslands(dt);
        PublishContactEvents();
    }

    /// <summary>
    /// Advances the world like <see cref="Step(float)"/> and emits the pre-solve
    /// and post-solve callback points through <paramref name="handler"/>; the
    /// callbacks fire once per step (pre-solve at the first CCD slice's constraint
    /// init, post-solve after the last slice's velocity sweeps). Static-abstract
    /// dispatch: no delegates, no boxing, no allocation.
    /// </summary>
    /// <param name="dt">Time advance; strictly positive.</param>
    /// <param name="handler">Callback surface; see <see cref="IContactSolverCallbacks{TContact, TManifold, TContext}"/>.</param>
    /// <param name="context">Caller state the handler may read and write.</param>
    /// <typeparam name="THandler">Callback surface type; static-abstract dispatch.</typeparam>
    /// <typeparam name="TContext">Caller state; may be a <see langword="ref"/> struct.</typeparam>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void Step<THandler, TContext>(float dt, THandler handler, ref TContext context)
        where THandler : IContactSolverCallbacks<Contact3D, Manifold3D, TContext>
        where TContext : allows ref struct
    {
        ThrowIfDisposed();

        if (!(dt > 0.0f) || float.IsNaN(dt))
        {
            ThrowHelper.ThrowInvalidOperation("Time step must be positive.");
        }

        int slices = CcdSliceCount(dt);
        float h = dt / slices;

        _eventCount = 0;
        _sensorEventCount = 0;
        _impulseEventCount = 0;
        SnapshotStepPairs();

        for (int slice = 0; slice < slices; slice++)
        {
            StepSliceCallback(h, slice == 0, slice == slices - 1, handler, ref context);
        }

        UpdateIslands(dt);
        PublishContactEvents();
    }

    /// <summary>
    /// Destroys a body and its shapes, pulling each shape from the
    /// broadphase and dropping tracked pairs that named them. Destroying
    /// bodies through the raw store orphans tree items; prefer this path.
    /// </summary>
    public void DestroyBody(BodyId bodyId)
    {
        ThrowIfDisposed();

        _joints.DestroyJointsOfBody(bodyId);

        ref BodyState body = ref _bodies.Slot(bodyId);
        int current = body.FirstShape;
        while (current != -1)
        {
            ShapeId shapeId = ShapeId.FromIndex(current);
            int next = _shapes.Record(shapeId).NextShape;
            _shapes.Detach(_bodies, _tree, shapeId);
            current = next;
        }

        int kept = 0;
        for (int i = 0; i < _contactCount; i++)
        {
            if (_contacts[i].BodyA != bodyId && _contacts[i].BodyB != bodyId)
            {
                _contacts[kept++] = _contacts[i];
            }
        }

        _contactCount = kept;
        _bodies.Destroy(bodyId);
    }

    /// <summary>Tears down the broadphase tree; the world is unusable afterwards.</summary>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        _tree.Dispose();
    }

    /// <summary>Canonical shape pair, ordered by raw identity.</summary>
    private readonly record struct BroadPair(ShapeId First, ShapeId Second);

    /// <summary>Collects broadphase pairs into the world's pair buffer.</summary>
    private struct PairCollector : IPairVisitor<ShapeId, World>
    {
        public bool OnPair(SpatialItemId idA, ShapeId dataA, SpatialItemId idB, ShapeId dataB, ref World context)
        {
            ShapeId first = dataA.RawValue <= dataB.RawValue ? dataA : dataB;
            ShapeId second = dataA.RawValue <= dataB.RawValue ? dataB : dataA;

            if (context._currentPairCount >= context._currentPairs.Length)
            {
                Array.Resize(ref context._currentPairs, context._currentPairs.Length * 2);
            }

            context._currentPairs[context._currentPairCount++] = new BroadPair(first, second);
            return true;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void StepSlice(float h, bool emitImpulseNotices)
    {
        _bodies.IntegrateVelocities(h, Gravity, AutoClearForces);
        SyncAwakeBodies();

        Contact3D[] built = _previous;
        _previous = _contacts;
        _previousCount = _contactCount;
        _contacts = built;
        _contactCount = 0;
        _currentPairCount = 0;

        var collector = new PairCollector();
        World self = this;
        _tree.FindPairs(ref collector, ref self);

        for (int i = 0; i < _currentPairCount; i++)
        {
            BroadPair pair = _currentPairs[i];
            if (TryBuildContact(pair.First, pair.Second, out Contact3D contact))
            {
                if (_contactCount >= _contacts.Length)
                {
                    Array.Resize(ref _contacts, _contacts.Length * 2);
                }

                _contacts[_contactCount++] = contact;
            }
        }

        for (int i = 0; i < _contactCount; i++)
        {
            bool matched = false;
            for (int j = 0; j < _previousCount; j++)
            {
                if (_previous[j].ShapeA == _contacts[i].ShapeA && _previous[j].ShapeB == _contacts[i].ShapeB)
                {
                    WarmStart(ref _contacts[i], in _previous[j]);
                    matched = true;
                    break;
                }
            }

            if (!matched)
            {
                WakePair(_contacts[i].BodyA, _contacts[i].BodyB);
            }
        }

        ContactSolver.InitVelocityConstraints(_bodies, _shapes, _contacts.AsSpan(0, _contactCount));
        ContactSolver.SolveVelocityPass(_bodies, _shapes, _contacts.AsSpan(0, _contactCount), VelocityIterations);
        JointSolver.SolveSpringPass(_bodies, _joints, h);

        for (int iteration = 0; iteration < VelocityIterations; iteration++)
        {
            JointSolver.SolveVelocityPass(_bodies, _joints, h);
        }

        if (emitImpulseNotices)
        {
            NoSolveState unusedState;
            ImpulseNoticeContext notices = new(this);
            ContactSolver.ReportPostSolve(_contacts.AsSpan(0, _contactCount), ref notices, ref unusedState);
        }

        _bodies.IntegratePositions(h);
        SyncAwakeBodies();

        ContactSolver.SolvePositions(_bodies, _contacts.AsSpan(0, _contactCount), PositionIterations);
        JointSolver.SolvePositionPass(_bodies, _joints);
    }

    /// <summary>Carries previous impulses into matching points by feature id.</summary>
    private static void WarmStart(ref Contact3D current, in Contact3D previous)
    {
        Manifold3D manifold = current.Manifold;
        Manifold3D old = previous.Manifold;
        for (int p = 0; p < manifold.Count; p++)
        {
            ContactPoint3D point = manifold[p];
            for (int q = 0; q < old.Count; q++)
            {
                ContactPoint3D carried = old[q];
                if (carried.Id == point.Id)
                {
                    ContactPoint3D updated = point;
                    updated.NormalImpulse = carried.NormalImpulse;
                    updated.TangentImpulse1 = carried.TangentImpulse1;
                    updated.TangentImpulse2 = carried.TangentImpulse2;
                    manifold.SetPoint(p, updated);
                    break;
                }
            }
        }

        current.Manifold = manifold;
    }

    /// <summary>Builds a contact from a broadphase pair; filters and narrowphase run here.</summary>
    private bool TryBuildContact(ShapeId shapeA, ShapeId shapeB, out Contact3D contact)
    {
        contact = default;
        if (!_shapes.IsValid(shapeA) || !_shapes.IsValid(shapeB))
        {
            return false;
        }

        ref ShapeRecord recordA = ref _shapes.Record(shapeA);
        ref ShapeRecord recordB = ref _shapes.Record(shapeB);
        if (recordA.Body == recordB.Body)
        {
            return false;
        }

        ref BodyState stateA = ref _bodies.Slot(recordA.Body);
        ref BodyState stateB = ref _bodies.Slot(recordB.Body);
        if (stateA.Type == BodyType.Static && stateB.Type == BodyType.Static)
        {
            return false;
        }

        if ((stateA.Flags & BodyFlags.Active) == 0 || (stateB.Flags & BodyFlags.Active) == 0)
        {
            return false;
        }

        if (!CollisionFilter.ShouldCollide(in recordA.Filter, in recordB.Filter))
        {
            return false;
        }

        // Curved prisms, hulls, meshes, heightfields and everything touching
        // them resolve through EPA over oriented supports; analytic rows above
        // already handled the rest.
        if (recordA.Kind is ColliderKind.Cylinder or ColliderKind.Cone
            or ColliderKind.Hull or ColliderKind.Mesh or ColliderKind.Heightfield
            || recordB.Kind is ColliderKind.Cylinder or ColliderKind.Cone
            or ColliderKind.Hull or ColliderKind.Mesh or ColliderKind.Heightfield)
        {
            AnyCollider colliderA = AnyCollider.FromRecord(in recordA, _shapes.GetWorldFrame(shapeA));
            AnyCollider colliderB = AnyCollider.FromRecord(in recordB, _shapes.GetWorldFrame(shapeB));
            if (!Epa3D.ComputePenetration(colliderA, colliderB, out Manifold3D epa))
            {
                return false;
            }

            contact = new Contact3D
            {
                BodyA = recordA.Body,
                BodyB = recordB.Body,
                ShapeA = shapeA,
                ShapeB = shapeB,
                IsSensor = recordA.IsSensor || recordB.IsSensor,
                Manifold = epa,
            };
            return true;
        }

        if (!EvaluateNarrowphase(shapeA, in recordA, shapeB, in recordB, out Manifold3D rest))
        {
            return false;
        }

        contact = new Contact3D
        {
            BodyA = recordA.Body,
            BodyB = recordB.Body,
            ShapeA = shapeA,
            ShapeB = shapeB,
            IsSensor = recordA.IsSensor || recordB.IsSensor,
            Manifold = rest,
        };
        return true;
    }

    /// <summary>Dispatches the pair to the typed narrowphase by collider kinds.</summary>
    private bool EvaluateNarrowphase(
        ShapeId shapeA, in ShapeRecord recordA,
        ShapeId shapeB, in ShapeRecord recordB,
        out Manifold3D manifold)
    {
        if (recordA.Kind == ColliderKind.Sphere && recordB.Kind == ColliderKind.Sphere)
        {
            Sphere3 worldA = _shapes.GetWorldSphere(shapeA);
            Sphere3 worldB = _shapes.GetWorldSphere(shapeB);
            return Penetration3D.SphereSphere(in worldA, in worldB, out manifold);
        }

        if (recordA.Kind == ColliderKind.Capsule && recordB.Kind == ColliderKind.Capsule)
        {
            Capsule3 worldA = _shapes.GetWorldCapsule(shapeA);
            Capsule3 worldB = _shapes.GetWorldCapsule(shapeB);
            return Penetration3D.CapsuleCapsule(in worldA, in worldB, out manifold);
        }

        if (recordA.Kind == ColliderKind.Capsule && recordB.Kind == ColliderKind.Sphere)
        {
            Capsule3 worldCapsule = _shapes.GetWorldCapsule(shapeA);
            Sphere3 worldSphere = _shapes.GetWorldSphere(shapeB);
            return Penetration3D.CapsuleSphere(in worldCapsule, in worldSphere, out manifold);
        }

        if (recordA.Kind == ColliderKind.Sphere && recordB.Kind == ColliderKind.Capsule)
        {
            Capsule3 worldCapsule = _shapes.GetWorldCapsule(shapeB);
            Sphere3 worldSphere = _shapes.GetWorldSphere(shapeA);
            bool hit = Penetration3D.CapsuleSphere(in worldCapsule, in worldSphere, out manifold);
            if (hit)
            {
                FlipManifold(ref manifold);
            }

            return hit;
        }

        if (recordA.Kind == ColliderKind.Capsule && recordB.Kind == ColliderKind.Box)
        {
            Capsule3 worldCapsule = _shapes.GetWorldCapsule(shapeA);
            Box3 localBox = recordB.LocalBox;
            RigidTransform3D boxFrame = _shapes.GetWorldFrame(shapeB);
            return Penetration3D.CapsuleBox(in worldCapsule, in localBox, boxFrame, out manifold);
        }

        if (recordA.Kind == ColliderKind.Box && recordB.Kind == ColliderKind.Capsule)
        {
            Capsule3 worldCapsule = _shapes.GetWorldCapsule(shapeB);
            Box3 localBox = recordA.LocalBox;
            RigidTransform3D boxFrame = _shapes.GetWorldFrame(shapeA);
            bool hit = Penetration3D.CapsuleBox(in worldCapsule, in localBox, boxFrame, out manifold);
            if (hit)
            {
                FlipManifold(ref manifold);
            }

            return hit;
        }

        if (recordA.Kind == ColliderKind.Sphere)
        {
            Sphere3 worldSphere = _shapes.GetWorldSphere(shapeA);
            Box3 localBox = recordB.LocalBox;
            RigidTransform3D boxFrame = _shapes.GetWorldFrame(shapeB);
            return Penetration3D.SphereBox(in worldSphere, in localBox, boxFrame, out manifold);
        }

        if (recordB.Kind == ColliderKind.Sphere)
        {
            Sphere3 worldSphere = _shapes.GetWorldSphere(shapeB);
            Box3 localBox = recordA.LocalBox;
            RigidTransform3D boxFrame = _shapes.GetWorldFrame(shapeA);
            bool hit = Penetration3D.SphereBox(in worldSphere, in localBox, boxFrame, out manifold);
            if (hit)
            {
                FlipManifold(ref manifold);
            }

            return hit;
        }

        Box3 localA = recordA.LocalBox;
        RigidTransform3D frameA = _shapes.GetWorldFrame(shapeA);
        Box3 localB = recordB.LocalBox;
        RigidTransform3D frameB = _shapes.GetWorldFrame(shapeB);
        return Penetration3D.BoxBox(in localA, frameA, in localB, frameB, out manifold);
    }

    /// <summary>Swaps a manifold so the normal points from B toward A after a flipped dispatch.</summary>
    private static void FlipManifold(ref Manifold3D manifold)
    {
        manifold.Normal = manifold.Normal * -1.0f;
        for (int p = 0; p < manifold.Count; p++)
        {
            ContactPoint3D point = manifold[p];
            (point.PositionA, point.PositionB) = (point.PositionB, point.PositionA);
            manifold.SetPoint(p, point);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void SyncAwakeBodies()
    {
        for (int slot = 0; slot < _bodies.SlotCapacity; slot++)
        {
            if (!_bodies.IsSlotLive(slot))
            {
                continue;
            }

            BodyId bodyId = BodyId.FromIndex(slot);
            ref BodyState body = ref _bodies.Slot(bodyId);
            if (body.Type == BodyType.Static || (body.Flags & (BodyFlags.Awake | BodyFlags.Active)) != (BodyFlags.Awake | BodyFlags.Active))
            {
                continue;
            }

            _shapes.SyncBody(_bodies, _tree, bodyId);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void WakePair(BodyId bodyA, BodyId bodyB)
    {
        ref BodyState stateA = ref _bodies.Slot(bodyA);
        ref BodyState stateB = ref _bodies.Slot(bodyB);

        if (stateA.Type == BodyType.Dynamic && (stateA.Flags & BodyFlags.Awake) == 0)
        {
            _bodies.SetAwake(bodyA, true);
        }

        if (stateB.Type == BodyType.Dynamic && (stateB.Flags & BodyFlags.Awake) == 0)
        {
            _bodies.SetAwake(bodyB, true);
        }
    }

    /// <summary>Counts the slices so no awake bullet outruns <see cref="CcdSweepStep"/> in one slice.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private int CcdSliceCount(float dt)
    {
        float furthest = 0.0f;

        for (int slot = 0; slot < _bodies.SlotCapacity; slot++)
        {
            if (!_bodies.IsSlotLive(slot))
            {
                continue;
            }

            BodyId bodyId = BodyId.FromIndex(slot);
            ref readonly BodyState body = ref _bodies.Slot(bodyId);
            if (body.Type != BodyType.Dynamic || (body.Flags & BodyFlags.Awake) == 0 ||
                (body.Flags & BodyFlags.Bullet) == 0)
            {
                continue;
            }

            float travel = body.LinearVelocity.Length() * dt;
            if (travel > furthest)
            {
                furthest = travel;
            }

            float spin = body.AngularVelocity.Length() * BulletRadius(in body) * dt;
            if (spin > furthest)
            {
                furthest = spin;
            }
        }

        if (furthest <= CcdSweepStep)
        {
            return 1;
        }

        int slices = (int)MathF.Ceiling(furthest / CcdSweepStep);
        return Math.Clamp(slices, 1, MaxCcdSubsteps);
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private float BulletRadius(in BodyState body)
    {
        float radius = 0.0f;
        int current = body.FirstShape;
        while (current != -1)
        {
            ShapeId shapeId = ShapeId.FromIndex(current);
            if (!_shapes.IsValid(shapeId))
            {
                break;
            }

            Aabb3D box = _shapes.GetWorldAabb(shapeId);
            Vec3 extents = box.Extents;
            float halfDiagonal = extents.Length();
            float off = (box.Center - body.Position).Length();
            float far = halfDiagonal + off;
            if (far > radius)
            {
                radius = far;
            }

            current = _shapes.Record(shapeId).NextShape;
        }

        return radius;
    }

    /// <summary>Snapshots the step-open contact pairs for event diffing.</summary>
    private void SnapshotStepPairs()
    {
        if (_stepPairs.Length < _contactCount)
        {
            Array.Resize(ref _stepPairs, _contactCount * 2);
        }

        for (int i = 0; i < _contactCount; i++)
        {
            _stepPairs[i] = new BroadPair(_contacts[i].ShapeA, _contacts[i].ShapeB);
        }

        _stepPairCount = _contactCount;
    }

    /// <summary>Runs the island sleep pass over the contact and joint graph.</summary>
    private void UpdateIslands(float dt)
    {
        if ((Flags & SolverFlags.SleepingBodies) == 0)
        {
            return;
        }

        var parameters = new SimulationParameters3D(dt, TimeToSleep, LinearSleepTolerance, AngularSleepTolerance);

        ContactPair3D[] rentedContacts = _contactCount > 0
            ? ArrayPool<ContactPair3D>.Shared.Rent(_contactCount)
            : [];
        for (int i = 0; i < _contactCount; i++)
        {
            rentedContacts[i] = new ContactPair3D(_contacts[i].BodyA, _contacts[i].BodyB);
        }

        int jointBudget = _joints.Count;
        JointPair3D[] rentedJoints = jointBudget > 0
            ? ArrayPool<JointPair3D>.Shared.Rent(jointBudget)
            : [];
        int jointPairs = _joints.CopyJointPairs(rentedJoints.AsSpan(0, jointBudget));

        try
        {
            _islands.UpdateSleep(
                _bodies,
                rentedContacts.AsSpan(0, _contactCount),
                rentedJoints.AsSpan(0, jointPairs),
                in parameters);
        }
        finally
        {
            if (rentedContacts.Length > 0)
            {
                ArrayPool<ContactPair3D>.Shared.Return(rentedContacts);
            }

            if (rentedJoints.Length > 0)
            {
                ArrayPool<JointPair3D>.Shared.Return(rentedJoints);
            }
        }
    }

    /// <summary>Runs one slice with the caller's callback surface: pre-solve on the first slice, post-solve on the last.</summary>
    private void StepSliceCallback<THandler, TContext>(
        float h, bool emitPreSolve, bool emitPostSolve, THandler handler, ref TContext context)
        where THandler : IContactSolverCallbacks<Contact3D, Manifold3D, TContext>
        where TContext : allows ref struct
    {
        _bodies.IntegrateVelocities(h, Gravity, AutoClearForces);
        SyncAwakeBodies();

        Contact3D[] built = _previous;
        _previous = _contacts;
        _previousCount = _contactCount;
        _contacts = built;
        _contactCount = 0;
        _currentPairCount = 0;

        var collector = new PairCollector();
        World self = this;
        _tree.FindPairs(ref collector, ref self);

        for (int i = 0; i < _currentPairCount; i++)
        {
            BroadPair pair = _currentPairs[i];
            if (TryBuildContact(pair.First, pair.Second, out Contact3D contact))
            {
                if (_contactCount >= _contacts.Length)
                {
                    Array.Resize(ref _contacts, _contacts.Length * 2);
                }

                _contacts[_contactCount++] = contact;
            }
        }

        for (int i = 0; i < _contactCount; i++)
        {
            bool matched = false;
            for (int j = 0; j < _previousCount; j++)
            {
                if (_previous[j].ShapeA == _contacts[i].ShapeA && _previous[j].ShapeB == _contacts[i].ShapeB)
                {
                    WarmStart(ref _contacts[i], in _previous[j]);
                    matched = true;
                    break;
                }
            }

            if (!matched)
            {
                WakePair(_contacts[i].BodyA, _contacts[i].BodyB);
            }
        }

        Span<Contact3D> span = _contacts.AsSpan(0, _contactCount);
        if (emitPreSolve)
        {
            PreSolveContext<THandler, TContext> pre = new(_shapes);
            ContactSolver.InitVelocityConstraints(_bodies, _shapes, span, ref pre, ref context);
        }
        else
        {
            ContactSolver.InitVelocityConstraints(_bodies, _shapes, span);
        }

        ContactSolver.SolveVelocityPass(_bodies, _shapes, span, VelocityIterations);
        JointSolver.SolveSpringPass(_bodies, _joints, h);

        for (int iteration = 0; iteration < VelocityIterations; iteration++)
        {
            JointSolver.SolveVelocityPass(_bodies, _joints, h);
        }

        if (emitPostSolve)
        {
            PostSolveContext<THandler, TContext> post = new();
            ContactSolver.ReportPostSolve(span, ref post, ref context);
        }

        _bodies.IntegratePositions(h);
        SyncAwakeBodies();

        ContactSolver.SolvePositions(_bodies, span, PositionIterations);
        JointSolver.SolvePositionPass(_bodies, _joints);
    }

    /// <summary>Unit caller state for sink contexts that need none.</summary>
    private ref struct NoSolveState;

    /// <summary>Pre-solve sink: combines pair tuning from the materials and fires the handler.</summary>
    private readonly struct PreSolveContext<THandler, TContext>(ShapeStore shapes)
        : IContactSolveContext<Contact3D, Manifold3D, TContext>
        where THandler : IContactSolverCallbacks<Contact3D, Manifold3D, TContext>
        where TContext : allows ref struct
    {
        private readonly ShapeStore _shapes = shapes;

        public readonly ContactTuning Tune(ref readonly Contact3D contact, ref TContext context)
        {
            ref readonly ShapeRecord recordA = ref _shapes.Record(contact.ShapeA);
            ref readonly ShapeRecord recordB = ref _shapes.Record(contact.ShapeB);
            return ContactSolver.DefaultTuning(in recordA.Material, in recordB.Material);
        }

        public readonly void PreSolve(ref Contact3D contact, ref Manifold3D manifold, ref ContactTuning tuning, ref TContext context) =>
            THandler.OnPreSolve(ref contact, ref manifold, ref tuning, ref context);

        public readonly void PostSolve(ref readonly Contact3D contact, in Manifold3D manifold, in ContactImpulses impulses, ref TContext context)
        {
        }
    }

    /// <summary>Post-solve sink: forwards accumulated impulses to the handler.</summary>
    private readonly struct PostSolveContext<THandler, TContext>
        : IContactSolveContext<Contact3D, Manifold3D, TContext>
        where THandler : IContactSolverCallbacks<Contact3D, Manifold3D, TContext>
        where TContext : allows ref struct
    {
        public readonly ContactTuning Tune(ref readonly Contact3D contact, ref TContext context) => default;

        public readonly void PreSolve(ref Contact3D contact, ref Manifold3D manifold, ref ContactTuning tuning, ref TContext context)
        {
        }

        public readonly void PostSolve(ref readonly Contact3D contact, in Manifold3D manifold, in ContactImpulses impulses, ref TContext context) =>
            THandler.OnPostSolve(in contact, in manifold, in impulses, ref context);
    }

    /// <summary>Post-solve sink: records accumulated impulses as world notices.</summary>
    private readonly struct ImpulseNoticeContext(World world)
        : IContactSolveContext<Contact3D, Manifold3D, NoSolveState>
    {
        private readonly World _world = world;

        public ContactTuning Tune(ref readonly Contact3D contact, ref NoSolveState context) => default;

        public void PreSolve(ref Contact3D contact, ref Manifold3D manifold, ref ContactTuning tuning, ref NoSolveState context)
        {
        }

        public void PostSolve(ref readonly Contact3D contact, in Manifold3D manifold, in ContactImpulses impulses, ref NoSolveState context)
        {
            if (manifold.Count == 0)
            {
                return;
            }

            _world.AddImpulseEvent(
                contact.ShapeA, contact.ShapeB, contact.BodyA, contact.BodyB,
                impulses.Count, impulses.NormalAt(0), impulses.TangentAt(0),
                manifold.Count > 1 ? impulses.NormalAt(1) : 0.0f,
                manifold.Count > 1 ? impulses.TangentAt(1) : 0.0f);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void AddImpulseEvent(
        ShapeId shapeA, ShapeId shapeB, BodyId bodyA, BodyId bodyB,
        int pointCount, float normal0, float tangent0, float normal1, float tangent1)
    {
        if (_impulseEventCount >= _impulseEvents.Length)
        {
            Array.Resize(ref _impulseEvents, Math.Max(_impulseEvents.Length * 2, 1));
        }

        _impulseEvents[_impulseEventCount++] = new ContactImpulseEvent(
            shapeA, shapeB, bodyA, bodyB, pointCount, normal0, tangent0, normal1, tangent1);
    }
    /// <summary>Diffs the confirmed contact sets into begin/stay/end events.</summary>
    private void PublishContactEvents()
    {
        for (int i = 0; i < _contactCount; i++)
        {
            if (!ContainsPair(_stepPairs, _stepPairCount, _contacts[i].ShapeA, _contacts[i].ShapeB))
            {
                PushEvent(_contacts[i].ShapeA, _contacts[i].ShapeB, ContactEventType.Began);
            }
            else
            {
                PushEvent(_contacts[i].ShapeA, _contacts[i].ShapeB, ContactEventType.Stay);
            }
        }

        for (int j = 0; j < _stepPairCount; j++)
        {
            if (!ContainsPair(_contacts, _contactCount, _stepPairs[j].First, _stepPairs[j].Second))
            {
                PushEvent(_stepPairs[j].First, _stepPairs[j].Second, ContactEventType.Ended);
            }
        }
    }

    /// <summary>Whether a shape pair names a contact in the set.</summary>
    private static bool ContainsPair(Contact3D[] set, int count, ShapeId shapeA, ShapeId shapeB)
    {
        for (int i = 0; i < count; i++)
        {
            if (set[i].ShapeA == shapeA && set[i].ShapeB == shapeB)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Whether a shape pair names a pair in the set.</summary>
    private static bool ContainsPair(BroadPair[] set, int count, ShapeId shapeA, ShapeId shapeB)
    {
        for (int i = 0; i < count; i++)
        {
            if (set[i].First == shapeA && set[i].Second == shapeB)
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>Appends a pair event, growing the buffer on demand.</summary>
    private void PushEvent(ShapeId shapeA, ShapeId shapeB, ContactEventType type)
    {
        if (!_shapes.IsValid(shapeA) || !_shapes.IsValid(shapeB))
        {
            return;
        }

        if (_eventCount >= _events.Length)
        {
            Array.Resize(ref _events, _events.Length * 2);
        }

        BodyId bodyA = _shapes.GetBody(shapeA);
        BodyId bodyB = _shapes.GetBody(shapeB);
        _events[_eventCount++] = new ContactEvent(shapeA, shapeB, bodyA, bodyB, type);

        if (_shapes.IsSensor(shapeA) || _shapes.IsSensor(shapeB))
        {
            if (_sensorEventCount >= _sensorEvents.Length)
            {
                Array.Resize(ref _sensorEvents, _sensorEvents.Length * 2);
            }

            _sensorEvents[_sensorEventCount++] = new SensorEvent(
                shapeA, shapeB, bodyA, bodyB,
                type switch
                {
                    ContactEventType.Began => SensorEventType.Enter,
                    ContactEventType.Ended => SensorEventType.Exit,
                    _ => SensorEventType.Stay,
                });
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ThrowIfDisposed()
    {
        ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, nameof(World));
    }
}
