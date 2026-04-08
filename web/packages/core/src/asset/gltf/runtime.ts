import { Vec3 } from '@axrone/numeric';
import type { Actor } from '../../component-system/core/actor';
import type { ComponentRegistry } from '../../component-system/types/core';
import type { AssetDatabase } from '../database';
import type {
    AssetImportDiagnostic,
    AssetRecord,
    AssetSelector,
} from '../types';
import type {
    SceneMaterialDefinition,
    SceneMeshDefinition,
    SceneShaderDefinition,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
    SceneTextureDefinition,
    SceneUniformValue,
    Scene,
} from '../../scene';
import { TextureFormat } from '../../renderer/webgl2/texture/interfaces';
import type {
    GltfAssetSchemaLike,
    GltfDocumentSceneAsset,
    GltfMaterialAsset,
    GltfPrefabAsset,
    GltfTextureAsset,
    GltfTextureUsage,
} from './types';

const GLTF_SHADER_PBR_ID = 'gltf/pbr';
const GLTF_SHADER_UNLIT_ID = 'gltf/unlit';
const MAX_GLTF_SKIN_JOINTS = 128;
const MAX_GLTF_LOCAL_LIGHTS = 4;

interface GltfTextureUniformSpec {
    readonly usage: GltfTextureUsage;
    readonly uniformName: string;
    readonly defaultTexCoord: number;
    readonly defaultST: readonly [number, number, number, number];
    readonly defaultRotation: number;
    readonly defaultScale?: number;
    readonly defaultStrength?: number;
}

const GLTF_TEXTURE_UNIFORM_SPECS: readonly GltfTextureUniformSpec[] = [
    {
        usage: 'baseColor',
        uniformName: '_BaseColorTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
    },
    {
        usage: 'metallicRoughness',
        uniformName: '_MetallicRoughnessTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
    },
    {
        usage: 'normal',
        uniformName: '_NormalTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
        defaultScale: 1,
    },
    {
        usage: 'occlusion',
        uniformName: '_OcclusionTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
        defaultStrength: 1,
    },
    {
        usage: 'emissive',
        uniformName: '_EmissiveTexture',
        defaultTexCoord: -1,
        defaultST: [1, 1, 0, 0] as const,
        defaultRotation: 0,
    },
];

export interface GltfSceneSnapshotOptions {
    readonly sceneIndex?: number;
    readonly resolveShaderDefinition?: (shaderId: string) => SceneShaderDefinition | undefined;
}

export interface GltfSceneSnapshotResult {
    readonly document: AssetRecord<GltfAssetSchemaLike, 'gltf.document'>;
    readonly scene: GltfDocumentSceneAsset;
    readonly prefab: AssetRecord<GltfAssetSchemaLike, 'gltf.prefab'>;
    readonly snapshot: SceneSnapshot;
    readonly diagnostics: readonly AssetImportDiagnostic[];
}

export interface LoadGltfSceneIntoSceneOptions
    extends GltfSceneSnapshotOptions,
        Pick<SceneSnapshotLoadOptions, 'clearExisting' | 'componentArgsResolver' | 'namePrefix'> {}

export interface LoadGltfSceneIntoSceneResult extends GltfSceneSnapshotResult {
    readonly actors: readonly Actor[];
}

const toSceneTextureMimeType = (texture: GltfTextureAsset): string | undefined => {
    if (texture.payload.mimeType) {
        return texture.payload.mimeType;
    }

    const uri = texture.payload.uri?.toLowerCase();
    if (!uri) {
        return undefined;
    }

    if (uri.endsWith('.png')) {
        return 'image/png';
    }
    if (uri.endsWith('.jpg') || uri.endsWith('.jpeg')) {
        return 'image/jpeg';
    }
    if (uri.endsWith('.webp')) {
        return 'image/webp';
    }
    if (uri.endsWith('.ktx2')) {
        return 'image/ktx2';
    }
    if (uri.endsWith('.basis')) {
        return 'image/basis';
    }

    return undefined;
};

const isRuntimeLoadableImageMimeType = (mimeType: string | undefined): boolean =>
    mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg' || mimeType === 'image/webp';

const createFallbackTextureSource = (
    usageHints: readonly GltfTextureUsage[]
): SceneTextureDefinition['source'] => {
    const primaryUsage = usageHints[0];

    if (primaryUsage === 'normal') {
        return {
            kind: 'data',
            width: 1,
            height: 1,
            channels: 4,
            data: [128, 128, 255, 255],
        };
    }

    if (primaryUsage === 'emissive') {
        return {
            kind: 'data',
            width: 1,
            height: 1,
            channels: 4,
            data: [255, 255, 255, 255],
        };
    }

    return {
        kind: 'data',
        width: 1,
        height: 1,
        channels: 4,
        data: [255, 255, 255, 255],
    };
};

const cloneUniformValue = (value: SceneUniformValue): SceneUniformValue => {
    if (ArrayBuffer.isView(value)) {
        return new (value.constructor as typeof Float32Array)(value as any) as SceneUniformValue;
    }

    if (Array.isArray(value)) {
        return [...value] as SceneUniformValue;
    }

    if (value instanceof Vec3) {
        return new Vec3(value.x, value.y, value.z);
    }

    return value;
};

const normalizeGltfMaterialDefinition = (
    asset: GltfMaterialAsset,
    key: string
): SceneMaterialDefinition => {
    const uniforms: Record<string, SceneUniformValue> = Object.fromEntries(
        Object.entries(asset.definition.uniforms ?? {}).map(([name, value]) => [
            name,
            cloneUniformValue(value),
        ])
    );

    for (const spec of GLTF_TEXTURE_UNIFORM_SPECS) {
        const binding = asset.textures[spec.usage];
        uniforms[`${spec.uniformName}_ST`] =
            binding?.transform
                ? [
                      binding.transform.scale[0],
                      binding.transform.scale[1],
                      binding.transform.offset[0],
                      binding.transform.offset[1],
                  ]
                : [...spec.defaultST];
        uniforms[`${spec.uniformName}_Rotation`] = binding?.transform?.rotation ?? spec.defaultRotation;
        uniforms[`${spec.uniformName}_TexCoord`] = binding?.transform?.texCoord ?? binding?.texCoord ?? spec.defaultTexCoord;

        if (spec.defaultScale !== undefined && uniforms[`${spec.uniformName}_Scale`] === undefined) {
            uniforms[`${spec.uniformName}_Scale`] = spec.defaultScale;
        }
        if (spec.defaultStrength !== undefined && uniforms[`${spec.uniformName}_Strength`] === undefined) {
            uniforms[`${spec.uniformName}_Strength`] = spec.defaultStrength;
        }
    }

    return {
        ...asset.definition,
        id: key,
        uniforms,
        textures: asset.definition.textures ? { ...asset.definition.textures } : undefined,
    };
};

const createSceneTextureDefinitionFromGltfTexture = (
    key: string,
    asset: GltfTextureAsset
): { readonly definition: SceneTextureDefinition; readonly diagnostics: readonly AssetImportDiagnostic[] } => {
    const mimeType = toSceneTextureMimeType(asset);

    if (asset.payload.kind === 'raw' && isRuntimeLoadableImageMimeType(mimeType)) {
        return {
            definition: {
                id: key,
                samplerId: asset.sampler.id,
                format: asset.runtimeFormat ?? TextureFormat.RGBA8,
                source: {
                    kind: 'bytes',
                    bytes: new Uint8Array(asset.payload.bytes),
                    mimeType: mimeType!,
                    ...(asset.payload.uri ? { uri: asset.payload.uri } : {}),
                },
            },
            diagnostics: [],
        };
    }

    if (asset.payload.kind === 'external' && isRuntimeLoadableImageMimeType(mimeType)) {
        return {
            definition: {
                id: key,
                samplerId: asset.sampler.id,
                format: asset.runtimeFormat ?? TextureFormat.RGBA8,
                source: {
                    kind: 'url',
                    url: asset.payload.uri,
                },
            },
            diagnostics: [],
        };
    }

    return {
        definition: {
            id: key,
            samplerId: asset.sampler.id,
            format: TextureFormat.RGBA8,
            generateMipmaps: false,
            source: createFallbackTextureSource(asset.usageHints),
        },
        diagnostics: [
            {
                level: 'warning',
                code: 'gltf.texture.runtime-fallback',
                message: `Texture '${key}' uses a payload the scene runtime cannot consume directly; a deterministic fallback texture was substituted`,
            },
        ],
    };
};

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

const resolveGltfShaderDefinition = (
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

export const createGltfSceneSnapshot = (
    database: AssetDatabase<GltfAssetSchemaLike>,
    selector: AssetSelector<GltfAssetSchemaLike, 'gltf.document'>,
    options: GltfSceneSnapshotOptions = {}
): GltfSceneSnapshotResult => {
    const document = database.require(selector);
    const sceneIndex = options.sceneIndex ?? document.data.defaultScene;
    const scene = document.data.scenes[sceneIndex];
    if (!scene) {
        throw new Error(`glTF document does not contain scene ${sceneIndex}`);
    }

    const prefab = database.require({
        key: scene.prefabKey,
        kind: 'gltf.prefab',
    });
    const diagnostics: AssetImportDiagnostic[] = [];
    const samplers = new Map<string, SceneSnapshot['samplers'][number]>();
    const textures = new Map<string, SceneTextureDefinition>();
    const materials: SceneMaterialDefinition[] = [];
    const meshes: SceneMeshDefinition[] = [];
    const shaderDefinitions = new Map<string, SceneShaderDefinition>();

    for (const materialKey of prefab.data.materialKeys) {
        const material = database.require({ key: materialKey, kind: 'gltf.material' });
        materials.push(normalizeGltfMaterialDefinition(material.data, material.key));

        const shaderDefinition = resolveGltfShaderDefinition(
            material.data.definition.shaderId,
            options.resolveShaderDefinition
        );
        if (!shaderDefinition) {
            throw new Error(
                `glTF runtime bridge cannot resolve shader '${material.data.definition.shaderId}' for material '${materialKey}'`
            );
        }
        shaderDefinitions.set(shaderDefinition.id, shaderDefinition);

        for (const textureBinding of Object.values(material.data.textures)) {
            const texture = database.require({ key: textureBinding.textureKey, kind: 'gltf.texture' });
            if (!samplers.has(texture.data.sampler.id)) {
                samplers.set(texture.data.sampler.id, { ...texture.data.sampler });
            }
            if (!textures.has(texture.key)) {
                const built = createSceneTextureDefinitionFromGltfTexture(texture.key, texture.data);
                textures.set(texture.key, built.definition);
                diagnostics.push(...built.diagnostics);
            }
        }
    }

    for (const meshKey of prefab.data.meshKeys) {
        const mesh = database.require({ key: meshKey, kind: 'gltf.mesh' });
        meshes.push({
            ...mesh.data.definition,
            id: mesh.key,
        });
    }

    return {
        document,
        scene,
        prefab,
        snapshot: {
            version: 1,
            prefab: prefab.data.definition,
            shaders: [...shaderDefinitions.values()],
            meshes,
            materials,
            textures: [...textures.values()],
            samplers: [...samplers.values()],
            renderPasses: [],
        },
        diagnostics: Object.freeze(diagnostics),
    };
};

export const loadGltfSceneIntoScene = async <R extends ComponentRegistry = Record<string, never>>(
    scene: Scene<R>,
    database: AssetDatabase<GltfAssetSchemaLike>,
    selector: AssetSelector<GltfAssetSchemaLike, 'gltf.document'>,
    options: LoadGltfSceneIntoSceneOptions = {}
): Promise<LoadGltfSceneIntoSceneResult> => {
    const built = createGltfSceneSnapshot(database, selector, options);
    const actors = await scene.loadScene(built.snapshot, {
        clearExisting: options.clearExisting,
        componentArgsResolver: options.componentArgsResolver,
        namePrefix: options.namePrefix,
    });

    return {
        ...built,
        actors,
    };
};