namespace Axrone.Scene.Assets;

using System.Collections.Frozen;

/// <summary>Render domain targeted by a Material Contract v2 definition.</summary>
public enum MaterialDomainId : byte
{
    Surface = 0,
    Decal = 1,
    PostProcess = 2,
    Volume = 3
}

/// <summary>Canonical Material Contract v2 model families.</summary>
public enum MaterialModelId : byte
{
    Pbr = 0,
    Unlit = 1,
    Toon = 2,
    Hair = 3,
    Cloth = 4,
    Water = 5,
    Foliage = 6,
    Sprite = 7,
    Particle = 8,
    Composable = 9,
    Decal = 10,
    PostProcess = 11
}

/// <summary>Target profile governed by Material Contract capability checks.</summary>
public enum MaterialRenderProfileId : byte
{
    WebGl2Standard = 0,
    WebGl2Minimal = 1,
    Native = 2
}

/// <summary>Truthful capability state for a domain, model, or Output Slot.</summary>
public enum MaterialCapabilityStatus : byte
{
    Supported = 0,
    Partial = 1,
    Unsupported = 2
}

/// <summary>Shader stage targeted by an Output Slot.</summary>
public enum MaterialStageId : byte
{
    Vertex = 0,
    Fragment = 1
}

/// <summary>Material Contract v2 Output Slot specification on Material Root.</summary>
public sealed record MaterialOutputSlotV2(
    string Key,
    string Label,
    MaterialStageId Stage,
    string Section,
    string ValueType,
    string Semantic,
    string? BindingKey = null,
    string? DefaultValue = null,
    bool Optional = false,
    bool Advanced = false,
    MaterialCapabilityStatus Capability = MaterialCapabilityStatus.Supported);

/// <summary>Material Contract v2 pass plan entry.</summary>
public sealed record MaterialPassPlanEntryV2(
    string Id,
    string Phase,
    string? ShaderId = null,
    bool Required = false,
    string? CullMode = null,
    bool? DepthWrite = null,
    string? EnabledWhenUniformNonZero = null);

/// <summary>Capability verdict across all three Render Profiles.</summary>
public sealed record MaterialProfileCapabilitiesV2(
    MaterialCapabilityStatus WebGl2Standard,
    MaterialCapabilityStatus WebGl2Minimal,
    MaterialCapabilityStatus Native,
    string Notes);

/// <summary>Single-source native definition of one Material Contract v2 model.</summary>
public sealed record MaterialModelDefinitionV2(
    MaterialModelId ModelId,
    string Id,
    string Label,
    MaterialDomainId Domain,
    SceneMaterialShadingModel ShadingModel,
    string DefaultShaderId,
    string DefaultTemplateId,
    IReadOnlyList<MaterialOutputSlotV2> OutputSlots,
    IReadOnlyList<MaterialPassPlanEntryV2> PassPlan,
    MaterialProfileCapabilitiesV2 Capabilities);

/// <summary>
/// AOT-safe single-source Material Contract v2 registry mirroring
/// <c>@axrone/render-core/material-contract-v2</c> across native C# engine packages and Native Editor.
/// </summary>
public static class MaterialContractV2
{
    /// <summary>Schema/contract version identifier.</summary>
    public const int ContractVersion = 2;

    private static readonly IReadOnlyList<MaterialOutputSlotV2> StandardPbrSlots = BuildPbrSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> UnlitSlots = BuildUnlitSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> ToonSlots = BuildToonSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> HairSlots = BuildHairSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> ClothSlots = BuildClothSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> WaterSlots = BuildWaterSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> FoliageSlots = BuildFoliageSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> SpriteSlots = BuildSpriteSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> ParticleSlots = BuildParticleSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> ComposableSlots = BuildComposableSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> DecalSlots = BuildDecalSlots();
    private static readonly IReadOnlyList<MaterialOutputSlotV2> PostProcessSlots = BuildPostProcessSlots();

    private static readonly MaterialPassPlanEntryV2[] StandardSurfacePassPlan =
    [
        new("main", "default", Required: true),
        new("forward-add", "forward-add"),
        new("shadow-caster", "shadow-caster"),
    ];

    private static readonly MaterialModelDefinitionV2[] ModelList =
    [
        new(
            MaterialModelId.Pbr,
            "pbr",
            "PBR",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Pbr,
            "gltf/pbr",
            "pbr-standard",
            StandardPbrSlots,
            StandardSurfacePassPlan,
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Partial, MaterialCapabilityStatus.Supported,
                "Surface, AO, opacity map, and specular lobes supported on WebGL2 Standard and Native.")),
        new(
            MaterialModelId.Unlit,
            "unlit",
            "Unlit",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Unlit,
            "gltf/unlit",
            "unlit-emissive-fx",
            UnlitSlots,
            [new("main", "default", Required: true), new("shadow-caster", "shadow-caster")],
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Supported,
                "Unlit base color, opacity/mask, and emissive outputs supported across all profiles.")),
        new(
            MaterialModelId.Toon,
            "toon",
            "Toon",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Toon,
            "gltf/toon",
            "toon-character",
            ToonSlots,
            [
                new("main", "default", "gltf/toon", Required: true),
                new("outline", "outline", "gltf/toon-outline", CullMode: "front", DepthWrite: true, EnabledWhenUniformNonZero: "_OutlineWidth"),
                new("shadow-caster", "shadow-caster"),
            ],
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Partial, MaterialCapabilityStatus.Supported,
                "Stepped toon lighting plus front-culled inverted-hull outline pass.")),
        new(
            MaterialModelId.Hair,
            "hair",
            "Hair",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Hair,
            "gltf/hair",
            "hair-anisotropic",
            HairSlots,
            StandardSurfacePassPlan,
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Partial, MaterialCapabilityStatus.Supported,
                "Dual anisotropic Kajiya-Kay highlight and shift bands.")),
        new(
            MaterialModelId.Cloth,
            "cloth",
            "Cloth",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Cloth,
            "gltf/cloth",
            "cloth-velvet",
            ClothSlots,
            StandardSurfacePassPlan,
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Partial, MaterialCapabilityStatus.Supported,
                "Microfiber sheen fuzz lobe and subsurface wrap diffuse.")),
        new(
            MaterialModelId.Water,
            "water",
            "Water",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Water,
            "gltf/water",
            "water-stylized-ocean",
            WaterSlots,
            [new("main", "default", Required: true), new("forward-add", "forward-add")],
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Partial, MaterialCapabilityStatus.Supported,
                "Fresnel water tint, dual-scroll ripple normal perturbation, and Gerstner vertex swell.")),
        new(
            MaterialModelId.Foliage,
            "foliage",
            "Foliage",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Foliage,
            "gltf/foliage",
            "foliage-wind-canopy",
            FoliageSlots,
            StandardSurfacePassPlan,
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Partial, MaterialCapabilityStatus.Supported,
                "Backlit subsurface leaf translucency, cutout opacity map, and wind sway.")),
        new(
            MaterialModelId.Sprite,
            "sprite",
            "Sprite",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Sprite,
            "Render2D/Sprite",
            "sprite-lit-fx",
            SpriteSlots,
            [new("main", "default", "Render2D/Sprite", Required: true)],
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Supported,
                "2D sprite tint, alpha cutoff, and glow rim.")),
        new(
            MaterialModelId.Particle,
            "particle",
            "Particle",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Particle,
            "gltf/particle",
            "particle-soft-additive",
            ParticleSlots,
            [new("main", "default", "gltf/particle", Required: true, DepthWrite: false)],
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Supported,
                "Soft particle depth fade, Fresnel edge fade, and emissive glow.")),
        new(
            MaterialModelId.Composable,
            "composable",
            "Composable Surface",
            MaterialDomainId.Surface,
            SceneMaterialShadingModel.Composable,
            "gltf/pbr",
            "composable-layered-metal",
            ComposableSlots,
            StandardSurfacePassPlan,
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Partial, MaterialCapabilityStatus.Supported,
                "Modular Surface Attributes bundle lowered cleanly into PBR bindings.")),
        new(
            MaterialModelId.Decal,
            "decal",
            "Decal",
            MaterialDomainId.Decal,
            SceneMaterialShadingModel.Decal,
            "gltf/decal",
            "decal-weathering",
            DecalSlots,
            [new("main", "default", "gltf/decal", Required: true, DepthWrite: false)],
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Unsupported, MaterialCapabilityStatus.Supported,
                "Surface overlay decal blend with depth bias and fade factor.")),
        new(
            MaterialModelId.PostProcess,
            "post-process",
            "Post Process",
            MaterialDomainId.PostProcess,
            SceneMaterialShadingModel.PostProcess,
            "post-process/contract",
            "post-process-vignette-grade",
            PostProcessSlots,
            [new("main", "default", "post-process/contract", Required: true, CullMode: "none", DepthWrite: false)],
            new(MaterialCapabilityStatus.Supported, MaterialCapabilityStatus.Partial, MaterialCapabilityStatus.Supported,
                "Screen-space tint, vignette, saturation, and contrast grading.")),
    ];

    private static readonly FrozenDictionary<MaterialModelId, MaterialModelDefinitionV2> ModelsByEnum =
        ModelList.ToFrozenDictionary(static m => m.ModelId);

    private static readonly FrozenDictionary<string, MaterialModelDefinitionV2> ModelsById =
        ModelList.ToFrozenDictionary(static m => m.Id, StringComparer.OrdinalIgnoreCase);

    /// <summary>Ordered catalog of all 12 built-in Material Contract v2 models.</summary>
    public static IReadOnlyList<MaterialModelDefinitionV2> Models => ModelList;

    /// <summary>Returns the definition for <paramref name="modelId"/>.</summary>
    public static MaterialModelDefinitionV2 GetModel(MaterialModelId modelId) => ModelsByEnum[modelId];

    /// <summary>Resolves a model definition by its lowercase wire identifier (e.g. "pbr", "post-process").</summary>
    public static bool TryGetModel(string id, out MaterialModelDefinitionV2? model)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            model = null;
            return false;
        }

        return ModelsById.TryGetValue(id.Trim(), out model);
    }

    /// <summary>Maps a wire shader id (including variants like <c>gltf/pbr/blend</c>) back to its canonical model.</summary>
    public static MaterialModelId ResolveModelFromShaderId(string? shaderId, MaterialModelId fallback = MaterialModelId.Pbr)
    {
        if (string.IsNullOrWhiteSpace(shaderId))
        {
            return fallback;
        }

        string trimmed = shaderId.Trim();
        if (trimmed.StartsWith("gltf/unlit", StringComparison.Ordinal)) return MaterialModelId.Unlit;
        if (trimmed.StartsWith("gltf/toon", StringComparison.Ordinal)) return MaterialModelId.Toon;
        if (trimmed.StartsWith("gltf/hair", StringComparison.Ordinal)) return MaterialModelId.Hair;
        if (trimmed.StartsWith("gltf/cloth", StringComparison.Ordinal)) return MaterialModelId.Cloth;
        if (trimmed.StartsWith("gltf/water", StringComparison.Ordinal)) return MaterialModelId.Water;
        if (trimmed.StartsWith("gltf/foliage", StringComparison.Ordinal)) return MaterialModelId.Foliage;
        if (trimmed.StartsWith("Render2D/Sprite", StringComparison.Ordinal)) return MaterialModelId.Sprite;
        if (trimmed.StartsWith("gltf/particle", StringComparison.Ordinal)) return MaterialModelId.Particle;
        if (trimmed.StartsWith("gltf/decal", StringComparison.Ordinal)) return MaterialModelId.Decal;
        if (trimmed.StartsWith("post-process/", StringComparison.Ordinal)) return MaterialModelId.PostProcess;
        return MaterialModelId.Pbr;
    }

    /// <summary>Resolves the render domain capability for a target Render Profile.</summary>
    public static MaterialCapabilityStatus ResolveDomainCapability(
        MaterialDomainId domain,
        MaterialRenderProfileId profile) => domain switch
    {
        MaterialDomainId.Surface => MaterialCapabilityStatus.Supported,
        MaterialDomainId.Decal => profile == MaterialRenderProfileId.WebGl2Minimal
            ? MaterialCapabilityStatus.Unsupported
            : MaterialCapabilityStatus.Supported,
        MaterialDomainId.PostProcess => profile == MaterialRenderProfileId.WebGl2Minimal
            ? MaterialCapabilityStatus.Partial
            : MaterialCapabilityStatus.Supported,
        MaterialDomainId.Volume => MaterialCapabilityStatus.Unsupported,
        _ => MaterialCapabilityStatus.Unsupported
    };

    /// <summary>Resolves model capability under a Render Profile.</summary>
    public static MaterialCapabilityStatus ResolveModelCapability(
        MaterialModelId modelId,
        MaterialRenderProfileId profile)
    {
        MaterialModelDefinitionV2 def = GetModel(modelId);
        return profile switch
        {
            MaterialRenderProfileId.WebGl2Standard => def.Capabilities.WebGl2Standard,
            MaterialRenderProfileId.WebGl2Minimal => def.Capabilities.WebGl2Minimal,
            MaterialRenderProfileId.Native => def.Capabilities.Native,
            _ => MaterialCapabilityStatus.Unsupported
        };
    }

    /// <summary>Resolves capability status for a specific Output Slot under a Render Profile.</summary>
    public static MaterialCapabilityStatus ResolveSlotCapability(
        MaterialModelId modelId,
        string slotKey,
        MaterialRenderProfileId profile)
    {
        MaterialModelDefinitionV2 def = GetModel(modelId);
        MaterialOutputSlotV2? slot = null;
        for (int i = 0; i < def.OutputSlots.Count; i++)
        {
            if (string.Equals(def.OutputSlots[i].Key, slotKey, StringComparison.Ordinal))
            {
                slot = def.OutputSlots[i];
                break;
            }
        }

        if (slot is null)
        {
            return MaterialCapabilityStatus.Unsupported;
        }

        MaterialCapabilityStatus domainCap = ResolveDomainCapability(def.Domain, profile);
        if (domainCap == MaterialCapabilityStatus.Unsupported)
        {
            return MaterialCapabilityStatus.Unsupported;
        }

        if (profile == MaterialRenderProfileId.WebGl2Minimal &&
            slot.Key is "clearcoat" or "clearcoatRoughness" or "clearcoatNormal" or "clearcoatNormalScale"
                or "sheen" or "sheenColor" or "sheenRoughness" or "anisotropy" or "anisotropyRotation"
                or "subsurface" or "subsurfaceColor" or "subsurfaceThickness" or "iridescence"
                or "iridescenceIor" or "iridescenceThickness" or "transmission" or "ior")
        {
            return MaterialCapabilityStatus.Unsupported;
        }

        return slot.Capability;
    }

    /// <summary>Converts the model's Pass Plan into runtime <see cref="SceneMaterialPass"/> instances.</summary>
    public static SceneMaterialPass[] BuildPassesFromPlan(MaterialModelId modelId, string? primaryShaderOverride = null)
    {
        MaterialModelDefinitionV2 def = GetModel(modelId);
        var passes = new SceneMaterialPass[def.PassPlan.Count];
        for (int i = 0; i < def.PassPlan.Count; i++)
        {
            MaterialPassPlanEntryV2 entry = def.PassPlan[i];
            string? shaderId = entry.Phase == "default" && !string.IsNullOrWhiteSpace(primaryShaderOverride)
                ? primaryShaderOverride
                : entry.ShaderId ?? (entry.Phase == "default" ? def.DefaultShaderId : null);

            bool? cull = entry.CullMode switch
            {
                "none" => false,
                "front" or "back" => true,
                _ => null
            };

            passes[i] = new SceneMaterialPass(
                id: entry.Id,
                priority: i,
                depthWrite: entry.DepthWrite,
                cull: cull,
                shaderId: shaderId,
                phase: entry.Phase,
                cullMode: entry.CullMode,
                enabledWhenUniformNonZero: entry.EnabledWhenUniformNonZero);
        }

        return passes;
    }

    /// <summary>Maps a wire render profile id (e.g. "webgl2-minimal", "native") safely.</summary>
    public static MaterialRenderProfileId ParseRenderProfile(string? profileId) => profileId?.Trim().ToUpperInvariant() switch
    {
        "WEBGL2-MINIMAL" => MaterialRenderProfileId.WebGl2Minimal,
        "NATIVE" => MaterialRenderProfileId.Native,
        _ => MaterialRenderProfileId.WebGl2Standard
    };

    private static MaterialOutputSlotV2 Slot(
        string key,
        string label,
        MaterialStageId stage,
        string section,
        string valueType,
        string semantic,
        string? bindingKey = null,
        string? defaultValue = null,
        bool optional = false,
        bool advanced = false,
        MaterialCapabilityStatus capability = MaterialCapabilityStatus.Supported) =>
        new(key, label, stage, section, valueType, semantic, bindingKey, defaultValue, optional, advanced, capability);

    private static MaterialOutputSlotV2 VertexOffsetSlot() =>
        Slot("vertexOffset", "Vertex Offset", MaterialStageId.Vertex, "vertex", "vec3", "vertex.offset",
            "_VertexOffset", "[0, 0, 0]", optional: true, capability: MaterialCapabilityStatus.Partial);

    private static MaterialOutputSlotV2 DepthOffsetSlot(string section = "advanced") =>
        Slot("depthOffset", "Depth Offset", MaterialStageId.Fragment, section, "float", "fragment.depthOffset",
            "_DepthOffset", "0", optional: true, advanced: section == "advanced", capability: MaterialCapabilityStatus.Partial);

    private static List<MaterialOutputSlotV2> BaseSurfaceSlots(bool includeNormal = true, bool includeOcclusion = true, bool includeOpacityMask = true)
    {
        var list = new List<MaterialOutputSlotV2>
        {
            Slot("baseColor", "Base Color", MaterialStageId.Fragment, "surface", "vec3", "surface.baseColor", "_BaseColorFactor", "[1, 1, 1]")
        };
        if (includeNormal)
        {
            list.Add(Slot("normal", "Normal", MaterialStageId.Fragment, "surface", "vec3", "surface.normal", "_NormalTexture", "[0.5, 0.5, 1]", optional: true));
        }
        if (includeOcclusion)
        {
            list.Add(Slot("ambientOcclusion", "Ambient Occlusion", MaterialStageId.Fragment, "surface", "float", "surface.ambientOcclusion", "_OcclusionFactor", "1", optional: true));
        }
        list.Add(Slot("opacity", "Opacity", MaterialStageId.Fragment, "surface", "float", "surface.opacity", "_OpacityFactor", "1", optional: true));
        if (includeOpacityMask)
        {
            list.Add(Slot("opacityMask", "Opacity Mask", MaterialStageId.Fragment, "surface", "float", "surface.opacityMask", "_AlphaCutoff", "0.5", optional: true));
        }
        list.Add(Slot("opacityMap", "Opacity Map", MaterialStageId.Fragment, "surface", "tex", "surface.opacityMap", "_OpacityTexture", optional: true));
        list.Add(Slot("emission", "Emission", MaterialStageId.Fragment, "surface", "vec3", "surface.emission", "_EmissiveFactor", "[0, 0, 0]", optional: true));
        list.Add(Slot("emissionIntensity", "Emission Intensity", MaterialStageId.Fragment, "surface", "float", "surface.emissionIntensity", "_EmissiveIntensity", "1", optional: true));
        return list;
    }

    private static MaterialOutputSlotV2[] BuildPbrSlots()
    {
        List<MaterialOutputSlotV2> slots = BaseSurfaceSlots();
        slots.Add(Slot("metallic", "Metallic", MaterialStageId.Fragment, "surface", "float", "surface.metallic", "_MetallicFactor", "0", optional: true));
        slots.Add(Slot("roughness", "Roughness", MaterialStageId.Fragment, "surface", "float", "surface.roughness", "_RoughnessFactor", "0.5", optional: true));
        slots.Add(Slot("clearcoat", "Clearcoat", MaterialStageId.Fragment, "advanced", "float", "pbr.clearcoat", "_ClearcoatFactor", "0", optional: true, advanced: true));
        slots.Add(Slot("clearcoatRoughness", "Clearcoat Roughness", MaterialStageId.Fragment, "advanced", "float", "pbr.clearcoatRoughness", "_ClearcoatRoughnessFactor", "0", optional: true, advanced: true));
        slots.Add(Slot("clearcoatNormal", "Clearcoat Normal", MaterialStageId.Fragment, "advanced", "vec3", "pbr.clearcoatNormal", "_ClearcoatNormalTexture", "[0.5, 0.5, 1]", optional: true, advanced: true));
        slots.Add(Slot("clearcoatNormalScale", "Clearcoat Normal Scale", MaterialStageId.Fragment, "advanced", "float", "pbr.clearcoatNormalScale", "_ClearcoatNormalTexture_Scale", "1", optional: true, advanced: true));
        slots.Add(Slot("sheen", "Sheen", MaterialStageId.Fragment, "advanced", "float", "pbr.sheen", "_SheenFactor", "0", optional: true, advanced: true));
        slots.Add(Slot("sheenColor", "Sheen Color", MaterialStageId.Fragment, "advanced", "vec3", "pbr.sheenColor", "_SheenColorFactor", "[1, 1, 1]", optional: true, advanced: true));
        slots.Add(Slot("sheenRoughness", "Sheen Roughness", MaterialStageId.Fragment, "advanced", "float", "pbr.sheenRoughness", "_SheenRoughnessFactor", "0.5", optional: true, advanced: true));
        slots.Add(Slot("anisotropy", "Anisotropy", MaterialStageId.Fragment, "advanced", "float", "pbr.anisotropy", "_AnisotropyFactor", "0", optional: true, advanced: true));
        slots.Add(Slot("anisotropyRotation", "Anisotropy Rotation", MaterialStageId.Fragment, "advanced", "float", "pbr.anisotropyRotation", "_AnisotropyRotation", "0", optional: true, advanced: true));
        slots.Add(Slot("subsurface", "Subsurface", MaterialStageId.Fragment, "advanced", "float", "pbr.subsurface", "_SubsurfaceFactor", "0", optional: true, advanced: true, capability: MaterialCapabilityStatus.Partial));
        slots.Add(Slot("subsurfaceColor", "Subsurface Color", MaterialStageId.Fragment, "advanced", "vec3", "pbr.subsurfaceColor", "_SubsurfaceColorFactor", "[1, 0.8, 0.6]", optional: true, advanced: true, capability: MaterialCapabilityStatus.Partial));
        slots.Add(Slot("subsurfaceThickness", "Subsurface Thickness", MaterialStageId.Fragment, "advanced", "float", "pbr.subsurfaceThickness", "_SubsurfaceThickness", "1", optional: true, advanced: true, capability: MaterialCapabilityStatus.Partial));
        slots.Add(Slot("iridescence", "Iridescence", MaterialStageId.Fragment, "advanced", "float", "pbr.iridescence", "_IridescenceFactor", "0", optional: true, advanced: true));
        slots.Add(Slot("iridescenceIor", "Iridescence IOR", MaterialStageId.Fragment, "advanced", "float", "pbr.iridescenceIor", "_IridescenceIor", "1.3", optional: true, advanced: true));
        slots.Add(Slot("iridescenceThickness", "Iridescence Thickness", MaterialStageId.Fragment, "advanced", "float", "pbr.iridescenceThickness", "_IridescenceThickness", "400", optional: true, advanced: true));
        slots.Add(Slot("transmission", "Transmission", MaterialStageId.Fragment, "advanced", "float", "pbr.transmission", "_TransmissionFactor", "0", optional: true, advanced: true, capability: MaterialCapabilityStatus.Partial));
        slots.Add(Slot("ior", "IOR", MaterialStageId.Fragment, "advanced", "float", "pbr.ior", "_IorFactor", "1.5", optional: true, advanced: true));
        slots.Add(DepthOffsetSlot());
        slots.Add(VertexOffsetSlot());
        return [.. slots];
    }

    private static MaterialOutputSlotV2[] BuildUnlitSlots()
    {
        List<MaterialOutputSlotV2> slots = BaseSurfaceSlots(includeNormal: false, includeOcclusion: false);
        slots.Add(DepthOffsetSlot());
        slots.Add(VertexOffsetSlot());
        return [.. slots];
    }

    private static MaterialOutputSlotV2[] BuildToonSlots()
    {
        List<MaterialOutputSlotV2> slots = BaseSurfaceSlots();
        slots.Add(Slot("shadowColor", "Shadow Color", MaterialStageId.Fragment, "toon", "vec3", "toon.shadowColor", "_ShadowColor", "[0.16, 0.14, 0.24]", optional: true));
        slots.Add(Slot("shadowThreshold", "Shadow Threshold", MaterialStageId.Fragment, "toon", "float", "toon.shadowThreshold", "_ShadowThreshold", "0.52", optional: true));
        slots.Add(Slot("shadowSmoothness", "Shadow Smoothness", MaterialStageId.Fragment, "toon", "float", "toon.shadowSmoothness", "_ShadowSmoothness", "0.06", optional: true));
        slots.Add(Slot("highlightColor", "Highlight Color", MaterialStageId.Fragment, "toon", "vec3", "toon.highlightColor", "_HighlightColor", "[1, 0.96, 0.88]", optional: true));
        slots.Add(Slot("highlightThreshold", "Highlight Threshold", MaterialStageId.Fragment, "toon", "float", "toon.highlightThreshold", "_HighlightThreshold", "0.88", optional: true));
        slots.Add(Slot("rimColor", "Rim Color", MaterialStageId.Fragment, "toon", "vec3", "toon.rimColor", "_RimColor", "[0.78, 0.88, 1]", optional: true));
        slots.Add(Slot("rimThreshold", "Rim Threshold", MaterialStageId.Fragment, "toon", "float", "toon.rimThreshold", "_RimThreshold", "0.58", optional: true));
        slots.Add(Slot("rimSmoothness", "Rim Smoothness", MaterialStageId.Fragment, "toon", "float", "toon.rimSmoothness", "_RimSmoothness", "0.14", optional: true));
        slots.Add(Slot("outlineColor", "Outline Color", MaterialStageId.Fragment, "outline", "vec3", "outline.color", "_OutlineColor", "[0.06, 0.06, 0.08]", optional: true));
        slots.Add(Slot("outlineWidth", "Outline Width", MaterialStageId.Fragment, "outline", "float", "outline.width", "_OutlineWidth", "0.025", optional: true, capability: MaterialCapabilityStatus.Partial));
        slots.Add(DepthOffsetSlot());
        slots.Add(VertexOffsetSlot());
        return [.. slots];
    }

    private static MaterialOutputSlotV2[] BuildHairSlots()
    {
        List<MaterialOutputSlotV2> slots = BaseSurfaceSlots();
        slots.Add(Slot("roughness", "Roughness", MaterialStageId.Fragment, "surface", "float", "surface.roughness", "_RoughnessFactor", "0.38", optional: true));
        slots.Add(Slot("specularTint", "Primary Specular Tint", MaterialStageId.Fragment, "hair", "vec3", "hair.specularTint", "_HairSpecularTint", "[0.95, 0.85, 0.72]", optional: true));
        slots.Add(Slot("secondarySpecularTint", "Secondary Specular Tint", MaterialStageId.Fragment, "hair", "vec3", "hair.secondarySpecularTint", "_HairSecondarySpecularTint", "[0.75, 0.52, 0.36]", optional: true));
        slots.Add(Slot("specularShift", "Highlight Shift", MaterialStageId.Fragment, "hair", "float", "hair.specularShift", "_HairSpecularShift", "0.18", optional: true));
        slots.Add(Slot("anisotropy", "Strand Anisotropy", MaterialStageId.Fragment, "hair", "float", "hair.anisotropy", "_AnisotropyFactor", "0.85", optional: true));
        slots.Add(Slot("scatter", "Back Scatter", MaterialStageId.Fragment, "hair", "float", "hair.scatter", "_SubsurfaceFactor", "0.25", optional: true));
        slots.Add(DepthOffsetSlot());
        slots.Add(VertexOffsetSlot());
        return [.. slots];
    }

    private static MaterialOutputSlotV2[] BuildClothSlots()
    {
        List<MaterialOutputSlotV2> slots = BaseSurfaceSlots();
        slots.Add(Slot("roughness", "Roughness", MaterialStageId.Fragment, "surface", "float", "surface.roughness", "_RoughnessFactor", "0.75", optional: true));
        slots.Add(Slot("sheenColor", "Fuzz / Sheen Color", MaterialStageId.Fragment, "cloth", "vec3", "cloth.sheenColor", "_SheenColorFactor", "[0.85, 0.82, 0.9]", optional: true));
        slots.Add(Slot("sheenRoughness", "Fuzz Roughness", MaterialStageId.Fragment, "cloth", "float", "cloth.sheenRoughness", "_SheenRoughnessFactor", "0.55", optional: true));
        slots.Add(Slot("subsurfaceColor", "Scatter Tint", MaterialStageId.Fragment, "cloth", "vec3", "cloth.subsurfaceColor", "_SubsurfaceColorFactor", "[0.9, 0.75, 0.7]", optional: true));
        slots.Add(Slot("subsurface", "Scatter Wrap", MaterialStageId.Fragment, "cloth", "float", "cloth.subsurface", "_SubsurfaceFactor", "0.22", optional: true));
        slots.Add(DepthOffsetSlot());
        slots.Add(VertexOffsetSlot());
        return [.. slots];
    }

    private static MaterialOutputSlotV2[] BuildWaterSlots()
    {
        List<MaterialOutputSlotV2> slots = BaseSurfaceSlots(includeOcclusion: false, includeOpacityMask: false);
        slots.Add(Slot("roughness", "Surface Roughness", MaterialStageId.Fragment, "surface", "float", "surface.roughness", "_RoughnessFactor", "0.08", optional: true));
        slots.Add(Slot("deepColor", "Deep Color", MaterialStageId.Fragment, "water", "vec3", "water.deepColor", "_WaterDeepColor", "[0.03, 0.16, 0.28]", optional: true));
        slots.Add(Slot("shallowColor", "Shallow Color", MaterialStageId.Fragment, "water", "vec3", "water.shallowColor", "_WaterShallowColor", "[0.12, 0.56, 0.64]", optional: true));
        slots.Add(Slot("fresnelPower", "Fresnel Power", MaterialStageId.Fragment, "water", "float", "water.fresnelPower", "_WaterFresnelPower", "4", optional: true));
        slots.Add(Slot("rippleSpeed", "Ripple Speed", MaterialStageId.Fragment, "water", "float", "water.rippleSpeed", "_WaterRippleSpeed", "1.1", optional: true));
        slots.Add(Slot("rippleScale", "Ripple Scale", MaterialStageId.Fragment, "water", "float", "water.rippleScale", "_WaterRippleScale", "8", optional: true));
        slots.Add(Slot("waveAmplitude", "Wave Amplitude", MaterialStageId.Vertex, "vertex", "float", "water.waveAmplitude", "_WaterWaveAmplitude", "0.06", optional: true));
        slots.Add(DepthOffsetSlot());
        slots.Add(VertexOffsetSlot());
        return [.. slots];
    }

    private static MaterialOutputSlotV2[] BuildFoliageSlots()
    {
        List<MaterialOutputSlotV2> slots = BaseSurfaceSlots();
        slots.Add(Slot("roughness", "Roughness", MaterialStageId.Fragment, "surface", "float", "surface.roughness", "_RoughnessFactor", "0.65", optional: true));
        slots.Add(Slot("translucencyColor", "Translucency Color", MaterialStageId.Fragment, "foliage", "vec3", "foliage.translucencyColor", "_SubsurfaceColorFactor", "[0.48, 0.85, 0.28]", optional: true));
        slots.Add(Slot("translucencyStrength", "Translucency", MaterialStageId.Fragment, "foliage", "float", "foliage.translucency", "_SubsurfaceFactor", "0.55", optional: true));
        slots.Add(Slot("windStrength", "Wind Sway Strength", MaterialStageId.Vertex, "vertex", "float", "foliage.windStrength", "_WindStrength", "0.14", optional: true));
        slots.Add(Slot("windSpeed", "Wind Speed", MaterialStageId.Vertex, "vertex", "float", "foliage.windSpeed", "_WindSpeed", "1.8", optional: true));
        slots.Add(DepthOffsetSlot());
        slots.Add(VertexOffsetSlot());
        return [.. slots];
    }

    private static IReadOnlyList<MaterialOutputSlotV2> BuildSpriteSlots() =>
    [
        ..BaseSurfaceSlots(includeNormal: false, includeOcclusion: false),
        Slot("uvScale", "UV Scale", MaterialStageId.Fragment, "sprite", "vec2", "sprite.uvScale", "_SpriteUvScale", "[1, 1]", optional: true),
        Slot("rimGlow", "Sprite Glow Rim", MaterialStageId.Fragment, "sprite", "float", "sprite.rimGlow", "_SpriteGlow", "0", optional: true),
        VertexOffsetSlot(),
    ];

    private static IReadOnlyList<MaterialOutputSlotV2> BuildParticleSlots() =>
    [
        ..BaseSurfaceSlots(includeNormal: false, includeOcclusion: false),
        Slot("softParticleFade", "Soft Edge Fade", MaterialStageId.Fragment, "particle", "float", "particle.softFade", "_ParticleSoftFade", "1", optional: true),
        Slot("edgeFresnel", "Edge Fresnel", MaterialStageId.Fragment, "particle", "float", "particle.edgeFresnel", "_ParticleFresnel", "0", optional: true),
        VertexOffsetSlot(),
    ];

    private static IReadOnlyList<MaterialOutputSlotV2> BuildComposableSlots() =>
    [
        Slot("surfaceAttributes", "Surface Attributes", MaterialStageId.Fragment, "composable", "surfaceAttributes", "surface.attributes", "_SurfaceAttributes", optional: true),
        ..BuildPbrSlots(),
    ];

    private static IReadOnlyList<MaterialOutputSlotV2> BuildDecalSlots() =>
    [
        ..BaseSurfaceSlots(includeOcclusion: true, includeOpacityMask: true),
        Slot("metallic", "Metallic", MaterialStageId.Fragment, "surface", "float", "surface.metallic", "_MetallicFactor", "0", optional: true),
        Slot("roughness", "Roughness", MaterialStageId.Fragment, "surface", "float", "surface.roughness", "_RoughnessFactor", "0.5", optional: true),
        Slot("decalBlendWeight", "Decal Blend Weight", MaterialStageId.Fragment, "decal", "float", "decal.blendWeight", "_DecalBlendWeight", "1", optional: true),
        Slot("decalAngleFade", "Angle Fade", MaterialStageId.Fragment, "decal", "float", "decal.angleFade", "_DecalAngleFade", "0.25", optional: true),
        DepthOffsetSlot("decal"),
        VertexOffsetSlot(),
    ];

    private static IReadOnlyList<MaterialOutputSlotV2> BuildPostProcessSlots() =>
    [
        ..BaseSurfaceSlots(includeNormal: false, includeOcclusion: false, includeOpacityMask: false),
        Slot("postTintColor", "Grade Tint", MaterialStageId.Fragment, "post-process", "vec3", "postProcess.tintColor", "_PostTintColor", "[1, 1, 1]", optional: true),
        Slot("vignetteIntensity", "Vignette Intensity", MaterialStageId.Fragment, "post-process", "float", "postProcess.vignette", "_PostVignetteIntensity", "0.25", optional: true),
        Slot("saturation", "Saturation", MaterialStageId.Fragment, "post-process", "float", "postProcess.saturation", "_PostSaturation", "1", optional: true),
        Slot("contrast", "Contrast", MaterialStageId.Fragment, "post-process", "float", "postProcess.contrast", "_PostContrast", "1", optional: true),
        Slot("blendFactor", "Blend Factor", MaterialStageId.Fragment, "post-process", "float", "postProcess.blendFactor", "_PostBlendFactor", "1", optional: true),
        DepthOffsetSlot("post-process"),
    ];
}
