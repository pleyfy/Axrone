namespace Axrone.Scene.Gltf;

using System.Collections.Frozen;
using System.Diagnostics.CodeAnalysis;

/// <summary>
/// Built-in GLSL 330 core Material Contract v2 shaders (<c>gltf/toon-outline</c>,
/// <c>gltf/hair</c>, <c>gltf/cloth</c>, <c>gltf/water</c>, <c>gltf/foliage</c>,
/// <c>gltf/particle</c>, <c>gltf/decal</c>, <c>post-process/contract</c>,
/// and <c>gltf/volume</c>).
/// </summary>
public static class SceneGltfShadersV2
{
    /// <summary>Shader id of the toon outline pass companion shader.</summary>
    public const string ToonOutlineShaderName = "gltf/toon-outline";
    /// <summary>Shader id of the anisotropic hair model family.</summary>
    public const string HairShaderName = "gltf/hair";
    /// <summary>Shader id of the velvet/sheen cloth model family.</summary>
    public const string ClothShaderName = "gltf/cloth";
    /// <summary>Shader id of the stylized water model family.</summary>
    public const string WaterShaderName = "gltf/water";
    /// <summary>Shader id of the wind-driven foliage model family.</summary>
    public const string FoliageShaderName = "gltf/foliage";
    /// <summary>Shader id of the soft additive particle model family.</summary>
    public const string ParticleShaderName = "gltf/particle";
    /// <summary>Shader id of the deferred decal model family.</summary>
    public const string DecalShaderName = "gltf/decal";
    /// <summary>Shader id shared by the post-process model and by contract pass overrides.</summary>
    public const string PostProcessShaderName = "post-process/contract";
    /// <summary>Shader id of the raymarched volumetric model family.</summary>
    public const string VolumeShaderName = "gltf/volume";

    private static readonly string[] V2BaseNames =
    [
        ToonOutlineShaderName,
        HairShaderName,
        ClothShaderName,
        WaterShaderName,
        FoliageShaderName,
        ParticleShaderName,
        DecalShaderName,
        PostProcessShaderName,
        VolumeShaderName
    ];

    private static readonly string[] StandardAttributes =
    [
        "layout(location = 0) in vec3 a_Position;",
        "layout(location = 1) in vec3 a_Normal;",
        "layout(location = 2) in vec2 a_UV0;",
        "layout(location = 3) in vec2 a_UV1;",
        "layout(location = 4) in vec4 a_Tangent;"
    ];

    private static readonly string[] StandardVaryings =
    [
        "out vec2 v_UV0;",
        "out vec2 v_UV1;",
        "out vec3 v_WorldPosition;",
        "out vec3 v_WorldNormal;",
        "out vec4 v_WorldTangent;"
    ];

    private static readonly FrozenDictionary<SceneMeshSemantic, string> StandardAttributeMap =
        new Dictionary<SceneMeshSemantic, string>
        {
            [SceneMeshSemantic.Position] = "a_Position",
            [SceneMeshSemantic.Normal] = "a_Normal",
            [SceneMeshSemantic.Uv0] = "a_UV0",
            [SceneMeshSemantic.Uv1] = "a_UV1",
            [SceneMeshSemantic.Tangent] = "a_Tangent"
        }.ToFrozenDictionary();

    private static readonly FrozenDictionary<string, SceneGltfShaderProperty[]> PropertyCatalogs =
        BuildPropertyCatalogs();

    private static readonly FrozenDictionary<string, SceneShaderDefinition> Cache = BuildCache();

    /// <summary>Ordered property catalog for a built-in V2 shader base name.</summary>
    public static ReadOnlySpan<SceneGltfShaderProperty> GetProperties(string baseName)
    {
        ArgumentNullException.ThrowIfNull(baseName);
        return PropertyCatalogs.TryGetValue(baseName, out SceneGltfShaderProperty[]? list)
            ? list
            : ReadOnlySpan<SceneGltfShaderProperty>.Empty;
    }

    /// <summary>Checks whether a base shader id is one of the 9 built-in V2 shaders.</summary>
    /// <param name="id">Shader id to classify, with or without a variant suffix.</param>
    /// <param name="baseName">The matched V2 base shader id, or <see langword="null"/> when unmatched.</param>
    /// <returns><see langword="true"/> when <paramref name="id"/> belongs to a built-in V2 shader family.</returns>
    public static bool TryClassify(string id, [NotNullWhen(true)] out string? baseName)
    {
        ArgumentNullException.ThrowIfNull(id);
        for (int i = 0; i < V2BaseNames.Length; i++)
        {
            string candidate = V2BaseNames[i];
            if (string.Equals(id, candidate, StringComparison.Ordinal) ||
                (id.Length > candidate.Length &&
                    id.StartsWith(candidate, StringComparison.Ordinal) &&
                    id[candidate.Length] == '/'))
            {
                baseName = candidate;
                return true;
            }
        }

        baseName = null;
        return false;
    }

    /// <summary>Resolves a built-in V2 shader definition by base id or variant suffix.</summary>
    /// <param name="id">Shader id, optionally carrying <c>/blend</c> or <c>/double-sided</c> variants.</param>
    /// <param name="names">Name table used when interning uniform and attribute names; <see langword="null"/> takes the shared cache.</param>
    /// <param name="definition">The resolved shader definition when this method returns <see langword="true"/>.</param>
    /// <returns><see langword="true"/> when <paramref name="id"/> resolves to a built-in V2 shader.</returns>
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

        bool blend = id.AsSpan().Contains(SceneGltfShaders.BlendSuffix, StringComparison.Ordinal);
        bool doubleSided = id.AsSpan().Contains(SceneGltfShaders.DoubleSidedSuffix, StringComparison.Ordinal);
        definition = CreateCore(id, baseName, blend, doubleSided, names);
        return true;
    }

    internal static void AppendKnownProperties(HashSet<string> target)
    {
        foreach (KeyValuePair<string, SceneGltfShaderProperty[]> entry in PropertyCatalogs)
        {
            SceneGltfShaderProperty[] list = entry.Value;
            for (int i = 0; i < list.Length; i++)
            {
                target.Add(list[i].Name);
            }
        }
    }

    private static FrozenDictionary<string, SceneShaderDefinition> BuildCache()
    {
        var cache = new Dictionary<string, SceneShaderDefinition>(StringComparer.Ordinal);
        for (int i = 0; i < V2BaseNames.Length; i++)
        {
            string baseName = V2BaseNames[i];
            cache.Add(baseName, CreateCore(baseName, baseName, blend: false, doubleSided: false, names: null));
            for (int variant = 1; variant < 4; variant++)
            {
                string variantId = SceneGltfShaders.ResolveVariantId(baseName, (variant & 1) != 0, (variant & 2) != 0);
                cache.Add(variantId, CreateCore(variantId, baseName, (variant & 1) != 0, (variant & 2) != 0, names: null));
            }
        }

        return cache.ToFrozenDictionary(StringComparer.Ordinal);
    }

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

        SceneGltfShaderProperty[] properties = PropertyCatalogs[baseName];
        string vertexSource = SceneGltfShaders.BuildVertexSourcePublic(
            properties, StandardAttributes, StandardVaryings, ResolveVertexBody(baseName));
        string fragmentSource = SceneGltfShaders.BuildFragmentSourcePublic(
            properties,
            StandardVaryings,
            [
                SceneGltfShaderLibrary.UvBlockId,
                SceneGltfShaderLibrary.PbrLightingBlockId,
                SceneGltfShaderLibrary.ColorSpaceBlockId,
                SceneGltfShaderLibrary.FogBlockId
            ],
            ResolveFragmentBody(baseName));

        (bool defaultDepthTest, bool defaultCull, bool defaultBlend) = baseName switch
        {
            ToonOutlineShaderName => (true, true, false),
            HairShaderName or ClothShaderName or FoliageShaderName => (true, false, false),
            WaterShaderName or ParticleShaderName => (true, false, true),
            DecalShaderName => (true, true, true),
            PostProcessShaderName => (false, false, true),
            VolumeShaderName => (true, true, true),
            _ => (true, true, false)
        };

        bool cull = doubleSided ? false : defaultCull;
        bool finalBlend = blend || defaultBlend;

        return new SceneShaderDefinition(
            shaderId,
            vertexSource,
            fragmentSource,
            SceneGltfShaderProperties.BuildUniformNames(properties),
            StandardAttributeMap,
            depthTest: defaultDepthTest,
            cull: cull,
            blend: finalBlend);
    }

    private static string[] ResolveVertexBody(string baseName) => baseName switch
    {
        ToonOutlineShaderName =>
        [
            "    vec3 extruded = a_Position + _VertexOffset + normalize(a_Normal) * max(_OutlineWidth, 0.0);",
            "    vec4 worldPosition = u_Model * vec4(extruded, 1.0);",
            "    v_WorldPosition = worldPosition.xyz;",
            "    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);",
            "    v_WorldTangent = vec4(normalize(mat3(u_Model) * a_Tangent.xyz), a_Tangent.w);",
            "    v_UV0 = a_UV0;",
            "    v_UV1 = a_UV1;",
            "    gl_Position = u_Projection * u_View * worldPosition;"
        ],
        WaterShaderName =>
        [
            "    vec3 localPos = a_Position + _VertexOffset;",
            "    float wavePhase = localPos.x * _WaterWaveFrequency + localPos.z * (_WaterWaveFrequency * 0.8) + u_Elapsed * _WaterWaveSpeed;",
            "    localPos.y += sin(wavePhase) * _WaterWaveAmplitude + cos(wavePhase * 0.73) * (_WaterWaveAmplitude * 0.5);",
            "    vec4 worldPosition = u_Model * vec4(localPos, 1.0);",
            "    v_WorldPosition = worldPosition.xyz;",
            "    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);",
            "    v_WorldTangent = vec4(normalize(mat3(u_Model) * a_Tangent.xyz), a_Tangent.w);",
            "    v_UV0 = a_UV0;",
            "    v_UV1 = a_UV1;",
            "    gl_Position = u_Projection * u_View * worldPosition;"
        ],
        FoliageShaderName =>
        [
            "    vec3 localPos = a_Position + _VertexOffset;",
            "    float swayPhase = localPos.y * _WindTurbulence + localPos.x * 0.6 + u_Elapsed * _WindSpeed;",
            "    float heightWeight = clamp(localPos.y, 0.0, 2.0);",
            "    localPos.x += sin(swayPhase) * _WindStrength * heightWeight;",
            "    localPos.z += cos(swayPhase * 0.8) * _WindStrength * 0.5 * heightWeight;",
            "    vec4 worldPosition = u_Model * vec4(localPos, 1.0);",
            "    v_WorldPosition = worldPosition.xyz;",
            "    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);",
            "    v_WorldTangent = vec4(normalize(mat3(u_Model) * a_Tangent.xyz), a_Tangent.w);",
            "    v_UV0 = a_UV0;",
            "    v_UV1 = a_UV1;",
            "    gl_Position = u_Projection * u_View * worldPosition;"
        ],
        _ =>
        [
            "    vec4 worldPosition = u_Model * vec4(a_Position + _VertexOffset, 1.0);",
            "    v_WorldPosition = worldPosition.xyz;",
            "    v_WorldNormal = normalize(mat3(u_Model) * a_Normal);",
            "    v_WorldTangent = vec4(normalize(mat3(u_Model) * a_Tangent.xyz), a_Tangent.w);",
            "    v_UV0 = a_UV0;",
            "    v_UV1 = a_UV1;",
            "    gl_Position = u_Projection * u_View * worldPosition;"
        ]
    };

    private static string[] ResolveFragmentBody(string baseName) => baseName switch
    {
        ToonOutlineShaderName =>
        [
            "    if (_OutlineWidth <= 0.0001) { discard; }",
            "    vec3 color = gltfApplyFog(_OutlineColor, v_WorldPosition, u_CameraPosition);",
            "    color = u_OutputGamma < 0.99 ? linearToSrgb(color) : pow(max(color, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(color, 1.0);"
        ],
        HairShaderName =>
        [
            ..BaseColorBlock(),
            ..WorldNormalBlock(),
            "    vec3 N = resolvedNormal;",
            "    vec3 T = normalize(length(v_WorldTangent.xyz) > 0.001 ? cross(N, v_WorldTangent.xyz) : _HairStrandDirection);",
            "    vec3 V = normalize(u_CameraPosition - v_WorldPosition);",
            "    float specExp = mix(256.0, 16.0, clamp(_HairRoughness, 0.04, 1.0));",
            "    vec3 lighting = baseColor.rgb * 0.12;",
            "    if (u_ReceiveLighting) {",
            "        vec3 L = length(u_LightDirection) > 1e-5 ? normalize(-u_LightDirection) : vec3(0.0, 1.0, 0.0);",
            "        vec3 H = normalize(L + V);",
            "        float th1 = dot(normalize(T + N * _HairSpecularShift), H);",
            "        float th2 = dot(normalize(T + N * _HairSecondaryShift), H);",
            "        float spec1 = pow(sqrt(max(0.0, 1.0 - th1 * th1)), specExp);",
            "        float spec2 = pow(sqrt(max(0.0, 1.0 - th2 * th2)), specExp * 0.5);",
            "        float wrapDiff = clamp((dot(N, L) + 0.45) / 1.45, 0.0, 1.0);",
            "        lighting += (baseColor.rgb * wrapDiff + _HairScatterColor * (1.0 - wrapDiff) * 0.35 + _HairPrimaryColor * spec1 * 0.65 + _HairSecondaryColor * spec2 * 0.4) * u_LightColor * u_LightIntensity;",
            "    }",
            "    lighting *= clamp(_OcclusionFactor, 0.0, 1.0);",
            "    vec3 finalColor = gltfApplyFog(lighting + _EmissiveFactor * _EmissiveIntensity, v_WorldPosition, u_CameraPosition);",
            "    finalColor = u_OutputGamma < 0.99 ? linearToSrgb(finalColor) : pow(max(finalColor, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(finalColor, _AlphaMode == 2 ? baseColor.a : 1.0);"
        ],
        ClothShaderName =>
        [
            ..BaseColorBlock(),
            ..WorldNormalBlock(),
            "    vec3 N = resolvedNormal;",
            "    vec3 V = normalize(u_CameraPosition - v_WorldPosition);",
            "    float NdotV = max(dot(N, V), 0.0);",
            "    float sheenRim = pow(1.0 - NdotV, mix(5.0, 1.5, clamp(_ClothFuzzRoughness, 0.04, 1.0))) * clamp(_ClothSheenScale, 0.0, 2.0);",
            "    vec3 lighting = baseColor.rgb * 0.14;",
            "    if (u_ReceiveLighting) {",
            "        vec3 L = length(u_LightDirection) > 1e-5 ? normalize(-u_LightDirection) : vec3(0.0, 1.0, 0.0);",
            "        float NdotL = max(dot(N, L), 0.0);",
            "        float wrap = clamp((dot(N, L) + 0.5) / 1.5, 0.0, 1.0);",
            "        vec3 fabricDiff = baseColor.rgb * NdotL + _SubsurfaceColorFactor * (wrap - NdotL) * clamp(_SubsurfaceFactor, 0.0, 1.0);",
            "        lighting += (fabricDiff + _ClothFuzzColor * sheenRim * (0.25 + 0.75 * NdotL)) * u_LightColor * u_LightIntensity;",
            "    }",
            "    lighting *= clamp(_OcclusionFactor, 0.0, 1.0);",
            "    vec3 finalColor = gltfApplyFog(lighting + _EmissiveFactor * _EmissiveIntensity, v_WorldPosition, u_CameraPosition);",
            "    finalColor = u_OutputGamma < 0.99 ? linearToSrgb(finalColor) : pow(max(finalColor, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(finalColor, _AlphaMode == 2 ? baseColor.a : 1.0);"
        ],
        WaterShaderName =>
        [
            ..BaseColorBlock(),
            "    vec3 N = normalize(v_WorldNormal + vec3(sin(v_UV0.x * _WaterRippleScale + u_Elapsed * _WaterRippleSpeed) * 0.08, 0.0, cos(v_UV0.y * _WaterRippleScale - u_Elapsed * _WaterRippleSpeed) * 0.08));",
            "    vec3 V = normalize(u_CameraPosition - v_WorldPosition);",
            "    float fresnel = pow(1.0 - max(dot(N, V), 0.0), max(_WaterFresnelPower, 0.5));",
            "    vec3 waterColor = mix(_WaterDeepColor, baseColor.rgb, clamp(1.0 - fresnel * 0.65, 0.0, 1.0));",
            "    float ripplePeak = abs(sin(v_UV0.x * _WaterRippleScale + u_Elapsed * _WaterRippleSpeed) * cos(v_UV0.y * _WaterRippleScale));",
            "    float foamMask = smoothstep(_WaterFoamThreshold, 1.0, ripplePeak + fresnel * 0.25);",
            "    vec3 finalColor = gltfApplyFog(mix(waterColor, _WaterFoamColor, clamp(foamMask, 0.0, 1.0)) + _EmissiveFactor * _EmissiveIntensity, v_WorldPosition, u_CameraPosition);",
            "    finalColor = u_OutputGamma < 0.99 ? linearToSrgb(finalColor) : pow(max(finalColor, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(finalColor, clamp(baseColor.a + foamMask * 0.2, 0.0, 1.0));"
        ],
        FoliageShaderName =>
        [
            ..BaseColorBlock(),
            ..WorldNormalBlock(),
            "    vec3 N = gl_FrontFacing ? resolvedNormal : -resolvedNormal;",
            "    vec3 V = normalize(u_CameraPosition - v_WorldPosition);",
            "    vec3 lighting = baseColor.rgb * 0.14;",
            "    if (u_ReceiveLighting) {",
            "        vec3 L = length(u_LightDirection) > 1e-5 ? normalize(-u_LightDirection) : vec3(0.0, 1.0, 0.0);",
            "        float NdotL = max(dot(N, L), 0.0);",
            "        float backLight = pow(max(dot(V, -L), 0.0), max(_FoliageSubsurfacePower, 0.5)) * clamp(_FoliageTranslucency, 0.0, 1.0);",
            "        lighting += (baseColor.rgb * NdotL + _SubsurfaceColorFactor * backLight) * u_LightColor * u_LightIntensity;",
            "    }",
            "    lighting *= clamp(_OcclusionFactor, 0.0, 1.0);",
            "    vec3 finalColor = gltfApplyFog(lighting + _EmissiveFactor * _EmissiveIntensity, v_WorldPosition, u_CameraPosition);",
            "    finalColor = u_OutputGamma < 0.99 ? linearToSrgb(finalColor) : pow(max(finalColor, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(finalColor, _AlphaMode == 2 ? baseColor.a : 1.0);"
        ],
        ParticleShaderName =>
        [
            ..BaseColorBlock(),
            "    float edgeDist = length(v_UV0 - vec2(0.5)) * 2.0;",
            "    float softFalloff = 1.0 - smoothstep(clamp(1.0 - _ParticleSoftness, 0.0, 0.99), 1.0, edgeDist);",
            "    vec3 rgb = baseColor.rgb * (1.0 + _ParticleAdditiveMix) + _EmissiveFactor * _EmissiveIntensity;",
            "    rgb = u_OutputGamma < 0.99 ? linearToSrgb(rgb) : pow(max(rgb, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(rgb, clamp(baseColor.a * softFalloff, 0.0, 1.0));"
        ],
        DecalShaderName =>
        [
            ..BaseColorBlock(),
            ..WorldNormalBlock(),
            "    vec3 N = resolvedNormal;",
            "    vec3 V = normalize(u_CameraPosition - v_WorldPosition);",
            "    float angleAtten = smoothstep(0.0, max(_DecalAngleFade, 0.01), max(dot(N, V), 0.0));",
            "    vec3 color = baseColor.rgb * (0.25 + 0.75 * clamp(_OcclusionFactor, 0.0, 1.0)) + _EmissiveFactor * _EmissiveIntensity;",
            "    color = u_OutputGamma < 0.99 ? linearToSrgb(color) : pow(max(color, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(color, clamp(baseColor.a * _DecalBlend * angleAtten, 0.0, 1.0));"
        ],
        VolumeShaderName =>
        [
            "    vec3 rayDir = normalize(v_WorldPosition - u_CameraPosition);",
            "    float marchLength = max(length(v_WorldPosition - u_CameraPosition), 0.1);",
            "    float stepSize = clamp(marchLength / 16.0, 0.02, 0.35);",
            "    float transmittance = 1.0;",
            "    vec3 inScatter = vec3(0.0);",
            "    vec3 lightDir = length(u_LightDirection) > 1e-5 ? normalize(-u_LightDirection) : vec3(0.0, 1.0, 0.0);",
            "    vec3 lightCol = u_LightColor * u_LightIntensity;",
            "    float cosTheta = dot(rayDir, lightDir);",
            "    float g = clamp(_VolumeAnisotropy, -0.85, 0.85);",
            "    float hgPhase = (1.0 - g * g) / (4.0 * 3.14159265 * pow(max(1.0 + g * g - 2.0 * g * cosTheta, 0.01), 1.5));",
            "    for (int stepIdx = 0; stepIdx < 16; stepIdx += 1) {",
            "        vec3 p = v_WorldPosition - rayDir * (float(stepIdx) * stepSize);",
            "        vec3 pAnimated = p * 1.4 + vec3(u_Elapsed * 0.12, u_Elapsed * 0.05, 0.0);",
            "        float field = 0.5 + 0.5 * (sin(pAnimated.x) * cos(pAnimated.y) * sin(pAnimated.z));",
            "        float density = max(0.0, field * _VolumeDensity);",
            "        float sigmaT = max(_VolumeAbsorption, 0.01) * density;",
            "        float stepExtinction = exp(-sigmaT * stepSize);",
            "        vec3 scatterSample = _BaseColorFactor.rgb * _VolumeScatterColor * (vec3(0.25) + lightCol * hgPhase * 2.5);",
            "        inScatter += transmittance * scatterSample * (1.0 - stepExtinction);",
            "        transmittance *= stepExtinction;",
            "        if (transmittance < 0.02) { break; }",
            "    }",
            "    vec3 volColor = inScatter + _EmissiveFactor * _EmissiveIntensity * (1.0 - transmittance);",
            "    vec3 finalColor = gltfApplyFog(volColor, v_WorldPosition, u_CameraPosition);",
            "    finalColor = u_OutputGamma < 0.99 ? linearToSrgb(finalColor) : pow(max(finalColor, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(finalColor, clamp(1.0 - transmittance, 0.0, 1.0));"
        ],
        _ =>
        [
            ..BaseColorBlock(),
            "    vec3 color = baseColor.rgb * _PostTintColor;",
            "    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));",
            "    color = mix(vec3(luma), color, max(_PostSaturation, 0.0));",
            "    color = (color - 0.5) * max(_PostContrast, 0.0) + 0.5;",
            "    float vignetteDist = length(v_UV0 - vec2(0.5)) * 1.4142;",
            "    color *= clamp(1.0 - pow(vignetteDist, 2.0) * _PostVignetteIntensity, 0.0, 1.0);",
            "    vec3 graded = max(color + _EmissiveFactor * _EmissiveIntensity, vec3(0.0));",
            "    graded = u_OutputGamma < 0.99 ? linearToSrgb(graded) : pow(max(graded, vec3(0.0)), vec3(u_OutputGamma));",
            "    o_FragColor = vec4(graded, clamp(baseColor.a * _PostBlendFactor, 0.0, 1.0));"
        ]
    };

    private static string[] BaseColorBlock() =>
    [
        "    vec4 baseColor = _BaseColorFactor;",
        "    baseColor.a *= clamp(_OpacityFactor, 0.0, 1.0);",
        "    if (_BaseColorTexture_TexCoord >= 0) {",
        "        vec2 uv = transformGltfUv(selectGltfUv(_BaseColorTexture_TexCoord, v_UV0, v_UV1), _BaseColorTexture_ST, _BaseColorTexture_Rotation);",
        "        baseColor *= texture(u_AlbedoMap, uv);",
        "    }",
        "    if (_OpacityTexture_TexCoord >= 0) {",
        "        vec2 opUv = transformGltfUv(selectGltfUv(_OpacityTexture_TexCoord, v_UV0, v_UV1), _OpacityTexture_ST, _OpacityTexture_Rotation);",
        "        baseColor.a *= texture(_OpacityTexture, opUv).r;",
        "    }",
        "    if (_AlphaMode == 1 && baseColor.a < u_AlphaCutoff) {",
        "        discard;",
        "    }"
    ];

    private static string[] WorldNormalBlock() =>
    [
        "    vec3 resolvedNormal = length(v_WorldNormal) > 0.0001 ? normalize(v_WorldNormal) : vec3(0.0, 0.0, 1.0);",
        "    if (_NormalTexture_TexCoord >= 0 && length(v_WorldTangent.xyz) > 0.0001) {",
        "        vec2 nuv = transformGltfUv(selectGltfUv(_NormalTexture_TexCoord, v_UV0, v_UV1), _NormalTexture_ST, _NormalTexture_Rotation);",
        "        vec3 tn = texture(u_NormalMap, nuv).xyz * 2.0 - 1.0;",
        "        tn.xy *= u_NormalScale;",
        "        vec3 t = normalize(v_WorldTangent.xyz);",
        "        vec3 b = normalize(cross(resolvedNormal, t)) * (v_WorldTangent.w == 0.0 ? 1.0 : v_WorldTangent.w);",
        "        resolvedNormal = normalize(mat3(t, b, resolvedNormal) * tn);",
        "    }"
    ];

    private static FrozenDictionary<string, SceneGltfShaderProperty[]> BuildPropertyCatalogs()
    {
        var map = new Dictionary<string, SceneGltfShaderProperty[]>(StringComparer.Ordinal);
        map[ToonOutlineShaderName] = BuildOutlineProperties();
        map[HairShaderName] = BuildSurfaceV2Properties(
            MatFrag("_HairSpecularShift", SceneGltfShaderPropertyType.Float),
            MatFrag("_HairSecondaryShift", SceneGltfShaderPropertyType.Float),
            MatFrag("_HairPrimaryColor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_HairSecondaryColor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_HairRoughness", SceneGltfShaderPropertyType.Float),
            MatFrag("_HairScatterColor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_HairStrandDirection", SceneGltfShaderPropertyType.Vec3));
        map[ClothShaderName] = BuildSurfaceV2Properties(
            MatFrag("_ClothFuzzColor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_ClothFuzzRoughness", SceneGltfShaderPropertyType.Float),
            MatFrag("_ClothSheenScale", SceneGltfShaderPropertyType.Float),
            MatFrag("_SubsurfaceFactor", SceneGltfShaderPropertyType.Float),
            MatFrag("_SubsurfaceColorFactor", SceneGltfShaderPropertyType.Vec3));
        map[WaterShaderName] = BuildSurfaceV2Properties(
            MatBoth("_WaterWaveAmplitude", SceneGltfShaderPropertyType.Float),
            MatBoth("_WaterWaveFrequency", SceneGltfShaderPropertyType.Float),
            MatBoth("_WaterWaveSpeed", SceneGltfShaderPropertyType.Float),
            MatFrag("_WaterDeepColor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_WaterFresnelPower", SceneGltfShaderPropertyType.Float),
            MatFrag("_WaterRippleScale", SceneGltfShaderPropertyType.Float),
            MatFrag("_WaterRippleSpeed", SceneGltfShaderPropertyType.Float),
            MatFrag("_WaterFoamColor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_WaterFoamThreshold", SceneGltfShaderPropertyType.Float));
        map[FoliageShaderName] = BuildSurfaceV2Properties(
            MatBoth("_WindStrength", SceneGltfShaderPropertyType.Float),
            MatBoth("_WindSpeed", SceneGltfShaderPropertyType.Float),
            MatBoth("_WindTurbulence", SceneGltfShaderPropertyType.Float),
            MatFrag("_FoliageTranslucency", SceneGltfShaderPropertyType.Float),
            MatFrag("_SubsurfaceColorFactor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_FoliageSubsurfacePower", SceneGltfShaderPropertyType.Float));
        map[ParticleShaderName] = BuildSurfaceV2Properties(
            MatFrag("_ParticleSoftness", SceneGltfShaderPropertyType.Float),
            MatFrag("_FlipbookProgress", SceneGltfShaderPropertyType.Float),
            MatFrag("_ParticleAdditiveMix", SceneGltfShaderPropertyType.Float));
        map[DecalShaderName] = BuildSurfaceV2Properties(
            MatFrag("_DecalBlend", SceneGltfShaderPropertyType.Float),
            MatFrag("_DecalAngleFade", SceneGltfShaderPropertyType.Float));
        map[PostProcessShaderName] = BuildSurfaceV2Properties(
            MatFrag("_PostTintColor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_PostVignetteIntensity", SceneGltfShaderPropertyType.Float),
            MatFrag("_PostSaturation", SceneGltfShaderPropertyType.Float),
            MatFrag("_PostContrast", SceneGltfShaderPropertyType.Float),
            MatFrag("_PostBlendFactor", SceneGltfShaderPropertyType.Float));
        map[VolumeShaderName] = BuildSurfaceV2Properties(
            MatFrag("_VolumeDensity", SceneGltfShaderPropertyType.Float),
            MatFrag("_VolumeAbsorption", SceneGltfShaderPropertyType.Float),
            MatFrag("_VolumeScatterColor", SceneGltfShaderPropertyType.Vec3),
            MatFrag("_VolumeAnisotropy", SceneGltfShaderPropertyType.Float));
        return map.ToFrozenDictionary(StringComparer.Ordinal);
    }

    private static SceneGltfShaderProperty[] BuildOutlineProperties()
    {
        var list = new List<SceneGltfShaderProperty>(32);
        AppendCommonProperties(list);
        list.Add(new("_OutlineWidth", SceneGltfShaderPropertyType.Float, SceneGltfShaderStage.Vertex | SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Material));
        list.Add(MatFrag("_OutlineColor", SceneGltfShaderPropertyType.Vec3));
        return [.. list];
    }

    private static SceneGltfShaderProperty[] BuildSurfaceV2Properties(params SceneGltfShaderProperty[] extra)
    {
        var list = new List<SceneGltfShaderProperty>(96);
        AppendCommonProperties(list);
        list.AddRange(extra);
        return [.. list];
    }

    private static void AppendCommonProperties(List<SceneGltfShaderProperty> list)
    {
        list.Add(new("u_Model", SceneGltfShaderPropertyType.Mat4, SceneGltfShaderStage.Vertex, SceneGltfShaderScope.Object));
        list.Add(new("u_View", SceneGltfShaderPropertyType.Mat4, SceneGltfShaderStage.Vertex, SceneGltfShaderScope.Camera));
        list.Add(new("u_Projection", SceneGltfShaderPropertyType.Mat4, SceneGltfShaderStage.Vertex, SceneGltfShaderScope.Camera));
        list.Add(new("u_Elapsed", SceneGltfShaderPropertyType.Float, SceneGltfShaderStage.Vertex | SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("_VertexOffset", SceneGltfShaderPropertyType.Vec3, SceneGltfShaderStage.Vertex, SceneGltfShaderScope.Material));
        list.Add(new("u_CameraPosition", SceneGltfShaderPropertyType.Vec3, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Camera));
        list.Add(new("u_ReceiveLighting", SceneGltfShaderPropertyType.Bool, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.System));
        list.Add(new("u_OutputGamma", SceneGltfShaderPropertyType.Float, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_LightDirection", SceneGltfShaderPropertyType.Vec3, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_LightColor", SceneGltfShaderPropertyType.Vec3, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_LightIntensity", SceneGltfShaderPropertyType.Float, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_FogEnabled", SceneGltfShaderPropertyType.Int, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_FogColor", SceneGltfShaderPropertyType.Vec3, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_FogMode", SceneGltfShaderPropertyType.Int, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_FogDensity", SceneGltfShaderPropertyType.Float, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_FogStartEnd", SceneGltfShaderPropertyType.Vec2, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_HeightFogEnabled", SceneGltfShaderPropertyType.Int, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_HeightFogColor", SceneGltfShaderPropertyType.Vec3, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_HeightFogDensity", SceneGltfShaderPropertyType.Float, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_HeightFogFalloff", SceneGltfShaderPropertyType.Float, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(new("u_HeightFogGroundHeight", SceneGltfShaderPropertyType.Float, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Frame));
        list.Add(MatFrag("u_AlbedoMap", SceneGltfShaderPropertyType.Sampler2D));
        list.Add(MatFrag("u_NormalMap", SceneGltfShaderPropertyType.Sampler2D));
        list.Add(MatFrag("u_NormalScale", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("u_AlphaCutoff", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("_AlphaMode", SceneGltfShaderPropertyType.Int));
        list.Add(MatFrag("_AlphaCutoff", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("_DoubleSided", SceneGltfShaderPropertyType.Int));
        list.Add(MatFrag("_BaseColorFactor", SceneGltfShaderPropertyType.Vec4));
        list.Add(MatFrag("_BaseColorTexture", SceneGltfShaderPropertyType.Sampler2D));
        list.Add(MatFrag("_BaseColorTexture_ST", SceneGltfShaderPropertyType.Vec4));
        list.Add(MatFrag("_BaseColorTexture_Rotation", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("_BaseColorTexture_TexCoord", SceneGltfShaderPropertyType.Int));
        list.Add(MatFrag("_NormalTexture", SceneGltfShaderPropertyType.Sampler2D));
        list.Add(MatFrag("_NormalTexture_ST", SceneGltfShaderPropertyType.Vec4));
        list.Add(MatFrag("_NormalTexture_Rotation", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("_NormalTexture_TexCoord", SceneGltfShaderPropertyType.Int));
        list.Add(MatFrag("_OpacityTexture", SceneGltfShaderPropertyType.Sampler2D));
        list.Add(MatFrag("_OpacityTexture_ST", SceneGltfShaderPropertyType.Vec4));
        list.Add(MatFrag("_OpacityTexture_Rotation", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("_OpacityTexture_TexCoord", SceneGltfShaderPropertyType.Int));
        list.Add(MatFrag("_EmissiveFactor", SceneGltfShaderPropertyType.Vec3));
        list.Add(MatFrag("_EmissiveIntensity", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("_OcclusionFactor", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("_OpacityFactor", SceneGltfShaderPropertyType.Float));
        list.Add(MatFrag("_DepthOffset", SceneGltfShaderPropertyType.Float));
    }

    private static SceneGltfShaderProperty MatFrag(string name, SceneGltfShaderPropertyType type) =>
        new(name, type, SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Material);

    private static SceneGltfShaderProperty MatBoth(string name, SceneGltfShaderPropertyType type) =>
        new(name, type, SceneGltfShaderStage.Vertex | SceneGltfShaderStage.Fragment, SceneGltfShaderScope.Material);
}
