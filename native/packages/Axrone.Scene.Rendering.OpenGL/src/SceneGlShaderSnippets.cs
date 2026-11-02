namespace Axrone.Scene.Rendering.OpenGL;

/// <summary>GLSL snippets that material shaders can embed to consume renderer state.</summary>
public static class SceneGlShaderSnippets
{
    /// <summary>
    /// Area-light uniforms and analytic evaluator. The CPU equivalent is
    /// <see cref="SceneAreaLightShading"/>; both clamp the contribution to the
    /// emitter's total radiance.
    /// </summary>
    public const string AreaLights = """
        #define AX_MAX_AREA_LIGHTS 4
        uniform int u_AreaLightCount;
        uniform vec3 u_AreaLightPosition[AX_MAX_AREA_LIGHTS];
        uniform vec3 u_AreaLightRight[AX_MAX_AREA_LIGHTS];
        uniform vec3 u_AreaLightUp[AX_MAX_AREA_LIGHTS];
        uniform vec3 u_AreaLightColor[AX_MAX_AREA_LIGHTS];
        uniform vec4 u_AreaLightParams[AX_MAX_AREA_LIGHTS];

        vec3 EvaluateAreaLights(vec3 worldPosition, vec3 normal)
        {
            vec3 result = vec3(0.0);
            int count = min(u_AreaLightCount, AX_MAX_AREA_LIGHTS);
            for (int i = 0; i < count; i++)
            {
                vec3 right = u_AreaLightRight[i];
                vec3 up = u_AreaLightUp[i];
                vec3 delta = worldPosition - u_AreaLightPosition[i];
                float localX = dot(delta, right);
                float localY = dot(delta, up);
                vec4 params = u_AreaLightParams[i];
                float halfWidth = max(params.y, 1e-6);
                float halfHeight = max(params.z, 1e-6);
                float representativeX = clamp(localX, -halfWidth, halfWidth);
                float representativeY = clamp(localY, -halfHeight, halfHeight);

                if (params.x > 0.5)
                {
                    float radius = max(halfWidth, halfHeight);
                    float radial = sqrt(localX * localX + localY * localY);
                    float scale = radial > radius ? radius / radial : 1.0;
                    representativeX = localX * scale;
                    representativeY = localY * scale;
                }

                vec3 representative = u_AreaLightPosition[i] + right * representativeX + up * representativeY;
                vec3 toLight = representative - worldPosition;
                float distanceSquared = max(dot(toLight, toLight), 1e-6);
                vec3 direction = toLight / sqrt(distanceSquared);
                float cosine = max(dot(normal, direction), 0.0);
                float area = params.x > 0.5
                    ? 3.14159265 * max(halfWidth, halfHeight) * max(halfWidth, halfHeight)
                    : 4.0 * halfWidth * halfHeight;
                float solidAngle = min(area / distanceSquared, 3.14159265);
                float range = max(params.w, 1e-6);
                float attenuation = 1.0 / (1.0 + distanceSquared / (range * range));
                result += u_AreaLightColor[i] * (solidAngle / 3.14159265) * attenuation * cosine;
            }

            return result;
        }
        """;

    /// <summary>
    /// Reflection-probe uniforms. The renderer binds the selected cubemap to
    /// <c>u_ReflectionProbe</c> and supplies intensity and world extents.
    /// </summary>
    public const string ReflectionProbe = """
        uniform samplerCube u_ReflectionProbe;
        uniform float u_ReflectionProbeIntensity;
        uniform vec3 u_ReflectionProbePosition;
        uniform vec3 u_ReflectionProbeExtents;

        vec3 SampleReflectionProbe(vec3 worldPosition, vec3 normal, float roughness)
        {
            vec3 direction = reflect(normalize(worldPosition - u_ReflectionProbePosition), normal);
            vec3 color = textureLod(u_ReflectionProbe, direction, roughness).rgb;
            return color * u_ReflectionProbeIntensity;
        }

        float ReflectionProbeWeight(vec3 worldPosition)
        {
            vec3 extent = max(u_ReflectionProbeExtents, vec3(1e-6));
            vec3 d = abs(worldPosition - u_ReflectionProbePosition) / extent;
            return 1.0 - smoothstep(0.8, 1.0, max(max(d.x, d.y), d.z));
        }
        """;

    /// <summary>
    /// glTF material-extension uniforms and sampling helpers. Features are
    /// gated by <c>u_*Enabled</c>; maps are only sampled when the matching
    /// <c>u_Has*Map</c> flag is set, so missing maps fall back to scalars.
    /// </summary>
    public const string MaterialExtensions = """
        uniform int u_ClearcoatEnabled;
        uniform float u_Clearcoat;
        uniform float u_ClearcoatRoughness;
        uniform float u_ClearcoatNormalScale;
        uniform int u_HasClearcoatMap;
        uniform int u_HasClearcoatRoughnessMap;
        uniform int u_HasClearcoatNormalMap;
        uniform sampler2D u_ClearcoatMap;
        uniform sampler2D u_ClearcoatRoughnessMap;
        uniform sampler2D u_ClearcoatNormalMap;

        uniform int u_SheenEnabled;
        uniform vec3 u_SheenColor;
        uniform float u_SheenRoughness;
        uniform int u_HasSheenColorMap;
        uniform int u_HasSheenRoughnessMap;
        uniform sampler2D u_SheenColorMap;
        uniform sampler2D u_SheenRoughnessMap;

        uniform int u_TransmissionEnabled;
        uniform float u_Transmission;
        uniform float u_Ior;
        uniform float u_Thickness;
        uniform float u_AttenuationDistance;
        uniform vec3 u_AttenuationColor;
        uniform int u_HasTransmissionMap;
        uniform sampler2D u_TransmissionMap;

        uniform int u_IridescenceEnabled;
        uniform float u_Iridescence;
        uniform float u_IridescenceIor;
        uniform float u_IridescenceThicknessMinimum;
        uniform float u_IridescenceThicknessMaximum;
        uniform int u_HasIridescenceMap;
        uniform int u_HasIridescenceThicknessMap;
        uniform sampler2D u_IridescenceMap;
        uniform sampler2D u_IridescenceThicknessMap;

        uniform int u_SubsurfaceEnabled;
        uniform float u_Subsurface;
        uniform vec3 u_SubsurfaceColor;
        uniform float u_SubsurfaceThickness;
        uniform int u_HasSubsurfaceMap;
        uniform sampler2D u_SubsurfaceMap;

        uniform float u_Specular;
        uniform vec3 u_SpecularColor;
        uniform float u_Anisotropy;
        uniform float u_AnisotropyRotation;

        float ClearcoatWeight(vec2 uv)
        {
            if (u_ClearcoatEnabled == 0) return 0.0;
            return u_HasClearcoatMap != 0 ? u_Clearcoat * texture(u_ClearcoatMap, uv).r : u_Clearcoat;
        }

        float ClearcoatRoughnessValue(vec2 uv)
        {
            if (u_ClearcoatEnabled == 0) return 0.0;
            return u_HasClearcoatRoughnessMap != 0
                ? u_ClearcoatRoughness * texture(u_ClearcoatRoughnessMap, uv).r
                : u_ClearcoatRoughness;
        }

        vec3 ApplyClearcoatNormal(vec2 uv, vec3 normal)
        {
            if (u_ClearcoatEnabled == 0 || u_HasClearcoatNormalMap == 0) return normal;
            vec3 sampled = texture(u_ClearcoatNormalMap, uv).xyz * 2.0 - 1.0;
            return normalize(normal + sampled * u_ClearcoatNormalScale);
        }

        vec3 SheenColorValue(vec2 uv)
        {
            if (u_SheenEnabled == 0) return vec3(0.0);
            return u_HasSheenColorMap != 0 ? u_SheenColor * texture(u_SheenColorMap, uv).rgb : u_SheenColor;
        }

        float SheenRoughnessValue(vec2 uv)
        {
            if (u_SheenEnabled == 0) return 0.5;
            return u_HasSheenRoughnessMap != 0
                ? u_SheenRoughness * texture(u_SheenRoughnessMap, uv).r
                : u_SheenRoughness;
        }

        float TransmissionWeight(vec2 uv)
        {
            if (u_TransmissionEnabled == 0) return 0.0;
            return u_HasTransmissionMap != 0 ? u_Transmission * texture(u_TransmissionMap, uv).r : u_Transmission;
        }

        vec4 VolumeParameters()
        {
            return vec4(u_Ior, u_Thickness, u_AttenuationDistance, 0.0);
        }

        vec3 AttenuationColorValue()
        {
            return u_AttenuationColor;
        }

        float IridescenceWeight(vec2 uv)
        {
            if (u_IridescenceEnabled == 0) return 0.0;
            return u_HasIridescenceMap != 0 ? u_Iridescence * texture(u_IridescenceMap, uv).r : u_Iridescence;
        }

        float IridescenceThicknessValue(vec2 uv)
        {
            if (u_IridescenceEnabled == 0) return 0.0;
            float t = u_HasIridescenceThicknessMap != 0 ? texture(u_IridescenceThicknessMap, uv).r : 0.5;
            return mix(u_IridescenceThicknessMinimum, u_IridescenceThicknessMaximum, t);
        }

        float IridescenceIorValue()
        {
            return u_IridescenceIor;
        }

        float SubsurfaceWeight(vec2 uv)
        {
            if (u_SubsurfaceEnabled == 0) return 0.0;
            return u_HasSubsurfaceMap != 0 ? u_Subsurface * texture(u_SubsurfaceMap, uv).r : u_Subsurface;
        }

        vec3 SubsurfaceColorValue()
        {
            return u_SubsurfaceColor;
        }

        float SubsurfaceThicknessValue()
        {
            return u_SubsurfaceThickness;
        }

        float SpecularWeight()
        {
            return u_Specular;
        }

        vec3 SpecularColorValue()
        {
            return u_SpecularColor;
        }

        float AnisotropyStrength()
        {
            return u_Anisotropy;
        }

        float AnisotropyRotationValue()
        {
            return u_AnisotropyRotation;
        }
        """;
}
