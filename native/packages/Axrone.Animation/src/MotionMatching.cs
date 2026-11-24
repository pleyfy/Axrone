namespace Axrone.Animation;

/// <summary>Motion-matching query: desired trajectory and facing with tag filters.</summary>
public readonly record struct MotionMatchQuery(
    Vec3 TrajectoryPos,
    Vec3 FacingDirection,
    HashSet<string>? RequiredTags = null,
    HashSet<string>? ExcludedTags = null,
    float ContinuityBias = 0.0f,
    int ContinuityClipIndex = -1);

/// <summary>One searchable pose sample.</summary>
public readonly record struct MotionMatchCandidate(
    int ClipIndex,
    float Time,
    Vec3 TrajectoryPos,
    Vec3 FacingDirection,
    HashSet<string>? Tags,
    float CostBias = 0.0f);

/// <summary>
/// Linear motion-matching search: tag pre-filter, squared trajectory distance,
/// facing alignment cost, bias adjustments. Returns the best index or -1.
/// </summary>
public static class MotionMatching
{
    /// <summary>Searches candidates; reports the best score alongside the index.</summary>
    public static int Search(in MotionMatchQuery query, ReadOnlySpan<MotionMatchCandidate> candidates, out float bestScore)
    {
        int bestIndex = -1;
        bestScore = float.MaxValue;

        for (int i = 0; i < candidates.Length; i++)
        {
            if (!TryScore(in query, in candidates[i], out float score))
            {
                continue;
            }

            if (score < bestScore)
            {
                bestScore = score;
                bestIndex = i;
            }
        }

        return bestIndex;
    }

    /// <summary>
    /// Collects the best <paramref name="indices"/>.Length candidates in ascending
    /// score order without allocating. Returns the number written.
    /// </summary>
    public static int SearchK(
        in MotionMatchQuery query,
        ReadOnlySpan<MotionMatchCandidate> candidates,
        Span<int> indices,
        Span<float> scores)
    {
        int capacity = Math.Min(indices.Length, scores.Length);
        int count = 0;

        for (int i = 0; i < candidates.Length; i++)
        {
            if (!TryScore(in query, in candidates[i], out float score))
            {
                continue;
            }

            int insert = count;
            while (insert > 0 && score < scores[insert - 1])
            {
                insert--;
            }

            if (insert >= capacity)
            {
                continue;
            }

            int last = Math.Min(count, capacity - 1);
            for (int move = last; move > insert; move--)
            {
                scores[move] = scores[move - 1];
                indices[move] = indices[move - 1];
            }

            scores[insert] = score;
            indices[insert] = i;
            if (count < capacity)
            {
                count++;
            }
        }

        return count;
    }

    private static bool TryScore(in MotionMatchQuery query, in MotionMatchCandidate candidate, out float score)
    {
        score = float.MaxValue;

        if (query.RequiredTags != null && query.RequiredTags.Count > 0)
        {
            if (candidate.Tags == null || !query.RequiredTags.IsSubsetOf(candidate.Tags))
            {
                return false;
            }
        }

        if (query.ExcludedTags != null && query.ExcludedTags.Count > 0 && candidate.Tags != null)
        {
            if (candidate.Tags.Overlaps(query.ExcludedTags))
            {
                return false;
            }
        }

        float trajectoryDistSq = Vec3.DistanceSquared(query.TrajectoryPos, candidate.TrajectoryPos);

        float facingScore;
        float queryLen = query.FacingDirection.Length();
        float candidateLen = candidate.FacingDirection.Length();
        if (queryLen <= AnimationConstants.SoaEpsilon || candidateLen <= AnimationConstants.SoaEpsilon)
        {
            facingScore = AnimationConstants.MissingFacingPenalty;
        }
        else
        {
            float dot = Vec3.Dot(query.FacingDirection / queryLen, candidate.FacingDirection / candidateLen);
            facingScore = 1.0f - dot;
        }

        score = candidate.CostBias + trajectoryDistSq + facingScore;
        if (query.ContinuityBias != 0.0f && candidate.ClipIndex == query.ContinuityClipIndex)
        {
            score -= query.ContinuityBias;
        }

        return true;
    }
}
