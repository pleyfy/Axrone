namespace Axrone.Physics2D;

/// <summary>
/// Rigid 2D frame: a translation plus a rotation stored as cosine/sine so
/// every use is multiply-add with no trigonometry on the hot path. Sixteen
/// bytes, register-passable. The angle is derived on demand; construction
/// takes radians.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct Transform2D : IEquatable<Transform2D>
{
    /// <summary>Translation of the frame origin.</summary>
    public readonly Vec2 Position;

    /// <summary>Cosine of the frame angle.</summary>
    public readonly float Cos;

    /// <summary>Sine of the frame angle.</summary>
    public readonly float Sin;

    /// <summary>Identity frame: origin, zero angle.</summary>
    public static Transform2D Identity => new(Vec2.Zero, 1.0f, 0.0f);

    /// <summary>Creates a frame from a translation and an angle in radians.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public Transform2D(Vec2 position, float angle)
        : this(position, MathF.Cos(angle), MathF.Sin(angle))
    {
    }

    private Transform2D(Vec2 position, float cos, float sin)
    {
        Position = position;
        Cos = cos;
        Sin = sin;
    }

    /// <summary>Builds a frame from precomputed rotation components.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    internal static Transform2D FromRotation(Vec2 position, float cos, float sin) => new(position, cos, sin);

    /// <summary>Frame angle in radians, derived on demand.</summary>
    public float Angle
    {
        [MethodImpl(MethodImplOptions.AggressiveInlining)]
        get => MathF.Atan2(Sin, Cos);
    }

    /// <summary>Rotates <paramref name="vector"/> by the frame angle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public Vec2 Rotate(Vec2 vector) => new((Cos * vector.X) - (Sin * vector.Y), (Sin * vector.X) + (Cos * vector.Y));

    /// <summary>Maps a local point to world space.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public Vec2 TransformPoint(Vec2 point) => Position + Rotate(point);

    /// <summary>Maps a world point into the local frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public Vec2 InverseTransformPoint(Vec2 point)
    {
        Vec2 d = point - Position;
        return new Vec2((Cos * d.X) + (Sin * d.Y), (-Sin * d.X) + (Cos * d.Y));
    }

    /// <summary>Composes two frames: applies <paramref name="inner"/> first, then <paramref name="outer"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static Transform2D Concat(in Transform2D outer, in Transform2D inner) =>
        FromRotation(
            outer.TransformPoint(inner.Position),
            (outer.Cos * inner.Cos) - (outer.Sin * inner.Sin),
            (outer.Sin * inner.Cos) + (outer.Cos * inner.Sin));

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public bool Equals(Transform2D other) => Position == other.Position && Cos == other.Cos && Sin == other.Sin;

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is Transform2D other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode() => HashCode.Combine(Position, Cos, Sin);

    /// <summary>Determines whether two frames match in translation and rotation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator ==(Transform2D left, Transform2D right) => left.Equals(right);

    /// <summary>Determines whether two frames differ.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool operator !=(Transform2D left, Transform2D right) => !left.Equals(right);
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
    public Vec2 Position { get; init; } = default;

    /// <summary>Initial angle in radians.</summary>
    public float Angle { get; init; } = 0.0f;

    /// <summary>Initial linear velocity.</summary>
    public Vec2 LinearVelocity { get; init; } = default;

    /// <summary>Initial angular velocity.</summary>
    public float AngularVelocity { get; init; } = 0.0f;

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

    /// <summary>Whether the body starts enabled (disabled bodies integrate nothing).</summary>
    public bool Enabled { get; init; } = true;

    /// <summary>Whether the body starts awake.</summary>
    public bool Awake { get; init; } = true;
}

/// <summary>
/// One simulated body: type and flags, frame, velocities, accumulated force
/// and torque, mass properties with precomputed inverses (zero for infinite
/// mass, so the solver never divides), damping, gravity scale and sleep
/// bookkeeping. Mutable storage owned by <see cref="BodyStore"/>; read and
/// write it through the store so slot validation stays in one place.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct BodyState
{
    /// <summary>How the body moves.</summary>
    public BodyType Type;

    /// <summary>Stored flags; see <see cref="BodyFlags"/>.</summary>
    public BodyFlags Flags;

    /// <summary>Translation.</summary>
    public Vec2 Position;

    /// <summary>Cosine of the angle.</summary>
    public float Cos;

    /// <summary>Sine of the angle.</summary>
    public float Sin;

    /// <summary>Linear velocity.</summary>
    public Vec2 LinearVelocity;

    /// <summary>Angular velocity.</summary>
    public float AngularVelocity;

    /// <summary>Accumulated force, cleared every step.</summary>
    public Vec2 Force;

    /// <summary>Accumulated torque, cleared every step.</summary>
    public float Torque;

    /// <summary>Mass; zero means infinite.</summary>
    public float Mass;

    /// <summary>Inverse mass; zero for infinite mass.</summary>
    public float InverseMass;

    /// <summary>Rotational inertia about the origin; zero means infinite.</summary>
    public float Inertia;

    /// <summary>Inverse inertia; zero for infinite inertia.</summary>
    public float InverseInertia;

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
    public Vec2 LocalCenter;

    /// <summary>Whether the slot holds a live body.</summary>
    public bool Live;
}
