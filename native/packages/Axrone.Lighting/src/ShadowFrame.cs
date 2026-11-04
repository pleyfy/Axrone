namespace Axrone.Lighting;

/// <summary>
/// One reusable cascade frame snapshot. The arrays are allocated once and
/// overwritten in place, so a steady-state shadow update performs no managed
/// allocation. The object is mutable and not thread-safe: one render thread
/// writes it, then material binders read it.
/// </summary>
public sealed class ShadowFrameData
{
    private readonly Mat4[] _lightViewProjections;
    private readonly float[] _splitDepths;
    private readonly Vec4[] _atlasTiles;

    /// <summary>Creates an empty four-cascade snapshot.</summary>
    public ShadowFrameData()
    {
        _lightViewProjections = new Mat4[ShadowCascadeCounts.MaxCount];
        _splitDepths = new float[ShadowCascadeCounts.MaxCount];
        _atlasTiles = new Vec4[ShadowCascadeCounts.MaxCount];
        Reset();
    }

    /// <summary>Settings that produced the current frame.</summary>
    public ShadowSettings Settings { get; private set; }

    /// <summary>Number of cascades populated by the builder.</summary>
    public int ActiveCascadeCount { get; private set; }

    /// <summary>Atlas width in pixels.</summary>
    public int AtlasWidth { get; private set; }

    /// <summary>Atlas height in pixels.</summary>
    public int AtlasHeight { get; private set; }

    /// <summary>Whether this frame should sample the shadow map.</summary>
    public bool IsEnabled => Settings.Enabled && ActiveCascadeCount > 0;

    /// <summary>Selected shadow filter.</summary>
    public ShadowFilterMode Filter => Settings.Filter;

    /// <summary>Selected bias.</summary>
    public ShadowBias Bias => Settings.Bias;

    /// <summary>Maximum shadowed view distance.</summary>
    public float MaxDistance => Settings.MaxDistance;

    /// <summary>One atlas texel in UV space.</summary>
    public Vec2 AtlasTexelSize { get; private set; }

    /// <summary>Active cascade matrices.</summary>
    public ReadOnlySpan<Mat4> LightViewProjections => _lightViewProjections.AsSpan(0, ActiveCascadeCount);

    /// <summary>Active cascade far boundaries.</summary>
    public ReadOnlySpan<float> SplitDepths => _splitDepths.AsSpan(0, ActiveCascadeCount);

    /// <summary>Active atlas tiles: origin.xy and scale.zw.</summary>
    public ReadOnlySpan<Vec4> AtlasTiles => _atlasTiles.AsSpan(0, ActiveCascadeCount);

    /// <summary>Reads one of the four backing cascade matrices.</summary>
    public Mat4 GetLightViewProjection(int index)
    {
        ValidateBackingIndex(index);
        return _lightViewProjections[index];
    }

    /// <summary>Reads one of the four split boundaries; inactive slots return infinity.</summary>
    public float GetSplitDepth(int index)
    {
        ValidateBackingIndex(index);
        return _splitDepths[index];
    }

    /// <summary>Reads one of the four atlas tiles.</summary>
    public Vec4 GetAtlasTile(int index)
    {
        ValidateBackingIndex(index);
        return _atlasTiles[index];
    }

    /// <summary>Applies settings and atlas geometry, then clears populated cascade count.</summary>
    /// <param name="settings">Validated shadow configuration.</param>
    /// <param name="atlasWidth">Atlas width.</param>
    /// <param name="atlasHeight">Atlas height.</param>
    public void ApplySettings(in ShadowSettings settings, int atlasWidth, int atlasHeight)
    {
        if (!ShadowCascadeCounts.IsValid(settings.CascadeCount))
        {
            ThrowHelper.ThrowShadowValidation("Shadow cascades must be exactly 1, 2, or 4.");
        }

        if (atlasWidth <= 0 || atlasHeight <= 0)
        {
            ThrowHelper.ThrowShadowValidation("Shadow atlas dimensions must be positive.");
        }

        Settings = settings;
        AtlasWidth = atlasWidth;
        AtlasHeight = atlasHeight;
        AtlasTexelSize = new Vec2(1.0f / atlasWidth, 1.0f / atlasHeight);
        ActiveCascadeCount = ShadowCascadeCounts.ToCount(settings.CascadeCount);
        ClearCascades();
    }

    /// <summary>Stores one populated cascade, its split, and atlas tile.</summary>
    /// <param name="index">Zero-based active cascade index.</param>
    /// <param name="lightViewProjection">Light-space clip matrix.</param>
    /// <param name="splitDepth">Far boundary in camera view distance.</param>
    /// <param name="atlasTile">Origin.xy and scale.zw in atlas UV space.</param>
    public void SetCascade(int index, in Mat4 lightViewProjection, float splitDepth, in Vec4 atlasTile)
    {
        ValidateActiveIndex(index);

        if (!LightingGuards.IsFinite(splitDepth) || splitDepth < 0.0f)
        {
            ThrowHelper.ThrowShadowValidation("Cascade split depth must be non-negative and finite.");
        }

        if (!lightViewProjection.IsAllFinite)
        {
            ThrowHelper.ThrowShadowValidation("Cascade light-space matrix contains NaN.");
        }

        if (!Finite(atlasTile))
        {
            ThrowHelper.ThrowShadowValidation("Atlas tile values must be finite.");
        }

        _lightViewProjections[index] = lightViewProjection;
        _splitDepths[index] = splitDepth;
        _atlasTiles[index] = atlasTile;
    }

    /// <summary>Resets all geometry and cascades to a safe empty state.</summary>
    public void Reset()
    {
        Settings = ShadowSettings.Disabled;
        ActiveCascadeCount = 0;
        AtlasWidth = 0;
        AtlasHeight = 0;
        AtlasTexelSize = default;
        ClearCascades();
    }

    private void ClearCascades()
    {
        for (int i = 0; i < _lightViewProjections.Length; i++)
        {
            _lightViewProjections[i] = Mat4.Identity;
            _splitDepths[i] = float.MaxValue;
            _atlasTiles[i] = new Vec4(0.0f, 0.0f, 0.0f, 0.0f);
        }
    }

    private void ValidateActiveIndex(int index)
    {
        if (index < 0 || index >= ActiveCascadeCount)
        {
            ThrowHelper.ThrowShadowValidation($"Cascade index {index} is outside the active count {ActiveCascadeCount}.");
        }
    }

    private static void ValidateBackingIndex(int index)
    {
        if (index < 0 || index >= ShadowCascadeCounts.MaxCount)
        {
            ThrowHelper.ThrowShadowValidation($"Shadow backing index {index} is outside 0..{ShadowCascadeCounts.MaxCount - 1}.");
        }
    }

    private static bool Finite(in Vec4 value) =>
        LightingGuards.IsFinite(value.X) &&
        LightingGuards.IsFinite(value.Y) &&
        LightingGuards.IsFinite(value.Z) &&
        LightingGuards.IsFinite(value.W);
}

/// <summary>Deterministic cascade split calculation.</summary>
public static class ShadowSplits
{
    /// <summary>Smallest accepted camera distance used in split calculation.</summary>
    public const float MinDistance = 0.001f;

    /// <summary>Minimum distance between adjacent planes.</summary>
    public const float MinSpan = 0.001f;

    /// <summary>
    /// Computes cascade far boundaries. The result is the same blend of uniform
    /// and logarithmic spacing used by the TS renderer, but expressed as C#
    /// finite checks and spans instead of object allocations.
    /// </summary>
    /// <param name="near">Camera near plane.</param>
    /// <param name="far">Camera far plane.</param>
    /// <param name="cascadeCount">1, 2, or 4.</param>
    /// <param name="lambda">0 selects logarithmic splits; 1 selects uniform splits.</param>
    /// <param name="maxDistance">Distance limit for the last cascade.</param>
    /// <param name="destination">Receives active boundaries; remaining slots are set to infinity.</param>
    /// <exception cref="LightingValidationException">An input is invalid or the span is too small.</exception>
    public static void Compute(
        float near,
        float far,
        ShadowCascadeCount cascadeCount,
        float lambda,
        float maxDistance,
        Span<float> destination)
    {
        int count = ShadowCascadeCounts.ToCount(cascadeCount);
        if (destination.Length < count)
        {
            ThrowHelper.ThrowShadowValidation(
                $"Cascade split destination must hold {count} values.");
        }

        if (!LightingGuards.IsFinite(near) || near <= 0.0f)
        {
            ThrowHelper.ThrowShadowValidation("Shadow near distance must be positive and finite.");
        }

        if (!LightingGuards.IsFinite(far) || far <= near)
        {
            ThrowHelper.ThrowShadowValidation("Shadow far distance must be finite and greater than near.");
        }

        if (!LightingGuards.IsFinite(maxDistance) || maxDistance < 1.0f)
        {
            ThrowHelper.ThrowShadowValidation("Shadow maximum distance must be at least one and finite.");
        }

        if (!LightingGuards.IsFinite(lambda))
        {
            ThrowHelper.ThrowShadowValidation("Cascade split lambda must be finite.");
        }

        float clampedNear = MathF.Max(MinDistance, near);
        float clampedFar = MathF.Max(clampedNear + MinSpan, MathF.Min(far, maxDistance));
        float clampedLambda = Math.Clamp(lambda, 0.0f, 1.0f);
        float previous = clampedNear;

        for (int i = 1; i <= count; i++)
        {
            float ratio = i / (float)count;
            float logarithmic = clampedNear * MathF.Pow(clampedFar / clampedNear, ratio);
            float uniform = clampedNear + ((clampedFar - clampedNear) * ratio);
            float split = uniform + ((logarithmic - uniform) * clampedLambda);
            float current = i == count
                ? clampedFar
                : Math.Clamp(split, previous, clampedFar);

            destination[i - 1] = current;
            previous = current;
        }

        for (int i = count; i < destination.Length; i++)
        {
            destination[i] = float.MaxValue;
        }
    }
}

/// <summary>Shadow atlas tile layout.</summary>
public static class ShadowAtlasLayout
{
    /// <summary>Gets the origin/scale of one cascade tile in atlas UV space.</summary>
    /// <param name="cascadeCount">Supported cascade count.</param>
    /// <param name="index">Zero-based cascade index.</param>
    /// <returns>Vector whose xy is origin and zw is tile scale.</returns>
    /// <exception cref="LightingValidationException">The count or index is unsupported.</exception>
    public static Vec4 GetTile(ShadowCascadeCount cascadeCount, int index)
    {
        int count = ShadowCascadeCounts.ToCount(cascadeCount);
        (int columns, int rows) = ShadowCascadeCounts.ToGrid(cascadeCount);
        if (index < 0 || index >= count)
        {
            ThrowHelper.ThrowShadowValidation($"Cascade index {index} is outside 0..{count - 1}.");
        }

        int column = index % columns;
        int row = index / columns;
        float scaleX = 1.0f / columns;
        float scaleY = 1.0f / rows;
        return new Vec4(column * scaleX, row * scaleY, scaleX, scaleY);
    }
}
