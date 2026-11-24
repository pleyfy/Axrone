namespace Axrone.Scene.Runtime;

using Axrone.Numeric;

/// <summary>
/// Distance-based evaluation-rate policy for animators. Nearby actors update
/// every step; mid and far bands accumulate time and evaluate at a lower rate,
/// preserving total elapsed time so playback speed does not change.
/// </summary>
/// <remarks>
/// The reference position is mutable so a render host can move it with the
/// camera without rebuilding the policy. Distances are world units and must be
/// strictly increasing; intervals are seconds and must be finite and positive.
/// </remarks>
public sealed class SceneAnimatorLodSettings
{
    /// <summary>Creates a LOD policy.</summary>
    public SceneAnimatorLodSettings(
        Vec3 referencePosition,
        float mediumDistance = 20.0f,
        float farDistance = 50.0f,
        float mediumInterval = 1.0f / 30.0f,
        float farInterval = 1.0f / 15.0f)
    {
        if (!float.IsFinite(mediumDistance) || mediumDistance < 0.0f)
        {
            throw new ArgumentOutOfRangeException(nameof(mediumDistance), mediumDistance, "Medium distance must be finite and non-negative.");
        }

        if (!float.IsFinite(farDistance) || farDistance <= mediumDistance)
        {
            throw new ArgumentOutOfRangeException(nameof(farDistance), farDistance, "Far distance must be finite and greater than the medium distance.");
        }

        if (!float.IsFinite(mediumInterval) || mediumInterval <= 0.0f)
        {
            throw new ArgumentOutOfRangeException(nameof(mediumInterval), mediumInterval, "Medium interval must be finite and positive.");
        }

        if (!float.IsFinite(farInterval) || farInterval <= 0.0f)
        {
            throw new ArgumentOutOfRangeException(nameof(farInterval), farInterval, "Far interval must be finite and positive.");
        }

        ReferencePosition = referencePosition;
        MediumDistance = mediumDistance;
        FarDistance = farDistance;
        MediumInterval = mediumInterval;
        FarInterval = farInterval;
    }

    /// <summary>World-space point distances are measured from, usually the camera.</summary>
    public Vec3 ReferencePosition { get; set; }

    /// <summary>Distance at which the medium update interval starts.</summary>
    public float MediumDistance { get; }

    /// <summary>Distance at which the far update interval starts.</summary>
    public float FarDistance { get; }

    /// <summary>Update interval for the medium band, in seconds.</summary>
    public float MediumInterval { get; }

    /// <summary>Update interval for the far band, in seconds.</summary>
    public float FarInterval { get; }

    /// <summary>Returns the update interval for a world position; zero means every step.</summary>
    public float ResolveInterval(in Vec3 worldPosition)
    {
        float distanceSq = Vec3.DistanceSquared(ReferencePosition, worldPosition);
        if (distanceSq >= FarDistance * FarDistance)
        {
            return FarInterval;
        }

        return distanceSq >= MediumDistance * MediumDistance ? MediumInterval : 0.0f;
    }
}
