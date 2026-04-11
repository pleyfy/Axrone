import { Vec4 } from '@axrone/numeric';
import type {
    SceneClearFlag,
    SceneRenderPassDefinition,
    SceneRenderPassHandle,
} from './types';

export interface SceneRenderPassResource {
    readonly id: string;
    readonly order: number;
    readonly rendererPassId: string;
    readonly enabled: boolean;
    readonly clearFlags: readonly SceneClearFlag[];
    readonly clearColor: Vec4 | null;
    readonly clearDepth: number | null;
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
}

export interface SceneRenderPassRegistryOptions {
    readonly defaultPassId: string;
    readonly defaultClearColor: Vec4;
}

const cloneVec4 = (value: Vec4 | readonly [number, number, number, number]): Vec4 =>
    value instanceof Vec4
        ? new Vec4(value.x, value.y, value.z, value.w)
        : new Vec4(value[0], value[1], value[2], value[3]);

const toHandle = (renderPass: SceneRenderPassResource): SceneRenderPassHandle => ({
    id: renderPass.id,
    order: renderPass.order,
    rendererPassId: renderPass.rendererPassId,
    enabled: renderPass.enabled,
});

const compareRenderPassResources = (
    left: SceneRenderPassResource,
    right: SceneRenderPassResource
): number => left.order - right.order || left.id.localeCompare(right.id);

const compareRenderPassDefinitions = (
    left: SceneRenderPassDefinition,
    right: SceneRenderPassDefinition
): number => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id);

export const cloneSceneRenderPassDefinition = (
    definition: SceneRenderPassDefinition
): SceneRenderPassDefinition => ({
    ...definition,
    clearFlags: definition.clearFlags ? [...definition.clearFlags] : undefined,
    clearColor:
        definition.clearColor === null
            ? null
            : definition.clearColor
              ? cloneVec4(definition.clearColor)
              : undefined,
});

export class SceneRenderPassRegistry {
    private readonly _resources = new Map<string, SceneRenderPassResource>();
    private readonly _definitions = new Map<string, SceneRenderPassDefinition>();
    private readonly _defaultPassId: string;
    private readonly _defaultClearColor: Vec4;
    private _orderedResourcesCache: readonly SceneRenderPassResource[] | null = null;
    private _enabledResourcesCache: readonly SceneRenderPassResource[] | null = null;
    private _handlesCache: readonly SceneRenderPassHandle[] | null = null;
    private _definitionsCache: readonly SceneRenderPassDefinition[] | null = null;

    constructor(options: SceneRenderPassRegistryOptions) {
        this._defaultPassId = options.defaultPassId;
        this._defaultClearColor = cloneVec4(options.defaultClearColor);
    }

    get size(): number {
        return this._resources.size;
    }

    register(definition: SceneRenderPassDefinition): SceneRenderPassHandle {
        const resource: SceneRenderPassResource = {
            id: definition.id,
            order: definition.order ?? this._resources.size,
            rendererPassId: definition.rendererPassId ?? definition.id,
            enabled: definition.enabled ?? true,
            clearFlags:
                definition.clearFlags ??
                (this._resources.size === 0 || definition.id === this._defaultPassId
                    ? ['color', 'depth']
                    : []),
            clearColor:
                definition.clearColor === null
                    ? null
                    : definition.clearColor
                      ? cloneVec4(definition.clearColor)
                      : definition.id === this._defaultPassId
                        ? cloneVec4(this._defaultClearColor)
                        : null,
            clearDepth: definition.clearDepth ?? null,
            depthTest: definition.depthTest,
            cull: definition.cull,
            blend: definition.blend,
        };

        this._resources.set(definition.id, resource);
        this._definitions.set(definition.id, cloneSceneRenderPassDefinition(definition));
        this._invalidateCaches();
        return toHandle(resource);
    }

    get(id: string): SceneRenderPassResource | undefined {
        return this._resources.get(id);
    }

    getHandle(id: string): SceneRenderPassHandle | null {
        const renderPass = this._resources.get(id);
        return renderPass ? toHandle(renderPass) : null;
    }

    getHandles(): readonly SceneRenderPassHandle[] {
        if (!this._handlesCache) {
            this._handlesCache = Object.freeze(
                this.getOrderedResources().map((renderPass) => Object.freeze(toHandle(renderPass)))
            );
        }

        return this._handlesCache;
    }

    getResources(): readonly SceneRenderPassResource[] {
        return [...this._resources.values()];
    }

    getOrderedResources(): readonly SceneRenderPassResource[] {
        if (!this._orderedResourcesCache) {
            this._orderedResourcesCache = Object.freeze(
                [...this._resources.values()].sort(compareRenderPassResources)
            );
        }

        return this._orderedResourcesCache;
    }

    getEnabledResources(): readonly SceneRenderPassResource[] {
        if (!this._enabledResourcesCache) {
            this._enabledResourcesCache = Object.freeze(
                this.getOrderedResources().filter(
                    (renderPass: SceneRenderPassResource) => renderPass.enabled
                )
            );
        }

        return this._enabledResourcesCache;
    }

    getDefinitions(): readonly SceneRenderPassDefinition[] {
        if (!this._definitionsCache) {
            this._definitionsCache = Object.freeze(
                [...this._definitions.values()]
                    .sort(compareRenderPassDefinitions)
                    .map((definition) =>
                        Object.freeze(cloneSceneRenderPassDefinition(definition))
                    )
            );
        }

        return this._definitionsCache;
    }

    clear(): void {
        this._resources.clear();
        this._definitions.clear();
        this._invalidateCaches();
    }

    private _invalidateCaches(): void {
        this._orderedResourcesCache = null;
        this._enabledResourcesCache = null;
        this._handlesCache = null;
        this._definitionsCache = null;
    }
}
