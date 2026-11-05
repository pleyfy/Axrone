namespace Axrone.Physics2D;

using System.Runtime.CompilerServices;

/// <summary>
/// Shared joint math: frame rotations, angle wrapping, limit resolution and the
/// position-correction applicator. Single home for the expressions every policy
/// repeats, so fixes land once.
/// </summary>
internal static class MathPhysics
{
    /// <summary>Rotates a vector by a body frame.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vec2 Rotate(in BodyState state, Vec2 vector) =>
        new((state.Cos * vector.X) - (state.Sin * vector.Y), (state.Sin * vector.X) + (state.Cos * vector.Y));

    /// <summary>Returns the perpendicular follower of a vector.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Vec2 Perp(Vec2 vector) => new(-vector.Y, vector.X);

    /// <summary>Wraps an angle into [-pi, pi].</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static float NormalizeAngle(float angle) =>
        angle - (MathF.Floor((angle + MathF.PI) / (2.0f * MathF.PI)) * 2.0f * MathF.PI);

    /// <summary>
    /// Converts a soft-attach frequency in hertz and its damping ratio to the
    /// solver's stiffness and damping coefficients (omega = 2*pi*frequency).
    /// Same convention as the wheel suspension: one hertz is one full cycle
    /// per second. Zero frequency yields the rigid pair (0, 0).
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ComputeAttachTuning(float frequency, float dampingRatio, out float stiffness, out float damping)
    {
        float omega = 2.0f * MathF.PI * frequency;
        stiffness = omega * omega;
        damping = 2.0f * dampingRatio * omega;
    }

    /// <summary>Resolves the limit state of a coordinate against its stops.</summary>
    /// <param name="enabled">Whether stops apply.</param>
    /// <param name="lower">The lower stop.</param>
    /// <param name="upper">The upper stop.</param>
    /// <param name="value">The current coordinate.</param>
    /// <param name="slop">The coincidence band fusing near-equal stops.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static LimitState ResolveLimitState(bool enabled, float lower, float upper, float value, float slop)
    {
        if (!enabled)
        {
            return LimitState.Inactive;
        }

        if (upper - lower < 2.0f * slop)
        {
            return LimitState.Equal;
        }

        if (value <= lower)
        {
            return LimitState.AtLower;
        }

        if (value >= upper)
        {
            return LimitState.AtUpper;
        }

        return LimitState.Inactive;
    }

    /// <summary>
    /// Folds a joint's stiffness and damping into the solver's softness and
    /// velocity bias for one step: a compliant constraint adds <c>gamma</c> to
    /// its effective mass and a <c>bias</c> toward the target, while a zero
    /// stiffness leaves both at zero so the rigid path is untouched.
    /// </summary>
    /// <param name="stiffness">Spring stiffness; zero or negative means rigid.</param>
    /// <param name="damping">Spring damping; never negative.</param>
    /// <param name="dt">Step length in seconds.</param>
    /// <param name="error">Signed constraint error at the start of the step.</param>
    /// <param name="gamma">Added to the effective mass; zero for a rigid constraint.</param>
    /// <param name="bias">Velocity bias toward the target; zero for a rigid constraint.</param>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ComputeSoftness(
        float stiffness, float damping, float dt, float error, out float gamma, out float bias)
    {
        if (stiffness > 0.0f)
        {
            gamma = 1.0f / (damping + (dt * stiffness));
            bias = error * dt * stiffness * gamma;
            return;
        }

        gamma = 0.0f;
        bias = 0.0f;
    }

    /// <summary>Whether a joint's stored range pins the coordinate at all.</summary>
    /// <param name="lower">Lower bound; zero or negative means unbounded.</param>
    /// <param name="upper">Upper bound; zero or negative means unbounded.</param>
    /// <returns><see langword="true"/> when either bound is set.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool HasRange(float lower, float upper) => lower > 0.0f || upper > 0.0f;

    /// <summary>Applies one position correction to a body pair with rotation coupling.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void ApplyPositionCorrection(
        ref BodyState stateA, ref BodyState stateB, Vec2 rA, Vec2 rB, Vec2 correction,
        float invMassA, float invMassB, float invIA, float invIB, bool awakeA, bool awakeB)
    {
        if (awakeA)
        {
            stateA.Position -= correction * invMassA;
            float angleA = MathF.Atan2(stateA.Sin, stateA.Cos) - (invIA * Vec2.Cross(rA, correction));
            stateA.Cos = MathF.Cos(angleA);
            stateA.Sin = MathF.Sin(angleA);
        }

        if (awakeB)
        {
            stateB.Position += correction * invMassB;
            float angleB = MathF.Atan2(stateB.Sin, stateB.Cos) + (invIB * Vec2.Cross(rB, correction));
            stateB.Cos = MathF.Cos(angleB);
            stateB.Sin = MathF.Sin(angleB);
        }
    }
}

/// <summary>Compile-time construction phases; invalid orders do not compile.</summary>
#pragma warning disable CA1034 // Typestate phantoms are intentionally nested: the phase only means something qualified by its builder protocol, and unqualified top-level names would pollute the package surface.
public static class Typestate
{
    /// <summary>No configuration yet.</summary>
    public readonly struct Unconfigured;

    /// <summary>Bodies bound; geometry still open.</summary>
    public readonly struct BodiesConfigured;

    /// <summary>Bodies and geometry bound; ready to build.</summary>
    public readonly struct GeometryConfigured;

    /// <summary>Geared joints bound; ready to build.</summary>
    public readonly struct JointsConfigured;
}
#pragma warning restore CA1034
