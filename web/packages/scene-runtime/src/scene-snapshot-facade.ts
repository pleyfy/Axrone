import { Entity } from '@axrone/ecs-runtime';
import type { ComponentRegistry } from '@axrone/ecs-runtime';
import type {
    SceneOptions,
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
} from './types';
import { SceneRuntimeFacade } from './scene-runtime-facade';

export class SceneSnapshotFacade<
    R extends ComponentRegistry = Record<string, never>,
> extends SceneRuntimeFacade<R> {
    constructor(options: SceneOptions<R> = {}) {
        super(options);
    }

    createPrefab(
        id: string,
        entities: readonly EntityId[] = this.world.getAllEntities()
    ): ScenePrefabDefinition {
        this.assertNotDisposed();
        return this._kernel.snapshots.createPrefab(id, entities);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly EntityId[] {
        this.assertNotDisposed();
        return this._kernel.snapshots.instantiatePrefab(prefab, options);
    }

    serializeScene(): SceneSnapshot {
        this.assertNotDisposed();
        return this._kernel.snapshots.serializeScene();
    }

    async loadScene(
        snapshot: SceneSnapshot,
        options: SceneSnapshotLoadOptions = {}
    ): Promise<readonly EntityId[]> {
        this.assertNotDisposed();
        return await this._kernel.snapshots.loadScene(snapshot, options);
    }
}