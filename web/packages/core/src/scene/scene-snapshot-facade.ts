import { Actor } from '../component-system/core/actor';
import type { ComponentRegistry } from '../component-system/types/core';
import { SceneRuntimeFacade } from './scene-runtime-facade';
import type {
    SceneOptions,
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
} from './types';

export class SceneSnapshotFacade<
    R extends ComponentRegistry = Record<string, never>,
> extends SceneRuntimeFacade<R> {
    constructor(options: SceneOptions<R> = {}) {
        super(options);
    }

    createPrefab(
        id: string,
        actors: readonly Actor[] = this.world.getAllActors()
    ): ScenePrefabDefinition {
        this.assertNotDisposed();
        return this._kernel.snapshots.createPrefab(id, actors);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
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
    ): Promise<readonly Actor[]> {
        this.assertNotDisposed();
        return await this._kernel.snapshots.loadScene(snapshot, options);
    }
}
