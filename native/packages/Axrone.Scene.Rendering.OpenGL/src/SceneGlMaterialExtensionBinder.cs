namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>Features and maps bound by <see cref="SceneGlMaterialExtensionBinder"/>.</summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneMaterialExtensionBindings(
    bool Clearcoat,
    bool Sheen,
    bool Transmission,
    bool Iridescence,
    bool Subsurface,
    bool HasClearcoatMap,
    bool HasSheenMap,
    bool HasTransmissionMap,
    bool HasIridescenceMap,
    bool HasSubsurfaceMap);

/// <summary>
/// Binds extension scalar/color parameters and feature gates to the material
/// shader contract in <see cref="SceneGlShaderSnippets.MaterialExtensions"/>.
/// Missing extension data falls back to spec defaults; maps are only sampled
/// when both the feature and the map are present.
/// </summary>
public static class SceneGlMaterialExtensionBinder
{
    private const string ClearcoatEnabledUniform = "u_ClearcoatEnabled";
    private const string ClearcoatUniform = "u_Clearcoat";
    private const string ClearcoatRoughnessUniform = "u_ClearcoatRoughness";
    private const string ClearcoatNormalScaleUniform = "u_ClearcoatNormalScale";
    private const string HasClearcoatMapUniform = "u_HasClearcoatMap";
    private const string HasClearcoatRoughnessMapUniform = "u_HasClearcoatRoughnessMap";
    private const string HasClearcoatNormalMapUniform = "u_HasClearcoatNormalMap";

    private const string SheenEnabledUniform = "u_SheenEnabled";
    private const string SheenColorUniform = "u_SheenColor";
    private const string SheenRoughnessUniform = "u_SheenRoughness";
    private const string HasSheenColorMapUniform = "u_HasSheenColorMap";
    private const string HasSheenRoughnessMapUniform = "u_HasSheenRoughnessMap";

    private const string TransmissionEnabledUniform = "u_TransmissionEnabled";
    private const string TransmissionUniform = "u_Transmission";
    private const string IorUniform = "u_Ior";
    private const string ThicknessUniform = "u_Thickness";
    private const string AttenuationDistanceUniform = "u_AttenuationDistance";
    private const string AttenuationColorUniform = "u_AttenuationColor";
    private const string HasTransmissionMapUniform = "u_HasTransmissionMap";

    private const string IridescenceEnabledUniform = "u_IridescenceEnabled";
    private const string IridescenceUniform = "u_Iridescence";
    private const string IridescenceIorUniform = "u_IridescenceIor";
    private const string IridescenceMinimumUniform = "u_IridescenceThicknessMinimum";
    private const string IridescenceMaximumUniform = "u_IridescenceThicknessMaximum";
    private const string HasIridescenceMapUniform = "u_HasIridescenceMap";
    private const string HasIridescenceThicknessMapUniform = "u_HasIridescenceThicknessMap";

    private const string SubsurfaceEnabledUniform = "u_SubsurfaceEnabled";
    private const string SubsurfaceUniform = "u_Subsurface";
    private const string SubsurfaceColorUniform = "u_SubsurfaceColor";
    private const string SubsurfaceThicknessUniform = "u_SubsurfaceThickness";
    private const string HasSubsurfaceMapUniform = "u_HasSubsurfaceMap";

    private const string SpecularUniform = "u_Specular";
    private const string SpecularColorUniform = "u_SpecularColor";
    private const string AnisotropyUniform = "u_Anisotropy";
    private const string AnisotropyRotationUniform = "u_AnisotropyRotation";

    /// <summary>Binds extension state and returns which features/maps are active.</summary>
    public static SceneMaterialExtensionBindings Bind(SceneGlShader shader, SceneMaterialSurface surface)
    {
        ArgumentNullException.ThrowIfNull(shader);
        ArgumentNullException.ThrowIfNull(surface);

        SceneMaterialFeatures features = surface.Features;
        SceneMaterialExtensions? extensions = surface.Extensions;

        bool clearcoat = (features & SceneMaterialFeatures.Clearcoat) != 0;
        bool sheen = (features & SceneMaterialFeatures.Sheen) != 0;
        bool transmission = (features & SceneMaterialFeatures.Transmission) != 0;
        bool iridescence = (features & SceneMaterialFeatures.Iridescence) != 0;
        bool subsurface = (features & SceneMaterialFeatures.Subsurface) != 0;

        bool hasClearcoatMap = clearcoat && surface.ClearcoatMap is not null;
        bool hasClearcoatRoughnessMap = clearcoat && surface.ClearcoatRoughnessMap is not null;
        bool hasClearcoatNormalMap = clearcoat && surface.ClearcoatNormalMap is not null;
        bool hasSheenColorMap = sheen && surface.SheenColorMap is not null;
        bool hasSheenRoughnessMap = sheen && surface.SheenRoughnessMap is not null;
        bool hasTransmissionMap = transmission && surface.TransmissionMap is not null;
        bool hasIridescenceMap = iridescence && surface.IridescenceMap is not null;
        bool hasIridescenceThicknessMap = iridescence && surface.IridescenceThicknessMap is not null;
        bool hasSubsurfaceMap = subsurface && surface.SubsurfaceMap is not null;

        shader.SetInt(ClearcoatEnabledUniform, clearcoat ? 1 : 0);
        shader.SetInt(SheenEnabledUniform, sheen ? 1 : 0);
        shader.SetInt(TransmissionEnabledUniform, transmission ? 1 : 0);
        shader.SetInt(IridescenceEnabledUniform, iridescence ? 1 : 0);
        shader.SetInt(SubsurfaceEnabledUniform, subsurface ? 1 : 0);

        shader.SetInt(HasClearcoatMapUniform, hasClearcoatMap ? 1 : 0);
        shader.SetInt(HasClearcoatRoughnessMapUniform, hasClearcoatRoughnessMap ? 1 : 0);
        shader.SetInt(HasClearcoatNormalMapUniform, hasClearcoatNormalMap ? 1 : 0);
        shader.SetInt(HasSheenColorMapUniform, hasSheenColorMap ? 1 : 0);
        shader.SetInt(HasSheenRoughnessMapUniform, hasSheenRoughnessMap ? 1 : 0);
        shader.SetInt(HasTransmissionMapUniform, hasTransmissionMap ? 1 : 0);
        shader.SetInt(HasIridescenceMapUniform, hasIridescenceMap ? 1 : 0);
        shader.SetInt(HasIridescenceThicknessMapUniform, hasIridescenceThicknessMap ? 1 : 0);
        shader.SetInt(HasSubsurfaceMapUniform, hasSubsurfaceMap ? 1 : 0);

        float clearcoatValue = extensions?.Clearcoat ?? 0.0f;
        float clearcoatRoughness = extensions?.ClearcoatRoughness ?? 0.0f;
        float clearcoatNormalScale = extensions?.ClearcoatNormalScale ?? 1.0f;
        Vec3 sheenColor = extensions?.SheenColor ?? Vec3.Zero;
        float sheenRoughness = extensions?.SheenRoughness ?? 0.5f;
        float transmissionValue = extensions?.Transmission ?? 0.0f;
        float ior = extensions?.Ior ?? 1.5f;
        float thickness = extensions?.Thickness ?? 0.0f;
        float attenuationDistance = extensions?.AttenuationDistance ?? 0.0f;
        Vec3 attenuationColor = extensions?.AttenuationColor ?? Vec3.One;
        float iridescenceValue = extensions?.Iridescence ?? 0.0f;
        float iridescenceIor = extensions?.IridescenceIor ?? 1.3f;
        float iridescenceMinimum = extensions?.IridescenceThicknessMinimum ?? 100.0f;
        float iridescenceMaximum = extensions?.IridescenceThicknessMaximum ?? 400.0f;
        float subsurfaceValue = extensions?.Subsurface ?? 0.0f;
        Vec3 subsurfaceColor = extensions?.SubsurfaceColor ?? new Vec3(1.0f, 0.8f, 0.6f);
        float subsurfaceThickness = extensions?.SubsurfaceThickness ?? 1.0f;
        float specular = extensions?.Specular ?? 1.0f;
        Vec3 specularColor = extensions?.SpecularColor ?? Vec3.One;
        float anisotropy = extensions?.Anisotropy ?? 0.0f;
        float anisotropyRotation = extensions?.AnisotropyRotation ?? 0.0f;

        shader.SetFloat(ClearcoatUniform, clearcoatValue);
        shader.SetFloat(ClearcoatRoughnessUniform, clearcoatRoughness);
        shader.SetFloat(ClearcoatNormalScaleUniform, clearcoatNormalScale);
        shader.SetVec3(SheenColorUniform, in sheenColor);
        shader.SetFloat(SheenRoughnessUniform, sheenRoughness);
        shader.SetFloat(TransmissionUniform, transmissionValue);
        shader.SetFloat(IorUniform, ior);
        shader.SetFloat(ThicknessUniform, thickness);
        shader.SetFloat(AttenuationDistanceUniform, attenuationDistance);
        shader.SetVec3(AttenuationColorUniform, in attenuationColor);
        shader.SetFloat(IridescenceUniform, iridescenceValue);
        shader.SetFloat(IridescenceIorUniform, iridescenceIor);
        shader.SetFloat(IridescenceMinimumUniform, iridescenceMinimum);
        shader.SetFloat(IridescenceMaximumUniform, iridescenceMaximum);
        shader.SetFloat(SubsurfaceUniform, subsurfaceValue);
        shader.SetVec3(SubsurfaceColorUniform, in subsurfaceColor);
        shader.SetFloat(SubsurfaceThicknessUniform, subsurfaceThickness);
        shader.SetFloat(SpecularUniform, specular);
        shader.SetVec3(SpecularColorUniform, in specularColor);
        shader.SetFloat(AnisotropyUniform, anisotropy);
        shader.SetFloat(AnisotropyRotationUniform, anisotropyRotation);

        return new SceneMaterialExtensionBindings(
            clearcoat,
            sheen,
            transmission,
            iridescence,
            subsurface,
            hasClearcoatMap,
            hasSheenColorMap || hasSheenRoughnessMap,
            hasTransmissionMap,
            hasIridescenceMap || hasIridescenceThicknessMap,
            hasSubsurfaceMap);
    }
}
