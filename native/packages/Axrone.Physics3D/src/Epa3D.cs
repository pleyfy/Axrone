namespace Axrone.Physics3D;

/// <summary>
/// Expanding-polytope penetration queries over any two support-mapped
/// shapes. Starts from the tetrahedron captured by
/// <see cref="Gjk3D.TryCaptureOverlap{TA, TB}"/> and expands the closest
/// face until the support stops advancing, yielding the minimum-translation
/// direction, the depth, and witness-blended contact points. Polytope and
/// face buffers live on the stack with fixed caps; overflow settles on the
/// deepest face found so far instead of allocating.
/// </summary>
public static class Epa3D
{
    // Caps sized so a rounded difference set can be inscribed closely enough to
    // hold 1e-4 m at deep immersion (48 vertices bound the face count at
    // 2V - 4 = 92). The loop exits on convergence long before them, so raising
    // them costs stack, not measured time.
    private const int MaxIterations = 48;
    private const int MaxVertices = 48;
    private const int MaxFaces = 96;
    private const float AdvanceTolerance = 1e-4f;

    /// <summary>Keeps curved-point ids out of the clipped-face namespaces.</summary>
    private const uint EpaIdTag = 0x4500_0000u;

    /// <summary>Grid bits per normal axis; 64 cells is ~1.8 degrees.</summary>
    private const int NormalAxisBits = 6;

    /// <summary>Id path bit of a depth produced by expanding the polytope face.</summary>
    private const uint ExpandedFacePath = 0u;

    /// <summary>
    /// Id path bit of the zero-depth feature a disjoint-but-touching GJK run
    /// reports. It carries no penetration, so letting warm start move impulses
    /// across the boundary between the two would reuse the wrong contact.
    /// </summary>
    private const uint TouchFeaturePath = 1u;

    /// <summary>Polytope face: vertex indices with an outward unit normal and plane offset.</summary>
    private readonly record struct Face(int A, int B, int C, Vec3 Normal, float Offset);

    /// <summary>
    /// Computes penetration of two world-space shapes. Returns
    /// <see langword="true"/> with a single-point manifold while overlapping;
    /// disjoint shapes report <see langword="false"/>, and merely touching
    /// shapes report a zero-depth manifold with <see langword="true"/>.
    /// The normal points from the second shape toward the first.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static bool ComputePenetration<TA, TB>(TA shapeA, TB shapeB, out Manifold3D manifold)
        where TA : ISupportShape3D<TA>, allows ref struct
        where TB : ISupportShape3D<TB>, allows ref struct
    {
        Span<SimplexVertex> captured = stackalloc SimplexVertex[4];
        if (!Gjk3D.TryCaptureOverlap(in shapeA, in shapeB, captured, out int capturedCount) || capturedCount != 4)
        {
            if (Gjk3D.ComputeDistance(in shapeA, in shapeB, out _, out Vec3 pointA, out Vec3 pointB))
            {
                manifold = Manifold3D.Empty;
                return false;
            }

            Vec3 touchNormal = pointA - pointB;
            float touchLenSq = touchNormal.LengthSquared();
            Vec3 axis = touchLenSq > 1e-12f ? touchNormal / MathF.Sqrt(touchLenSq) : new Vec3(1.0f, 0.0f, 0.0f);
            manifold = Manifold3D.One(axis, new ContactPoint3D(pointA, pointB, 0.0f, PointId(FaceKey(axis), TouchFeaturePath)));
            return true;
        }

        Span<SimplexVertex> vertices = stackalloc SimplexVertex[MaxVertices];
        for (int i = 0; i < 4; i++)
        {
            vertices[i] = captured[i];
        }

        int vertexCount = 4;

        Span<Face> faces = stackalloc Face[MaxFaces];
        int faceCount = 0;
        AddFace(vertices, faces, ref faceCount, 0, 1, 2, 3);
        AddFace(vertices, faces, ref faceCount, 0, 3, 1, 2);
        AddFace(vertices, faces, ref faceCount, 0, 2, 3, 1);
        AddFace(vertices, faces, ref faceCount, 1, 3, 2, 0);

        Vec3 normal = new(1.0f, 0.0f, 0.0f);
        float depth = 0.0f;
        int closestA = 0;
        int closestB = 1;
        int closestC = 2;
        float closestWa = 1.0f;
        float closestWb = 0.0f;
        float closestWc = 0.0f;

        Span<int> visible = stackalloc int[MaxFaces];
        Span<int> horizonA = stackalloc int[MaxFaces];
        Span<int> horizonB = stackalloc int[MaxFaces];
        Span<Face> kept = stackalloc Face[MaxFaces];

        for (int iteration = 0; iteration < MaxIterations; iteration++)
        {
            int closest = 0;
            float best = float.PositiveInfinity;
            for (int i = 0; i < faceCount; i++)
            {
                if (faces[i].Offset < best)
                {
                    best = faces[i].Offset;
                    closest = i;
                }
            }

            Face face = faces[closest];
            Vec3 supportA = TA.Support(in shapeA, face.Normal);
            Vec3 supportB = TB.Support(in shapeB, face.Normal * -1.0f);
            Vec3 support = supportA - supportB;
            float advance = Vec3.Dot(support, face.Normal) - face.Offset;

            SimplexKernel3D.ClosestOnTriangle(
                vertices[face.A].Difference, vertices[face.B].Difference, vertices[face.C].Difference,
                out _, out float wa, out float wb, out float wc);
            normal = face.Normal;
            depth = face.Offset;
            closestA = face.A;
            closestB = face.B;
            closestC = face.C;
            closestWa = wa;
            closestWb = wb;
            closestWc = wc;

            if (advance < AdvanceTolerance || vertexCount >= MaxVertices)
            {
                break;
            }

            vertices[vertexCount] = new SimplexVertex(support, supportA, supportB);
            int fresh = vertexCount;
            vertexCount++;

            int visibleCount = 0;
            for (int i = 0; i < faceCount; i++)
            {
                Vec3 toNew = vertices[fresh].Difference - vertices[faces[i].A].Difference;
                if (Vec3.Dot(toNew, faces[i].Normal) > 1e-9f)
                {
                    visible[visibleCount++] = i;
                }
            }

            if (visibleCount == 0 || visibleCount == faceCount)
            {
                break;
            }

            int horizonCount = 0;
            for (int v = 0; v < visibleCount; v++)
            {
                Face doomed = faces[visible[v]];
                TryHorizonEdge(doomed.A, doomed.B, faces, faceCount, visible, visibleCount, horizonA, horizonB, ref horizonCount);
                TryHorizonEdge(doomed.B, doomed.C, faces, faceCount, visible, visibleCount, horizonA, horizonB, ref horizonCount);
                TryHorizonEdge(doomed.C, doomed.A, faces, faceCount, visible, visibleCount, horizonA, horizonB, ref horizonCount);
            }

            int keptCount = 0;
            for (int i = 0; i < faceCount; i++)
            {
                bool removed = false;
                for (int v = 0; v < visibleCount; v++)
                {
                    if (visible[v] == i)
                    {
                        removed = true;
                        break;
                    }
                }

                if (!removed)
                {
                    kept[keptCount++] = faces[i];
                }
            }

            for (int i = 0; i < keptCount; i++)
            {
                faces[i] = kept[i];
            }

            faceCount = keptCount;

            Vec3 interior = Vec3.Zero;
            for (int i = 0; i < vertexCount; i++)
            {
                interior += vertices[i].Difference;
            }

            interior /= MathF.Max(vertexCount, 1);

            for (int e = 0; e < horizonCount && faceCount < MaxFaces; e++)
            {
                AddOrientedFace(vertices, faces, ref faceCount, horizonA[e], horizonB[e], fresh, interior);
            }
        }

        Vec3 witnessA = (vertices[closestA].WitnessA * closestWa)
            + (vertices[closestB].WitnessA * closestWb)
            + (vertices[closestC].WitnessA * closestWc);
        Vec3 witnessB = (vertices[closestA].WitnessB * closestWa)
            + (vertices[closestB].WitnessB * closestWb)
            + (vertices[closestC].WitnessB * closestWc);
        Vec3 contactNormal = normal * -1.0f;
        manifold = Manifold3D.One(
            contactNormal,
            new ContactPoint3D(witnessA, witnessB, -depth, PointId(FaceKey(contactNormal), ExpandedFacePath)));
        return true;
    }

    /// <summary>
    /// Feature key of the contact: the converged face normal on a coarse grid.
    /// Translating either shape leaves the normal bit-identical, which simplex
    /// vertex indices are not — the expansion path reorders on a millimetre
    /// slide. The grid is ~1.8 degrees wide, far above the sub-degree jitter of
    /// a settling contact, so ordinary drift cannot cross a boundary and drop
    /// the impulses the id exists to protect, while a genuine feature change
    /// (face to rim, cap to side) lands in a different cell and stops the carry.
    /// </summary>
    private static uint FaceKey(in Vec3 normal) =>
        (QuantizeAxis(normal.X) << (2 * NormalAxisBits))
        | (QuantizeAxis(normal.Y) << NormalAxisBits)
        | QuantizeAxis(normal.Z);

    /// <summary>
    /// Maps one unit-vector component onto the normal grid. The half-cell bias
    /// matters: truncation puts the boundary exactly on every axis-aligned
    /// normal, so a contact sitting at x = -1e-8 one step and +1e-8 the next
    /// reads as a different feature and loses its carried impulses.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static uint QuantizeAxis(float component)
    {
        uint cells = 1u << NormalAxisBits;
        float scaled = (component + 1.0f) * (cells * 0.5f);
        if (scaled <= 0.0f)
        {
            return 0u;
        }

        uint cell = (uint)(scaled + 0.5f);
        return cell < cells ? cell : cells - 1u;
    }

    /// <summary>Point id: tagged normal key with the emission-path bit in the low bit, so no curved pair collapses onto the old zero and a zero-depth touch feature never donates impulses to a penetrated face.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static uint PointId(uint faceKey, uint path) => EpaIdTag | ((faceKey << 1) | path);

    /// <summary>Adds a face oriented away from the opposite vertex.</summary>
    private static void AddFace(
        Span<SimplexVertex> vertices, Span<Face> faces, ref int faceCount,
        int a, int b, int c, int opposite)
    {
        Vec3 ab = vertices[b].Difference - vertices[a].Difference;
        Vec3 ac = vertices[c].Difference - vertices[a].Difference;
        Vec3 normal = Vec3.Cross(ab, ac);
        if (Vec3.Dot(normal, vertices[opposite].Difference - vertices[a].Difference) > 0.0f)
        {
            (b, c) = (c, b);
            normal = normal * -1.0f;
        }

        float length = normal.Length();
        if (length <= 1e-24f || faceCount >= faces.Length)
        {
            return;
        }

        normal /= length;
        faces[faceCount++] = new Face(a, b, c, normal, Vec3.Dot(normal, vertices[a].Difference));
    }

    /// <summary>Adds a horizon face oriented away from the polytope interior.</summary>
    private static void AddOrientedFace(
        Span<SimplexVertex> vertices, Span<Face> faces, ref int faceCount,
        int a, int b, int fresh, Vec3 interior)
    {
        Vec3 ab = vertices[b].Difference - vertices[a].Difference;
        Vec3 af = vertices[fresh].Difference - vertices[a].Difference;
        Vec3 normal = Vec3.Cross(ab, af);
        if (Vec3.Dot(normal, interior - vertices[a].Difference) > 0.0f)
        {
            (a, b) = (b, a);
            normal = normal * -1.0f;
        }

        float length = normal.Length();
        if (length <= 1e-24f || faceCount >= faces.Length)
        {
            return;
        }

        normal /= length;
        faces[faceCount++] = new Face(a, b, fresh, normal, Vec3.Dot(normal, vertices[a].Difference));
    }

    /// <summary>Records a horizon edge shared by exactly one visible face.</summary>
    private static void TryHorizonEdge(
        int a, int b, Span<Face> faces, int faceCount,
        Span<int> visible, int visibleCount,
        Span<int> horizonA, Span<int> horizonB, ref int horizonCount)
    {
        int shared = 0;
        for (int v = 0; v < visibleCount; v++)
        {
            Face face = faces[visible[v]];
            if ((face.A == a && face.B == b) || (face.B == a && face.C == b) || (face.C == a && face.A == b) ||
                (face.A == b && face.B == a) || (face.B == b && face.C == a) || (face.C == b && face.A == a))
            {
                shared++;
            }
        }

        if (shared == 1 && horizonCount < horizonA.Length)
        {
            horizonA[horizonCount] = a;
            horizonB[horizonCount] = b;
            horizonCount++;
        }
    }
}
