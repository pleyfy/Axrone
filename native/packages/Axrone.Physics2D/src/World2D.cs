namespace Axrone.Physics2D;

using System.Buffers;
using System.Threading;
using System.Threading.Tasks;

/// <summary>
/// Construction parameters of a world: gravity and sleep tuning. Guards live
/// in the properties, so an invalid combination is rejected at assignment.
/// </summary>
public readonly struct WorldDef
{
    /// <summary>Creates default parameters: earth-like gravity, sleeping on.</summary>
    public WorldDef()
    {
    }

    /// <summary>Gravitational acceleration; components must be finite.</summary>
    public Vec2 Gravity
    {
        get => field;
        init
        {
            if (float.IsNaN(value.X) || float.IsNaN(value.Y) || float.IsInfinity(value.X) || float.IsInfinity(value.Y))
            {
                ThrowHelper.ThrowInvalidOperation("Gravity components must be finite.");
            }

            field = value;
        }
    } = PhysicsConstants.DefaultGravity2D;

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

    /// <summary>Quiet seconds before an island sleeps; strictly positive.</summary>
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
    } = 0.25f;

    /// <summary>CCD substep cap per step; at least one.</summary>
    public int MaxCcdSubsteps
    {
        get => field;
        init
        {
            if (value < 1)
            {
                ThrowHelper.ThrowInvalidOperation("Max CCD substeps must be at least one.");
            }

            field = value;
        }
    } = 8;

    /// <summary>Solver capabilities; clearing <see cref="SolverFlags.SleepingBodies"/> skips the sleep pass.</summary>
    public SolverFlags Flags { get; init; } = SolverFlags.Default;
}

/// <summary>
/// One tracked pair: the two shapes in stable id order, their bodies, the
/// current manifold, and the warm-start cache carried across steps by contact
/// id. Mutable storage owned by <see cref="World"/>; the solver reads and
/// writes it through the world.
/// </summary>
public struct Contact : IEquatable<Contact>
{
    /// <summary>First shape; the smaller id.</summary>
    public ShapeId ShapeA { get; }

    /// <summary>Second shape; the larger id.</summary>
    public ShapeId ShapeB { get; }

    /// <summary>Body owning <see cref="ShapeA"/>.</summary>
    public BodyId BodyA { get; }

    /// <summary>Body owning <see cref="ShapeB"/>.</summary>
    public BodyId BodyB { get; }

    /// <summary>Current manifold.</summary>
    public ContactManifold Manifold { get; internal set; }

    /// <summary>Whether either shape is a trigger-only sensor.</summary>
    public bool IsSensor { get; internal set; }

    /// <summary>Warm-start store carried across steps.</summary>
    public ContactCache Cache { get; internal set; }

    /// <summary>
    /// Pair tuning for the current step: combined friction, restitution and
    /// the conveyor tangent speed, refreshed by the solver's init pass and
    /// rewritable by the pre-solve callback point.
    /// </summary>
    public ContactTuning Tuning { get; internal set; }

    internal Contact(ShapeId shapeA, ShapeId shapeB, BodyId bodyA, BodyId bodyB, in ContactManifold manifold, ContactCache cache, bool isSensor)
    {
        ShapeA = shapeA;
        ShapeB = shapeB;
        BodyA = bodyA;
        BodyB = bodyB;
        Manifold = manifold;
        IsSensor = isSensor;
        Cache = cache;
        Tuning = default;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(Contact other) =>
        ShapeA == other.ShapeA && ShapeB == other.ShapeB && Manifold.Equals(other.Manifold);

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is Contact other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => HashCode.Combine(ShapeA, ShapeB, Manifold);

    /// <summary>Determines whether two contacts track the same pair with the same manifold.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator ==(Contact left, Contact right) => left.Equals(right);

    /// <summary>Determines whether two contacts differ.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator !=(Contact left, Contact right) => !left.Equals(right);
}

/// <summary>
/// Pair lifecycle notice: a shape pair started, persisted or stopped
/// overlapping. Events accumulate across the step and clear at the start of
/// the next one; read them after <see cref="World.Step"/>. The lifecycle
/// type is the shared physics-core contract, identical to the one the 3D
/// world reports.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct ContactEvent(ShapeId ShapeA, ShapeId ShapeB, BodyId BodyA, BodyId BodyB, CollisionEventType Type);

/// <summary>
/// Trigger notice for a sensor pair: enter on first overlap, exit when the
/// overlap drops out. Events accumulate across the step and clear at the
/// start of the next one; read them after <see cref="World.Step"/>.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SensorEvent(ShapeId ShapeA, ShapeId ShapeB, BodyId BodyA, BodyId BodyB, SensorEventType Type);

/// <summary>
/// Post-solve notice for a solid pair: the impulses the solver accumulated
/// at every contact point. Notices accumulate across the step and clear at
/// the start of the next one; read them after <see cref="World.Step"/>.
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
    /// <param name="index">Point index, below <see cref="PointCount"/>.</param>
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

    /// <summary>Accumulated tangent impulse of contact point <paramref name="index"/>.</summary>
    /// <param name="index">Point index, below <see cref="PointCount"/>.</param>
    /// <returns>The tangent impulse.</returns>
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

/// <summary>Closest-point hit: the surface point nearest a query.</summary>
/// <param name="Shape">The shape hit.</param>
/// <param name="Body">The owning body.</param>
/// <param name="Point">Closest surface point in world space; the query point itself when inside.</param>
/// <param name="Distance">Distance from the query point; zero when inside.</param>
public readonly record struct ClosestPointHit2D(ShapeId Shape, BodyId Body, Vec2 Point, float Distance);

/// <summary>
/// Simulation world: owns bodies, shapes and the broadphase tree, and runs
/// the step loop — integrate, sync broadphase, collect pairs, evaluate
/// manifolds with filtering and warm-start carry. Contacts persist across
/// steps by shape-pair identity; separated pairs drop out. Disposable: tears
/// down the broadphase tree.
/// </summary>
public sealed class World : IDisposable
{
    private const int InitialContactCapacity = 16;

    private readonly BodyStore _bodies;
    private readonly ShapeStore _shapes;
    private readonly JointStore _joints;
    private readonly DynamicAabbTree2D<ShapeId, SurfaceAreaHeuristicStrategy2D, NullSpatialMetricsSink> _tree;
    private readonly IslandSolver<DefaultSleepPolicy> _islands = new();
    private Contact[] _contacts;
    private Contact[] _previous;
    private int _contactCount;
    private int _previousCount;
    private ContactEvent[] _events;
    private int _eventCount;
    private SensorEvent[] _sensorEvents;
    private int _sensorEventCount;
    private ContactImpulseEvent[] _impulseEvents;
    private int _impulseEventCount;
    private PairKey[] _lastPairs;
    private PairKey[] _currentPairs;
    private int _lastPairCount;
    private int _disposed;

    /// <summary>Gravity of the world.</summary>
    public Vec2 Gravity { get; set; }

    /// <summary>Velocity sweeps per step.</summary>
    public int VelocityIterations { get; set; }

    /// <summary>Position sweeps per step.</summary>
    public int PositionIterations { get; set; }

    /// <summary>Quiet seconds before an island sleeps.</summary>
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

    /// <summary>
    /// Whether the step clears accumulated forces and torques after
    /// integrating them into velocities. With the flag off, forces persist
    /// across steps until <see cref="ClearForces"/> runs.
    /// </summary>
    public bool AutoClearForces { get; set; } = true;

    /// <summary>Creates a world with default tuning.</summary>
    public World()
        : this(new WorldDef())
    {
    }

    /// <summary>Creates a world with fresh stores and the given tuning.</summary>
    /// <remarks>
    /// There is no optional-parameter overload taking <c>default</c>: a
    /// zeroed definition would skip the field initializers (notably
    /// gravity), so the default tuning only comes from the parameterless
    /// constructor above.
    /// </remarks>
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
        AutoClearForces = true;
        _bodies = new BodyStore();
        _shapes = new ShapeStore();
        _joints = new JointStore();
        _tree = new DynamicAabbTree2D<ShapeId, SurfaceAreaHeuristicStrategy2D, NullSpatialMetricsSink>(definition.BroadphaseOptions);
        _contacts = new Contact[InitialContactCapacity];
        _previous = new Contact[InitialContactCapacity];
        _contactCount = 0;
        _previousCount = 0;
        _events = new ContactEvent[InitialContactCapacity];
        _eventCount = 0;
        _sensorEvents = new SensorEvent[InitialContactCapacity];
        _sensorEventCount = 0;
        _impulseEvents = new ContactImpulseEvent[InitialContactCapacity];
        _impulseEventCount = 0;
        _lastPairs = new PairKey[InitialContactCapacity];
        _currentPairs = new PairKey[InitialContactCapacity];
        _lastPairCount = 0;
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
    public IslandSolverMetrics IslandMetrics
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _islands.Metrics;
    }

    /// <summary>Broadphase tree; the world keeps it in sync every step.</summary>
    public DynamicAabbTree2D<ShapeId, SurfaceAreaHeuristicStrategy2D, NullSpatialMetricsSink> Broadphase
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _tree;
    }

    /// <summary>Tracked pairs of the last step.</summary>
    public int ContactCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _contactCount;
    }

    /// <summary>Reads the tracked pair at <paramref name="index"/>.</summary>
    public Contact GetContact(int index)
    {
        if ((uint)index >= (uint)_contactCount)
        {
            ThrowHelper.ThrowInvalidOperation("Contact index is out of range.");
        }

        return _contacts[index];
    }

    /// <summary>Pair notices raised by the last step; cleared on the next one.</summary>
    public int ContactEventCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _eventCount;
    }

    /// <summary>Reads the pair notice at <paramref name="index"/>.</summary>
    public ContactEvent GetContactEvent(int index)
    {
        if ((uint)index >= (uint)_eventCount)
        {
            ThrowHelper.ThrowInvalidOperation("Contact event index is out of range.");
        }

        return _events[index];
    }

    /// <summary>Trigger notices raised by the last step; cleared on the next one.</summary>
    public int SensorEventCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _sensorEventCount;
    }

    /// <summary>Reads the trigger notice at <paramref name="index"/>.</summary>
    public SensorEvent GetSensorEvent(int index)
    {
        if ((uint)index >= (uint)_sensorEventCount)
        {
            ThrowHelper.ThrowInvalidOperation("Sensor event index is out of range.");
        }

        return _sensorEvents[index];
    }

    /// <summary>Post-solve impulse notices raised by the last step; cleared on the next one.</summary>
    public int ContactImpulseEventCount
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => _impulseEventCount;
    }

    /// <summary>Reads the post-solve impulse notice at <paramref name="index"/>.</summary>
    public ContactImpulseEvent GetContactImpulseEvent(int index)
    {
        if ((uint)index >= (uint)_impulseEventCount)
        {
            ThrowHelper.ThrowInvalidOperation("Impulse event index is out of range.");
        }

        return _impulseEvents[index];
    }

    /// <summary>
    /// Casts <paramref name="ray"/> against every shape and writes the hits
    /// into <paramref name="hits"/> in deterministic order (distance, then
    /// shape id). Sensors report like solids; the broadphase only prunes, the
    /// narrow phase decides.
    /// </summary>
    /// <param name="ray">The query ray; its direction is unit length by construction.</param>
    /// <param name="maxDistance">Travel limit; must be positive and finite.</param>
    /// <param name="hits">Destination span; excess hits are dropped once it is full.</param>
    /// <returns>Number of hits written to <paramref name="hits"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int Raycast(in Ray2D ray, float maxDistance, Span<RaycastHit2D> hits) =>
        Raycast(in ray, maxDistance, hits, QueryFilter.None);

    /// <summary>
    /// Casts <paramref name="ray"/> against the shapes that pass
    /// <paramref name="filter"/>, writing hits into <paramref name="hits"/>
    /// in deterministic order (distance, then shape id). Disabled bodies
    /// never report; a filter without a mask reports everything.
    /// </summary>
    /// <param name="ray">The query ray; its direction is unit length by construction.</param>
    /// <param name="maxDistance">Travel limit; must be positive and finite.</param>
    /// <param name="hits">Destination span; excess hits are dropped once it is full.</param>
    /// <param name="filter">Query filter; <see cref="QueryFilter.None"/> reports every shape.</param>
    /// <returns>Number of hits written to <paramref name="hits"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int Raycast(in Ray2D ray, float maxDistance, Span<RaycastHit2D> hits, in QueryFilter filter)
    {
        ThrowIfDisposed();

        if (!(maxDistance > 0.0f) || float.IsNaN(maxDistance) || float.IsInfinity(maxDistance))
        {
            ThrowHelper.ThrowInvalidOperation("Raycast distance must be positive and finite.");
        }

        if (hits.IsEmpty || _tree.Count == 0)
        {
            return 0;
        }

        RayQueryVisitor rayVisitor = default;
        RayQueryContext context = new(this, in filter, hits);
        _tree.RayCast(in ray, maxDistance, ref rayVisitor, ref context);
        SortHits(context.Written);
        return context.Written.Length;
    }

    /// <summary>
    /// Casts <paramref name="ray"/> and reports only the closest hit; sensors
    /// report like solids.
    /// </summary>
    /// <param name="ray">The query ray; its direction is unit length by construction.</param>
    /// <param name="maxDistance">Travel limit; must be positive and finite.</param>
    /// <param name="hit">The closest hit when one exists.</param>
    /// <returns><see langword="true"/> when anything was hit.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public bool RaycastClosest(in Ray2D ray, float maxDistance, out RaycastHit2D hit) =>
        RaycastClosest(in ray, maxDistance, out hit, QueryFilter.None);

    /// <summary>
    /// Casts <paramref name="ray"/> against the shapes that pass
    /// <paramref name="filter"/> and reports only the closest hit.
    /// </summary>
    /// <param name="ray">The query ray; its direction is unit length by construction.</param>
    /// <param name="maxDistance">Travel limit; must be positive and finite.</param>
    /// <param name="hit">The closest hit when one exists.</param>
    /// <param name="filter">Query filter; <see cref="QueryFilter.None"/> reports every shape.</param>
    /// <returns><see langword="true"/> when anything was hit.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public bool RaycastClosest(in Ray2D ray, float maxDistance, out RaycastHit2D hit, in QueryFilter filter)
    {
        ThrowIfDisposed();

        if (!(maxDistance > 0.0f) || float.IsNaN(maxDistance) || float.IsInfinity(maxDistance))
        {
            ThrowHelper.ThrowInvalidOperation("Raycast distance must be positive and finite.");
            hit = default;
            return false;
        }

        hit = default;
        if (_tree.Count == 0)
        {
            return false;
        }

        RaycastHit2D best = default;
        bool found = false;
        ClosestRayVisitor closestVisitor = default;
        ClosestRayContext context = new(this, in filter, ref best, ref found);
        _tree.RayCast(in ray, maxDistance, ref closestVisitor, ref context);
        hit = best;
        return found;
    }

    /// <summary>
    /// Collects the shapes whose bounds overlap <paramref name="box"/> into
    /// <paramref name="results"/> in deterministic shape-id order. Sensors
    /// report like solids.
    /// </summary>
    /// <param name="box">The query bounds.</param>
    /// <param name="results">Destination span; excess shapes are dropped once it is full.</param>
    /// <returns>Number of shapes written to <paramref name="results"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int OverlapAabb(in Aabb2D box, Span<ShapeId> results) =>
        OverlapAabb(in box, results, QueryFilter.None);

    /// <summary>
    /// Collects the shapes that pass <paramref name="filter"/> and whose
    /// bounds overlap <paramref name="box"/> into <paramref name="results"/>
    /// in deterministic shape-id order. Disabled bodies never report.
    /// </summary>
    /// <param name="box">The query bounds.</param>
    /// <param name="results">Destination span; excess shapes are dropped once it is full.</param>
    /// <param name="filter">Query filter; <see cref="QueryFilter.None"/> reports every shape.</param>
    /// <returns>Number of shapes written to <paramref name="results"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int OverlapAabb(in Aabb2D box, Span<ShapeId> results, in QueryFilter filter)
    {
        ThrowIfDisposed();

        if (results.IsEmpty || _tree.Count == 0)
        {
            return 0;
        }

        AabbQueryVisitor aabbVisitor = default;
        AabbQueryContext context = new(this, in filter, results);
        _tree.QueryOverlaps(in box, ref aabbVisitor, ref context);
        SortIds(context.Written);
        return context.Written.Length;
    }

    /// <summary>
    /// Collects the filled shapes covering <paramref name="point"/> into
    /// <paramref name="results"/> in deterministic shape-id order. Edges and
    /// chains have no interior and never contain a point; sensors report like
    /// solids.
    /// </summary>
    /// <param name="point">The query point.</param>
    /// <param name="results">Destination span; excess shapes are dropped once it is full.</param>
    /// <returns>Number of shapes written to <paramref name="results"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int QueryPoint(Vec2 point, Span<ShapeId> results) => QueryPoint(point, results, QueryFilter.None);

    /// <summary>
    /// Collects the filled shapes that pass <paramref name="filter"/> and
    /// cover <paramref name="point"/> into <paramref name="results"/> in
    /// deterministic shape-id order.
    /// </summary>
    /// <param name="point">The query point.</param>
    /// <param name="results">Destination span; excess shapes are dropped once it is full.</param>
    /// <param name="filter">Query filter; <see cref="QueryFilter.None"/> reports every shape.</param>
    /// <returns>Number of shapes written to <paramref name="results"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int QueryPoint(Vec2 point, Span<ShapeId> results, in QueryFilter filter)
    {
        ThrowIfDisposed();

        if (results.IsEmpty || _tree.Count == 0 || float.IsNaN(point.X) || float.IsNaN(point.Y))
        {
            return 0;
        }

        var volume = new Aabb2D(point, point);
        PointQueryVisitor pointVisitor = default;
        PointQueryContext context = new(this, in filter, point, results);
        _tree.QueryOverlaps(in volume, ref pointVisitor, ref context);
        SortIds(context.Written);
        return context.Written.Length;
    }

    /// <summary>
    /// Collects every filled shape covering <paramref name="point"/>,
    /// reporting each through <paramref name="report"/> in deterministic
    /// shape-id order; returning <see langword="false"/> from the callback
    /// stops the walk early.
    /// </summary>
    /// <param name="point">The query point.</param>
    /// <param name="report">Sink invoked per covering shape.</param>
    /// <param name="context">Caller state the sink may read and write.</param>
    /// <typeparam name="TVisitor">Sink type; static-abstract dispatch, no delegates.</typeparam>
    /// <typeparam name="TState">Caller state; may be a <see langword="ref"/> struct.</typeparam>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void QueryPointAll<TVisitor, TState>(Vec2 point, ref TVisitor report, ref TState context)
        where TVisitor : struct, IPointQueryVisitor<TState>
        where TState : struct, allows ref struct
    {
        ThrowIfDisposed();

        if (_tree.Count == 0 || float.IsNaN(point.X) || float.IsNaN(point.Y))
        {
            return;
        }

        var volume = new Aabb2D(point, point);
        QueryPointAllVisitor<TVisitor, TState> allPointVisitor = default;
        QueryPointAllContext<TVisitor, TState> walk = new(this, point, ref report, ref context);
        _tree.QueryOverlaps(in volume, ref allPointVisitor, ref walk);
    }

    /// <summary>
    /// Collects the shapes overlapping the world geometry of
    /// <paramref name="queryShape"/> into <paramref name="results"/> in
    /// deterministic shape-id order, using the full narrow phase — the same
    /// decision a solver would make. Sensors report like solids.
    /// </summary>
    /// <param name="queryShape">The shape whose world geometry anchors the query.</param>
    /// <param name="results">Destination span; excess shapes are dropped once it is full.</param>
    /// <returns>Number of shapes written to <paramref name="results"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int OverlapShape(ShapeId queryShape, Span<ShapeId> results) =>
        OverlapShape(queryShape, results, QueryFilter.None);

    /// <summary>
    /// Collects the shapes that pass <paramref name="filter"/> and overlap
    /// the world geometry of <paramref name="queryShape"/> into
    /// <paramref name="results"/> in deterministic shape-id order.
    /// </summary>
    /// <param name="queryShape">The shape whose world geometry anchors the query.</param>
    /// <param name="results">Destination span; excess shapes are dropped once it is full.</param>
    /// <param name="filter">Query filter; <see cref="QueryFilter.None"/> reports every shape.</param>
    /// <returns>Number of shapes written to <paramref name="results"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int OverlapShape(ShapeId queryShape, Span<ShapeId> results, in QueryFilter filter)
    {
        ThrowIfDisposed();
        ref ShapeRecord anchor = ref _shapes.Slot(queryShape);

        if (results.IsEmpty || _tree.Count == 0)
        {
            return 0;
        }

        int anchorSlot = queryShape.ToIndex();
        ShapeQueryVisitor shapeVisitor = default;
        ShapeQueryContext context = new(this, in filter, anchorSlot, results);
        _tree.QueryOverlaps(in anchor.WorldAabb, ref shapeVisitor, ref context);
        SortIds(context.Written);
        return context.Written.Length;
    }

    /// <summary>
    /// Reports the surface points of the shapes that pass
    /// <paramref name="filter"/> nearest <paramref name="point"/>, within
    /// <paramref name="maxDistance"/>, into <paramref name="hits"/> in
    /// ascending distance (then shape id). Points inside a filled shape
    /// report at distance zero with the shape's body.
    /// </summary>
    /// <param name="point">The query point.</param>
    /// <param name="maxDistance">The furthest surface kept; never negative.</param>
    /// <param name="hits">Destination span; excess hits are dropped once it is full.</param>
    /// <param name="filter">Query filter; <see cref="QueryFilter.None"/> reports every shape.</param>
    /// <returns>Number of hits written to <paramref name="hits"/>.</returns>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public int QueryPointNearest(Vec2 point, float maxDistance, Span<ClosestPointHit2D> hits, in QueryFilter filter = default)
    {
        ThrowIfDisposed();

        if (!(maxDistance >= 0.0f) || float.IsNaN(maxDistance))
        {
            ThrowHelper.ThrowInvalidOperation("Query distance must not be negative.");
        }

        if (hits.IsEmpty || _tree.Count == 0)
        {
            return 0;
        }

        var margin = new Vec2(maxDistance, maxDistance);
        var volume = new Aabb2D(point - margin, point + margin);
        NearestQueryVisitor nearestVisitor = default;
        NearestQueryContext context = new(this, in filter, point, maxDistance, hits);
        _tree.QueryOverlaps(in volume, ref nearestVisitor, ref context);
        return context.Written.Length;
    }

    /// <summary>
    /// Whether <paramref name="shapeId"/> is queryable: live, owned by an
    /// enabled body, and passing <paramref name="filter"/>.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private bool IsShapeQueryable(ShapeId shapeId, in QueryFilter filter)
    {
        ref readonly ShapeRecord record = ref _shapes.Slot(shapeId);
        BodyId owner = record.Body;
        int slot = BodyStore.SlotOf(owner);
        if (!_bodies.IsSlotLive(slot))
        {
            return false;
        }

        if (!QueryFilter.Matches(in record.Filter, in filter))
        {
            return false;
        }

        return (_bodies.Slot(owner).Flags & BodyFlags.Active) != 0;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private bool TryRaycastShape(ShapeId shapeId, in Ray2D ray, float maxDistance, out RaycastHit2D hit)
    {
        ref ShapeRecord record = ref _shapes.Slot(shapeId);

        switch (record.Kind)
        {
            case ColliderKind.Circle:
                if (ShapeRaycaster.RaycastCircle(
                    in ray, record.WorldCircle.Center, record.WorldCircle.Radius, maxDistance,
                    out float circleDistance, out Vec2 circleNormal, out Vec2 circlePoint))
                {
                    hit = new RaycastHit2D(shapeId, record.Body, circlePoint, circleNormal, circleDistance);
                    return true;
                }

                break;

            case ColliderKind.Capsule:
                if (ShapeRaycaster.RaycastCapsule(
                    in ray, record.WorldCapsule.P0, record.WorldCapsule.P1, record.WorldCapsule.Radius, maxDistance,
                    out float capsuleDistance, out Vec2 capsuleNormal, out Vec2 capsulePoint))
                {
                    hit = new RaycastHit2D(shapeId, record.Body, capsulePoint, capsuleNormal, capsuleDistance);
                    return true;
                }

                break;

            case ColliderKind.Edge:
                if (ShapeRaycaster.RaycastEdge(
                    in ray, record.WorldEdge.P0, record.WorldEdge.P1, maxDistance,
                    out float edgeDistance, out Vec2 edgeNormal, out Vec2 edgePoint))
                {
                    hit = new RaycastHit2D(shapeId, record.Body, edgePoint, edgeNormal, edgeDistance);
                    return true;
                }

                break;

            default:
                if (ShapeRaycaster.RaycastPolygon(
                    in ray, record.WorldPolygon.Vertices, record.WorldPolygon.Normals, maxDistance,
                    out float polygonDistance, out Vec2 polygonNormal, out Vec2 polygonPoint))
                {
                    hit = new RaycastHit2D(shapeId, record.Body, polygonPoint, polygonNormal, polygonDistance);
                    return true;
                }

                break;
        }

        hit = default;
        return false;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void SortHits(Span<RaycastHit2D> hits)
    {
        for (int i = 1; i < hits.Length; i++)
        {
            RaycastHit2D key = hits[i];
            int j = i - 1;
            while (j >= 0 && (hits[j].Distance > key.Distance ||
                (hits[j].Distance == key.Distance && hits[j].Shape > key.Shape)))
            {
                hits[j + 1] = hits[j];
                j--;
            }

            hits[j + 1] = key;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void SortIds(Span<ShapeId> ids)
    {
        for (int i = 1; i < ids.Length; i++)
        {
            ShapeId key = ids[i];
            int j = i - 1;
            while (j >= 0 && ids[j] > key)
            {
                ids[j + 1] = ids[j];
                j--;
            }

            ids[j + 1] = key;
        }
    }

    /// <summary>
    /// Advances the world by <paramref name="dt"/>: fast bullets transparently
    /// split the step into sweep-bounded slices so no slice moves a bullet
    /// past a thin wall; every slice integrates velocities, syncs the
    /// broadphase, collects pairs into manifolds with warm-start carry,
    /// solves velocities, integrates positions, re-syncs, and solves
    /// positions. New pairs wake sleeping dynamics. Sleep updates once per
    /// step from the final velocities.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void Step(float dt) => StepCore(dt);

    /// <summary>
    /// Advances the world like <see cref="Step"/> and emits the pre-solve and
    /// post-solve callback points through <paramref name="handler"/>; the
    /// callbacks fire once per step (pre-solve at the first CCD slice's
    /// constraint init, post-solve after the last slice's velocity sweeps).
    /// Static-abstract dispatch: no delegates, no boxing, no allocation.
    /// </summary>
    /// <param name="dt">Time advance; strictly positive.</param>
    /// <param name="handler">Callback surface; see <see cref="IContactSolverCallbacks{TContact, TManifold, TContext}"/>.</param>
    /// <param name="context">Caller state the handler may read and write.</param>
    /// <typeparam name="THandler">Callback surface type; static-abstract dispatch.</typeparam>
    /// <typeparam name="TContext">Caller state; may be a <see langword="ref"/> struct.</typeparam>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void Step<THandler, TContext>(float dt, THandler handler, ref TContext context)
        where THandler : IContactSolverCallbacks<Contact, ContactManifold, TContext>
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

        for (int slice = 0; slice < slices; slice++)
        {
            StepSliceCallback(h, slice == 0, slice == slices - 1, handler, ref context);
        }

        FinishStep(dt);
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void StepCore(float dt)
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

        for (int slice = 0; slice < slices; slice++)
        {
            StepSlice(h, emitImpulseNotices: slice == slices - 1);
        }

        FinishStep(dt);
    }

    /// <summary>
    /// Shared tail of a step: island sleep update from the final velocities,
    /// then contact, sensor and impulse notices published from the pair diff.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void FinishStep(float dt)
    {
        if ((Flags & SolverFlags.SleepingBodies) != 0)
        {
            BodyStoreAdapter adapter = new(_bodies);
            SimulationParameters parameters = new(dt, TimeToSleep, LinearSleepTolerance, AngularSleepTolerance);

            ContactPair[] rentedContacts = _contactCount > 0
                ? ArrayPool<ContactPair>.Shared.Rent(_contactCount)
                : [];
            for (int i = 0; i < _contactCount; i++)
            {
                rentedContacts[i] = new ContactPair(_contacts[i].BodyA, _contacts[i].BodyB);
            }

            int jointBudget = _joints.Count;
            JointPair[] rentedJoints = jointBudget > 0
                ? ArrayPool<JointPair>.Shared.Rent(jointBudget)
                : [];
            int jointPairs = _joints.CopyJointPairs(rentedJoints.AsSpan(0, jointBudget));

            try
            {
                _islands.UpdateSleep(
                    ref adapter,
                    rentedContacts.AsSpan(0, _contactCount),
                    rentedJoints.AsSpan(0, jointPairs),
                    in parameters);
            }
            finally
            {
                if (rentedContacts.Length > 0)
                {
                    ArrayPool<ContactPair>.Shared.Return(rentedContacts);
                }

                if (rentedJoints.Length > 0)
                {
                    ArrayPool<JointPair>.Shared.Return(rentedJoints);
                }
            }
        }

        PublishContactEvents();
    }

    /// <summary>
    /// Counts the slices so no awake bullet moves past
    /// <see cref="CcdSweepStep"/> in one slice. Translation uses the body
    /// velocity, spin uses angular velocity times the furthest shape extent,
    /// and two opposing bullets use their closing speed, so bullet-vs-bullet
    /// head-ons split like bullet-vs-wall.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private int CcdSliceCount(float dt)
    {
        float furthest = 0.0f;
        float fastest = 0.0f;
        float second = 0.0f;

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

            float travel = MathF.Sqrt(body.LinearVelocity.LengthSquared()) * dt;
            if (travel > furthest)
            {
                furthest = travel;
            }

            if (travel >= fastest)
            {
                second = fastest;
                fastest = travel;
            }
            else if (travel > second)
            {
                second = travel;
            }

            float spin = MathF.Abs(body.AngularVelocity) * BulletRadius(in body) * dt;
            if (spin > furthest)
            {
                furthest = spin;
            }
        }

        float closing = fastest + second;
        if (closing > furthest)
        {
            furthest = closing;
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

            Aabb2D box = _shapes.GetWorldAabb(shapeId);
            Vec2 extents = box.Extents;
            float halfDiagonal = MathF.Sqrt(extents.LengthSquared());
            float offSq = (box.Center - body.Position).LengthSquared();
            float far = halfDiagonal + MathF.Sqrt(offSq);
            if (far > radius)
            {
                radius = far;
            }

            current = _shapes.Slot(shapeId).NextShape;
        }

        return radius;
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void StepSlice(float h, bool emitImpulseNotices)
    {
        _bodies.IntegrateVelocities(h, Gravity, AutoClearForces);
        SyncAwakeBodies();
        CollectPairs();

        ContactSolver.InitVelocityConstraints(_bodies, _shapes, _contacts.AsSpan(0, _contactCount));
        JointSolver.InitVelocity(_bodies, _joints, LinearSleepTolerance, h);

        for (int iteration = 0; iteration < VelocityIterations; iteration++)
        {
            ContactSolver.SolveVelocityPass(_bodies, _shapes, _contacts.AsSpan(0, _contactCount), 1);
            JointSolver.SolveVelocityPass(_bodies, _joints, 1);
        }

        if (emitImpulseNotices)
        {
            NoSolveState unusedState;
            ImpulseNoticeContext notices = new(this);
            ContactSolver.ReportPostSolve(_contacts.AsSpan(0, _contactCount), ref notices, ref unusedState);
        }

        _bodies.IntegratePositions(h);
        SyncAwakeBodies();

        for (int iteration = 0; iteration < PositionIterations; iteration++)
        {
            ContactSolver.SolvePositionPass(_bodies, _shapes, _contacts.AsSpan(0, _contactCount));
            JointSolver.SolvePositionPass(_bodies, _joints, 1);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void StepSliceCallback<THandler, TContext>(float h, bool emitPreSolve, bool emitPostSolve, THandler handler, ref TContext context)
        where THandler : IContactSolverCallbacks<Contact, ContactManifold, TContext>
        where TContext : allows ref struct
    {
        _bodies.IntegrateVelocities(h, Gravity, AutoClearForces);
        SyncAwakeBodies();
        CollectPairs();

        if (emitPreSolve)
        {
            PreSolveContext<THandler, TContext> pre = new(_shapes);
            ContactSolver.InitVelocityConstraints(_bodies, _shapes, _contacts.AsSpan(0, _contactCount), ref pre, ref context);
        }
        else
        {
            ContactSolver.InitVelocityConstraints(_bodies, _shapes, _contacts.AsSpan(0, _contactCount));
        }

        JointSolver.InitVelocity(_bodies, _joints, LinearSleepTolerance, h);

        for (int iteration = 0; iteration < VelocityIterations; iteration++)
        {
            ContactSolver.SolveVelocityPass(_bodies, _shapes, _contacts.AsSpan(0, _contactCount), 1);
            JointSolver.SolveVelocityPass(_bodies, _joints, 1);
        }

        if (emitPostSolve)
        {
            PostSolveContext<THandler, TContext> post = new();
            ContactSolver.ReportPostSolve(_contacts.AsSpan(0, _contactCount), ref post, ref context);
        }

        _bodies.IntegratePositions(h);
        SyncAwakeBodies();

        for (int iteration = 0; iteration < PositionIterations; iteration++)
        {
            ContactSolver.SolvePositionPass(_bodies, _shapes, _contacts.AsSpan(0, _contactCount));
            JointSolver.SolvePositionPass(_bodies, _joints, 1);
        }
    }

    /// <summary>
    /// Rotates the contact buffers, collects the candidate pairs through the
    /// broadphase and carries warm-start impulses across by pair identity;
    /// fresh pairs wake sleeping dynamics.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void CollectPairs()
    {
        Contact[] built = _previous;
        _previous = _contacts;
        _previousCount = _contactCount;
        _contacts = built;
        _contactCount = 0;

        var collector = new PairCollector(this);
        World self = this;
        _tree.FindPairs(ref collector, ref self);

        for (int i = 0; i < _contactCount; i++)
        {
            ContactCache carried = default;
            bool matched = false;
            for (int j = 0; j < _previousCount; j++)
            {
                if (_previous[j].ShapeA == _contacts[i].ShapeA && _previous[j].ShapeB == _contacts[i].ShapeB)
                {
                    carried = _previous[j].Cache;
                    matched = true;
                    break;
                }
            }

            if (!matched)
            {
                WakePair(_contacts[i].BodyA, _contacts[i].BodyB);
            }

            Contact updated = _contacts[i];
            ContactManifold manifold = updated.Manifold;
            carried.WarmStart(ref manifold);
            updated.Manifold = manifold;
            carried.Store(in manifold);
            updated.Cache = carried;
            _contacts[i] = updated;
        }
    }

    /// <summary>Unit caller state for sink contexts that need none.</summary>
    private ref struct NoSolveState;

    /// <summary>Pre-solve context: combines pair tuning from the materials and fires the handler.</summary>
    private readonly struct PreSolveContext<THandler, TContext>(ShapeStore shapes)
        : IContactSolveContext<Contact, ContactManifold, TContext>
        where THandler : IContactSolverCallbacks<Contact, ContactManifold, TContext>
        where TContext : allows ref struct
    {
        private readonly ShapeStore _shapes = shapes;

        /// <inheritdoc/>
        public readonly ContactTuning Tune(ref readonly Contact contact, ref TContext context)
        {
            ref readonly ShapeRecord recordA = ref _shapes.Slot(contact.ShapeA);
            ref readonly ShapeRecord recordB = ref _shapes.Slot(contact.ShapeB);
            return ContactSolver.DefaultTuning(in recordA.Material, in recordB.Material);
        }

        /// <inheritdoc/>
        public readonly void PreSolve(ref Contact contact, ref ContactManifold manifold, ref ContactTuning tuning, ref TContext context) =>
            THandler.OnPreSolve(ref contact, ref manifold, ref tuning, ref context);

        /// <inheritdoc/>
        public readonly void PostSolve(ref readonly Contact contact, in ContactManifold manifold, in ContactImpulses impulses, ref TContext context)
        {
        }
    }

    /// <summary>Post-solve context: forwards accumulated impulses to the handler.</summary>
    private readonly struct PostSolveContext<THandler, TContext>
        : IContactSolveContext<Contact, ContactManifold, TContext>
        where THandler : IContactSolverCallbacks<Contact, ContactManifold, TContext>
        where TContext : allows ref struct
    {

        /// <inheritdoc/>
        public readonly ContactTuning Tune(ref readonly Contact contact, ref TContext context) => default;

        /// <inheritdoc/>
        public readonly void PreSolve(ref Contact contact, ref ContactManifold manifold, ref ContactTuning tuning, ref TContext context)
        {
        }

        /// <inheritdoc/>
        public readonly void PostSolve(ref readonly Contact contact, in ContactManifold manifold, in ContactImpulses impulses, ref TContext context) =>
            THandler.OnPostSolve(in contact, in manifold, in impulses, ref context);
    }

    /// <summary>Post-solve context: records accumulated impulses as world notices.</summary>
    private readonly struct ImpulseNoticeContext(World world) : IContactSolveContext<Contact, ContactManifold, NoSolveState>
    {
        private readonly World _world = world;

        /// <inheritdoc/>
        public ContactTuning Tune(ref readonly Contact contact, ref NoSolveState context) => default;

        /// <inheritdoc/>
        public void PreSolve(ref Contact contact, ref ContactManifold manifold, ref ContactTuning tuning, ref NoSolveState context)
        {
        }

        /// <inheritdoc/>
        public void PostSolve(ref readonly Contact contact, in ContactManifold manifold, in ContactImpulses impulses, ref NoSolveState context)
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

    /// <summary>
    /// Destroys a body, its shapes and its joints, pulling each shape from
    /// the broadphase and dropping tracked pairs that named them. Gears
    /// touching the body through either geared joint die with it.
    /// Destroying bodies through the raw store orphans tree items and joint
    /// links; prefer this path.
    /// </summary>
    public void DestroyBody(BodyId bodyId)
    {
        ThrowIfDisposed();

        _joints.DestroyJointsOfBody(bodyId);

        ref BodyState body = ref _bodies.Slot(bodyId);
        while (body.FirstShape != -1)
        {
            ShapeId shapeId = ShapeId.FromIndex(body.FirstShape);
            _shapes.Detach(_bodies, _tree, shapeId);
            body = ref _bodies.Slot(bodyId);
        }

        for (int i = _contactCount - 1; i >= 0; i--)
        {
            if (_contacts[i].BodyA == bodyId || _contacts[i].BodyB == bodyId)
            {
                _contacts[i] = _contacts[--_contactCount];
            }
        }

        for (int i = _previousCount - 1; i >= 0; i--)
        {
            if (_previous[i].BodyA == bodyId || _previous[i].BodyB == bodyId)
            {
                _previous[i] = _previous[--_previousCount];
            }
        }

        // _lastPairs is intentionally kept: the next PublishContactEvents
        // diffs it against the rebuilt contacts and emits End for
        // the vanished pairs, so destroy is observable as end events.

        _bodies.Destroy(bodyId);
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) == 0)
        {
            _tree.Dispose();
            _islands.Dispose();
            _contacts = [];
            _previous = [];
            _contactCount = 0;
            _previousCount = 0;
            _events = [];
            _eventCount = 0;
            _sensorEvents = [];
            _sensorEventCount = 0;
            _impulseEvents = [];
            _impulseEventCount = 0;
            _lastPairs = [];
            _currentPairs = [];
            _lastPairCount = 0;
        }

        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// Rebases the world by <paramref name="offset"/> for floating-origin
    /// rendering: every live body — static included — moves by the exact
    /// translation and the broadphase follows. Velocities and shapes' local
    /// frames are untouched.
    /// </summary>
    /// <param name="offset">Translation subtracted from every body position.</param>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void ShiftOrigin(Vec2 offset)
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

    /// <summary>Zeroes accumulated forces and torques on every live body.</summary>
    public void ClearForces()
    {
        ThrowIfDisposed();

        _bodies.ClearForces();
    }

    /// <summary>Wakes every dynamic sleeping body; statics never sleep and are skipped.</summary>
    public void WakeAllBodies()
    {
        ThrowIfDisposed();

        for (int slot = 0; slot < _bodies.SlotCapacity; slot++)
        {
            if (!_bodies.IsSlotLive(slot))
            {
                continue;
            }

            ref BodyState body = ref _bodies.SlotAt(slot);
            if (body.Type == BodyType.Dynamic && (body.Flags & BodyFlags.Awake) == 0)
            {
                _bodies.SetAwake(BodyId.FromIndex(slot), awake: true);
            }
        }
    }

    /// <summary>Read-only snapshot of world populations and broadphase shape.</summary>
    /// <returns>The current statistics; touches no state.</returns>
    public PhysicsStatistics GetStatistics()
    {
        ThrowIfDisposed();

        TreeMetrics tree = _tree.ComputeMetrics();
        IslandSolverMetrics islands = _islands.Metrics;
        return new PhysicsStatistics(
            _bodies.Count,
            _shapes.Count,
            _joints.Count,
            _contactCount,
            islands.TotalIslandsProcessed,
            _tree.Count,
            tree.Height,
            tree.MaxBalance,
            tree.Quality);
    }

    /// <summary>
    /// Diagnostic invariant sweep: every live body has a finite frame, a
    /// consistent mass triple, and an awake bit matching its sleeping bit;
    /// every live shape is live in the store, owned by a live body, holds
    /// finite world bounds and sits in the broadphase; every tracked contact
    /// names live shapes on live bodies. Off the hot path by design — call
    /// it from tests and debug tooling, never per frame.
    /// </summary>
    /// <param name="failure">When invalid, the first violation found; otherwise <see langword="null"/>.</param>
    /// <returns><see langword="true"/> when every invariant holds.</returns>
    public bool Validate(out string? failure)
    {
        ThrowIfDisposed();

        for (int slot = 0; slot < _bodies.SlotCapacity; slot++)
        {
            if (!_bodies.IsSlotLive(slot))
            {
                continue;
            }

            ref readonly BodyState body = ref _bodies.SlotAt(slot);
            if (!IsFinite(body.Position.X) || !IsFinite(body.Position.Y) ||
                !IsFinite(body.Cos) || !IsFinite(body.Sin) ||
                !IsFinite(body.LinearVelocity.X) || !IsFinite(body.LinearVelocity.Y) ||
                !IsFinite(body.AngularVelocity) || !IsFinite(body.Force.X) || !IsFinite(body.Force.Y) ||
                !IsFinite(body.Torque) || !IsFinite(body.Mass) || !IsFinite(body.InverseMass) ||
                !IsFinite(body.Inertia) || !IsFinite(body.InverseInertia) ||
                !IsFinite(body.LocalCenter.X) || !IsFinite(body.LocalCenter.Y))
            {
                failure = $"Body slot {slot} carries non-finite state.";
                return false;
            }

            bool awake = (body.Flags & BodyFlags.Awake) != 0;
            bool sleeping = (body.Flags & BodyFlags.Sleeping) != 0;
            if (awake == sleeping)
            {
                failure = $"Body slot {slot} has inconsistent awake/sleeping flags.";
                return false;
            }

            if (body.Type != BodyType.Dynamic && body.InverseMass != 0.0f)
            {
                failure = $"Body slot {slot} is non-dynamic yet has finite inverse mass.";
                return false;
            }

            if ((body.Flags & BodyFlags.FixedRotation) != 0 && body.InverseInertia != 0.0f)
            {
                failure = $"Body slot {slot} locks rotation yet has finite inverse inertia.";
                return false;
            }
        }

        for (int slot = 0; slot < _shapes.SlotCapacity; slot++)
        {
            if (!_shapes.IsSlotLive(slot))
            {
                continue;
            }

            ref readonly ShapeRecord shape = ref _shapes.SlotAt(slot);
            BodyId owner = shape.Body;
            int ownerSlot = BodyStore.SlotOf(owner);
            if (!_bodies.IsSlotLive(ownerSlot))
            {
                failure = $"Shape slot {slot} names a dead body.";
                return false;
            }

            Aabb2D box = shape.WorldAabb;
            if (!IsFinite(box.Min.X) || !IsFinite(box.Min.Y) || !IsFinite(box.Max.X) || !IsFinite(box.Max.Y) ||
                box.Min.X > box.Max.X || box.Min.Y > box.Max.Y)
            {
                failure = $"Shape slot {slot} carries invalid world bounds.";
                return false;
            }

            if (!shape.TreeItem.IsValid)
            {
                failure = $"Shape slot {slot} is not inserted in the broadphase.";
                return false;
            }
        }

        for (int i = 0; i < _contactCount; i++)
        {
            ref readonly Contact contact = ref _contacts[i];
            if (!_shapes.IsValid(contact.ShapeA) || !_shapes.IsValid(contact.ShapeB) ||
                !_bodies.IsValid(contact.BodyA) || !_bodies.IsValid(contact.BodyB))
            {
                failure = $"Contact {i} names a dead shape or body.";
                return false;
            }
        }

        failure = null;
        return true;
    }

    /// <summary>
    /// Read-only snapshot of world populations and broadphase shape: live
    /// bodies, shapes and joints, tracked pairs, the broadphase population
    /// with its cumulative island tally, and the tree's height, worst
    /// imbalance and proxy-area quality (quality 1 is perfect).
    /// </summary>
    /// <param name="BodyCount">Live bodies.</param>
    /// <param name="ShapeCount">Live shapes.</param>
    /// <param name="JointCount">Live joints.</param>
    /// <param name="ContactCount">Tracked pairs of the last step.</param>
    /// <param name="TotalIslandsProcessed">Islands processed by sleep passes since world creation.</param>
    /// <param name="BroadphaseItemCount">Shapes inserted in the tree.</param>
    /// <param name="BroadphaseTreeHeight">Height of the tree root subtree.</param>
    /// <param name="BroadphaseMaxBalance">Largest single-side imbalance.</param>
    /// <param name="BroadphaseQuality">Internal-over-leaf proxy area ratio; 1 is perfect.</param>
    public readonly record struct PhysicsStatistics(
        int BodyCount,
        int ShapeCount,
        int JointCount,
        int ContactCount,
        long TotalIslandsProcessed,
        int BroadphaseItemCount,
        int BroadphaseTreeHeight,
        int BroadphaseMaxBalance,
        float BroadphaseQuality);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool IsFinite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ThrowIfDisposed()
    {
        if (_disposed != 0)
        {
            ThrowHelper.ThrowObjectDisposed(nameof(World));
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void AddContact(ShapeId shapeA, ShapeId shapeB, BodyId bodyA, BodyId bodyB, in ContactManifold manifold, bool isSensor)
    {
        if (_contactCount >= _contacts.Length)
        {
            Array.Resize(ref _contacts, _contacts.Length * 2);
        }

        _contacts[_contactCount++] = new Contact(shapeA, shapeB, bodyA, bodyB, in manifold, default, isSensor);
    }

    /// <summary>Pair lifecycle notice: a shape pair started or stopped overlapping. Events
    /// accumulate across the step and clear at the start of the next one; read
    /// them after <see cref="World.Step"/>.
    /// </summary>
    private readonly record struct PairKey(ShapeId ShapeA, ShapeId ShapeB, BodyId BodyA, BodyId BodyB, bool IsSensor);

    /// <summary>
    /// Diffs this step's pairs against the last published set: unseen pairs
    /// raise begin notices, vanished pairs raise end notices, then the
    /// snapshot becomes the new baseline. Sensor pairs report like any other
    /// and additionally raise trigger notices.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private void PublishContactEvents()
    {
        if (_currentPairs.Length < _contactCount)
        {
            Array.Resize(ref _currentPairs, Math.Max(_contactCount, 1));
        }

        for (int i = 0; i < _contactCount; i++)
        {
            _currentPairs[i] = new PairKey(_contacts[i].ShapeA, _contacts[i].ShapeB, _contacts[i].BodyA, _contacts[i].BodyB, _contacts[i].IsSensor);
        }

        for (int i = 0; i < _contactCount; i++)
        {
            bool known = false;
            for (int j = 0; j < _lastPairCount; j++)
            {
                if (_lastPairs[j].ShapeA == _currentPairs[i].ShapeA && _lastPairs[j].ShapeB == _currentPairs[i].ShapeB)
                {
                    known = true;
                    break;
                }
            }

            EmitEvent(_currentPairs[i], known ? CollisionEventType.Stay : CollisionEventType.Begin);
        }

        for (int j = 0; j < _lastPairCount; j++)
        {
            bool alive = false;
            for (int i = 0; i < _contactCount; i++)
            {
                if (_currentPairs[i].ShapeA == _lastPairs[j].ShapeA && _currentPairs[i].ShapeB == _lastPairs[j].ShapeB)
                {
                    alive = true;
                    break;
                }
            }

            if (!alive)
            {
                EmitEvent(_lastPairs[j], CollisionEventType.End);
            }
        }

        PairKey[] swap = _lastPairs;
        _lastPairs = _currentPairs;
        _currentPairs = swap;
        _lastPairCount = _contactCount;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void EmitEvent(in PairKey pair, CollisionEventType type)
    {
        if (_eventCount >= _events.Length)
        {
            Array.Resize(ref _events, Math.Max(_events.Length * 2, 1));
        }

        _events[_eventCount++] = new ContactEvent(pair.ShapeA, pair.ShapeB, pair.BodyA, pair.BodyB, type);

        if (pair.IsSensor)
        {
            if (_sensorEventCount >= _sensorEvents.Length)
            {
                Array.Resize(ref _sensorEvents, Math.Max(_sensorEvents.Length * 2, 1));
            }

            _sensorEvents[_sensorEventCount++] = new SensorEvent(
                pair.ShapeA, pair.ShapeB, pair.BodyA, pair.BodyB,
                type switch
                {
                    CollisionEventType.Begin => SensorEventType.Enter,
                    CollisionEventType.Stay => SensorEventType.Stay,
                    _ => SensorEventType.Exit,
                });
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

    private readonly struct RayQueryVisitor : IRayHitVisitor2D<ShapeId, RayQueryContext>
    {


        [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
        public bool OnHit(SpatialItemId itemId, ShapeId userData, in Ray2D ray, ref float maxDistance, ref RayQueryContext context) =>
            context.TryHit(itemId, userData, in ray, ref maxDistance);
    }

    private ref struct RayQueryContext(World world, in QueryFilter filter, Span<RaycastHit2D> hits)
    {
        private readonly World _world = world;
        private readonly QueryFilter _filter = filter;
        private readonly Span<RaycastHit2D> _hits = hits;
        private int _written;

        public readonly Span<RaycastHit2D> Written => _hits[.._written];

        public bool TryHit(SpatialItemId itemId, ShapeId shapeId, in Ray2D ray, ref float maxDistance)
        {
            if (_written == _hits.Length)
            {
                return false;
            }

            if (shapeId != _world._tree.GetUserData(itemId) || !_world.IsShapeQueryable(shapeId, in _filter))
            {
                return true;
            }

            if (_world.TryRaycastShape(shapeId, in ray, maxDistance, out RaycastHit2D hit))
            {
                _hits[_written++] = hit;
                if (hit.Distance < maxDistance)
                {
                    maxDistance = hit.Distance;
                }
            }

            return true;
        }
    }

    private readonly struct ClosestRayVisitor : IRayHitVisitor2D<ShapeId, ClosestRayContext>
    {

        [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
        public bool OnHit(SpatialItemId itemId, ShapeId userData, in Ray2D ray, ref float maxDistance, ref ClosestRayContext context) =>
            context.TryHit(itemId, userData, in ray, ref maxDistance);
    }

    private ref struct ClosestRayContext(
        World world, in QueryFilter filter, ref RaycastHit2D bestHit, ref bool found)
    {
        private readonly World _world = world;
        private readonly QueryFilter _filter = filter;
        private readonly ref RaycastHit2D _bestHit = ref bestHit;
        private readonly ref bool _found = ref found;

        public bool TryHit(SpatialItemId itemId, ShapeId shapeId, in Ray2D ray, ref float maxDistance)
        {
            if (shapeId != _world._tree.GetUserData(itemId) || !_world.IsShapeQueryable(shapeId, in _filter))
            {
                return true;
            }

            if (_world.TryRaycastShape(shapeId, in ray, maxDistance, out RaycastHit2D hit))
            {
                _bestHit = hit;
                _found = true;
                maxDistance = hit.Distance;
            }

            return true;
        }
    }

    private readonly struct AabbQueryVisitor : ISpatialVisitor2D<ShapeId, AabbQueryContext>
    {

        [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
        public bool OnOverlap(SpatialItemId itemId, ShapeId userData, in Aabb2D box, ref AabbQueryContext context) =>
            context.TryAdd(itemId, userData);
    }

    private ref struct AabbQueryContext(World world, in QueryFilter filter, Span<ShapeId> results)
    {
        private readonly World _world = world;
        private readonly QueryFilter _filter = filter;
        private readonly Span<ShapeId> _results = results;
        private int _written;

        public readonly Span<ShapeId> Written => _results[.._written];

        public bool TryAdd(SpatialItemId itemId, ShapeId shapeId)
        {
            if (_written == _results.Length)
            {
                return false;
            }

            if (shapeId == _world._tree.GetUserData(itemId) && _world.IsShapeQueryable(shapeId, in _filter))
            {
                _results[_written++] = shapeId;
            }

            return true;
        }
    }

    private readonly struct PointQueryVisitor : ISpatialVisitor2D<ShapeId, PointQueryContext>
    {

        [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
        public bool OnOverlap(SpatialItemId itemId, ShapeId userData, in Aabb2D box, ref PointQueryContext context) =>
            context.TryAdd(itemId, userData);
    }

    private ref struct PointQueryContext(World world, in QueryFilter filter, Vec2 point, Span<ShapeId> results)
    {
        private readonly World _world = world;
        private readonly QueryFilter _filter = filter;
        private readonly Vec2 _point = point;
        private readonly Span<ShapeId> _results = results;
        private int _written;

        public readonly Span<ShapeId> Written => _results[.._written];

        public bool TryAdd(SpatialItemId itemId, ShapeId shapeId)
        {
            if (_written == _results.Length)
            {
                return false;
            }

            if (shapeId != _world._tree.GetUserData(itemId) || !_world.IsShapeQueryable(shapeId, in _filter))
            {
                return true;
            }

            ref readonly ShapeRecord record = ref _world._shapes.Slot(shapeId);
            if (ShapeQueries2D.ContainsPoint(record.Kind, record, _point))
            {
                _results[_written++] = shapeId;
            }

            return true;
        }
    }

    /// <summary>
    /// Sink for the callback point query: reports every filled shape covering
    /// the query point in broadphase order; returning <see langword="false"/>
    /// stops the walk.
    /// </summary>
    /// <typeparam name="TContext">Caller state; may be a <see langword="ref"/> struct.</typeparam>
    public interface IPointQueryVisitor<TContext>
        where TContext : struct, allows ref struct
    {
        /// <summary>Reports one covering shape.</summary>
        /// <param name="shapeId">The covering shape.</param>
        /// <param name="bodyId">The owning body.</param>
        /// <param name="context">Caller state the sink may read and write.</param>
        /// <returns><see langword="true"/> to keep walking; <see langword="false"/> to stop.</returns>
        bool OnShape(ShapeId shapeId, BodyId bodyId, ref TContext context);
    }

    private readonly struct QueryPointAllVisitor<TVisitor, TState> : ISpatialVisitor2D<ShapeId, QueryPointAllContext<TVisitor, TState>>
        where TVisitor : struct, IPointQueryVisitor<TState>
        where TState : struct, allows ref struct
    {

        [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
        public bool OnOverlap(SpatialItemId itemId, ShapeId userData, in Aabb2D box, ref QueryPointAllContext<TVisitor, TState> context) =>
            context.TryReport(itemId, userData);
    }

    private unsafe ref struct QueryPointAllContext<TVisitor, TState>(
        World world, Vec2 point, ref TVisitor report, ref TState context)
        where TVisitor : struct, IPointQueryVisitor<TState>
        where TState : struct, allows ref struct
    {
        // SAFETY: the addresses point at caller stack locals for the duration
        // of the synchronous traversal only; neither value escapes it.
        private readonly World _world = world;
        private readonly Vec2 _point = point;
        private readonly nint _reportPtr = (nint)Unsafe.AsPointer(ref report);
        private readonly nint _contextPtr = (nint)Unsafe.AsPointer(ref context);

        public bool TryReport(SpatialItemId itemId, ShapeId shapeId)
        {
            if (shapeId != _world._tree.GetUserData(itemId))
            {
                return true;
            }

            ref readonly ShapeRecord record = ref _world._shapes.Slot(shapeId);
            BodyId owner = record.Body;
            if (!_world.IsShapeQueryable(shapeId, QueryFilter.None) ||
                !ShapeQueries2D.ContainsPoint(record.Kind, record, _point))
            {
                return true;
            }

            ref TVisitor report = ref Unsafe.AsRef<TVisitor>((void*)_reportPtr);
            ref TState context = ref Unsafe.AsRef<TState>((void*)_contextPtr);
            return report.OnShape(shapeId, owner, ref context);
        }
    }

    private readonly struct ShapeQueryVisitor : ISpatialVisitor2D<ShapeId, ShapeQueryContext>
    {

        [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
        public bool OnOverlap(SpatialItemId itemId, ShapeId userData, in Aabb2D box, ref ShapeQueryContext context) =>
            context.TryAdd(itemId, userData);
    }

    private ref struct ShapeQueryContext(World world, in QueryFilter filter, int anchorSlot, Span<ShapeId> results)
    {
        private readonly World _world = world;
        private readonly QueryFilter _filter = filter;
        private readonly int _anchorSlot = anchorSlot;
        private readonly Span<ShapeId> _results = results;
        private int _written;

        public readonly Span<ShapeId> Written => _results[.._written];

        public bool TryAdd(SpatialItemId itemId, ShapeId shapeId)
        {
            if (_written == _results.Length)
            {
                return false;
            }

            if (shapeId != _world._tree.GetUserData(itemId) || shapeId.ToIndex() == _anchorSlot ||
                !_world.IsShapeQueryable(shapeId, in _filter))
            {
                return true;
            }

            ShapeId anchorId = ShapeId.FromIndex(_anchorSlot);
            if (_world.EvaluatePair(anchorId, shapeId, out ContactManifold manifold) && manifold.Count > 0)
            {
                _results[_written++] = shapeId;
            }

            return true;
        }
    }

    private readonly struct NearestQueryVisitor : ISpatialVisitor2D<ShapeId, NearestQueryContext>
    {

        [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
        public bool OnOverlap(SpatialItemId itemId, ShapeId userData, in Aabb2D box, ref NearestQueryContext context) =>
            context.TryAdd(itemId, userData);
    }

    private ref struct NearestQueryContext(World world, in QueryFilter filter, Vec2 point, float maxDistance, Span<ClosestPointHit2D> hits)
    {
        private readonly World _world = world;
        private readonly QueryFilter _filter = filter;
        private readonly Vec2 _point = point;
        private readonly float _maxDistance = maxDistance;
        private readonly Span<ClosestPointHit2D> _hits = hits;
        private int _written;

        public readonly Span<ClosestPointHit2D> Written => _hits[.._written];

        [MethodImpl(MethodImplOptions.AggressiveOptimization)]
        public bool TryAdd(SpatialItemId itemId, ShapeId shapeId)
        {
            if (_written == _hits.Length)
            {
                return false;
            }

            if (shapeId != _world._tree.GetUserData(itemId) || !_world.IsShapeQueryable(shapeId, in _filter))
            {
                return true;
            }

            ref readonly ShapeRecord record = ref _world._shapes.Slot(shapeId);
            Vec2 surface;
            float distance;
            switch (record.Kind)
            {
                case ColliderKind.Circle:
                    surface = ShapeQueries2D.ClosestCirclePoint(in record.WorldCircle, _point, out distance);
                    if (distance < 0.0f)
                    {
                        surface = _point;
                    }

                    distance = MathF.Max(distance, 0.0f);
                    break;

                case ColliderKind.Capsule:
                    surface = ShapeQueries2D.ClosestCapsulePoint(in record.WorldCapsule, _point, out distance);
                    if (distance < 0.0f)
                    {
                        surface = _point;
                    }

                    distance = MathF.Max(distance, 0.0f);
                    break;

                case ColliderKind.Edge:
                    surface = ShapeQueries2D.ClosestEdgePoint(in record.WorldEdge, _point, out distance);
                    break;

                default:
                    surface = ShapeQueries2D.ClosestPolygonPoint(in record.WorldPolygon, _point, out float signedDistance);
                    if (signedDistance <= 0.0f)
                    {
                        surface = _point;
                    }

                    distance = MathF.Abs(signedDistance);
                    break;
            }

            if (distance > _maxDistance)
            {
                return true;
            }

            int slot = _written;
            while (slot > 0 && _hits[slot - 1].Distance > distance)
            {
                _hits[slot] = _hits[slot - 1];
                slot--;
            }

            _hits[slot] = new ClosestPointHit2D(shapeId, record.Body, surface, distance);
            _written++;
            return true;
        }
    }

    private struct PairCollector : IPairVisitor<ShapeId, World>
    {
        private readonly World _world;

        public PairCollector(World world)
        {
            _world = world;
        }

        [MethodImpl(MethodImplOptions.AggressiveOptimization)]
        public bool OnPair(SpatialItemId idA, ShapeId dataA, SpatialItemId idB, ShapeId dataB, ref World context)
        {
            ShapeId shapeA = dataA < dataB ? dataA : dataB;
            ShapeId shapeB = dataA < dataB ? dataB : dataA;

            ref ShapeRecord recordA = ref _world._shapes.Slot(shapeA);
            ref ShapeRecord recordB = ref _world._shapes.Slot(shapeB);

            if (!CollisionFilter.ShouldCollide(in recordA.Filter, in recordB.Filter))
            {
                return true;
            }

            BodyId bodyA = recordA.Body;
            BodyId bodyB = recordB.Body;
            ref readonly BodyState stateA = ref _world._bodies.Slot(bodyA);
            ref readonly BodyState stateB = ref _world._bodies.Slot(bodyB);

            if (stateA.Type == BodyType.Static && stateB.Type == BodyType.Static)
            {
                return true;
            }

            bool enabledA = (stateA.Flags & BodyFlags.Active) != 0;
            bool enabledB = (stateB.Flags & BodyFlags.Active) != 0;
            if (!enabledA || !enabledB)
            {
                return true;
            }

            bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
            bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
            if (!awakeA && !awakeB)
            {
                return true;
            }

            if (!_world.EvaluatePair(shapeA, shapeB, out ContactManifold manifold))
            {
                return true;
            }

            _world.AddContact(shapeA, shapeB, bodyA, bodyB, in manifold, recordA.IsSensor || recordB.IsSensor);
            return true;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private bool EvaluatePair(ShapeId shapeA, ShapeId shapeB, out ContactManifold manifold)
    {
        ref readonly ShapeRecord recordA = ref _shapes.Slot(shapeA);
        ref readonly ShapeRecord recordB = ref _shapes.Slot(shapeB);

        ColliderKind kindA = recordA.Kind;
        ColliderKind kindB = recordB.Kind;

        if (kindA == ColliderKind.Circle && kindB == ColliderKind.Circle)
        {
            return Narrowphase2D.EvaluateCircleCircle(in recordA.WorldCircle, in recordB.WorldCircle, out manifold);
        }

        if (kindA == ColliderKind.Circle && kindB == ColliderKind.Polygon)
        {
            return Narrowphase2D.EvaluateCirclePolygon(in recordA.WorldCircle, in recordB.WorldPolygon, out manifold);
        }

        if (kindA == ColliderKind.Polygon && kindB == ColliderKind.Circle)
        {
            return Narrowphase2D.EvaluatePolygonCircle(in recordA.WorldPolygon, in recordB.WorldCircle, out manifold);
        }

        if (kindA == ColliderKind.Polygon && kindB == ColliderKind.Polygon)
        {
            return Narrowphase2D.EvaluatePolygonPolygon(in recordA.WorldPolygon, in recordB.WorldPolygon, out manifold);
        }

        if (kindA == ColliderKind.Capsule && kindB == ColliderKind.Circle)
        {
            return Narrowphase2D.EvaluateCapsuleCircle(in recordA.WorldCapsule, in recordB.WorldCircle, out manifold);
        }

        if (kindA == ColliderKind.Circle && kindB == ColliderKind.Capsule)
        {
            bool hit = Narrowphase2D.EvaluateCapsuleCircle(in recordB.WorldCapsule, in recordA.WorldCircle, out ContactManifold inner);
            manifold = hit ? inner.Flipped() : ContactManifold.Empty;
            return hit;
        }

        if (kindA == ColliderKind.Capsule && kindB == ColliderKind.Polygon)
        {
            return Narrowphase2D.EvaluateCapsulePolygon(in recordA.WorldCapsule, in recordB.WorldPolygon, out manifold);
        }

        if (kindA == ColliderKind.Polygon && kindB == ColliderKind.Capsule)
        {
            bool hit = Narrowphase2D.EvaluateCapsulePolygon(in recordB.WorldCapsule, in recordA.WorldPolygon, out ContactManifold inner);
            manifold = hit ? inner.Flipped() : ContactManifold.Empty;
            return hit;
        }

        if (kindA == ColliderKind.Circle && kindB == ColliderKind.Edge)
        {
            return Narrowphase2D.EvaluateCircleEdge(in recordA.WorldCircle, in recordB.WorldEdge, out manifold);
        }

        if (kindA == ColliderKind.Edge && kindB == ColliderKind.Circle)
        {
            return Narrowphase2D.EvaluateEdgeCircle(in recordA.WorldEdge, in recordB.WorldCircle, out manifold);
        }

        if (kindA == ColliderKind.Capsule && kindB == ColliderKind.Edge)
        {
            return Narrowphase2D.EvaluateCapsuleEdge(in recordA.WorldCapsule, in recordB.WorldEdge, out manifold);
        }

        if (kindA == ColliderKind.Edge && kindB == ColliderKind.Capsule)
        {
            return Narrowphase2D.EvaluateEdgeCapsule(in recordA.WorldEdge, in recordB.WorldCapsule, out manifold);
        }

        if (kindA == ColliderKind.Polygon && kindB == ColliderKind.Edge)
        {
            return Narrowphase2D.EvaluatePolygonEdge(in recordA.WorldPolygon, in recordB.WorldEdge, out manifold);
        }

        if (kindA == ColliderKind.Edge && kindB == ColliderKind.Polygon)
        {
            return Narrowphase2D.EvaluateEdgePolygon(in recordA.WorldEdge, in recordB.WorldPolygon, out manifold);
        }

        if (kindA == ColliderKind.Edge && kindB == ColliderKind.Edge)
        {
            return Narrowphase2D.EvaluateEdgeEdge(in recordA.WorldEdge, in recordB.WorldEdge, out manifold);
        }

        return Narrowphase2D.EvaluateCapsuleCapsule(in recordA.WorldCapsule, in recordB.WorldCapsule, out manifold);
    }
}
