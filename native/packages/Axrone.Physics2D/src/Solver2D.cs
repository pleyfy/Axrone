namespace Axrone.Physics2D;

/// <summary>
/// Shared solver tuning: Baumgarte stabilization, the linear slop inside
/// which resting separation is left alone, and the per-sweep correction
/// cap. One definition so the contact and joint solvers push with the same
/// hand.
/// </summary>
internal static class SolverTuning
{
    /// <summary>Fraction of the error corrected per position sweep.</summary>
    public const float Baumgarte = PhysicsConstants.BaumgarteFactor;

    /// <summary>Penetration allowance that never corrects; rests stay quiet.</summary>
    public const float LinearSlop = PhysicsConstants.LinearSlop;

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
    /// Runs one position sweep of Baumgarte correction over penetrated
    /// points. Separations inside the linear slop are left alone so resting
    /// contact never jitters.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolvePositionPass(BodyStore bodies, ShapeStore shapes, Span<Contact> contacts)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);

        for (int i = 0; i < contacts.Length; i++)
        {
            SolveContactPosition(bodies, ref contacts[i]);
        }
    }

    /// <summary>
    /// Runs the position pass: <paramref name="iterations"/> sweeps of
    /// Baumgarte correction over penetrated points.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolvePositions(BodyStore bodies, ShapeStore shapes, Span<Contact> contacts, int iterations)
    {
        for (int iteration = 0; iteration < iterations; iteration++)
        {
            SolvePositionPass(bodies, shapes, contacts);
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
        float normalMass = 1.0f / (invMassA + invMassB + (invIA * rnA * rnA) + (invIB * rnB * rnB));

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

    /// <summary>Applies one signed normal-impulse delta to both bodies.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void ApplyNormalImpulse(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, float invIA, float invIB,
        Vec2 rA, Vec2 rB, Vec2 normal, float delta)
    {
        Vec2 impulse = normal * delta;
        if (awakeA)
        {
            stateA.LinearVelocity -= impulse * invMassA;
            stateA.AngularVelocity -= invIA * Vec2.Cross(rA, impulse);
        }

        if (awakeB)
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
        float tangentMass = 1.0f / (invMassA + invMassB + (invIA * rtA * rtA) + (invIB * rtB * rtB));

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
        if (awakeA)
        {
            stateA.LinearVelocity -= impulse * invMassA;
            stateA.AngularVelocity -= invIA * Vec2.Cross(rA, impulse);
        }

        if (awakeB)
        {
            stateB.LinearVelocity += impulse * invMassB;
            stateB.AngularVelocity += invIB * Vec2.Cross(rB, impulse);
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void SolveContactPosition(BodyStore bodies, ref Contact contact)
    {
        if (contact.IsSensor)
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

        ContactManifold manifold = contact.Manifold;
        Vec2 normal = manifold.Normal;

        Vec2 comA = stateA.Position + Rotate(stateA.Cos, stateA.Sin, stateA.LocalCenter);
        Vec2 comB = stateB.Position + Rotate(stateB.Cos, stateB.Sin, stateB.LocalCenter);

        for (int p = 0; p < manifold.Count; p++)
        {
            ContactPoint point = manifold.GetPointRO(p);
            Vec2 rA = point.PositionA - comA;
            Vec2 rB = point.PositionB - comB;

            float rnA = Vec2.Cross(rA, normal);
            float rnB = Vec2.Cross(rB, normal);
            float mass = 1.0f / (invMassA + invMassB + (invIA * rnA * rnA) + (invIB * rnB * rnB));

            float correction = Math.Clamp(SolverTuning.Baumgarte * (point.Separation + SolverTuning.LinearSlop), -SolverTuning.MaxCorrection, 0.0f);
            Vec2 impulse = normal * (-mass * correction);

            if (awakeA)
            {
                stateA.Position -= impulse * invMassA;
                float angleA = MathF.Atan2(stateA.Sin, stateA.Cos) - (invIA * Vec2.Cross(rA, impulse));
                stateA.Cos = MathF.Cos(angleA);
                stateA.Sin = MathF.Sin(angleA);
            }

            if (awakeB)
            {
                stateB.Position += impulse * invMassB;
                float angleB = MathF.Atan2(stateB.Sin, stateB.Cos) + (invIB * Vec2.Cross(rB, impulse));
                stateB.Cos = MathF.Cos(angleB);
                stateB.Sin = MathF.Sin(angleB);
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec2 Rotate(float cos, float sin, Vec2 vector) =>
        new((cos * vector.X) - (sin * vector.Y), (sin * vector.X) + (cos * vector.Y));

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static Vec2 Perp(Vec2 vector) => new(-vector.Y, vector.X);
}
