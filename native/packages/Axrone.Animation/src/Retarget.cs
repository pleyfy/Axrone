namespace Axrone.Animation;

/// <summary>Translation retarget policy.</summary>
public enum RetargetTranslationMode
{
    /// <summary>Leave target translation untouched.</summary>
    None = 0,

    /// <summary>Copy source translation verbatim.</summary>
    Absolute = 1,

    /// <summary>Copy scaled by the rest-length ratio.</summary>
    Scaled = 2,
}

/// <summary>Rotation retarget policy.</summary>
public enum RetargetRotationMode
{
    /// <summary>Copy source rotation verbatim.</summary>
    Copy = 0,

    /// <summary>Apply through the rest-pose offset.</summary>
    Offset = 1,
}

/// <summary>
/// One dense retarget binding: source/target slots plus precomputed rest-relative
/// correction. The profile stores only mapped bones contiguously, so application
/// iterates bindings with no per-bone skip branches.
/// </summary>
public readonly record struct RetargetBinding(int SourceIndex, int TargetIndex, float LengthRatio, Quat RotationOffset);

/// <summary>Explicit source-to-target bone name pair.</summary>
public readonly record struct ExplicitBoneMapping(string Source, string Target);

/// <summary>
/// Precomputed cross-rig mapping: name (or explicit) bone pairs with rotation
/// offsets and rest-length ratios resolved once at construction.
/// </summary>
public sealed class RetargetProfile
{
    private readonly int[] _sourceToTargetMap;
    private readonly Quat[] _rotationOffsets;
    private readonly float[] _lengthRatios;
    private readonly RetargetBinding[] _bindings;

    /// <summary>Source rig.</summary>
    public Rig SourceRig { get; }

    /// <summary>Target rig.</summary>
    public Rig TargetRig { get; }

    /// <summary>Source-to-target bone map, -1 when unmapped.</summary>
    public ReadOnlySpan<int> SourceToTargetMap => _sourceToTargetMap;

    /// <summary>Translation policy.</summary>
    public RetargetTranslationMode TranslationMode
    {
        get;
        init
        {
            if ((uint)value > (uint)RetargetTranslationMode.Scaled)
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, $"Unknown translation mode '{value}'.");
            }

            field = value;
        }
    } = RetargetTranslationMode.Scaled;

    /// <summary>Rotation policy.</summary>
    public RetargetRotationMode RotationMode
    {
        get;
        init
        {
            if ((uint)value > (uint)RetargetRotationMode.Offset)
            {
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, $"Unknown rotation mode '{value}'.");
            }

            field = value;
        }
    } = RetargetRotationMode.Offset;

    /// <summary>Builds a profile with explicit tuple mappings or name matching.</summary>
    public RetargetProfile(Rig sourceRig, Rig targetRig, (string Source, string Target)[]? explicitMappings = null)
        : this(sourceRig, targetRig, ConvertTupleMappings(explicitMappings))
    {
    }

    /// <summary>Builds a profile with explicit struct mappings or name matching.</summary>
    public RetargetProfile(Rig sourceRig, Rig targetRig, params ReadOnlySpan<ExplicitBoneMapping> explicitMappings)
    {
        ArgumentNullException.ThrowIfNull(sourceRig);
        ArgumentNullException.ThrowIfNull(targetRig);
        SourceRig = sourceRig;
        TargetRig = targetRig;

        _sourceToTargetMap = new int[sourceRig.BoneCount];
        Array.Fill(_sourceToTargetMap, -1);
        _rotationOffsets = new Quat[sourceRig.BoneCount];
        _lengthRatios = new float[sourceRig.BoneCount];

        if (!explicitMappings.IsEmpty)
        {
            foreach (ExplicitBoneMapping mapping in explicitMappings)
            {
                BoneHandle sourceIndex = sourceRig.FindBoneIndex(mapping.Source);
                BoneHandle targetIndex = targetRig.FindBoneIndex(mapping.Target);
                if (sourceIndex.IsValid && targetIndex.IsValid)
                {
                    _sourceToTargetMap[sourceIndex.Index] = targetIndex.Index;
                }
            }
        }
        else
        {
            for (int i = 0; i < sourceRig.BoneCount; i++)
            {
                _sourceToTargetMap[i] = targetRig.FindBoneIndex(sourceRig.BoneNames[i]).Index;
            }
        }

        int mappedCount = 0;
        ReadOnlySpan<float> sourceRest = sourceRig.RestPoseBuffer;
        ReadOnlySpan<float> targetRest = targetRig.RestPoseBuffer;

        for (int s = 0; s < sourceRig.BoneCount; s++)
        {
            int t = _sourceToTargetMap[s];
            if (t == -1)
            {
                continue;
            }

            mappedCount++;

            int sRot = (sourceRig.BoneCount * 3) + (s * 4);
            int tRot = (targetRig.BoneCount * 3) + (t * 4);
            Quat sourceRestR = new(sourceRest[sRot], sourceRest[sRot + 1], sourceRest[sRot + 2], sourceRest[sRot + 3]);
            Quat targetRestR = new(targetRest[tRot], targetRest[tRot + 1], targetRest[tRot + 2], targetRest[tRot + 3]);
            _rotationOffsets[s] = Quat.Normalize(targetRestR * FastMath.InvertSafe(sourceRestR));

            float sourceLen = new Vec3(sourceRest[s * 3], sourceRest[(s * 3) + 1], sourceRest[(s * 3) + 2]).Length();
            float targetLen = new Vec3(targetRest[t * 3], targetRest[(t * 3) + 1], targetRest[(t * 3) + 2]).Length();
            _lengthRatios[s] = sourceLen > AnimationConstants.SoaEpsilon ? targetLen / sourceLen : 1.0f;
        }

        if (mappedCount == 0)
        {
            AnimationThrowHelper.ThrowRetargeting(AnimationErrorCode.RetargetingNoMapping, "Zero bone mappings resolved.");
        }

        _bindings = new RetargetBinding[mappedCount];
        int bindingIndex = 0;
        for (int s = 0; s < sourceRig.BoneCount; s++)
        {
            int t = _sourceToTargetMap[s];
            if (t != -1)
            {
                _bindings[bindingIndex++] = new RetargetBinding(s, t, _lengthRatios[s], _rotationOffsets[s]);
            }
        }
    }

    private static ExplicitBoneMapping[] ConvertTupleMappings((string Source, string Target)[]? mappings)
    {
        if (mappings is null || mappings.Length == 0)
        {
            return Array.Empty<ExplicitBoneMapping>();
        }

        var converted = new ExplicitBoneMapping[mappings.Length];
        for (int i = 0; i < mappings.Length; i++)
        {
            converted[i] = new ExplicitBoneMapping(mappings[i].Source, mappings[i].Target);
        }

        return converted;
    }

    /// <summary>Mapped-only bindings in source order.</summary>
    public ReadOnlySpan<RetargetBinding> Bindings => _bindings;

    private void ResetViewToRest(in AnimationFrameView target)
    {
        ReadOnlySpan<float> rest = TargetRig.RestPoseBuffer;
        int boneCount = TargetRig.BoneCount;
        int rotBase = boneCount * 3;
        int scaleBase = boneCount * 7;

        for (int i = 0; i < boneCount; i++)
        {
            int tOff = i * 3;
            int rOff = rotBase + (i * 4);
            int sOff = scaleBase + (i * 3);
            target.Translations[i] = new Vec3(rest[tOff], rest[tOff + 1], rest[tOff + 2]);
            target.Rotations[i] = new Quat(rest[rOff], rest[rOff + 1], rest[rOff + 2], rest[rOff + 3]);
            target.Scales[i] = new Vec3(rest[sOff], rest[sOff + 1], rest[sOff + 2]);
        }

        target.Curves.Clear();
    }

    /// <summary>Retargets a source frame onto a target frame, copying curves through.</summary>
    public void RetargetFrame(AnimationFrame sourceFrame, AnimationFrame targetFrame)
    {
        ArgumentNullException.ThrowIfNull(sourceFrame);
        ArgumentNullException.ThrowIfNull(targetFrame);
        if (sourceFrame.BoneCount != SourceRig.BoneCount || targetFrame.BoneCount != TargetRig.BoneCount)
        {
            AnimationThrowHelper.ThrowRetargeting(AnimationErrorCode.RetargetingIncompatibleLayout, "Retarget frames do not match their rigs.");
        }

        targetFrame.ResetToRest(TargetRig);
        DispatchCore(
            _bindings,
            TranslationMode,
            RotationMode,
            sourceFrame.ReadTranslations(),
            sourceFrame.ReadRotations(),
            sourceFrame.ReadScales(),
            sourceFrame.Curves.AsSpan(),
            targetFrame.GetTranslations(),
            targetFrame.GetRotations(),
            targetFrame.GetScales(),
            targetFrame.Curves.AsSpan());
    }

    /// <summary>
    /// Retargets between caller-owned lanes (arena scratch, stack spans) without
    /// an <see cref="AnimationFrame"/> allocation. A dedicated overload — not a
    /// generic contract — because ref-struct views cannot satisfy interfaces.
    /// </summary>
    public void RetargetView(in AnimationFrameView source, in AnimationFrameView target)
    {
        if (source.Translations.Length != SourceRig.BoneCount || target.Translations.Length != TargetRig.BoneCount)
        {
            AnimationThrowHelper.ThrowRetargeting(AnimationErrorCode.RetargetingIncompatibleLayout, "Retarget views do not match their rigs.");
        }

        ResetViewToRest(in target);
        DispatchCore(
            _bindings,
            TranslationMode,
            RotationMode,
            source.Translations,
            source.Rotations,
            source.Scales,
            source.Curves,
            target.Translations,
            target.Rotations,
            target.Scales,
            target.Curves);
    }

    /// <summary>
    /// Mode-pair dispatch: policies hoisted out of the loop into six branch-free
    /// executors. Unknown combinations fail loudly (modes are init-validated).
    /// </summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    internal static void DispatchCore(
        ReadOnlySpan<RetargetBinding> bindings,
        RetargetTranslationMode translationMode,
        RetargetRotationMode rotationMode,
        ReadOnlySpan<Vec3> sourceT,
        ReadOnlySpan<Quat> sourceR,
        ReadOnlySpan<Vec3> sourceS,
        ReadOnlySpan<float> sourceCurves,
        Span<Vec3> targetT,
        Span<Quat> targetR,
        Span<Vec3> targetS,
        Span<float> targetCurves)
    {
        switch (translationMode, rotationMode)
        {
            case (RetargetTranslationMode.Scaled, RetargetRotationMode.Offset):
                ExecuteScaledOffset(bindings, sourceT, sourceR, sourceS, targetT, targetR, targetS);
                break;
            case (RetargetTranslationMode.Absolute, RetargetRotationMode.Offset):
                ExecuteAbsoluteOffset(bindings, sourceT, sourceR, sourceS, targetT, targetR, targetS);
                break;
            case (RetargetTranslationMode.None, RetargetRotationMode.Offset):
                ExecuteNoneOffset(bindings, sourceT, sourceR, sourceS, targetT, targetR, targetS);
                break;
            case (RetargetTranslationMode.Scaled, RetargetRotationMode.Copy):
                ExecuteScaledCopy(bindings, sourceT, sourceR, sourceS, targetT, targetR, targetS);
                break;
            case (RetargetTranslationMode.Absolute, RetargetRotationMode.Copy):
                ExecuteAbsoluteCopy(bindings, sourceT, sourceR, sourceS, targetT, targetR, targetS);
                break;
            case (RetargetTranslationMode.None, RetargetRotationMode.Copy):
                ExecuteNoneCopy(bindings, sourceT, sourceR, sourceS, targetT, targetR, targetS);
                break;
            default:
                AnimationThrowHelper.ThrowValidation(AnimationErrorCode.ValidationInvalidArgument, $"Unknown retarget mode pair '{translationMode}/{rotationMode}'.");
                break;
        }

        int curveCount = Math.Min(targetCurves.Length, sourceCurves.Length);
        sourceCurves.Slice(0, curveCount).CopyTo(targetCurves.Slice(0, curveCount));
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void ExecuteScaledOffset(
        ReadOnlySpan<RetargetBinding> bindings,
        ReadOnlySpan<Vec3> sourceT,
        ReadOnlySpan<Quat> sourceR,
        ReadOnlySpan<Vec3> sourceS,
        Span<Vec3> targetT,
        Span<Quat> targetR,
        Span<Vec3> targetS)
    {
        for (int i = 0; i < bindings.Length; i++)
        {
            ref readonly RetargetBinding binding = ref bindings[i];
            int s = binding.SourceIndex;
            int t = binding.TargetIndex;
            targetT[t] = sourceT[s] * binding.LengthRatio;
            targetR[t] = FastMath.Normalize(binding.RotationOffset * sourceR[s]);
            targetS[t] = sourceS[s];
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void ExecuteAbsoluteOffset(
        ReadOnlySpan<RetargetBinding> bindings,
        ReadOnlySpan<Vec3> sourceT,
        ReadOnlySpan<Quat> sourceR,
        ReadOnlySpan<Vec3> sourceS,
        Span<Vec3> targetT,
        Span<Quat> targetR,
        Span<Vec3> targetS)
    {
        for (int i = 0; i < bindings.Length; i++)
        {
            ref readonly RetargetBinding binding = ref bindings[i];
            int s = binding.SourceIndex;
            int t = binding.TargetIndex;
            targetT[t] = sourceT[s];
            targetR[t] = FastMath.Normalize(binding.RotationOffset * sourceR[s]);
            targetS[t] = sourceS[s];
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void ExecuteNoneOffset(
        ReadOnlySpan<RetargetBinding> bindings,
        ReadOnlySpan<Vec3> sourceT,
        ReadOnlySpan<Quat> sourceR,
        ReadOnlySpan<Vec3> sourceS,
        Span<Vec3> targetT,
        Span<Quat> targetR,
        Span<Vec3> targetS)
    {
        for (int i = 0; i < bindings.Length; i++)
        {
            ref readonly RetargetBinding binding = ref bindings[i];
            int s = binding.SourceIndex;
            int t = binding.TargetIndex;
            targetR[t] = FastMath.Normalize(binding.RotationOffset * sourceR[s]);
            targetS[t] = sourceS[s];
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void ExecuteScaledCopy(
        ReadOnlySpan<RetargetBinding> bindings,
        ReadOnlySpan<Vec3> sourceT,
        ReadOnlySpan<Quat> sourceR,
        ReadOnlySpan<Vec3> sourceS,
        Span<Vec3> targetT,
        Span<Quat> targetR,
        Span<Vec3> targetS)
    {
        for (int i = 0; i < bindings.Length; i++)
        {
            ref readonly RetargetBinding binding = ref bindings[i];
            int s = binding.SourceIndex;
            int t = binding.TargetIndex;
            targetT[t] = sourceT[s] * binding.LengthRatio;
            targetR[t] = sourceR[s];
            targetS[t] = sourceS[s];
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void ExecuteAbsoluteCopy(
        ReadOnlySpan<RetargetBinding> bindings,
        ReadOnlySpan<Vec3> sourceT,
        ReadOnlySpan<Quat> sourceR,
        ReadOnlySpan<Vec3> sourceS,
        Span<Vec3> targetT,
        Span<Quat> targetR,
        Span<Vec3> targetS)
    {
        for (int i = 0; i < bindings.Length; i++)
        {
            ref readonly RetargetBinding binding = ref bindings[i];
            int s = binding.SourceIndex;
            int t = binding.TargetIndex;
            targetT[t] = sourceT[s];
            targetR[t] = sourceR[s];
            targetS[t] = sourceS[s];
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    private static void ExecuteNoneCopy(
        ReadOnlySpan<RetargetBinding> bindings,
        ReadOnlySpan<Vec3> sourceT,
        ReadOnlySpan<Quat> sourceR,
        ReadOnlySpan<Vec3> sourceS,
        Span<Vec3> targetT,
        Span<Quat> targetR,
        Span<Vec3> targetS)
    {
        for (int i = 0; i < bindings.Length; i++)
        {
            ref readonly RetargetBinding binding = ref bindings[i];
            int s = binding.SourceIndex;
            int t = binding.TargetIndex;
            targetR[t] = sourceR[s];
            targetS[t] = sourceS[s];
        }
    }
}
