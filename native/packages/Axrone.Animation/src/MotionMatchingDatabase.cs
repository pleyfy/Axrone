namespace Axrone.Animation;

using Axrone.Numeric;

/// <summary>
/// Precomputed motion-matching samples: one candidate per fixed interval of each
/// source clip, carrying root trajectory, facing and clip tags.
/// </summary>
/// <remarks>
/// The root is assumed to be bone 0; clips without a root channel contribute a
/// zero trajectory at the origin. Sampling clamps at the clip end, so the final
/// frame is always included without duplicating the loop seam.
/// </remarks>
public sealed class MotionMatchingDatabase
{
    private readonly AnimationClip[] _clips;
    private readonly MotionMatchCandidate[] _candidates;

    private MotionMatchingDatabase(Rig rig, AnimationClip[] clips, MotionMatchCandidate[] candidates)
    {
        Rig = rig;
        _clips = clips;
        _candidates = candidates;
    }

    /// <summary>Rig the samples were extracted from.</summary>
    public Rig Rig { get; }

    /// <summary>Source clips, indexed by <see cref="MotionMatchCandidate.ClipIndex"/>.</summary>
    public ReadOnlySpan<AnimationClip> Clips => _clips;

    /// <summary>Searchable pose samples in clip order, then time order.</summary>
    public ReadOnlySpan<MotionMatchCandidate> Candidates => _candidates;

    /// <summary>
    /// Builds a database by sampling every clip at <paramref name="sampleInterval"/>
    /// seconds. Both endpoints of each clip are included.
    /// </summary>
    public static MotionMatchingDatabase Build(
        Rig rig,
        IReadOnlyList<AnimationClip> clips,
        float sampleInterval = 0.1f)
    {
        ArgumentNullException.ThrowIfNull(rig);
        ArgumentNullException.ThrowIfNull(clips);
        if (!float.IsFinite(sampleInterval) || sampleInterval <= AnimationConstants.SoaEpsilon)
        {
            AnimationThrowHelper.ThrowValidation(
                AnimationErrorCode.ValidationInvalidArgument,
                $"Motion-matching sample interval {sampleInterval} must be finite and positive.");
        }

        var candidates = new List<MotionMatchCandidate>();
        var clipArray = new AnimationClip[clips.Count];
        var frame = new AnimationFrame(rig.BoneCount, new CurveLayout(new Dictionary<CurveId, int>()));

        for (int clipIndex = 0; clipIndex < clips.Count; clipIndex++)
        {
            AnimationClip clip = clips[clipIndex];
            ArgumentNullException.ThrowIfNull(clip);
            clipArray[clipIndex] = clip;

            if (clip.Duration <= AnimationConstants.SoaEpsilon)
            {
                continue;
            }

            HashSet<string>? tags = clip.Tags.Count > 0
                ? new HashSet<string>(clip.Tags, StringComparer.Ordinal)
                : null;

            int steps = Math.Max(1, (int)MathF.Ceiling(clip.Duration / sampleInterval));
            for (int step = 0; step <= steps; step++)
            {
                float time = MathF.Min(step * sampleInterval, clip.Duration);
                clip.Sample(time, frame, isLooping: false);

                Vec3 position = frame.ReadTranslations()[0];
                Quat rotation = frame.ReadRotations()[0];
                Vec3 facing = rotation * Vec3.UnitZ;
                facing = facing.LengthSquared() > AnimationConstants.SoaEpsilon
                    ? Vec3.Normalize(facing)
                    : Vec3.UnitZ;

                candidates.Add(new MotionMatchCandidate(
                    clipIndex,
                    time,
                    position,
                    facing,
                    tags));
            }
        }

        return new MotionMatchingDatabase(rig, clipArray, [.. candidates]);
    }
}
