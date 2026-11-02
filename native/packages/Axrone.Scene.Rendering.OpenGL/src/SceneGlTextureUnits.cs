namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>
/// Scene texture-unit layout shared by material maps and dedicated renderer
/// resources. Material maps may use units zero through thirteen; units fourteen
/// and fifteen are reserved for reflection probes and skinning bone data.
/// </summary>
public static class SceneGlTextureUnits
{
    /// <summary>First material texture unit.</summary>
    public const int BaseFirst = 0;

    /// <summary>Last standard material texture unit.</summary>
    public const int BaseLast = 4;

    /// <summary>First material-extension texture unit.</summary>
    public const int MaterialExtensionFirst = 5;

    /// <summary>Last material-extension texture unit.</summary>
    public const int MaterialExtensionLast = 13;

    /// <summary>Reflection-probe cubemap unit.</summary>
    public const int ReflectionProbe = SceneGlReflectionProbeBinder.TextureUnit;

    /// <summary>Skinning bone-texture unit.</summary>
    public const int Skinning = SceneGlSkinnedMeshRenderer.DefaultTextureUnit;

    /// <summary>Number of texture units owned by the scene renderer.</summary>
    public const int SceneUnitCount = 16;

    /// <summary>Whether a unit belongs to the material-extension range.</summary>
    public static bool IsMaterialExtensionUnit(int unit) =>
        (uint)(unit - MaterialExtensionFirst) <= MaterialExtensionLast - MaterialExtensionFirst;

    /// <summary>Whether a unit is reserved for a dedicated renderer resource.</summary>
    public static bool IsReservedUnit(int unit) => unit is ReflectionProbe or Skinning;

    /// <summary>
    /// Validates one material texture slot against the scene unit layout.
    /// Throws a <see cref="SceneAssetException"/> for out-of-range, reserved or
    /// extension-map units so conflicts fail during upload instead of at draw.
    /// </summary>
    public static void ValidateMaterialSlot(
        int unit,
        bool extension,
        string uniformName,
        SceneAssetId<MaterialAssetTag> materialId)
    {
        if ((uint)unit >= SceneUnitCount)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Material '{materialId}' texture '{uniformName}' uses texture unit {unit}; " +
                $"scene materials support units {BaseFirst}-{MaterialExtensionLast}.");
        }

        if (IsReservedUnit(unit))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Material '{materialId}' texture '{uniformName}' uses reserved texture unit {unit} " +
                $"({ReflectionProbe}: reflection probe, {Skinning}: skinning).");
        }

        if (extension && !IsMaterialExtensionUnit(unit))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Material '{materialId}' extension texture '{uniformName}' uses texture unit {unit}; " +
                $"extension maps must stay within {MaterialExtensionFirst}-{MaterialExtensionLast}.");
        }
    }
}
