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
        return this.getOrderedResources()
            .map((renderPass) => toHandle(renderPass));
    }

    getResources(): readonly SceneRenderPassResource[] {
        return [...this._resources.values()];
    }

    getOrderedResources(): readonly SceneRenderPassResource[] {
        return [...this._resources.values()].sort(compareRenderPassResources);
    }

    getEnabledResources(): readonly SceneRenderPassResource[] {
        return this.getOrderedResources().filter(
            (renderPass: SceneRenderPassResource) => renderPass.enabled
        );
    }

    getDefinitions(): readonly SceneRenderPassDefinition[] {
        return [...this._definitions.values()]
            .sort(compareRenderPassDefinitions)
            .map((definition) => cloneSceneRenderPassDefinition(definition));
    }

    clear(): void {
        this._resources.clear();
        this._definitions.clear();
    }
}
