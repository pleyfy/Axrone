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

    private static readonly SceneGltfShaderBlock[] BlockArray =
    [
        new(UvBlockId, UvCode),
        new(PbrLightingBlockId, PbrLightingCode),
        new(ToonShadingBlockId, ToonShadingCode),
        new(ColorSpaceBlockId, ColorSpaceCode)
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
