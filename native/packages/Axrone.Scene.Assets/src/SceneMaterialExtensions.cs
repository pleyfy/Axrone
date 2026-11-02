namespace Axrone.Scene.Assets;

/// <summary>
/// Extension-driven surface parameters (clearcoat, sheen, transmission, volume, iridescence,
/// subsurface and specular). Texture references live on <see cref="SceneMaterialSurface"/>.
/// </summary>
public sealed class SceneMaterialExtensions
{
    /// <summary>Clearcoat layer weight in the zero-to-one range.</summary>
    public float Clearcoat { get; init; }

    /// <summary>Clearcoat roughness in the zero-to-one range.</summary>
    public float ClearcoatRoughness { get; init; }

    /// <summary>Clearcoat normal-map strength.</summary>
    public float ClearcoatNormalScale { get; init; } = 1.0f;

    /// <summary>Sheen color.</summary>
    public Vec3 SheenColor { get; init; } = Vec3.Zero;

    /// <summary>Sheen roughness in the zero-to-one range.</summary>
    public float SheenRoughness { get; init; } = 0.5f;

    /// <summary>Transmission weight in the zero-to-one range.</summary>
    public float Transmission { get; init; }

    /// <summary>Index of refraction; at least one.</summary>
    public float Ior { get; init; } = 1.5f;

    /// <summary>Volume thickness.</summary>
    public float Thickness { get; init; }

    /// <summary>Attenuation distance; zero means infinite.</summary>
    public float AttenuationDistance { get; init; }

    /// <summary>Attenuation color.</summary>
    public Vec3 AttenuationColor { get; init; } = Vec3.One;

    /// <summary>Iridescence weight in the zero-to-one range.</summary>
    public float Iridescence { get; init; }

    /// <summary>Iridescence index of refraction.</summary>
    public float IridescenceIor { get; init; } = 1.3f;

    /// <summary>Minimum iridescence thickness in nanometres.</summary>
    public float IridescenceThicknessMinimum { get; init; } = 100.0f;

    /// <summary>Maximum iridescence thickness in nanometres.</summary>
    public float IridescenceThicknessMaximum { get; init; } = 400.0f;

    /// <summary>Subsurface scattering weight in the zero-to-one range.</summary>
    public float Subsurface { get; init; }

    /// <summary>Subsurface scattering color.</summary>
    public Vec3 SubsurfaceColor { get; init; } = new Vec3(1.0f, 0.8f, 0.6f);

    /// <summary>Subsurface thickness.</summary>
    public float SubsurfaceThickness { get; init; } = 1.0f;

    /// <summary>Specular weight in the zero-to-one range.</summary>
    public float Specular { get; init; } = 1.0f;

    /// <summary>Specular color.</summary>
    public Vec3 SpecularColor { get; init; } = Vec3.One;

    /// <summary>Anisotropy strength in the minus-one-to-one range.</summary>
    public float Anisotropy { get; init; }

    /// <summary>Anisotropy rotation in radians.</summary>
    public float AnisotropyRotation { get; init; }

    internal void Validate()
    {
        ValidateUnit(Clearcoat, "Clearcoat");
        ValidateUnit(ClearcoatRoughness, "Clearcoat roughness");
        ValidateUnit(SheenRoughness, "Sheen roughness");
        ValidateUnit(Transmission, "Transmission");
        ValidateUnit(Iridescence, "Iridescence");
        ValidateUnit(Subsurface, "Subsurface");
        ValidateUnit(Specular, "Specular");
        ValidateFinite(ClearcoatNormalScale, "Clearcoat normal scale");
        ValidateFinite(Ior, "Index of refraction");
        ValidateFinite(Thickness, "Thickness");
        ValidateFinite(AttenuationDistance, "Attenuation distance");
        ValidateFinite(IridescenceIor, "Iridescence index of refraction");
        ValidateFinite(IridescenceThicknessMinimum, "Iridescence thickness minimum");
        ValidateFinite(IridescenceThicknessMaximum, "Iridescence thickness maximum");
        ValidateFinite(SubsurfaceThickness, "Subsurface thickness");
        ValidateFinite(Anisotropy, "Anisotropy");
        ValidateFinite(AnisotropyRotation, "Anisotropy rotation");
        ValidateFinite(SheenColor.X, SheenColor.Y, SheenColor.Z, "Sheen color");
        ValidateFinite(AttenuationColor.X, AttenuationColor.Y, AttenuationColor.Z, "Attenuation color");
        ValidateFinite(SubsurfaceColor.X, SubsurfaceColor.Y, SubsurfaceColor.Z, "Subsurface color");
        ValidateFinite(SpecularColor.X, SpecularColor.Y, SpecularColor.Z, "Specular color");

        if (ClearcoatNormalScale < 0.0f)
        {
            ThrowInvalid("Clearcoat normal scale must not be negative.");
        }

        if (Ior < 1.0f)
        {
            ThrowInvalid("Index of refraction must be at least one.");
        }

        if (IridescenceIor < 1.0f)
        {
            ThrowInvalid("Iridescence index of refraction must be at least one.");
        }

        if (Thickness < 0.0f || AttenuationDistance < 0.0f ||
            IridescenceThicknessMinimum < 0.0f || IridescenceThicknessMaximum < 0.0f ||
            SubsurfaceThickness < 0.0f)
        {
            ThrowInvalid("Extension thickness and attenuation values must not be negative.");
        }

        if (IridescenceThicknessMinimum > IridescenceThicknessMaximum)
        {
            ThrowInvalid("Iridescence thickness minimum must not exceed the maximum.");
        }

        if (Anisotropy is < -1.0f or > 1.0f)
        {
            ThrowInvalid("Anisotropy must be between minus one and one.");
        }
    }

    private static void ValidateUnit(float value, string name)
    {
        if (!float.IsFinite(value) || value is < 0.0f or > 1.0f)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"{name} must be between zero and one.");
        }
    }

    private static void ValidateFinite(float value, string name)
    {
        if (!float.IsFinite(value))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"{name} must be finite.");
        }
    }

    private static void ValidateFinite(float x, float y, float z, string name) =>
        ValidateFinite(new Vec3(x, y, z), name);

    private static void ValidateFinite(in Vec3 value, string name)
    {
        if (!float.IsFinite(value.X) || !float.IsFinite(value.Y) || !float.IsFinite(value.Z))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"{name} components must be finite.");
        }
    }

    [DoesNotReturn]
    private static void ThrowInvalid(string message) =>
        throw new SceneAssetException(SceneAssetErrorCodes.Invalid, message);
}
