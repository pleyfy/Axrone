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
}
