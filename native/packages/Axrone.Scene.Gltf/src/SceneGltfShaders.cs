namespace Axrone.Scene.Gltf;

using System.Collections.Frozen;
using System.Text;

/// <summary>
/// Built-in glTF shaders. Sources are assembled once from
/// <see cref="SceneGltfShaderLibrary"/> blocks and the declared
/// <see cref="SceneGltfShaderProperties"/> catalogs, so shader ids, uniform
/// lists and pipeline state stay deterministic across imports.
/// </summary>
public static class SceneGltfShaders
{
    /// <summary>Base id of the built-in metallic/roughness shader.</summary>
    public const string PbrShaderName = "gltf/pbr";

    /// <summary>Base id of the built-in unlit shader.</summary>
    public const string UnlitShaderName = "gltf/unlit";

    /// <summary>Base id of the built-in toon shader.</summary>
    public const string ToonShaderName = "gltf/toon";

    /// <summary>Variant suffix for alpha-blended materials.</summary>
    public const string BlendSuffix = "/blend";

    /// <summary>Variant suffix for double-sided materials.</summary>
    public const string DoubleSidedSuffix = "/double-sided";

    private static readonly string[] AttributeLines =
    [
        "layout(location = 0) in vec3 a_Position;",
        "layout(location = 1) in vec3 a_Normal;",
        "layout(location = 2) in vec2 a_UV0;",
        "layout(location = 3) in vec2 a_UV1;",
        "layout(location = 4) in vec4 a_Tangent;"
    ];

    private static readonly string[] PbrVaryings =
    [
        "out vec2 v_UV0;",
        "out vec2 v_UV1;",
        "out vec3 v_WorldPosition;",
        "out vec3 v_WorldNormal;",
        "out vec4 v_WorldTangent;"
    ];

    private static readonly string[] ToonVaryings =
    [
        "out vec2 v_UV0;",
        "out vec2 v_UV1;",
        "out vec3 v_WorldPosition;",
        "out vec3 v_WorldNormal;"
    ];

    private static readonly string[] UnlitVaryings =
    [
        "out vec2 v_UV0;",
        "out vec2 v_UV1;",
        "out vec3 v_WorldPosition;"
    ];

    private static readonly string[] PbrVertexBody =
    [
        "    vec4 worldPosition = u_Model * vec4(a_Position, 1.0);",
        "    v_WorldPosition = worldPosition.xyz;",
        "    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);",
        "    v_WorldTangent = vec4(normalize(mat3(u_Model) * a_Tangent.xyz), a_Tangent.w);",
        "    v_UV0 = a_UV0;",
        "    v_UV1 = a_UV1;",
        "    gl_Position = u_Projection * u_View * worldPosition;"
    ];

    private static readonly string[] ToonVertexBody =
    [
        "    vec4 worldPosition = u_Model * vec4(a_Position, 1.0);",
        "    v_WorldPosition = worldPosition.xyz;",
        "    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);",
        "    v_UV0 = a_UV0;",
        "    v_UV1 = a_UV1;",
        "    gl_Position = u_Projection * u_View * worldPosition;"
    ];

    private static readonly string[] UnlitVertexBody =
    [
        "    vec4 worldPosition = u_Model * vec4(a_Position, 1.0);",
        "    v_WorldPosition = worldPosition.xyz;",
        "    v_UV0 = a_UV0;",
        "    v_UV1 = a_UV1;",
        "    gl_Position = u_Projection * u_View * worldPosition;"
    ];

    private static readonly string[] PbrFragmentBody =
    [
        "    vec4 baseColor = u_Albedo;",
        "    if (_BaseColorTexture_TexCoord >= 0) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_BaseColorTexture_TexCoord, v_UV0, v_UV1), _BaseColorTexture_ST, _BaseColorTexture_Rotation);",
        "        baseColor *= texture(u_AlbedoMap, uv);",
        "    }",
        "    if (_AlphaMode == 1 && baseColor.a < u_AlphaCutoff) {",
        "        discard;",
        "    }",
        "",
        "    vec3 normal = length(v_WorldNormal) > 0.0001 ? normalize(v_WorldNormal) : vec3(0.0, 0.0, 1.0);",
        "    if (_NormalTexture_TexCoord >= 0 && length(v_WorldTangent.xyz) > 0.0001) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_NormalTexture_TexCoord, v_UV0, v_UV1), _NormalTexture_ST, _NormalTexture_Rotation);",
        "        vec3 tangentNormal = texture(u_NormalMap, uv).xyz * 2.0 - 1.0;",
        "        tangentNormal.xy *= u_NormalScale;",
        "        vec3 tangent = normalize(v_WorldTangent.xyz);",
        "        vec3 bitangent = normalize(cross(normal, tangent)) * (v_WorldTangent.w == 0.0 ? 1.0 : v_WorldTangent.w);",
        "        normal = normalize(mat3(tangent, bitangent, normal) * tangentNormal);",
        "    }",
        "",
        "    vec4 metallicRoughness = vec4(1.0);",
        "    if (_MetallicRoughnessTexture_TexCoord >= 0) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_MetallicRoughnessTexture_TexCoord, v_UV0, v_UV1), _MetallicRoughnessTexture_ST, _MetallicRoughnessTexture_Rotation);",
        "        metallicRoughness = texture(u_PbrMap, uv);",
        "    }",
        "    float metallic = clamp(u_Metallic * metallicRoughness.b, 0.0, 1.0);",
        "    float roughness = clamp(u_Roughness * metallicRoughness.g, 0.04, 1.0);",
        "    vec3 albedo = baseColor.rgb;",
        "    vec3 F0 = mix(vec3(0.04), albedo, metallic);",
        "    vec3 viewDir = normalize(u_CameraPosition - v_WorldPosition);",
        "    float clearcoat = clamp(_ClearcoatFactor, 0.0, 1.0);",
        "    float clearcoatRoughness = clamp(_ClearcoatRoughnessFactor, 0.04, 1.0);",
        "    float sheenScale = _SheenFactor > 0.0 ? clamp(_SheenFactor, 0.0, 1.0) : 1.0;",
        "    vec3 sheenColor = _SheenColorFactor * sheenScale;",
        "",
        "    vec3 color = vec3(0.0);",
        "    vec3 fresnel = fresnelSchlick(max(dot(normal, viewDir), 0.0), F0);",
        "    vec3 diffuseWeight = (vec3(1.0) - fresnel) * (1.0 - metallic);",
        "    color = diffuseWeight * u_AmbientLight * albedo + u_AmbientLight * F0 * (1.0 - roughness);",
        "    color += sheenColor * (1.0 - max(dot(normal, viewDir), 0.0)) * u_AmbientLight;",
        "",
        "    if (u_ReceiveLighting) {",
        "        vec3 lightDirection = length(u_LightDirection) > 1e-5 ? normalize(u_LightDirection) : vec3(0.0, 1.0, 0.0);",
        "        float shadowFactor = gltfResolveShadowFactor(v_WorldPosition, normal, lightDirection);",
        "        color += evaluateGltfDirectLight(normal, viewDir, albedo, metallic, roughness, F0, lightDirection, u_LightColor, u_LightIntensity) * shadowFactor;",
        "        color += evaluateGltfClearcoat(normal, viewDir, clearcoat, clearcoatRoughness, lightDirection, u_LightColor, u_LightIntensity) * shadowFactor;",
        "",
        "        vec3 toPoint = u_PointLightPosition - v_WorldPosition;",
        "        float pointDistance = length(toPoint);",
        "        if (pointDistance > 0.0) {",
        "            vec3 pointDirection = toPoint / pointDistance;",
        "            float pointAttenuation = rangeAttenuation(pointDistance, u_PointLightRange);",
        "            color += evaluateGltfDirectLight(normal, viewDir, albedo, metallic, roughness, F0, pointDirection, u_PointLightColor, u_PointLightIntensity) * pointAttenuation;",
        "            color += evaluateGltfClearcoat(normal, viewDir, clearcoat, clearcoatRoughness, pointDirection, u_PointLightColor, u_PointLightIntensity) * pointAttenuation;",
        "        }",
        "",
        "        vec3 toSpot = u_SpotLightPosition - v_WorldPosition;",
        "        float spotDistance = length(toSpot);",
        "        if (spotDistance > 0.0) {",
        "            vec3 spotDirection = toSpot / spotDistance;",
        "            float spotAttenuationValue = rangeAttenuation(spotDistance, u_SpotLightRange) * spotAttenuation(spotDirection, u_SpotLightDirection, u_SpotLightInnerCos, u_SpotLightOuterCos);",
        "            color += evaluateGltfDirectLight(normal, viewDir, albedo, metallic, roughness, F0, spotDirection, u_SpotLightColor, u_SpotLightIntensity) * spotAttenuationValue;",
        "            color += evaluateGltfClearcoat(normal, viewDir, clearcoat, clearcoatRoughness, spotDirection, u_SpotLightColor, u_SpotLightIntensity) * spotAttenuationValue;",
        "        }",
        "    }",
        "",
        "    if (_OcclusionTexture_TexCoord >= 0) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_OcclusionTexture_TexCoord, v_UV0, v_UV1), _OcclusionTexture_ST, _OcclusionTexture_Rotation);",
        "        float occlusion = texture(u_OcclusionMap, uv).r;",
        "        color *= mix(1.0, occlusion, clamp(u_Occlusion, 0.0, 1.0));",
        "    }",
        "",
        "    vec3 emissive = u_Emissive;",
        "    if (_EmissiveTexture_TexCoord >= 0) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_EmissiveTexture_TexCoord, v_UV0, v_UV1), _EmissiveTexture_ST, _EmissiveTexture_Rotation);",
        "        emissive *= texture(u_EmissiveMap, uv).rgb;",
        "    }",
        "    color += emissive;",
        "    color = gltfApplyFog(color, v_WorldPosition, u_CameraPosition);",
        "",
        "    float alpha = _AlphaMode == 2 ? baseColor.a : 1.0;",
        "    o_FragColor = vec4(color, alpha);"
    ];

    private static readonly string[] ToonFragmentBody =
    [
        "    vec4 baseColor = u_Albedo;",
        "    if (_BaseColorTexture_TexCoord >= 0) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_BaseColorTexture_TexCoord, v_UV0, v_UV1), _BaseColorTexture_ST, _BaseColorTexture_Rotation);",
        "        baseColor *= texture(u_AlbedoMap, uv);",
        "    }",
        "    if (_AlphaMode == 1 && baseColor.a < u_AlphaCutoff) {",
        "        discard;",
        "    }",
        "",
        "    vec3 normal = length(v_WorldNormal) > 0.0001 ? normalize(v_WorldNormal) : vec3(0.0, 0.0, 1.0);",
        "    vec3 viewDir = normalize(u_CameraPosition - v_WorldPosition);",
        "    float rim = toonRim(max(dot(normal, viewDir), 0.0), _RimThreshold, _RimSmoothness);",
        "",
        "    vec3 color = vec3(0.0);",
        "    if (u_ReceiveLighting) {",
        "        vec3 lightDirection = length(u_LightDirection) > 1e-5 ? normalize(u_LightDirection) : vec3(0.0, 1.0, 0.0);",
        "        vec3 halfDirection = normalize(viewDir + lightDirection);",
        "        float band = toonBand(max(dot(normal, lightDirection), 0.0), _ShadowThreshold, _ShadowSmoothness);",
        "        vec3 shaded = mix(_ShadowColor * baseColor.rgb, baseColor.rgb, band);",
        "        float highlight = toonHighlight(max(dot(normal, halfDirection), 0.0), _HighlightThreshold);",
        "        shaded = mix(shaded, _HighlightColor, highlight * band);",
        "        shaded = mix(shaded, _RimColor, rim * 0.5);",
        "        color += shaded * u_LightColor * u_LightIntensity;",
        "",
        "        vec3 toPoint = u_PointLightPosition - v_WorldPosition;",
        "        float pointDistance = length(toPoint);",
        "        if (pointDistance > 0.0) {",
        "            vec3 pointDirection = toPoint / pointDistance;",
        "            float pointAttenuation = rangeAttenuation(pointDistance, u_PointLightRange);",
        "            float pointBand = toonBand(max(dot(normal, pointDirection), 0.0), _ShadowThreshold, _ShadowSmoothness);",
        "            vec3 pointShade = mix(_ShadowColor * baseColor.rgb, baseColor.rgb, pointBand);",
        "            color += pointShade * u_PointLightColor * u_PointLightIntensity * pointAttenuation;",
        "        }",
        "    } else {",
        "        color = baseColor.rgb;",
        "    }",
        "",
        "    vec3 emissive = u_Emissive;",
        "    if (_EmissiveTexture_TexCoord >= 0) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_EmissiveTexture_TexCoord, v_UV0, v_UV1), _EmissiveTexture_ST, _EmissiveTexture_Rotation);",
        "        emissive *= texture(u_EmissiveMap, uv).rgb;",
        "    }",
        "    color += emissive;",
        "    color = gltfApplyFog(color, v_WorldPosition, u_CameraPosition);",
        "",
        "    float alpha = _AlphaMode == 2 ? baseColor.a : 1.0;",
        "    o_FragColor = vec4(color, alpha);"
    ];

    private static readonly string[] UnlitFragmentBody =
    [
        "    vec4 baseColor = u_Albedo;",
        "    if (_BaseColorTexture_TexCoord >= 0) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_BaseColorTexture_TexCoord, v_UV0, v_UV1), _BaseColorTexture_ST, _BaseColorTexture_Rotation);",
        "        baseColor *= texture(u_AlbedoMap, uv);",
        "    }",
        "    if (_AlphaMode == 1 && baseColor.a < u_AlphaCutoff) {",
        "        discard;",
        "    }",
        "    float alpha = _AlphaMode == 2 ? baseColor.a : 1.0;",
        "    vec3 color = gltfApplyFog(linearToSrgb(baseColor.rgb), v_WorldPosition, u_CameraPosition);",
        "    o_FragColor = vec4(color, alpha);"
    ];

    private static readonly FrozenDictionary<SceneMeshSemantic, string> PbrAttributes =
        new Dictionary<SceneMeshSemantic, string>
        {
            [SceneMeshSemantic.Position] = "a_Position",
            [SceneMeshSemantic.Normal] = "a_Normal",
            [SceneMeshSemantic.Uv0] = "a_UV0",
            [SceneMeshSemantic.Uv1] = "a_UV1",
            [SceneMeshSemantic.Tangent] = "a_Tangent"
        }.ToFrozenDictionary();

    private static readonly FrozenDictionary<SceneMeshSemantic, string> ToonAttributes =
        new Dictionary<SceneMeshSemantic, string>
        {
            [SceneMeshSemantic.Position] = "a_Position",
            [SceneMeshSemantic.Normal] = "a_Normal",
            [SceneMeshSemantic.Uv0] = "a_UV0",
            [SceneMeshSemantic.Uv1] = "a_UV1"
        }.ToFrozenDictionary();

    private static readonly FrozenDictionary<SceneMeshSemantic, string> UnlitAttributes =
        new Dictionary<SceneMeshSemantic, string>
        {
            [SceneMeshSemantic.Position] = "a_Position",
            [SceneMeshSemantic.Uv0] = "a_UV0",
            [SceneMeshSemantic.Uv1] = "a_UV1"
        }.ToFrozenDictionary();

    private static readonly string PbrVertexSource = BuildVertexSource(
        SceneGltfShaderProperties.Pbr,
        [AttributeLines[0], AttributeLines[1], AttributeLines[2], AttributeLines[3], AttributeLines[4]],
        PbrVaryings,
        PbrVertexBody);

    private static readonly string PbrFragmentSource = BuildFragmentSource(
        SceneGltfShaderProperties.Pbr,
        PbrVaryings,
        [SceneGltfShaderLibrary.UvBlockId, SceneGltfShaderLibrary.PbrLightingBlockId, SceneGltfShaderLibrary.ShadowBlockId, SceneGltfShaderLibrary.FogBlockId],
        PbrFragmentBody);

    private static readonly string ToonVertexSource = BuildVertexSource(
        SceneGltfShaderProperties.Toon,
        [AttributeLines[0], AttributeLines[1], AttributeLines[2], AttributeLines[3]],
        ToonVaryings,
        ToonVertexBody);

    private static readonly string ToonFragmentSource = BuildFragmentSource(
        SceneGltfShaderProperties.Toon,
        ToonVaryings,
        [
            SceneGltfShaderLibrary.UvBlockId,
            SceneGltfShaderLibrary.PbrLightingBlockId,
            SceneGltfShaderLibrary.ToonShadingBlockId,
            SceneGltfShaderLibrary.FogBlockId
        ],
        ToonFragmentBody);

    private static readonly string UnlitVertexSource = BuildVertexSource(
        SceneGltfShaderProperties.Unlit,
        [AttributeLines[0], AttributeLines[2], AttributeLines[3]],
        UnlitVaryings,
        UnlitVertexBody);

    private static readonly string UnlitFragmentSource = BuildFragmentSource(
        SceneGltfShaderProperties.Unlit,
        UnlitVaryings,
        [SceneGltfShaderLibrary.UvBlockId, SceneGltfShaderLibrary.ColorSpaceBlockId, SceneGltfShaderLibrary.FogBlockId],
        UnlitFragmentBody);

    private static readonly FrozenDictionary<string, SceneShaderDefinition> Cache = BuildCache();

    /// <summary>Creates the built-in PBR shader definition.</summary>
    /// <param name="names">Optional name table used to intern the shader id.</param>
    public static SceneShaderDefinition CreatePbr(SceneNameTable? names = null) =>
        CreateCore(PbrShaderName, PbrShaderName, blend: false, doubleSided: false, names);

    /// <summary>Creates the built-in unlit shader definition.</summary>
    /// <param name="names">Optional name table used to intern the shader id.</param>
    public static SceneShaderDefinition CreateUnlit(SceneNameTable? names = null) =>
        CreateCore(UnlitShaderName, UnlitShaderName, blend: false, doubleSided: false, names);

    /// <summary>Creates the built-in toon shader definition.</summary>
    /// <param name="names">Optional name table used to intern the shader id.</param>
    public static SceneShaderDefinition CreateToon(SceneNameTable? names = null) =>
        CreateCore(ToonShaderName, ToonShaderName, blend: false, doubleSided: false, names);

    /// <summary>Builds a shader variant id from a built-in base name.</summary>
    /// <param name="baseName">Base shader name.</param>
    /// <param name="blend">Whether the variant blends.</param>
    /// <param name="doubleSided">Whether the variant renders double-sided.</param>
    public static string ResolveVariantId(string baseName, bool blend, bool doubleSided)
    {
        ArgumentNullException.ThrowIfNull(baseName);

        if (!blend && !doubleSided)
        {
            return baseName;
        }

        return blend && doubleSided
            ? string.Concat(baseName, BlendSuffix, DoubleSidedSuffix)
            : blend
                ? string.Concat(baseName, BlendSuffix)
                : string.Concat(baseName, DoubleSidedSuffix);
    }

    /// <summary>Resolves a built-in shader by id, including blend and double-sided variants.</summary>
    /// <param name="id">Shader id; may carry the variant suffixes.</param>
    /// <param name="names">Optional name table used to intern the shader id.</param>
    /// <param name="definition">Resolved definition.</param>
    /// <returns>Whether the id names a built-in glTF shader.</returns>
    public static bool TryCreate(
        string id,
        SceneNameTable? names,
        [NotNullWhen(true)] out SceneShaderDefinition? definition)
    {
        ArgumentNullException.ThrowIfNull(id);

        if (names is null && Cache.TryGetValue(id, out SceneShaderDefinition? cached))
        {
            definition = cached;
            return true;
        }

        if (!TryClassify(id, out string? baseName))
        {
            definition = null;
            return false;
        }

        bool blend = id.AsSpan().Contains(BlendSuffix, StringComparison.Ordinal);
        bool doubleSided = id.AsSpan().Contains(DoubleSidedSuffix, StringComparison.Ordinal);
        definition = CreateCore(id, baseName, blend, doubleSided, names);
        return true;
    }

    private static bool TryClassify(string id, [NotNullWhen(true)] out string? baseName)
    {
        if (IsBaseOrVariant(id, PbrShaderName))
        {
            baseName = PbrShaderName;
            return true;
        }

        if (IsBaseOrVariant(id, UnlitShaderName))
        {
            baseName = UnlitShaderName;
            return true;
        }

        if (IsBaseOrVariant(id, ToonShaderName))
        {
            baseName = ToonShaderName;
            return true;
        }

        baseName = null;
        return false;
    }

    private static bool IsBaseOrVariant(string id, string baseName) =>
        string.Equals(id, baseName, StringComparison.Ordinal) ||
        (id.Length > baseName.Length &&
            id.StartsWith(baseName, StringComparison.Ordinal) &&
            id[baseName.Length] == '/');

    private static SceneShaderDefinition CreateCore(
        string id,
        string baseName,
        bool blend,
        bool doubleSided,
        SceneNameTable? names)
    {
        SceneAssetId<ShaderAssetTag> shaderId = names is null
            ? SceneAssetId<ShaderAssetTag>.FromName(id)
            : SceneAssetId<ShaderAssetTag>.FromSymbol(names.Intern(id));

        bool cull = !doubleSided;

        return string.Equals(baseName, UnlitShaderName, StringComparison.Ordinal)
            ? new SceneShaderDefinition(
                shaderId,
                UnlitVertexSource,
                UnlitFragmentSource,
                SceneGltfShaderProperties.BuildUniformNames(SceneGltfShaderProperties.Unlit),
                UnlitAttributes,
                depthTest: true,
                cull: cull,
                blend: blend)
            : string.Equals(baseName, ToonShaderName, StringComparison.Ordinal)
                ? new SceneShaderDefinition(
                    shaderId,
                    ToonVertexSource,
                    ToonFragmentSource,
                    SceneGltfShaderProperties.BuildUniformNames(SceneGltfShaderProperties.Toon),
                    ToonAttributes,
                    depthTest: true,
                    cull: cull,
                    blend: blend)
                : new SceneShaderDefinition(
                    shaderId,
                    PbrVertexSource,
                    PbrFragmentSource,
                    SceneGltfShaderProperties.BuildUniformNames(SceneGltfShaderProperties.Pbr),
                    PbrAttributes,
                    depthTest: true,
                    cull: cull,
                    blend: blend);
    }

    private static FrozenDictionary<string, SceneShaderDefinition> BuildCache()
    {
        var cache = new Dictionary<string, SceneShaderDefinition>(StringComparer.Ordinal);
        AddCacheEntry(cache, PbrShaderName);
        AddCacheEntry(cache, UnlitShaderName);
        AddCacheEntry(cache, ToonShaderName);

        ReadOnlySpan<string> baseNames = [PbrShaderName, UnlitShaderName, ToonShaderName];
        for (int i = 0; i < baseNames.Length; i++)
        {
            for (int variant = 1; variant < 4; variant++)
            {
                AddCacheEntry(
                    cache,
                    ResolveVariantId(baseNames[i], (variant & 1) != 0, (variant & 2) != 0));
            }
        }

        return cache.ToFrozenDictionary(StringComparer.Ordinal);
    }

    private static void AddCacheEntry(Dictionary<string, SceneShaderDefinition> cache, string id)
    {
        string baseName = TryClassify(id, out string? classified) ? classified : PbrShaderName;
        bool blend = id.AsSpan().Contains(BlendSuffix, StringComparison.Ordinal);
        bool doubleSided = id.AsSpan().Contains(DoubleSidedSuffix, StringComparison.Ordinal);
        cache.Add(id, CreateCore(id, baseName, blend, doubleSided, names: null));
    }
    private static string BuildVertexSource(
        ReadOnlySpan<SceneGltfShaderProperty> properties,
        ReadOnlySpan<string> attributes,
        ReadOnlySpan<string> varyings,
        ReadOnlySpan<string> body)
    {
        var builder = new StringBuilder(2048);
        AppendLine(builder, "#version 330 core");
        AppendLine(builder, string.Empty);

        for (int i = 0; i < attributes.Length; i++)
        {
            AppendLine(builder, attributes[i]);
        }

        AppendLine(builder, string.Empty);
        AppendUniforms(builder, properties, SceneGltfShaderStage.Vertex);
        AppendLine(builder, string.Empty);

        for (int i = 0; i < varyings.Length; i++)
        {
            AppendLine(builder, varyings[i]);
        }

        AppendLine(builder, string.Empty);
        AppendMain(builder, body);
        return builder.ToString();
    }

    private static string BuildFragmentSource(
        ReadOnlySpan<SceneGltfShaderProperty> properties,
        ReadOnlySpan<string> varyings,
        ReadOnlySpan<string> libraryIds,
        ReadOnlySpan<string> body)
    {
        var builder = new StringBuilder(8192);
        AppendLine(builder, "#version 330 core");
        AppendLine(builder, string.Empty);

        for (int i = 0; i < varyings.Length; i++)
        {
            AppendLine(builder, string.Concat("in", varyings[i].AsSpan(3)));
        }

        AppendLine(builder, string.Empty);
        AppendUniforms(builder, properties, SceneGltfShaderStage.Fragment);
        AppendLine(builder, string.Empty);

        for (int i = 0; i < libraryIds.Length; i++)
        {
            AppendLine(builder, SceneGltfShaderLibrary.GetCode(libraryIds[i]));
            AppendLine(builder, string.Empty);
        }

        AppendLine(builder, "out vec4 o_FragColor;");
        AppendLine(builder, string.Empty);
        AppendMain(builder, body);
        return builder.ToString();
    }

    private static void AppendUniforms(
        StringBuilder builder,
        ReadOnlySpan<SceneGltfShaderProperty> properties,
        SceneGltfShaderStage stage)
    {
        for (int i = 0; i < properties.Length; i++)
        {
            SceneGltfShaderProperty property = properties[i];
            if ((property.Stages & stage) == 0)
            {
                continue;
            }

            builder.Append("uniform ").Append(TypeToString(property.Type)).Append(' ').Append(property.Name);
            if (property.IsArray)
            {
                builder.Append('[').Append(property.ArrayLength.ToString(CultureInfo.InvariantCulture)).Append(']');
            }

            builder.Append(';').Append('\n');
        }
    }

    private static void AppendMain(StringBuilder builder, ReadOnlySpan<string> body)
    {
        AppendLine(builder, "void main() {");
        for (int i = 0; i < body.Length; i++)
        {
            AppendLine(builder, body[i]);
        }

        AppendLine(builder, "}");
    }

    private static void AppendLine(StringBuilder builder, string line) =>
        builder.Append(line).Append('\n');

    private static string TypeToString(SceneGltfShaderPropertyType type) => type switch
    {
        SceneGltfShaderPropertyType.Float => "float",
        SceneGltfShaderPropertyType.Int => "int",
        SceneGltfShaderPropertyType.Bool => "bool",
        SceneGltfShaderPropertyType.Vec2 => "vec2",
        SceneGltfShaderPropertyType.Vec3 => "vec3",
        SceneGltfShaderPropertyType.Vec4 => "vec4",
        SceneGltfShaderPropertyType.Mat4 => "mat4",
        _ => "sampler2D"
    };
}
