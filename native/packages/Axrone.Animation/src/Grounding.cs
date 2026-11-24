namespace Axrone.Animation;

using Axrone.Numeric;

/// <summary>Axes a grounding solve is allowed to move the root on.</summary>
[Flags]
public enum GroundingAxes
{
    /// <summary>No axis may move.</summary>
    None = 0,

    /// <summary>Allow horizontal X correction.</summary>
    X = 1,

    /// <summary>Allow vertical Y correction.</summary>
    Y = 2,

    /// <summary>Allow horizontal Z correction.</summary>
    Z = 4,

    /// <summary>Vertical only, the common foot-planting case.</summary>
    Vertical = Y,

    /// <summary>Allow all axes.</summary>
    All = X | Y | Z,
}

/// <summary>Contact-weighted root grounding over world-space foot positions.</summary>
public static class GroundingSystem
{
    /// <summary>Computes the root Y offset that plants the weighted contacts on the ground.</summary>
    public static float ComputeRootYOffset(ReadOnlySpan<FootContact> contacts, ReadOnlySpan<float> contactHeights, float targetGroundHeight, float time)
    {
        float totalWeight = 0.0f;
        float totalOffset = 0.0f;

        for (int i = 0; i < contacts.Length; i++)
        {
            float weight = contacts[i].EvaluateWeight(time);
            if (weight > 0.0f)
            {
                float boneHeight = i < contactHeights.Length ? contactHeights[i] : 0.0f;
                totalOffset += (targetGroundHeight - boneHeight) * weight;
                totalWeight += weight;
            }
        }

        return totalWeight > AnimationConstants.SoaEpsilon ? totalOffset / totalWeight : 0.0f;
    }

    /// <summary>
    /// Computes a contact-weighted root offset on the allowed axes. Disabled axes
    /// stay exactly zero, so a character controller can keep horizontal motion
    /// while the feet plant vertically.
    /// </summary>
    /// <param name="contacts">Authored foot-contact windows.</param>
    /// <param name="contactPositions">World-space contact positions aligned with <paramref name="contacts"/>.</param>
    /// <param name="targetGround">World-space point the contacts should reach.</param>
    /// <param name="time">Clip time used to evaluate contact weights.</param>
    /// <param name="axes">Axes the solve may write.</param>
    /// <returns>Root-space offset; zero on disabled or unsupported axes.</returns>
    public static Vec3 ComputeRootOffset(
        ReadOnlySpan<FootContact> contacts,
        ReadOnlySpan<Vec3> contactPositions,
        in Vec3 targetGround,
        float time,
        GroundingAxes axes = GroundingAxes.Vertical)
    {
        float totalWeight = 0.0f;
        Vec3 totalOffset = Vec3.Zero;

        int count = Math.Min(contacts.Length, contactPositions.Length);
        for (int i = 0; i < count; i++)
        {
            float weight = contacts[i].EvaluateWeight(time);
            if (weight <= 0.0f)
            {
                continue;
            }

            Vec3 offset = targetGround - contactPositions[i];
            totalOffset += offset * weight;
            totalWeight += weight;
        }

        if (totalWeight <= AnimationConstants.SoaEpsilon || axes == GroundingAxes.None)
        {
            return Vec3.Zero;
        }

        Vec3 average = totalOffset / totalWeight;
        return new Vec3(
            (axes & GroundingAxes.X) != 0 ? average.X : 0.0f,
            (axes & GroundingAxes.Y) != 0 ? average.Y : 0.0f,
            (axes & GroundingAxes.Z) != 0 ? average.Z : 0.0f);
    }
}
