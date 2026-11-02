namespace Axrone.Scene.Assets;

/// <summary>Shading model used by a material.</summary>
public enum SceneMaterialShadingModel : byte
{
    /// <summary>Unlit color output.</summary>
    Unlit = 0,

    /// <summary>Metallic/roughness PBR.</summary>
    Pbr = 1,

    /// <summary>Stylized toon response.</summary>
    Toon = 2,

    /// <summary>Custom shader path.</summary>
    Custom = 3
}

/// <summary>Alpha handling mode.</summary>
public enum SceneMaterialAlphaMode : byte
{
    /// <summary>Fully opaque.</summary>
    Opaque = 0,

    /// <summary>Alpha-tested.</summary>
    Mask = 1,

    /// <summary>Alpha-blended.</summary>
    Blend = 2
}

/// <summary>Texture coordinate set used by a binding.</summary>
public enum SceneUvSet : byte
{
    /// <summary>First UV set.</summary>
    Uv0 = 0,

    /// <summary>Second UV set.</summary>
    Uv1 = 1
}

/// <summary>Material surface features that drive shader keywords.</summary>
[Flags]
public enum SceneMaterialFeatures : uint
{
    /// <summary>No optional feature.</summary>
    None = 0,

    /// <summary>Vertex colors are multiplied into albedo.</summary>
    VertexColor = 1U << 0,

    /// <summary>A second UV set is present.</summary>
    SecondUv = 1U << 1,

    /// <summary>Normal mapping is enabled.</summary>
    NormalMap = 1U << 2,

    /// <summary>Two-sided lighting/culling.</summary>
    TwoSided = 1U << 3,

    /// <summary>Albedo texture is present.</summary>
    AlbedoMap = 1U << 4,

    /// <summary>PBR parameter texture is present.</summary>
    PbrMap = 1U << 5,

    /// <summary>Metallic/roughness texture is present.</summary>
    MetallicRoughnessMap = 1U << 6,

    /// <summary>Occlusion texture is present.</summary>
    OcclusionMap = 1U << 7,

    /// <summary>Emissive texture is present.</summary>
    EmissiveMap = 1U << 8,

    /// <summary>Clearcoat lobe is enabled.</summary>
    Clearcoat = 1U << 9,

    /// <summary>Clearcoat texture is present.</summary>
    ClearcoatMap = 1U << 10,

    /// <summary>Clearcoat roughness texture is present.</summary>
    ClearcoatRoughnessMap = 1U << 11,

    /// <summary>Clearcoat normal texture is present.</summary>
    ClearcoatNormalMap = 1U << 12,

    /// <summary>Alpha testing is enabled.</summary>
    AlphaTest = 1U << 13,

    /// <summary>Anisotropy lobe is enabled.</summary>
    Anisotropy = 1U << 14,

    /// <summary>Sheen lobe is enabled.</summary>
    Sheen = 1U << 15,

    /// <summary>Subsurface scattering is enabled.</summary>
    Subsurface = 1U << 16,

    /// <summary>Transmission is enabled.</summary>
    Transmission = 1U << 17,

    /// <summary>Iridescence is enabled.</summary>
    Iridescence = 1U << 18,

    /// <summary>Sheen color texture is present.</summary>
    SheenColorMap = 1U << 19,

    /// <summary>Sheen roughness texture is present.</summary>
    SheenRoughnessMap = 1U << 20,

    /// <summary>Transmission texture is present.</summary>
    TransmissionMap = 1U << 21,

    /// <summary>Volume thickness texture is present.</summary>
    ThicknessMap = 1U << 22,

    /// <summary>Iridescence texture is present.</summary>
    IridescenceMap = 1U << 23,

    /// <summary>Iridescence thickness texture is present.</summary>
    IridescenceThicknessMap = 1U << 24,

    /// <summary>Specular intensity texture is present.</summary>
    SpecularMap = 1U << 25,

    /// <summary>Specular color texture is present.</summary>
    SpecularColorMap = 1U << 26,

    /// <summary>Anisotropy texture is present.</summary>
    AnisotropyMap = 1U << 27,

    /// <summary>Subsurface scattering texture is present.</summary>
    SubsurfaceMap = 1U << 28
}

/// <summary>
/// Texture reference with deterministic unit and UV transform. The renderer
/// resolves the sampler and unit at material upload time.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneMaterialTextureBinding
{
    /// <summary>Referenced texture.</summary>
    public SceneAssetId<TextureAssetTag> TextureId { get; }

    /// <summary>Optional sampler override.</summary>
    public SceneAssetId<SamplerAssetTag>? SamplerId { get; }

    /// <summary>UV set.</summary>
    public SceneUvSet UvSet { get; }

    /// <summary>Explicit texture unit, or null for automatic assignment.</summary>
    public int? Unit { get; }

    /// <summary>UV scale.</summary>
    public Vec2 Scale { get; }

    /// <summary>UV offset.</summary>
    public Vec2 Offset { get; }

    /// <summary>UV rotation in radians.</summary>
    public float Rotation { get; }

    /// <summary>Creates a validated texture binding.</summary>
    public SceneMaterialTextureBinding(
        SceneAssetId<TextureAssetTag> textureId,
        SceneAssetId<SamplerAssetTag>? samplerId = null,
        SceneUvSet uvSet = SceneUvSet.Uv0,
        int? unit = null,
        Vec2? scale = null,
        Vec2? offset = null,
        float rotation = 0.0f)
    {
        if (!textureId.IsValid)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material texture bindings require a non-empty texture id.");
        }

        if (samplerId is { } sampler && !sampler.IsValid)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material texture bindings require a valid sampler id when one is provided.");
        }

        if (unit is < 0)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material texture units must not be negative.");
        }

        if (!float.IsFinite(rotation))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material texture rotation must be finite.");
        }

        Vec2 resolvedScale = scale ?? Vec2.One;
        Vec2 resolvedOffset = offset ?? Vec2.Zero;
        if (!float.IsFinite(resolvedScale.X) || !float.IsFinite(resolvedScale.Y) ||
            !float.IsFinite(resolvedOffset.X) || !float.IsFinite(resolvedOffset.Y))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Material texture scale and offset must be finite.");
        }

        TextureId = textureId;
        SamplerId = samplerId;
        UvSet = uvSet;
        Unit = unit;
        Scale = resolvedScale;
        Offset = resolvedOffset;
        Rotation = rotation;
    }
}
