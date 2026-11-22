import type { SceneShaderResource } from '../shader-registry';
import type { SceneShaderDefinition } from '../types';
import { transformSceneShaderForInstancing } from './scene-instanced-mesh-shader';

export interface SceneInstancedShaderResource extends SceneShaderResource {
    /** True when the derived program reads the per-instance color attribute. */
    readonly instanceColor: boolean;
}

const COMPILE_STATUS = 0x8b81;
const LINK_STATUS = 0x8b82;
const ACTIVE_UNIFORMS = 0x8b86;

const compileShader = (
    gl: WebGL2RenderingContext,
    type: number,
    source: string
): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) {
        return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
    }

    return shader;
};

const collectActiveUniforms = (
    gl: WebGL2RenderingContext,
    program: WebGLProgram
): {
    uniformLocations: Map<string, WebGLUniformLocation>;
    uniformTypes: Map<string, number>;
    uniformNames: string[];
} => {
    const uniformLocations = new Map<string, WebGLUniformLocation>();
    const uniformTypes = new Map<string, number>();
    const uniformNames: string[] = [];
    const count = Number(gl.getProgramParameter(program, ACTIVE_UNIFORMS) ?? 0);

    for (let index = 0; index < count; index += 1) {
        const info = gl.getActiveUniform(program, index);
        if (!info) {
            continue;
        }

        const name = info.name.replace(/\[0\]$/, '');
        const location = gl.getUniformLocation(program, info.name);
        if (!location) {
            continue;
        }

        uniformLocations.set(name, location);
        uniformTypes.set(name, info.type);
        uniformNames.push(name);
    }

    return { uniformLocations, uniformTypes, uniformNames };
};

/**
 * Compiles the derived instanced program for a shader definition.
 *
 * Returns `null` when the definition cannot be transformed or fails to link;
 * the caller then keeps the individual draw path for that material.
 */
export const compileSceneInstancedShader = (
    gl: WebGL2RenderingContext,
    definition: SceneShaderDefinition
): SceneInstancedShaderResource | null => {
    const transformed = transformSceneShaderForInstancing(definition);
    if (!transformed) {
        return null;
    }

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, transformed.vertexSource);
    if (!vertexShader) {
        return null;
    }
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, transformed.fragmentSource);
    if (!fragmentShader) {
        gl.deleteShader(vertexShader);
        return null;
    }

    const program = gl.createProgram();
    if (!program) {
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        return null;
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(program, LINK_STATUS)) {
        gl.deleteProgram(program);
        return null;
    }

    const uniforms = collectActiveUniforms(gl, program);

    return {
        id: `${definition.id}#instanced`,
        program,
        uniformLocations: uniforms.uniformLocations,
        uniformTypes: uniforms.uniformTypes,
        uniformNames: uniforms.uniformNames,
        attributeNames: {
            position: 'a_Position',
            normal: 'a_Normal',
            uv0: 'a_UV0',
            uv1: 'a_UV1',
            tangent: 'a_Tangent',
            color0: 'a_Color0',
            joints0: 'a_Joints0',
            weights0: 'a_Weights0',
        },
        depthTest: definition.depthTest ?? true,
        cull: definition.cull ?? true,
        blend: definition.blend ?? false,
        instanceColor: transformed.instanceColor,
    };
};
