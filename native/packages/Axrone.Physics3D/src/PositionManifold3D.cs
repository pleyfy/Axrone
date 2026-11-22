namespace Axrone.Physics3D;

/// <summary>
/// One contact point bound to the bodies that carry it: both witnesses in the
/// frame of their own body, plus the separation baseline holding the
/// narrowphase depth against that offset. Resolving the anchors through the
/// live frames reports where the surfaces are now instead of where the
/// snapshot left them, so a sweep measures the moment rather than replaying
/// it. Feature identity and the shared normal never enter; the manifold keeps
/// those.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal readonly struct PositionGeometry3D
{
    /// <summary>Witness on the first shape in the first body's frame at capture.</summary>
    public readonly Vec3 LocalA;

    /// <summary>Witness on the second shape in the second body's frame at capture.</summary>
    public readonly Vec3 LocalB;

    /// <summary>Captured separation with the captured witness offset folded out.</summary>
    public readonly float Baseline;

    /// <summary>Binds both witnesses and the separation baseline of one point.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public PositionGeometry3D(Vec3 localA, Vec3 localB, float baseline)
    {
        LocalA = localA;
        LocalB = localB;
        Baseline = baseline;
    }

    /// <summary>
    /// Captures one manifold point against the frames that hold it now, so a
    /// later read through any frame reports the same material pair.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static PositionGeometry3D Capture(
        in ContactPoint3D point, in Vec3 normal, in RigidTransform3D frameA, in RigidTransform3D frameB) =>
        new(
            frameA.InverseTransformPoint(point.PositionA),
            frameB.InverseTransformPoint(point.PositionB),
            point.Separation - Vec3.Dot(normal, point.PositionA - point.PositionB));

    /// <summary>Maps the first witness into the world through <paramref name="frameA"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public readonly Vec3 ResolveA(in RigidTransform3D frameA) => frameA.TransformPoint(LocalA);

    /// <summary>Maps the second witness into the world through <paramref name="frameB"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public readonly Vec3 ResolveB(in RigidTransform3D frameB) => frameB.TransformPoint(LocalB);

    /// <summary>
    /// Separation along <paramref name="normal"/> of witnesses the live frames
    /// already carry; equal to the captured depth while both bodies stay where
    /// the snapshot left them.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public readonly float ResolveSeparation(in Vec3 normal, Vec3 positionA, Vec3 positionB) =>
        Baseline + Vec3.Dot(normal, positionA - positionB);
}

/// <summary>
/// Stack-resident window of position geometries for a run of contacts: one
/// capture per pass, every sweep of that pass reading through it. The window
/// is fixed size, so a longer contact list resolves as consecutive windows,
/// each swept to completion before the next is captured.
/// </summary>
internal static class PositionGeometryWindow
{
    /// <summary>Contacts resolved per window; at most two points each.</summary>
    public const int MaxContacts = 128;

    /// <summary>
    /// Binds every live point of <paramref name="contacts"/> to the frames its
    /// body carries right now, writing <see cref="MaxContacts"/> windows of
    /// <see cref="PositionGeometry3D"/> into <paramref name="destination"/>.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void Capture(BodyStore bodies, Span<Contact3D> contacts, Span<PositionGeometry3D> destination)
    {
        for (int i = 0; i < contacts.Length; i++)
        {
            ref Contact3D contact = ref contacts[i];
            Manifold3D manifold = contact.Manifold;
            if (contact.IsSensor || manifold.Count == 0)
            {
                continue;
            }

            ref BodyState stateA = ref bodies.Slot(contact.BodyA);
            ref BodyState stateB = ref bodies.Slot(contact.BodyB);
            var frameA = new RigidTransform3D(stateA.Position, stateA.Rotation);
            var frameB = new RigidTransform3D(stateB.Position, stateB.Rotation);
            int baseIndex = i * Manifold3D.MaxPoints;

            for (int p = 0; p < manifold.Count; p++)
            {
                destination[baseIndex + p] = PositionGeometry3D.Capture(manifold[p], manifold.Normal, frameA, frameB);
            }
        }
    }
}
