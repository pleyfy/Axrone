namespace Axrone.Scene.Gltf;

using System.Collections.Frozen;

/// <summary>Uniform data type used by a glTF shader property.</summary>
public enum SceneGltfShaderPropertyType
{
    /// <summary>Single-precision scalar.</summary>
    Float = 0,

    /// <summary>Signed integer.</summary>
    Int = 1,

    /// <summary>Boolean encoded as an integer at the backend boundary.</summary>
    Bool = 2,

    /// <summary>Two-component vector.</summary>
    Vec2 = 3,

    /// <summary>Three-component vector.</summary>
    Vec3 = 4,

    /// <summary>Four-component vector.</summary>
    Vec4 = 5,

    /// <summary>Four-by-four matrix.</summary>
    Mat4 = 6,

    /// <summary>Two-dimensional texture sampler.</summary>
    Sampler2D = 7
}

/// <summary>Pipeline stage that consumes a shader property.</summary>
[Flags]
public enum SceneGltfShaderStage
{
    /// <summary>No stage consumes the property.</summary>
    None = 0,

    /// <summary>Vertex stage input.</summary>
    Vertex = 1,

    /// <summary>Fragment stage input.</summary>
    Fragment = 2
}

/// <summary>Owner responsible for supplying a shader property value.</summary>
public enum SceneGltfShaderScope
{
    /// <summary>Supplied by the material.</summary>
    Material = 0,

    /// <summary>Supplied per draw object.</summary>
    Object = 1,

    /// <summary>Supplied per camera.</summary>
    Camera = 2,

    /// <summary>Supplied per frame.</summary>
    Frame = 3,

    /// <summary>Supplied by engine system state.</summary>
    System = 4
}

/// <summary>
/// Declared shader property. Properties are ordered as they appear in the
/// shader source, so <see cref="SceneShaderDefinition.Uniforms"/> stays
/// deterministic across imports.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneGltfShaderProperty(
    string Name,
    SceneGltfShaderPropertyType Type,
    SceneGltfShaderStage Stages,
    SceneGltfShaderScope Scope,
    int ArrayLength = 0)
{
    /// <summary>Whether the property declares a fixed-size array.</summary>
    public bool IsArray => ArrayLength > 0;
}

/// <summary>Texture usage and its uniform prefix.</summary>
internal readonly record struct SceneGltfTextureUniformSpec(
    GltfTextureUsage Usage,
    string UniformName,
    bool HasScale,
    bool HasStrength);

/// <summary>
/// Declared property catalogs for the built-in glTF shaders. The PBR catalog is
/// a superset of every glTF material property the importer can emit, so it is
/// also the authority used by the unknown-property policy.
/// </summary>
public static class SceneGltfShaderProperties
{
    internal static readonly SceneGltfTextureUniformSpec[] TextureUniformSpecArray =
    [
        new(GltfTextureUsage.BaseColor, "_BaseColorTexture", false, false),
        new(GltfTextureUsage.MetallicRoughness, "_MetallicRoughnessTexture", false, false),
        new(GltfTextureUsage.Normal, "_NormalTexture", true, false),
        new(GltfTextureUsage.Occlusion, "_OcclusionTexture", false, true),
        new(GltfTextureUsage.Emissive, "_EmissiveTexture", false, false),
        new(GltfTextureUsage.Clearcoat, "_ClearcoatTexture", false, false),
        new(GltfTextureUsage.ClearcoatRoughness, "_ClearcoatRoughnessTexture", false, false),
        new(GltfTextureUsage.ClearcoatNormal, "_ClearcoatNormalTexture", true, false),
        new(GltfTextureUsage.Specular, "_SpecularTexture", false, false),
        new(GltfTextureUsage.SpecularColor, "_SpecularColorTexture", false, false),
        new(GltfTextureUsage.SheenColor, "_SheenColorTexture", false, false),
        new(GltfTextureUsage.SheenRoughness, "_SheenRoughnessTexture", false, false),
        new(GltfTextureUsage.Transmission, "_TransmissionTexture", false, false),
        new(GltfTextureUsage.Thickness, "_ThicknessTexture", false, false),
        new(GltfTextureUsage.Iridescence, "_IridescenceTexture", false, false),
        new(GltfTextureUsage.IridescenceThickness, "_IridescenceThicknessTexture", false, false),
        new(GltfTextureUsage.Anisotropy, "_AnisotropyTexture", false, false),
        new(GltfTextureUsage.Subsurface, "_SubsurfaceTexture", false, false)
    ];

    private static readonly SceneGltfShaderProperty[] UnlitArray = BuildUnlit();

    private static readonly SceneGltfShaderProperty[] PbrArray = BuildPbr();

    private static readonly SceneGltfShaderProperty[] ToonArray = BuildToon();

    private static readonly FrozenSet<string> KnownMaterialProperties = BuildKnownProperties();

    /// <summary>Properties of the built-in PBR shader in declaration order.</summary>
    public static ReadOnlySpan<SceneGltfShaderProperty> Pbr => PbrArray;

    /// <summary>Properties of the built-in unlit shader in declaration order.</summary>
    public static ReadOnlySpan<SceneGltfShaderProperty> Unlit => UnlitArray;

    /// <summary>Properties of the built-in toon shader in declaration order.</summary>
    public static ReadOnlySpan<SceneGltfShaderProperty> Toon => ToonArray;

    /// <summary>Texture uniform prefixes in deterministic usage order.</summary>
    internal static ReadOnlySpan<SceneGltfTextureUniformSpec> TextureUniformSpecs =>
        TextureUniformSpecArray;

    /// <summary>Whether a property name is declared by any built-in glTF shader.</summary>
    /// <param name="name">Material property name.</param>
    public static bool IsKnownMaterialProperty(string name)
    {
        ArgumentNullException.ThrowIfNull(name);
        return KnownMaterialProperties.Contains(name);
    }

    /// <summary>Resolves a declared property by name.</summary>
    /// <param name="name">Material property name.</param>
    /// <param name="property">Resolved declaration.</param>
    /// <returns>Whether the property is declared.</returns>
    public static bool TryGetMaterialProperty(
        string name,
        out SceneGltfShaderProperty property)
    {
        ArgumentNullException.ThrowIfNull(name);

        if (TryFind(PbrArray, name, out property) ||
            TryFind(UnlitArray, name, out property) ||
            TryFind(ToonArray, name, out property))
        {
            return true;
        }

        property = default;
        return false;
    }

    internal static string[] BuildUniformNames(ReadOnlySpan<SceneGltfShaderProperty> properties)
    {
        var names = new string[properties.Length];
        for (int i = 0; i < properties.Length; i++)
        {
            names[i] = properties[i].Name;
        }

        return names;
    }

    private static bool TryFind(
        ReadOnlySpan<SceneGltfShaderProperty> properties,
        string name,
        out SceneGltfShaderProperty property)
    {
        for (int i = 0; i < properties.Length; i++)
        {
            if (string.Equals(properties[i].Name, name, StringComparison.Ordinal))
            {
                property = properties[i];
                return true;
            }
        }

        property = default;
        return false;
    }

    private static FrozenSet<string> BuildKnownProperties()
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        foreach (SceneGltfShaderProperty property in PbrArray)
        {
            names.Add(property.Name);
        }

        foreach (SceneGltfShaderProperty property in UnlitArray)
        {
            names.Add(property.Name);
        }

        foreach (SceneGltfShaderProperty property in ToonArray)
        {
            names.Add(property.Name);
        }

        return names.ToFrozenSet(StringComparer.Ordinal);
    }

    private static SceneGltfShaderProperty[] BuildUnlit()
    {
        var properties = new List<SceneGltfShaderProperty>(32);
        AppendVertexTransform(properties);
        properties.Add(Camera("u_CameraPosition", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Material("u_Albedo", SceneGltfShaderPropertyType.Vec4));
        properties.Add(Material("u_AlphaCutoff", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("u_AlbedoMap", SceneGltfShaderPropertyType.Sampler2D));
        AppendFog(properties);
        AppendAlphaProperties(properties);
        properties.Add(Material("_BaseColorFactor", SceneGltfShaderPropertyType.Vec4));
        AppendTextureProperties(properties, TextureUniformSpecArray[0]);
        return [.. properties];
    }

    private static SceneGltfShaderProperty[] BuildPbr()
    {
        var properties = new List<SceneGltfShaderProperty>(160);
        AppendVertexTransform(properties);
        properties.Add(Camera("u_CameraPosition", SceneGltfShaderPropertyType.Vec3));
        properties.Add(SystemProperty("u_ReceiveLighting", SceneGltfShaderPropertyType.Bool));
        AppendLighting(properties);
        properties.Add(Material("u_Albedo", SceneGltfShaderPropertyType.Vec4));
        properties.Add(Material("u_Metallic", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("u_Roughness", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("u_Emissive", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Material("u_NormalScale", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("u_Occlusion", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("u_Tiling", SceneGltfShaderPropertyType.Vec2));
        properties.Add(Material("u_Offset", SceneGltfShaderPropertyType.Vec2));
        properties.Add(Material("u_AlphaCutoff", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("u_AlbedoMap", SceneGltfShaderPropertyType.Sampler2D));
        properties.Add(Material("u_NormalMap", SceneGltfShaderPropertyType.Sampler2D));
        properties.Add(Material("u_PbrMap", SceneGltfShaderPropertyType.Sampler2D));
        properties.Add(Material("u_OcclusionMap", SceneGltfShaderPropertyType.Sampler2D));
        properties.Add(Material("u_EmissiveMap", SceneGltfShaderPropertyType.Sampler2D));
        AppendShadow(properties);
        AppendFog(properties);
        AppendAlphaProperties(properties);
        properties.Add(Material("_BaseColorFactor", SceneGltfShaderPropertyType.Vec4));
        AppendTextureProperties(properties, TextureUniformSpecArray[0]);
        properties.Add(Material("_MetallicFactor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_RoughnessFactor", SceneGltfShaderPropertyType.Float));
        AppendTextureProperties(properties, TextureUniformSpecArray[1]);
        AppendTextureProperties(properties, TextureUniformSpecArray[2]);
        AppendTextureProperties(properties, TextureUniformSpecArray[3]);
        properties.Add(Material("_EmissiveFactor", SceneGltfShaderPropertyType.Vec3));
        AppendTextureProperties(properties, TextureUniformSpecArray[4]);
        properties.Add(Material("_ClearcoatFactor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_ClearcoatRoughnessFactor", SceneGltfShaderPropertyType.Float));
        AppendTextureProperties(properties, TextureUniformSpecArray[5]);
        AppendTextureProperties(properties, TextureUniformSpecArray[6]);
        AppendTextureProperties(properties, TextureUniformSpecArray[7]);
        properties.Add(Material("_SpecularFactor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_SpecularColorFactor", SceneGltfShaderPropertyType.Vec3));
        AppendTextureProperties(properties, TextureUniformSpecArray[8]);
        AppendTextureProperties(properties, TextureUniformSpecArray[9]);
        properties.Add(Material("_SheenFactor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_SheenColorFactor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Material("_SheenRoughnessFactor", SceneGltfShaderPropertyType.Float));
        AppendTextureProperties(properties, TextureUniformSpecArray[10]);
        AppendTextureProperties(properties, TextureUniformSpecArray[11]);
        properties.Add(Material("_TransmissionFactor", SceneGltfShaderPropertyType.Float));
        AppendTextureProperties(properties, TextureUniformSpecArray[12]);
        properties.Add(Material("_ThicknessFactor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_AttenuationDistance", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_AttenuationColor", SceneGltfShaderPropertyType.Vec3));
        AppendTextureProperties(properties, TextureUniformSpecArray[13]);
        properties.Add(Material("_IorFactor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_IridescenceFactor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_IridescenceIor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_IridescenceThicknessMinimum", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_IridescenceThicknessMaximum", SceneGltfShaderPropertyType.Float));
        AppendTextureProperties(properties, TextureUniformSpecArray[14]);
        AppendTextureProperties(properties, TextureUniformSpecArray[15]);
        properties.Add(Material("_AnisotropyStrength", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_AnisotropyRotation", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_AnisotropyFactor", SceneGltfShaderPropertyType.Float));
        AppendTextureProperties(properties, TextureUniformSpecArray[16]);
        properties.Add(Material("_Dispersion", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_SubsurfaceFactor", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_SubsurfaceColorFactor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Material("_SubsurfaceThickness", SceneGltfShaderPropertyType.Float));
        AppendTextureProperties(properties, TextureUniformSpecArray[17]);
        return [.. properties];
    }

    private static SceneGltfShaderProperty[] BuildToon()
    {
        var properties = new List<SceneGltfShaderProperty>(64);
        AppendVertexTransform(properties);
        properties.Add(Camera("u_CameraPosition", SceneGltfShaderPropertyType.Vec3));
        properties.Add(SystemProperty("u_ReceiveLighting", SceneGltfShaderPropertyType.Bool));
        AppendLighting(properties);
        properties.Add(Material("u_Albedo", SceneGltfShaderPropertyType.Vec4));
        properties.Add(Material("u_Emissive", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Material("u_AlphaCutoff", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("u_AlbedoMap", SceneGltfShaderPropertyType.Sampler2D));
        properties.Add(Material("u_EmissiveMap", SceneGltfShaderPropertyType.Sampler2D));
        AppendFog(properties);
        AppendAlphaProperties(properties);
        properties.Add(Material("_BaseColorFactor", SceneGltfShaderPropertyType.Vec4));
        AppendTextureProperties(properties, TextureUniformSpecArray[0]);
        properties.Add(Material("_EmissiveFactor", SceneGltfShaderPropertyType.Vec3));
        AppendTextureProperties(properties, TextureUniformSpecArray[4]);
        properties.Add(Material("_ShadowColor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Material("_ShadowThreshold", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_ShadowSmoothness", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_HighlightThreshold", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_HighlightColor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Material("_RimColor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Material("_RimThreshold", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_RimSmoothness", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_OutlineWidth", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_OutlineColor", SceneGltfShaderPropertyType.Vec3));
        return [.. properties];
    }

    private static void AppendVertexTransform(List<SceneGltfShaderProperty> properties)
    {
        properties.Add(Object("u_Model", SceneGltfShaderPropertyType.Mat4));
        properties.Add(Camera("u_View", SceneGltfShaderPropertyType.Mat4));
        properties.Add(Camera("u_Projection", SceneGltfShaderPropertyType.Mat4));
    }

    private static void AppendLighting(List<SceneGltfShaderProperty> properties)
    {
        properties.Add(Frame("u_LightDirection", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_LightColor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_LightIntensity", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_AmbientLight", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_PointLightPosition", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_PointLightColor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_PointLightIntensity", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_PointLightRange", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_SpotLightPosition", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_SpotLightDirection", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_SpotLightColor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_SpotLightIntensity", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_SpotLightRange", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_SpotLightInnerCos", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_SpotLightOuterCos", SceneGltfShaderPropertyType.Float));
    }

    private static void AppendShadow(List<SceneGltfShaderProperty> properties)
    {
        properties.Add(SystemProperty("u_ShadowMap", SceneGltfShaderPropertyType.Sampler2D));
        properties.Add(Frame("u_ShadowEnabled", SceneGltfShaderPropertyType.Int));
        properties.Add(Frame("u_ShadowCascadeCount", SceneGltfShaderPropertyType.Int));
        properties.Add(Frame("u_ShadowFilter", SceneGltfShaderPropertyType.Int));
        properties.Add(Frame("u_ShadowSplits", SceneGltfShaderPropertyType.Vec4));
        properties.Add(Frame("u_ShadowTiles", SceneGltfShaderPropertyType.Vec4, 4));
        properties.Add(Frame("u_ShadowTexelSize", SceneGltfShaderPropertyType.Vec2));
        properties.Add(Frame("u_ShadowLightMatrices", SceneGltfShaderPropertyType.Mat4, 4));
        properties.Add(Frame("u_ShadowDepthBias", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_ShadowNormalBias", SceneGltfShaderPropertyType.Float));
    }

    private static void AppendFog(List<SceneGltfShaderProperty> properties)
    {
        properties.Add(Frame("u_FogEnabled", SceneGltfShaderPropertyType.Int));
        properties.Add(Frame("u_FogColor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_FogMode", SceneGltfShaderPropertyType.Int));
        properties.Add(Frame("u_FogDensity", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_FogStartEnd", SceneGltfShaderPropertyType.Vec2));
        properties.Add(Frame("u_HeightFogEnabled", SceneGltfShaderPropertyType.Int));
        properties.Add(Frame("u_HeightFogColor", SceneGltfShaderPropertyType.Vec3));
        properties.Add(Frame("u_HeightFogDensity", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_HeightFogFalloff", SceneGltfShaderPropertyType.Float));
        properties.Add(Frame("u_HeightFogGroundHeight", SceneGltfShaderPropertyType.Float));
    }

    private static void AppendAlphaProperties(List<SceneGltfShaderProperty> properties)
    {
        properties.Add(Material("_AlphaMode", SceneGltfShaderPropertyType.Int));
        properties.Add(Material("_AlphaCutoff", SceneGltfShaderPropertyType.Float));
        properties.Add(Material("_DoubleSided", SceneGltfShaderPropertyType.Int));
    }

    private static void AppendTextureProperties(
        List<SceneGltfShaderProperty> properties,
        SceneGltfTextureUniformSpec spec)
    {
        properties.Add(Material(spec.UniformName, SceneGltfShaderPropertyType.Sampler2D));
        properties.Add(Material(spec.UniformName + "_ST", SceneGltfShaderPropertyType.Vec4));
        properties.Add(Material(spec.UniformName + "_Rotation", SceneGltfShaderPropertyType.Float));
        properties.Add(Material(spec.UniformName + "_TexCoord", SceneGltfShaderPropertyType.Int));

        if (spec.HasScale)
        {
            properties.Add(Material(spec.UniformName + "_Scale", SceneGltfShaderPropertyType.Float));
        }

        if (spec.HasStrength)
        {
            properties.Add(Material(spec.UniformName + "_Strength", SceneGltfShaderPropertyType.Float));
        }
    }

    private static SceneGltfShaderProperty Material(string name, SceneGltfShaderPropertyType type) =>
        new(name, type, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Material);

    private static SceneGltfShaderProperty Object(string name, SceneGltfShaderPropertyType type) =>
        new(name, type, SceneGltfShaderStage.Vertex, SceneGltfShaderScope.Object);

    private static SceneGltfShaderProperty Camera(string name, SceneGltfShaderPropertyType type) =>
        new(
            name,
            type,
            type == SceneGltfShaderPropertyType.Mat4
                ? SceneGltfShaderStage.Vertex
                : SceneGltfShaderStage.Fragment,
            SceneGltfShaderScope.Camera);

    private static SceneGltfShaderProperty Frame(string name, SceneGltfShaderPropertyType type, int arrayLength = 0) =>
        new(name, type, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame, arrayLength);

    private static SceneGltfShaderProperty SystemProperty(string name, SceneGltfShaderPropertyType type) =>
        new(name, type, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.System);
}
