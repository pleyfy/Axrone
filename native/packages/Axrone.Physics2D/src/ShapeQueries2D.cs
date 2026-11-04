namespace Axrone.Physics2D;

/// <summary>
/// Point-to-shape geometry for query surfaces: the closest boundary point
/// and the signed distance (negative inside) for every world-space collider.
/// Pure static math over cached world geometry; nothing allocates.
/// </summary>
internal static class ShapeQueries2D
{
    /// <summary>Closest boundary point of a world disc to <paramref name="point"/> and the signed distance.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static Vec2 ClosestCirclePoint(in Circle2 circle, Vec2 point, out float signedDistance)
    {
        Vec2 d = point - circle.Center;
        float length = MathF.Sqrt(d.LengthSquared());
        if (length <= float.Epsilon)
        {
            signedDistance = -circle.Radius;
            return circle.Center + new Vec2(circle.Radius, 0.0f);
        }

        Vec2 direction = d / length;
        signedDistance = length - circle.Radius;
        return circle.Center + (direction * circle.Radius);
    }

    /// <summary>Closest boundary point of a world stadium to <paramref name="point"/> and the signed distance.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static Vec2 ClosestCapsulePoint(in Capsule2D capsule, Vec2 point, out float signedDistance)
    {
        Vec2 segment = capsule.P1 - capsule.P0;
        float lengthSquared = segment.LengthSquared();
        float t = lengthSquared <= float.Epsilon
            ? 0.0f
            : Math.Clamp(Vec2.Dot(point - capsule.P0, segment) / lengthSquared, 0.0f, 1.0f);
        Vec2 core = capsule.P0 + (segment * t);
        Vec2 d = point - core;
        float length = MathF.Sqrt(d.LengthSquared());
        if (length <= float.Epsilon)
        {
            signedDistance = -capsule.Radius;
            return core + new Vec2(capsule.Radius, 0.0f);
        }

        signedDistance = length - capsule.Radius;
        return core + ((d / length) * capsule.Radius);
    }

    /// <summary>Closest point on a world segment to <paramref name="point"/>; segments have no interior.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static Vec2 ClosestEdgePoint(in Edge2D edge, Vec2 point, out float signedDistance)
    {
        Vec2 closest = ClosestOnSegment(in edge, point);
        Vec2 d = point - closest;
        signedDistance = MathF.Sqrt(d.LengthSquared());
        return closest;
    }

    /// <summary>Closest boundary point of a world convex polygon to <paramref name="point"/> and the signed distance.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static Vec2 ClosestPolygonPoint(in Polygon2D polygon, Vec2 point, out float signedDistance)
    {
        ReadOnlySpan<Vec2> vertices = polygon.Vertices;
        ReadOnlySpan<Vec2> normals = polygon.Normals;
        int count = vertices.Length;

        float deepest = float.NegativeInfinity;
        for (int i = 0; i < count; i++)
        {
            float offset = Vec2.Dot(normals[i], point - vertices[i]);
            if (offset > 0.0f)
            {
                // Outside this half-plane: the closest boundary point lies on edge i.
                Vec2 a = vertices[i];
                Vec2 b = vertices[(i + 1) % count];
                Vec2 edge = b - a;
                float lengthSquared = edge.LengthSquared();
                float t = lengthSquared <= float.Epsilon
                    ? 0.0f
                    : Math.Clamp(Vec2.Dot(point - a, edge) / lengthSquared, 0.0f, 1.0f);
                Vec2 closest = a + (edge * t);
                Vec2 d = point - closest;
                signedDistance = MathF.Sqrt(d.LengthSquared());
                return closest;
            }

            if (offset > deepest)
            {
                deepest = offset;
            }
        }

        // Inside every half-plane: signed distance is the negative margin to the closest face.
        signedDistance = deepest;
        return point;
    }

    /// <summary>Whether <paramref name="point"/> lies inside the filled collider region of a world shape.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static bool ContainsPoint(ColliderKind kind, in ShapeRecord shape, Vec2 point)
    {
        return kind switch
        {
            ColliderKind.Circle => ContainsCircle(in shape.WorldCircle, point),
            ColliderKind.Capsule => ContainsCapsule(in shape.WorldCapsule, point),
            ColliderKind.Polygon => ContainsPolygon(in shape.WorldPolygon, point),
            _ => false,
        };
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool ContainsCircle(in Circle2 circle, Vec2 point) =>
        Vec2.DistanceSquared(circle.Center, point) <= circle.Radius * circle.Radius;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool ContainsCapsule(in Capsule2D capsule, Vec2 point)
    {
        Vec2 segment = capsule.P1 - capsule.P0;
        float lengthSquared = segment.LengthSquared();
        float t = lengthSquared <= float.Epsilon
            ? 0.0f
            : Math.Clamp(Vec2.Dot(point - capsule.P0, segment) / lengthSquared, 0.0f, 1.0f);
        Vec2 core = capsule.P0 + (segment * t);
        return Vec2.DistanceSquared(point, core) <= capsule.Radius * capsule.Radius;
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static bool ContainsPolygon(in Polygon2D polygon, Vec2 point)
    {
        ReadOnlySpan<Vec2> vertices = polygon.Vertices;
        ReadOnlySpan<Vec2> normals = polygon.Normals;
        for (int i = 0; i < vertices.Length; i++)
        {
            if (Vec2.Dot(normals[i], point - vertices[i]) > 0.0f)
            {
                return false;
            }
        }

        return true;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec2 ClosestOnSegment(in Edge2D edge, Vec2 point)
    {
        Vec2 segment = edge.P1 - edge.P0;
        float lengthSquared = segment.LengthSquared();
        float t = lengthSquared <= float.Epsilon
            ? 0.0f
            : Math.Clamp(Vec2.Dot(point - edge.P0, segment) / lengthSquared, 0.0f, 1.0f);
        return edge.P0 + (segment * t);
    }
}
