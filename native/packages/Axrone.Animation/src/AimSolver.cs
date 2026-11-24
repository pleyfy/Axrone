namespace Axrone.Animation;

using Axrone.Numeric;

/// <summary>
/// Single-bone aim: rotates one bone so its local forward axis points at a
/// world-space target, with an optional maximum turn angle and up-vector roll.
/// </summary>
/// <remarks>
/// The solver writes only the aimed bone's local rotation. It is intended for
/// head, eye and turret bones after normal animation evaluation; chains with
/// multiple joints use <see cref="IkSolvers"/> or <see cref="TwoBoneIk"/>.
/// </remarks>
public static class AimSolver
{
    private const float DegenerateSquared = 1e-12f;

    /// <summary>
    /// Aims <paramref name="boneIndex"/> at a world target.
    /// </summary>
    /// <param name="rig">Rig the frame belongs to.</param>
    /// <param name="frame">Pose to mutate in place.</param>
    /// <param name="boneIndex">Bone to rotate.</param>
    /// <param name="targetPosition">World-space point to look at.</param>
    /// <param name="worldUp">World up used to remove roll; zero skips roll alignment.</param>
    /// <param name="weight">Blend weight in the unit interval.</param>
    /// <param name="maxAngleRadians">Maximum turn from the current forward axis.</param>
    /// <returns>True when a correction was applied.</returns>
    [SkipLocalsInit]
    public static bool Solve(
        Rig rig,
        AnimationFrame frame,
        int boneIndex,
        in Vec3 targetPosition,
        in Vec3 worldUp = default,
        float weight = 1.0f,
        float maxAngleRadians = MathF.PI)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(frame);

        if (frame.BoneCount != rig.BoneCount)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                $"Aim targets {rig.BoneCount} bones but the frame has {frame.BoneCount}.");
        }

        if ((uint)boneIndex >= (uint)rig.BoneCount)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                $"Aim bone index {boneIndex} is outside the rig.");
        }

        if (!float.IsFinite(weight) || weight <= 0.0f)
        {
            return false;
        }

        if (!float.IsFinite(maxAngleRadians) || maxAngleRadians < 0.0f || maxAngleRadians > MathF.PI)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                $"Aim max angle {maxAngleRadians} is outside [0, pi].");
        }

        float w = FastMath.Clamp01(weight);
        int boneCount = rig.BoneCount;
        using ScratchWorldBuffers buffers = ScratchWorldBuffers.UseStack(boneCount)
            ? ScratchWorldBuffers.FromStack(stackalloc Vec3[boneCount], stackalloc Quat[boneCount], stackalloc Vec3[boneCount])
            : ScratchWorldBuffers.RentPooled(boneCount);

        Span<Vec3> worldT = buffers.Translations;
        Span<Quat> worldR = buffers.Rotations;
        Span<Vec3> worldS = buffers.Scales;
        BlendingKernels.ForwardKinematics(rig, frame, worldT, worldR, worldS);

        Vec3 toTarget = targetPosition - worldT[boneIndex];
        if (toTarget.LengthSquared() <= DegenerateSquared)
        {
            return false;
        }

        Vec3 targetDirection = Vec3.Normalize(toTarget);
        Vec3 forward = worldR[boneIndex] * Vec3.UnitZ;
        forward = Vec3.Normalize(forward);

        float angle = MathF.Acos(Math.Clamp(Vec3.Dot(forward, targetDirection), -1.0f, 1.0f));
        if (angle > maxAngleRadians)
        {
            Vec3 perpendicular = targetDirection - (forward * Vec3.Dot(targetDirection, forward));
            if (perpendicular.LengthSquared() <= DegenerateSquared)
            {
                return false;
            }

            perpendicular = Vec3.Normalize(perpendicular);
            targetDirection = Vec3.Normalize(
                (forward * MathF.Cos(maxAngleRadians)) + (perpendicular * MathF.Sin(maxAngleRadians)));
        }

        Span<Quat> localR = frame.GetRotations();
        int parent = rig.Parents[boneIndex];
        Quat parentWorld = parent >= 0 ? worldR[parent] : Quat.Identity;
        Quat correction = FastMath.QuatFromTo(forward, targetDirection);
        Quat aimed = FastMath.Normalize(
            FastMath.Multiply(
                FastMath.Multiply(
                    FastMath.Multiply(FastMath.Invert(parentWorld), correction),
                    parentWorld),
                localR[boneIndex]));
        localR[boneIndex] = w >= 1.0f ? aimed : FastMath.Slerp(localR[boneIndex], aimed, w);

        if (worldUp.LengthSquared() <= DegenerateSquared)
        {
            return true;
        }

        BlendingKernels.ForwardKinematics(rig, frame, worldT, worldR, worldS);
        Vec3 forwardAfter = Vec3.Normalize(worldR[boneIndex] * Vec3.UnitZ);
        Vec3 upAfter = worldR[boneIndex] * Vec3.UnitY;
        upAfter -= forwardAfter * Vec3.Dot(upAfter, forwardAfter);
        if (upAfter.LengthSquared() <= DegenerateSquared)
        {
            return true;
        }

        upAfter = Vec3.Normalize(upAfter);
        Vec3 desiredUp = worldUp - (forwardAfter * Vec3.Dot(worldUp, forwardAfter));
        if (desiredUp.LengthSquared() <= DegenerateSquared)
        {
            return true;
        }

        desiredUp = Vec3.Normalize(desiredUp);
        float roll = MathF.Acos(Math.Clamp(Vec3.Dot(upAfter, desiredUp), -1.0f, 1.0f));
        if (roll <= AnimationConstants.SoaEpsilon)
        {
            return true;
        }

        float sign = Vec3.Dot(Vec3.Cross(upAfter, desiredUp), forwardAfter) >= 0.0f ? 1.0f : -1.0f;
        Quat rollCorrection = Quat.CreateFromAxisAngle(forwardAfter, roll * sign);
        Quat rolled = FastMath.Normalize(
            FastMath.Multiply(
                FastMath.Multiply(
                    FastMath.Multiply(FastMath.Invert(parentWorld), rollCorrection),
                    parentWorld),
                localR[boneIndex]));
        localR[boneIndex] = w >= 1.0f ? rolled : FastMath.Slerp(localR[boneIndex], rolled, w);
        return true;
    }
}
