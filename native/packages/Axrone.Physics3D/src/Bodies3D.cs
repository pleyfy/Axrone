namespace Axrone.Physics3D;

/// <summary>
/// Rigid 3D frame: a translation plus a unit quaternion. Rotation applies via
/// quaternion multiply with no trigonometry on the hot path. Passed by
/// <see langword="in"/> reference: 28 bytes, above the register-promotion window.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct RigidTransform3D : IEquatable<RigidTransform3D>
{
    /// <summary>Translation of the frame origin.</summary>
    public readonly Vec3 Position;

    /// <summary>Orientation of the frame; always a unit quaternion.</summary>
    public readonly Quat Rotation;

    /// <summary>Identity frame: origin, no rotation.</summary>
    public static RigidTransform3D Identity => new(Vec3.Zero, Quat.Identity);

    /// <summary>Creates a frame from a translation and an orientation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public RigidTransform3D(Vec3 position, Quat rotation)
    {
        Position = position;
        Rotation = rotation;
    }

    /// <summary>Rotates <paramref name="vector"/> by the frame orientation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public Vec3 Rotate(Vec3 vector) => Rotation * vector;

    /// <summary>Maps a local point to world space.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public Vec3 TransformPoint(Vec3 point) => Position + Rotate(point);

    /// <summary>Maps a world point into the local frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public Vec3 InverseTransformPoint(Vec3 point) => Rotation.Conjugate() * (point - Position);

    /// <summary>Composes two frames: applies <paramref name="inner"/> first, then <paramref name="outer"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static RigidTransform3D Concat(in RigidTransform3D outer, in RigidTransform3D inner) =>
        new(outer.TransformPoint(inner.Position), outer.Rotation * inner.Rotation);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(RigidTransform3D other) => Position == other.Position && Rotation == other.Rotation;

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is RigidTransform3D other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => HashCode.Combine(Position, Rotation);

    /// <summary>Determines whether two frames match in translation and orientation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator ==(RigidTransform3D left, RigidTransform3D right) => left.Equals(right);

    /// <summary>Determines whether two frames differ.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator !=(RigidTransform3D left, RigidTransform3D right) => !left.Equals(right);
}

/// <summary>
/// Construction parameters of a body. Defaults describe an awake dynamic
/// body at the origin with no damping and unit gravity scale.
/// </summary>
public readonly struct BodyDef
{
    /// <summary>Creates default parameters.</summary>
    public BodyDef()
    {
    }

    /// <summary>How the body moves.</summary>
    public BodyType Type { get; init; } = BodyType.Dynamic;

    /// <summary>Initial translation.</summary>
    public Vec3 Position { get; init; } = default;

    /// <summary>Initial orientation; identity when untouched.</summary>
    public Quat Rotation { get; init; } = Quat.Identity;

    /// <summary>Initial linear velocity.</summary>
    public Vec3 LinearVelocity { get; init; } = default;

    /// <summary>Initial angular velocity in radians per second.</summary>
    public Vec3 AngularVelocity { get; init; } = default;

    /// <summary>Linear damping; never negative.</summary>
    public float LinearDamping { get; init; } = 0.0f;

    /// <summary>Angular damping; never negative.</summary>
    public float AngularDamping { get; init; } = 0.0f;

    /// <summary>Gravity multiplier; finite.</summary>
    public float GravityScale { get; init; } = 1.0f;

    /// <summary>Whether rotation is locked.</summary>
    public bool FixedRotation { get; init; } = false;

    /// <summary>CCD hint for fast movers.</summary>
    public bool Bullet { get; init; } = false;

    /// <summary>Whether the body may sleep.</summary>
    public bool AllowSleep { get; init; } = true;

    /// <summary>Whether the body starts awake.</summary>
    public bool Awake { get; init; } = true;
}

/// <summary>
/// One simulated body: type and flags, frame, linear and angular velocities,
/// accumulated force and torque, mass properties with precomputed inverses
/// (zero for infinite mass, so the solver never divides), damping, gravity
/// scale and sleep bookkeeping. Mutable storage owned by the body store; read
/// and write it through the store so slot validation stays in one place.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct BodyState
{
    /// <summary>How the body moves.</summary>
    public BodyType Type;

    /// <summary>Stored flags; see <see cref="BodyFlags"/>.</summary>
    public BodyFlags Flags;

    /// <summary>Translation.</summary>
    public Vec3 Position;

    /// <summary>Orientation; always a unit quaternion.</summary>
    public Quat Rotation;

    /// <summary>Linear velocity.</summary>
    public Vec3 LinearVelocity;

    /// <summary>Angular velocity in radians per second.</summary>
    public Vec3 AngularVelocity;

    /// <summary>Accumulated world-space force, cleared every step.</summary>
    public Vec3 Force;

    /// <summary>Accumulated world-space torque, cleared every step.</summary>
    public Vec3 Torque;

    /// <summary>Mass; zero means infinite.</summary>
    public float Mass;

    /// <summary>Inverse mass; zero for infinite mass.</summary>
    public float InverseMass;

    /// <summary>Diagonal of the inertia tensor in the body frame; the raw tensor mass queries read back.</summary>
    public Vec3 InertiaDiagonal;

    /// <summary>Diagonal of the inverse inertia tensor in the body frame; zero for infinite inertia.</summary>
    public Vec3 InverseInertia;

    /// <summary>Linear damping.</summary>
    public float LinearDamping;

    /// <summary>Angular damping.</summary>
    public float AngularDamping;

    /// <summary>Gravity multiplier.</summary>
    public float GravityScale;

    /// <summary>Time spent quiet; the sleep pass reads it.</summary>
    public float SleepTime;

    /// <summary>Attached shapes; the shape store owns the list.</summary>
    public int ShapeCount;

    /// <summary>First shape slot of the intrusive list; -1 when shapeless.</summary>
    public int FirstShape;

    /// <summary>Center of mass in the body frame; origin when massless.</summary>
    public Vec3 LocalCenter;

    /// <summary>Whether the slot holds a live body.</summary>
    public bool Live;
}
