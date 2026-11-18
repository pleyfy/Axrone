import type { GltfMeshSemantic } from '@axrone/asset-gltf';
import { createLightingUniformLayout } from '@axrone/lighting';
import type { RenderShaderPropertyDefinition } from '@axrone/scene-runtime';
import { MAX_GLTF_SKIN_JOINTS } from './gltf-shader-libraries';

export const GLTF_LIGHTING_LAYOUT = createLightingUniformLayout({
    maxDirectionalLights: 1,
    maxPointLights: 4,
    maxSpotLights: 4,
    maxLocalLights: 4,
});
export const GLTF_LIGHTING_UNIFORMS = GLTF_LIGHTING_LAYOUT.names;
export const MAX_GLTF_DIRECTIONAL_LIGHTS = GLTF_LIGHTING_LAYOUT.capacity.maxDirectionalLights;
export const MAX_GLTF_POINT_LIGHTS = GLTF_LIGHTING_LAYOUT.capacity.maxPointLights;
export const MAX_GLTF_SPOT_LIGHTS = GLTF_LIGHTING_LAYOUT.capacity.maxSpotLights;

export const HIDDEN_INSPECTOR = Object.freeze({ hidden: true } as const);

const GLTF_ALPHA_MODE_OPTIONS = Object.freeze([
    { label: 'Opaque', value: 0 },
    { label: 'Mask', value: 1 },
    { label: 'Blend', value: 2 },
] as const);

export const createLightingProperties = (): readonly RenderShaderPropertyDefinition[] =>
    GLTF_LIGHTING_LAYOUT.properties
        .filter(
            (property) =>
                property.name !== 'u_Exposure' &&
                property.name !== 'u_Gamma' &&
                !property.name.startsWith('u_Local')
        )
        .map((property) => ({
        name: property.name,
        type: property.type,
        ...(property.arrayLength !== undefined ? { arrayLength: property.arrayLength } : {}),
        stages: ['fragment'],
        scope: property.scope,
        inspector: HIDDEN_INSPECTOR,
    }));

export const GLTF_UNLIT_ATTRIBUTES = Object.freeze({
    position: 'a_Position',
    uv0: 'a_UV0',
    uv1: 'a_UV1',
    joints0: 'a_Joints0',
    weights0: 'a_Weights0',
} satisfies Partial<Record<GltfMeshSemantic, string>>);

export const GLTF_PBR_ATTRIBUTES = Object.freeze({
    position: 'a_Position',
    normal: 'a_Normal',
    uv0: 'a_UV0',
    tangent: 'a_Tangent',
    uv1: 'a_UV1',
    joints0: 'a_Joints0',
    weights0: 'a_Weights0',
} satisfies Partial<Record<GltfMeshSemantic, string>>);

export const GLTF_TOON_ATTRIBUTES = Object.freeze({
    position: 'a_Position',
    normal: 'a_Normal',
    uv0: 'a_UV0',
    uv1: 'a_UV1',
    joints0: 'a_Joints0',
    weights0: 'a_Weights0',
} satisfies Partial<Record<GltfMeshSemantic, string>>);

export const createSurfaceTextureProperties = (
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

export const createSharedObjectProperties = (): readonly RenderShaderPropertyDefinition[] => [
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

export const createSharedAlphaProperties = (): readonly RenderShaderPropertyDefinition[] => [
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

export const createSharedSurfaceFactorProperties = (): readonly RenderShaderPropertyDefinition[] => [
    {
        name: '_OpacityFactor',
        type: 'float',
        stages: ['fragment'],
        scope: 'material',
        defaultValue: 1,
        inspector: {
            label: 'Opacity',
            group: 'Surface',
            control: 'slider',
            min: 0,
            max: 1,
            step: 0.01,
        },
    },
    {
        name: '_EmissiveIntensity',
        type: 'float',
        stages: ['fragment'],
        scope: 'material',
        defaultValue: 1,
        inspector: {
            label: 'Emissive Intensity',
            group: 'Emission',
            control: 'slider',
            min: 0,
            max: 10,
            step: 0.05,
        },
    },
    {
        name: '_VertexOffset',
        type: 'vec3',
        stages: ['vertex'],
        scope: 'material',
        defaultValue: [0, 0, 0],
        inspector: HIDDEN_INSPECTOR,
    },
];
