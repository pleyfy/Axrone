namespace Axrone.Physics3D;

/// <summary>
/// Joint constraint solver: distance rods as one scalar row, ball-sockets as
/// symmetric 3x3 point rows, welds as point rows plus orientation rows. All
/// rows are bilateral (no clamping); impulses accumulate across steps for
/// warm starting. Positions correct with the same Baumgarte hand as
/// contacts.
/// </summary>
public static class JointSolver
{
    private const float PositionBeta = 0.2f;

    /// <summary>Runs one velocity sweep over every live joint.</summary>
    /// <param name="bodies">Body registry.</param>
    /// <param name="joints">Joint registry.</param>
    /// <param name="h">Step length; feeds limit Baumgarte biases and motor clamps.</param>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolveVelocityPass(BodyStore bodies, JointStore joints, float h)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(joints);

        for (int slot = 0; slot < joints.DistanceCapacity; slot++)
        {
            if (!joints.IsDistanceLive(slot))
            {
                continue;
            }

            SolveDistanceVelocity(bodies, ref joints.Distance(slot));
        }

        for (int slot = 0; slot < joints.BallSocketCapacity; slot++)
        {
            if (!joints.IsBallSocketLive(slot))
            {
                continue;
            }

            SolveBallSocketVelocity(bodies, ref joints.BallSocket(slot));
        }

        for (int slot = 0; slot < joints.WeldCapacity; slot++)
        {
            if (!joints.IsWeldLive(slot))
            {
                continue;
            }

            SolveWeldVelocity(bodies, ref joints.Weld(slot));
        }

        for (int slot = 0; slot < joints.HingeCapacity; slot++)
        {
            if (!joints.IsHingeLive(slot))
            {
                continue;
            }

            SolveHingeVelocity(bodies, ref joints.Hinge(slot), h);
        }

        for (int slot = 0; slot < joints.PrismaticCapacity; slot++)
        {
            if (!joints.IsPrismaticLive(slot))
            {
                continue;
            }

            SolvePrismaticVelocity(bodies, ref joints.Prismatic(slot), h);
        }

        for (int slot = 0; slot < joints.ConeTwistCapacity; slot++)
        {
            if (!joints.IsConeTwistLive(slot))
            {
                continue;
            }

            SolveConeTwistVelocity(bodies, ref joints.ConeTwist(slot), h);
        }

        for (int slot = 0; slot < joints.ConfigurableCapacity; slot++)
        {
            if (!joints.IsConfigurableLive(slot))
            {
                continue;
            }

            SolveConfigurableVelocity(bodies, ref joints.Configurable(slot), h);
        }
    }

    /// <summary>Applies spring-damper forces once per step; forces do not iterate.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolveSpringPass(BodyStore bodies, JointStore joints, float h)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(joints);

        for (int slot = 0; slot < joints.SpringCapacity; slot++)
        {
            if (!joints.IsSpringLive(slot))
            {
                continue;
            }

            ref SpringJointData spring = ref joints.Spring(slot);
            ref BodyState stateA = ref bodies.Slot(spring.BodyA);
            ref BodyState stateB = ref bodies.Slot(spring.BodyB);
            InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
                out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB);
            if (!awakeA && !awakeB)
            {
                continue;
            }

            AnchorFrame(ref stateA, spring.LocalAnchorA, out Vec3 pa, out _, out Vec3 rA);
            AnchorFrame(ref stateB, spring.LocalAnchorB, out Vec3 pb, out _, out Vec3 rB);

            Vec3 delta = pa - pb;
            float dist = delta.Length();
            if (dist < 1e-9f)
            {
                continue;
            }

            Vec3 axis = delta / dist;
            Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
            Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
            float rate = Vec3.Dot(axis, vA - vB);
            float lambda = -((spring.Stiffness * (dist - spring.RestLength)) + (spring.Damping * rate)) * h;
            ApplyLinearRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, axis, lambda);
        }
    }

    /// <summary>Runs one position sweep over every live joint.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public static void SolvePositionPass(BodyStore bodies, JointStore joints)
    {
        ArgumentNullException.ThrowIfNull(bodies);
        ArgumentNullException.ThrowIfNull(joints);

        for (int slot = 0; slot < joints.DistanceCapacity; slot++)
        {
            if (!joints.IsDistanceLive(slot))
            {
                continue;
            }

            SolveDistancePosition(bodies, ref joints.Distance(slot));
        }

        for (int slot = 0; slot < joints.BallSocketCapacity; slot++)
        {
            if (!joints.IsBallSocketLive(slot))
            {
                continue;
            }

            SolveBallSocketPosition(bodies, ref joints.BallSocket(slot));
        }

        for (int slot = 0; slot < joints.WeldCapacity; slot++)
        {
            if (!joints.IsWeldLive(slot))
            {
                continue;
            }

            SolveWeldPosition(bodies, ref joints.Weld(slot));
        }

        for (int slot = 0; slot < joints.HingeCapacity; slot++)
        {
            if (!joints.IsHingeLive(slot))
            {
                continue;
            }

            SolveHingePosition(bodies, ref joints.Hinge(slot));
        }

        for (int slot = 0; slot < joints.PrismaticCapacity; slot++)
        {
            if (!joints.IsPrismaticLive(slot))
            {
                continue;
            }

            SolvePrismaticPosition(bodies, ref joints.Prismatic(slot));
        }

        for (int slot = 0; slot < joints.ConeTwistCapacity; slot++)
        {
            if (!joints.IsConeTwistLive(slot))
            {
                continue;
            }

            SolveConeTwistPosition(bodies, ref joints.ConeTwist(slot));
        }

        for (int slot = 0; slot < joints.ConfigurableCapacity; slot++)
        {
            if (!joints.IsConfigurableLive(slot))
            {
                continue;
            }

            SolveConfigurablePosition(bodies, ref joints.Configurable(slot));
        }
    }

    /// <summary>World anchor and lever arms of a joint end.</summary>
    private static void AnchorFrame(
        ref BodyState state, Vec3 localAnchor,
        out Vec3 worldAnchor, out Vec3 centerOfMass, out Vec3 lever)
    {
        var frame = new RigidTransform3D(state.Position, state.Rotation);
        worldAnchor = frame.TransformPoint(localAnchor);
        centerOfMass = state.Position + (state.Rotation * state.LocalCenter);
        lever = worldAnchor - centerOfMass;
    }

    /// <summary>Effective inverse masses, zeroing sleeping bodies.</summary>
    private static void InverseMasses(
        ref BodyState stateA, ref BodyState stateB,
        out bool awakeA, out bool awakeB,
        out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB)
    {
        awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
        invMassA = awakeA ? stateA.InverseMass : 0.0f;
        invMassB = awakeB ? stateB.InverseMass : 0.0f;
        invIA = awakeA ? stateA.InverseInertia : Vec3.Zero;
        invIB = awakeB ? stateB.InverseInertia : Vec3.Zero;
    }

    private static void SolveDistanceVelocity(BodyStore bodies, ref DistanceJointData joint)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB);

        AnchorFrame(ref stateA, joint.LocalAnchorA, out Vec3 pa, out _, out Vec3 rA);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out Vec3 pb, out _, out Vec3 rB);

        Vec3 delta = pa - pb;
        float dist = delta.Length();
        if (dist < 1e-9f)
        {
            return;
        }

        Vec3 axis = delta / dist;
        Vec3 rnA = Vec3.Cross(rA, axis);
        Vec3 rnB = Vec3.Cross(rB, axis);
        float k = invMassA + invMassB
            + Vec3.Dot(rnA, ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, rnA))
            + Vec3.Dot(rnB, ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, rnB));
        if (k <= 0.0f)
        {
            return;
        }

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        float lambda = -(Vec3.Dot(axis, vA - vB)) / k;
        joint.Impulse += lambda;

        ApplyLinearRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, axis, lambda);
    }

    private static void SolveDistancePosition(BodyStore bodies, ref DistanceJointData joint)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out _, out _);
        if ((!awakeA && !awakeB) || (invMassA + invMassB) <= 0.0f)
        {
            return;
        }

        AnchorFrame(ref stateA, joint.LocalAnchorA, out Vec3 pa, out _, out _);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out Vec3 pb, out _, out _);

        Vec3 delta = pa - pb;
        float dist = delta.Length();
        if (dist < 1e-9f)
        {
            return;
        }

        float correction = PositionBeta * (dist - joint.Length) / ((invMassA + invMassB) * dist);
        if (awakeA)
        {
            stateA.Position -= delta * (correction * invMassA);
        }

        if (awakeB)
        {
            stateB.Position += delta * (correction * invMassB);
        }
    }

    private static void SolveBallSocketVelocity(BodyStore bodies, ref BallSocketJointData joint)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB);

        AnchorFrame(ref stateA, joint.LocalAnchorA, out _, out _, out Vec3 rA);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out _, out _, out Vec3 rB);

        BuildPointMatrix(invMassA, invMassB, invIA, invIB,
            stateA.Rotation, stateB.Rotation, rA, rB,
            out Vec3 col0, out Vec3 col1, out Vec3 col2);

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        Vec3 bias = vA - vB;
        Vec3 lambda = SolveSymmetric3x3(col0, col1, col2, bias * -1.0f);
        joint.Impulse += lambda;

        ApplyPointImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, lambda);
    }

    private static void SolveBallSocketPosition(BodyStore bodies, ref BallSocketJointData joint)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out _, out _);
        if ((!awakeA && !awakeB) || (invMassA + invMassB) <= 0.0f)
        {
            return;
        }

        AnchorFrame(ref stateA, joint.LocalAnchorA, out Vec3 pa, out _, out _);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out Vec3 pb, out _, out _);

        Vec3 error = (pa - pb) * (PositionBeta / (invMassA + invMassB));
        if (awakeA)
        {
            stateA.Position -= error * invMassA;
        }

        if (awakeB)
        {
            stateB.Position += error * invMassB;
        }
    }

    private static void SolveWeldVelocity(BodyStore bodies, ref WeldJointData joint)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB);

        AnchorFrame(ref stateA, joint.LocalAnchorA, out _, out _, out Vec3 rA);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out _, out _, out Vec3 rB);

        BuildPointMatrix(invMassA, invMassB, invIA, invIB,
            stateA.Rotation, stateB.Rotation, rA, rB,
            out Vec3 col0, out Vec3 col1, out Vec3 col2);

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        Vec3 linear = SolveSymmetric3x3(col0, col1, col2, (vA - vB) * -1.0f);
        joint.LinearImpulse += linear;
        ApplyPointImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, linear);

        SolveAngularLockVelocity(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, ref joint.AngularImpulse);
    }

    private static void SolveWeldPosition(BodyStore bodies, ref WeldJointData joint)
    {
        var point = new BallSocketJointData
        {
            BodyA = joint.BodyA,
            BodyB = joint.BodyB,
            LocalAnchorA = joint.LocalAnchorA,
            LocalAnchorB = joint.LocalAnchorB,
        };
        SolveBallSocketPosition(bodies, ref point);

        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out _, out _, out Vec3 invIA, out Vec3 invIB);
        if (!awakeA && !awakeB)
        {
            return;
        }

        Quat desired = stateA.Rotation * joint.ReferenceRotation;
        Quat error = stateB.Rotation.Conjugate() * desired;
        if (error.W < 0.0f)
        {
            error = new Quat(error.X * -1.0f, error.Y * -1.0f, error.Z * -1.0f, error.W * -1.0f);
        }

        Vec3 axis = new(error.X, error.Y, error.Z);
        float axisLen = axis.Length();
        if (axisLen < 1e-9f)
        {
            return;
        }

        float angle = 2.0f * MathF.Atan2(axisLen, error.W) * PositionBeta;
        Vec3 spin = (axis / axisLen) * angle;

        float weightA = awakeA ? 1.0f : 0.0f;
        float weightB = awakeB ? 1.0f : 0.0f;
        float total = weightA + weightB;
        if (awakeA)
        {
            stateA.Rotation = (Quat.CreateFromAxisAngle(spin / angle * -1.0f, angle * (weightA / total)) * stateA.Rotation).Normalize();
        }

        if (awakeB)
        {
            stateB.Rotation = (Quat.CreateFromAxisAngle(spin / angle, angle * (weightB / total)) * stateB.Rotation).Normalize();
        }
    }

    /// <summary>Builds the symmetric 3x3 point-constraint matrix as columns.</summary>
    private static void BuildPointMatrix(
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Quat rotA, Quat rotB, Vec3 rA, Vec3 rB,
        out Vec3 col0, out Vec3 col1, out Vec3 col2)
    {
        col0 = MatrixColumn(invMassA, invMassB, invIA, invIB, rotA, rotB, rA, rB, new Vec3(1, 0, 0));
        col1 = MatrixColumn(invMassA, invMassB, invIA, invIB, rotA, rotB, rA, rB, new Vec3(0, 1, 0));
        col2 = MatrixColumn(invMassA, invMassB, invIA, invIB, rotA, rotB, rA, rB, new Vec3(0, 0, 1));
    }

    /// <summary>One column of the point-constraint matrix along a basis vector.</summary>
    /// <remarks>
    /// The rotational term is (I^-1 (r x e)) x r: the impulse arm crosses
    /// back after the inertia transform, keeping the diagonal positive.
    /// </remarks>
    private static Vec3 MatrixColumn(
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Quat rotA, Quat rotB, Vec3 rA, Vec3 rB, Vec3 basis)
    {
        Vec3 angular = Vec3.Cross(ContactSolver.ApplyInverseInertia(rotA, invIA, Vec3.Cross(rA, basis)), rA)
            + Vec3.Cross(ContactSolver.ApplyInverseInertia(rotB, invIB, Vec3.Cross(rB, basis)), rB);
        return (basis * (invMassA + invMassB)) + angular;
    }

    /// <summary>Builds the symmetric 3x3 angular-constraint matrix as columns.</summary>
    private static void BuildAngularMatrix(
        Vec3 invIA, Vec3 invIB, Quat rotA, Quat rotB,
        out Vec3 col0, out Vec3 col1, out Vec3 col2)
    {
        col0 = ContactSolver.ApplyInverseInertia(rotA, invIA, new Vec3(1, 0, 0))
            + ContactSolver.ApplyInverseInertia(rotB, invIB, new Vec3(1, 0, 0));
        col1 = ContactSolver.ApplyInverseInertia(rotA, invIA, new Vec3(0, 1, 0))
            + ContactSolver.ApplyInverseInertia(rotB, invIB, new Vec3(0, 1, 0));
        col2 = ContactSolver.ApplyInverseInertia(rotA, invIA, new Vec3(0, 0, 1))
            + ContactSolver.ApplyInverseInertia(rotB, invIB, new Vec3(0, 0, 1));
    }

    /// <summary>Solves a symmetric 3x3 system by Cramer's rule; singular systems return zero.</summary>
    private static Vec3 SolveSymmetric3x3(Vec3 col0, Vec3 col1, Vec3 col2, Vec3 rhs)
    {
        Vec3 cross12 = Vec3.Cross(col1, col2);
        float det = Vec3.Dot(col0, cross12);
        if (MathF.Abs(det) < 1e-18f)
        {
            return Vec3.Zero;
        }

        float invDet = 1.0f / det;
        return new Vec3(
            Vec3.Dot(rhs, cross12) * invDet,
            Vec3.Dot(col0, Vec3.Cross(rhs, col2)) * invDet,
            Vec3.Dot(col0, Vec3.Cross(col1, rhs)) * invDet);
    }

    /// <summary>Applies a point impulse at the anchors.</summary>
    private static void ApplyPointImpulse(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 rA, Vec3 rB, Vec3 impulse)
    {
        if (awakeA)
        {
            stateA.LinearVelocity += impulse * invMassA;
            stateA.AngularVelocity += ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, Vec3.Cross(rA, impulse));
        }

        if (awakeB)
        {
            stateB.LinearVelocity -= impulse * invMassB;
            stateB.AngularVelocity -= ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, Vec3.Cross(rB, impulse));
        }
    }

    /// <summary>Applies a scalar row impulse along an axis.</summary>
    private static void ApplyLinearRow(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 rA, Vec3 rB, Vec3 axis, float lambda)
    {
        Vec3 impulse = axis * lambda;
        ApplyPointImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, impulse);
    }

    /// <summary>Measures the hinge angle about the world axis from the reference perpendiculars.</summary>
    private static float HingeAngle(Quat rotA, Quat rotB, Vec3 localPerpA, Vec3 localPerpB, Vec3 worldAxis)
    {
        Vec3 u = rotA * localPerpA;
        Vec3 w = rotB * localPerpB;
        return MathF.Atan2(Vec3.Dot(Vec3.Cross(u, w), worldAxis), Vec3.Dot(u, w));
    }

    /// <summary>Builds two orthonormal directions perpendicular to a hinge axis.</summary>
    private static void HingeTangents(Vec3 axis, out Vec3 t1, out Vec3 t2)
    {
        Vec3 reference = MathF.Abs(axis.Y) < 0.99f ? new Vec3(0.0f, 1.0f, 0.0f) : new Vec3(1.0f, 0.0f, 0.0f);
        t1 = Vec3.Normalize(Vec3.Cross(axis, reference));
        t2 = Vec3.Cross(axis, t1);
    }

    private static void SolveHingeVelocity(BodyStore bodies, ref HingeJointData joint, float h)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB);

        AnchorFrame(ref stateA, joint.LocalAnchorA, out _, out _, out Vec3 rA);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out _, out _, out Vec3 rB);

        BuildPointMatrix(invMassA, invMassB, invIA, invIB,
            stateA.Rotation, stateB.Rotation, rA, rB,
            out Vec3 col0, out Vec3 col1, out Vec3 col2);

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        Vec3 point = SolveSymmetric3x3(col0, col1, col2, (vA - vB) * -1.0f);
        joint.PointImpulse += point;
        ApplyPointImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, point);

        Vec3 axisA = stateA.Rotation * joint.LocalAxisA;
        Vec3 axisB = stateB.Rotation * joint.LocalAxisB;
        HingeTangents(axisA, out Vec3 t1, out Vec3 t2);
        SolveAxisPair(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axisB, t1, t2, ref joint.AxisImpulse);

        float angle = HingeAngle(stateA.Rotation, stateB.Rotation, joint.LocalPerpA, joint.LocalPerpB, axisA);
        SolveHingeAngularRows(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axisA, angle, ref joint, h);
    }

    /// <summary>Two axis-alignment rows around one axis pair.</summary>
    private static void SolveAxisPair(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        Vec3 invIA, Vec3 invIB, Vec3 axisB, Vec3 t1, Vec3 t2, ref Vec3 accumulated)
    {
        SolveHingeAxisRow(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axisB, t1, ref accumulated, channel: 0);
        SolveHingeAxisRow(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axisB, t2, ref accumulated, channel: 1);
    }

    /// <summary>Drives the relative spin of two bodies to zero.</summary>
    private static void SolveAngularLockVelocity(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        Vec3 invIA, Vec3 invIB, ref Vec3 accumulated)
    {
        BuildAngularMatrix(invIA, invIB, stateA.Rotation, stateB.Rotation,
            out Vec3 a0, out Vec3 a1, out Vec3 a2);
        Vec3 angular = SolveSymmetric3x3(a0, a1, a2, (stateA.AngularVelocity - stateB.AngularVelocity) * -1.0f);
        accumulated += angular;

        if (awakeA)
        {
            stateA.AngularVelocity += ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, angular);
        }

        if (awakeB)
        {
            stateB.AngularVelocity -= ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, angular);
        }
    }

    /// <summary>Rotates both bodies around the axis error so the axes converge; static bodies hold still.</summary>
    private static void CorrectAxisAlignment(BodyStore bodies, BodyId bodyA, BodyId bodyB, Vec3 axisA, Vec3 axisB)
    {
        ref BodyState stateA = ref bodies.Slot(bodyA);
        ref BodyState stateB = ref bodies.Slot(bodyB);
        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
        if (!awakeA && !awakeB)
        {
            return;
        }

        Vec3 error = Vec3.Cross(axisA, axisB) * (PositionBeta * 0.5f);
        float weightA = awakeA ? 1.0f : 0.0f;
        float weightB = awakeB ? 1.0f : 0.0f;
        float total = weightA + weightB;
        if (awakeA)
        {
            stateA.Rotation = RotateCorrection(stateA.Rotation, error * (weightA / total));
        }

        if (awakeB)
        {
            stateB.Rotation = RotateCorrection(stateB.Rotation, error * (weightB / total));
        }
    }

    /// <summary>One axis-alignment row: drives an axis pair back to parallel.</summary>
    private static void SolveHingeAxisRow(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        Vec3 invIA, Vec3 invIB, Vec3 axisB, Vec3 tangent, ref Vec3 accumulated, int channel)
    {
        Vec3 jA = Vec3.Cross(tangent, axisB);
        Vec3 jB = Vec3.Cross(axisB, tangent);
        float k = Vec3.Dot(jA, ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, jA))
            + Vec3.Dot(jB, ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, jB));
        if (k <= 0.0f)
        {
            return;
        }

        float rate = Vec3.Dot(jA, stateA.AngularVelocity) + Vec3.Dot(jB, stateB.AngularVelocity);
        float stored = channel == 0 ? accumulated.X : accumulated.Y;
        float updated = stored + (-rate / k);

        if (channel == 0)
        {
            accumulated.X = updated;
        }
        else
        {
            accumulated.Y = updated;
        }

        float delta = updated - stored;
        if (awakeA)
        {
            stateA.AngularVelocity += ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, jA * delta);
        }

        if (awakeB)
        {
            stateB.AngularVelocity += ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, jB * delta);
        }
    }

    /// <summary>Limit and motor rows around a twist axis.</summary>
    private static void SolveHingeAngularRows(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        Vec3 invIA, Vec3 invIB, Vec3 axis, float angle, ref HingeJointData joint, float h)
    {
        SolveTwistLimitMotor(
            ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, angle,
            joint.LowerLimit, joint.UpperLimit, joint.EnableLimit,
            joint.MotorSpeed, joint.MaxMotorTorque, joint.EnableMotor,
            ref joint.LimitImpulse, ref joint.MotorImpulse, h,
            joint.LimitMode, in joint.LimitSpring, ref joint.LimitEngaged, ref joint.LimitBounceBias);
    }

    /// <summary>Twist stops with a centered range plus an optional speed motor around an axis.</summary>
    private static void SolveTwistLimitMotor(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        Vec3 invIA, Vec3 invIB, Vec3 axis, float angle,
        float lowerLimit, float upperLimit, bool enableLimit,
        float motorSpeed, float maxMotorTorque, bool enableMotor,
        ref float limitImpulse, ref float motorImpulse, float h,
        JointLimitMode mode, in LimitSpringSettings spring, ref float engagedFlag, ref float bounceBias)
    {
        float k = Vec3.Dot(axis, ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, axis))
            + Vec3.Dot(axis, ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, axis));
        if (k <= 0.0f)
        {
            return;
        }

        float rate = Vec3.Dot(axis, stateB.AngularVelocity - stateA.AngularVelocity);

        if (enableLimit)
        {
            float violation = 0.0f;
            float sign = 0.0f;
            if (angle < lowerLimit)
            {
                violation = lowerLimit - angle;
                sign = 1.0f;
            }
            else if (angle > upperLimit)
            {
                violation = angle - upperLimit;
                sign = -1.0f;
            }

            if (mode == JointLimitMode.Hard)
            {
                if (sign != 0.0f)
                {
                    float bias = (PositionBeta / MathF.Max(h, 1e-6f)) * violation;
                    float lambda = (-(rate * sign) + bias) / k;
                    float updated = MathF.Max(limitImpulse + lambda, 0.0f);
                    ApplyHingeSpin(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, (updated - limitImpulse) * sign);
                    limitImpulse = updated;
                }
            }
            else
            {
                float dLow = angle - lowerLimit;
                float dHigh = upperLimit - angle;
                float side = dLow <= dHigh ? 1.0f : -1.0f;
                float past = side > 0.0f ? -dLow : -dHigh;
                SolveSoftAngularLimit(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, k,
                    past, side * rate, h, in spring, side, ref limitImpulse, ref engagedFlag, ref bounceBias);
            }
        }

        if (enableMotor)
        {
            float lambda = -((rate - motorSpeed)) / k;
            float cap = maxMotorTorque * h;
            float updated = Math.Clamp(motorImpulse + lambda, -cap, cap);
            ApplyHingeSpin(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, updated - motorImpulse);
            motorImpulse = updated;
        }
    }

    /// <summary>Applies a spin impulse around the hinge axis: A backward, B forward.</summary>
    private static void ApplyHingeSpin(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        Vec3 invIA, Vec3 invIB, Vec3 axis, float delta)
    {
        if (awakeA)
        {
            stateA.AngularVelocity -= ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, axis * delta);
        }

        if (awakeB)
        {
            stateB.AngularVelocity += ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, axis * delta);
        }
    }

    private static void SolveHingePosition(BodyStore bodies, ref HingeJointData joint)
    {
        var point = new BallSocketJointData
        {
            BodyA = joint.BodyA,
            BodyB = joint.BodyB,
            LocalAnchorA = joint.LocalAnchorA,
            LocalAnchorB = joint.LocalAnchorB,
        };
        SolveBallSocketPosition(bodies, ref point);

        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out _, out _, out _, out _);
        if (!awakeA && !awakeB)
        {
            return;
        }

        Vec3 axisA = stateA.Rotation * joint.LocalAxisA;
        Vec3 axisB = stateB.Rotation * joint.LocalAxisB;
        CorrectAxisAlignment(bodies, joint.BodyA, joint.BodyB, axisA, axisB);
    }

    /// <summary>Rotates an orientation by a small correction vector.</summary>
    private static Quat RotateCorrection(Quat rotation, Vec3 correction)
    {
        float angle = correction.Length();
        if (angle <= 1e-12f)
        {
            return rotation;
        }

        return (Quat.CreateFromAxisAngle(correction / angle, angle) * rotation).Normalize();
    }

    private static void SolveConeTwistVelocity(BodyStore bodies, ref ConeTwistJointData joint, float h)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB);

        AnchorFrame(ref stateA, joint.LocalAnchorA, out _, out _, out Vec3 rA);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out _, out _, out Vec3 rB);

        BuildPointMatrix(invMassA, invMassB, invIA, invIB,
            stateA.Rotation, stateB.Rotation, rA, rB,
            out Vec3 col0, out Vec3 col1, out Vec3 col2);

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        Vec3 point = SolveSymmetric3x3(col0, col1, col2, (vA - vB) * -1.0f);
        joint.PointImpulse += point;
        ApplyPointImpulse(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, point);

        Vec3 axisA = stateA.Rotation * joint.LocalAxisA;
        Vec3 axisB = stateB.Rotation * joint.LocalAxisB;
        float swing = MathF.Acos(Math.Clamp(Vec3.Dot(axisA, axisB), -1.0f, 1.0f));
        if (swing > joint.SwingSpan)
        {
            HingeTangents(axisA, out Vec3 t1, out Vec3 t2);
            SolveAxisPair(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axisB, t1, t2, ref joint.SwingImpulse);
        }

        float twist = HingeAngle(stateA.Rotation, stateB.Rotation, joint.LocalPerpA, joint.LocalPerpB, axisA);
        float halfTwist = joint.TwistSpan * 0.5f;
        float twistEngaged = 0.0f;
        float twistBounceBias = 0.0f;
        LimitSpringSettings hardOnlySpring = default;
        SolveTwistLimitMotor(
            ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axisA, twist,
            -halfTwist, halfTwist, true,
            joint.MotorSpeed, joint.MaxMotorTorque, joint.EnableMotor,
            ref joint.TwistLimitImpulse, ref joint.TwistMotorImpulse, h,
            JointLimitMode.Hard, in hardOnlySpring, ref twistEngaged, ref twistBounceBias);
    }

    private static void SolveConeTwistPosition(BodyStore bodies, ref ConeTwistJointData joint)
    {
        var point = new BallSocketJointData
        {
            BodyA = joint.BodyA,
            BodyB = joint.BodyB,
            LocalAnchorA = joint.LocalAnchorA,
            LocalAnchorB = joint.LocalAnchorB,
        };
        SolveBallSocketPosition(bodies, ref point);

        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out _, out _, out _, out _);
        if (!awakeA && !awakeB)
        {
            return;
        }

        Vec3 axisA = stateA.Rotation * joint.LocalAxisA;
        Vec3 axisB = stateB.Rotation * joint.LocalAxisB;
        float swing = MathF.Acos(Math.Clamp(Vec3.Dot(axisA, axisB), -1.0f, 1.0f));
        if (swing > joint.SwingSpan)
        {
            CorrectAxisAlignment(bodies, joint.BodyA, joint.BodyB, axisA, axisB);
        }
    }

    private static void SolvePrismaticVelocity(BodyStore bodies, ref PrismaticJointData joint, float h)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB);

        AnchorFrame(ref stateA, joint.LocalAnchorA, out Vec3 pa, out _, out Vec3 rA);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out Vec3 pb, out _, out Vec3 rB);
        Vec3 axisA = stateA.Rotation * joint.LocalAxisA;
        Vec3 axisB = stateB.Rotation * joint.LocalAxisB;

        HingeTangents(axisA, out Vec3 t1, out Vec3 t2);
        Vec3 span = pb - pa;
        SolveLineRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
            rA, rB, span, t1, ref joint.LineImpulse, channel: 0);
        SolveLineRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
            rA, rB, span, t2, ref joint.LineImpulse, channel: 1);

        SolveAxisPair(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axisB, t1, t2, ref joint.AxisImpulse);
        SolveAngularLockVelocity(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, ref joint.AngularImpulse);

        float travel = Vec3.Dot(axisA, span);
        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        float slideRate = Vec3.Dot(axisA, vB - vA);

        if (joint.EnableLimit && joint.LimitMode == JointLimitMode.Soft)
        {
            float dLow = travel - joint.LowerLimit;
            float dHigh = joint.UpperLimit - travel;
            float side = dLow <= dHigh ? 1.0f : -1.0f;
            float past = side > 0.0f ? -dLow : -dHigh;
            SolveSoftLinearLimit(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                rA, rB, axisA * -side, past, side * slideRate, h, in joint.LimitSpring,
                ref joint.LimitImpulse, ref joint.LimitEngaged, ref joint.LimitBounceBias);
        }
        else if (joint.EnableLimit)
        {
            float violation = 0.0f;
            float sign = 0.0f;
            if (travel < joint.LowerLimit)
            {
                violation = joint.LowerLimit - travel;
                sign = 1.0f;
            }
            else if (travel > joint.UpperLimit)
            {
                violation = travel - joint.UpperLimit;
                sign = -1.0f;
            }

            if (sign != 0.0f)
            {
                Vec3 rowAxis = axisA * -sign;
                float bias = (PositionBeta / MathF.Max(h, 1e-6f)) * violation;
                SolveAxisSlideRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                    rA, rB, rowAxis, sign * slideRate, bias, ref joint.LimitImpulse, clampLow: 0.0f, clampHigh: float.PositiveInfinity);
            }
        }

        if (joint.EnableMotor)
        {
            float cap = joint.MaxMotorForce * h;
            SolveAxisSlideRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                rA, rB, axisA * -1.0f, slideRate, joint.MotorSpeed, ref joint.MotorImpulse, clampLow: -cap, clampHigh: cap);
        }
    }

    /// <summary>One point-to-line row: kills the anchor separation along a perpendicular.</summary>
    private static void SolveLineRow(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 rA, Vec3 rB, Vec3 span, Vec3 tangent, ref Vec3 accumulated, int channel)
    {
        Vec3 rtA = Vec3.Cross(rA, tangent);
        Vec3 rtB = Vec3.Cross(rB, tangent);
        float k = invMassA + invMassB
            + Vec3.Dot(rtA, ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, rtA))
            + Vec3.Dot(rtB, ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, rtB));
        if (k <= 0.0f)
        {
            return;
        }

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        float rate = Vec3.Dot(tangent, vA - vB);
        float stored = channel == 0 ? accumulated.X : accumulated.Y;
        float updated = stored + (-rate / k);

        if (channel == 0)
        {
            accumulated.X = updated;
        }
        else
        {
            accumulated.Y = updated;
        }

        ApplyLinearRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, tangent, updated - stored);
    }

    /// <summary>One slide row along an axis with bias and impulse clamping.</summary>
    private static void SolveAxisSlideRow(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 rA, Vec3 rB, Vec3 axis, float rate, float bias, ref float accumulated, float clampLow, float clampHigh)
    {
        Vec3 rnA = Vec3.Cross(rA, axis);
        Vec3 rnB = Vec3.Cross(rB, axis);
        float k = invMassA + invMassB
            + Vec3.Dot(rnA, ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, rnA))
            + Vec3.Dot(rnB, ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, rnB));
        if (k <= 0.0f)
        {
            return;
        }

        float updated = Math.Clamp(accumulated + ((bias - rate) / k), clampLow, clampHigh);
        ApplyLinearRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB, rA, rB, axis, updated - accumulated);
        accumulated = updated;
    }

    private static void SolvePrismaticPosition(BodyStore bodies, ref PrismaticJointData joint)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out _, out _);
        if ((!awakeA && !awakeB) || (invMassA + invMassB) <= 0.0f)
        {
            return;
        }

        AnchorFrame(ref stateA, joint.LocalAnchorA, out Vec3 pa, out _, out _);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out Vec3 pb, out _, out _);
        Vec3 axisA = stateA.Rotation * joint.LocalAxisA;
        Vec3 axisB = stateB.Rotation * joint.LocalAxisB;

        Vec3 span = pb - pa;
        Vec3 lateral = span - (axisA * Vec3.Dot(axisA, span));
        Vec3 shift = lateral * (PositionBeta / (invMassA + invMassB));
        if (awakeA)
        {
            stateA.Position += shift * invMassA;
        }

        if (awakeB)
        {
            stateB.Position -= shift * invMassB;
        }

        CorrectAxisAlignment(bodies, joint.BodyA, joint.BodyB, axisA, axisB);

        if (joint.EnableLimit && joint.LimitMode == JointLimitMode.Hard)
        {
            float travel = Vec3.Dot(axisA, span);
            float clamped = Math.Clamp(travel, joint.LowerLimit, joint.UpperLimit);
            float excess = (travel - clamped) * (PositionBeta / (invMassA + invMassB));
            if (awakeA)
            {
                stateA.Position += axisA * (excess * invMassA);
            }

            if (awakeB)
            {
                stateB.Position -= axisA * (excess * invMassB);
            }
        }
    }

    private static void SolveConfigurableVelocity(BodyStore bodies, ref ConfigurableJointData joint, float h)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out Vec3 invIA, out Vec3 invIB);

        AnchorFrame(ref stateA, joint.LocalAnchorA, out Vec3 pa, out _, out Vec3 rA);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out Vec3 pb, out _, out Vec3 rB);
        Vec3 span = (pb - pa) - joint.ReferenceTranslation;

        Vec3 axisX = stateA.Rotation * (joint.LocalFrameA * new Vec3(1.0f, 0.0f, 0.0f));
        Vec3 axisY = stateA.Rotation * (joint.LocalFrameA * new Vec3(0.0f, 1.0f, 0.0f));
        Vec3 axisZ = stateA.Rotation * (joint.LocalFrameA * new Vec3(0.0f, 0.0f, 1.0f));

        Vec3 linear = joint.LinearImpulse;
        Vec3 engaged = joint.AxisEngaged;
        Vec3 bounce = joint.AxisBounceBias;
        SolveConfigurableLinearRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
            rA, rB, axisX, span, joint.X, h, ref linear.X, ref engaged.X, ref bounce.X);
        SolveConfigurableLinearRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
            rA, rB, axisY, span, joint.Y, h, ref linear.Y, ref engaged.Y, ref bounce.Y);
        SolveConfigurableLinearRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
            rA, rB, axisZ, span, joint.Z, h, ref linear.Z, ref engaged.Z, ref bounce.Z);
        joint.LinearImpulse = linear;
        joint.AxisEngaged = engaged;
        joint.AxisBounceBias = bounce;

        Quat worldA = stateA.Rotation * joint.LocalFrameA;
        Quat worldB = stateB.Rotation * joint.LocalFrameB;
        Quat error = worldA.Conjugate() * worldB * joint.ReferenceRotation.Conjugate();
        if (error.W < 0.0f)
        {
            error = new Quat(error.X * -1.0f, error.Y * -1.0f, error.Z * -1.0f, error.W * -1.0f);
        }

        Vec3 twist = new Vec3(error.X, error.Y, error.Z) * 2.0f;
        Vec3 axisW_X = worldA * new Vec3(1.0f, 0.0f, 0.0f);
        Vec3 axisW_Y = worldA * new Vec3(0.0f, 1.0f, 0.0f);
        Vec3 axisW_Z = worldA * new Vec3(0.0f, 0.0f, 1.0f);
        Vec3 angular = joint.AngularImpulse;
        SolveConfigurableAngularRow(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB,
            axisW_X, twist, joint.AngularX, h, ref angular.X, ref engaged.X, ref bounce.X);
        SolveConfigurableAngularRow(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB,
            axisW_Y, twist, joint.AngularY, h, ref angular.Y, ref engaged.Y, ref bounce.Y);
        SolveConfigurableAngularRow(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB,
            axisW_Z, twist, joint.AngularZ, h, ref angular.Z, ref engaged.Z, ref bounce.Z);
        joint.AngularImpulse = angular;
        joint.AxisEngaged = engaged;
        joint.AxisBounceBias = bounce;
    }

    /// <summary>One configurable linear row along a reference axis.</summary>
    private static void SolveConfigurableLinearRow(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 rA, Vec3 rB, Vec3 axis, Vec3 span, in JointAxisDef tuning, float h, ref float accumulated,
        ref float engagedFlag, ref float bounceBias)
    {
        if (tuning.Mode == JointAxisMode.Free && !tuning.EnableMotor)
        {
            return;
        }

        Vec3 vA = stateA.LinearVelocity + Vec3.Cross(stateA.AngularVelocity, rA);
        Vec3 vB = stateB.LinearVelocity + Vec3.Cross(stateB.AngularVelocity, rB);
        float position = Vec3.Dot(axis, span);
        float rate = Vec3.Dot(axis, vA - vB);

        if (tuning.Mode == JointAxisMode.Locked && !tuning.EnableMotor)
        {
            float bias = (PositionBeta / MathF.Max(h, 1e-6f)) * position;
            SolveAxisSlideRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                rA, rB, axis, rate, bias, ref accumulated,
                float.NegativeInfinity, float.PositiveInfinity);
            return;
        }

        if (tuning.Mode == JointAxisMode.Limited)
        {
            float violation = 0.0f;
            float sign = 0.0f;
            if (position < tuning.LowerLimit)
            {
                violation = tuning.LowerLimit - position;
                sign = 1.0f;
            }
            else if (position > tuning.UpperLimit)
            {
                violation = position - tuning.UpperLimit;
                sign = -1.0f;
            }

            if (tuning.LimitMode == JointLimitMode.Soft)
            {
                float dLow = position - tuning.LowerLimit;
                float dHigh = tuning.UpperLimit - position;
                float side = dLow <= dHigh ? 1.0f : -1.0f;
                float past = side > 0.0f ? -dLow : -dHigh;
                SolveSoftLinearLimit(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                    rA, rB, axis * -side, past, -side * rate, h, in tuning.LimitSpring,
                    ref accumulated, ref engagedFlag, ref bounceBias);
            }
            else if (sign != 0.0f)
            {
                Vec3 rowAxis = axis * -sign;
                float bias = (PositionBeta / MathF.Max(h, 1e-6f)) * violation;
                SolveAxisSlideRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                    rA, rB, rowAxis, -sign * rate, bias, ref accumulated, 0.0f, float.PositiveInfinity);
            }
        }

        if (tuning.EnableMotor)
        {
            float cap = tuning.MaxForce * h;
            SolveAxisSlideRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                rA, rB, axis * -1.0f, rate * -1.0f, tuning.MotorVelocity, ref accumulated, -cap, cap);
        }
    }

    /// <summary>One configurable angular row about a reference axis.</summary>
    private static void SolveConfigurableAngularRow(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        Vec3 invIA, Vec3 invIB, Vec3 axis, Vec3 twist, in JointAxisDef tuning, float h, ref float accumulated,
        ref float engagedFlag, ref float bounceBias)
    {
        if (tuning.Mode == JointAxisMode.Free && !tuning.EnableMotor)
        {
            return;
        }

        float k = Vec3.Dot(axis, ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, axis))
            + Vec3.Dot(axis, ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, axis));
        if (k <= 0.0f)
        {
            return;
        }

        float angle = Vec3.Dot(axis, twist);
        float rate = Vec3.Dot(axis, stateB.AngularVelocity - stateA.AngularVelocity);

        if (tuning.Mode == JointAxisMode.Locked && !tuning.EnableMotor)
        {
            float bias = (PositionBeta / MathF.Max(h, 1e-6f)) * angle;
            float updated = accumulated + ((bias - rate) / k);
            ApplyHingeSpin(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, updated - accumulated);
            accumulated = updated;
            return;
        }

        if (tuning.Mode == JointAxisMode.Limited)
        {
            float violation = 0.0f;
            float sign = 0.0f;
            if (angle < tuning.LowerLimit)
            {
                violation = tuning.LowerLimit - angle;
                sign = 1.0f;
            }
            else if (angle > tuning.UpperLimit)
            {
                violation = angle - tuning.UpperLimit;
                sign = -1.0f;
            }

            if (tuning.LimitMode == JointLimitMode.Soft)
            {
                float dLow = angle - tuning.LowerLimit;
                float dHigh = tuning.UpperLimit - angle;
                float side = dLow <= dHigh ? 1.0f : -1.0f;
                float past = side > 0.0f ? -dLow : -dHigh;
                SolveSoftAngularLimit(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, k,
                    past, side * rate, h, in tuning.LimitSpring, side, ref accumulated, ref engagedFlag, ref bounceBias);
            }
            else if (sign != 0.0f)
            {
                float bias = (PositionBeta / MathF.Max(h, 1e-6f)) * violation;
                float lambda = (-(rate * sign) + bias) / k;
                float updated = MathF.Max(accumulated + lambda, 0.0f);
                ApplyHingeSpin(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, (updated - accumulated) * sign);
                accumulated = updated;
            }
        }

        if (tuning.EnableMotor)
        {
            float lambda = -((rate - tuning.MotorVelocity)) / k;
            float cap = tuning.MaxForce * h;
            float updated = Math.Clamp(accumulated + lambda, -cap, cap);
            ApplyHingeSpin(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, updated - accumulated);
            accumulated = updated;
        }
    }

    private static void SolveConfigurablePosition(BodyStore bodies, ref ConfigurableJointData joint)
    {
        ref BodyState stateA = ref bodies.Slot(joint.BodyA);
        ref BodyState stateB = ref bodies.Slot(joint.BodyB);
        InverseMasses(ref stateA, ref stateB, out bool awakeA, out bool awakeB,
            out float invMassA, out float invMassB, out _, out _);
        if ((!awakeA && !awakeB) || (invMassA + invMassB) <= 0.0f)
        {
            return;
        }

        AnchorFrame(ref stateA, joint.LocalAnchorA, out Vec3 pa, out _, out _);
        AnchorFrame(ref stateB, joint.LocalAnchorB, out Vec3 pb, out _, out _);
        Vec3 span = (pb - pa) - joint.ReferenceTranslation;

        Vec3 axisX = stateA.Rotation * (joint.LocalFrameA * new Vec3(1.0f, 0.0f, 0.0f));
        Vec3 axisY = stateA.Rotation * (joint.LocalFrameA * new Vec3(0.0f, 1.0f, 0.0f));
        Vec3 axisZ = stateA.Rotation * (joint.LocalFrameA * new Vec3(0.0f, 0.0f, 1.0f));

        Vec3 correction = PositionLinearCorrection(span, axisX, joint.X)
            + PositionLinearCorrection(span, axisY, joint.Y)
            + PositionLinearCorrection(span, axisZ, joint.Z);
        correction *= PositionBeta / (invMassA + invMassB);
        if (awakeA)
        {
            stateA.Position += correction * invMassA;
        }

        if (awakeB)
        {
            stateB.Position -= correction * invMassB;
        }

        Quat worldA = stateA.Rotation * joint.LocalFrameA;
        Quat worldB = stateB.Rotation * joint.LocalFrameB;
        Quat error = worldA.Conjugate() * worldB * joint.ReferenceRotation.Conjugate();
        if (error.W < 0.0f)
        {
            error = new Quat(error.X * -1.0f, error.Y * -1.0f, error.Z * -1.0f, error.W * -1.0f);
        }

        Vec3 twist = new Vec3(error.X, error.Y, error.Z) * 2.0f;
        Vec3 spin = PositionAngularCorrection(twist, worldA * new Vec3(1.0f, 0.0f, 0.0f), joint.AngularX)
            + PositionAngularCorrection(twist, worldA * new Vec3(0.0f, 1.0f, 0.0f), joint.AngularY)
            + PositionAngularCorrection(twist, worldA * new Vec3(0.0f, 0.0f, 1.0f), joint.AngularZ);
        spin *= PositionBeta * 0.5f;

        float weightA = awakeA ? 1.0f : 0.0f;
        float weightB = awakeB ? 1.0f : 0.0f;
        float total = weightA + weightB;
        if (total > 0.0f && spin.LengthSquared() > 1e-24f)
        {
            float angle = spin.Length();
            Vec3 axis = spin / angle;
            if (awakeA)
            {
                stateA.Rotation = (Quat.CreateFromAxisAngle(axis * -1.0f, angle * (weightA / total)) * stateA.Rotation).Normalize();
            }

            if (awakeB)
            {
                stateB.Rotation = (Quat.CreateFromAxisAngle(axis, angle * (weightB / total)) * stateB.Rotation).Normalize();
            }
        }
    }

    /// <summary>Position correction of one linear axis toward its stops.</summary>
    private static Vec3 PositionLinearCorrection(Vec3 span, Vec3 axis, in JointAxisDef tuning)
    {
        if (tuning.Mode == JointAxisMode.Free)
        {
            return Vec3.Zero;
        }

        if (tuning.Mode == JointAxisMode.Limited && tuning.LimitMode == JointLimitMode.Soft)
        {
            return Vec3.Zero;
        }

        float position = Vec3.Dot(axis, span);
        if (tuning.Mode == JointAxisMode.Locked)
        {
            return axis * position;
        }

        float clamped = Math.Clamp(position, tuning.LowerLimit, tuning.UpperLimit);
        return axis * (position - clamped);
    }

    /// <summary>Position correction of one angular axis toward its stops.</summary>
    private static Vec3 PositionAngularCorrection(Vec3 twist, Vec3 axis, in JointAxisDef tuning)
    {
        if (tuning.Mode == JointAxisMode.Free)
        {
            return Vec3.Zero;
        }

        if (tuning.Mode == JointAxisMode.Limited && tuning.LimitMode == JointLimitMode.Soft)
        {
            return Vec3.Zero;
        }

        float angle = Vec3.Dot(axis, twist);
        if (tuning.Mode == JointAxisMode.Locked)
        {
            return axis * angle;
        }

        float clamped = Math.Clamp(angle, tuning.LowerLimit, tuning.UpperLimit);
        return axis * (angle - clamped);
    }

    /// <summary>
    /// Semi-implicit spring push for one angular soft stop. The row engages at
    /// ContactDistance from the stop, decelerates approach through the damping
    /// term, adds a one-shot rebound budget on first contact, and stays unilateral
    /// through the non-negative accumulated impulse. The velocity ceiling of
    /// |inward| + frequency amplitude keeps extreme dt, tiny mass and deep
    /// penetration from amplifying energy.
    /// </summary>
    private static void SolveSoftAngularLimit(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        Vec3 invIA, Vec3 invIB, Vec3 axis, float k,
        float past, float sepRate, float h, in LimitSpringSettings spring, float side,
        ref float accumulated, ref float engagedFlag, ref float bounceBias)
    {
        if (k <= 0.0f)
        {
            accumulated = 0.0f;
            engagedFlag = 0.0f;
            bounceBias = 0.0f;
            return;
        }

        if (past <= -spring.ContactDistance)
        {
            accumulated = 0.0f;
            engagedFlag = 0.0f;
            bounceBias = 0.0f;
            return;
        }

        float inward = -sepRate;
        if (engagedFlag == 0.0f)
        {
            engagedFlag = 1.0f;
            bounceBias = inward > spring.BounceThreshold ? spring.Bounciness * inward : 0.0f;
        }

        float x = past > 0.0f ? past : 0.0f;
        float hh = MathF.Max(h, 1e-6f);
        float omega = 2.0f * MathF.PI * spring.Frequency;
        float wh = omega * hh;
        float zeta = spring.DampingRatio;
        float denom = 1.0f + (2.0f * zeta * wh) + (wh * wh);
        float bias = bounceBias;
        bounceBias = 0.0f;
        float dampTerm = inward > 0.0f ? 2.0f * zeta * omega * inward : 0.0f;
        float deltaRate = ((hh * (((omega * omega) * x) + dampTerm)) / denom) + bias;
        float ceiling = MathF.Abs(inward) + (omega * x) + bias;
        if (deltaRate > ceiling)
        {
            deltaRate = ceiling;
        }

        float updated = MathF.Max(accumulated + (deltaRate / k), 0.0f);
        float applied = updated - accumulated;
        if (applied != 0.0f)
        {
            ApplyHingeSpin(ref stateA, ref stateB, awakeA, awakeB, invIA, invIB, axis, applied * side);
        }

        accumulated = updated;
    }

    /// <summary>Semi-implicit spring push for one linear soft stop; same guards as the angular form.</summary>
    private static void SolveSoftLinearLimit(
        ref BodyState stateA, ref BodyState stateB, bool awakeA, bool awakeB,
        float invMassA, float invMassB, Vec3 invIA, Vec3 invIB,
        Vec3 rA, Vec3 rB, Vec3 pushDir, float past, float sepRate, float h, in LimitSpringSettings spring,
        ref float accumulated, ref float engagedFlag, ref float bounceBias)
    {
        Vec3 rnA = Vec3.Cross(rA, pushDir);
        Vec3 rnB = Vec3.Cross(rB, pushDir);
        float k = invMassA + invMassB
            + Vec3.Dot(rnA, ContactSolver.ApplyInverseInertia(stateA.Rotation, invIA, rnA))
            + Vec3.Dot(rnB, ContactSolver.ApplyInverseInertia(stateB.Rotation, invIB, rnB));
        if (k <= 0.0f)
        {
            accumulated = 0.0f;
            engagedFlag = 0.0f;
            bounceBias = 0.0f;
            return;
        }

        if (past <= -spring.ContactDistance)
        {
            accumulated = 0.0f;
            engagedFlag = 0.0f;
            bounceBias = 0.0f;
            return;
        }

        float inward = -sepRate;
        if (engagedFlag == 0.0f)
        {
            engagedFlag = 1.0f;
            bounceBias = inward > spring.BounceThreshold ? spring.Bounciness * inward : 0.0f;
        }

        float x = past > 0.0f ? past : 0.0f;
        float hh = MathF.Max(h, 1e-6f);
        float omega = 2.0f * MathF.PI * spring.Frequency;
        float wh = omega * hh;
        float zeta = spring.DampingRatio;
        float denom = 1.0f + (2.0f * zeta * wh) + (wh * wh);
        float bias = bounceBias;
        bounceBias = 0.0f;
        float dampTerm = inward > 0.0f ? 2.0f * zeta * omega * inward : 0.0f;
        float deltaRate = ((hh * (((omega * omega) * x) + dampTerm)) / denom) + bias;
        float ceiling = MathF.Abs(inward) + (omega * x) + bias;
        if (deltaRate > ceiling)
        {
            deltaRate = ceiling;
        }

        float updated = MathF.Max(accumulated + (deltaRate / k), 0.0f);
        if (updated != accumulated)
        {
            ApplyLinearRow(ref stateA, ref stateB, awakeA, awakeB, invMassA, invMassB, invIA, invIB,
                rA, rB, pushDir, updated - accumulated);
        }

        accumulated = updated;
    }
}
