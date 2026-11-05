namespace Axrone.Physics2D;

using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

#pragma warning disable CA1062 // Policy entry points run behind JointStorage sweeps owned by JointStore; JointSolver validates both stores once per pass, so per-sweep revalidation would pessimise the hot loop without covering new ground.
/// <summary>
/// One distance constraint: two bodies pinned through body-frame anchors at a
/// rest length, optionally soft (stiffness/damping) and optionally ranged
/// (min/max separation) instead of rigid.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public struct DistanceJointData
{
    /// <summary>First body.</summary>
    public BodyId BodyA;

    /// <summary>Second body.</summary>
    public BodyId BodyB;

    /// <summary>Anchor in the first body frame.</summary>
    public Vec2 LocalAnchorA;

    /// <summary>Anchor in the second body frame.</summary>
    public Vec2 LocalAnchorB;

    /// <summary>Rest separation of the anchors; never negative.</summary>
    public float Length;

    /// <summary>Spring stiffness per unit effective mass; zero keeps the rod rigid.</summary>
    public float Stiffness;

    /// <summary>Spring damping; only read while <see cref="Stiffness"/> is positive.</summary>
    public float Damping;

    /// <summary>Smallest allowed separation; zero leaves the range open.</summary>
    public float MinDistance;

    /// <summary>Largest allowed separation; zero leaves the range open.</summary>
    public float MaxDistance;

    /// <summary>Accumulated rod impulse; warm-started every step.</summary>
    public float Impulse;

    /// <summary>Accumulated range impulse; warm-started every step.</summary>
    public float LimitImpulse;

    /// <summary>Softness added to the axial effective mass this step.</summary>
    public float Gamma;

    /// <summary>Velocity bias toward the rest length this step.</summary>
    public float Bias;

    /// <summary>Resolved range state of the current step.</summary>
    public LimitState LimitState;
}

/// <summary>
/// Sequential-impulse distance constraint: a bilateral rod along the anchor
/// line (rigid, or soft when the joint carries stiffness) joined by a hard
/// unilateral range row while a bound is violated.
/// </summary>
public readonly struct DistancePolicy : IJointPolicy<DistancePolicy, DistanceJointData>
{
    /// <inheritdoc/>
    public static JointKind Kind => JointKind.Distance;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void GetBodies(ref DistanceJointData data, out BodyId bodyA, out BodyId bodyB)
    {
        bodyA = data.BodyA;
        bodyB = data.BodyB;
    }

    /// <summary>Anchor line of the pair: unit direction from the first anchor to the second, and their separation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static bool TryFrame(
        in BodyState stateA, in BodyState stateB, Vec2 localAnchorA, Vec2 localAnchorB,
        out Vec2 direction, out float separation)
    {
        Vec2 axis = (stateB.Position + MathPhysics.Rotate(stateB, localAnchorB)) -
            (stateA.Position + MathPhysics.Rotate(stateA, localAnchorA));
        float lengthSq = axis.LengthSquared();
        if (lengthSq <= 1e-12f)
        {
            direction = Vec2.Zero;
            separation = 0.0f;
            return false;
        }

        separation = MathF.Sqrt(lengthSq);
        direction = axis * (1.0f / separation);
        return true;
    }

    /// <summary>COM-relative lever arms of the two anchors.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static void Arms(
        in BodyState stateA, in BodyState stateB, Vec2 localAnchorA, Vec2 localAnchorB,
        out Vec2 rA, out Vec2 rB)
    {
        rA = MathPhysics.Rotate(stateA, localAnchorA) - MathPhysics.Rotate(stateA, stateA.LocalCenter);
        rB = MathPhysics.Rotate(stateB, localAnchorB) - MathPhysics.Rotate(stateB, stateB.LocalCenter);
    }

    /// <summary>Which bound the current separation violates, or <see cref="LimitState.Inactive"/> inside the range.</summary>
    /// <remarks>
    /// An open bound enters as an infinity so the near-coincident-stop fusion in
    /// <see cref="MathPhysics.ResolveLimitState"/> cannot mistake one-sided ranges for a lock.
    /// </remarks>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static LimitState ResolveRange(
        in DistanceJointData data, float separation) =>
        MathPhysics.ResolveLimitState(
            MathPhysics.HasRange(data.MinDistance, data.MaxDistance),
            data.MinDistance > 0.0f ? data.MinDistance : float.NegativeInfinity,
            data.MaxDistance > 0.0f ? data.MaxDistance : float.PositiveInfinity,
            separation,
            SolverTuning.LinearSlop);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void InitVelocity(
        ref DistanceJointData data, BodyStore bodies, JointStore store, float wakeTolerance, float dt)
    {
        ref BodyState stateA = ref bodies.Slot(data.BodyA);
        ref BodyState stateB = ref bodies.Slot(data.BodyB);

        Vec2 rA = MathPhysics.Rotate(stateA, data.LocalAnchorA);
        Vec2 rB = MathPhysics.Rotate(stateB, data.LocalAnchorB);

        Vec2 vA = stateA.LinearVelocity + (stateA.AngularVelocity * MathPhysics.Perp(rA));
        Vec2 vB = stateB.LinearVelocity + (stateB.AngularVelocity * MathPhysics.Perp(rB));
        if ((vB - vA).LengthSquared() > wakeTolerance * wakeTolerance)
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

        if (!TryFrame(in stateA, in stateB, data.LocalAnchorA, data.LocalAnchorB, out Vec2 direction, out float separation))
        {
            return;
        }

        LimitState previous = data.LimitState;
        data.LimitState = ResolveRange(in data, separation);
        if (data.LimitState != previous)
        {
            data.LimitImpulse = 0.0f;
        }

        // The rod row stays warm through limit transitions; only the unilateral
        // limit impulse is state-scoped.
        MathPhysics.ComputeSoftness(
            data.Stiffness, data.Damping, dt, separation - data.Length, out data.Gamma, out data.Bias);

        Vec2 impulse = direction * (data.Impulse + data.LimitImpulse);
        if (awakeA)
        {
            stateA.LinearVelocity -= impulse * stateA.InverseMass;
            stateA.AngularVelocity -= stateA.InverseInertia * Vec2.Cross(rA, impulse);
        }

        if (awakeB)
        {
            stateB.LinearVelocity += impulse * stateB.InverseMass;
            stateB.AngularVelocity += stateB.InverseInertia * Vec2.Cross(rB, impulse);
        }
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void SolveVelocity(ref DistanceJointData data, BodyStore bodies, JointStore store)
    {
        ref BodyState stateA = ref bodies.Slot(data.BodyA);
        ref BodyState stateB = ref bodies.Slot(data.BodyB);

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;

        float invMassA = awakeA ? stateA.InverseMass : 0.0f;
        float invMassB = awakeB ? stateB.InverseMass : 0.0f;
        float invIA = awakeA ? stateA.InverseInertia : 0.0f;
        float invIB = awakeB ? stateB.InverseInertia : 0.0f;

        Arms(in stateA, in stateB, data.LocalAnchorA, data.LocalAnchorB, out Vec2 rA, out Vec2 rB);

        if (!TryFrame(in stateA, in stateB, data.LocalAnchorA, data.LocalAnchorB, out Vec2 direction, out _))
        {
            return;
        }

        float rnA = Vec2.Cross(rA, direction);
        float rnB = Vec2.Cross(rB, direction);
        float k = invMassA + invMassB + (invIA * rnA * rnA) + (invIB * rnB * rnB);
        float axialMass = k + data.Gamma;
        if (axialMass <= 0.0f)
        {
            return;
        }

        Vec2 vA = stateA.LinearVelocity + (stateA.AngularVelocity * MathPhysics.Perp(rA));
        Vec2 vB = stateB.LinearVelocity + (stateB.AngularVelocity * MathPhysics.Perp(rB));
        float velocityError = Vec2.Dot(direction, vB - vA);

        // Rod row first, then the unilateral limit row layered on top: the spring
        // keeps pulling toward rest length even while a bound holds the pair.
        float rodImpulse = -(velocityError + data.Bias + (data.Gamma * data.Impulse)) / axialMass;
        data.Impulse += rodImpulse;
        ApplyPair(ref stateA, ref stateB, rA, rB, direction * rodImpulse, invMassA, invMassB, invIA, invIB, awakeA, awakeB);

        if (data.LimitState == LimitState.Inactive || k <= 0.0f)
        {
            return;
        }

        vA = stateA.LinearVelocity + (stateA.AngularVelocity * MathPhysics.Perp(rA));
        vB = stateB.LinearVelocity + (stateB.AngularVelocity * MathPhysics.Perp(rB));
        velocityError = Vec2.Dot(direction, vB - vA);

        // The limit row is hard even for a soft rod: its own mass excludes compliance.
        float boundImpulse = -velocityError / k;
        float old = data.LimitImpulse;
        float next = data.LimitState switch
        {
            LimitState.AtLower => MathF.Max(old + boundImpulse, 0.0f),
            LimitState.AtUpper => MathF.Min(old + boundImpulse, 0.0f),
            _ => old + boundImpulse,
        };
        data.LimitImpulse = next;
        ApplyPair(ref stateA, ref stateB, rA, rB, direction * (next - old), invMassA, invMassB, invIA, invIB, awakeA, awakeB);
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void SolvePosition(ref DistanceJointData data, BodyStore bodies, JointStore store)
    {
        ref BodyState stateA = ref bodies.Slot(data.BodyA);
        ref BodyState stateB = ref bodies.Slot(data.BodyB);

        bool awakeA = (stateA.Flags & BodyFlags.Awake) != 0;
        bool awakeB = (stateB.Flags & BodyFlags.Awake) != 0;

        float invMassA = awakeA ? stateA.InverseMass : 0.0f;
        float invMassB = awakeB ? stateB.InverseMass : 0.0f;
        float invIA = awakeA ? stateA.InverseInertia : 0.0f;
        float invIB = awakeB ? stateB.InverseInertia : 0.0f;

        Arms(in stateA, in stateB, data.LocalAnchorA, data.LocalAnchorB, out Vec2 rA, out Vec2 rB);

        if (!TryFrame(in stateA, in stateB, data.LocalAnchorA, data.LocalAnchorB, out Vec2 direction, out float separation))
        {
            return;
        }

        float rnA = Vec2.Cross(rA, direction);
        float rnB = Vec2.Cross(rB, direction);
        float k = invMassA + invMassB + (invIA * rnA * rnA) + (invIB * rnB * rnB);
        if (k <= 0.0f)
        {
            return;
        }

        // Rigid rods get the full position drive toward rest length; a soft rod
        // leaves axial error to the spring so the two do not fight.
        if (data.Stiffness <= 0.0f)
        {
            float error = Math.Clamp(separation - data.Length, -SolverTuning.MaxCorrection, SolverTuning.MaxCorrection);
            MathPhysics.ApplyPositionCorrection(
                ref stateA, ref stateB, rA, rB, direction * (-error / k),
                invMassA, invMassB, invIA, invIB, awakeA, awakeB);
        }

        if (data.LimitState == LimitState.Inactive)
        {
            return;
        }

        float limitError = data.LimitState switch
        {
            LimitState.AtLower => separation - data.MinDistance + SolverTuning.LinearSlop,
            LimitState.AtUpper => separation - data.MaxDistance - SolverTuning.LinearSlop,
            _ => separation - data.MinDistance,
        };

        bool violates = data.LimitState switch
        {
            LimitState.AtLower => limitError < 0.0f,
            LimitState.AtUpper => limitError > 0.0f,
            _ => limitError != 0.0f,
        };

        if (!violates)
        {
            return;
        }

        MathPhysics.ApplyPositionCorrection(
            ref stateA, ref stateB, rA, rB,
            direction * (-Math.Clamp(limitError, -SolverTuning.MaxCorrection, SolverTuning.MaxCorrection) / k),
            invMassA, invMassB, invIA, invIB, awakeA, awakeB);
    }

    /// <summary>Applies one axial impulse to the pair's velocities, opposite along the anchor line.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    internal static void ApplyPair(
        ref BodyState stateA, ref BodyState stateB, Vec2 rA, Vec2 rB, Vec2 applied,
        float invMassA, float invMassB, float invIA, float invIB, bool awakeA, bool awakeB)
    {
        if (awakeA)
        {
            stateA.LinearVelocity -= applied * invMassA;
            stateA.AngularVelocity -= invIA * Vec2.Cross(rA, applied);
        }

        if (awakeB)
        {
            stateB.LinearVelocity += applied * invMassB;
            stateB.AngularVelocity += invIB * Vec2.Cross(rB, applied);
        }
    }
}
#pragma warning restore CA1062
