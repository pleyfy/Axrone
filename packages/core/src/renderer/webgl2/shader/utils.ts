import { ShaderDataType, ShaderStage } from './interfaces';

export const getShaderDataTypeSize = (type: ShaderDataType): number => {
    switch (type) {
        case ShaderDataType.FLOAT:
        case ShaderDataType.INT:
        case ShaderDataType.UINT:
        case ShaderDataType.BOOL:
            return 4;

        case ShaderDataType.VEC2:
        case ShaderDataType.IVEC2:
        case ShaderDataType.UVEC2:
        case ShaderDataType.BVEC2:
            return 8;

        case ShaderDataType.VEC3:
        case ShaderDataType.IVEC3:
        case ShaderDataType.UVEC3:
        case ShaderDataType.BVEC3:
            return 12;

        case ShaderDataType.VEC4:
        case ShaderDataType.IVEC4:
        case ShaderDataType.UVEC4:
        case ShaderDataType.BVEC4:
        case ShaderDataType.MAT2:
            return 16;

        case ShaderDataType.MAT3:
            return 36;

        case ShaderDataType.MAT4:
            return 64;

        case ShaderDataType.SAMPLER_2D:
        case ShaderDataType.SAMPLER_CUBE:
        case ShaderDataType.SAMPLER_2D_ARRAY:
            return 4; 

        default:
            throw new Error(`Unknown shader data type: ${type}`);
    }
};

export const getShaderDataTypeComponentCount = (type: ShaderDataType): number => {
    switch (type) {
        case ShaderDataType.FLOAT:
        case ShaderDataType.INT:
        case ShaderDataType.UINT:
        case ShaderDataType.BOOL:
        case ShaderDataType.SAMPLER_2D:
        case ShaderDataType.SAMPLER_CUBE:
        case ShaderDataType.SAMPLER_2D_ARRAY:
            return 1;

        case ShaderDataType.VEC2:
        case ShaderDataType.IVEC2:
        case ShaderDataType.UVEC2:
        case ShaderDataType.BVEC2:
            return 2;

        case ShaderDataType.VEC3:
        case ShaderDataType.IVEC3:
        case ShaderDataType.UVEC3:
        case ShaderDataType.BVEC3:
            return 3;

        case ShaderDataType.VEC4:
        case ShaderDataType.IVEC4:
        case ShaderDataType.UVEC4:
        case ShaderDataType.BVEC4:
        case ShaderDataType.MAT2:
            return 4;

        case ShaderDataType.MAT3:
            return 9;

        case ShaderDataType.MAT4:
            return 16;

        default:
            throw new Error(`Unknown shader data type: ${type}`);
    }
};

export const getWebGLType = (gl: WebGL2RenderingContext, type: ShaderDataType): number => {
    switch (type) {
        case ShaderDataType.FLOAT:
        case ShaderDataType.VEC2:
        case ShaderDataType.VEC3:
        case ShaderDataType.VEC4:
        case ShaderDataType.MAT2:
        case ShaderDataType.MAT3:
        case ShaderDataType.MAT4:
            return gl.FLOAT;

        case ShaderDataType.INT:
        case ShaderDataType.IVEC2:
        case ShaderDataType.IVEC3:
        case ShaderDataType.IVEC4:
            return gl.INT;

        case ShaderDataType.UINT:
        case ShaderDataType.UVEC2:
        case ShaderDataType.UVEC3:
        case ShaderDataType.UVEC4:
            return gl.UNSIGNED_INT;

        case ShaderDataType.BOOL:
        case ShaderDataType.BVEC2:
        case ShaderDataType.BVEC3:
        case ShaderDataType.BVEC4:
            return gl.BOOL;

        case ShaderDataType.SAMPLER_2D:
            return gl.SAMPLER_2D;

        case ShaderDataType.SAMPLER_CUBE:
            return gl.SAMPLER_CUBE;

        case ShaderDataType.SAMPLER_2D_ARRAY:
            return gl.SAMPLER_2D_ARRAY;

        default:
            throw new Error(`Unknown shader data type: ${type}`);
    }
};

export const MAX_VERTEX_ATTRIBUTES = 16;

export const MAX_TEXTURE_UNITS = 32;

export const MAX_UNIFORM_BLOCKS = 16;

export const MAX_UNIFORM_BUFFER_SIZE = 64 * 1024; 

export const SHADER_CACHE_LIMITS = {
    MAX_COMPILED_SHADERS: 256,
    MAX_VARIANTS_PER_SHADER: 64,
    MAX_CONFIGURATIONS: 128,
    MAX_TOTAL_VARIANTS: 1024,
    MAX_CACHE_SIZE_BYTES: 16 * 1024 * 1024, 
} as const;

export const VERTEX_SEMANTICS = {
    POSITION: 'POSITION',
    NORMAL: 'NORMAL', 
    TANGENT: 'TANGENT',
    BITANGENT: 'BITANGENT',
    COLOR: 'COLOR',
    TEXCOORD: 'TEXCOORD',
    BLENDINDICES: 'BLENDINDICES',
    BLENDWEIGHT: 'BLENDWEIGHT',
    INSTANCE_MATRIX: 'INSTANCE_MATRIX',
    INSTANCE_COLOR: 'INSTANCE_COLOR',
} as const;

export const UNIFORM_SEMANTICS = {

    MODEL_MATRIX: 'u_ModelMatrix',
    VIEW_MATRIX: 'u_ViewMatrix',
    PROJECTION_MATRIX: 'u_ProjectionMatrix',
    MVP_MATRIX: 'u_MVPMatrix',
    NORMAL_MATRIX: 'u_NormalMatrix',

    CAMERA_POSITION: 'u_CameraPosition',
    CAMERA_DIRECTION: 'u_CameraDirection',

    TIME: 'u_Time',
    DELTA_TIME: 'u_DeltaTime',
    FRAME_COUNT: 'u_FrameCount',

    SCREEN_SIZE: 'u_ScreenSize',
    TEXEL_SIZE: 'u_TexelSize',

    MAIN_TEXTURE: 'u_MainTexture',
    NORMAL_MAP: 'u_NormalMap',
    METALLIC_MAP: 'u_MetallicMap',
    ROUGHNESS_MAP: 'u_RoughnessMap',
    EMISSION_MAP: 'u_EmissionMap',
    OCCLUSION_MAP: 'u_OcclusionMap',

    LIGHT_COUNT: 'u_LightCount',
    AMBIENT_COLOR: 'u_AmbientColor',

} as const;

export const SHADER_KEYWORDS = {

    DIRECTIONAL_LIGHT: 'DIRECTIONAL_LIGHT',
    POINT_LIGHT: 'POINT_LIGHT',
    SPOT_LIGHT: 'SPOT_LIGHT',

    NORMAL_MAPPING: 'NORMAL_MAPPING',
    METALLIC_WORKFLOW: 'METALLIC_WORKFLOW',
    SPECULAR_WORKFLOW: 'SPECULAR_WORKFLOW',
    EMISSION: 'EMISSION',
    OCCLUSION: 'OCCLUSION',

    INSTANCING: 'INSTANCING',
    SKINNING: 'SKINNING',
    VERTEX_COLOR: 'VERTEX_COLOR',
    FOG: 'FOG',
    SHADOWS: 'SHADOWS',

    WEBGL2: 'WEBGL2',
    MOBILE: 'MOBILE',
    DESKTOP: 'DESKTOP',

} as const;

export const generateVersionDirective = (version: string = '300 es'): string => {
    return `#version ${version}\n`;
};

export const generatePrecisionDirective = (precision: 'lowp' | 'mediump' | 'highp' = 'mediump'): string => {
    return `precision ${precision} float;\n`;
};

export const generateDefines = (defines: Record<string, string | number | boolean>): string => {
    return Object.entries(defines)
        .map(([key, value]) => {
            if (typeof value === 'boolean') {
                return value ? `#define ${key}\n` : '';
            }
            return `#define ${key} ${value}\n`;
        })
        .join('');
};

export const generateIncludes = (includes: string[]): string => {
    return includes.map(include => `#include "${include}"\n`).join('');
};

export const hashShaderSource = (source: string): string => {
    let hash = 0;
    for (let i = 0; i < source.length; i++) {
        const char = source.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; 
    }
    return Math.abs(hash).toString(36);
};

export const generateVariantKey = (
    shaderName: string,
    keywords: readonly string[],
    defines: Record<string, any>
): string => {
    const sortedKeywords = [...keywords].sort().join('|');
    const sortedDefines = Object.entries(defines)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}:${value}`)
        .join('|');

    return `${shaderName}_${hashShaderSource(sortedKeywords)}_${hashShaderSource(sortedDefines)}`;
};

export const isValidShaderVariableName = (name: string): boolean => {

    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
};

export const isValidStageCombo = (stages: ShaderStage[]): boolean => {
    const stageSet = new Set(stages);

    if (stageSet.has(ShaderStage.COMPUTE)) {
        return stages.length === 1; 
    }

    if (!stageSet.has(ShaderStage.VERTEX)) {
        return false; 
    }

    const hasTessControl = stageSet.has(ShaderStage.TESSELLATION_CONTROL);
    const hasTessEval = stageSet.has(ShaderStage.TESSELLATION_EVALUATION);
    if (hasTessControl !== hasTessEval) {
        return false;
    }

    return true;
};

export const validateUniformNaming = (name: string): { valid: boolean; warnings: string[] } => {
    const warnings: string[] = [];

    if (!isValidShaderVariableName(name)) {
        return { valid: false, warnings: ['Invalid uniform name format'] };
    }

    if (!name.startsWith('u_')) {
        warnings.push('Uniform names should start with "u_" prefix for consistency');
    }

    if (name.length > 64) {
        warnings.push('Uniform name is very long, consider shortening');
    }

    return { valid: true, warnings };
};

export const calculateAlignedOffset = (offset: number, alignment: number): number => {
    return Math.ceil(offset / alignment) * alignment;
};

export const getShaderDataTypeAlignment = (type: ShaderDataType): number => {
    switch (type) {
        case ShaderDataType.FLOAT:
        case ShaderDataType.INT:
        case ShaderDataType.UINT:
        case ShaderDataType.BOOL:
            return 4;

        case ShaderDataType.VEC2:
        case ShaderDataType.IVEC2:
        case ShaderDataType.UVEC2:
        case ShaderDataType.BVEC2:
            return 8;

        case ShaderDataType.VEC3:
        case ShaderDataType.IVEC3:
        case ShaderDataType.UVEC3:
        case ShaderDataType.BVEC3:
        case ShaderDataType.VEC4:
        case ShaderDataType.IVEC4:
        case ShaderDataType.UVEC4:
        case ShaderDataType.BVEC4:
        case ShaderDataType.MAT2:
            return 16;

        case ShaderDataType.MAT3:
        case ShaderDataType.MAT4:
            return 16; 

        default:
            return 4;
    }
};

export const calculateUniformBufferLayout = (variables: Array<{ name: string; type: ShaderDataType; arraySize?: number }>): {
    layout: Array<{ name: string; offset: number; size: number }>;
    totalSize: number;
} => {
    const layout: Array<{ name: string; offset: number; size: number }> = [];
    let currentOffset = 0;

    for (const variable of variables) {
        const elementSize = getShaderDataTypeSize(variable.type);
        const alignment = getShaderDataTypeAlignment(variable.type);
        const arraySize = variable.arraySize || 1;

        currentOffset = calculateAlignedOffset(currentOffset, alignment);

        const totalSize = elementSize * arraySize;

        layout.push({
            name: variable.name,
            offset: currentOffset,
            size: totalSize
        });

        currentOffset += totalSize;
    }

    const totalSize = calculateAlignedOffset(currentOffset, 16);

    return { layout, totalSize };
};
