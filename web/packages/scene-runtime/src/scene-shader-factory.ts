import type { SceneMeshSemantic, SceneShaderDefinition } from './types';
import { SceneShaderError } from './errors';
import type { SceneShaderResource } from './shader-registry';
import {
    DEFAULT_SCENE_ATTRIBUTE_NAMES,
    SCENE_ATTRIBUTE_LOCATIONS,
} from './scene-vertex-layout';

const normalizeUniformName = (name: string): string => name.replace(/\[0\]$/, '');

const extractUniformNames = (...sources: string[]): string[] => {
    const names = new Set<string>();
    const pattern = /\buniform\s+\w+\s+(\w+)(?:\s*\[[^\]]+\])?\s*;/g;

    for (const source of sources) {
        pattern.lastIndex = 0;
        let match = pattern.exec(source);

        while (match !== null) {
            names.add(match[1]!);
            match = pattern.exec(source);
        }
    }

    return [...names];
};

const mapUniformTypeName = (
    gl: WebGL2RenderingContext,
    typeName: string
): number | undefined => {
    switch (typeName) {
        case 'float':
            return gl.FLOAT;
        case 'vec2':
            return gl.FLOAT_VEC2;
        case 'vec3':
            return gl.FLOAT_VEC3;
        case 'vec4':
            return gl.FLOAT_VEC4;
        case 'int':
            return gl.INT;
        case 'ivec2':
            return gl.INT_VEC2;
        case 'ivec3':
            return gl.INT_VEC3;
        case 'ivec4':
            return gl.INT_VEC4;
        case 'uint':
            return gl.UNSIGNED_INT;
        case 'uvec2':
            return gl.UNSIGNED_INT_VEC2;
        case 'uvec3':
            return gl.UNSIGNED_INT_VEC3;
        case 'uvec4':
            return gl.UNSIGNED_INT_VEC4;
        case 'bool':
            return gl.BOOL;
        case 'bvec2':
            return gl.BOOL_VEC2;
        case 'bvec3':
            return gl.BOOL_VEC3;
        case 'bvec4':
            return gl.BOOL_VEC4;
        case 'mat4':
            return gl.FLOAT_MAT4;
        case 'sampler2D':
            return gl.SAMPLER_2D;
        case 'samplerCube':
            return gl.SAMPLER_CUBE;
        default:
            return undefined;
    }
};

const extractUniformTypeHints = (
    gl: WebGL2RenderingContext,
    ...sources: string[]
): Map<string, number> => {
    const types = new Map<string, number>();
    const pattern = /\buniform\s+(\w+)\s+(\w+)(?:\s*\[[^\]]+\])?\s*;/g;

    for (const source of sources) {
        pattern.lastIndex = 0;
        let match = pattern.exec(source);

        while (match !== null) {
            const uniformType = mapUniformTypeName(gl, match[1]!);
            if (uniformType !== undefined) {
                const uniformName = match[2]!;
                types.set(uniformName, uniformType);
                types.set(normalizeUniformName(uniformName), uniformType);
            }
            match = pattern.exec(source);
        }
    }

    return types;
};

export interface SceneShaderFactoryOptions {
    readonly gl: WebGL2RenderingContext;
}

export class SceneShaderFactory {
    constructor(private readonly _options: SceneShaderFactoryOptions) {}

    create(definition: SceneShaderDefinition): SceneShaderResource {
        const program = this._options.gl.createProgram();
        if (!program) {
            throw new SceneShaderError(`Failed to create shader program '${definition.id}'`);
        }

        const attributeNames = {
            ...DEFAULT_SCENE_ATTRIBUTE_NAMES,
            ...(definition.attributes ?? {}),
        } as Record<SceneMeshSemantic, string>;

        const vertexShader = this._compileShader(
            this._options.gl.VERTEX_SHADER,
            definition.vertexSource
        );
        const fragmentShader = this._compileShader(
            this._options.gl.FRAGMENT_SHADER,
            definition.fragmentSource
        );

        try {
            for (const semantic of Object.keys(attributeNames) as SceneMeshSemantic[]) {
                this._options.gl.bindAttribLocation(
                    program,
                    SCENE_ATTRIBUTE_LOCATIONS[semantic],
                    attributeNames[semantic]
                );
            }

            this._options.gl.attachShader(program, vertexShader);
            this._options.gl.attachShader(program, fragmentShader);
            this._options.gl.linkProgram(program);

            if (!this._options.gl.getProgramParameter(program, this._options.gl.LINK_STATUS)) {
                const info =
                    this._options.gl.getProgramInfoLog(program) ?? 'Unknown link failure';
                throw new SceneShaderError(
                    `Failed to link shader '${definition.id}': ${info}`
                );
            }

            const uniformNames = Array.from(
                new Set(
                    definition.uniforms ??
                        extractUniformNames(definition.vertexSource, definition.fragmentSource)
                )
            );

            const uniformLocations = new Map<string, WebGLUniformLocation>();
            const uniformTypes = new Map<string, number>();
            for (let index = 0; index < uniformNames.length; index += 1) {
                const uniformName = uniformNames[index]!;
                const location = this._options.gl.getUniformLocation(program, uniformName);
                if (location !== null) {
                    uniformLocations.set(uniformName, location);
                }
            }

            if (typeof this._options.gl.getActiveUniform === 'function') {
                const activeUniformCount = this._options.gl.getProgramParameter(
                    program,
                    this._options.gl.ACTIVE_UNIFORMS
                );

                for (let index = 0; index < activeUniformCount; index += 1) {
                    const info = this._options.gl.getActiveUniform(program, index);
                    if (!info) {
                        continue;
                    }

                    const normalizedName = normalizeUniformName(info.name);
                    uniformTypes.set(info.name, info.type);
                    uniformTypes.set(normalizedName, info.type);
                }
            }

            for (const [uniformName, uniformType] of extractUniformTypeHints(
                this._options.gl,
                definition.vertexSource,
                definition.fragmentSource
            )) {
                if (!uniformTypes.has(uniformName)) {
                    uniformTypes.set(uniformName, uniformType);
                }
            }

            return {
                id: definition.id,
                program,
                uniformLocations,
                uniformTypes,
                uniformNames,
                attributeNames,
                depthTest: definition.depthTest ?? true,
                cull: definition.cull ?? true,
                blend: definition.blend ?? false,
            };
        } finally {
            this._options.gl.deleteShader(vertexShader);
            this._options.gl.deleteShader(fragmentShader);
        }
    }

    delete(resource: SceneShaderResource): void {
        this._options.gl.deleteProgram(resource.program);
    }

    private _compileShader(type: number, source: string): WebGLShader {
        const shader = this._options.gl.createShader(type);
        if (!shader) {
            throw new SceneShaderError('Failed to create WebGL shader');
        }

        this._options.gl.shaderSource(shader, source);
        this._options.gl.compileShader(shader);

        if (!this._options.gl.getShaderParameter(shader, this._options.gl.COMPILE_STATUS)) {
            const info =
                this._options.gl.getShaderInfoLog(shader) ?? 'Unknown compilation failure';
            this._options.gl.deleteShader(shader);
            throw new SceneShaderError(`Shader compilation failed: ${info}`);
        }

        return shader;
    }
}
