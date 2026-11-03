namespace Axrone.Lighting;

/// <summary>
/// Height-fog configuration. The density controls optical thickness, while the
/// falloff describes how rapidly density decreases with altitude above the
/// configured ground plane.
/// </summary>
public readonly record struct HeightFogSettings
{
    /// <summary>Disabled default height fog.</summary>
    public static readonly HeightFogSettings Disabled = new(false, null, 0.0f, 0.0f, 0.0f);

    /// <summary>Enabled fog matching the TS volumetric defaults.</summary>
    public static readonly HeightFogSettings Default = new(
        true,
        new Vec3(0.533f, 0.6f, 0.667f),
        0.02f,
        0.1f,
        0.0f);

    /// <summary>Minimum accepted density or falloff epsilon.</summary>
    public const float Epsilon = 1e-6f;

    /// <summary>Whether height fog is applied.</summary>
    public readonly bool Enabled;

    /// <summary>Scattering color.</summary>
    public readonly Vec3 Color;

    /// <summary>Density at ground height.</summary>
    public readonly float Density;

    /// <summary>Vertical density falloff in inverse world units.</summary>
    public readonly float Falloff;

    /// <summary>Altitude where density equals <see cref="Density"/>.</summary>
    public readonly float GroundHeight;

    /// <summary>Creates normalized settings.</summary>
    public HeightFogSettings(
        bool enabled,
        Vec3? color = null,
        float density = 0.0f,
        float falloff = 0.0f,
        float groundHeight = 0.0f)
    {
        Vec3 resolvedColor = color ?? new Vec3(0.533f, 0.6f, 0.667f);
        if (!LightingGuards.IsFinite(resolvedColor) || !LightingGuards.IsFinite(groundHeight))
        {
            ThrowHelper.ThrowShadowValidation("Height-fog color and ground height must be finite.");
        }

        if (!LightingGuards.IsFinite(density) || !LightingGuards.IsFinite(falloff))
        {
            ThrowHelper.ThrowShadowValidation("Height-fog density and falloff must be finite.");
        }

        Enabled = enabled;
        Color = resolvedColor;
        Density = MathF.Max(0.0f, density);
        Falloff = MathF.Max(0.0f, falloff);
        GroundHeight = groundHeight;
    }
}

/// <summary>
/// Shared CPU formula for the GLSL height fog. The renderer binds the same
/// numeric values; neither side carries an independent approximation, so fog
/// distance tests remain comparable with shader output.
/// </summary>
public static class HeightFogModel
{
    /// <summary>Clamps exponents to the largest stable single-precision range used by the shader.</summary>
    public const float MaxExponent = 80.0f;

    /// <summary>Computes optical depth along the camera-to-fragment ray.</summary>
    /// <param name="cameraPosition">World-space camera position.</param>
    /// <param name="fragmentPosition">World-space fragment position.</param>
    /// <param name="settings">Validated height-fog settings.</param>
    /// <returns>Non-negative optical depth.</returns>
    public static float OpticalDepth(
        in Vec3 cameraPosition,
        in Vec3 fragmentPosition,
        in HeightFogSettings settings)
    {
        if (!settings.Enabled || settings.Density < HeightFogSettings.Epsilon)
        {
            return 0.0f;
        }

        Vec3 delta = fragmentPosition - cameraPosition;
        float distance = delta.Length();
        if (distance < HeightFogSettings.Epsilon)
        {
            return 0.0f;
        }

        float rayVertical = delta.Y / distance;
        float verticalRatio = SteepRatio(rayVertical * distance, settings.Falloff);
        float height = ClampExponent(cameraPosition.Y - settings.GroundHeight, settings.Falloff);
        float densityAtCamera = settings.Density * MathF.Exp(-height);
        float opticalDepth = densityAtCamera * distance * verticalRatio;
        return MathF.Max(0.0f, opticalDepth);
    }

    /// <summary>Converts optical depth to a [0,1] scattering fraction.</summary>
    public static float Factor(
        in Vec3 cameraPosition,
        in Vec3 fragmentPosition,
        in HeightFogSettings settings)
    {
        float opticalDepth = OpticalDepth(in cameraPosition, in fragmentPosition, in settings);
        float factor = 1.0f - MathF.Exp(-MathF.Min(opticalDepth, MaxExponent));
        return Math.Clamp(factor, 0.0f, 1.0f);
    }

    /// <summary>
    /// Stable evaluation of <c>(1 - exp(-x)) / x</c>. The Taylor branch removes
    /// cancellation for small slopes and matches the GLSL implementation.
    /// </summary>
    public static float SteepRatio(float x, float falloff)
    {
        if (falloff < HeightFogSettings.Epsilon)
        {
            return 1.0f;
        }

        float product = x * falloff;
        if (MathF.Abs(product) < 1e-4f)
        {
            float product2 = product * product;
            return 1.0f - (product * 0.5f) + (product2 / 6.0f) - (product2 * product / 24.0f);
        }

        float clamped = Math.Clamp(product, -MaxExponent, MaxExponent);
        return (1.0f - MathF.Exp(-clamped)) / clamped;
    }

    /// <summary>Clamps a height term so single-precision exp remains finite.</summary>
    public static float ClampExponent(float value, float falloff)
    {
        if (falloff < HeightFogSettings.Epsilon)
        {
            return 0.0f;
        }

        float limit = MaxExponent / falloff;
        return Math.Clamp(value, -limit, limit);
    }
}
