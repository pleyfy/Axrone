namespace Axrone.Physics2D;

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
internal readonly struct PositionGeometry2D
{
    /// <summary>Witness on the first shape in the first body's frame at capture.</summary>
    public readonly Vec2 LocalA;

    /// <summary>Witness on the second shape in the second body's frame at capture.</summary>
    public readonly Vec2 LocalB;

    /// <summary>Captured separation with the captured witness offset folded out.</summary>
    public readonly float Baseline;

    /// <summary>Binds both witnesses and the separation baseline of one point.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public PositionGeometry2D(Vec2 localA, Vec2 localB, float baseline)
    {
        LocalA = localA;
        LocalB = localB;
        Baseline = baseline;
    }

    /// <summary>
    /// Captures one manifold point against the frames that hold it now, so a
    /// later read through any frame reports the same material pair. The
    /// baseline folds out the witness offset under 2D's identity, measured
    /// bit-exact on clipped and SAT box pairs: separation is the normal
    /// projected onto <c>PositionB - PositionA</c>, the normal pointing from A
    /// toward B.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static PositionGeometry2D Capture(in ContactPoint point, in Vec2 normal, Transform2D frameA, Transform2D frameB) =>
        new(
            Unrotate(frameA, point.PositionA - frameA.Position),
            Unrotate(frameB, point.PositionB - frameB.Position),
            point.Separation - Vec2.Dot(normal, point.PositionB - point.PositionA));

    /// <summary>Maps the first witness into the world through <paramref name="frameA"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public readonly Vec2 ResolveA(Transform2D frameA) => frameA.Position + Rotate(frameA, LocalA);

    /// <summary>Maps the second witness into the world through <paramref name="frameB"/>.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public readonly Vec2 ResolveB(Transform2D frameB) => frameB.Position + Rotate(frameB, LocalB);

    /// <summary>
    /// Separation along <paramref name="normal"/> of witnesses the live frames
    /// already carry; equal to the captured depth while both bodies stay where
    /// the snapshot left them, and rising as the pair is pushed apart.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public readonly float ResolveSeparation(in Vec2 normal, Vec2 positionA, Vec2 positionB) =>
        Baseline + Vec2.Dot(normal, positionB - positionA);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec2 Rotate(in Transform2D frame, Vec2 vector) =>
        new((frame.Cos * vector.X) - (frame.Sin * vector.Y), (frame.Sin * vector.X) + (frame.Cos * vector.Y));

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec2 Unrotate(in Transform2D frame, Vec2 vector) =>
        new((frame.Cos * vector.X) + (frame.Sin * vector.Y), (-frame.Sin * vector.X) + (frame.Cos * vector.Y));
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

    /// <summary>Points stored per contact in a window.</summary>
    public const int PointsPerContact = 2;

    /// <summary>
    /// Binds every live point of <paramref name="contacts"/> to the frames its
    /// body carries right now, writing <see cref="MaxContacts"/> windows of
    /// <see cref="PositionGeometry2D"/> into <paramref name="destination"/>.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void Capture(BodyStore bodies, Span<Contact> contacts, Span<PositionGeometry2D> destination)
    {
        for (int i = 0; i < contacts.Length; i++)
        {
            ref Contact contact = ref contacts[i];
            ContactManifold manifold = contact.Manifold;
            if (contact.IsSensor || manifold.Count == 0)
            {
                continue;
            }

            ref BodyState stateA = ref bodies.Slot(contact.BodyA);
            ref BodyState stateB = ref bodies.Slot(contact.BodyB);
            Transform2D frameA = Transform2D.FromRotation(stateA.Position, stateA.Cos, stateA.Sin);
            Transform2D frameB = Transform2D.FromRotation(stateB.Position, stateB.Cos, stateB.Sin);
            int baseIndex = i * PointsPerContact;

            for (int p = 0; p < manifold.Count; p++)
            {
                destination[baseIndex + p] = PositionGeometry2D.Capture(manifold.GetPointRO(p), manifold.Normal, frameA, frameB);
            }
        }
    }
}
