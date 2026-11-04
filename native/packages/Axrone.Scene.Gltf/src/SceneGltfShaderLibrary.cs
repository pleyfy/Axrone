namespace Axrone.Scene.Gltf;

/// <summary>One reusable GLSL snippet shared by the built-in glTF shaders.</summary>
/// <param name="Id">Stable block identity.</param>
/// <param name="Code">GLSL 330 core source.</param>
public readonly record struct SceneGltfShaderBlock(string Id, string Code);

/// <summary>
/// GLSL 330 core snippets used by the built-in glTF shaders. Every block
/// exposes parameterised functions instead of fixed global state, so custom
/// shaders can include the same snippets without matching built-in varyings.
/// </summary>
public static class SceneGltfShaderLibrary
{
    /// <summary>UV set selection and KHR_texture_transform helpers.</summary>
    public const string UvBlockId = "gltf.uv";

    /// <summary>Cook-Torrance GGX lighting helpers.</summary>
    public const string PbrLightingBlockId = "gltf.pbr-lighting";

    /// <summary>Toon band, rim and highlight helpers.</summary>
    public const string ToonShadingBlockId = "gltf.toon-shading";

    /// <summary>Linear to sRGB conversion helpers.</summary>
    public const string ColorSpaceBlockId = "gltf.color-space";

    /// <summary>Multi-cascade shadow sampling filters.</summary>
    public const string ShadowBlockId = "gltf.shadow";

    /// <summary>Linear, exponential, and height-aware fog.</summary>
    public const string FogBlockId = "gltf.fog";

    private const string UvCode = """
        vec2 selectGltfUv(int texCoord, vec2 uv0, vec2 uv1) {
            return texCoord == 1 ? uv1 : uv0;
        }

        vec2 transformGltfUv(vec2 uv, vec4 st, float rotation) {
            vec2 scaled = uv * st.xy;
            float c = cos(rotation);
            float s = sin(rotation);
            vec2 rotated = vec2(c * scaled.x - s * scaled.y, s * scaled.x + c * scaled.y);
            return rotated + st.zw;
        }
        """;

    private const string PbrLightingCode = """
        const float PI = 3.14159265359;

        float distributionGgx(float NdotH, float roughness) {
            float a = roughness * roughness;
            float a2 = a * a;
            float NdotH2 = NdotH * NdotH;
            float denom = NdotH2 * (a2 - 1.0) + 1.0;
            denom = PI * denom * denom;
            return a2 / max(denom, 1e-7);
        }

        float geometrySchlickGgx(float NdotV, float roughness) {
            float r = roughness + 1.0;
            float k = (r * r) / 8.0;
            return NdotV / (NdotV * (1.0 - k) + k);
        }

        float geometrySmith(float NdotV, float NdotL, float roughness) {
            return geometrySchlickGgx(NdotV, roughness) * geometrySchlickGgx(NdotL, roughness);
        }

        vec3 fresnelSchlick(float cosTheta, vec3 F0) {
            float t = 1.0 - cosTheta;
            float t2 = t * t;
            float t5 = t2 * t2 * t;
            return F0 + (1.0 - F0) * t5;
        }

        vec3 evaluateSpecularBrdf(vec3 N, vec3 V, vec3 L, float roughness) {
            vec3 H = normalize(V + L);
            float NdotH = max(dot(N, H), 0.0);
            float NdotV = max(dot(N, V), 0.001);
            float NdotL = max(dot(N, L), 0.0);
            float VdotH = max(dot(V, H), 0.0);
            if (NdotL <= 0.0) {
                return vec3(0.0);
            }
            float D = distributionGgx(NdotH, roughness);
            float G = geometrySmith(NdotV, NdotL, roughness);
            vec3 F = fresnelSchlick(VdotH, vec3(0.04));
            return (D * G * F) / (4.0 * NdotV * NdotL + 0.001);
        }

        vec3 evaluateGltfDirectLight(vec3 normal, vec3 viewDir, vec3 albedo, float metallic, float roughness, vec3 F0, vec3 lightDir, vec3 lightColor, float intensity) {
            float NdotL = max(dot(normal, lightDir), 0.0);
            if (NdotL <= 0.0) {
                return vec3(0.0);
            }
            vec3 F = fresnelSchlick(max(dot(normalize(viewDir + lightDir), viewDir), 0.0), F0);
            vec3 kD = (vec3(1.0) - F) * (1.0 - metallic);
            vec3 diffuse = kD * albedo / PI;
            vec3 specular = evaluateSpecularBrdf(normal, viewDir, lightDir, roughness);
            return (diffuse + specular) * lightColor * intensity * NdotL;
        }

        vec3 evaluateGltfClearcoat(vec3 normal, vec3 viewDir, float clearcoat, float clearcoatRoughness, vec3 lightDir, vec3 lightColor, float intensity) {
            if (clearcoat <= 0.0) {
                return vec3(0.0);
            }
            float NdotL = max(dot(normal, lightDir), 0.0);
            if (NdotL <= 0.0) {
                return vec3(0.0);
            }
            vec3 H = normalize(viewDir + lightDir);
            float NdotH = max(dot(normal, H), 0.0);
            float NdotV = max(dot(normal, viewDir), 0.001);
            float VdotH = max(dot(viewDir, H), 0.0);
            float D = distributionGgx(NdotH, clearcoatRoughness);
            float G = geometrySchlickGgx(NdotV, clearcoatRoughness) * geometrySchlickGgx(NdotL, clearcoatRoughness);
            float F = 0.04 + 0.96 * pow(1.0 - VdotH, 5.0);
            float spec = (D * G * F) / (4.0 * NdotV * NdotL + 0.001);
            return vec3(spec * clearcoat) * lightColor * intensity * NdotL;
        }

        float rangeAttenuation(float distanceToLight, float range) {
            if (range <= 0.0) {
                return 1.0;
            }
            float atten = clamp(1.0 - distanceToLight / range, 0.0, 1.0);
            return atten * atten;
        }

        float spotAttenuation(vec3 lightDir, vec3 spotDir, float innerConeCosine, float outerConeCosine) {
            float cd = dot(normalize(-lightDir), normalize(spotDir));
            return smoothstep(outerConeCosine, innerConeCosine, cd);
        }
        """;

    private const string ToonShadingCode = """
        float toonBand(float NdotL, float threshold, float smoothness) {
            return smoothstep(threshold - smoothness, threshold + smoothness, NdotL);
        }

        float toonHighlight(float NdotH, float threshold) {
            return smoothstep(threshold - 0.05, threshold + 0.05, NdotH);
        }

        float toonRim(float NdotV, float threshold, float smoothness) {
            float rim = 1.0 - NdotV;
            return smoothstep(threshold - smoothness, threshold + smoothness, rim);
        }
        """;

    private const string ColorSpaceCode = """
        vec3 linearToSrgb(vec3 color) {
            vec3 clamped = clamp(color, vec3(0.0), vec3(1.0));
            vec3 cutoff = step(vec3(0.0031308), clamped);
            vec3 lower = clamped * 12.92;
            vec3 higher = 1.055 * pow(clamped, vec3(1.0 / 2.4)) - 0.055;
            return mix(lower, higher, cutoff);
        }
        """;

    private const string ShadowCode = """
        const float AX_SHADOW_EPSILON = 1e-6;
        const int AX_SHADOW_HARD = 0;
        const int AX_SHADOW_PCF = 1;
        const int AX_SHADOW_PCSS = 2;
        const int AX_SHADOW_ESM = 3;
        const int AX_SHADOW_VSM = 4;

        float gltfShadowSplit(int cascade) {
            if (cascade == 0) return u_ShadowSplits.x;
            if (cascade == 1) return u_ShadowSplits.y;
            if (cascade == 2) return u_ShadowSplits.z;
            return u_ShadowSplits.w;
        }

        int gltfShadowSelectCascade(float viewDepth) {
            for (int i = 0; i < 4; i++) {
                if (i >= u_ShadowCascadeCount) {
                    break;
                }

                if (viewDepth <= gltfShadowSplit(i)) {
                    return i;
                }
            }

            return u_ShadowCascadeCount;
        }

        bool gltfShadowInside(vec3 clip) {
            return clip.x >= 0.0 && clip.x <= 1.0 &&
                clip.y >= 0.0 && clip.y <= 1.0 &&
                clip.z <= 1.0;
        }

        vec3 gltfShadowClip(vec3 worldPosition, int cascade) {
            vec4 space = u_ShadowLightMatrices[cascade] * vec4(worldPosition, 1.0);
            float w = space.w;
            if (abs(w) < AX_SHADOW_EPSILON) {
                w = AX_SHADOW_EPSILON;
            }
            return (space.xyz / w) * 0.5 + 0.5;
        }

        float gltfShadowHard(vec2 uv, float depth) {
            vec2 unit = abs(uv - 0.5);
            if (unit.x > 0.5 || unit.y > 0.5) {
                return 1.0;
            }

            return step(depth, texture(u_ShadowMap, uv).r);
        }

        float gltfShadowPcf(vec2 uv, float depth, vec2 texel) {
            float visible = 0.0;
            for (int x = -1; x <= 1; x++) {
                for (int y = -1; y <= 1; y++) {
                    visible += step(depth, texture(u_ShadowMap, uv + vec2(float(x), float(y)) * texel).r);
                }
            }

            return visible / 9.0;
        }

        float gltfShadowPcss(vec2 uv, float depth, vec2 texel) {
            float blockerSum = 0.0;
            int blockers = 0;
            float maximumDelta = 0.0;

            for (int x = -1; x <= 1; x++) {
                for (int y = -1; y <= 1; y++) {
                    float sample = texture(u_ShadowMap, uv + vec2(float(x), float(y)) * texel).r;
                    if (sample < depth) {
                        blockerSum += sample;
                        blockers++;
                        maximumDelta = max(maximumDelta, depth - sample);
                    }
                }
            }

            if (blockers == 0) {
                return 1.0;
            }

            float width = max(texel.x, AX_SHADOW_EPSILON);
            float radius = clamp(maximumDelta / width, 1.0, 16.0) * width;
            float visible = 0.0;
            for (int x = -2; x <= 2; x++) {
                for (int y = -2; y <= 2; y++) {
                    vec2 offset = vec2(float(x), float(y)) * radius * 0.5;
                    visible += step(depth, texture(u_ShadowMap, uv + offset).r);
                }
            }

            return visible / 25.0;
        }

        float gltfShadowEsm(vec2 uv, float depth, vec2 texel) {
            float k = clamp(20.0 / max(u_ShadowDepthBias, 1e-5), 1.0, 5000.0);
            float average = 0.0;
            for (int x = -1; x <= 1; x++) {
                for (int y = -1; y <= 1; y++) {
                    float sample = max(texture(u_ShadowMap, uv + vec2(float(x), float(y)) * texel).r, 0.0);
                    average += exp(-k * min(sample, 80.0 / k));
                }
            }

            average = max(average / 9.0, 1e-8);
            float estimatedDepth = -log(average) / k;
            float bleed = k * max(depth - estimatedDepth, 0.0);
            float stableBleed = min(bleed, 1000.0);
            float lightBleed = exp(-0.5 * stableBleed * stableBleed);
            float visible = exp(-k * depth) / average;
            return clamp(visible * lightBleed, 0.0, 1.0);
        }

        float gltfShadowVsm(vec2 uv, float depth, vec2 texel) {
            float mean = 0.0;
            float meanSquare = 0.0;
            for (int x = -1; x <= 1; x++) {
                for (int y = -1; y <= 1; y++) {
                    float sample = max(texture(u_ShadowMap, uv + vec2(float(x), float(y)) * texel).r, 0.0);
                    mean += sample;
                    meanSquare += sample * sample;
                }
            }

            mean /= 9.0;
            meanSquare /= 9.0;
            float variance = max(meanSquare - (mean * mean), 1e-6);
            if (depth < mean) {
                return 1.0;
            }

            float difference = depth - mean;
            float probability = min(variance / (variance + (difference * difference)), 1.0);
            return clamp(probability, 0.0, 1.0);
        }

        float gltfShadowFactor(vec2 uv, float depth, vec2 texel) {
            if (u_ShadowFilter == AX_SHADOW_HARD) {
                return gltfShadowHard(uv, depth);
            }

            if (u_ShadowFilter == AX_SHADOW_PCF) {
                return gltfShadowPcf(uv, depth, texel);
            }

            if (u_ShadowFilter == AX_SHADOW_PCSS) {
                return gltfShadowPcss(uv, depth, texel);
            }

            if (u_ShadowFilter == AX_SHADOW_ESM) {
                return gltfShadowEsm(uv, depth, texel);
            }

            if (u_ShadowFilter == AX_SHADOW_VSM) {
                return gltfShadowVsm(uv, depth, texel);
            }

            return gltfShadowPcf(uv, depth, texel);
        }

        float gltfResolveShadowFactor(vec3 worldPosition, vec3 worldNormal, vec3 lightDirection) {
            if (u_ShadowEnabled <= 0 || u_ShadowCascadeCount <= 0) {
                return 1.0;
            }

            vec3 light = normalize(lightDirection);
            float viewDepth = length(u_CameraPosition - worldPosition);
            int cascade = gltfShadowSelectCascade(viewDepth);
            if (cascade >= u_ShadowCascadeCount) {
                return 1.0;
            }

            float ndotl = max(dot(worldNormal, light), 0.0);
            float bias = max(u_ShadowDepthBias * (1.0 - ndotl), u_ShadowDepthBias * 0.1);
            vec3 biasedPosition = worldPosition + worldNormal * max(u_ShadowNormalBias, 0.0);
            vec3 clip = gltfShadowClip(biasedPosition, cascade);
            if (!gltfShadowInside(clip)) {
                return 1.0;
            }

            vec4 tile = u_ShadowTiles[cascade];
            vec2 texelSize = u_ShadowTexelSize / max(tile.zw, vec2(AX_SHADOW_EPSILON));
            float depth = clamp(clip.z - bias, 0.0, 1.0);
            return clamp(gltfShadowFactor(tile.xy + (clip.xy * tile.zw), depth, texelSize), 0.0, 1.0);
        }
        """;

    private const string FogCode = """
        const float AX_FOG_EPSILON = 1e-6;
        const float AX_FOG_MAX_EXPONENT = 80.0;

        float gltfBaseFogFactor(vec3 worldPosition, vec3 cameraPosition) {
            if (u_FogEnabled <= 0) {
                return 0.0;
            }

            float distance = length(worldPosition - cameraPosition);
            if (distance <= AX_FOG_EPSILON) {
                return 0.0;
            }

            if (u_FogMode == 0) {
                float range = max(u_FogStartEnd.y - u_FogStartEnd.x, AX_FOG_EPSILON);
                return clamp((distance - u_FogStartEnd.x) / range, 0.0, 1.0);
            }

            float depth = max(u_FogDensity, 0.0) * distance;
            if (u_FogMode == 2) {
                depth *= depth;
            }

            return clamp(1.0 - exp(-clamp(depth, 0.0, AX_FOG_MAX_EXPONENT)), 0.0, 1.0);
        }

        float gltfHeightRatio(float value, float falloff) {
            if (falloff <= AX_FOG_EPSILON) {
                return 1.0;
            }

            float product = value * falloff;
            if (abs(product) < 1e-4) {
                float product2 = product * product;
                return 1.0 - product * 0.5 + product2 / 6.0 - (product2 * product) / 24.0;
            }

            float clamped = clamp(product, -AX_FOG_MAX_EXPONENT, AX_FOG_MAX_EXPONENT);
            return clamped >= 0.0
                ? (1.0 - exp(-clamped)) / clamped
                : (exp(-clamped) - 1.0) / (-clamped);
        }

        float gltfHeightFogFactor(vec3 worldPosition, vec3 cameraPosition) {
            if (u_HeightFogEnabled <= 0) {
                return 0.0;
            }

            vec3 delta = worldPosition - cameraPosition;
            float distance = length(delta);
            if (distance <= AX_FOG_EPSILON) {
                return 0.0;
            }

            float falloff = max(u_HeightFogFalloff, 0.0);
            float limit = falloff <= AX_FOG_EPSILON ? 0.0 : AX_FOG_MAX_EXPONENT / falloff;
            float height = clamp(cameraPosition.y - u_HeightFogGroundHeight, -limit, limit);
            float density = max(u_HeightFogDensity, 0.0);
            float optical = density * exp(-height) * distance * gltfHeightRatio((delta.y / distance) * distance, falloff);
            return clamp(1.0 - exp(-clamp(max(optical, 0.0), AX_FOG_MAX_EXPONENT)), 0.0, 1.0);
        }

        vec3 gltfApplyFog(vec3 color, vec3 worldPosition, vec3 cameraPosition) {
            float baseFog = gltfBaseFogFactor(worldPosition, cameraPosition);
            if (baseFog > 0.0) {
                color = mix(color, u_FogColor, baseFog);
            }

            float heightFog = gltfHeightFogFactor(worldPosition, cameraPosition);
            if (heightFog > 0.0) {
                color = mix(color, u_HeightFogColor, heightFog);
            }

            return color;
        }
        """;

    private static readonly SceneGltfShaderBlock[] BlockArray =
    [
        new(UvBlockId, UvCode),
        new(PbrLightingBlockId, PbrLightingCode),
        new(ToonShadingBlockId, ToonShadingCode),
        new(ColorSpaceBlockId, ColorSpaceCode),
        new(ShadowBlockId, ShadowCode),
        new(FogBlockId, FogCode)
    ];

    /// <summary>Blocks in declaration order.</summary>
    public static ReadOnlySpan<SceneGltfShaderBlock> Blocks => BlockArray;

    /// <summary>Resolves a block by id.</summary>
    /// <param name="id">Block identity.</param>
    /// <param name="code">Resolved GLSL source.</param>
    /// <returns>Whether the block exists.</returns>
    public static bool TryGetCode(string id, [NotNullWhen(true)] out string? code)
    {
        ArgumentNullException.ThrowIfNull(id);

        ReadOnlySpan<SceneGltfShaderBlock> blocks = BlockArray;
        for (int i = 0; i < blocks.Length; i++)
        {
            if (string.Equals(blocks[i].Id, id, StringComparison.Ordinal))
            {
                code = blocks[i].Code;
                return true;
            }
        }

        code = null;
        return false;
    }

    internal static string GetCode(string id) =>
        TryGetCode(id, out string? code)
            ? code
            : throw new SceneGltfException(
                SceneGltfErrorCodes.Invalid,
                $"Unknown glTF shader library block '{id}'.");
}
