namespace Axrone.Physics2D;

using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

#pragma warning disable CA1062 // Policy entry points run behind JointStorage sweeps owned by JointStore; JointSolver validates both stores once per pass, so per-sweep revalidation would pessimise the hot loop without covering new ground.
/// <summary>One locked relative pose: pin block plus angle lock, softened into a spring attach when a frequency is set.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct WeldJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec2 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec2 LocalAnchorB;

    /// <summary>Reference angle (second minus first) at creation.</summary>
    public float ReferenceAngle;

    /// <summary>Accumulated point impulse; warm-started every step.</summary>
    public Vec2 PointImpulse;

    /// <summary>Accumulated angle impulse; warm-started every step.</summary>
    public float WeldAngleImpulse;

    /// <summary>Soft-attach stiffness (frequency squared); zero keeps the weld rigid.</summary>
    public float Stiffness;

    /// <summary>Soft-attach damping (twice the damping ratio times the frequency).</summary>
    public float Damping;

    /// <summary>Compliance added to each diagonal of the effective mass this step.</summary>
    public float Gamma;

    /// <summary>Velocity bias toward the welded anchors this step.</summary>
    public Vec2 BiasPin;

    /// <summary>Velocity bias toward the welded angle this step.</summary>
    public float AngleBias;
}

/// <summary>Locked pose: angle lock, then the shared pin block.</summary>
public readonly struct WeldPolicy : IJointPolicy<WeldPolicy, WeldJointData>
{
    /// <inheritdoc/>
    public static JointKind Kind => JointKind.Weld;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void GetBodies(ref WeldJointData data, out BodyId bodyA, out BodyId bodyB)
    {
        bodyA = data.BodyA;
        bodyB = data.BodyB;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void InitVelocity(
        ref WeldJointData data, BodyStore bodies, JointStore store, float wakeTolerance, float dt)
    {
        ref BodyState stateA = ref bodies.Slot(data.BodyA);
        ref BodyState stateB = ref bodies.Slot(data.BodyB);

        Vec2 rA = MathPhysics.Rotate(stateA, data.LocalAnchorA) - MathPhysics.Rotate(stateA, stateA.LocalCenter);
        Vec2 rB = MathPhysics.Rotate(stateB, data.LocalAnchorB) - MathPhysics.Rotate(stateB, stateB.LocalCenter);

        Vec2 vA = stateA.LinearVelocity + (stateA.AngularVelocity * MathPhysics.Perp(rA));
        Vec2 vB = stateB.LinearVelocity + (stateB.AngularVelocity * MathPhysics.Perp(rB));
        if ((vB - vA).LengthSquared() > wakeTolerance * wakeTolerance ||
            MathF.Abs(stateB.AngularVelocity - stateA.AngularVelocity) > wakeTolerance)
        {
            if (stateA.Type == BodyType.Dynamic)
            {
                bodies.SetAwake(data.BodyA, true);
            }

            if (stateB.Type == BodyType.Dynamic)
            {
                bodies.SetAwake(data.BodyB, true);
            }
        }

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;

        Vec2 pA = stateA.Position + MathPhysics.Rotate(stateA, data.LocalAnchorA);
        Vec2 pB = stateB.Position + MathPhysics.Rotate(stateB, data.LocalAnchorB);
        float angleError = MathPhysics.NormalizeAngle(
            (MathF.Atan2(stateB.Sin, stateB.Cos) - MathF.Atan2(stateA.Sin, stateA.Cos)) - data.ReferenceAngle);
        MathPhysics.ComputeSoftness(
            data.Stiffness, data.Damping, dt, (pB - pA).X, out data.Gamma, out float biasX);
        MathPhysics.ComputeSoftness(
            data.Stiffness, data.Damping, dt, (pB - pA).Y, out _, out float biasY);
        MathPhysics.ComputeSoftness(
            data.Stiffness, data.Damping, dt, angleError, out _, out data.AngleBias);
        data.BiasPin = new Vec2(biasX, biasY);

        Vec2 pointImpulse = data.PointImpulse;
        if (awakeA)
        {
            stateA.LinearVelocity -= pointImpulse * stateA.InverseMass;
            stateA.AngularVelocity -= stateA.InverseInertia * (Vec2.Cross(rA, pointImpulse) + data.WeldAngleImpulse);
        }

        if (awakeB)
        {
            stateB.LinearVelocity += pointImpulse * stateB.InverseMass;
            stateB.AngularVelocity += stateB.InverseInertia * (Vec2.Cross(rB, pointImpulse) + data.WeldAngleImpulse);
        }
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void SolveVelocity(ref WeldJointData data, BodyStore bodies, JointStore store)
    {
        SolveAngleLock(bodies, ref data);
        SolvePinBlockVelocity(bodies, ref data);
    }

    /// <summary>Shared angle velocity lock used by weld joints.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static void SolveAngleLock(BodyStore bodies, ref WeldJointData data)
    {
        ref BodyState stateA = ref bodies.Slot(data.BodyA);
        ref BodyState stateB = ref bodies.Slot(data.BodyB);

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;

        float invIA = awakeA ? stateA.InverseInertia : 0.0f;
        float invIB = awakeB ? stateB.InverseInertia : 0.0f;
        float axialMass = (invIA + invIB) + data.Gamma;
        if (axialMass <= 0.0f || (!awakeA && !awakeB))
        {
            return;
        }

        float delta = -((stateB.AngularVelocity - stateA.AngularVelocity) + data.AngleBias + (data.Gamma * data.WeldAngleImpulse)) / axialMass;
        data.WeldAngleImpulse += delta;

        if (awakeA)
        {
            stateA.AngularVelocity -= invIA * delta;
        }

        if (awakeB)
        {
            stateB.AngularVelocity += invIB * delta;
        }
    }

    /// <summary>Shared 2x2 pin velocity block used by weld joints.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static void SolvePinBlockVelocity(BodyStore bodies, ref WeldJointData data)
    {
        ref BodyState stateA = ref bodies.Slot(data.BodyA);
        ref BodyState stateB = ref bodies.Slot(data.BodyB);

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;

        float invMassA = awakeA ? stateA.InverseMass : 0.0f;
        float invMassB = awakeB ? stateB.InverseMass : 0.0f;
        float invIA = awakeA ? stateA.InverseInertia : 0.0f;
        float invIB = awakeB ? stateB.InverseInertia : 0.0f;

        Vec2 rA = MathPhysics.Rotate(stateA, data.LocalAnchorA) - MathPhysics.Rotate(stateA, stateA.LocalCenter);
        Vec2 rB = MathPhysics.Rotate(stateB, data.LocalAnchorB) - MathPhysics.Rotate(stateB, stateB.LocalCenter);

        float k11 = (invMassA + invMassB + (invIA * rA.Y * rA.Y) + (invIB * rB.Y * rB.Y)) + data.Gamma;
        float k22 = (invMassA + invMassB + (invIA * rA.X * rA.X) + (invIB * rB.X * rB.X)) + data.Gamma;
        float k12 = (invIA * rA.X * rA.Y) - (invIB * rB.X * rB.Y);
        float det = (k11 * k22) - (k12 * k12);
        if (det <= 0.0f)
        {
            return;
        }

        Vec2 vA = stateA.LinearVelocity + (stateA.AngularVelocity * MathPhysics.Perp(rA));
        Vec2 vB = stateB.LinearVelocity + (stateB.AngularVelocity * MathPhysics.Perp(rB));
        Vec2 accumulated = data.PointImpulse;
        Vec2 residual = ((vB - vA) + data.BiasPin + (data.Gamma * accumulated)) - new Vec2(
            (k11 * accumulated.X) + (k12 * accumulated.Y),
            (k12 * accumulated.X) + (k22 * accumulated.Y));

        float invDet = 1.0f / det;
        Vec2 solved = new(
            ((k12 * residual.Y) - (k22 * residual.X)) * invDet,
            ((k12 * residual.X) - (k11 * residual.Y)) * invDet);
        Vec2 deltaImpulse = solved - accumulated;
        data.PointImpulse = solved;

        if (awakeA)
        {
            stateA.LinearVelocity -= deltaImpulse * invMassA;
            stateA.AngularVelocity -= invIA * Vec2.Cross(rA, deltaImpulse);
        }

        if (awakeB)
        {
            stateB.LinearVelocity += deltaImpulse * invMassB;
            stateB.AngularVelocity += invIB * Vec2.Cross(rB, deltaImpulse);
        }
    }

    /// <summary>Shared pin position correction used by weld joints.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static void SolvePinCorrection(
        BodyStore bodies, BodyId bodyA, BodyId bodyB, Vec2 localAnchorA, Vec2 localAnchorB)
    {
        ref BodyState stateA = ref bodies.Slot(bodyA);
        ref BodyState stateB = ref bodies.Slot(bodyB);

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

        Vec2 rA = MathPhysics.Rotate(stateA, localAnchorA) - MathPhysics.Rotate(stateA, stateA.LocalCenter);
        Vec2 rB = MathPhysics.Rotate(stateB, localAnchorB) - MathPhysics.Rotate(stateB, stateB.LocalCenter);

        float k11 = invMassA + invMassB + (invIA * rA.Y * rA.Y) + (invIB * rB.Y * rB.Y);
        float k22 = invMassA + invMassB + (invIA * rA.X * rA.X) + (invIB * rB.X * rB.X);
        float k12 = (invIA * rA.X * rA.Y) - (invIB * rB.X * rB.Y);
        float det = (k11 * k22) - (k12 * k12);
        if (det <= 0.0f)
        {
            return;
        }

        Vec2 pA = stateA.Position + MathPhysics.Rotate(stateA, localAnchorA);
        Vec2 pB = stateB.Position + MathPhysics.Rotate(stateB, localAnchorB);
        Vec2 error = pB - pA;

        float invDet = 1.0f / det;
        Vec2 correction = new(
            ((k12 * error.Y) - (k22 * error.X)) * invDet,
            ((k12 * error.X) - (k11 * error.Y)) * invDet);

        MathPhysics.ApplyPositionCorrection(ref stateA, ref stateB, rA, rB, correction, invMassA, invMassB, invIA, invIB, awakeA, awakeB);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void SolvePosition(ref WeldJointData data, BodyStore bodies, JointStore store)
    {
        if (data.Stiffness > 0.0f)
        {
            // The soft attach carries pose error in its spring rows; a rigid
            // position push would fight them.
            return;
        }

        SolvePinCorrection(bodies, data.BodyA, data.BodyB, data.LocalAnchorA, data.LocalAnchorB);

        ref BodyState stateA = ref bodies.Slot(data.BodyA);
        ref BodyState stateB = ref bodies.Slot(data.BodyB);

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;
        if (!awakeA && !awakeB)
        {
            return;
        }

        float invIA = awakeA ? stateA.InverseInertia : 0.0f;
        float invIB = awakeB ? stateB.InverseInertia : 0.0f;
        float axialMass = invIA + invIB;
        if (axialMass <= 0.0f)
        {
            return;
        }

        float angleA = MathF.Atan2(stateA.Sin, stateA.Cos);
        float angleB = MathF.Atan2(stateB.Sin, stateB.Cos);
        float angleError = MathPhysics.NormalizeAngle((angleB - angleA) - data.ReferenceAngle);
        if (MathF.Abs(angleError) < SolverTuning.AngularSlop)
        {
            return;
        }

        float correction = -angleError / axialMass;
        if (awakeA)
        {
            float correctedA = angleA - (invIA * correction);
            stateA.Cos = MathF.Cos(correctedA);
            stateA.Sin = MathF.Sin(correctedA);
        }

        if (awakeB)
        {
            float correctedB = angleB + (invIB * correction);
            stateB.Cos = MathF.Cos(correctedB);
            stateB.Sin = MathF.Sin(correctedB);
        }
    }
}
#pragma warning restore CA1062
