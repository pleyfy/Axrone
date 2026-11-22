namespace Axrone.Physics3D;

/// <summary>
/// Zero-allocation, fully monomorphized Gilbert-Johnson-Keerthi (GJK) 3D distance and collision query.
/// Convergence tolerances, iteration budgets and observability inject through
/// compile-time policies, so each shape pair plus policy mix monomorphizes
/// into its own traversal with no virtual dispatch. Tetrahedral reduction
/// follows the shared kernel predicates.
/// </summary>
public static class Gjk3D
{
    /// <summary>
    /// Length resolution a Minkowski difference offers, as a fraction of the
    /// working scale of the simplex. Sits just under two orders above float32
    /// epsilon, covering the cancellation in supportA - supportB plus the dot
    /// products of the reduction. A gap below it is rounding, not geometry.
    /// </summary>
    private const float RelativeResolution = 1e-5f;

    /// <summary>
    /// Executes the monomorphized GJK distance query between any two support-mapped shapes.
    /// </summary>
    /// <param name="shapeA">The first shape.</param>
    /// <param name="shapeB">The second shape.</param>
    /// <param name="iterationLimit">Traversal budget; the policy default when zero.</param>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static GjkResult ComputeDistance<TShapeA, TShapeB, TPolicy, TObserver>(
        TShapeA shapeA,
        TShapeB shapeB,
        IterationLimit iterationLimit = default)
        where TShapeA : ISupportShape3D<TShapeA>, allows ref struct
        where TShapeB : ISupportShape3D<TShapeB>, allows ref struct
        where TPolicy : struct, IGjkConvergencePolicy<TPolicy>
        where TObserver : struct, IGjkObserver<TObserver>
    {
        Span<SimplexVertex> captured = stackalloc SimplexVertex[4];
        return Core<TShapeA, TShapeB, TPolicy, TObserver>(shapeA, shapeB, false, captured, out _, out _, out _, out _, iterationLimit);
    }

    /// <summary>
    /// Computes the distance between two shapes plus the attaining witness
    /// points. Returns <see langword="true"/> when the shapes are disjoint;
    /// touching or overlapping shapes report distance zero and
    /// <see langword="false"/>. Standard policy with diagnostics elided.
    /// </summary>
    /// <param name="shapeA">The first shape.</param>
    /// <param name="shapeB">The second shape.</param>
    /// <param name="distance">Non-negative separation; zero on contact or overlap.</param>
    /// <param name="pointA">Witness on the first shape.</param>
    /// <param name="pointB">Witness on the second shape.</param>
    /// <typeparam name="TA">First shape type.</typeparam>
    /// <typeparam name="TB">Second shape type.</typeparam>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static bool ComputeDistance<TA, TB>(
        in TA shapeA,
        in TB shapeB,
        out float distance,
        out Vec3 pointA,
        out Vec3 pointB)
        where TA : ISupportShape3D<TA>, allows ref struct
        where TB : ISupportShape3D<TB>, allows ref struct
    {
        GjkResult result = ComputeDistance<TA, TB, StandardGjkPolicy, NullGjkObserver>(
            shapeA, shapeB);
        distance = result.Distance.Value.Value;
        pointA = result.WitnessPointA;
        pointB = result.WitnessPointB;
        return result.IsDisjoint;
    }

    /// <summary>
    /// Runs the traversal capturing the enclosing tetrahedron on overlap for
    /// EPA expansion. Returns <see langword="true"/> with four simplex
    /// vertices when the shapes overlap.
    /// </summary>
    internal static bool TryCaptureTetrahedron<TShapeA, TShapeB, TPolicy>(
        TShapeA shapeA,
        TShapeB shapeB,
        Span<SimplexVertex> simplex,
        out int count)
        where TShapeA : ISupportShape3D<TShapeA>, allows ref struct
        where TShapeB : ISupportShape3D<TShapeB>, allows ref struct
        where TPolicy : struct, IGjkConvergencePolicy<TPolicy>
    {
        GjkResult result = Core<TShapeA, TShapeB, TPolicy, NullGjkObserver>(
            shapeA, shapeB, true, simplex, out count, out _, out _, out _);
        if (!result.IsOverlapping)
        {
            return false;
        }

        // ExpandToTetrahedron validates each seed it builds; a simplex that
        // already closed on the origin only needs the same check once.
        return count == 4
            ? EnclosesSeed(simplex)
            : ExpandToTetrahedron(shapeA, shapeB, simplex, ref count);
    }

    /// <summary>
    /// Runs the traversal capturing the enclosing tetrahedron on overlap for
    /// EPA expansion under the standard policy. Returns <see langword="true"/>
    /// with four simplex vertices when the shapes overlap.
    /// </summary>
    internal static bool TryCaptureOverlap<TA, TB>(
        in TA shapeA,
        in TB shapeB,
        Span<SimplexVertex> simplex,
        out int count)
        where TA : ISupportShape3D<TA>, allows ref struct
        where TB : ISupportShape3D<TB>, allows ref struct
    {
        return TryCaptureTetrahedron<TA, TB, StandardGjkPolicy>(
            shapeA, shapeB, simplex, out count);
    }

    /// <summary>Shared traversal: distance by default, tetrahedron capture for EPA on demand.</summary>
    private static GjkResult Core<TShapeA, TShapeB, TPolicy, TObserver>(
        TShapeA shapeA,
        TShapeB shapeB,
        bool capture,
        Span<SimplexVertex> captured,
        out int capturedCount,
        out float distance,
        out Vec3 pointA,
        out Vec3 pointB,
        IterationLimit iterationLimit = default)
        where TShapeA : ISupportShape3D<TShapeA>, allows ref struct
        where TShapeB : ISupportShape3D<TShapeB>, allows ref struct
        where TPolicy : struct, IGjkConvergencePolicy<TPolicy>
        where TObserver : struct, IGjkObserver<TObserver>
    {
        IterationLimit limit = iterationLimit.Value == 0 ? TPolicy.DefaultIterationLimit : iterationLimit;

        Vec3 centroidA = TShapeA.ComputeCentroid(in shapeA);
        Vec3 centroidB = TShapeB.ComputeCentroid(in shapeB);

        Vec3 initialDirection = centroidB - centroidA;
        if (LengthSquared(initialDirection).Value.Value < TPolicy.ZeroDirectionEpsilon.Value.Value)
        {
            initialDirection = new Vec3(1.0f, 0.0f, 0.0f);
        }

        Simplex3D simplex = default;
        Span<float> weights = stackalloc float[3];

        Vec3 firstA = TShapeA.Support(in shapeA, initialDirection);
        Vec3 firstB = TShapeB.Support(in shapeB, initialDirection * -1.0f);
        SimplexVertex first = SimplexVertex.Create(firstA, firstB);
        simplex.Add(first);
        float workingScaleSq = LengthSquared(first.Difference).Value.Value;

        DistanceSquared bestDistSq = DistanceSquared.PositiveInfinity;
        Vec3 bestA = firstA;
        Vec3 bestB = firstB;
        Vec3 bestClosest = firstA - firstB;

        IterationCount currentIteration = IterationCount.Zero;
        GjkStatus exitStatus = GjkStatus.MaxIterationsExceeded;
        capturedCount = 0;

        while (!limit.HasReached(currentIteration))
        {
            currentIteration = IterationCount.Increment(currentIteration);

            if (Reduce(ref simplex, weights, out Vec3 closest))
            {
                exitStatus = GjkStatus.TouchingOrOverlapping;
                FinishCapture(capture, ref simplex, captured, out capturedCount);
                bestA = BlendWitnesses(ref simplex, true);
                bestB = BlendWitnesses(ref simplex, false);
                bestClosest = Vec3.Zero;
                bestDistSq = DistanceSquared.Zero;
                break;
            }

            DistanceSquared distSq = LengthSquared(closest);
            TObserver.OnIteration(currentIteration, distSq, closest * -1.0f);

            if (distSq.Value.Value <= OriginToleranceSq(TPolicy.OverlapTolerance.Value.Value, workingScaleSq))
            {
                exitStatus = GjkStatus.TouchingOrOverlapping;
                FinishCapture(capture, ref simplex, captured, out capturedCount);
                bestDistSq = DistanceSquared.Zero;
                bestClosest = Vec3.Zero;
                break;
            }

            if (distSq.Value.Value >= bestDistSq.Value.Value - TPolicy.ImprovementTolerance.Value)
            {
                exitStatus = GjkStatus.Disjoint;
                FinishCapture(capture, ref simplex, captured, out capturedCount);
                break;
            }

            bestDistSq = distSq;
            bestA = BlendWitnesses(ref simplex, true);
            bestB = BlendWitnesses(ref simplex, false);
            bestClosest = closest;

            Vec3 searchDirection = closest * -1.0f;
            Vec3 supportA = TShapeA.Support(in shapeA, searchDirection);
            Vec3 supportB = TShapeB.Support(in shapeB, searchDirection * -1.0f);
            SimplexVertex candidate = SimplexVertex.Create(supportA, supportB);

            bool duplicate = simplex.ContainsDuplicate(candidate.Difference, TPolicy.DuplicateTolerance);
            if (duplicate)
            {
                exitStatus = GjkStatus.Disjoint;
                FinishCapture(capture, ref simplex, captured, out capturedCount);
                break;
            }

            workingScaleSq = MathF.Max(workingScaleSq, LengthSquared(candidate.Difference).Value.Value);
            simplex.Add(candidate);
        }

        if (!capture)
        {
            capturedCount = 0;
        }
        else if (exitStatus != GjkStatus.TouchingOrOverlapping)
        {
            FinishCapture(capture, ref simplex, captured, out capturedCount);
        }

        Distance finalDistance = exitStatus == GjkStatus.TouchingOrOverlapping
            ? Distance.Zero
            : bestDistSq.ToDistance();

        Vec3 separatingAxis = NormalizeOr(bestClosest, new Vec3(1.0f, 0.0f, 0.0f));
        TObserver.OnTerminated(exitStatus, currentIteration, finalDistance);

        distance = finalDistance.Value.Value;
        pointA = bestA;
        pointB = bestB;
        return new GjkResult(exitStatus, finalDistance, bestA, bestB, separatingAxis, currentIteration);
    }

    /// <summary>Blends witnesses of the reduced simplex with stored weights.</summary>
    private static Vec3 BlendWitnesses(ref Simplex3D simplex, bool first)
    {
        uint count = simplex.Count;
        if (count == 1)
        {
            return first ? simplex[0].WitnessA : simplex[0].WitnessB;
        }

        SimplexKernel3D.ClosestOnEdge(
            ToKernel(simplex[0]), ToKernel(simplex[1]), out _, out float w1, out float w2);
        if (count == 2)
        {
            Vec3 a = first ? simplex[0].WitnessA : simplex[0].WitnessB;
            Vec3 b = first ? simplex[1].WitnessA : simplex[1].WitnessB;
            return (a * w1) + (b * w2);
        }

        SimplexKernel3D.ClosestOnTriangle(
            simplex[0].Difference, simplex[1].Difference, simplex[2].Difference,
            out _, out float wa, out float wb, out float wc);
        Vec3 pa = first ? simplex[0].WitnessA : simplex[0].WitnessB;
        Vec3 pb = first ? simplex[1].WitnessA : simplex[1].WitnessB;
        Vec3 pc = first ? simplex[2].WitnessA : simplex[2].WitnessB;
        return (pa * wa) + (pb * wb) + (pc * wc);
    }

    /// <summary>Converts a buffer vertex to its kernel twin.</summary>
    private static SimplexKernel3D.Vertex ToKernel(SimplexVertex vertex) =>
        new(vertex.Difference, vertex.WitnessA, vertex.WitnessB);

    /// <summary>Reduces the simplex to its closest feature; returns true on containment (overlap).</summary>
    /// <returns><see langword="true"/> when the origin is enclosed; the caller reports overlap.</returns>
    private static bool Reduce(ref Simplex3D simplex, Span<float> weights, out Vec3 closest)
    {
        uint count = simplex.Count;
        if (count == 1)
        {
            closest = simplex[0].Difference;
            weights[0] = 1.0f;
            return false;
        }

        if (count == 2)
        {
            SimplexKernel3D.ClosestOnEdge(
                ToKernel(simplex[0]), ToKernel(simplex[1]), out closest, out float w1, out float w2);
            if (w1 == 1.0f)
            {
                simplex.Set1(simplex[0]);
            }
            else if (w2 == 1.0f)
            {
                simplex.Set1(simplex[1]);
            }

            weights[0] = w1;
            weights[1] = w2;
            return false;
        }

        if (count == 3)
        {
            SimplexKernel3D.ClosestOnTriangle(
                simplex[0].Difference, simplex[1].Difference, simplex[2].Difference,
                out closest, out float wa, out float wb, out float wc);
            weights[0] = wa;
            weights[1] = wb;
            weights[2] = wc;
            CompactTriangle(ref simplex, wa, wb, wc);
            return false;
        }

        Vec3 a = simplex[0].Difference;
        Vec3 b = simplex[1].Difference;
        Vec3 c = simplex[2].Difference;
        Vec3 d = simplex[3].Difference;

        if (SimplexKernel3D.TetrahedronContainsOrigin(a, b, c, d))
        {
            closest = Vec3.Zero;
            return true;
        }

        SimplexVertex v0 = simplex[0];
        SimplexVertex v1 = simplex[1];
        SimplexVertex v2 = simplex[2];
        SimplexVertex v3 = simplex[3];
        if (SimplexKernel3D.OutsideFace(a, b, c, d))
        {
            simplex.Set3(v0, v1, v2);
        }
        else if (SimplexKernel3D.OutsideFace(a, c, d, b))
        {
            simplex.Set3(v0, v2, v3);
        }
        else if (SimplexKernel3D.OutsideFace(a, d, b, c))
        {
            simplex.Set3(v0, v3, v1);
        }
        else
        {
            simplex.Set3(v1, v3, v2);
        }

        SimplexKernel3D.ClosestOnTriangle(
            simplex[0].Difference, simplex[1].Difference, simplex[2].Difference,
            out closest, out float ta, out float tb, out float tc);
        weights[0] = ta;
        weights[1] = tb;
        weights[2] = tc;
        CompactTriangle(ref simplex, ta, tb, tc);
        return false;
    }

    /// <summary>Drops zero-weight vertices of a triangle reduction so the simplex stays minimal.</summary>
    private static void CompactTriangle(ref Simplex3D simplex, float wa, float wb, float wc)
    {
        if (wa == 0.0f)
        {
            SimplexVertex b = simplex[1];
            SimplexVertex c = simplex[2];
            simplex.Set2(b, c);
        }
        else if (wb == 0.0f)
        {
            SimplexVertex a = simplex[0];
            SimplexVertex c = simplex[2];
            simplex.Set2(a, c);
        }
        else if (wc == 0.0f)
        {
            SimplexVertex a = simplex[0];
            SimplexVertex b = simplex[1];
            simplex.Set2(a, b);
        }
    }

    /// <summary>Copies the boundary simplex for EPA bootstrap on capture runs.</summary>
    private static void FinishCapture(
        bool capture, ref Simplex3D simplex,
        Span<SimplexVertex> captured, out int capturedCount)
    {
        capturedCount = 0;
        if (!capture)
        {
            return;
        }

        uint count = simplex.Count;
        int copy = (int)Math.Min(count, (uint)captured.Length);
        for (int i = 0; i < copy; i++)
        {
            captured[i] = simplex[(uint)i];
        }

        capturedCount = copy;
    }

    /// <summary>
    /// Expands a boundary simplex to a tetrahedron with face-normal supports,
    /// mirroring the reference EPA bootstrap for flat-faced shapes whose
    /// supports repeat before enclosure.
    /// </summary>
    private static bool ExpandToTetrahedron<TShapeA, TShapeB>(
        TShapeA shapeA, TShapeB shapeB,
        Span<SimplexVertex> simplex, ref int count)
        where TShapeA : ISupportShape3D<TShapeA>, allows ref struct
        where TShapeB : ISupportShape3D<TShapeB>, allows ref struct
    {
        if (count >= 4 || simplex.Length < 4)
        {
            return count == 4;
        }

        if (count == 0)
        {
            return false;
        }

        if (count == 1)
        {
            Vec3 d = simplex[0].Difference;
            Vec3 axis = d.LengthSquared() > 1e-12f ? Vec3.Normalize(d) : new Vec3(1.0f, 0.0f, 0.0f);
            Vec3 perp = MathF.Abs(axis.Y) < 0.99f ? new Vec3(0.0f, 1.0f, 0.0f) : new Vec3(1.0f, 0.0f, 0.0f);
            Vec3 side = Vec3.Normalize(Vec3.Cross(axis, perp));
            Vec3 other = Vec3.Normalize(Vec3.Cross(axis, side));
            int apex = count;
            AddSupport(shapeA, shapeB, axis, simplex, ref count);
            AddSupport(shapeA, shapeB, axis * -1.0f, simplex, ref count);
            AddSupport(shapeA, shapeB, side, simplex, ref count);
            if (count == 4 && EnclosesSeed(simplex))
            {
                return true;
            }

            count = apex;
            AddSupport(shapeA, shapeB, axis, simplex, ref count);
            AddSupport(shapeA, shapeB, axis * -1.0f, simplex, ref count);
            AddSupport(shapeA, shapeB, other, simplex, ref count);
            return count == 4 && EnclosesSeed(simplex);
        }

        if (count == 2)
        {
            Vec3 edge = simplex[1].Difference - simplex[0].Difference;
            if (edge.LengthSquared() <= 1e-24f)
            {
                return false;
            }

            Vec3 reference = MathF.Abs(edge.Y) < 0.99f ? new Vec3(0.0f, 1.0f, 0.0f) : new Vec3(1.0f, 0.0f, 0.0f);
            Vec3 n1 = Vec3.Normalize(Vec3.Cross(edge, reference));
            Vec3 n2 = Vec3.Cross(edge, n1);
            int apex = count;
            AddSupport(shapeA, shapeB, n1, simplex, ref count);
            AddSupport(shapeA, shapeB, n2, simplex, ref count);
            if (count == 4 && EnclosesSeed(simplex))
            {
                return true;
            }

            count = apex;
            AddSupport(shapeA, shapeB, n1 * -1.0f, simplex, ref count);
            AddSupport(shapeA, shapeB, n2, simplex, ref count);
            return count == 4 && EnclosesSeed(simplex);
        }

        Vec3 ab = simplex[1].Difference - simplex[0].Difference;
        Vec3 ac = simplex[2].Difference - simplex[0].Difference;
        Vec3 normal = Vec3.Cross(ab, ac);
        if (normal.LengthSquared() <= 1e-24f)
        {
            return false;
        }

        normal = Vec3.Normalize(normal);
        int apexSlot = count;
        AddSupport(shapeA, shapeB, normal, simplex, ref count);
        if (count == 4 && EnclosesSeed(simplex))
        {
            return true;
        }

        count = apexSlot;
        AddSupport(shapeA, shapeB, normal * -1.0f, simplex, ref count);
        return count == 4 && EnclosesSeed(simplex);
    }

    /// <summary>Adds a Minkowski support vertex along a direction.</summary>
    private static void AddSupport<TShapeA, TShapeB>(
        TShapeA shapeA, TShapeB shapeB, Vec3 direction,
        Span<SimplexVertex> simplex, ref int count)
        where TShapeA : ISupportShape3D<TShapeA>, allows ref struct
        where TShapeB : ISupportShape3D<TShapeB>, allows ref struct
    {
        if (count >= simplex.Length)
        {
            return;
        }

        Vec3 supportA = TShapeA.Support(in shapeA, direction);
        Vec3 supportB = TShapeB.Support(in shapeB, direction * -1.0f);
        simplex[count++] = new SimplexVertex(supportA - supportB, supportA, supportB);
    }

    /// <summary>Validates a bootstrapped EPA seed: real volume, origin inside or within the resolution band.</summary>
    private static bool EnclosesSeed(Span<SimplexVertex> simplex) =>
        SimplexKernel3D.TetrahedronEnclosesOriginForSeed(
            simplex[0].Difference, simplex[1].Difference, simplex[2].Difference, simplex[3].Difference,
            RelativeResolution);

    /// <summary>Squared length as a domain nominal.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static DistanceSquared LengthSquared(in Vec3 vector) =>
        DistanceSquared.From(Vec3.Dot(vector, vector));

    /// <summary>
    /// Squared distance below which a remaining gap is float32 rounding rather
    /// than geometry. Minkowski supports are differences of world coordinates,
    /// so the resolution of the stored distance scales with the simplex: a
    /// half-metre prism inside a twenty-metre slab resolves nothing below about
    /// 1.4e-4 m, roughly thirty times under the engine's own 5 mm contact slop.
    /// Flat-faced pairs cannot enclose the origin at all, which makes this the
    /// only overlap signal they have; an absolute threshold under the
    /// cancellation floor turns the decision into rounding noise. The policy
    /// tolerance remains the absolute floor so scale-free probes keep their
    /// declared precision.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static float OriginToleranceSq(float absolute, float workingScaleSq)
    {
        float relative = workingScaleSq * (RelativeResolution * RelativeResolution);
        return absolute > relative ? absolute : relative;
    }

    /// <summary>Unit vector with a fallback for degenerate inputs.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static Vec3 NormalizeOr(in Vec3 vector, in Vec3 fallback)
    {
        float lengthSq = Vec3.Dot(vector, vector);
        if (lengthSq <= 1e-18f)
        {
            return fallback;
        }

        return vector * (1.0f / MathF.Sqrt(lengthSq));
    }
}
