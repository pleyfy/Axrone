import type { MeshRenderer } from './components/mesh-renderer';
import type { SceneMeshResource } from './mesh-registry';
import type { SceneMeshDefinition } from './types';

interface MorphMeshResourceCache {
    readonly rendererId: string;
    readonly baseMeshId: string;
    readonly resource: SceneMeshResource;
    readonly vertices: Uint8Array;
    readonly sourceVertices: Uint8Array;
    lastWeightVersion: number;
}

export interface SceneMorphMeshRegistry {
    get(id: string): SceneMeshResource | undefined;
    getDefinition(id: string): SceneMeshDefinition | undefined;
}

export interface SceneMorphMeshRuntimeOptions {
    readonly gl: WebGL2RenderingContext;
    readonly createMeshResource: (definition: SceneMeshDefinition) => SceneMeshResource;
    readonly disposeMesh: (mesh: SceneMeshResource) => void;
}

const MORPH_WEIGHT_EPSILON = 1e-6;

const toBufferBytes = (value: BufferSource): Uint8Array =>
    ArrayBuffer.isView(value)
        ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        : new Uint8Array(value);

const hasActiveMorphWeights = (
    weights: Float32Array | null,
    targetCount: number
): boolean => {
    if (!weights || targetCount <= 0) {
        return false;
    }

    const count = Math.min(weights.length, targetCount);
    for (let index = 0; index < count; index += 1) {
        if (Math.abs(weights[index] ?? 0) > MORPH_WEIGHT_EPSILON) {
            return true;
        }
    }

    return false;
};

const applyMorphTargetsToVertexBytes = (
    definition: SceneMeshDefinition,
    vertices: Uint8Array,
    weights: Float32Array
): void => {
    const morphTargets = definition.morphTargets;
    const baseAttributeMap = new Map(
        definition.attributes.map((attribute) => [attribute.semantic, attribute] as const)
    );
    if (!morphTargets || morphTargets.length === 0 || definition.attributes.length === 0) {
        return;
    }

    const view = new DataView(vertices.buffer, vertices.byteOffset, vertices.byteLength);
    const vertexStride = definition.attributes[0]!.stride;
    const vertexCount = definition.vertexCount ?? Math.floor(vertices.byteLength / vertexStride);
    const targetCount = Math.min(weights.length, morphTargets.length);

    for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
        const weight = weights[targetIndex] ?? 0;
        if (Math.abs(weight) <= MORPH_WEIGHT_EPSILON) {
            continue;
        }

        const target = morphTargets[targetIndex]!;
        for (const attribute of target.attributes) {
            const baseAttribute = baseAttributeMap.get(attribute.semantic);
            if (!baseAttribute) {
                continue;
            }

            for (let vertex = 0; vertex < vertexCount; vertex += 1) {
                const sourceOffset = vertex * attribute.componentCount;
                const destinationBaseOffset = vertex * baseAttribute.stride + baseAttribute.offset;

                for (let component = 0; component < attribute.componentCount; component += 1) {
                    const componentOffset =
                        destinationBaseOffset + component * Float32Array.BYTES_PER_ELEMENT;
                    const currentValue = view.getFloat32(componentOffset, true);
                    const delta = attribute.values[sourceOffset + component] ?? 0;
                    view.setFloat32(componentOffset, currentValue + delta * weight, true);
                }
            }
        }
    }
};

export class SceneMorphMeshRuntime {
    private readonly _caches = new Map<string, MorphMeshResourceCache>();

    constructor(private readonly _options: SceneMorphMeshRuntimeOptions) {}

    resolve(
        renderer: Pick<
            MeshRenderer,
            'id' | 'meshId' | 'morphWeightVersion' | 'getMorphWeightArray'
        >,
        meshes: SceneMorphMeshRegistry
    ): SceneMeshResource | null {
        const meshId = renderer.meshId;
        if (!meshId) {
            return null;
        }

        const mesh = meshes.get(meshId);
        const definition = meshes.getDefinition(meshId);
        if (!mesh || !definition?.morphTargets?.length) {
            return mesh ?? null;
        }

        const weights = renderer.getMorphWeightArray();
        if (!hasActiveMorphWeights(weights, definition.morphTargets.length)) {
            return mesh;
        }

        return this._getOrCreateMorphMeshResource(renderer, mesh, definition, weights!);
    }

    releaseBaseMesh(meshId: string): void {
        for (const [cacheKey, cache] of this._caches.entries()) {
            if (cache.baseMeshId !== meshId) {
                continue;
            }

            this._options.disposeMesh(cache.resource);
            this._caches.delete(cacheKey);
        }
    }

    prune(activeRendererIds: ReadonlySet<string>): void {
        for (const [cacheKey, cache] of this._caches.entries()) {
            if (activeRendererIds.has(cacheKey)) {
                continue;
            }

            this._options.disposeMesh(cache.resource);
            this._caches.delete(cacheKey);
        }
    }

    clear(): void {
        for (const cache of this._caches.values()) {
            this._options.disposeMesh(cache.resource);
        }

        this._caches.clear();
    }

    private _getOrCreateMorphMeshResource(
        renderer: Pick<
            MeshRenderer,
            'id' | 'morphWeightVersion' | 'getMorphWeightArray'
        >,
        mesh: SceneMeshResource,
        definition: SceneMeshDefinition,
        weights: Float32Array
    ): SceneMeshResource {
        const cacheKey = renderer.id;
        const sourceVertices = toBufferBytes(definition.vertices);
        let cache = this._caches.get(cacheKey);

        if (
            !cache ||
            cache.baseMeshId !== mesh.id ||
            cache.sourceVertices.byteLength !== sourceVertices.byteLength
        ) {
            if (cache) {
                this._options.disposeMesh(cache.resource);
            }

            const vertices = new Uint8Array(sourceVertices.byteLength);
            vertices.set(sourceVertices);
            const resource = this._options.createMeshResource({
                id: `${mesh.id}#morph#${renderer.id}`,
                vertices,
                attributes: definition.attributes.map((attribute) => ({ ...attribute })),
                ...(definition.indices ? { indices: definition.indices } : {}),
                ...(definition.vertexCount !== undefined
                    ? { vertexCount: definition.vertexCount }
                    : {}),
                ...(definition.topology ? { topology: definition.topology } : {}),
                usage: this._options.gl.DYNAMIC_DRAW,
            });

            cache = {
                rendererId: cacheKey,
                baseMeshId: mesh.id,
                resource,
                vertices,
                sourceVertices,
                lastWeightVersion: -1,
            };
            this._caches.set(cacheKey, cache);
        }

        if (cache.lastWeightVersion !== renderer.morphWeightVersion) {
            cache.vertices.set(cache.sourceVertices);
            applyMorphTargetsToVertexBytes(definition, cache.vertices, weights);
            this._options.gl.bindBuffer(this._options.gl.ARRAY_BUFFER, cache.resource.vertexBuffer);
            this._options.gl.bufferData(
                this._options.gl.ARRAY_BUFFER,
                cache.vertices,
                this._options.gl.DYNAMIC_DRAW
            );
            this._options.gl.bindBuffer(this._options.gl.ARRAY_BUFFER, null);
            cache.lastWeightVersion = renderer.morphWeightVersion;
        }

        return cache.resource;
    }
}
