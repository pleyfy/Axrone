import {
    Transform,
    type EntityId,
    type EntityConfig,
    type ComponentConstructor,
} from '@axrone/ecs-runtime';
import type { World } from '@axrone/ecs-runtime';
import type { ComponentRegistry } from '@axrone/ecs-runtime';
import { type SceneRegistry } from '@axrone/scene-runtime';
import { Camera, type CameraConfig } from '@axrone/scene-runtime/scene-camera';
import { requireRegisteredComponent } from '@axrone/scene-runtime/scene-capability-guard';
import { MeshRenderer, type MeshRendererConfig } from '@axrone/scene-runtime/scene-mesh-renderer';

export interface SceneProfilerProbe {
    resolveHotRefsMs?: number;
}

interface SceneEntityBatchComponentEntry {
    readonly type: ComponentConstructor;
    readonly args?: readonly unknown[];
}

interface SceneEntityBatchEntry {
    readonly entityConfig?: EntityConfig;
    readonly components?: readonly SceneEntityBatchComponentEntry[];
}

interface Scene3DActorRuntimeHost<R extends ComponentRegistry = Record<string, never>> {
    createEntity(config?: EntityConfig): EntityId<World<SceneRegistry<R>>>;
    createEntitiesWithComponents(
        configs: readonly SceneEntityBatchEntry[],
        profiling?: SceneProfilerProbe
    ): readonly Entity<World<SceneRegistry<R>>>[];
    runInStructureBatch<T>(callback: () => T): T;
    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean;
}

export interface Scene3DActorRuntimeOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly entities: Scene3DActorRuntimeHost<R>;
}

export interface SceneRenderableEntityCreateOptions {
    readonly entityConfig?: EntityConfig;
    readonly rendererConfig?: MeshRendererConfig;
}

export interface SceneRenderableEntityInstance<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly entity: EntityId<World<SceneRegistry<R>>>;
    readonly transform: Transform;
    readonly renderer: MeshRenderer;
}

export class Scene3DActorRuntime<R extends ComponentRegistry = Record<string, never>> {
    private readonly _entities: Scene3DActorRuntimeHost<R>;

    constructor(options: Scene3DActorRuntimeOptions<R>) {
        this._entities = options.entities;
    }

    createCameraEntity(
        entityConfig: EntityConfig = {},
        cameraConfig: CameraConfig = {}
    ): EntityId<World<SceneRegistry<R>>> {
        requireRegisteredComponent(
            this._entities,
            Camera,
            'camera entity creation requires the 3D scene capability/profile'
        );
        const entity = this._entities.createEntity(entityConfig);
        entity.addComponent(Camera, cameraConfig);
        return entity;
    }

    createRenderableEntity(
        entityConfig: EntityConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ): EntityId<World<SceneRegistry<R>>> {
        requireRegisteredComponent(
            this._entities,
            MeshRenderer,
            'renderable entity creation requires the 3D scene capability/profile'
        );
        const entity = this._entities.createEntity(entityConfig);
        entity.addComponent(MeshRenderer, rendererConfig);
        return entity;
    }

    createRenderableEntities(
        configs: readonly SceneRenderableEntityCreateOptions[],
        profiling?: SceneProfilerProbe
    ): readonly SceneRenderableEntityInstance<R>[] {
        requireRegisteredComponent(
            this._entities,
            MeshRenderer,
            'renderable entity creation requires the 3D scene capability/profile'
        );

        return this._entities.runInStructureBatch(() => {
            const entities = this._entities.createEntitiesWithComponents(
                configs.map((config) => ({
                    entityConfig: config.entityConfig ?? {},
                    components: [
                        {
                            type: MeshRenderer,
                            args: [config.rendererConfig ?? {}],
                        },
                    ],
                })),
                profiling
            );

            const startedAt = profiling ? performance.now() : 0;
            const created = entities.map((entity) => {
                const renderer = entity.requireComponent(MeshRenderer);
                const transform = entity.requireComponent(Transform);

                return { entity, transform, renderer };
            });

            if (profiling) {
                profiling.resolveHotRefsMs =
                    (profiling.resolveHotRefsMs ?? 0) + (performance.now() - startedAt);
            }

            return created;
        });
    }
}