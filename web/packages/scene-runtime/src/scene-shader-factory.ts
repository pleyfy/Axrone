import { compileRenderShaderEffect } from '@axrone/render-core/shader-effect';
import { Djb2 } from '@axrone/hash';
import type { SceneMeshSemantic, SceneShaderDefinition } from './types';
import { SceneShaderError } from './errors';
import type { SceneShaderResource } from './shader-registry';
import {
    DEFAULT_SCENE_ATTRIBUTE_NAMES,
    SCENE_ATTRIBUTE_LOCATIONS,
} from './scene-vertex-layout';

const COMPLETION_STATUS_KHR = 0x9b85;

interface KHRParallelShaderCompile {
    readonly COMPLETION_STATUS_KHR: number;
}

interface ResolvedSources {
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly uniformNames: readonly string[];
}

interface CachedProgramEntry {
    readonly program: WebGLProgram;
    readonly uniformLocations: Map<string, WebGLUniformLocation>;
    readonly uniformTypes: Map<string, number>;
    readonly uniformNames: string[];
    /** Full sources retained so cache hits can be verified — a 32-bit key match alone is not trusted. */
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly attributeKey: string;
    refcount: number;
}

export interface ShaderCacheEntrySources {
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly attributeKey: string;
}

/**
 * Verifies that a cache entry was compiled from the requested sources.
 * A hash-key match without this check could silently return a program
 * compiled from different sources on a 32-bit key collision.
 */
export const isShaderCacheEntryMatchingSources = (
    entry: ShaderCacheEntrySources,
    vertexSource: string,
    fragmentSource: string,
    attributeKey: string
): boolean =>
    entry.vertexSource === vertexSource &&
    entry.fragmentSource === fragmentSource &&
    entry.attributeKey === attributeKey;

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

const _djb2Hasher = new Djb2();

const hashString = (input: string): string => {
    _djb2Hasher.reset();
    _djb2Hasher.updateString(input);
    return (_djb2Hasher.digest() as number).toString(36);
};

const resolveDepthTest = (definition: SceneShaderDefinition): boolean =>
    definition.depthTest ?? definition.effect?.renderState?.depthTest ?? true;

const resolveCull = (definition: SceneShaderDefinition): boolean =>
    definition.cull ?? definition.effect?.renderState?.cull ?? true;

const resolveBlend = (definition: SceneShaderDefinition): boolean =>
    definition.blend ?? definition.effect?.renderState?.blend ?? false;

const KEYWORD_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

const injectKeywordDefines = (source: string, keywords: readonly string[]): string => {
    if (keywords.length === 0) {
        return source;
    }

    const validKeywords: string[] = [];
    for (const keyword of keywords) {
        if (KEYWORD_PATTERN.test(keyword)) {
            validKeywords.push(keyword);
        }
    }

    if (validKeywords.length === 0) {
        return source;
    }

    const defines = validKeywords.map((keyword) => `#define ${keyword}`).join('\n');
    const versionMatch = source.match(/^(\s*#version\s+[^\n]+\n)/);

    if (versionMatch) {
        const insertPos = versionMatch[0].length;
        return source.slice(0, insertPos) + defines + '\n' + source.slice(insertPos);
    }

    return defines + '\n' + source;
};

export const generateSceneShaderVariantKey = (
    shaderId: string,
    enabledKeywords: readonly string[]
): string => {
    if (enabledKeywords.length === 0) {
        return shaderId;
    }
    const sorted = [...enabledKeywords].sort();
    return `${shaderId}:${sorted.join(',')}`;
};

export interface SceneShaderFactoryOptions {
    readonly gl: WebGL2RenderingContext;
    readonly enableCache?: boolean;
}

export interface SceneShaderFactoryStats {
    readonly cacheSize: number;
    readonly cacheHits: number;
    readonly cacheMisses: number;
    readonly parallelCompileAvailable: boolean;
}

export interface SceneShaderCreateBatchOptions {
    readonly pollMode?: 'busy' | 'yield';
}

export class SceneShaderFactory {
    private readonly _gl: WebGL2RenderingContext;
    private readonly _parallelExt: KHRParallelShaderCompile | null;
    private readonly _cache = new Map<string, CachedProgramEntry>();
    private readonly _programToKey = new Map<WebGLProgram, string>();
    private _cacheHits = 0;
    private _cacheMisses = 0;
    private readonly _cacheEnabled: boolean;

    constructor(options: SceneShaderFactoryOptions) {
        this._gl = options.gl;
        const rawExt =
            typeof this._gl.getExtension === 'function'
                ? this._gl.getExtension('KHR_parallel_shader_compile')
                : null;
        this._parallelExt = rawExt ? (rawExt as KHRParallelShaderCompile) : null;
        this._cacheEnabled = options.enableCache ?? true;
    }

    get parallelCompileAvailable(): boolean {
        return this._parallelExt !== null;
    }

    get stats(): SceneShaderFactoryStats {
        return {
            cacheSize: this._cache.size,
            cacheHits: this._cacheHits,
            cacheMisses: this._cacheMisses,
            parallelCompileAvailable: this._parallelExt !== null,
        };
    }

    create(definition: SceneShaderDefinition): SceneShaderResource {
        const resolved = this._resolveSources(definition);
        const attributeNames = this._resolveAttributeNames(definition);
        const attributeKey = JSON.stringify(attributeNames);

        const cacheKey = this._cacheEnabled
            ? this._buildCacheKey(resolved.vertexSource, resolved.fragmentSource, attributeKey)
            : null;

        if (cacheKey !== null) {
            const cached = this._cache.get(cacheKey);
            if (
                cached &&
                isShaderCacheEntryMatchingSources(
                    cached,
                    resolved.vertexSource,
                    resolved.fragmentSource,
                    attributeKey
                )
            ) {
                cached.refcount += 1;
                this._cacheHits += 1;
                return this._buildResource(definition, cached, attributeNames);
            }
        }

        this._cacheMisses += 1;

        const entry = this._compileAndReflect(
            definition.id,
            resolved.vertexSource,
            resolved.fragmentSource,
            attributeNames,
            attributeKey,
            resolved.uniformNames
        );

        if (cacheKey !== null) {
            entry.refcount = 1;
            this._storeCacheEntry(cacheKey, entry);
        }

        return this._buildResource(definition, entry, attributeNames);
    }

    createVariant(
        definition: SceneShaderDefinition,
        enabledKeywords: readonly string[]
    ): SceneShaderResource {
        if (enabledKeywords.length === 0) {
            return this.create(definition);
        }

        const resolved = this._resolveSources(definition);
        const variantVertex = injectKeywordDefines(resolved.vertexSource, enabledKeywords);
        const variantFragment = injectKeywordDefines(resolved.fragmentSource, enabledKeywords);
        const attributeNames = this._resolveAttributeNames(definition);
        const attributeKey = JSON.stringify(attributeNames);

        const variantUniformNames = Array.from(
            new Set(
                definition.uniforms ??
                    extractUniformNames(variantVertex, variantFragment)
            )
        );

        const cacheKey = this._cacheEnabled
            ? this._buildCacheKey(variantVertex, variantFragment, attributeKey)
            : null;

        if (cacheKey !== null) {
            const cached = this._cache.get(cacheKey);
            if (
                cached &&
                isShaderCacheEntryMatchingSources(
                    cached,
                    variantVertex,
                    variantFragment,
                    attributeKey
                )
            ) {
                cached.refcount += 1;
                this._cacheHits += 1;
                return this._buildVariantResource(
                    definition,
                    enabledKeywords,
                    cached,
                    attributeNames
                );
            }
        }

        this._cacheMisses += 1;

        const entry = this._compileAndReflect(
            generateSceneShaderVariantKey(definition.id, enabledKeywords),
            variantVertex,
            variantFragment,
            attributeNames,
            attributeKey,
            variantUniformNames
        );

        if (cacheKey !== null) {
            entry.refcount = 1;
            this._storeCacheEntry(cacheKey, entry);
        }

        return this._buildVariantResource(
            definition,
            enabledKeywords,
            entry,
            attributeNames
        );
    }

    async createBatch(
        definitions: readonly SceneShaderDefinition[],
        options: SceneShaderCreateBatchOptions = {}
    ): Promise<SceneShaderResource[]> {
        if (!this._parallelExt || definitions.length <= 1) {
            return definitions.map((definition) => this.create(definition));
        }

        const pollMode = options.pollMode ?? 'yield';

        interface PendingEntry {
            readonly index: number;
            readonly definition: SceneShaderDefinition;
            readonly resolved: ResolvedSources;
            readonly attributeNames: Record<SceneMeshSemantic, string>;
            readonly attributeKey: string;
            readonly cacheKey: string | null;
            readonly program: WebGLProgram;
        }

        const results: SceneShaderResource[] = new Array(definitions.length);
        const pending: PendingEntry[] = [];

        for (let i = 0; i < definitions.length; i += 1) {
            const definition = definitions[i]!;
            const resolved = this._resolveSources(definition);
            const attributeNames = this._resolveAttributeNames(definition);
            const attributeKey = JSON.stringify(attributeNames);
            const cacheKey = this._cacheEnabled
                ? this._buildCacheKey(resolved.vertexSource, resolved.fragmentSource, attributeKey)
                : null;

            if (cacheKey !== null) {
                const cached = this._cache.get(cacheKey);
                if (
                    cached &&
                    isShaderCacheEntryMatchingSources(
                        cached,
                        resolved.vertexSource,
                        resolved.fragmentSource,
                        attributeKey
                    )
                ) {
                    cached.refcount += 1;
                    this._cacheHits += 1;
                    results[i] = this._buildResource(definition, cached, attributeNames);
                    continue;
                }
            }

            this._cacheMisses += 1;

            const program = this._submitProgram(
                definition.id,
                resolved.vertexSource,
                resolved.fragmentSource,
                attributeNames
            );

            pending.push({ index: i, definition, resolved, attributeNames, attributeKey, cacheKey, program });
        }

        if (pending.length === 0) {
            return results;
        }

        const completionStatus = this._parallelExt!.COMPLETION_STATUS_KHR;

        if (pollMode === 'busy') {
            for (const entry of pending) {
                while (!this._gl.getProgramParameter(entry.program, completionStatus)) {
                    // busy-poll: GPU driver compiles in parallel threads
                }
            }
        } else {
            const stillPending = [...pending];

            while (stillPending.length > 0) {
                for (let i = stillPending.length - 1; i >= 0; i -= 1) {
                    const entry = stillPending[i]!;
                    if (this._gl.getProgramParameter(entry.program, completionStatus)) {
                        stillPending.splice(i, 1);
                    }
                }

                if (stillPending.length > 0) {
                    await new Promise<void>((resolve) => setTimeout(resolve, 0));
                }
            }
        }

        for (const entry of pending) {
            if (!this._gl.getProgramParameter(entry.program, this._gl.LINK_STATUS)) {
                const info =
                    this._gl.getProgramInfoLog(entry.program) ?? 'Unknown link failure';
                this._cleanupPending(pending);
                throw new SceneShaderError(
                    `Failed to link shader '${entry.definition.id}': ${info}`
                );
            }
        }

        for (const entry of pending) {
            const cached = this._extractReflection(
                entry.program,
                entry.resolved.vertexSource,
                entry.resolved.fragmentSource,
                entry.resolved.uniformNames
            );

            const cacheEntry: CachedProgramEntry = {
                program: entry.program,
                ...cached,
                vertexSource: entry.resolved.vertexSource,
                fragmentSource: entry.resolved.fragmentSource,
                attributeKey: entry.attributeKey,
                refcount: 1,
            };

            if (entry.cacheKey !== null) {
                this._storeCacheEntry(entry.cacheKey, cacheEntry);
            }

            results[entry.index] = this._buildResource(entry.definition, cacheEntry, entry.attributeNames);
        }

        return results;
    }

    delete(resource: SceneShaderResource): void {
        if (this._cacheEnabled) {
            const key = this._programToKey.get(resource.program);
            if (key !== undefined) {
                const entry = this._cache.get(key);
                if (entry) {
                    entry.refcount -= 1;
                    if (entry.refcount <= 0) {
                        this._gl.deleteProgram(entry.program);
                        this._cache.delete(key);
                        this._programToKey.delete(resource.program);
                    }
                    return;
                }
            }
        }

        this._gl.deleteProgram(resource.program);
    }

    clearCache(): void {
        for (const entry of this._cache.values()) {
            this._gl.deleteProgram(entry.program);
        }
        this._cache.clear();
        this._programToKey.clear();
    }

    private _resolveSources(definition: SceneShaderDefinition): ResolvedSources {
        if (definition.vertexSource && definition.fragmentSource) {
            return {
                vertexSource: definition.vertexSource,
                fragmentSource: definition.fragmentSource,
                uniformNames: Array.from(
                    new Set(
                        definition.uniforms ??
                            extractUniformNames(definition.vertexSource, definition.fragmentSource)
                    )
                ),
            };
        }

        if (!definition.effect) {
            throw new SceneShaderError(
                `Shader definition '${definition.id}' must provide shader sources or an effect definition`
            );
        }

        const compiledEffect = compileRenderShaderEffect(definition.effect);

        return {
            vertexSource: compiledEffect.vertexSource,
            fragmentSource: compiledEffect.fragmentSource,
            uniformNames: Array.from(new Set(definition.uniforms ?? compiledEffect.uniformNames)),
        };
    }

    private _resolveAttributeNames(
        definition: SceneShaderDefinition
    ): Record<SceneMeshSemantic, string> {
        return {
            ...DEFAULT_SCENE_ATTRIBUTE_NAMES,
            ...(definition.attributes ?? {}),
        } as Record<SceneMeshSemantic, string>;
    }

    private _buildCacheKey(
        vertexSource: string,
        fragmentSource: string,
        attributeKey: string
    ): string {
        const attrHash = hashString(attributeKey);
        return `${hashString(vertexSource)}_${hashString(fragmentSource)}_${attrHash}`;
    }

    /**
     * Stores a compiled entry unless the key slot is occupied by an entry
     * compiled from different sources (hash collision). The colliding
     * program is never cached — it stays usable and `delete()` releases it
     * directly — so a collision can only cost one redundant compile, never
     * a wrong program.
     */
    private _storeCacheEntry(cacheKey: string, entry: CachedProgramEntry): void {
        const existing = this._cache.get(cacheKey);
        if (
            existing &&
            !isShaderCacheEntryMatchingSources(
                existing,
                entry.vertexSource,
                entry.fragmentSource,
                entry.attributeKey
            )
        ) {
            return;
        }
        this._cache.set(cacheKey, entry);
        this._programToKey.set(entry.program, cacheKey);
    }

    private _compileShaderObject(type: number, source: string): WebGLShader {
        const shader = this._gl.createShader(type);
        if (!shader) {
            throw new SceneShaderError('Failed to create WebGL shader');
        }

        this._gl.shaderSource(shader, source);
        this._gl.compileShader(shader);

        if (!this._gl.getShaderParameter(shader, this._gl.COMPILE_STATUS)) {
            const info = this._gl.getShaderInfoLog(shader) ?? 'Unknown compilation failure';
            this._gl.deleteShader(shader);
            throw new SceneShaderError(`Shader compilation failed: ${info}`);
        }

        return shader;
    }

    private _compileAndReflect(
        shaderId: string,
        vertexSource: string,
        fragmentSource: string,
        attributeNames: Record<SceneMeshSemantic, string>,
        attributeKey: string,
        uniformNames: readonly string[]
    ): CachedProgramEntry {
        const program = this._gl.createProgram();
        if (!program) {
            throw new SceneShaderError(`Failed to create shader program '${shaderId}'`);
        }

        const vertexShader = this._compileShaderObject(this._gl.VERTEX_SHADER, vertexSource);
        const fragmentShader = this._compileShaderObject(this._gl.FRAGMENT_SHADER, fragmentSource);

        try {
            for (const semantic of Object.keys(attributeNames) as SceneMeshSemantic[]) {
                this._gl.bindAttribLocation(
                    program,
                    SCENE_ATTRIBUTE_LOCATIONS[semantic],
                    attributeNames[semantic]
                );
            }

            this._gl.attachShader(program, vertexShader);
            this._gl.attachShader(program, fragmentShader);
            this._gl.linkProgram(program);

            if (!this._gl.getProgramParameter(program, this._gl.LINK_STATUS)) {
                const info = this._gl.getProgramInfoLog(program) ?? 'Unknown link failure';
                throw new SceneShaderError(`Failed to link shader '${shaderId}': ${info}`);
            }

            const reflection = this._extractReflection(
                program,
                vertexSource,
                fragmentSource,
                uniformNames
            );

            return { program, ...reflection, vertexSource, fragmentSource, attributeKey, refcount: 0 };
        } finally {
            this._gl.deleteShader(vertexShader);
            this._gl.deleteShader(fragmentShader);
        }
    }

    private _submitProgram(
        shaderId: string,
        vertexSource: string,
        fragmentSource: string,
        attributeNames: Record<SceneMeshSemantic, string>
    ): WebGLProgram {
        const program = this._gl.createProgram();
        if (!program) {
            throw new SceneShaderError(`Failed to create shader program '${shaderId}'`);
        }

        const vertexShader = this._gl.createShader(this._gl.VERTEX_SHADER);
        const fragmentShader = this._gl.createShader(this._gl.FRAGMENT_SHADER);

        if (!vertexShader || !fragmentShader) {
            this._gl.deleteShader(vertexShader);
            this._gl.deleteShader(fragmentShader);
            this._gl.deleteProgram(program);
            throw new SceneShaderError(`Failed to create shader objects for '${shaderId}'`);
        }

        this._gl.shaderSource(vertexShader, vertexSource);
        this._gl.compileShader(vertexShader);
        if (!this._gl.getShaderParameter(vertexShader, this._gl.COMPILE_STATUS)) {
            const info = this._gl.getShaderInfoLog(vertexShader) ?? 'vertex compile failed';
            this._gl.deleteShader(vertexShader);
            this._gl.deleteShader(fragmentShader);
            this._gl.deleteProgram(program);
            throw new SceneShaderError(`Vertex shader compile failed for '${shaderId}': ${info}`);
        }

        this._gl.shaderSource(fragmentShader, fragmentSource);
        this._gl.compileShader(fragmentShader);
        if (!this._gl.getShaderParameter(fragmentShader, this._gl.COMPILE_STATUS)) {
            const info = this._gl.getShaderInfoLog(fragmentShader) ?? 'fragment compile failed';
            this._gl.deleteShader(vertexShader);
            this._gl.deleteShader(fragmentShader);
            this._gl.deleteProgram(program);
            throw new SceneShaderError(`Fragment shader compile failed for '${shaderId}': ${info}`);
        }

        for (const semantic of Object.keys(attributeNames) as SceneMeshSemantic[]) {
            this._gl.bindAttribLocation(
                program,
                SCENE_ATTRIBUTE_LOCATIONS[semantic],
                attributeNames[semantic]
            );
        }

        this._gl.attachShader(program, vertexShader);
        this._gl.attachShader(program, fragmentShader);
        this._gl.linkProgram(program);
        this._gl.deleteShader(vertexShader);
        this._gl.deleteShader(fragmentShader);

        return program;
    }

    private _extractReflection(
        program: WebGLProgram,
        vertexSource: string,
        fragmentSource: string,
        uniformNames: readonly string[]
    ): {
        uniformLocations: Map<string, WebGLUniformLocation>;
        uniformTypes: Map<string, number>;
        uniformNames: string[];
    } {
        const locations = new Map<string, WebGLUniformLocation>();
        const types = new Map<string, number>();

        for (let index = 0; index < uniformNames.length; index += 1) {
            const uniformName = uniformNames[index]!;
            const location = this._gl.getUniformLocation(program, uniformName);
            if (location !== null) {
                locations.set(uniformName, location);
            }
        }

        if (typeof this._gl.getActiveUniform === 'function') {
            const activeUniformCount = this._gl.getProgramParameter(
                program,
                this._gl.ACTIVE_UNIFORMS
            );

            for (let index = 0; index < activeUniformCount; index += 1) {
                const info = this._gl.getActiveUniform(program, index);
                if (!info) {
                    continue;
                }

                const normalizedName = normalizeUniformName(info.name);
                types.set(info.name, info.type);
                types.set(normalizedName, info.type);
            }
        }

        for (const [uniformName, uniformType] of extractUniformTypeHints(
            this._gl,
            vertexSource,
            fragmentSource
        )) {
            if (!types.has(uniformName)) {
                types.set(uniformName, uniformType);
            }
        }

        return {
            uniformLocations: locations,
            uniformTypes: types,
            uniformNames: [...uniformNames],
        };
    }

    private _buildResource(
        definition: SceneShaderDefinition,
        entry: CachedProgramEntry,
        attributeNames: Record<SceneMeshSemantic, string>
    ): SceneShaderResource {
        return {
            id: definition.id,
            program: entry.program,
            uniformLocations: entry.uniformLocations,
            uniformTypes: entry.uniformTypes,
            uniformNames: entry.uniformNames,
            attributeNames,
            depthTest: resolveDepthTest(definition),
            cull: resolveCull(definition),
            blend: resolveBlend(definition),
        };
    }

    private _buildVariantResource(
        definition: SceneShaderDefinition,
        enabledKeywords: readonly string[],
        entry: CachedProgramEntry,
        attributeNames: Record<SceneMeshSemantic, string>
    ): SceneShaderResource {
        return {
            id: generateSceneShaderVariantKey(definition.id, enabledKeywords),
            program: entry.program,
            uniformLocations: entry.uniformLocations,
            uniformTypes: entry.uniformTypes,
            uniformNames: entry.uniformNames,
            attributeNames,
            depthTest: resolveDepthTest(definition),
            cull: resolveCull(definition),
            blend: resolveBlend(definition),
        };
    }

    private _cleanupPending(
        pending: ReadonlyArray<{ readonly program: WebGLProgram }>
    ): void {
        for (const entry of pending) {
            this._gl.deleteProgram(entry.program);
        }
    }
}
