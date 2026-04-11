import type {
    SceneMeshSemantic,
    SceneShaderDefinition,
    SceneShaderHandle,
} from './types';

export interface SceneShaderResource {
    readonly id: string;
    readonly program: WebGLProgram;
    readonly uniformLocations: ReadonlyMap<string, WebGLUniformLocation>;
    readonly uniformTypes: ReadonlyMap<string, number>;
    readonly uniformNames: readonly string[];
    readonly attributeNames: Readonly<Record<SceneMeshSemantic, string>>;
    readonly depthTest: boolean;
    readonly cull: boolean;
    readonly blend: boolean;
}

export interface SceneShaderRegistrationResult {
    readonly handle: SceneShaderHandle;
    readonly previous: SceneShaderResource | null;
}

const toHandle = (resource: SceneShaderResource): SceneShaderHandle => ({
    id: resource.id,
    uniformNames: resource.uniformNames,
});

export const cloneSceneShaderDefinition = (
    definition: SceneShaderDefinition
): SceneShaderDefinition => ({
    ...definition,
    uniforms: definition.uniforms ? [...definition.uniforms] : undefined,
    attributes: definition.attributes ? { ...definition.attributes } : undefined,
});

export class SceneShaderRegistry {
    private readonly _resources = new Map<string, SceneShaderResource>();
    private readonly _definitions = new Map<string, SceneShaderDefinition>();

    get size(): number {
        return this._resources.size;
    }

    register(
        definition: SceneShaderDefinition,
        resource: SceneShaderResource
    ): SceneShaderRegistrationResult {
        const previous = this._resources.get(resource.id) ?? null;
        this._resources.set(resource.id, resource);
        this._definitions.set(resource.id, cloneSceneShaderDefinition(definition));

        return {
            handle: toHandle(resource),
            previous,
        };
    }

    get(id: string): SceneShaderResource | undefined {
        return this._resources.get(id);
    }

    getHandle(id: string): SceneShaderHandle | null {
        const resource = this._resources.get(id);
        return resource ? toHandle(resource) : null;
    }

    getResources(): readonly SceneShaderResource[] {
        return [...this._resources.values()];
    }

    getDefinitions(): readonly SceneShaderDefinition[] {
        return [...this._definitions.values()].map((definition) =>
            cloneSceneShaderDefinition(definition)
        );
    }

    clear(): readonly SceneShaderResource[] {
        const resources = [...this._resources.values()];
        this._resources.clear();
        this._definitions.clear();
        return resources;
    }
}
