import { cloneMeshDefinition } from './serialization';
import { resolveSceneMeshBounds } from './scene-mesh-bounds';
import type {
    SceneMeshDefinition,
    SceneMeshHandle,
    SceneMeshSemantic,
    SceneMeshTopology,
} from './types';

export interface SceneMeshResource {
    readonly id: string;
    readonly vertexArray: WebGLVertexArrayObject;
    readonly vertexBuffer: WebGLBuffer;
    readonly indexBuffer: WebGLBuffer | null;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly indexType: number | null;
    readonly topology: SceneMeshTopology;
    readonly mode: number;
    readonly attributes: ReadonlySet<SceneMeshSemantic>;
}

export interface SceneMeshRegistrationResult {
    readonly handle: SceneMeshHandle;
    readonly previous: SceneMeshResource | null;
}

const toHandle = (resource: SceneMeshResource): SceneMeshHandle => ({
    id: resource.id,
    vertexCount: resource.vertexCount,
    indexCount: resource.indexCount,
    topology: resource.topology,
});

export const cloneSceneMeshDefinition = (definition: SceneMeshDefinition): SceneMeshDefinition =>
    cloneMeshDefinition(definition);

export class SceneMeshRegistry {
    private readonly _resources = new Map<string, SceneMeshResource>();
    private readonly _definitions = new Map<string, SceneMeshDefinition>();
    private _revision = 0;

    get size(): number {
        return this._resources.size;
    }

    /**
     * Monotonic revision for render-cache invalidation. Bumped on register and
     * clear so caches keyed by mesh bounds/resources can decide to rebuild.
     */
    get revision(): number {
        return this._revision;
    }

    private _touchRevision(): void {
        this._revision = (this._revision + 1) >>> 0;
    }

    register(
        definition: SceneMeshDefinition,
        resource: SceneMeshResource
    ): SceneMeshRegistrationResult {
        const previous = this._resources.get(resource.id) ?? null;
        const bounds = resolveSceneMeshBounds(definition);
        const normalizedDefinition =
            bounds && !definition.bounds ? { ...definition, bounds } : definition;
        this._resources.set(resource.id, resource);
        this._definitions.set(resource.id, cloneSceneMeshDefinition(normalizedDefinition));
        this._touchRevision();

        return {
            handle: toHandle(resource),
            previous,
        };
    }

    get(id: string): SceneMeshResource | undefined {
        return this._resources.get(id);
    }

    getHandle(id: string): SceneMeshHandle | null {
        const resource = this._resources.get(id);
        return resource ? toHandle(resource) : null;
    }

    getDefinition(id: string): SceneMeshDefinition | undefined {
        return this._definitions.get(id);
    }

    getDefinitions(): readonly SceneMeshDefinition[] {
        return [...this._definitions.values()].map((definition) =>
            cloneSceneMeshDefinition(definition)
        );
    }

    clear(): readonly SceneMeshResource[] {
        const resources = [...this._resources.values()];
        this._resources.clear();
        this._definitions.clear();
        this._touchRevision();
        return resources;
    }
}
