namespace Axrone.Animation;

using Axrone.Numeric;

/// <summary>
/// Analytic two-bone IK: a root, a mid joint and a tip, solved in closed form
/// against a world-space target with an explicit bend plane and joint limits.
/// </summary>
/// <remarks>
/// The solver writes local rotations only, so the pose keeps its existing scale
/// and translation lanes. Pole position selects the side the mid joint bends
/// toward; when it is degenerate the current bend plane is preserved. Limits
/// clamp the interior angle at the root, which keeps elbows and knees out of
/// hyperextension instead of letting the chain fold through itself.
/// </remarks>
public static class TwoBoneIk
{
    private const float DegenerateSquared = 1e-12f;

    /// <summary>
    /// Solves a three-bone chain. Bone indices must form a direct parent chain
    /// (mid child of root, tip child of mid) on the supplied rig.
    /// </summary>
    /// <param name="rig">Rig the frame belongs to.</param>
    /// <param name="frame">Pose to mutate in place.</param>
    /// <param name="rootBone">Upper joint.</param>
    /// <param name="midBone">Middle joint.</param>
    /// <param name="tipBone">End joint.</param>
    /// <param name="targetPosition">World-space target for the tip.</param>
    /// <param name="polePosition">World-space point the mid joint bends toward.</param>
    /// <param name="weight">Blend weight in the unit interval.</param>
    /// <param name="minBendRadians">Minimum interior angle at the root.</param>
    /// <param name="maxBendRadians">Maximum interior angle at the root.</param>
    /// <param name="twistRadians">Twist around the root-to-target axis.</param>
    [SkipLocalsInit]
    public static void Solve(
        Rig rig,
        AnimationFrame frame,
        int rootBone,
        int midBone,
        int tipBone,
        in Vec3 targetPosition,
        in Vec3 polePosition,
        float weight = 1.0f,
        float minBendRadians = 0.0f,
        float maxBendRadians = MathF.PI,
        float twistRadians = 0.0f)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(frame);

        if (frame.BoneCount != rig.BoneCount)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                $"Two-bone IK targets {rig.BoneCount} bones but the frame has {frame.BoneCount}.");
        }

        ValidateChain(rig, rootBone, midBone, tipBone);

        if (!(weight > 0.0f))
        {
            return;
        }

        if (!float.IsFinite(minBendRadians) || !float.IsFinite(maxBendRadians) ||
            minBendRadians < 0.0f || maxBendRadians > MathF.PI || minBendRadians > maxBendRadians)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                $"Two-bone bend limits [{minBendRadians}, {maxBendRadians}] are outside [0, pi] or inverted.");
        }

        if (!float.IsFinite(twistRadians))
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                "Two-bone twist must be finite.");
        }

        float w = FastMath.Clamp01(weight);
        if (w <= 0.0f)
        {
            return;
        }

        Span<Quat> localR = frame.GetRotations();
        int boneCount = rig.BoneCount;
        using ScratchWorldBuffers buffers = ScratchWorldBuffers.UseStack(boneCount)
            ? ScratchWorldBuffers.FromStack(stackalloc Vec3[boneCount], stackalloc Quat[boneCount], stackalloc Vec3[boneCount])
            : ScratchWorldBuffers.RentPooled(boneCount);

        Span<Vec3> worldT = buffers.Translations;
        Span<Quat> worldR = buffers.Rotations;
        Span<Vec3> worldS = buffers.Scales;
        BlendingKernels.ForwardKinematics(rig, frame, worldT, worldR, worldS);

        Vec3 root = worldT[rootBone];
        float upperLength = Vec3.Distance(root, worldT[midBone]);
        float lowerLength = Vec3.Distance(worldT[midBone], worldT[tipBone]);
        if (upperLength <= AnimationConstants.SoaEpsilon || lowerLength <= AnimationConstants.SoaEpsilon)
        {
            return;
        }

        Vec3 toTarget = targetPosition - root;
        float targetDistance = toTarget.Length();
        if (targetDistance <= AnimationConstants.SoaEpsilon)
        {
            toTarget = worldT[midBone] - root;
            targetDistance = toTarget.Length();
            if (targetDistance <= AnimationConstants.SoaEpsilon)
            {
                return;
            }
        }

        toTarget /= targetDistance;

        float minReach = MathF.Abs(upperLength - lowerLength) + AnimationConstants.SoaEpsilon;
        float maxReach = upperLength + lowerLength - AnimationConstants.SoaEpsilon;
        float distance = Math.Clamp(targetDistance, minReach, maxReach);

        float cosRoot = (upperLength * upperLength) + (distance * distance) - (lowerLength * lowerLength);
        cosRoot /= 2.0f * upperLength * distance;
        float bend = MathF.Acos(Math.Clamp(cosRoot, -1.0f, 1.0f));
        bend = Math.Clamp(bend, minBendRadians, maxBendRadians);

        // Re-derive reach from the clamped angle so limits shorten the chain
        // instead of leaving the tip on its pre-limit position.
        float sinBend = MathF.Sin(bend);
        float lowerProjection = MathF.Sqrt(MathF.Max(0.0f, (lowerLength * lowerLength) - (upperLength * upperLength * sinBend * sinBend)));
        distance = (upperLength * MathF.Cos(bend)) + lowerProjection;
        distance = Math.Clamp(distance, minReach, maxReach);

        Vec3 poleDirection = polePosition - root;
        poleDirection -= toTarget * Vec3.Dot(poleDirection, toTarget);
        if (poleDirection.LengthSquared() <= DegenerateSquared)
        {
            poleDirection = worldT[midBone] - root;
            poleDirection -= toTarget * Vec3.Dot(poleDirection, toTarget);
        }

        if (poleDirection.LengthSquared() <= DegenerateSquared)
        {
            Vec3 fallbackAxis = MathF.Abs(toTarget.Y) < 0.9f ? Vec3.UnitY : Vec3.UnitX;
            poleDirection = Vec3.Cross(toTarget, fallbackAxis);
        }

        poleDirection = Vec3.Normalize(poleDirection);
        Vec3 midDirection = Vec3.Normalize((toTarget * MathF.Cos(bend)) + (poleDirection * sinBend));
        Vec3 desiredMid = root + (midDirection * upperLength);
        Vec3 desiredTip = root + (toTarget * distance);

        int rootParent = rig.Parents[rootBone];
        Vec3 currentMidDirection = worldT[midBone] - root;
        ApplyCorrection(localR, worldR, rootBone, rootParent, currentMidDirection, midDirection, w);

        if (MathF.Abs(twistRadians) > AnimationConstants.SoaEpsilon)
        {
            Quat twist = Quat.CreateFromAxisAngle(toTarget, twistRadians);
            ApplyCorrection(localR, worldR, rootBone, rootParent, in twist, w);
        }

        BlendingKernels.ForwardKinematics(rig, frame, worldT, worldR, worldS);

        int midParent = rig.Parents[midBone];
        Vec3 currentTipDirection = worldT[tipBone] - worldT[midBone];
        Vec3 desiredTipDirection = desiredTip - desiredMid;
        ApplyCorrection(localR, worldR, midBone, midParent, currentTipDirection, desiredTipDirection, w);
    }

    private static void ApplyCorrection(
        Span<Quat> localR,
        ReadOnlySpan<Quat> worldR,
        int bone,
        int parent,
        in Vec3 currentDirection,
        in Vec3 targetDirection,
        float weight)
    {
        if (currentDirection.LengthSquared() <= DegenerateSquared || targetDirection.LengthSquared() <= DegenerateSquared)
        {
            return;
        }

        Quat correction = FastMath.QuatFromTo(currentDirection, targetDirection);
        ApplyCorrection(localR, worldR, bone, parent, in correction, weight);
    }

    private static void ApplyCorrection(
        Span<Quat> localR,
        ReadOnlySpan<Quat> worldR,
        int bone,
        int parent,
        in Quat correction,
        float weight)
    {
        Quat parentWorld = parent >= 0 ? worldR[parent] : Quat.Identity;
        Quat newLocal = FastMath.Normalize(
            FastMath.Multiply(
                FastMath.Multiply(
                    FastMath.Multiply(FastMath.Invert(parentWorld), correction),
                    parentWorld),
                localR[bone]));
        localR[bone] = weight >= 1.0f ? newLocal : FastMath.Slerp(localR[bone], newLocal, weight);
    }

    private static void ValidateChain(Rig rig, int rootBone, int midBone, int tipBone)
    {
        int boneCount = rig.BoneCount;
        if ((uint)rootBone >= (uint)boneCount || (uint)midBone >= (uint)boneCount || (uint)tipBone >= (uint)boneCount)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                "Two-bone IK bone indices are outside the rig.");
        }

        if (rig.Parents[midBone] != rootBone || rig.Parents[tipBone] != midBone)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                "Two-bone IK requires mid to be a child of root and tip a child of mid.");
        }
    }
}
