import type { ITextureSampler } from '../../core/src/renderer/webgl2/texture/interfaces';
import type { SceneSamplerDefinition, SceneSamplerHandle } from './types';

export interface SceneSamplerResource {
    readonly id: string;
    readonly sampler: ITextureSampler;
}

export interface SceneSamplerRegistrationResult {
    readonly handle: SceneSamplerHandle;
    readonly previous: SceneSamplerResource | null;
}

const toHandle = (resource: SceneSamplerResource): SceneSamplerHandle => ({
    id: resource.id,
});

export const cloneSceneSamplerDefinition = (
    definition: SceneSamplerDefinition
): SceneSamplerDefinition => ({
    ...definition,
});

export class SceneSamplerRegistry {
    private readonly _resources = new Map<string, SceneSamplerResource>();
    private readonly _definitions = new Map<string, SceneSamplerDefinition>();

    get size(): number {
        return this._resources.size;
    }

    register(
        definition: SceneSamplerDefinition,
        resource: SceneSamplerResource
    ): SceneSamplerRegistrationResult {
        const previous = this._resources.get(resource.id) ?? null;
        this._resources.set(resource.id, resource);
        this._definitions.set(resource.id, cloneSceneSamplerDefinition(definition));

        return {
            handle: toHandle(resource),
            previous,
        };
    }

    get(id: string): SceneSamplerResource | undefined {
        return this._resources.get(id);
    }

    getHandle(id: string): SceneSamplerHandle | null {
        const resource = this._resources.get(id);
        return resource ? toHandle(resource) : null;
    }

    resolve(id: string | null, fallback: ITextureSampler): ITextureSampler {
        if (!id) {
            return fallback;
        }

        return this._resources.get(id)?.sampler ?? fallback;
    }

    getDefinitions(): readonly SceneSamplerDefinition[] {
        return [...this._definitions.values()].map((definition) =>
            cloneSceneSamplerDefinition(definition)
        );
    }

    clear(): readonly SceneSamplerResource[] {
        const resources = [...this._resources.values()];
        this._resources.clear();
        this._definitions.clear();
        return resources;
    }
}
