import type { ITexture } from '../../core/src/renderer/webgl2/texture/interfaces';
import type { SceneTextureDefinition, SceneTextureHandle } from './types';

export interface SceneTextureResource {
    readonly id: string;
    readonly texture: ITexture;
    readonly width: number;
    readonly height: number;
    readonly samplerId: string | null;
}

export interface SceneTextureRegistrationResult {
    readonly handle: SceneTextureHandle;
    readonly previous: SceneTextureResource | null;
}

const toHandle = (resource: SceneTextureResource): SceneTextureHandle => ({
    id: resource.id,
    width: resource.width,
    height: resource.height,
    samplerId: resource.samplerId,
});

export const cloneSceneTextureDefinition = (
    definition: SceneTextureDefinition
): SceneTextureDefinition => {
    const source = definition.source;

    if (source.kind === 'color') {
        return {
            ...definition,
            source: {
                ...source,
                color: [...source.color] as readonly [number, number, number, number],
            },
        };
    }

    if (source.kind === 'checker') {
        return {
            ...definition,
            source: {
                ...source,
                colorA: source.colorA
                    ? ([...source.colorA] as readonly [number, number, number, number])
                    : undefined,
                colorB: source.colorB
                    ? ([...source.colorB] as readonly [number, number, number, number])
                    : undefined,
            },
        };
    }

    if (source.kind === 'data') {
        return {
            ...definition,
            source: {
                ...source,
                data: [...source.data],
            },
        };
    }

    if (source.kind === 'bytes') {
        return {
            ...definition,
            source: {
                ...source,
                bytes:
                    source.bytes instanceof Uint8Array
                        ? new Uint8Array(source.bytes)
                        : [...source.bytes],
            },
        };
    }

    if (source.kind === 'compressed') {
        return {
            ...definition,
            source: {
                ...source,
                bytes:
                    source.bytes instanceof Uint8Array
                        ? new Uint8Array(source.bytes)
                        : [...source.bytes],
                levels: source.levels.map((level) => ({ ...level })),
            },
        };
    }

    return {
        ...definition,
        source: { ...source },
    };
};

export class SceneTextureRegistry {
    private readonly _resources = new Map<string, SceneTextureResource>();
    private readonly _definitions = new Map<string, SceneTextureDefinition>();

    get size(): number {
        return this._resources.size;
    }

    register(
        definition: SceneTextureDefinition,
        resource: SceneTextureResource
    ): SceneTextureRegistrationResult {
        const previous = this._resources.get(resource.id) ?? null;
        this._resources.set(resource.id, resource);
        this._definitions.set(resource.id, cloneSceneTextureDefinition(definition));

        return {
            handle: toHandle(resource),
            previous,
        };
    }

    get(id: string): SceneTextureResource | undefined {
        return this._resources.get(id);
    }

    getHandle(id: string): SceneTextureHandle | null {
        const resource = this._resources.get(id);
        return resource ? toHandle(resource) : null;
    }

    getDefinitions(): readonly SceneTextureDefinition[] {
        return [...this._definitions.values()].map((definition) =>
            cloneSceneTextureDefinition(definition)
        );
    }

    clear(): readonly SceneTextureResource[] {
        const resources = [...this._resources.values()];
        this._resources.clear();
        this._definitions.clear();
        return resources;
    }
}
