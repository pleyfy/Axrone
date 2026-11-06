namespace Axrone.Physics3D;

/// <summary>
/// How joint stops are enforced: hard unilateral Baumgarte rows or spring
/// soft constraints. Hard is the engine default.
/// </summary>
public enum JointLimitMode : byte
{
    /// <summary>Unilateral stop row that never allows penetration.</summary>
    Hard = 0,

    /// <summary>Spring-based stop that decelerates inside a contact margin and rebounds past the stop.</summary>
    Soft = 1,
}

/// <summary>
/// Soft joint limit tuning. The stop behaves as a semi-implicit spring-damper
/// with natural frequency in hertz and damping ratio. The spring engages
/// ContactDistance before the stop, and a first contact faster than
/// BounceThreshold rebounds with Bounciness of the approach speed.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct LimitSpringSettings(float Frequency, float DampingRatio, float Bounciness, float BounceThreshold, float ContactDistance)
{
    /// <summary>All-zero settings; only meaningful with the hard stop mode.</summary>
    public static LimitSpringSettings Default => default;

    /// <summary>Rejects non-finite or out-of-range settings; soft mode additionally requires a positive frequency.</summary>
    internal void ValidateForSoft()
    {
        if (!(Frequency > 0.0f) || float.IsNaN(Frequency) || float.IsInfinity(Frequency))
        {
            ThrowHelper.ThrowInvalidOperation("Limit spring frequency must be positive for soft limits.");
        }

        if (DampingRatio < 0.0f || float.IsNaN(DampingRatio) || float.IsInfinity(DampingRatio))
        {
            ThrowHelper.ThrowInvalidOperation("Limit spring damping ratio must be finite and non-negative.");
        }

        if (Bounciness < 0.0f || Bounciness > 1.0f || float.IsNaN(Bounciness))
        {
            ThrowHelper.ThrowInvalidOperation("Limit spring bounciness must lie in [0, 1].");
        }

        if (BounceThreshold < 0.0f || float.IsNaN(BounceThreshold) || float.IsInfinity(BounceThreshold))
        {
            ThrowHelper.ThrowInvalidOperation("Limit bounce threshold must be finite and non-negative.");
        }

        if (ContactDistance < 0.0f || float.IsNaN(ContactDistance) || float.IsInfinity(ContactDistance))
        {
            ThrowHelper.ThrowInvalidOperation("Limit contact distance must be finite and non-negative.");
        }
    }
}
