import type { SceneShaderDefinition } from '../../../scene';

const GLTF_SHADER_PBR_ID = 'gltf/pbr';
const GLTF_SHADER_UNLIT_ID = 'gltf/unlit';
const MAX_GLTF_SKIN_JOINTS = 128;
const MAX_GLTF_LOCAL_LIGHTS = 4;

export const createGltfUnlitShaderDefinition = (
    id: string = GLTF_SHADER_UNLIT_ID
): SceneShaderDefinition => ({
    id,
    vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 2) in vec2 a_UV0;
layout(location = 5) in vec2 a_UV1;
layout(location = 9) in uvec4 a_Joints0;
layout(location = 10) in vec4 a_Weights0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
uniform bool u_Skinning;
uniform int u_SkinJointCount;
uniform mat4 u_JointMatrices[${MAX_GLTF_SKIN_JOINTS}];
out vec2 v_UV0;
out vec2 v_UV1;
mat4 resolveSkinMatrix() {
    if (!u_Skinning || u_SkinJointCount <= 0) {
        return mat4(1.0);
    }
    mat4 skin = mat4(0.0);
    skin += u_JointMatrices[int(a_Joints0.x)] * a_Weights0.x;
    skin += u_JointMatrices[int(a_Joints0.y)] * a_Weights0.y;
    skin += u_JointMatrices[int(a_Joints0.z)] * a_Weights0.z;
    skin += u_JointMatrices[int(a_Joints0.w)] * a_Weights0.w;
    return skin;
}
void main() {
    v_UV0 = a_UV0;
    v_UV1 = a_UV1;
    vec4 localPosition = vec4(a_Position, 1.0);
    if (u_Skinning && u_SkinJointCount > 0) {
        localPosition = resolveSkinMatrix() * localPosition;
    }
    gl_Position = u_Projection * u_View * u_Model * localPosition;
}`,
    fragmentSource: `#version 300 es
precision highp float;
uniform vec4 _BaseColorFactor;
uniform sampler2D _BaseColorTexture;
uniform vec4 _BaseColorTexture_ST;
uniform float _BaseColorTexture_Rotation;
uniform int _BaseColorTexture_TexCoord;
uniform float _AlphaMode;
uniform float _AlphaCutoff;
in vec2 v_UV0;
in vec2 v_UV1;
out vec4 o_Color;
vec2 selectUV(int texCoord) {
    return texCoord == 1 ? v_UV1 : v_UV0;
}
vec2 transformUV(vec2 uv, vec4 st, float rotation) {
    vec2 scaled = uv * st.xy;
    float c = cos(rotation);
    float s = sin(rotation);
    vec2 rotated = vec2(c * scaled.x - s * scaled.y, s * scaled.x + c * scaled.y);
    return rotated + st.zw;
}
void main() {
    vec4 baseColor = _BaseColorFactor;
    if (_BaseColorTexture_TexCoord >= 0) {
        vec2 uv = transformUV(selectUV(_BaseColorTexture_TexCoord), _BaseColorTexture_ST, _BaseColorTexture_Rotation);
        baseColor *= texture(_BaseColorTexture, uv);
    }
    int alphaMode = int(_AlphaMode + 0.5);
    if (alphaMode == 1 && baseColor.a < _AlphaCutoff) {
        discard;
    }
    if (alphaMode == 0 || alphaMode == 1) {
        baseColor.a = 1.0;
    }
    o_Color = baseColor;
}`,
    depthTest: true,
    cull: false,
    blend: true,
});

export const createGltfPbrShaderDefinition = (
    id: string = GLTF_SHADER_PBR_ID
): SceneShaderDefinition => ({
    id,
    vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
layout(location = 1) in vec3 a_Normal;
layout(location = 2) in vec2 a_UV0;
layout(location = 4) in vec4 a_Tangent;
layout(location = 5) in vec2 a_UV1;
layout(location = 9) in uvec4 a_Joints0;
layout(location = 10) in vec4 a_Weights0;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
uniform bool u_Skinning;
uniform int u_SkinJointCount;
uniform mat4 u_JointMatrices[${MAX_GLTF_SKIN_JOINTS}];
out vec2 v_UV0;
out vec2 v_UV1;
out vec3 v_WorldPosition;
out vec3 v_WorldNormal;
out vec4 v_WorldTangent;
mat4 resolveSkinMatrix() {
    if (!u_Skinning || u_SkinJointCount <= 0) {
        return mat4(1.0);
    }
    mat4 skin = mat4(0.0);
    skin += u_JointMatrices[int(a_Joints0.x)] * a_Weights0.x;
    skin += u_JointMatrices[int(a_Joints0.y)] * a_Weights0.y;
    skin += u_JointMatrices[int(a_Joints0.z)] * a_Weights0.z;
    skin += u_JointMatrices[int(a_Joints0.w)] * a_Weights0.w;
    return skin;
}
void main() {
    v_UV0 = a_UV0;
    v_UV1 = a_UV1;
    mat4 skin = resolveSkinMatrix();
    vec4 localPosition = vec4(a_Position, 1.0);
    vec3 localNormal = a_Normal;
    vec3 localTangent = a_Tangent.xyz;
    if (u_Skinning && u_SkinJointCount > 0) {
        localPosition = skin * localPosition;
        localNormal = mat3(skin) * localNormal;
        localTangent = mat3(skin) * localTangent;
    }
    vec4 worldPosition = u_Model * localPosition;
    v_WorldPosition = worldPosition.xyz;
    v_WorldNormal = normalize(mat3(u_Model) * localNormal);
    v_WorldTangent = vec4(normalize(mat3(u_Model) * localTangent), a_Tangent.w);
    gl_Position = u_Projection * u_View * worldPosition;
}`,
    fragmentSource: `#version 300 es
precision highp float;
const int MAX_LOCAL_LIGHTS = ${MAX_GLTF_LOCAL_LIGHTS};
uniform bool u_ReceiveLighting;
uniform vec3 u_AmbientLight;
uniform vec3 u_LightDirection;
uniform vec3 u_LightColor;
uniform float u_LightIntensity;
uniform int u_LocalLightCount;
uniform int u_LocalLightType[MAX_LOCAL_LIGHTS];
uniform vec3 u_LocalLightPosition[MAX_LOCAL_LIGHTS];
uniform vec3 u_LocalLightDirection[MAX_LOCAL_LIGHTS];
uniform vec3 u_LocalLightColor[MAX_LOCAL_LIGHTS];
uniform float u_LocalLightIntensity[MAX_LOCAL_LIGHTS];
uniform float u_LocalLightRange[MAX_LOCAL_LIGHTS];
uniform float u_LocalLightInnerCone[MAX_LOCAL_LIGHTS];
uniform float u_LocalLightOuterCone[MAX_LOCAL_LIGHTS];
uniform vec3 u_CameraPosition;
uniform vec4 _BaseColorFactor;
uniform sampler2D _BaseColorTexture;
uniform vec4 _BaseColorTexture_ST;
uniform float _BaseColorTexture_Rotation;
uniform int _BaseColorTexture_TexCoord;
uniform float _MetallicFactor;
uniform float _RoughnessFactor;
uniform sampler2D _MetallicRoughnessTexture;
uniform vec4 _MetallicRoughnessTexture_ST;
uniform float _MetallicRoughnessTexture_Rotation;
uniform int _MetallicRoughnessTexture_TexCoord;
uniform sampler2D _NormalTexture;
uniform vec4 _NormalTexture_ST;
uniform float _NormalTexture_Rotation;
uniform int _NormalTexture_TexCoord;
uniform float _NormalTexture_Scale;
uniform sampler2D _OcclusionTexture;
uniform vec4 _OcclusionTexture_ST;
uniform float _OcclusionTexture_Rotation;
uniform int _OcclusionTexture_TexCoord;
uniform float _OcclusionTexture_Strength;
uniform vec3 _EmissiveFactor;
uniform sampler2D _EmissiveTexture;
uniform vec4 _EmissiveTexture_ST;
uniform float _EmissiveTexture_Rotation;
uniform int _EmissiveTexture_TexCoord;
uniform float _AlphaMode;
uniform float _AlphaCutoff;
in vec2 v_UV0;
in vec2 v_UV1;
in vec3 v_WorldPosition;
in vec3 v_WorldNormal;
in vec4 v_WorldTangent;
out vec4 o_Color;
vec2 selectUV(int texCoord) {
    return texCoord == 1 ? v_UV1 : v_UV0;
}
vec2 transformUV(vec2 uv, vec4 st, float rotation) {
    vec2 scaled = uv * st.xy;
    float c = cos(rotation);
    float s = sin(rotation);
    vec2 rotated = vec2(c * scaled.x - s * scaled.y, s * scaled.x + c * scaled.y);
    return rotated + st.zw;
}
vec3 resolveNormal() {
    vec3 normal = length(v_WorldNormal) > 0.0001 ? normalize(v_WorldNormal) : vec3(0.0, 0.0, 1.0);
    if (_NormalTexture_TexCoord < 0 || length(v_WorldTangent.xyz) <= 0.0001) {
        return normal;
    }
    vec2 uv = transformUV(selectUV(_NormalTexture_TexCoord), _NormalTexture_ST, _NormalTexture_Rotation);
    vec3 tangentNormal = texture(_NormalTexture, uv).xyz * 2.0 - 1.0;
    tangentNormal.xy *= _NormalTexture_Scale;
    vec3 tangent = normalize(v_WorldTangent.xyz);
    vec3 bitangent = normalize(cross(normal, tangent)) * (v_WorldTangent.w == 0.0 ? 1.0 : v_WorldTangent.w);
    mat3 tbn = mat3(tangent, bitangent, normal);
    return normalize(tbn * tangentNormal);
}
float rangeAttenuation(float distanceToLight, float range) {
    if (range <= 0.0) {
        return 1.0;
    }
    float atten = clamp(1.0 - distanceToLight / range, 0.0, 1.0);
    return atten * atten;
}
float spotAttenuation(vec3 lightDir, vec3 spotDir, float innerCone, float outerCone) {
    float cd = dot(normalize(-lightDir), normalize(spotDir));
    float inner = cos(innerCone);
    float outer = cos(outerCone);
    return smoothstep(outer, inner, cd);
}
vec3 evaluateLight(vec3 normal, vec3 viewDir, vec3 albedo, float metallic, float roughness, vec3 lightDir, vec3 lightColor, float intensity) {
    float ndl = max(dot(normal, lightDir), 0.0);
    if (ndl <= 0.0) {
        return vec3(0.0);
    }
    vec3 halfDir = normalize(lightDir + viewDir);
    float ndh = max(dot(normal, halfDir), 0.0);
    float specPower = mix(128.0, 4.0, clamp(roughness, 0.0, 1.0));
    float specular = pow(ndh, specPower);
    vec3 diffuse = albedo * (1.0 - metallic) * ndl;
    vec3 specColor = mix(vec3(0.04), albedo, metallic) * specular * ndl;
    return (diffuse + specColor) * lightColor * intensity;
}
void main() {
    vec4 baseColor = _BaseColorFactor;
    if (_BaseColorTexture_TexCoord >= 0) {
        vec2 uv = transformUV(selectUV(_BaseColorTexture_TexCoord), _BaseColorTexture_ST, _BaseColorTexture_Rotation);
        baseColor *= texture(_BaseColorTexture, uv);
    }
    int alphaMode = int(_AlphaMode + 0.5);
    if (alphaMode == 1 && baseColor.a < _AlphaCutoff) {
        discard;
    }

    vec3 normal = resolveNormal();
    vec3 viewDir = normalize(u_CameraPosition - v_WorldPosition);
    vec2 mrUv = transformUV(selectUV(max(_MetallicRoughnessTexture_TexCoord, 0)), _MetallicRoughnessTexture_ST, _MetallicRoughnessTexture_Rotation);
    vec4 mrSample = _MetallicRoughnessTexture_TexCoord >= 0 ? texture(_MetallicRoughnessTexture, mrUv) : vec4(1.0);
    float roughness = clamp(_RoughnessFactor * mrSample.g, 0.04, 1.0);
    float metallic = clamp(_MetallicFactor * mrSample.b, 0.0, 1.0);
    vec3 lighting = baseColor.rgb * u_AmbientLight;

    if (u_ReceiveLighting) {
        lighting += evaluateLight(normal, viewDir, baseColor.rgb, metallic, roughness, normalize(-u_LightDirection), u_LightColor, u_LightIntensity);
        for (int index = 0; index < MAX_LOCAL_LIGHTS; index += 1) {
            if (index >= u_LocalLightCount) {
                break;
            }
            vec3 toLight = u_LocalLightPosition[index] - v_WorldPosition;
            float distanceToLight = length(toLight);
            vec3 lightDir = distanceToLight > 0.0 ? toLight / distanceToLight : vec3(0.0, 1.0, 0.0);
            float attenuation = rangeAttenuation(distanceToLight, u_LocalLightRange[index]);
            if (u_LocalLightType[index] == 1) {
                attenuation *= spotAttenuation(lightDir, u_LocalLightDirection[index], u_LocalLightInnerCone[index], u_LocalLightOuterCone[index]);
            }
            lighting += evaluateLight(normal, viewDir, baseColor.rgb, metallic, roughness, lightDir, u_LocalLightColor[index], u_LocalLightIntensity[index] * attenuation);
        }
    }

    if (_OcclusionTexture_TexCoord >= 0) {
        vec2 uv = transformUV(selectUV(_OcclusionTexture_TexCoord), _OcclusionTexture_ST, _OcclusionTexture_Rotation);
        float occlusion = texture(_OcclusionTexture, uv).r;
        lighting *= mix(1.0, occlusion, clamp(_OcclusionTexture_Strength, 0.0, 1.0));
    }

    vec3 emissive = _EmissiveFactor;
    if (_EmissiveTexture_TexCoord >= 0) {
        vec2 uv = transformUV(selectUV(_EmissiveTexture_TexCoord), _EmissiveTexture_ST, _EmissiveTexture_Rotation);
        emissive *= texture(_EmissiveTexture, uv).rgb;
    }

    float alpha = alphaMode == 2 ? baseColor.a : 1.0;
    o_Color = vec4(lighting + emissive, alpha);
}`,
    depthTest: true,
    cull: false,
    blend: true,
});

export const resolveGltfShaderDefinition = (
    shaderId: string,
    resolveShaderDefinition?: (shaderId: string) => SceneShaderDefinition | undefined
): SceneShaderDefinition | undefined => {
    if (shaderId === GLTF_SHADER_PBR_ID) {
        return createGltfPbrShaderDefinition(shaderId);
    }
    if (shaderId === GLTF_SHADER_UNLIT_ID) {
        return createGltfUnlitShaderDefinition(shaderId);
    }
    return resolveShaderDefinition?.(shaderId);
};