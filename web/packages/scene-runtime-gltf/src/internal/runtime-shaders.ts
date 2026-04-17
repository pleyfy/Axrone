import type { GltfMeshSemantic, GltfShaderDefinition } from '@axrone/asset-gltf';
import {
    createSceneShaderDefinitionFromEffect,
    type RenderShaderEffectDefinition,
    type RenderShaderPropertyDefinition,
} from '@axrone/scene-runtime';

const GLTF_SHADER_PBR_ID = 'gltf/pbr';
const GLTF_SHADER_UNLIT_ID = 'gltf/unlit';
const GLTF_SHADER_DOUBLE_SIDED_SUFFIX = '/double-sided';
const GLTF_SHADER_BLEND_SUFFIX = '/blend';
const MAX_GLTF_SKIN_JOINTS = 128;
const MAX_GLTF_LOCAL_LIGHTS = 4;

type GltfMaterialUniformMap = Readonly<Record<string, unknown>>;

const HIDDEN_INSPECTOR = Object.freeze({ hidden: true } as const);
const GLTF_ALPHA_MODE_OPTIONS = Object.freeze([
    { label: 'Opaque', value: 0 },
    { label: 'Mask', value: 1 },
    { label: 'Blend', value: 2 },
] as const);

const GLTF_UNLIT_ATTRIBUTES = Object.freeze({
    position: 'a_Position',
    uv0: 'a_UV0',
    uv1: 'a_UV1',
    joints0: 'a_Joints0',
    weights0: 'a_Weights0',
} satisfies Partial<Record<GltfMeshSemantic, string>>);

const GLTF_PBR_ATTRIBUTES = Object.freeze({
    position: 'a_Position',
    normal: 'a_Normal',
    uv0: 'a_UV0',
    tangent: 'a_Tangent',
    uv1: 'a_UV1',
    joints0: 'a_Joints0',
    weights0: 'a_Weights0',
} satisfies Partial<Record<GltfMeshSemantic, string>>);

const createSurfaceTextureProperties = (
    uniformName: string,
    label: string,
    group: string,
    options: {
        readonly scale?: {
            readonly label: string;
            readonly min: number;
            readonly max: number;
            readonly step?: number;
            readonly defaultValue: number;
        };
        readonly strength?: {
            readonly label: string;
            readonly min: number;
            readonly max: number;
            readonly step?: number;
            readonly defaultValue: number;
        };
    } = {}
): readonly RenderShaderPropertyDefinition[] => {
    const properties: RenderShaderPropertyDefinition[] = [
        {
            name: uniformName,
            type: 'sampler2D',
            stages: ['fragment'],
            scope: 'material',
            inspector: {
                label,
                group,
                control: 'texture',
            },
        },
        {
            name: `${uniformName}_ST`,
            type: 'vec4',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [1, 1, 0, 0],
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: `${uniformName}_Rotation`,
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: 0,
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: `${uniformName}_TexCoord`,
            type: 'int',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: -1,
            inspector: HIDDEN_INSPECTOR,
        },
    ];

    if (options.scale) {
        properties.push({
            name: `${uniformName}_Scale`,
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: options.scale.defaultValue,
            inspector: {
                label: options.scale.label,
                group,
                control: 'slider',
                min: options.scale.min,
                max: options.scale.max,
                step: options.scale.step,
            },
        });
    }

    if (options.strength) {
        properties.push({
            name: `${uniformName}_Strength`,
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: options.strength.defaultValue,
            inspector: {
                label: options.strength.label,
                group,
                control: 'slider',
                min: options.strength.min,
                max: options.strength.max,
                step: options.strength.step,
            },
        });
    }

    return properties;
};

const createSharedObjectProperties = (): readonly RenderShaderPropertyDefinition[] => [
    {
        name: 'u_Model',
        type: 'mat4',
        stages: ['vertex'],
        scope: 'object',
    },
    {
        name: 'u_View',
        type: 'mat4',
        stages: ['vertex'],
        scope: 'camera',
    },
    {
        name: 'u_Projection',
        type: 'mat4',
        stages: ['vertex'],
        scope: 'camera',
    },
    {
        name: 'u_Skinning',
        type: 'bool',
        stages: ['vertex'],
        scope: 'object',
        inspector: HIDDEN_INSPECTOR,
    },
    {
        name: 'u_SkinJointCount',
        type: 'int',
        stages: ['vertex'],
        scope: 'object',
        inspector: HIDDEN_INSPECTOR,
    },
    {
        name: 'u_JointMatrices',
        type: 'mat4',
        arrayLength: MAX_GLTF_SKIN_JOINTS,
        stages: ['vertex'],
        scope: 'object',
        inspector: HIDDEN_INSPECTOR,
    },
];

const createSharedAlphaProperties = (): readonly RenderShaderPropertyDefinition[] => [
    {
        name: '_AlphaMode',
        type: 'float',
        stages: ['fragment'],
        scope: 'material',
        defaultValue: 0,
        inspector: {
            label: 'Alpha Mode',
            group: 'Surface',
            control: 'select',
            options: GLTF_ALPHA_MODE_OPTIONS,
        },
    },
    {
        name: '_AlphaCutoff',
        type: 'float',
        stages: ['fragment'],
        scope: 'material',
        defaultValue: 0.5,
        inspector: {
            label: 'Alpha Cutoff',
            group: 'Surface',
            control: 'slider',
            min: 0,
            max: 1,
            step: 0.01,
        },
    },
    {
        name: '_DoubleSided',
        type: 'float',
        stages: ['fragment'],
        scope: 'material',
        defaultValue: 0,
        inspector: {
            label: 'Double Sided',
            group: 'Surface',
            control: 'toggle',
        },
    },
];

const GLTF_SHADER_LIBRARIES = Object.freeze([
    {
        id: 'gltf.skinning',
        code: [
            'mat4 resolveSkinMatrix() {',
            '    if (!u_Skinning || u_SkinJointCount <= 0) {',
            '        return mat4(1.0);',
            '    }',
            '    mat4 skin = mat4(0.0);',
            '    skin += u_JointMatrices[int(a_Joints0.x)] * a_Weights0.x;',
            '    skin += u_JointMatrices[int(a_Joints0.y)] * a_Weights0.y;',
            '    skin += u_JointMatrices[int(a_Joints0.z)] * a_Weights0.z;',
            '    skin += u_JointMatrices[int(a_Joints0.w)] * a_Weights0.w;',
            '    return skin;',
            '}',
        ],
    },
    {
        id: 'gltf.uv',
        code: [
            'vec2 selectUV(int texCoord) {',
            '    return texCoord == 1 ? v_UV1 : v_UV0;',
            '}',
            '',
            'vec2 transformUV(vec2 uv, vec4 st, float rotation) {',
            '    vec2 scaled = uv * st.xy;',
            '    float c = cos(rotation);',
            '    float s = sin(rotation);',
            '    vec2 rotated = vec2(c * scaled.x - s * scaled.y, s * scaled.x + c * scaled.y);',
            '    return rotated + st.zw;',
            '}',
        ],
    },
    {
        id: 'gltf.pbr-lighting',
        code: [
            'vec3 resolveNormal() {',
            '    vec3 normal = length(v_WorldNormal) > 0.0001 ? normalize(v_WorldNormal) : vec3(0.0, 0.0, 1.0);',
            '    if (_NormalTexture_TexCoord < 0 || length(v_WorldTangent.xyz) <= 0.0001) {',
            '        return normal;',
            '    }',
            '    vec2 uv = transformUV(selectUV(_NormalTexture_TexCoord), _NormalTexture_ST, _NormalTexture_Rotation);',
            '    vec3 tangentNormal = texture(_NormalTexture, uv).xyz * 2.0 - 1.0;',
            '    tangentNormal.xy *= _NormalTexture_Scale;',
            '    vec3 tangent = normalize(v_WorldTangent.xyz);',
            '    vec3 bitangent = normalize(cross(normal, tangent)) * (v_WorldTangent.w == 0.0 ? 1.0 : v_WorldTangent.w);',
            '    mat3 tbn = mat3(tangent, bitangent, normal);',
            '    return normalize(tbn * tangentNormal);',
            '}',
            '',
            'float rangeAttenuation(float distanceToLight, float range) {',
            '    if (range <= 0.0) {',
            '        return 1.0;',
            '    }',
            '    float atten = clamp(1.0 - distanceToLight / range, 0.0, 1.0);',
            '    return atten * atten;',
            '}',
            '',
            'float spotAttenuation(vec3 lightDir, vec3 spotDir, float innerCone, float outerCone) {',
            '    float cd = dot(normalize(-lightDir), normalize(spotDir));',
            '    float inner = cos(innerCone);',
            '    float outer = cos(outerCone);',
            '    return smoothstep(outer, inner, cd);',
            '}',
            '',
            'vec3 evaluateLight(vec3 normal, vec3 viewDir, vec3 albedo, float metallic, float roughness, vec3 lightDir, vec3 lightColor, float intensity) {',
            '    float ndl = max(dot(normal, lightDir), 0.0);',
            '    if (ndl <= 0.0) {',
            '        return vec3(0.0);',
            '    }',
            '    vec3 halfDir = normalize(lightDir + viewDir);',
            '    float ndh = max(dot(normal, halfDir), 0.0);',
            '    float specPower = mix(128.0, 4.0, clamp(roughness, 0.0, 1.0));',
            '    float specular = pow(ndh, specPower);',
            '    vec3 diffuse = albedo * (1.0 - metallic) * ndl;',
            '    vec3 specColor = mix(vec3(0.04), albedo, metallic) * specular * ndl;',
            '    return (diffuse + specColor) * lightColor * intensity;',
            '}',
        ],
    },
] as const);

const createGltfShaderDefinitionFromEffect = (
    effect: RenderShaderEffectDefinition,
    attributes: Partial<Record<GltfMeshSemantic, string>>
): GltfShaderDefinition => {
    const definition = createSceneShaderDefinitionFromEffect(effect);

    return {
        id: definition.id,
        vertexSource: definition.vertexSource ?? '',
        fragmentSource: definition.fragmentSource ?? '',
        effect: definition.effect,
        attributes: { ...attributes },
        uniforms: definition.uniforms ? [...definition.uniforms] : undefined,
        depthTest: definition.depthTest,
        cull: definition.cull,
        blend: definition.blend,
    };
};

const normalizeNumericUniform = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    return fallback;
};

const isGltfBlendAlphaMode = (uniforms: GltfMaterialUniformMap | undefined): boolean =>
    normalizeNumericUniform(uniforms?._AlphaMode, 0) >= 1.5;

const isGltfDoubleSided = (uniforms: GltfMaterialUniformMap | undefined): boolean =>
    normalizeNumericUniform(uniforms?._DoubleSided, 0) >= 0.5;

const createVariantShaderId = (
    baseId: string,
    options: {
        readonly blend: boolean;
        readonly doubleSided: boolean;
    }
): string => {
    let variantId = baseId;
    if (options.blend) {
        variantId += GLTF_SHADER_BLEND_SUFFIX;
    }
    if (options.doubleSided) {
        variantId += GLTF_SHADER_DOUBLE_SIDED_SUFFIX;
    }
    return variantId;
};

const resolveVariantRenderState = (uniforms: GltfMaterialUniformMap | undefined): {
    readonly blend: boolean;
    readonly cull: boolean;
} => {
    const blend = isGltfBlendAlphaMode(uniforms);
    const doubleSided = isGltfDoubleSided(uniforms);
    return {
        blend,
        cull: !doubleSided,
    };
};

const createGltfUnlitShaderEffect = (id: string): RenderShaderEffectDefinition => ({
    format: 'axrone.shader/effect',
    version: 1,
    id,
    attributes: [
        { name: 'a_Position', type: 'vec3', location: 0 },
        { name: 'a_UV0', type: 'vec2', location: 2 },
        { name: 'a_UV1', type: 'vec2', location: 5 },
        { name: 'a_Joints0', type: 'uvec4', location: 9 },
        { name: 'a_Weights0', type: 'vec4', location: 10 },
    ],
    varyings: [
        { name: 'v_UV0', type: 'vec2' },
        { name: 'v_UV1', type: 'vec2' },
    ],
    properties: [
        ...createSharedObjectProperties(),
        {
            name: '_BaseColorFactor',
            type: 'vec4',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [1, 1, 1, 1],
            inspector: {
                label: 'Base Color',
                group: 'Surface',
                control: 'color',
            },
        },
        ...createSurfaceTextureProperties('_BaseColorTexture', 'Base Color Map', 'Maps'),
        ...createSharedAlphaProperties(),
    ],
    libraries: GLTF_SHADER_LIBRARIES,
    vertex: {
        includes: ['gltf.skinning'],
        main: [
            'v_UV0 = a_UV0;',
            'v_UV1 = a_UV1;',
            'vec4 localPosition = vec4(a_Position, 1.0);',
            'if (u_Skinning && u_SkinJointCount > 0) {',
            '    localPosition = resolveSkinMatrix() * localPosition;',
            '}',
            'gl_Position = u_Projection * u_View * u_Model * localPosition;',
        ],
    },
    fragment: {
        precision: 'highp',
        outputs: [{ name: 'o_Color', type: 'vec4' }],
        includes: ['gltf.uv'],
        main: [
            'vec4 baseColor = _BaseColorFactor;',
            'if (_BaseColorTexture_TexCoord >= 0) {',
            '    vec2 uv = transformUV(selectUV(_BaseColorTexture_TexCoord), _BaseColorTexture_ST, _BaseColorTexture_Rotation);',
            '    baseColor *= texture(_BaseColorTexture, uv);',
            '}',
            'int alphaMode = int(_AlphaMode + 0.5);',
            'if (alphaMode == 1 && baseColor.a < _AlphaCutoff) {',
            '    discard;',
            '}',
            'if (alphaMode == 0 || alphaMode == 1) {',
            '    baseColor.a = 1.0;',
            '}',
            'o_Color = baseColor;',
        ],
    },
    renderState: {
        depthTest: true,
        cull: true,
        blend: false,
    },
});

const createGltfPbrShaderEffect = (id: string): RenderShaderEffectDefinition => ({
    format: 'axrone.shader/effect',
    version: 1,
    id,
    attributes: [
        { name: 'a_Position', type: 'vec3', location: 0 },
        { name: 'a_Normal', type: 'vec3', location: 1 },
        { name: 'a_UV0', type: 'vec2', location: 2 },
        { name: 'a_Tangent', type: 'vec4', location: 4 },
        { name: 'a_UV1', type: 'vec2', location: 5 },
        { name: 'a_Joints0', type: 'uvec4', location: 9 },
        { name: 'a_Weights0', type: 'vec4', location: 10 },
    ],
    varyings: [
        { name: 'v_UV0', type: 'vec2' },
        { name: 'v_UV1', type: 'vec2' },
        { name: 'v_WorldPosition', type: 'vec3' },
        { name: 'v_WorldNormal', type: 'vec3' },
        { name: 'v_WorldTangent', type: 'vec4' },
    ],
    properties: [
        ...createSharedObjectProperties(),
        {
            name: 'u_ReceiveLighting',
            type: 'bool',
            stages: ['fragment'],
            scope: 'system',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_AmbientLight',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LightDirection',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LightColor',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LightIntensity',
            type: 'float',
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightCount',
            type: 'int',
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightType',
            type: 'int',
            arrayLength: MAX_GLTF_LOCAL_LIGHTS,
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightPosition',
            type: 'vec3',
            arrayLength: MAX_GLTF_LOCAL_LIGHTS,
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightDirection',
            type: 'vec3',
            arrayLength: MAX_GLTF_LOCAL_LIGHTS,
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightColor',
            type: 'vec3',
            arrayLength: MAX_GLTF_LOCAL_LIGHTS,
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightIntensity',
            type: 'float',
            arrayLength: MAX_GLTF_LOCAL_LIGHTS,
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightRange',
            type: 'float',
            arrayLength: MAX_GLTF_LOCAL_LIGHTS,
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightInnerCone',
            type: 'float',
            arrayLength: MAX_GLTF_LOCAL_LIGHTS,
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_LocalLightOuterCone',
            type: 'float',
            arrayLength: MAX_GLTF_LOCAL_LIGHTS,
            stages: ['fragment'],
            scope: 'frame',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: 'u_CameraPosition',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'camera',
            inspector: HIDDEN_INSPECTOR,
        },
        {
            name: '_BaseColorFactor',
            type: 'vec4',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [1, 1, 1, 1],
            inspector: {
                label: 'Base Color',
                group: 'Surface',
                control: 'color',
            },
        },
        ...createSurfaceTextureProperties('_BaseColorTexture', 'Base Color Map', 'Maps'),
        {
            name: '_MetallicFactor',
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: 1,
            inspector: {
                label: 'Metallic',
                group: 'Surface',
                control: 'slider',
                min: 0,
                max: 1,
                step: 0.01,
            },
        },
        {
            name: '_RoughnessFactor',
            type: 'float',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: 1,
            inspector: {
                label: 'Roughness',
                group: 'Surface',
                control: 'slider',
                min: 0,
                max: 1,
                step: 0.01,
            },
        },
        ...createSurfaceTextureProperties(
            '_MetallicRoughnessTexture',
            'Metallic Roughness Map',
            'Maps'
        ),
        ...createSurfaceTextureProperties('_NormalTexture', 'Normal Map', 'Maps', {
            scale: {
                label: 'Normal Scale',
                min: 0,
                max: 2,
                step: 0.01,
                defaultValue: 1,
            },
        }),
        ...createSurfaceTextureProperties('_OcclusionTexture', 'Occlusion Map', 'Maps', {
            strength: {
                label: 'Occlusion Strength',
                min: 0,
                max: 1,
                step: 0.01,
                defaultValue: 1,
            },
        }),
        {
            name: '_EmissiveFactor',
            type: 'vec3',
            stages: ['fragment'],
            scope: 'material',
            defaultValue: [0, 0, 0],
            inspector: {
                label: 'Emissive',
                group: 'Emission',
                control: 'color',
            },
        },
        ...createSurfaceTextureProperties('_EmissiveTexture', 'Emissive Map', 'Emission'),
        ...createSharedAlphaProperties(),
    ],
    libraries: GLTF_SHADER_LIBRARIES,
    vertex: {
        includes: ['gltf.skinning'],
        main: [
            'v_UV0 = a_UV0;',
            'v_UV1 = a_UV1;',
            'mat4 skin = resolveSkinMatrix();',
            'vec4 localPosition = vec4(a_Position, 1.0);',
            'vec3 localNormal = a_Normal;',
            'vec3 localTangent = a_Tangent.xyz;',
            'if (u_Skinning && u_SkinJointCount > 0) {',
            '    localPosition = skin * localPosition;',
            '    localNormal = mat3(skin) * localNormal;',
            '    localTangent = mat3(skin) * localTangent;',
            '}',
            'vec4 worldPosition = u_Model * localPosition;',
            'v_WorldPosition = worldPosition.xyz;',
            'v_WorldNormal = normalize(mat3(u_Model) * localNormal);',
            'v_WorldTangent = vec4(normalize(mat3(u_Model) * localTangent), a_Tangent.w);',
            'gl_Position = u_Projection * u_View * worldPosition;',
        ],
    },
    fragment: {
        precision: 'highp',
        outputs: [{ name: 'o_Color', type: 'vec4' }],
        includes: ['gltf.uv', 'gltf.pbr-lighting'],
        main: [
            'vec4 baseColor = _BaseColorFactor;',
            'if (_BaseColorTexture_TexCoord >= 0) {',
            '    vec2 uv = transformUV(selectUV(_BaseColorTexture_TexCoord), _BaseColorTexture_ST, _BaseColorTexture_Rotation);',
            '    baseColor *= texture(_BaseColorTexture, uv);',
            '}',
            'int alphaMode = int(_AlphaMode + 0.5);',
            'if (alphaMode == 1 && baseColor.a < _AlphaCutoff) {',
            '    discard;',
            '}',
            '',
            'vec3 normal = resolveNormal();',
            'vec3 viewDir = normalize(u_CameraPosition - v_WorldPosition);',
            'vec2 mrUv = transformUV(selectUV(max(_MetallicRoughnessTexture_TexCoord, 0)), _MetallicRoughnessTexture_ST, _MetallicRoughnessTexture_Rotation);',
            'vec4 mrSample = _MetallicRoughnessTexture_TexCoord >= 0 ? texture(_MetallicRoughnessTexture, mrUv) : vec4(1.0);',
            'float roughness = clamp(_RoughnessFactor * mrSample.g, 0.04, 1.0);',
            'float metallic = clamp(_MetallicFactor * mrSample.b, 0.0, 1.0);',
            'vec3 lighting = baseColor.rgb * u_AmbientLight;',
            '',
            'if (u_ReceiveLighting) {',
            '    lighting += evaluateLight(normal, viewDir, baseColor.rgb, metallic, roughness, normalize(-u_LightDirection), u_LightColor, u_LightIntensity);',
            `    for (int index = 0; index < ${MAX_GLTF_LOCAL_LIGHTS}; index += 1) {`,
            '        if (index >= u_LocalLightCount) {',
            '            break;',
            '        }',
            '        vec3 toLight = u_LocalLightPosition[index] - v_WorldPosition;',
            '        float distanceToLight = length(toLight);',
            '        vec3 lightDir = distanceToLight > 0.0 ? toLight / distanceToLight : vec3(0.0, 1.0, 0.0);',
            '        float attenuation = rangeAttenuation(distanceToLight, u_LocalLightRange[index]);',
            '        if (u_LocalLightType[index] == 1) {',
            '            attenuation *= spotAttenuation(lightDir, u_LocalLightDirection[index], u_LocalLightInnerCone[index], u_LocalLightOuterCone[index]);',
            '        }',
            '        lighting += evaluateLight(normal, viewDir, baseColor.rgb, metallic, roughness, lightDir, u_LocalLightColor[index], u_LocalLightIntensity[index] * attenuation);',
            '    }',
            '}',
            '',
            'if (_OcclusionTexture_TexCoord >= 0) {',
            '    vec2 uv = transformUV(selectUV(_OcclusionTexture_TexCoord), _OcclusionTexture_ST, _OcclusionTexture_Rotation);',
            '    float occlusion = texture(_OcclusionTexture, uv).r;',
            '    lighting *= mix(1.0, occlusion, clamp(_OcclusionTexture_Strength, 0.0, 1.0));',
            '}',
            '',
            'vec3 emissive = _EmissiveFactor;',
            'if (_EmissiveTexture_TexCoord >= 0) {',
            '    vec2 uv = transformUV(selectUV(_EmissiveTexture_TexCoord), _EmissiveTexture_ST, _EmissiveTexture_Rotation);',
            '    emissive *= texture(_EmissiveTexture, uv).rgb;',
            '}',
            '',
            'float alpha = alphaMode == 2 ? baseColor.a : 1.0;',
            'o_Color = vec4(lighting + emissive, alpha);',
        ],
    },
    renderState: {
        depthTest: true,
        cull: true,
        blend: false,
    },
});

export const GLTF_UNLIT_SHADER_EFFECT = createGltfUnlitShaderEffect(GLTF_SHADER_UNLIT_ID);
export const GLTF_PBR_SHADER_EFFECT = createGltfPbrShaderEffect(GLTF_SHADER_PBR_ID);

export const createGltfUnlitShaderDefinition = (
    id: string = GLTF_SHADER_UNLIT_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition => {
    const definition = createGltfShaderDefinitionFromEffect(
        id === GLTF_SHADER_UNLIT_ID ? GLTF_UNLIT_SHADER_EFFECT : createGltfUnlitShaderEffect(id),
        GLTF_UNLIT_ATTRIBUTES
    );
    const renderState = resolveVariantRenderState(uniforms);
    return {
        ...definition,
        cull: renderState.cull,
        blend: renderState.blend,
    };
};

export const createGltfPbrShaderDefinition = (
    id: string = GLTF_SHADER_PBR_ID,
    uniforms?: GltfMaterialUniformMap
): GltfShaderDefinition => {
    const definition = createGltfShaderDefinitionFromEffect(
        id === GLTF_SHADER_PBR_ID ? GLTF_PBR_SHADER_EFFECT : createGltfPbrShaderEffect(id),
        GLTF_PBR_ATTRIBUTES
    );
    const renderState = resolveVariantRenderState(uniforms);
    return {
        ...definition,
        cull: renderState.cull,
        blend: renderState.blend,
    };
};

export const resolveGltfRuntimeShaderId = (
    shaderId: string,
    uniforms?: GltfMaterialUniformMap
): string => {
    if (shaderId !== GLTF_SHADER_PBR_ID && shaderId !== GLTF_SHADER_UNLIT_ID) {
        return shaderId;
    }

    return createVariantShaderId(shaderId, {
        blend: isGltfBlendAlphaMode(uniforms),
        doubleSided: isGltfDoubleSided(uniforms),
    });
};

export const resolveGltfShaderDefinition = (
    shaderId: string,
    resolveShaderDefinition?: (shaderId: string) => GltfShaderDefinition | undefined
): GltfShaderDefinition | undefined => {
    if (shaderId.startsWith(GLTF_SHADER_PBR_ID)) {
        return createGltfPbrShaderDefinition(shaderId, {
            _AlphaMode: shaderId.includes(GLTF_SHADER_BLEND_SUFFIX) ? 2 : 0,
            _DoubleSided: shaderId.includes(GLTF_SHADER_DOUBLE_SIDED_SUFFIX) ? 1 : 0,
        });
    }
    if (shaderId.startsWith(GLTF_SHADER_UNLIT_ID)) {
        return createGltfUnlitShaderDefinition(shaderId, {
            _AlphaMode: shaderId.includes(GLTF_SHADER_BLEND_SUFFIX) ? 2 : 0,
            _DoubleSided: shaderId.includes(GLTF_SHADER_DOUBLE_SIDED_SUFFIX) ? 1 : 0,
        });
    }
    return resolveShaderDefinition?.(shaderId);
};