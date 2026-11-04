namespace Axrone.Lighting;

/// <summary>
/// Depth and normal offsets used when comparing a receiver to the shadow map.
/// Negative values clamp to zero, matching the authoring contract; non-finite
/// values are refused so a single bad setting cannot poison an entire frame.
/// </summary>
public readonly record struct ShadowBias
{
    /// <summary>Depth-map offset.</summary>
    public readonly float Depth;

    /// <summary>World-space normal offset.</summary>
    public readonly float Normal;

    /// <summary>Default engine bias: conservative depth bias and a quarter-unit normal offset.</summary>
    public static readonly ShadowBias Default = new(0.0015f, 0.25f);

    /// <summary>No bias.</summary>
    public static readonly ShadowBias None;

    /// <summary>Creates a shadow bias pair.</summary>
    /// <param name="depth">Depth offset; negative values clamp to zero.</param>
    /// <param name="normal">Normal-space offset; negative values clamp to zero.</param>
    /// <exception cref="LightingValidationException">Either offset is non-finite.</exception>
    public ShadowBias(float depth, float normal)
    {
        if (!LightingGuards.IsFinite(depth) || !LightingGuards.IsFinite(normal))
        {
            ThrowHelper.ThrowShadowValidation("Shadow bias must be finite.");
        }

        Depth = MathF.Max(0.0f, depth);
        Normal = MathF.Max(0.0f, normal);
    }
}

/// <summary>Validated shadow-map rasterization and sampling configuration.</summary>
public readonly record struct ShadowSettings
{
    /// <summary>Default enabled four-cascade PCF configuration.</summary>
    public static readonly ShadowSettings Default = new(
        true,
        4096,
        ShadowCascadeCount.Four,
        0.7f,
        3,
        150.0f,
        ShadowBias.Default);

    /// <summary>Same defaults, ready to opt in.</summary>
    public static readonly ShadowSettings Disabled = new(
        false,
        4096,
        ShadowCascadeCount.Four,
        0.7f,
        3,
        150.0f,
        ShadowBias.Default);

    /// <summary>Minimum supported atlas edge.</summary>
    public const int MinAtlasSize = 512;

    /// <summary>Whether shadow-map generation and sampling are active.</summary>
    public readonly bool Enabled;

    /// <summary>Atlas edge length in pixels.</summary>
    public readonly int AtlasSize;

    /// <summary>Cascade count, exactly 1, 2, or 4.</summary>
    public readonly ShadowCascadeCount CascadeCount;

    /// <summary>Blend between uniform and logarithmic cascade splits, from 0 to 1.</summary>
    public readonly float CascadeSplitLambda;

    /// <summary>Upper bound on shadowed directional lights per frame.</summary>
    public readonly int MaxShadowedLights;

    /// <summary>Maximum camera view distance covered by the cascade chain.</summary>
    public readonly float MaxDistance;

    /// <summary>Depth and normal bias.</summary>
    public readonly ShadowBias Bias;

    /// <summary>Shadow sampling filter.</summary>
    public readonly ShadowFilterMode Filter;

    /// <summary>Creates settings while normalizing finite ranges.</summary>
    /// <exception cref="LightingValidationException">An enum or non-range float is invalid.</exception>
    public ShadowSettings(
        bool enabled,
        int atlasSize = 4096,
        ShadowCascadeCount cascadeCount = ShadowCascadeCount.Four,
        float cascadeSplitLambda = 0.7f,
        int maxShadowedLights = 3,
        float maxDistance = 150.0f,
        ShadowBias bias = default,
        ShadowFilterMode filter = ShadowFilterMode.Pcf)
    {
        if (!ShadowCascadeCounts.IsValid(cascadeCount))
        {
            ThrowHelper.ThrowShadowValidation("Shadow cascades must be exactly 1, 2, or 4.");
        }

        if (!ShadowFilterModes.IsValid(filter))
        {
            ThrowHelper.ThrowShadowValidation("Unsupported shadow filter mode.");
        }

        if (!LightingGuards.IsFinite(cascadeSplitLambda))
        {
            ThrowHelper.ThrowShadowValidation("Cascade split lambda must be finite.");
        }

        if (!LightingGuards.IsFinite(maxDistance) || maxDistance < 1.0f)
        {
            ThrowHelper.ThrowShadowValidation("Maximum shadow distance must be at least one and finite.");
        }

        Enabled = enabled;
        AtlasSize = Math.Max(MinAtlasSize, atlasSize);
        CascadeCount = cascadeCount;
        CascadeSplitLambda = Math.Clamp(cascadeSplitLambda, 0.0f, 1.0f);
        MaxShadowedLights = Math.Max(1, maxShadowedLights);
        MaxDistance = maxDistance;
        Bias = bias;
        Filter = filter;
    }
}
