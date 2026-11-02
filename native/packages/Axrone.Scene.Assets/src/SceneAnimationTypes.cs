namespace Axrone.Scene.Assets;

/// <summary>Phantom tag for skin ids.</summary>
public readonly struct SkinAssetTag;

/// <summary>Phantom tag for animation clip ids.</summary>
public readonly struct AnimationAssetTag;

/// <summary>Morph target attribute kind.</summary>
public enum SceneMorphTargetSemantic : byte
{
    /// <summary>Position delta.</summary>
    Position = 0,

    /// <summary>Normal delta.</summary>
    Normal = 1,

    /// <summary>Tangent delta.</summary>
    Tangent = 2
}

/// <summary>Morph target delta buffer: one attribute stream for every mesh vertex.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneMorphTargetDefinition(
    SceneMorphTargetSemantic Semantic,
    ReadOnlyMemory<byte> DeltaBuffer,
    int Stride,
    int ComponentCount);

/// <summary>Animated property path.</summary>
public enum SceneAnimationPath : byte
{
    /// <summary>Translation track.</summary>
    Translation = 0,

    /// <summary>Rotation track.</summary>
    Rotation = 1,

    /// <summary>Scale track.</summary>
    Scale = 2,

    /// <summary>Morph weights track.</summary>
    Weights = 3,

    /// <summary>JSON pointer track.</summary>
    Pointer = 4
}

/// <summary>Keyframe interpolation mode.</summary>
public enum SceneAnimationInterpolation : byte
{
    /// <summary>Linear interpolation.</summary>
    Linear = 0,

    /// <summary>Step interpolation.</summary>
    Step = 1,

    /// <summary>Cubic spline with in/out tangents.</summary>
    CubicSpline = 2
}

/// <summary>
/// One animation channel. <see cref="Values"/> is packed per keyframe using
/// <see cref="SampleStride"/>; cubic-spline tracks pack in-tangent, value and out-tangent.
/// </summary>
public sealed class SceneAnimationTrackDefinition
{
    /// <summary>Creates an animation track.</summary>
    public SceneAnimationTrackDefinition(
        string targetNodeId,
        SceneAnimationPath path,
        SceneAnimationInterpolation interpolation,
        int keyframeCount,
        int valueComponentCount,
        int sampleStride,
        ReadOnlyMemory<float> times,
        ReadOnlyMemory<float> values,
        string? pointer = null)
    {
        if (string.IsNullOrWhiteSpace(targetNodeId))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Animation tracks require a target node id.");
        }

        if (keyframeCount < 0)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Animation tracks require a non-negative keyframe count.");
        }

        if (valueComponentCount is < 1 or > 16)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Animation track value component count must be between one and sixteen.");
        }

        int expectedStride = interpolation == SceneAnimationInterpolation.CubicSpline
            ? valueComponentCount * 3
            : valueComponentCount;
        if (sampleStride != expectedStride)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Animation track sample stride does not match its interpolation and component count.");
        }

        if (times.Length != keyframeCount || values.Length != keyframeCount * sampleStride)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Animation track time and value lengths do not match the keyframe layout.");
        }

        TargetNodeId = targetNodeId;
        Path = path;
        Interpolation = interpolation;
        KeyframeCount = keyframeCount;
        ValueComponentCount = valueComponentCount;
        SampleStride = sampleStride;
        Times = times;
        Values = values;
        Pointer = pointer;
    }

    /// <summary>Target node id.</summary>
    public string TargetNodeId { get; }

    /// <summary>Animated path.</summary>
    public SceneAnimationPath Path { get; }

    /// <summary>Interpolation mode.</summary>
    public SceneAnimationInterpolation Interpolation { get; }

    /// <summary>Keyframe count.</summary>
    public int KeyframeCount { get; }

    /// <summary>Components per value.</summary>
    public int ValueComponentCount { get; }

    /// <summary>Floats per keyframe sample.</summary>
    public int SampleStride { get; }

    /// <summary>Keyframe times in seconds.</summary>
    public ReadOnlyMemory<float> Times { get; }

    /// <summary>Packed keyframe values.</summary>
    public ReadOnlyMemory<float> Values { get; }

    /// <summary>KHR_animation_pointer JSON pointer, when present.</summary>
    public string? Pointer { get; }
}

/// <summary>Animation clip definition.</summary>
public sealed class SceneAnimationClipDefinition : ISceneAssetDefinition<AnimationAssetTag>
{
    /// <summary>Creates an animation clip.</summary>
    public SceneAnimationClipDefinition(
        SceneAssetId<AnimationAssetTag> id,
        float duration,
        IReadOnlyList<SceneAnimationTrackDefinition> tracks,
        IReadOnlyList<string>? tags = null)
    {
        if (!id.IsValid)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Animation clips require a non-empty id.");
        }

        if (!float.IsFinite(duration) || duration < 0.0f)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Animation clip '{id}' requires a finite non-negative duration.");
        }

        ArgumentNullException.ThrowIfNull(tracks);

        Id = id;
        Duration = duration;
        Tracks = [.. tracks];
        Tags = tags is null ? [] : [.. tags];
    }

    /// <inheritdoc/>
    public SceneAssetId<AnimationAssetTag> Id { get; }

    /// <summary>Clip duration in seconds.</summary>
    public float Duration { get; }

    /// <summary>Tracks in channel order.</summary>
    public IReadOnlyList<SceneAnimationTrackDefinition> Tracks { get; }

    /// <summary>Optional tags.</summary>
    public IReadOnlyList<string> Tags { get; }
}

/// <summary>Skin definition: joint order, skeleton root and inverse bind matrices.</summary>
public sealed class SceneSkinDefinition : ISceneAssetDefinition<SkinAssetTag>
{
    /// <summary>Creates a skin definition.</summary>
    public SceneSkinDefinition(
        SceneAssetId<SkinAssetTag> id,
        IReadOnlyList<string> jointNodeIds,
        IReadOnlyList<int> jointNodeIndices,
        string? skeletonNodeId,
        ReadOnlyMemory<float> inverseBindMatrices)
    {
        if (!id.IsValid)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Skin definitions require a non-empty id.");
        }

        ArgumentNullException.ThrowIfNull(jointNodeIds);
        ArgumentNullException.ThrowIfNull(jointNodeIndices);

        if (jointNodeIds.Count != jointNodeIndices.Count)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Skin '{id}' joint id and index counts do not match.");
        }

        if (inverseBindMatrices.Length != jointNodeIds.Count * 16)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Skin '{id}' requires one 4x4 inverse bind matrix per joint.");
        }

        Id = id;
        JointNodeIds = [.. jointNodeIds];
        JointNodeIndices = [.. jointNodeIndices];
        SkeletonNodeId = skeletonNodeId;
        InverseBindMatrices = inverseBindMatrices;
    }

    /// <inheritdoc/>
    public SceneAssetId<SkinAssetTag> Id { get; }

    /// <summary>Joint node ids in skin order.</summary>
    public IReadOnlyList<string> JointNodeIds { get; }

    /// <summary>Joint node indices in skin order.</summary>
    public IReadOnlyList<int> JointNodeIndices { get; }

    /// <summary>Optional skeleton root node id.</summary>
    public string? SkeletonNodeId { get; }

    /// <summary>Row-major inverse bind matrices.</summary>
    public ReadOnlyMemory<float> InverseBindMatrices { get; }
}
