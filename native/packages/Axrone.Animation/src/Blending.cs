namespace Axrone.Animation;

/// <summary>Pose-space kernels: forward kinematics plus override/weighted/additive blends.</summary>
public static class BlendingKernels
{
    /// <summary>Local-to-world hierarchy compose in evaluation order.</summary>
    [SkipLocalsInit]
    public static void ForwardKinematics(Rig rig, AnimationFrame localFrame, Span<Vec3> worldT, Span<Quat> worldR, Span<Vec3> worldS)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(localFrame);

        ReadOnlySpan<Vec3> locT = localFrame.ReadTranslations();
        ReadOnlySpan<Quat> locR = localFrame.ReadRotations();
        ReadOnlySpan<Vec3> locS = localFrame.ReadScales();
        ReadOnlySpan<int> order = rig.EvaluationOrder;
        ReadOnlySpan<int> parents = rig.Parents;

        for (int i = 0; i < order.Length; i++)
        {
            int b = order[i];
            int p = parents[b];
            if (p == -1)
            {
                worldT[b] = locT[b];
                worldR[b] = locR[b];
                worldS[b] = locS[b];
            }
            else
            {
                FastMath.ConcatenateLocal(worldT[p], worldR[p], worldS[p], locT[b], locR[b], locS[b], out worldT[b], out worldR[b], out worldS[b]);
            }
        }
    }

    /// <summary>
    /// Override blend with optional bone mask. Unmasked runs the vectorized fast path
    /// with copy-through at the alpha extremes.
    /// </summary>
    [SkipLocalsInit]
    public static void BlendFrame(AnimationFrame target, AnimationFrame baseFrame, AnimationFrame overlayFrame, float alpha, AnimationMask? mask = null)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(baseFrame);
        ArgumentNullException.ThrowIfNull(overlayFrame);

        if (baseFrame.BoneCount != overlayFrame.BoneCount || target.BoneCount != baseFrame.BoneCount)
        {
            AnimationThrowHelper.ThrowEvaluation(AnimationErrorCode.ValidationClipMismatch, "Mismatched bone count in BlendFrame.");
        }

        if (!mask.HasValue)
        {
            if (alpha <= 0.0f)
            {
                target.CopyFrom(baseFrame);
                return;
            }

            if (alpha >= 1.0f)
            {
                target.CopyFrom(overlayFrame);
                return;
            }
        }

        float t = FastMath.Clamp01(alpha);
        int boneCount = baseFrame.BoneCount;

        ReadOnlySpan<Vec3> baseT = baseFrame.ReadTranslations();
        ReadOnlySpan<Quat> baseR = baseFrame.ReadRotations();
        ReadOnlySpan<Vec3> baseS = baseFrame.ReadScales();

        ReadOnlySpan<Vec3> overT = overlayFrame.ReadTranslations();
        ReadOnlySpan<Quat> overR = overlayFrame.ReadRotations();
        ReadOnlySpan<Vec3> overS = overlayFrame.ReadScales();

        Span<Vec3> dstT = target.GetTranslations();
        Span<Quat> dstR = target.GetRotations();
        Span<Vec3> dstS = target.GetScales();

        for (int i = 0; i < boneCount; i++)
        {
            if (mask.HasValue && !mask.Value.IsEnabled(i))
            {
                dstT[i] = baseT[i];
                dstR[i] = baseR[i];
                dstS[i] = baseS[i];
                continue;
            }

            dstT[i] = Vec3.Lerp(baseT[i], overT[i], t);
            dstR[i] = FastMath.Slerp(baseR[i], overR[i], t);
            dstS[i] = Vec3.Lerp(baseS[i], overS[i], t);
        }

        BlendCurves(target, baseFrame, overlayFrame, t);
    }

    private static void BlendCurves(AnimationFrame target, AnimationFrame baseFrame, AnimationFrame overlayFrame, float t)
    {
        Span<float> dst = target.Curves.AsSpan();
        ReadOnlySpan<float> baseC = baseFrame.Curves.AsSpan();
        ReadOnlySpan<float> overC = overlayFrame.Curves.AsSpan();
        int count = Math.Min(dst.Length, Math.Min(baseC.Length, overC.Length));

        for (int i = 0; i < count; i++)
        {
            dst[i] = (baseC[i] * (1.0f - t)) + (overC[i] * t);
        }
    }

    /// <summary>
    /// Normalized weighted average over N frames with hemisphere-consistent
    /// Quat accumulation. Zero total weight falls back to rest.
    /// </summary>
    [SkipLocalsInit]
    public static void BlendWeightedFrames(AnimationFrame target, ReadOnlySpan<AnimationFrame> frames, ReadOnlySpan<float> weights, Rig rig)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(rig);

        float totalWeight = 0.0f;
        int validCount = 0;
        for (int i = 0; i < weights.Length; i++)
        {
            if (weights[i] > 0.0f)
            {
                totalWeight += weights[i];
                validCount++;
            }
        }

        if (totalWeight <= AnimationConstants.BlendEpsilon || validCount == 0)
        {
            target.ResetToRest(rig);
            return;
        }

        int boneCount = target.BoneCount;
        Span<Vec3> dstT = target.GetTranslations();
        Span<Quat> dstR = target.GetRotations();
        Span<Vec3> dstS = target.GetScales();

        dstT.Clear();
        dstS.Clear();

        for (int b = 0; b < boneCount; b++)
        {
            Vec3 accT = Vec3.Zero;
            Vec3 accS = Vec3.Zero;
            Vec4 accQ = Vec4.Zero;
            Quat reference = Quat.Identity;
            bool first = true;

            for (int i = 0; i < frames.Length; i++)
            {
                float w = weights[i];
                if (w <= 0.0f)
                {
                    continue;
                }

                AnimationFrame frame = frames[i];
                accT += frame.ReadTranslations()[b] * w;
                accS += frame.ReadScales()[b] * w;

                Quat q = frame.ReadRotations()[b];
                if (first)
                {
                    reference = q;
                    first = false;
                }

                float dot = (q.X * reference.X) + (q.Y * reference.Y) + (q.Z * reference.Z) + (q.W * reference.W);
                Vec4 lane = new(q.X, q.Y, q.Z, q.W);
                accQ += dot < 0.0f ? -lane * w : lane * w;
            }

            float invWeight = 1.0f / totalWeight;
            dstT[b] = accT * invWeight;
            dstS[b] = accS * invWeight;
            dstR[b] = Quat.Normalize(new Quat(accQ.X, accQ.Y, accQ.Z, accQ.W));
        }

        Span<float> dstC = target.Curves.AsSpan();
        dstC.Clear();
        float invTotal = 1.0f / totalWeight;

        for (int i = 0; i < frames.Length; i++)
        {
            float w = weights[i];
            if (w <= 0.0f)
            {
                continue;
            }

            ReadOnlySpan<float> channels = frames[i].Curves.AsSpan();
            int count = Math.Min(dstC.Length, channels.Length);
            for (int c = 0; c < count; c++)
            {
                dstC[c] += channels[c] * w;
            }
        }

        for (int c = 0; c < dstC.Length; c++)
        {
            dstC[c] *= invTotal;
        }
    }

    /// <summary>
    /// Additive blend: rest-relative deltas scaled by alpha onto the base pose.
    /// Rotation deltas ride the rest-inverse sandwich with slerp-scaled magnitude.
    /// </summary>
    [SkipLocalsInit]
    public static void ApplyAdditiveFrame(AnimationFrame target, AnimationFrame baseFrame, AnimationFrame additiveFrame, Rig rig, float alpha, AnimationMask? mask = null, AnimationFrame? referenceFrame = null)
    {
        ArgumentNullException.ThrowIfNull(target);
        ArgumentNullException.ThrowIfNull(baseFrame);
        ArgumentNullException.ThrowIfNull(additiveFrame);
        ArgumentNullException.ThrowIfNull(rig);

        float a = FastMath.Clamp01(alpha);
        int boneCount = target.BoneCount;

        ReadOnlySpan<Vec3> referenceT = referenceFrame is not null ? referenceFrame.ReadTranslations() : default;
        ReadOnlySpan<Quat> referenceR = referenceFrame is not null ? referenceFrame.ReadRotations() : default;
        ReadOnlySpan<Vec3> referenceS = referenceFrame is not null ? referenceFrame.ReadScales() : default;

        ReadOnlySpan<Vec3> baseT = baseFrame.ReadTranslations();
        ReadOnlySpan<Quat> baseR = baseFrame.ReadRotations();
        ReadOnlySpan<Vec3> baseS = baseFrame.ReadScales();

        ReadOnlySpan<Vec3> addT = additiveFrame.ReadTranslations();
        ReadOnlySpan<Quat> addR = additiveFrame.ReadRotations();
        ReadOnlySpan<Vec3> addS = additiveFrame.ReadScales();

        ReadOnlySpan<float> rest = rig.RestPoseBuffer;
        int rotBase = boneCount * 3;
        int scaleBase = boneCount * 7;

        Span<Vec3> dstT = target.GetTranslations();
        Span<Quat> dstR = target.GetRotations();
        Span<Vec3> dstS = target.GetScales();

        for (int i = 0; i < boneCount; i++)
        {
            if (mask.HasValue && !mask.Value.IsEnabled(i))
            {
                continue;
            }

            int tOff = i * 3;
            int rOff = rotBase + (i * 4);
            int sOff = scaleBase + (i * 3);

            Vec3 restT = new(rest[tOff], rest[tOff + 1], rest[tOff + 2]);
            Quat restR = new(rest[rOff], rest[rOff + 1], rest[rOff + 2], rest[rOff + 3]);
            Vec3 restS = new(rest[sOff], rest[sOff + 1], rest[sOff + 2]);

            Vec3 referenceTranslation = referenceFrame is not null ? referenceT[i] : restT;
            Quat referenceRotation = referenceFrame is not null ? referenceR[i] : restR;
            Vec3 referenceScale = referenceFrame is not null ? referenceS[i] : restS;

            dstT[i] = baseT[i] + ((addT[i] - referenceTranslation) * a);
            dstS[i] = baseS[i] + ((addS[i] - referenceScale) * a);

            Quat invRest = Quat.Inverse(referenceRotation);
            Quat delta = Quat.Concatenate(invRest, addR[i]);
            Quat scaledDelta = FastMath.Slerp(Quat.Identity, delta, a);
            dstR[i] = Quat.Normalize(baseR[i] * scaledDelta);
        }

        Span<float> dstC = target.Curves.AsSpan();
        ReadOnlySpan<float> baseC = baseFrame.Curves.AsSpan();
        ReadOnlySpan<float> addC = additiveFrame.Curves.AsSpan();
        ReadOnlySpan<float> referenceC = referenceFrame is not null ? referenceFrame.Curves.AsSpan() : default;
        int curveCount = Math.Min(dstC.Length, Math.Min(baseC.Length, addC.Length));
        if (referenceFrame is not null)
        {
            curveCount = Math.Min(curveCount, referenceC.Length);
        }

        for (int i = 0; i < curveCount; i++)
        {
            float reference = referenceFrame is not null ? referenceC[i] : 0.0f;
            dstC[i] = baseC[i] + ((addC[i] - reference) * a);
        }
    }
}
