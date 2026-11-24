namespace Axrone.Raycast;

using Axrone.Geometry;
using Axrone.Numeric;

/// <summary>Raycast behavior switches.</summary>
[Flags]
public enum RaycastFlags : uint
{
    /// <summary>No special behavior.</summary>
    None = 0,

    /// <summary>Return only the nearest contact.</summary>
    ClosestOnly = 1 << 0,

    /// <summary>Collect every contact up to the query limit.</summary>
    AllHits = 1 << 1,

    /// <summary>Skip shapes that carry the <see cref="RaycastLayer.Trigger"/> bit.</summary>
    IgnoreTriggers = 1 << 2,

    /// <summary>Reject contacts whose surface normal points along the ray.</summary>
    IgnoreBackfaces = 1 << 3,

    /// <summary>
    /// Request unit-length normals. The managed narrow phase always produces unit
    /// normals, so the flag is accepted for parity and never changes a result.
    /// </summary>
    PreciseHitNormal = 1 << 4,

    /// <summary>Sort collected contacts by distance.</summary>
    SortByDistance = 1 << 5,

    /// <summary>Stop after the first confirmed contact in all-hits mode.</summary>
    StopAtFirstHit = 1 << 6,

    /// <summary>Include shapes whose active flag is false.</summary>
    IncludeInactive = 1 << 7,
}

/// <summary>Standard shape layers.</summary>
[Flags]
public enum RaycastLayer : uint
{
    /// <summary>Default layer.</summary>
    Default = 1u << 0,

    /// <summary>Static scenery.</summary>
    Static = 1u << 1,

    /// <summary>Dynamic entities.</summary>
    Dynamic = 1u << 2,

    /// <summary>Kinematic entities.</summary>
    Kinematic = 1u << 3,

    /// <summary>Trigger volumes.</summary>
    Trigger = 1u << 4,

    /// <summary>Character controllers.</summary>
    Character = 1u << 5,

    /// <summary>Terrain.</summary>
    Terrain = 1u << 6,

    /// <summary>Projectiles.</summary>
    Projectile = 1u << 7,

    /// <summary>Water volumes.</summary>
    Water = 1u << 8,

    /// <summary>Transparent surfaces.</summary>
    Transparent = 1u << 9,

    /// <summary>Every layer.</summary>
    All = uint.MaxValue,
}

/// <summary>Stable identity of one registered raycast shape.</summary>
public readonly record struct RaycastShapeId(uint Value)
{
    /// <summary>Gets the invalid sentinel; never names a registered shape.</summary>
    public static RaycastShapeId Invalid => default;

    /// <summary>Gets whether the id names a shape.</summary>
    public bool IsValid => Value != 0;
}

/// <summary>Contact of a 2D raycast.</summary>
/// <param name="Shape">Registered shape that was reached.</param>
/// <param name="Point">World-space contact point.</param>
/// <param name="Normal">Unit surface normal at the contact, facing the ray.</param>
/// <param name="Distance">Distance along the ray, in world units.</param>
/// <param name="Fraction">Distance normalized by the query limit.</param>
/// <param name="LayerMask">Layer mask carried by the shape.</param>
public readonly record struct RaycastHit2D(
    RaycastShapeId Shape,
    Vec2 Point,
    Vec2 Normal,
    float Distance,
    float Fraction,
    uint LayerMask);

/// <summary>Contact of a 3D raycast.</summary>
/// <param name="Shape">Registered shape that was reached.</param>
/// <param name="Point">World-space contact point.</param>
/// <param name="Normal">Unit surface normal at the contact; triangle normals follow winding.</param>
/// <param name="Distance">Distance along the ray, in world units.</param>
/// <param name="Fraction">Distance normalized by the query limit.</param>
/// <param name="TriangleIndex">Triangle index when the shape is a triangle, otherwise -1.</param>
/// <param name="Barycentric">Barycentric coordinates when <paramref name="TriangleIndex"/> is non-negative.</param>
/// <param name="LayerMask">Layer mask carried by the shape.</param>
public readonly record struct RaycastHit3D(
    RaycastShapeId Shape,
    Vec3 Point,
    Vec3 Normal,
    float Distance,
    float Fraction,
    int TriangleIndex,
    Vec2 Barycentric,
    uint LayerMask)
{
    /// <summary>Gets whether the contact carries barycentric triangle coordinates.</summary>
    public bool HasBarycentric => TriangleIndex >= 0;
}

/// <summary>2D raycast query.</summary>
/// <param name="Ray">Normalized query ray.</param>
/// <param name="MaxDistance">Positive, finite distance limit.</param>
/// <param name="LayerMask">Layers the query accepts.</param>
/// <param name="Flags">Behavior switches.</param>
/// <param name="MaxHits">Upper bound on collected contacts in all-hits mode.</param>
public readonly record struct RaycastQuery2D(
    Ray2D Ray,
    float MaxDistance,
    uint LayerMask = uint.MaxValue,
    RaycastFlags Flags = RaycastFlags.ClosestOnly,
    int MaxHits = 1);

/// <summary>3D raycast query.</summary>
/// <param name="Ray">Normalized query ray.</param>
/// <param name="MaxDistance">Positive, finite distance limit.</param>
/// <param name="LayerMask">Layers the query accepts.</param>
/// <param name="Flags">Behavior switches.</param>
/// <param name="MaxHits">Upper bound on collected contacts in all-hits mode.</param>
public readonly record struct RaycastQuery3D(
    Ray3D Ray,
    float MaxDistance,
    uint LayerMask = uint.MaxValue,
    RaycastFlags Flags = RaycastFlags.ClosestOnly,
    int MaxHits = 1);

/// <summary>Shape kinds accepted by the raycast engines.</summary>
public enum RaycastShapeKind : byte
{
    /// <summary>Axis-aligned box.</summary>
    Aabb,

    /// <summary>Sphere, or circle in 2D.</summary>
    Sphere,

    /// <summary>Infinite plane; 3D only and tested outside the broadphase.</summary>
    Plane,

    /// <summary>Triangle; 3D only.</summary>
    Triangle,

    /// <summary>Oriented box, or rotated rectangle in 2D.</summary>
    Box,

    /// <summary>Capsule: a segment swept by a radius.</summary>
    Capsule,

    /// <summary>Line segment; 2D only.</summary>
    Segment,

    /// <summary>Convex polygon; 2D only.</summary>
    Polygon,
}

/// <summary>3D raycast shape descriptor.</summary>
public readonly record struct RaycastShape3D
{
    private RaycastShape3D(
        RaycastShapeKind kind,
        in Aabb3D bounds,
        uint layerMask,
        bool trigger,
        Vec3 center,
        float radius,
        Vec3 halfExtents,
        Quat rotation,
        Vec3 a,
        Vec3 b,
        Vec3 c,
        Vec3 normal)
    {
        Kind = kind;
        Bounds = bounds;
        LayerMask = layerMask;
        Trigger = trigger;
        Center = center;
        Radius = radius;
        HalfExtents = halfExtents;
        Rotation = rotation;
        A = a;
        B = b;
        C = c;
        Normal = normal;
    }

    /// <summary>Gets the shape kind.</summary>
    public RaycastShapeKind Kind { get; }

    /// <summary>Gets the world bounds used by the broadphase; empty for planes.</summary>
    public Aabb3D Bounds { get; }

    /// <summary>Gets the layer mask.</summary>
    public uint LayerMask { get; }

    /// <summary>Gets whether the shape is a trigger volume.</summary>
    public bool Trigger { get; }

    /// <summary>Gets the center of solid primitives, or a point on a plane.</summary>
    public Vec3 Center { get; }

    /// <summary>Gets the sphere, capsule or cast radius.</summary>
    public float Radius { get; }

    /// <summary>Gets the oriented-box half extents.</summary>
    public Vec3 HalfExtents { get; }

    /// <summary>Gets the oriented-box rotation; identity when unset.</summary>
    public Quat Rotation { get; }

    /// <summary>Gets the first triangle vertex, or the capsule start cap center.</summary>
    public Vec3 A { get; }

    /// <summary>Gets the second triangle vertex, or the capsule end cap center.</summary>
    public Vec3 B { get; }

    /// <summary>Gets the third triangle vertex.</summary>
    public Vec3 C { get; }

    /// <summary>Gets the plane normal.</summary>
    public Vec3 Normal { get; }

    /// <summary>Creates a sphere shape.</summary>
    public static RaycastShape3D CreateSphere(Vec3 center, float radius, uint layerMask = 1u, bool trigger = false)
    {
        if (!float.IsFinite(radius) || radius < 0f)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(radius));
        }

        return new RaycastShape3D(
            RaycastShapeKind.Sphere,
            new Aabb3D(center - new Vec3(radius), center + new Vec3(radius)),
            layerMask,
            trigger,
            center,
            radius,
            default,
            Quat.Identity,
            default,
            default,
            default,
            default);
    }

    /// <summary>Creates an axis-aligned box shape.</summary>
    public static RaycastShape3D CreateAabb(in Aabb3D bounds, uint layerMask = 1u, bool trigger = false)
    {
        if (!bounds.IsValid)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(bounds));
        }

        return new RaycastShape3D(
            RaycastShapeKind.Aabb,
            bounds,
            layerMask,
            trigger,
            bounds.Center,
            0f,
            bounds.Extents,
            Quat.Identity,
            default,
            default,
            default,
            default);
    }

    /// <summary>Creates an oriented box shape.</summary>
    public static RaycastShape3D CreateBox(
        Vec3 center,
        Vec3 halfExtents,
        Quat rotation,
        uint layerMask = 1u,
        bool trigger = false)
    {
        if (!IsNonNegative(halfExtents))
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(halfExtents));
        }

        Quat normalized = NormalizeRotation(rotation);
        Vec3 worldExtent = RotatedExtents(normalized, halfExtents);
        return new RaycastShape3D(
            RaycastShapeKind.Box,
            new Aabb3D(center - worldExtent, center + worldExtent),
            layerMask,
            trigger,
            center,
            0f,
            halfExtents,
            normalized,
            default,
            default,
            default,
            default);
    }

    /// <summary>Creates a triangle shape.</summary>
    public static RaycastShape3D CreateTriangle(Vec3 a, Vec3 b, Vec3 c, uint layerMask = 1u)
    {
        Aabb3D bounds = new(Vec3.Min(a, Vec3.Min(b, c)), Vec3.Max(a, Vec3.Max(b, c)));
        if (!bounds.IsValid)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(a));
        }

        return new RaycastShape3D(
            RaycastShapeKind.Triangle,
            bounds,
            layerMask,
            false,
            (a + b + c) / 3f,
            0f,
            default,
            Quat.Identity,
            a,
            b,
            c,
            default);
    }

    /// <summary>Creates an infinite plane shape.</summary>
    public static RaycastShape3D CreatePlane(Vec3 point, Vec3 normal, uint layerMask = 1u)
    {
        float lengthSquared = normal.LengthSquared();
        if (lengthSquared < 1e-12f)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(normal));
        }

        return new RaycastShape3D(
            RaycastShapeKind.Plane,
            Aabb3D.Empty,
            layerMask,
            false,
            point,
            0f,
            default,
            Quat.Identity,
            default,
            default,
            default,
            normal / MathF.Sqrt(lengthSquared));
    }

    /// <summary>
    /// Creates a capsule with explicit cap centers and radius. <paramref name="a"/> and
    /// <paramref name="b"/> are the sphere centers, so the total height is
    /// <c>|b - a| + 2 * radius</c>.
    /// </summary>
    public static RaycastShape3D CreateCapsule(Vec3 a, Vec3 b, float radius, uint layerMask = 1u)
    {
        if (!float.IsFinite(radius) || radius < 0f)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(radius));
        }

        Aabb3D bounds = new(
            Vec3.Min(a, b) - new Vec3(radius),
            Vec3.Max(a, b) + new Vec3(radius));
        return new RaycastShape3D(
            RaycastShapeKind.Capsule,
            bounds,
            layerMask,
            false,
            (a + b) * 0.5f,
            radius,
            default,
            Quat.Identity,
            a,
            b,
            default,
            default);
    }

    /// <summary>
    /// Creates a vertical capsule whose total height, including both caps, is
    /// <paramref name="height"/>.
    /// </summary>
    public static RaycastShape3D CreateCapsule(
        Vec3 center,
        float radius,
        float height,
        uint layerMask = 1u)
    {
        if (!float.IsFinite(height) || height < 0f)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(height));
        }

        float half = MathF.Max(0f, (height * 0.5f) - radius);
        return CreateCapsule(center - new Vec3(0f, half, 0f), center + new Vec3(0f, half, 0f), radius, layerMask);
    }

    /// <summary>Gets the world-space half extents of an oriented box or axis-aligned box.</summary>
    internal Vec3 WorldHalfExtents
    {
        get
        {
            if (Kind == RaycastShapeKind.Aabb)
            {
                return Bounds.Extents;
            }

            return Kind == RaycastShapeKind.Box ? RotatedExtents(Rotation, HalfExtents) : new Vec3(Radius);
        }
    }

    /// <summary>Gets the world-space half extents used to fatten a ray footprint for a cast.</summary>
    internal Vec3 CastHalfExtents
    {
        get
        {
            if (Kind == RaycastShapeKind.Capsule)
            {
                Vec3 axis = B - A;
                float halfLength = axis.Length() * 0.5f;
                return new Vec3(Radius + halfLength);
            }

            return WorldHalfExtents;
        }
    }

    internal static Quat NormalizeRotation(Quat rotation)
    {
        float lengthSquared = (rotation.X * rotation.X) + (rotation.Y * rotation.Y) + (rotation.Z * rotation.Z) + (rotation.W * rotation.W);
        if (lengthSquared < 1e-12f)
        {
            return Quat.Identity;
        }

        float inverse = 1f / MathF.Sqrt(lengthSquared);
        return new Quat(rotation.X * inverse, rotation.Y * inverse, rotation.Z * inverse, rotation.W * inverse);
    }

    internal static Vec3 RotatedExtents(Quat rotation, Vec3 halfExtents)
    {
        Vec3 ex = Rotate(rotation, new Vec3(halfExtents.X, 0f, 0f));
        Vec3 ey = Rotate(rotation, new Vec3(0f, halfExtents.Y, 0f));
        Vec3 ez = Rotate(rotation, new Vec3(0f, 0f, halfExtents.Z));
        return new Vec3(
            MathF.Abs(ex.X) + MathF.Abs(ey.X) + MathF.Abs(ez.X),
            MathF.Abs(ex.Y) + MathF.Abs(ey.Y) + MathF.Abs(ez.Y),
            MathF.Abs(ex.Z) + MathF.Abs(ey.Z) + MathF.Abs(ez.Z));
    }

    internal static Vec3 Rotate(Quat rotation, Vec3 vector)
    {
        Vec3 q = new(rotation.X, rotation.Y, rotation.Z);
        Vec3 t = (Vec3.Cross(q, vector) * 2f);
        return vector + (t * rotation.W) + Vec3.Cross(q, t);
    }

    private static bool IsNonNegative(Vec3 value) =>
        float.IsFinite(value.X) && float.IsFinite(value.Y) && float.IsFinite(value.Z) &&
        value.X >= 0f && value.Y >= 0f && value.Z >= 0f;
}

/// <summary>2D raycast shape descriptor.</summary>
public readonly record struct RaycastShape2D
{
    private RaycastShape2D(
        RaycastShapeKind kind,
        in Aabb2D bounds,
        uint layerMask,
        bool trigger,
        Vec2 center,
        float radius,
        Vec2 halfExtents,
        float rotation,
        Vec2 a,
        Vec2 b,
        ReadOnlyMemory<Vec2> polygon)
    {
        Kind = kind;
        Bounds = bounds;
        LayerMask = layerMask;
        Trigger = trigger;
        Center = center;
        Radius = radius;
        HalfExtents = halfExtents;
        Rotation = rotation;
        A = a;
        B = b;
        Polygon = polygon;
    }

    /// <summary>Gets the shape kind.</summary>
    public RaycastShapeKind Kind { get; }

    /// <summary>Gets the world bounds used by the broadphase.</summary>
    public Aabb2D Bounds { get; }

    /// <summary>Gets the layer mask.</summary>
    public uint LayerMask { get; }

    /// <summary>Gets whether the shape is a trigger volume.</summary>
    public bool Trigger { get; }

    /// <summary>Gets the circle or capsule center.</summary>
    public Vec2 Center { get; }

    /// <summary>Gets the circle or capsule radius.</summary>
    public float Radius { get; }

    /// <summary>Gets the oriented rectangle half extents.</summary>
    public Vec2 HalfExtents { get; }

    /// <summary>Gets the oriented rectangle rotation in radians.</summary>
    public float Rotation { get; }

    /// <summary>Gets the segment or capsule start point.</summary>
    public Vec2 A { get; }

    /// <summary>Gets the segment or capsule end point.</summary>
    public Vec2 B { get; }

    /// <summary>Gets the convex polygon vertices, stored counter-clockwise.</summary>
    public ReadOnlyMemory<Vec2> Polygon { get; }

    /// <summary>Creates an axis-aligned box shape.</summary>
    public static RaycastShape2D CreateAabb(in Aabb2D bounds, uint layerMask = 1u, bool trigger = false)
    {
        if (!bounds.IsValid)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(bounds));
        }

        return new RaycastShape2D(
            RaycastShapeKind.Aabb,
            bounds,
            layerMask,
            trigger,
            bounds.Center,
            0f,
            bounds.Extents,
            0f,
            default,
            default,
            default);
    }

    /// <summary>Creates a circle shape.</summary>
    public static RaycastShape2D CreateCircle(Vec2 center, float radius, uint layerMask = 1u, bool trigger = false)
    {
        if (!float.IsFinite(radius) || radius < 0f)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(radius));
        }

        return new RaycastShape2D(
            RaycastShapeKind.Sphere,
            new Aabb2D(center.X - radius, center.Y - radius, center.X + radius, center.Y + radius),
            layerMask,
            trigger,
            center,
            radius,
            default,
            0f,
            default,
            default,
            default);
    }

    /// <summary>Creates an oriented rectangle shape.</summary>
    public static RaycastShape2D CreateBox(
        Vec2 center,
        Vec2 halfExtents,
        float rotation,
        uint layerMask = 1u,
        bool trigger = false)
    {
        if (!float.IsFinite(halfExtents.X) || !float.IsFinite(halfExtents.Y) ||
            halfExtents.X < 0f || halfExtents.Y < 0f ||
            !float.IsFinite(rotation))
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(halfExtents));
        }

        float cos = MathF.Cos(rotation);
        float sin = MathF.Sin(rotation);
        Vec2 worldExtent = new(
            (MathF.Abs(cos) * halfExtents.X) + (MathF.Abs(sin) * halfExtents.Y),
            (MathF.Abs(sin) * halfExtents.X) + (MathF.Abs(cos) * halfExtents.Y));
        return new RaycastShape2D(
            RaycastShapeKind.Box,
            new Aabb2D(center - worldExtent, center + worldExtent),
            layerMask,
            trigger,
            center,
            0f,
            halfExtents,
            rotation,
            default,
            default,
            default);
    }

    /// <summary>Creates a capsule whose axis runs from <paramref name="a"/> to <paramref name="b"/>.</summary>
    public static RaycastShape2D CreateCapsule(Vec2 a, Vec2 b, float radius, uint layerMask = 1u)
    {
        if (!float.IsFinite(radius) || radius < 0f)
        {
            ThrowHelper.ThrowArgumentOutOfRange(nameof(radius));
        }

        return new RaycastShape2D(
            RaycastShapeKind.Capsule,
            new Aabb2D(Vec2.Min(a, b) - new Vec2(radius), Vec2.Max(a, b) + new Vec2(radius)),
            layerMask,
            false,
            (a + b) * 0.5f,
            radius,
            default,
            0f,
            a,
            b,
            default);
    }

    /// <summary>Creates a line segment shape.</summary>
    public static RaycastShape2D CreateSegment(Vec2 a, Vec2 b, uint layerMask = 1u) =>
        new(
            RaycastShapeKind.Segment,
            new Aabb2D(Vec2.Min(a, b), Vec2.Max(a, b)),
            layerMask,
            false,
            (a + b) * 0.5f,
            0f,
            default,
            0f,
            a,
            b,
            default);

    /// <summary>Creates a convex polygon shape; the vertices are copied into the descriptor.</summary>
    public static RaycastShape2D CreatePolygon(ReadOnlySpan<Vec2> vertices, uint layerMask = 1u)
    {
        if (vertices.Length < 3)
        {
            ThrowHelper.ThrowArgumentEmpty(nameof(vertices));
        }

        Vec2 min = vertices[0];
        Vec2 max = vertices[0];
        for (var index = 1; index < vertices.Length; index++)
        {
            min = Vec2.Min(min, vertices[index]);
            max = Vec2.Max(max, vertices[index]);
        }

        return new RaycastShape2D(
            RaycastShapeKind.Polygon,
            new Aabb2D(min, max),
            layerMask,
            false,
            (min + max) * 0.5f,
            0f,
            default,
            0f,
            default,
            default,
            vertices.ToArray());
    }
}

/// <summary>Stable raycast failure code.</summary>
public enum RaycastErrorCode
{
    /// <summary>Invalid ray, query limit or span shape.</summary>
    InvalidQuery,

    /// <summary>Shape was not registered.</summary>
    ShapeNotFound,

    /// <summary>The engine is disposed.</summary>
    Disposed,
}

/// <summary>Coded raycast exception.</summary>
public sealed class RaycastException : Exception
{
    /// <summary>Creates an exception without a message.</summary>
    public RaycastException()
    {
        Code = RaycastErrorCode.InvalidQuery;
    }

    /// <summary>Creates an exception with a message.</summary>
    /// <param name="message">Failure description.</param>
    public RaycastException(string message)
        : base(message)
    {
        Code = RaycastErrorCode.InvalidQuery;
    }

    /// <summary>Creates an exception with a message and inner cause.</summary>
    /// <param name="message">Failure description.</param>
    /// <param name="innerException">Underlying cause.</param>
    public RaycastException(string message, Exception innerException)
        : base(message, innerException)
    {
        Code = RaycastErrorCode.InvalidQuery;
    }

    /// <summary>Creates a coded raycast exception.</summary>
    public RaycastException(string message, RaycastErrorCode code)
        : base(message)
    {
        Code = code;
    }

    /// <summary>Gets the failure code.</summary>
    public RaycastErrorCode Code { get; }
}
