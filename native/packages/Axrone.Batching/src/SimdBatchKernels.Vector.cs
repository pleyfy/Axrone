namespace Axrone.Batching;

/// <summary>
/// Batch vector kernels: quaternion product, dot, cross, normalization.
/// </summary>
/// <remarks>
/// Span-in/span-out over engine types. Only <see cref="BatchDot3"/> keeps a vector path — it stores
/// one float per lane with no scatter-back, and measures ~2.3x faster than scalar. The quaternion,
/// cross and normalize gathers measured slower than their scalar loops at every size
/// (see <c>VectorKernelBenchmarks</c>) and stay scalar. Normalization is guarded: a zero-length
/// input writes <see cref="Vec4.Zero"/> instead of NaN.
/// </remarks>
public static unsafe partial class SimdBatchKernels
{
    /// <summary>Length-squared below which a vector counts as zero and normalizes to zero.</summary>
    private const float NormalizeEpsilon = 1e-12f;

    /// <summary>
    /// Multiplies quaternion pairs: <c>destination[i] = left[i] * right[i]</c>.
    /// </summary>
    /// <param name="left">First fentities.</param>
    /// <param name="right">Second fentities.</param>
    /// <param name="destination">Receives the products; must be at least <paramref name="left"/>.Length.</param>
    /// <exception cref="ArgumentException">A span is shorter than <paramref name="left"/>.</exception>
    /// <remarks>
    /// Deliberately scalar: the 8-wide gather version measured ~1.6-2x slower than this loop
    /// (see <c>VectorKernelBenchmarks</c>). The gather plus the per-lane scatter-back cost more
    /// than the Hamilton product saves.
    /// </remarks>
    public static void QuaternionMultiply(ReadOnlySpan<Quat> left, ReadOnlySpan<Quat> right, Span<Quat> destination)
    {
        ThrowHelper.ValidateBinarySpans(left, right, destination);

        for (var i = 0; i < left.Length; i++)
        {
            destination[i] = Quat.Multiply(left[i], right[i]);
        }
    }

    /// <summary>
    /// Computes pairwise dot products.
    /// </summary>
    /// <param name="left">First vectors.</param>
    /// <param name="right">Second vectors.</param>
    /// <param name="destination">Receives the dots; must be at least <paramref name="left"/>.Length.</param>
    /// <exception cref="ArgumentException">A span is shorter than <paramref name="left"/>.</exception>
    public static void BatchDot3(ReadOnlySpan<Vec3> left, ReadOnlySpan<Vec3> right, Span<float> destination)
    {
        ThrowHelper.ValidateBinarySpans(left, right, destination);

        var count = (nuint)left.Length;
        if (count == 0)
        {
            return;
        }

        ref float leftBase = ref MemoryMarshal.GetReference(MemoryMarshal.Cast<Vec3, float>(left));
        ref float rightBase = ref MemoryMarshal.GetReference(MemoryMarshal.Cast<Vec3, float>(right));
        ref float targetBase = ref MemoryMarshal.GetReference(destination);
        nuint index = 0;

        // No 512-bit tier: it measured identical to 256-bit here while carrying the same
        // downclock risk that regressed IntegrateVelocity ~2x; see GeometryKernelBenchmarks.
        if (Vector256.IsHardwareAccelerated && count - index >= 8)
        {
            nuint step = 8, limit = count - step + 1;
            for (; index < limit; index += step)
            {
                var offset = index * 3;

                var ax = Vector256.Create(
                    Unsafe.Add(ref leftBase, offset), Unsafe.Add(ref leftBase, offset + 3),
                    Unsafe.Add(ref leftBase, offset + 6), Unsafe.Add(ref leftBase, offset + 9),
                    Unsafe.Add(ref leftBase, offset + 12), Unsafe.Add(ref leftBase, offset + 15),
                    Unsafe.Add(ref leftBase, offset + 18), Unsafe.Add(ref leftBase, offset + 21));
                var ay = Vector256.Create(
                    Unsafe.Add(ref leftBase, offset + 1), Unsafe.Add(ref leftBase, offset + 4),
                    Unsafe.Add(ref leftBase, offset + 7), Unsafe.Add(ref leftBase, offset + 10),
                    Unsafe.Add(ref leftBase, offset + 13), Unsafe.Add(ref leftBase, offset + 16),
                    Unsafe.Add(ref leftBase, offset + 19), Unsafe.Add(ref leftBase, offset + 22));
                var az = Vector256.Create(
                    Unsafe.Add(ref leftBase, offset + 2), Unsafe.Add(ref leftBase, offset + 5),
                    Unsafe.Add(ref leftBase, offset + 8), Unsafe.Add(ref leftBase, offset + 11),
                    Unsafe.Add(ref leftBase, offset + 14), Unsafe.Add(ref leftBase, offset + 17),
                    Unsafe.Add(ref leftBase, offset + 20), Unsafe.Add(ref leftBase, offset + 23));

                var bx = Vector256.Create(
                    Unsafe.Add(ref rightBase, offset), Unsafe.Add(ref rightBase, offset + 3),
                    Unsafe.Add(ref rightBase, offset + 6), Unsafe.Add(ref rightBase, offset + 9),
                    Unsafe.Add(ref rightBase, offset + 12), Unsafe.Add(ref rightBase, offset + 15),
                    Unsafe.Add(ref rightBase, offset + 18), Unsafe.Add(ref rightBase, offset + 21));
                var by = Vector256.Create(
                    Unsafe.Add(ref rightBase, offset + 1), Unsafe.Add(ref rightBase, offset + 4),
                    Unsafe.Add(ref rightBase, offset + 7), Unsafe.Add(ref rightBase, offset + 10),
                    Unsafe.Add(ref rightBase, offset + 13), Unsafe.Add(ref rightBase, offset + 16),
                    Unsafe.Add(ref rightBase, offset + 19), Unsafe.Add(ref rightBase, offset + 22));
                var bz = Vector256.Create(
                    Unsafe.Add(ref rightBase, offset + 2), Unsafe.Add(ref rightBase, offset + 5),
                    Unsafe.Add(ref rightBase, offset + 8), Unsafe.Add(ref rightBase, offset + 11),
                    Unsafe.Add(ref rightBase, offset + 14), Unsafe.Add(ref rightBase, offset + 17),
                    Unsafe.Add(ref rightBase, offset + 20), Unsafe.Add(ref rightBase, offset + 23));

                Vector256.Add(
                    Vector256.Add(Vector256.Multiply(ax, bx), Vector256.Multiply(ay, by)),
                    Vector256.Multiply(az, bz)).StoreUnsafe(ref targetBase, index);
            }
        }

        if (Vector128.IsHardwareAccelerated && count - index >= 4)
        {
            nuint step = 4, limit = count - step + 1;
            for (; index < limit; index += step)
            {
                var offset = index * 3;

                var ax = Vector128.Create(
                    Unsafe.Add(ref leftBase, offset), Unsafe.Add(ref leftBase, offset + 3),
                    Unsafe.Add(ref leftBase, offset + 6), Unsafe.Add(ref leftBase, offset + 9));
                var ay = Vector128.Create(
                    Unsafe.Add(ref leftBase, offset + 1), Unsafe.Add(ref leftBase, offset + 4),
                    Unsafe.Add(ref leftBase, offset + 7), Unsafe.Add(ref leftBase, offset + 10));
                var az = Vector128.Create(
                    Unsafe.Add(ref leftBase, offset + 2), Unsafe.Add(ref leftBase, offset + 5),
                    Unsafe.Add(ref leftBase, offset + 8), Unsafe.Add(ref leftBase, offset + 11));

                var bx = Vector128.Create(
                    Unsafe.Add(ref rightBase, offset), Unsafe.Add(ref rightBase, offset + 3),
                    Unsafe.Add(ref rightBase, offset + 6), Unsafe.Add(ref rightBase, offset + 9));
                var by = Vector128.Create(
                    Unsafe.Add(ref rightBase, offset + 1), Unsafe.Add(ref rightBase, offset + 4),
                    Unsafe.Add(ref rightBase, offset + 7), Unsafe.Add(ref rightBase, offset + 10));
                var bz = Vector128.Create(
                    Unsafe.Add(ref rightBase, offset + 2), Unsafe.Add(ref rightBase, offset + 5),
                    Unsafe.Add(ref rightBase, offset + 8), Unsafe.Add(ref rightBase, offset + 11));

                Vector128.Add(
                    Vector128.Add(Vector128.Multiply(ax, bx), Vector128.Multiply(ay, by)),
                    Vector128.Multiply(az, bz)).StoreUnsafe(ref targetBase, index);
            }
        }

        for (; index < count; index++)
        {
            Unsafe.Add(ref targetBase, index) = Vec3.Dot(left[(int)index], right[(int)index]);
        }
    }

    /// <summary>
    /// Computes pairwise cross products.
    /// </summary>
    /// <param name="left">First vectors.</param>
    /// <param name="right">Second vectors.</param>
    /// <param name="destination">Receives the crosses; must be at least <paramref name="left"/>.Length.</param>
    /// <exception cref="ArgumentException">A span is shorter than <paramref name="left"/>.</exception>
    /// <remarks>
    /// Deliberately scalar: the 8-wide gather version measured ~1.3-1.7x slower than this loop
    /// (see <c>VectorKernelBenchmarks</c>). Nine gathered lanes in, nine scattered lanes out —
    /// the transpose is the whole cost.
    /// </remarks>
    public static void BatchCross3(ReadOnlySpan<Vec3> left, ReadOnlySpan<Vec3> right, Span<Vec3> destination)
    {
        ThrowHelper.ValidateBinarySpans(left, right, destination);

        for (var i = 0; i < left.Length; i++)
        {
            destination[i] = Vec3.Cross(left[i], right[i]);
        }
    }

    /// <summary>
    /// Normalizes vectors; zero-length inputs write <see cref="Vec4.Zero"/>.
    /// </summary>
    /// <param name="source">Vectors to normalize.</param>
    /// <param name="destination">Receives the results; must be at least <paramref name="source"/>.Length.</param>
    /// <exception cref="ArgumentException"><paramref name="destination"/> is shorter than <paramref name="source"/>.</exception>
    /// <remarks>
    /// Deliberately scalar: the 8-wide gather version measured slower up to 1024 elements and only
    /// ~1.2x faster at 16384 (see <c>VectorKernelBenchmarks</c>) — too narrow a win for the
    /// transpose cost it pays everywhere else.
    /// </remarks>
    public static void Normalize4(ReadOnlySpan<Vec4> source, Span<Vec4> destination)
    {
        ThrowHelper.ValidateDestinationSpan(source, destination);

        for (var i = 0; i < source.Length; i++)
        {
            var v = source[i];
            destination[i] = v.LengthSquared() > NormalizeEpsilon
                ? Vec4.Normalize(v)
                : Vec4.Zero;
        }
    }

    /// <summary>
    /// Normalizes 3D vectors; zero-length inputs write <see cref="Vec3.Zero"/>.
    /// </summary>
    /// <param name="source">Vectors to normalize.</param>
    /// <param name="destination">Receives the results; must be at least <paramref name="source"/>.Length.</param>
    /// <exception cref="ArgumentException"><paramref name="destination"/> is shorter than <paramref name="source"/>.</exception>
    public static void Normalize3(ReadOnlySpan<Vec3> source, Span<Vec3> destination)
    {
        ThrowHelper.ValidateDestinationSpan(source, destination);

        for (var i = 0; i < source.Length; i++)
        {
            var v = source[i];
            var lengthSquared = v.LengthSquared();
            destination[i] = lengthSquared > NormalizeEpsilon
                ? Vec3.Normalize(v)
                : Vec3.Zero;
        }
    }
}
