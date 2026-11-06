namespace Axrone.Physics3D;

/// <summary>
/// Shared solver tuning: Baumgarte stabilization, the linear slop inside
/// which resting separation is left alone, and the per-sweep correction
/// cap. One definition so contact and joint solvers push with the same hand.
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
}

/// <summary>
/// Sequential-impulse contact solver: per step it freezes the restitution
/// bias from the approach speed, then iterates normal clamping plus two-axis
/// Coulomb friction over every contact point, and finally pushes positions
/// apart with Baumgarte stabilization. Sleeping bodies read as infinite
/// mass, so a quiet stack never pays for motion it does not have. All
/// scratch lives in the loop; nothing allocates.
/// </summary>
public static class ContactSolver
{
    /// <summary>
    /// Freezes restitution biases from approach speeds and applies carried
    /// impulses to the velocities, so the iteration loop starts from last
    /// step's solution instead of zero. Call once per step before iterating.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void InitVelocityConstraints(BodyStore bodies, ShapeStore shapes, Span<Contact3D> contacts)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);

        for (int i = 0; i < contacts.Length; i++)
        {
            ref Contact3D contact = ref contacts[i];
            if (contact.IsSensor)
            {
                continue;
            }

            ref ShapeRecord recordA = ref shapes.Record(contact.ShapeA);
            ref ShapeRecord recordB = ref shapes.Record(contact.ShapeB);
            InitContact(bodies, ref contact, DefaultTuning(in recordA.Material, in recordB.Material));
        }
    }

    /// <summary>
    /// Same pass through a caller context: for every solid contact the context
    /// first supplies the combined tuning, receives it back mutated by the
    /// pre-solve hook, and the frozen restitution biases read the rewritten
    /// coefficients.
    /// </summary>
    /// <typeparam name="TSink">Sink implementing the pre-solve callback point.</typeparam>
    /// <typeparam name="TContext">Caller state the sink may read and write.</typeparam>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void InitVelocityConstraints<TSink, TContext>(
        BodyStore bodies, ShapeStore shapes, Span<Contact3D> contacts, ref TSink sink, ref TContext solveContext)
        where TSink : struct, IContactSolveContext<Contact3D, Manifold3D, TContext>
        where TContext : allows ref struct
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);

        for (int i = 0; i < contacts.Length; i++)
        {
            ref Contact3D contact = ref contacts[i];
            if (contact.IsSensor)
            {
                continue;
            }

            ContactTuning tuning = sink.Tune(in contact, ref solveContext);
            Manifold3D manifold = contact.Manifold;
            sink.PreSolve(ref contact, ref manifold, ref tuning, ref solveContext);
            contact.Manifold = manifold;
            InitContact(bodies, ref contact, tuning);
        }
    }

    /// <summary>
    /// Freezes the restitution biases of one contact from the pair tuning and
    /// applies the warm-start impulses carried in the manifold.
    /// </summary>
    private static void InitContact(BodyStore bodies, ref Contact3D contact, ContactTuning tuning)
    {
        Manifold3D manifold = contact.Manifold;

        ref BodyState stateA = ref bodies.Slot(contact.BodyA);
        ref BodyState stateB = ref bodies.Slot(contact.BodyB);

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
        float invMassA = awakeA ? stateA.InverseMass : 0.0f;
        float invMassB = awakeB ? stateB.InverseMass : 0.0f;
        Vec3 invIA = awakeA ? stateA.InverseInertia : Vec3.Zero;
        Vec3 invIB = awakeB ? stateB.InverseInertia : Vec3.Zero;

        Vec3 comA = stateA.Position + (stateA.Rotation * stateA.LocalCenter);
        Vec3 comB = stateB.Position + (stateB.Rotation * stateB.LocalCenter);

        BuildTangents(manifold.Normal, out Vec3 tangent1, out Vec3 tangent2);

        for (int p = 0; p < manifold.Count; p++)
        {
            ContactPoint3D point = manifold[p];
            Vec3 rA = point.PositionA - comA;
            Vec3 rB = point.PositionB - comB;

            Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
            Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
            float approach = Vec3.Dot(manifold.Normal, vA - vB);
            ContactPoint3D updated = point;
            updated.VelocityBias = approach < -tuning.RestitutionThreshold ? -tuning.Restitution * approach : 0.0f;
            manifold.SetPoint(p, updated);

            ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                rA, rB, manifold.Normal, point.NormalImpulse);
            ApplyTangentImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                rA, rB, tangent1, point.TangentImpulse1);
            ApplyTangentImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                rA, rB, tangent2, point.TangentImpulse2);
        }

        contact.Manifold = manifold;
        contact.Tuning = tuning;
    }

    /// <summary>
    /// Reports the impulses accumulated on every solid contact through a
    /// caller context; call after the last velocity sweep of the step. The
    /// tangent slot carries the combined magnitude of the two friction channels.
    /// </summary>
    /// <typeparam name="TSink">Sink implementing the post-solve callback point.</typeparam>
    /// <typeparam name="TContext">Caller state handed to the sink.</typeparam>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void ReportPostSolve<TSink, TContext>(
        Span<Contact3D> contacts, ref TSink sink, ref TContext solveContext)
        where TSink : struct, IContactSolveContext<Contact3D, Manifold3D, TContext>
        where TContext : allows ref struct
    {
        for (int i = 0; i < contacts.Length; i++)
        {
            ref readonly Contact3D contact = ref contacts[i];
            if (contact.IsSensor)
            {
                continue;
            }

            Manifold3D manifold = contact.Manifold;
            ContactImpulses impulses = new() { Count = manifold.Count, Phase = CollisionEventType.PostSolve };
            for (int p = 0; p < manifold.Count; p++)
            {
                ContactPoint3D point = manifold[p];
                impulses.WritePoint(p, point.NormalImpulse,
                    MathF.Sqrt((point.TangentImpulse1 * point.TangentImpulse1) + (point.TangentImpulse2 * point.TangentImpulse2)));
            }

            sink.PostSolve(in contact, in manifold, in impulses, ref solveContext);
        }
    }

    /// <summary>
    /// Combines two materials into the default tuning of their contact pair
    /// through each side's <see cref="CombineMode"/>.
    /// </summary>
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
            DynamicFriction = staticFriction * slideScale,
        };
    }

    /// <summary>
    /// Runs <paramref name="iterations"/> sweeps of normal plus friction
    /// impulses accumulated in place on the manifolds. Biases must be frozen
    /// by <see cref="InitVelocityConstraints"/> first.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolveVelocityPass(BodyStore bodies, ShapeStore shapes, Span<Contact3D> contacts, int iterations)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(shapes);

        for (int iteration = 0; iteration < iterations; iteration++)
        {
            for (int i = 0; i < contacts.Length; i++)
            {
                SolveContactVelocity(bodies, shapes, ref contacts[i]);
            }
        }
    }

    /// <summary>
    /// Runs the velocity pass: biases frozen from approach speeds, then
    /// <paramref name="iterations"/> sweeps of normal plus friction impulses
    /// accumulated in place on the manifolds.
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolveVelocity(BodyStore bodies, ShapeStore shapes, Span<Contact3D> contacts, int iterations)
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
    public static void SolvePositionPass(BodyStore bodies, Span<Contact3D> contacts)
    {
        ArgumentNullException.ThrowIfNull(bodies);

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
    public static void SolvePositions(BodyStore bodies, Span<Contact3D> contacts, int iterations)
    {
        for (int iteration = 0; iteration < iterations; iteration++)
        {
            SolvePositionPass(bodies, contacts);
        }
    }

    /// <summary>Applies a world inverse-inertia transform: R * (D * (R' * v)).</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static Vec3 ApplyInverseInertia(Quat rotation, Vec3 diagonal, Vec3 vector)
    {
        Vec3 local = rotation.Conjugate() * vector;
        return rotation * (local * diagonal);
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void SolveContactVelocity(BodyStore bodies, ShapeStore shapes, ref Contact3D contact)
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
        Vec3 invIA = awakeA ? stateA.InverseInertia : Vec3.Zero;
        Vec3 invIB = awakeB ? stateB.InverseInertia : Vec3.Zero;

        ref ContactTuning tuning = ref contact.Tuning;

        Manifold3D manifold = contact.Manifold;
        Vec3 normal = manifold.Normal;
        BuildTangents(normal, out Vec3 tangent1, out Vec3 tangent2);

        Vec3 comA = stateA.Position + (stateA.Rotation * stateA.LocalCenter);
        Vec3 comB = stateB.Position + (stateB.Rotation * stateB.LocalCenter);

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
                comA, comB, normal, tangent1, in tuning, ref manifold, p, channel: 0);
            SolvePointFriction(
                ref stateA, ref stateB, awakeA, awakeB,
                invMassA, invMassB, invIA, invIB,
                comA, comB, normal, tangent2, in tuning, ref manifold, p, channel: 1);
        }

        contact.Manifold = manifold;
    }

    /// <summary>Builds two orthonormal tangents around a unit normal.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static void BuildTangents(Vec3 normal, out Vec3 tangent1, out Vec3 tangent2)
    {
        Vec3 reference = MathF.Abs(normal.Y) < 0.99f ? new Vec3(0.0f, 1.0f, 0.0f) : new Vec3(1.0f, 0.0f, 0.0f);
        tangent1 = Vec3.Normalize(Vec3.Cross(normal, reference));
        tangent2 = Vec3.Cross(normal, tangent1);
    }

    /// <summary>Sequential normal impulse for one point with non-negative clamping.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void SolvePointNormal(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 comA, Vec3 comB, ref Manifold3D manifold, int p)
    {
        ContactPoint3D point = manifold[p];
        Vec3 normal = manifold.Normal;
        Vec3 rA = point.PositionA - comA;
        Vec3 rB = point.PositionB - comB;

        float normalMass = ComputeNormalMass(invMassA, invMassB, invIA, invIB, stateA.Rotation, stateB.Rotation, rA, rB, normal);

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        float vn = Vec3.Dot(normal, vA - vB);

        float lambda = normalMass * (-(vn - point.VelocityBias));
        float newImpulse = MathF.Max(point.NormalImpulse + lambda, 0.0f);
        float delta = newImpulse - point.NormalImpulse;

        ContactPoint3D updated = point;
        updated.NormalImpulse = newImpulse;
        manifold.SetPoint(p, updated);

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
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 comA, Vec3 comB, ref Manifold3D manifold)
    {
        Vec3 normal = manifold.Normal;
        ContactPoint3D p0 = manifold[0];
        ContactPoint3D p1 = manifold[1];

        Vec3 rA0 = p0.PositionA - comA;
        Vec3 rB0 = p0.PositionB - comB;
        Vec3 rA1 = p1.PositionA - comA;
        Vec3 rB1 = p1.PositionB - comB;

        float k11 = FullNormalMass(invMassA, invMassB, invIA, invIB, stateA.Rotation, stateB.Rotation, rA0, rB0, rA0, rB0, normal);
        float k22 = FullNormalMass(invMassA, invMassB, invIA, invIB, stateA.Rotation, stateB.Rotation, rA1, rB1, rA1, rB1, normal);
        float k12 = FullNormalMass(invMassA, invMassB, invIA, invIB, stateA.Rotation, stateB.Rotation, rA0, rB0, rA1, rB1, normal);

        float det = (k11 * k22) - (k12 * k12);
        if (det <= 0.0f || k11 <= 0.0f || k22 <= 0.0f)
        {
            SolvePointNormal(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, comA, comB, ref manifold, 0);
            SolvePointNormal(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, comA, comB, ref manifold, 1);
            return;
        }

        float invDet = 1.0f / det;

        Vec3 vA0 = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA0);
        Vec3 vB0 = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB0);
        Vec3 vA1 = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA1);
        Vec3 vB1 = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB1);

        float a1 = p0.NormalImpulse;
        float a2 = p1.NormalImpulse;
        float b1 = Vec3.Dot(normal, vA0 - vB0) - p0.VelocityBias - ((k11 * a1) + (k12 * a2));
        float b2 = Vec3.Dot(normal, vA1 - vB1) - p1.VelocityBias - ((k12 * a1) + (k22 * a2));

        for (; ; )
        {
            float x1 = -((k22 * b1) - (k12 * b2)) * invDet;
            float x2 = -((k11 * b2) - (k12 * b1)) * invDet;
            if (x1 >= 0.0f && x2 >= 0.0f)
            {
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA0, rB0, normal, x1 - a1);
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA1, rB1, normal, x2 - a2);
                SetImpulses(ref manifold, 0, x1, p0);
                SetImpulses(ref manifold, 1, x2, p1);
                break;
            }

            x1 = -b1 / k11;
            float vn2 = (k12 * x1) + b2;
            if (x1 >= 0.0f && vn2 >= 0.0f)
            {
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA0, rB0, normal, x1 - a1);
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA1, rB1, normal, 0.0f - a2);
                SetImpulses(ref manifold, 0, x1, p0);
                SetImpulses(ref manifold, 1, 0.0f, p1);
                break;
            }

            x2 = -b2 / k22;
            float vn1 = (k12 * x2) + b1;
            if (x2 >= 0.0f && vn1 >= 0.0f)
            {
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA0, rB0, normal, 0.0f - a1);
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA1, rB1, normal, x2 - a2);
                SetImpulses(ref manifold, 0, 0.0f, p0);
                SetImpulses(ref manifold, 1, x2, p1);
                break;
            }

            if (b1 >= 0.0f && b2 >= 0.0f)
            {
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA0, rB0, normal, 0.0f - a1);
                ApplyNormalImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA1, rB1, normal, 0.0f - a2);
                SetImpulses(ref manifold, 0, 0.0f, p0);
                SetImpulses(ref manifold, 1, 0.0f, p1);
            }

            break;
        }
    }

    /// <summary>Sequential Coulomb friction for one tangent channel with cone clamping.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void SolvePointFriction(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 comA, Vec3 comB, Vec3 normal, Vec3 tangent, in ContactTuning tuning, ref Manifold3D manifold, int p, int channel)
    {
        ContactPoint3D point = manifold[p];
        Vec3 rA = point.PositionA - comA;
        Vec3 rB = point.PositionB - comB;

        Vec3 rtA = Vec3.Cross(rA, tangent);
        Vec3 rtB = Vec3.Cross(rB, tangent);
        float tangentMass = 1.0f / (invMassA + invMassB
            + Vec3.Dot(rtA, ApplyInverseInertia(stateA.Rotation, invIA, rtA))
            + Vec3.Dot(rtB, ApplyInverseInertia(stateB.Rotation, invIB, rtB)));

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        float vt = Vec3.Dot(tangent, vA - vB) + (channel == 0 ? tuning.TangentSpeed : 0.0f);

        float stored = channel == 0 ? point.TangentImpulse1 : point.TangentImpulse2;
        float friction = tuning.Friction;
        float slideScale = tuning.DynamicFriction > 0.0f && friction > 0.0f
            ? MathF.Min(tuning.DynamicFriction / friction, 1.0f)
            : 1.0f;
        float maxFriction = friction * point.NormalImpulse;
        float newImpulse = Math.Clamp(stored - (tangentMass * vt * slideScale), -maxFriction, maxFriction);
        float delta = newImpulse - stored;

        ContactPoint3D updated = point;
        if (channel == 0)
        {
            updated.TangentImpulse1 = newImpulse;
        }
        else
        {
            updated.TangentImpulse2 = newImpulse;
        }

        manifold.SetPoint(p, updated);

        ApplyTangentImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, tangent, delta);
    }

    /// <summary>Effective mass of one point along the normal.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static float ComputeNormalMass(
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Quat rotA, Quat rotB, Vec3 rA, Vec3 rB, Vec3 normal)
    {
        Vec3 rnA = Vec3.Cross(rA, normal);
        Vec3 rnB = Vec3.Cross(rB, normal);
        float k = invMassA + invMassB
            + Vec3.Dot(rnA, ApplyInverseInertia(rotA, invIA, rnA))
            + Vec3.Dot(rnB, ApplyInverseInertia(rotB, invIB, rnB));
        return k > 0.0f ? 1.0f / k : 0.0f;
    }

    /// <summary>Coupled effective mass between two points along the normal.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static float FullNormalMass(
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Quat rotA, Quat rotB, Vec3 rA0, Vec3 rB0, Vec3 rA1, Vec3 rB1, Vec3 normal)
    {
        Vec3 rnA0 = Vec3.Cross(rA0, normal);
        Vec3 rnB0 = Vec3.Cross(rB0, normal);
        Vec3 rnA1 = Vec3.Cross(rA1, normal);
        Vec3 rnB1 = Vec3.Cross(rB1, normal);
        return invMassA + invMassB
            + Vec3.Dot(rnA0, ApplyInverseInertia(rotA, invIA, rnA1))
            + Vec3.Dot(rnB0, ApplyInverseInertia(rotB, invIB, rnB1));
    }

    /// <summary>Applies a normal impulse; the normal points from B toward A.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void ApplyNormalImpulse(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 rA, Vec3 rB, Vec3 normal, float delta)
    {
        if (awakeA)
        {
            stateA.LinearVelocity += normal * (delta * invMassA);
            stateA.AngularVelocity += ApplyInverseInertia(stateA.Rotation, invIA, Vec3.Cross(rA, normal) * delta);
        }

        if (awakeB)
        {
            stateB.LinearVelocity -= normal * (delta * invMassB);
            stateB.AngularVelocity -= ApplyInverseInertia(stateB.Rotation, invIB, Vec3.Cross(rB, normal) * delta);
        }
    }

    /// <summary>Applies a tangent impulse.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static void ApplyTangentImpulse(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 rA, Vec3 rB, Vec3 tangent, float delta)
    {
        if (awakeA)
        {
            stateA.LinearVelocity += tangent * (delta * invMassA);
            stateA.AngularVelocity += ApplyInverseInertia(stateA.Rotation, invIA, Vec3.Cross(rA, tangent) * delta);
        }

        if (awakeB)
        {
            stateB.LinearVelocity -= tangent * (delta * invMassB);
            stateB.AngularVelocity -= ApplyInverseInertia(stateB.Rotation, invIB, Vec3.Cross(rB, tangent) * delta);
        }
    }

    /// <summary>Rewrites the normal impulse of a block-solved point, keeping friction channels.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static void SetImpulses(ref Manifold3D manifold, int index, float normalImpulse, ContactPoint3D source)
    {
        ContactPoint3D updated = source;
        updated.NormalImpulse = normalImpulse;
        manifold.SetPoint(index, updated);
    }

    /// <summary>Rotates an orientation by a small correction vector; zero spin is a no-op.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private static Quat RotateBy(Quat rotation, Vec3 spin)
    {
        float angle = spin.Length();
        if (angle <= 1e-12f)
        {
            return rotation;
        }

        return (Quat.CreateFromAxisAngle(spin / angle, angle) * rotation).Normalize();
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void SolveContactPosition(BodyStore bodies, ref Contact3D contact)
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
        Vec3 invIA = awakeA ? stateA.InverseInertia : Vec3.Zero;
        Vec3 invIB = awakeB ? stateB.InverseInertia : Vec3.Zero;

        Manifold3D manifold = contact.Manifold;
        Vec3 comA = stateA.Position + (stateA.Rotation * stateA.LocalCenter);
        Vec3 comB = stateB.Position + (stateB.Rotation * stateB.LocalCenter);

        for (int p = 0; p < manifold.Count; p++)
        {
            ContactPoint3D point = manifold[p];
            float correction = Math.Clamp(
                SolverTuning.Baumgarte * (point.Separation + SolverTuning.LinearSlop),
                -SolverTuning.MaxCorrection, 0.0f);
            if (correction == 0.0f)
            {
                continue;
            }

            Vec3 rA = point.PositionA - comA;
            Vec3 rB = point.PositionB - comB;
            float k = invMassA + invMassB
                + Vec3.Dot(Vec3.Cross(rA, manifold.Normal), ApplyInverseInertia(stateA.Rotation, invIA, Vec3.Cross(rA, manifold.Normal)))
                + Vec3.Dot(Vec3.Cross(rB, manifold.Normal), ApplyInverseInertia(stateB.Rotation, invIB, Vec3.Cross(rB, manifold.Normal)));
            if (k <= 0.0f)
            {
                continue;
            }

            float lambda = correction / k;
            float push = -lambda;
            if (awakeA)
            {
                stateA.Position += manifold.Normal * (push * invMassA);
                Vec3 spinA = ApplyInverseInertia(stateA.Rotation, invIA, Vec3.Cross(rA, manifold.Normal)) * push;
                stateA.Rotation = RotateBy(stateA.Rotation, spinA);
            }

            if (awakeB)
            {
                stateB.Position -= manifold.Normal * (push * invMassB);
                Vec3 spinB = ApplyInverseInertia(stateB.Rotation, invIB, Vec3.Cross(rB, manifold.Normal)) * push;
                stateB.Rotation = RotateBy(stateB.Rotation, spinB);
            }
        }
    }
}
