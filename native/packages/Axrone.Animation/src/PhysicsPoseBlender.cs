namespace Axrone.Animation;

using Axrone.Numeric;

/// <summary>
/// Blends a physics-driven world pose onto an animation frame. Physics supplies one
/// world position and rotation per bone; this converts them to local bone space and
/// lerps/slerps against the animated pose, which is the animation-side half of a
/// ragdoll or hit-reaction blend.
/// </summary>
/// <remarks>
/// Scales stay animation-owned because rigid bodies do not carry a meaningful bone
/// scale. The conversion assumes uniform parent scale, matching the dense rig
/// representation. Callers must pass transforms in the same space as the frame
/// (normally world space) and one entry per rig bone.
/// </remarks>
public static class PhysicsPoseBlender
{
    /// <summary>
    /// Blends world-space body transforms onto a frame.
    /// </summary>
    /// <param name="rig">Rig the frame belongs to.</param>
    /// <param name="frame">Pose to mutate in place.</param>
    /// <param name="worldPositions">World position per bone.</param>
    /// <param name="worldRotations">World rotation per bone.</param>
    /// <param name="weight">Physics weight in the unit interval.</param>
    public static void BlendWorldPose(
        Rig rig,
        AnimationFrame frame,
        ReadOnlySpan<Vec3> worldPositions,
        ReadOnlySpan<Quat> worldRotations,
        float weight = 1.0f)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(frame);

        if (frame.BoneCount != rig.BoneCount ||
            worldPositions.Length < rig.BoneCount ||
            worldRotations.Length < rig.BoneCount)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                $"Physics pose requires {rig.BoneCount} bones but received frame={frame.BoneCount}, positions={worldPositions.Length}, rotations={worldRotations.Length}.");
        }

        if (!float.IsFinite(weight) || weight <= 0.0f)
        {
            return;
        }

        float w = FastMath.Clamp01(weight);
        Span<Vec3> localT = frame.GetTranslations();
        Span<Quat> localR = frame.GetRotations();
        ReadOnlySpan<int> order = rig.EvaluationOrder;
        ReadOnlySpan<int> parents = rig.Parents;

        for (int step = 0; step < order.Length; step++)
        {
            int bone = order[step];
            int parent = parents[bone];
            Vec3 physicsPosition;
            Quat physicsRotation;

            if (parent < 0)
            {
                physicsPosition = worldPositions[bone];
                physicsRotation = FastMath.Normalize(worldRotations[bone]);
            }
            else
            {
                Quat inverseParent = FastMath.Invert(FastMath.Normalize(worldRotations[parent]));
                physicsPosition = inverseParent * (worldPositions[bone] - worldPositions[parent]);
                physicsRotation = FastMath.Normalize(
                    FastMath.Multiply(inverseParent, worldRotations[bone]));
            }

            localT[bone] = Vec3.Lerp(localT[bone], physicsPosition, w);
            localR[bone] = FastMath.Slerp(localR[bone], physicsRotation, w);
        }
    }
}
