namespace Axrone.Physics2D;

/// <summary>
/// Shared solver tuning: the linear slop inside which resting separation is
/// left alone, the fraction of the residual a position sweep removes, and the
/// per-sweep correction cap. One definition so the contact and joint solvers
/// push with the same hand.
/// </summary>
internal static class SolverTuning
{
    /// <summary>Penetration allowance that never corrects; rests stay quiet.</summary>
    public const float LinearSlop = PhysicsConstants.LinearSlop;

    /// <summary>
    /// Fraction of the residual penetration removed by one position sweep. The
    /// pass re-measures depth from the live frames, so a full sweep lands the
    /// pair on the slop and the next sweep finds nothing to do.
    /// </summary>
    public const float PositionCorrectionScale = 1.0f;

    /// <summary>Largest position correction applied in one sweep.</summary>
    public const float MaxCorrection = PhysicsConstants.MaxLinearCorrection;

    /// <summary>Approach speed above which restitution kicks in.</summary>
    public const float RestitutionThreshold = PhysicsConstants.VelocityThreshold;

    /// <summary>Angular allowance inside which limit position correction stays quiet.</summary>
    public const float AngularSlop = PhysicsConstants.AngularSlop;
}

/// <summary>
/// Sequential-impulse contact solver: per step it freezes the restitution
/// bias from the approach speed, then iterates normal clamping plus Coulomb
/// friction over every contact point, and finally pushes positions apart with
/// Baumgarte stabilization. Sleeping bodies read as infinite mass, so a
/// quiet stack never pays for motion it does not have. All scratch lives in
/// the loop; nothing allocates.
/// </summary>
public static class ContactSolver
{
    /// <summary>
    /// Freezes restitution biases from approach speeds; call once per step
    /// before the iteration loop. Friction and restitution combine through
    /// each shape's <see cref="CombineMode"/>; conveyor tangent speeds reach
    /// the friction sweep through the manifold points.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void InitVelocityConstraints(BodyStore bodies, ShapeStore shapes, Span<Contact> contacts)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);

        for (int i = 0; i < contacts.Length; i++)
        {
            ref Contact contact = ref contacts[i];
            if (contact.IsSensor)
            {
                continue;
            }

            ref readonly ShapeRecord recordA = ref shapes.Slot(contact.ShapeA);
            ref readonly ShapeRecord recordB = ref shapes.Slot(contact.ShapeB);
            InitContact(bodies, ref contact, DefaultTuning(in recordA.Material, in recordB.Material));
        }
    }

    /// <summary>
    /// Same pass through a caller context: for every solid contact the
    /// context first supplies the combined tuning, receives it back mutated
    /// by the pre-solve hook, and the frozen restitution biases read the
    /// rewritten coefficients.
    /// </summary>
    /// <typeparam name="TSink">Sink implementing the pre-solve callback point.</typeparam>
    /// <typeparam name="TContext">Caller state the sink may read and write.</typeparam>
    /// <param name="bodies">Body store to freeze biases against.</param>
    /// <param name="shapes">Shape store the sink combines materials from.</param>
    /// <param name="contacts">Contacts of the step.</param>
    /// <param name="context">Sink driving the callback point.</param>
    /// <param name="solveContext">Caller state handed to the sink.</param>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void InitVelocityConstraints<TSink, TContext>(
        BodyStore bodies, ShapeStore shapes, Span<Contact> contacts, ref TSink context, ref TContext solveContext)
        where TSink : struct, IContactSolveContext<Contact, ContactManifold, TContext>
        where TContext : allows ref struct
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);

        for (int i = 0; i < contacts.Length; i++)
        {
            ref Contact contact = ref contacts[i];
            if (contact.IsSensor)
            {
                continue;
            }

            ContactTuning tuning = context.Tune(in contact, ref solveContext);
            ContactManifold manifold = contact.Manifold;
            context.PreSolve(ref contact, ref manifold, ref tuning, ref solveContext);
            contact.Manifold = manifold;
            InitContact(bodies, ref contact, tuning);
        }
    }

    /// <summary>
    /// Combines two materials into the default tuning of their contact pair
    /// through each side's <see cref="CombineMode"/>.
    /// </summary>
    /// <param name="a">Material of the first shape.</param>
    /// <param name="b">Material of the second shape.</param>
    /// <returns>The pair tuning before any pre-solve rewrite.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static ContactTuning DefaultTuning(in PhysicsMaterial a, in PhysicsMaterial b)
    {
        float staticFriction = MaterialCombiner.CombineFriction(a.StaticFriction, b.StaticFriction, a.FrictionCombine, b.FrictionCombine);
        float dynamicFriction = MaterialCombiner.CombineFriction(a.DynamicFriction, b.DynamicFriction, a.FrictionCombine, b.FrictionCombine);
        float slideScale = a.StaticFriction > 0.0f ? dynamicFriction / a.StaticFriction : 1.0f;
        return new ContactTuning
        {
            Phase = CollisionEventType.PreSolve,
            Friction = staticFriction,
            Restitution = MaterialCombiner.CombineRestitution(a.Restitution, b.Restitution, a.RestitutionCombine, b.RestitutionCombine),
            RestitutionThreshold = SolverTuning.RestitutionThreshold,
            TangentSpeed = a.TangentSpeed - b.TangentSpeed,

            // A pre-solve rewrite of Friction rescales sliding friction by the
            // same ratio the materials carried into the step.
            DynamicFriction = staticFriction * slideScale,
        };
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void InitContact(BodyStore bodies, ref Contact contact, ContactTuning tuning)
    {
        ContactManifold manifold = contact.Manifold;

        ref BodyState stateA = ref bodies.Slot(contact.BodyA);
        ref BodyState stateB = ref bodies.Slot(contact.BodyB);
        Vec2 comA = stateA.Position + Rotate(stateA.Cos, stateA.Sin, stateA.LocalCenter);
        Vec2 comB = stateB.Position + Rotate(stateB.Cos, stateB.Sin, stateB.LocalCenter);

        for (int p = 0; p < manifold.Count; p++)
        {
            ContactPoint point = manifold.GetPointRO(p);
            Vec2 rA = point.PositionA - comA;
            Vec2 rB = point.PositionB - comB;
            Vec2 vA = stateA.LinearVelocity + (stateA.AngularVelocity * Perp(rA));
            Vec2 vB = stateB.LinearVelocity + (stateB.AngularVelocity * Perp(rB));
            float approach = Vec2.Dot(manifold.Normal, vB - vA);
            manifold.SetVelocityBias(p, approach < -tuning.RestitutionThreshold ? -tuning.Restitution * approach : 0.0f);
        }

        contact.Manifold = manifold;
        contact.Tuning = tuning;
    }

    /// <summary>
    /// Reports the impulses accumulated on every solid contact through a
    /// caller context; call after the last velocity sweep of the step.
    /// </summary>
    /// <typeparam name="TSink">Sink implementing the post-solve callback point.</typeparam>
    /// <typeparam name="TContext">Caller state the sink may read and write.</typeparam>
    /// <param name="contacts">Contacts of the step.</param>
    /// <param name="context">Sink receiving one payload per solid contact.</param>
    /// <param name="solveContext">Caller state handed to the sink.</param>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void ReportPostSolve<TSink, TContext>(Span<Contact> contacts, ref TSink context, ref TContext solveContext)
        where TSink : struct, IContactSolveContext<Contact, ContactManifold, TContext>
        where TContext : allows ref struct
    {
        for (int i = 0; i < contacts.Length; i++)
        {
            ref readonly Contact contact = ref contacts[i];
            if (contact.IsSensor)
            {
                continue;
            }

            ContactManifold manifold = contact.Manifold;
            ContactImpulses impulses = new() { Count = manifold.Count, Phase = CollisionEventType.PostSolve };
            for (int p = 0; p < manifold.Count; p++)
            {
                ContactPoint point = manifold.GetPointRO(p);
                impulses.WritePoint(p, point.NormalImpulse, point.TangentImpulse);
            }

            context.PostSolve(in contact, in manifold, in impulses, ref solveContext);
        }
    }

    /// <summary>
    /// Runs <paramref name="iterations"/> sweeps of normal plus friction
    /// impulses accumulated in place on the manifolds. Biases must be frozen
    /// by <see cref="InitVelocityConstraints"/> first.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolveVelocityPass(BodyStore bodies, ShapeStore shapes, Span<Contact> contacts, int iterations)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);

        for (int iteration = 0; iteration < iterations; iteration++)
        {
            for (int i = 0; i < contacts.Length; i++)
            {
                SolveContactVelocity(bodies, ref contacts[i]);
            }
        }
    }

    /// <summary>
    /// Runs the velocity pass: biases frozen from approach speeds, then
    /// <paramref name="iterations"/> sweeps of normal plus friction impulses
    /// accumulated in place on the manifolds.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolveVelocity(BodyStore bodies, ShapeStore shapes, Span<Contact> contacts, int iterations)
    {
        InitVelocityConstraints(bodies, shapes, contacts);
        SolveVelocityPass(bodies, shapes, contacts, iterations);
    }

    /// <summary>
    /// Runs one position sweep of Baumgarte correction over penetrated points,
    /// each witness resolved through the frame its body carries now. Separations
    /// inside the linear slop are left alone so resting contact never jitters.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolvePositionPass(BodyStore bodies, ShapeStore shapes, Span<Contact> contacts)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);

        Span<PositionGeometry2D> window = stackalloc PositionGeometry2D[PositionGeometryWindow.MaxContacts * PositionGeometryWindow.PointsPerContact];
        for (int start = 0; start < contacts.Length; start += PositionGeometryWindow.MaxContacts)
        {
            int length = Math.Min(PositionGeometryWindow.MaxContacts, contacts.Length - start);
            Span<Contact> slice = contacts.Slice(start, length);
            Span<PositionGeometry2D> geometry = window.Slice(0, length * PositionGeometryWindow.PointsPerContact);
            PositionGeometryWindow.Capture(bodies, slice, geometry);
            SolvePositionSweep(bodies, slice, geometry);
        }
    }

    /// <summary>
    /// Runs the position pass: <paramref name="iterations"/> sweeps of Baumgarte
    /// correction over the geometry captured once for the pass, so every sweep
    /// measures the corrections its predecessors already applied instead of
    /// replaying the narrowphase snapshot.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolvePositions(BodyStore bodies, ShapeStore shapes, Span<Contact> contacts, int iterations)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);
        if (iterations <= 0)
        {
            return;
        }

        Span<PositionGeometry2D> window = stackalloc PositionGeometry2D[PositionGeometryWindow.MaxContacts * PositionGeometryWindow.PointsPerContact];
        for (int start = 0; start < contacts.Length; start += PositionGeometryWindow.MaxContacts)
        {
            int length = Math.Min(PositionGeometryWindow.MaxContacts, contacts.Length - start);
            Span<Contact> slice = contacts.Slice(start, length);
            Span<PositionGeometry2D> geometry = window.Slice(0, length * PositionGeometryWindow.PointsPerContact);
            PositionGeometryWindow.Capture(bodies, slice, geometry);

            for (int iteration = 0; iteration < iterations; iteration++)
            {
                SolvePositionSweep(bodies, slice, geometry);
            }
        }
    }

    /// <summary>
    /// Binds the live points of <paramref name="contacts"/> to the frames their
    /// bodies carry right now, into a caller-owned window that every sweep of
    /// the pass then reads. Exposed so a world can capture once and interleave
    /// its contact and joint sweeps without losing the re-projection.
    /// </summary>
    internal static void CapturePositionGeometry(BodyStore bodies, Span<Contact> contacts, Span<PositionGeometry2D> destination) =>
        PositionGeometryWindow.Capture(bodies, contacts, destination);

    /// <summary>
    /// One sweep against a window the caller captured: witnesses and separation
    /// are resolved through the current frames, so the sweep sees its own work.
    /// </summary>
    internal static void SolvePositionPass(BodyStore bodies, ShapeStore shapes, Span<Contact> contacts, Span<PositionGeometry2D> geometry)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);
        SolvePositionSweep(bodies, contacts, geometry);
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void SolvePositionSweep(BodyStore bodies, Span<Contact> contacts, Span<PositionGeometry2D> geometry)
    {
        for (int i = 0; i < contacts.Length; i++)
        {
            SolveContactPosition(bodies, ref contacts[i], geometry.Slice(i * PositionGeometryWindow.PointsPerContact));
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void SolveContactVelocity(BodyStore bodies, ref Contact contact)
    {
        if (contact.IsSensor)
        {
            return;
        }

        ref BodyState stateA = ref bodies.Slot(contact.BodyA);
        ref BodyState stateB = ref bodies.Slot(contact.BodyB);

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;

        float invMassA = awakeA ? stateA.InverseMass : 0.0f;
        float invMassB = awakeB ? stateB.InverseMass : 0.0f;
        float invIA = awakeA ? stateA.InverseInertia : 0.0f;
        float invIB = awakeB ? stateB.InverseInertia : 0.0f;

        // Pair tuning comes from the init pass (materials combined through
        // each side's modes, rewritten by the pre-solve hook when one ran).
        ContactTuning tuning = contact.Tuning;

        ContactManifold manifold = contact.Manifold;
        Vec2 normal = manifold.Normal;
        Vec2 tangent = new(-normal.Y, normal.X);

        Vec2 comA = stateA.Position + Rotate(stateA.Cos, stateA.Sin, stateA.LocalCenter);
        Vec2 comB = stateB.Position + Rotate(stateB.Cos, stateB.Sin, stateB.LocalCenter);

        if (manifold.Count == 2)
        {
            SolveBlockNormal(
                ref stateA, ref stateB, awakeA, awakeB,
                invMassA, invMassB, invIA, invIB,
                comA, comB, ref manifold);
        }
        else
        {
            for (int p = 0; p < manifold.Count; p++)
            {
                SolvePointNormal(
                    ref stateA, ref stateB, awakeA, awakeB,
                    invMassA, invMassB, invIA, invIB,
                    comA, comB, ref manifold, p);
            }
        }

        for (int p = 0; p < manifold.Count; p++)
        {
            SolvePointFriction(
                ref stateA, ref stateB, awakeA, awakeB,
                invMassA, invMassB, invIA, invIB,
                comA, comB, normal, tangent, in tuning, ref manifold, p);
        }

        contact.Manifold = manifold;
    }

    /// <summary>Sequential normal impulse for one point with non-negative clamping.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void SolvePointNormal(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, float invIA, float invIB,
        Vec2 comA, Vec2 comB, ref ContactManifold manifold, int p)
    {
        ContactPoint point = manifold.GetPointRO(p);
        Vec2 normal = manifold.Normal;
        Vec2 rA = point.PositionA - comA;
        Vec2 rB = point.PositionB - comB;

        float rnA = Vec2.Cross(rA, normal);
        float rnB = Vec2.Cross(rB, normal);
        float normalMass = ComputeNormalMass(invMassA, invMassB, invIA, invIB, rnA, rnB);

        Vec2 vA = stateA.LinearVelocity + (stateA.AngularVelocity * Perp(rA));
        Vec2 vB = stateB.LinearVelocity + (stateB.AngularVelocity * Perp(rB));
        float vn = Vec2.Dot(normal, vB - vA);

        float lambda = normalMass * (-(vn - point.VelocityBias));
        float newImpulse = MathF.Max(point.NormalImpulse + lambda, 0.0f);
        float delta = newImpulse - point.NormalImpulse;
        manifold.SetImpulses(p, newImpulse, point.TangentImpulse);

        ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, normal, delta);
    }

    /// <summary>
    /// Two-point block solve: the coupled 2x2 normal system solved at once
    /// with total-enumeration clamping, so face contacts converge in one
    /// sweep instead of geometrically over many.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void SolveBlockNormal(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, float invIA, float invIB,
        Vec2 comA, Vec2 comB, ref ContactManifold manifold)
    {
        Vec2 normal = manifold.Normal;
        ContactPoint p0 = manifold.GetPointRO(0);
        ContactPoint p1 = manifold.GetPointRO(1);

        Vec2 rA0 = p0.PositionA - comA;
        Vec2 rB0 = p0.PositionB - comB;
        Vec2 rA1 = p1.PositionA - comA;
        Vec2 rB1 = p1.PositionB - comB;

        float rnA0 = Vec2.Cross(rA0, normal);
        float rnB0 = Vec2.Cross(rB0, normal);
        float rnA1 = Vec2.Cross(rA1, normal);
        float rnB1 = Vec2.Cross(rB1, normal);

        float k11 = invMassA + invMassB + (invIA * rnA0 * rnA0) + (invIB * rnB0 * rnB0);
        float k22 = invMassA + invMassB + (invIA * rnA1 * rnA1) + (invIB * rnB1 * rnB1);
        float k12 = invMassA + invMassB + (invIA * rnA0 * rnA1) + (invIB * rnB0 * rnB1);

        float det = (k11 * k22) - (k12 * k12);
        if (det <= 0.0f)
        {
            SolvePointNormal(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, comA, comB, ref manifold, 0);
            SolvePointNormal(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, comA, comB, ref manifold, 1);
            return;
        }

        float invDet = 1.0f / det;

        Vec2 vA0 = stateA.LinearVelocity + (stateA.AngularVelocity * Perp(rA0));
        Vec2 vB0 = stateB.LinearVelocity + (stateB.AngularVelocity * Perp(rB0));
        Vec2 vA1 = stateA.LinearVelocity + (stateA.AngularVelocity * Perp(rA1));
        Vec2 vB1 = stateB.LinearVelocity + (stateB.AngularVelocity * Perp(rB1));

        float a1 = p0.NormalImpulse;
        float a2 = p1.NormalImpulse;
        float b1 = Vec2.Dot(normal, vB0 - vA0) - p0.VelocityBias - ((k11 * a1) + (k12 * a2));
        float b2 = Vec2.Dot(normal, vB1 - vA1) - p1.VelocityBias - ((k12 * a1) + (k22 * a2));

        for (; ; )
        {
            float x1 = -(k22 * b1 - k12 * b2) * invDet;
            float x2 = -(-k12 * b1 + k11 * b2) * invDet;
            if (x1 >= 0.0f && x2 >= 0.0f)
            {
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA0, rB0, normal, x1 - a1);
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA1, rB1, normal, x2 - a2);
                manifold.SetImpulses(0, x1, p0.TangentImpulse);
                manifold.SetImpulses(1, x2, p1.TangentImpulse);
                break;
            }

            x1 = -b1 / k11;
            float vn2 = (k12 * x1) + b2;
            if (x1 >= 0.0f && vn2 >= 0.0f)
            {
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA0, rB0, normal, x1 - a1);
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA1, rB1, normal, 0.0f - a2);
                manifold.SetImpulses(0, x1, p0.TangentImpulse);
                manifold.SetImpulses(1, 0.0f, p1.TangentImpulse);
                break;
            }

            x2 = -b2 / k22;
            float vn1 = (k12 * x2) + b1;
            if (x2 >= 0.0f && vn1 >= 0.0f)
            {
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA0, rB0, normal, 0.0f - a1);
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA1, rB1, normal, x2 - a2);
                manifold.SetImpulses(0, 0.0f, p0.TangentImpulse);
                manifold.SetImpulses(1, x2, p1.TangentImpulse);
                break;
            }

            if (b1 >= 0.0f && b2 >= 0.0f)
            {
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA0, rB0, normal, 0.0f - a1);
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA1, rB1, normal, 0.0f - a2);
                manifold.SetImpulses(0, 0.0f, p0.TangentImpulse);
                manifold.SetImpulses(1, 0.0f, p1.TangentImpulse);
            }

            break;
        }
    }

    /// <summary>
    /// Applies one signed normal-impulse delta to both bodies. Only dynamic
    /// bodies are written: scenery and script-driven bodies carry the awake
    /// flag yet react with infinite mass, so a flag test alone would let a
    /// degenerate row write straight through them.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void ApplyNormalImpulse(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, float invIA, float invIB,
        Vec2 rA, Vec2 rB, Vec2 normal, float delta)
    {
        Vec2 impulse = normal * delta;
        if (awakeA && stateA.Type == BodyType.Dynamic)
        {
            stateA.LinearVelocity -= impulse * invMassA;
            stateA.AngularVelocity -= invIA * Vec2.Cross(rA, impulse);
        }

        if (awakeB && stateB.Type == BodyType.Dynamic)
        {
            stateB.LinearVelocity += impulse * invMassB;
            stateB.AngularVelocity += invIB * Vec2.Cross(rB, impulse);
        }
    }

    /// <summary>Coulomb friction for one point, clamped by its own normal impulse.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void SolvePointFriction(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, float invIA, float invIB,
        Vec2 comA, Vec2 comB, Vec2 normal, Vec2 tangent, in ContactTuning tuning,
        ref ContactManifold manifold, int p)
    {
        ContactPoint point = manifold.GetPointRO(p);
        Vec2 rA = point.PositionA - comA;
        Vec2 rB = point.PositionB - comB;

        float rtA = Vec2.Cross(rA, tangent);
        float rtB = Vec2.Cross(rB, tangent);
        float tangentMass = ComputeTangentMass(invMassA, invMassB, invIA, invIB, rtA, rtB);

        Vec2 vA = stateA.LinearVelocity + (stateA.AngularVelocity * Perp(rA));
        Vec2 vB = stateB.LinearVelocity + (stateB.AngularVelocity * Perp(rB));

        // The conveyor tangent speed shifts the target relative sliding
        // velocity; a non-zero dynamic coefficient scales the sliding
        // resistance relative to the static cone.
        float vt = Vec2.Dot(tangent, vB - vA) - tuning.TangentSpeed;
        float friction = tuning.Friction;
        float slideScale = tuning.DynamicFriction > 0.0f && friction > 0.0f
            ? MathF.Min(tuning.DynamicFriction / friction, 1.0f)
            : 1.0f;
        float maxFriction = friction * point.NormalImpulse;
        float newTangent = Math.Clamp(point.TangentImpulse + (-tangentMass * vt * slideScale), -maxFriction, maxFriction);
        float delta = newTangent - point.TangentImpulse;
        manifold.SetImpulses(p, point.NormalImpulse, newTangent);

        Vec2 impulse = tangent * delta;
        if (awakeA && stateA.Type == BodyType.Dynamic)
        {
            stateA.LinearVelocity -= impulse * invMassA;
            stateA.AngularVelocity -= invIA * Vec2.Cross(rA, impulse);
        }

        if (awakeB && stateB.Type == BodyType.Dynamic)
        {
            stateB.LinearVelocity += impulse * invMassB;
            stateB.AngularVelocity += invIB * Vec2.Cross(rB, impulse);
        }
    }

    /// <summary>
    /// Position correction for one contact, solved as a bundle: both witnesses
    /// are resolved through the live frames, the coupled system is solved at
    /// once, and the result is applied exactly one time, so a symmetric pair
    /// cancels its own couple instead of acquiring a twist the geometry cannot
    /// observe.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void SolveContactPosition(BodyStore bodies, ref Contact contact, Span<PositionGeometry2D> geometry)
    {
        if (contact.IsSensor)
        {
            return;
        }

        ContactManifold manifold = contact.Manifold;
        if (manifold.Count == 0)
        {
            return;
        }

        ref BodyState stateA = ref bodies.Slot(contact.BodyA);
        ref BodyState stateB = ref bodies.Slot(contact.BodyB);

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
        if (!awakeA && !awakeB)
        {
            return;
        }

        float invMassA = awakeA ? stateA.InverseMass : 0.0f;
        float invMassB = awakeB ? stateB.InverseMass : 0.0f;
        float invIA = awakeA ? stateA.InverseInertia : 0.0f;
        float invIB = awakeB ? stateB.InverseInertia : 0.0f;

        Vec2 normal = manifold.Normal;
        Transform2D frameA = Transform2D.FromRotation(stateA.Position, stateA.Cos, stateA.Sin);
        Transform2D frameB = Transform2D.FromRotation(stateB.Position, stateB.Cos, stateB.Sin);
        Vec2 comA = stateA.Position + Rotate(stateA.Cos, stateA.Sin, stateA.LocalCenter);
        Vec2 comB = stateB.Position + Rotate(stateB.Cos, stateB.Sin, stateB.LocalCenter);

        ref readonly PositionGeometry2D first = ref geometry[0];
        Vec2 witnessA0 = first.ResolveA(frameA);
        Vec2 witnessB0 = first.ResolveB(frameB);
        Vec2 rA0 = witnessA0 - comA;
        Vec2 rB0 = witnessB0 - comB;
        float rnA0 = Vec2.Cross(rA0, normal);
        float rnB0 = Vec2.Cross(rB0, normal);
        float k11 = EffectiveMass(invMassA, invMassB, invIA, invIB, rnA0, rnA0, rnB0, rnB0);
        float target0 = Target(first, normal, witnessA0, witnessB0);
        float push0 = k11 > 0.0f ? target0 / k11 : 0.0f;
        float push1 = 0.0f;
        float rnA1 = 0.0f;
        float rnB1 = 0.0f;

        if (manifold.Count > 1)
        {
            ref readonly PositionGeometry2D second = ref geometry[1];
            Vec2 witnessA1 = second.ResolveA(frameA);
            Vec2 witnessB1 = second.ResolveB(frameB);
            Vec2 rA1 = witnessA1 - comA;
            Vec2 rB1 = witnessB1 - comB;
            rnA1 = Vec2.Cross(rA1, normal);
            rnB1 = Vec2.Cross(rB1, normal);

            float k22 = EffectiveMass(invMassA, invMassB, invIA, invIB, rnA1, rnA1, rnB1, rnB1);
            float k12 = EffectiveMass(invMassA, invMassB, invIA, invIB, rnA0, rnA1, rnB0, rnB1);
            float target1 = Target(second, normal, witnessA1, witnessB1);
            float det = (k11 * k22) - (k12 * k12);
            if (det <= 0.0f || k22 <= 0.0f)
            {
                push1 = k22 > 0.0f ? target1 / k22 : 0.0f;
            }
            else
            {
                float coupled0 = ((k22 * target0) - (k12 * target1)) / det;
                float coupled1 = ((k11 * target1) - (k12 * target0)) / det;
                if (coupled0 >= 0.0f && coupled1 >= 0.0f)
                {
                    push0 = coupled0;
                    push1 = coupled1;
                }
                else if (coupled0 > 0.0f)
                {
                    push0 = target0 / k11;
                    push1 = 0.0f;
                }
                else if (coupled1 > 0.0f)
                {
                    push0 = 0.0f;
                    push1 = target1 / k22;
                }
                else
                {
                    push0 = 0.0f;
                    push1 = 0.0f;
                }
            }
        }

        if (push0 == 0.0f && push1 == 0.0f)
        {
            return;
        }

        float momentA = (rnA0 * push0) + (rnA1 * push1);
        float momentB = (rnB0 * push0) + (rnB1 * push1);
        float push = push0 + push1;

        if (awakeA && stateA.Type == BodyType.Dynamic)
        {
            stateA.Position -= normal * (push * invMassA);
            float angleA = MathF.Atan2(stateA.Sin, stateA.Cos) - (invIA * momentA);
            stateA.Cos = MathF.Cos(angleA);
            stateA.Sin = MathF.Sin(angleA);
        }

        if (awakeB && stateB.Type == BodyType.Dynamic)
        {
            stateB.Position += normal * (push * invMassB);
            float angleB = MathF.Atan2(stateB.Sin, stateB.Cos) + (invIB * momentB);
            stateB.Cos = MathF.Cos(angleB);
            stateB.Sin = MathF.Sin(angleB);
        }
    }

    /// <summary>Coupled effective mass between two points of one contact along the normal.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static float EffectiveMass(float invMassA, float invMassB, float invIA, float invIB, float rnA0, float rnA1, float rnB0, float rnB1) =>
        invMassA + invMassB + (invIA * rnA0 * rnA1) + (invIB * rnB0 * rnB1);

    /// <summary>Distance the pair must gain along the normal before one point rests inside the slop.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static float Target(in PositionGeometry2D point, Vec2 normal, Vec2 witnessA, Vec2 witnessB) =>
        -Math.Clamp(
            SolverTuning.PositionCorrectionScale * (point.ResolveSeparation(normal, witnessA, witnessB) + SolverTuning.LinearSlop),
            -SolverTuning.MaxCorrection, 0.0f);

    /// <summary>
    /// Effective mass of one point along the normal. Guarded reciprocal: a
    /// sleeping dynamic body over scenery has no movable surface at all, and
    /// an unguarded reciprocal turns its zero approach speed into an infinite
    /// mass times a zero speed, which every later clamp carries as NaN.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static float ComputeNormalMass(float invMassA, float invMassB, float invIA, float invIB, float rnA, float rnB)
    {
        float k = invMassA + invMassB + (invIA * rnA * rnA) + (invIB * rnB * rnB);
        return k > 0.0f ? 1.0f / k : 0.0f;
    }

    /// <summary>
    /// Effective mass of one point along the tangent, guarded for the same
    /// reason as the normal row.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static float ComputeTangentMass(float invMassA, float invMassB, float invIA, float invIB, float rtA, float rtB)
    {
        float k = invMassA + invMassB + (invIA * rtA * rtA) + (invIB * rtB * rtB);
        return k > 0.0f ? 1.0f / k : 0.0f;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec2 Rotate(float cos, float sin, Vec2 vector) =>
        new((cos * vector.X) - (sin * vector.Y), (sin * vector.X) + (cos * vector.Y));

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec2 Perp(Vec2 vector) => new(-vector.Y, vector.X);
}
