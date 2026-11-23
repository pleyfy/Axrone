namespace Axrone.Physics3D;

/// <summary>
/// Closest-point primitives over Minkowski-difference simplices in 3D.
/// Edge and triangle reductions follow Ericson's region tests; the
/// tetrahedron test reports containment, which GJK treats as overlap.
/// </summary>
internal static class SimplexKernel3D
{
    /// <summary>One simplex vertex: the difference point plus its witnesses on each shape.</summary>
    /// <param name="Difference">Support of A minus support of B.</param>
    /// <param name="PointA">Witness on the first shape.</param>
    /// <param name="PointB">Witness on the second shape.</param>
    internal readonly record struct Vertex(Vec3 Difference, Vec3 PointA, Vec3 PointB);

    /// <summary>Closest point on edge (u, v) with reduction weights.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static void ClosestOnEdge(in Vertex u, in Vertex v, out Vec3 closest, out float w1, out float w2)
    {
        Vec3 ab = v.Difference - u.Difference;
        float denom = Vec3.Dot(ab, ab);
        if (denom <= 1e-24f)
        {
            closest = u.Difference;
            w1 = 1.0f;
            w2 = 0.0f;
            return;
        }

        float t = Vec3.Dot(u.Difference * -1.0f, ab) / denom;
        if (t <= 0.0f)
        {
            closest = u.Difference;
            w1 = 1.0f;
            w2 = 0.0f;
        }
        else if (t >= 1.0f)
        {
            closest = v.Difference;
            w1 = 0.0f;
            w2 = 1.0f;
        }
        else
        {
            closest = u.Difference + (ab * t);
            w1 = 1.0f - t;
            w2 = t;
        }
    }

    /// <summary>Closest point on triangle (a, b, c) with barycentric weights.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static void ClosestOnTriangle(
        Vec3 a, Vec3 b, Vec3 c,
        out Vec3 closest, out float wa, out float wb, out float wc)
    {
        Vec3 ab = b - a;
        Vec3 ac = c - a;
        Vec3 ap = a * -1.0f;

        float d1 = Vec3.Dot(ab, ap);
        float d2 = Vec3.Dot(ac, ap);
        if (d1 <= 0.0f && d2 <= 0.0f)
        {
            closest = a;
            wa = 1.0f; wb = 0.0f; wc = 0.0f;
            return;
        }

        Vec3 bp = b * -1.0f;
        float d3 = Vec3.Dot(ab, bp);
        float d4 = Vec3.Dot(ac, bp);
        if (d3 >= 0.0f && d4 <= d3)
        {
            closest = b;
            wa = 0.0f; wb = 1.0f; wc = 0.0f;
            return;
        }

        float vc = (d1 * d4) - (d3 * d2);
        if (vc <= 0.0f && d1 >= 0.0f && d3 <= 0.0f)
        {
            float v = d1 / (d1 - d3);
            closest = a + (ab * v);
            wa = 1.0f - v; wb = v; wc = 0.0f;
            return;
        }

        Vec3 cp = c * -1.0f;
        float d5 = Vec3.Dot(ab, cp);
        float d6 = Vec3.Dot(ac, cp);
        if (d6 >= 0.0f && d5 <= d6)
        {
            closest = c;
            wa = 0.0f; wb = 0.0f; wc = 1.0f;
            return;
        }

        float vb = (d5 * d2) - (d1 * d6);
        if (vb <= 0.0f && d2 >= 0.0f && d6 <= 0.0f)
        {
            float w = d2 / (d2 - d6);
            closest = a + (ac * w);
            wa = 1.0f - w; wb = 0.0f; wc = w;
            return;
        }

        float va = (d3 * d6) - (d5 * d4);
        if (va <= 0.0f && (d4 - d3) >= 0.0f && (d5 - d6) >= 0.0f)
        {
            float w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            closest = b + ((c - b) * w);
            wa = 0.0f; wb = 1.0f - w; wc = w;
            return;
        }

        float denom = 1.0f / (va + vb + vc);
        float v2 = vb * denom;
        float w2 = vc * denom;
        closest = a + (ab * v2) + (ac * w2);
        wa = 1.0f - v2 - w2; wb = v2; wc = w2;
    }

    /// <summary>Whether the origin lies inside tetrahedron (a, b, c, d).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static bool TetrahedronContainsOrigin(Vec3 a, Vec3 b, Vec3 c, Vec3 d)
    {
        return !OutsideFace(a, b, c, d)
            && !OutsideFace(a, c, d, b)
            && !OutsideFace(a, d, b, c)
            && !OutsideFace(b, d, c, a);
    }

    /// <summary>Whether the origin sits outside face (p0, p1, p2) relative to the opposite vertex.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static bool OutsideFace(Vec3 p0, Vec3 p1, Vec3 p2, Vec3 opposite)
    {
        Vec3 normal = Vec3.Cross(p1 - p0, p2 - p0);
        if (Vec3.Dot(normal, opposite - p0) > 0.0f)
        {
            normal = normal * -1.0f;
        }

        return Vec3.Dot(normal, p0 * -1.0f) > 0.0f;
    }

    /// <summary>
    /// Whether a tetrahedron is a usable EPA seed: non-degenerate volume and
    /// the origin inside, or within one relative resolution of a face.
    /// </summary>
    /// <remarks>
    /// A degenerate overlap — a prism resting on a slab — drives GJK to a
    /// terminating feature whose plane passes through the origin, so every
    /// tetrahedron bootstrapped from it has the origin on a face and the exact
    /// sign tests above can never accept. The relaxed band is expressed as a
    /// length relative to the seed size, which float32 cannot resolve anyway;
    /// EPA's first expansion then re-establishes real volume around the origin.
    /// Kept separate from <see cref="TetrahedronContainsOrigin"/> so the GJK
    /// reduction keeps its exact, normalization-free hot test.
    /// </remarks>
    internal static bool TetrahedronEnclosesOriginForSeed(
        Vec3 a, Vec3 b, Vec3 c, Vec3 d, float slack)
    {
        Vec3 ab = b - a;
        Vec3 ac = c - a;
        Vec3 ad = d - a;
        Vec3 cross = Vec3.Cross(ab, ac);
        float volume = Vec3.Dot(cross, ad);
        float area = cross.Length();
        float edge = MathF.Max(ab.Length(), MathF.Max(ac.Length(), ad.Length()));
        if (area <= 1e-24f || edge <= 1e-12f || MathF.Abs(volume) <= area * 1e-12f)
        {
            return false;
        }

        float tolerance = slack * edge * area;
        return FaceEnclosesOrigin(a, b, c, d, tolerance)
            && FaceEnclosesOrigin(a, c, d, b, tolerance)
            && FaceEnclosesOrigin(a, d, b, c, tolerance)
            && FaceEnclosesOrigin(b, d, c, a, tolerance);
    }

    /// <summary>One face of the seed test, signed against the origin with the opposite vertex setting the inside side.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static bool FaceEnclosesOrigin(Vec3 p0, Vec3 p1, Vec3 p2, Vec3 opposite, float tolerance)
    {
        Vec3 normal = Vec3.Cross(p1 - p0, p2 - p0);
        if (Vec3.Dot(normal, opposite - p0) > 0.0f)
        {
            normal = normal * -1.0f;
        }

        return Vec3.Dot(normal, p0 * -1.0f) <= tolerance;
    }
}
