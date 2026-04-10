import type { Actor, ComponentRegistry } from '@axrone/ecs';
import type {
    AssetDatabase,
    AssetSelector,
    GltfAssetSchemaLike,
} from '@axrone/asset-gltf';
import type { Scene, SceneSnapshotLoadOptions } from '@axrone/scene-3d';
import {
    createGltfSceneSnapshot,
    type GltfSceneSnapshotOptions,
    type GltfSceneSnapshotResult,
} from './scene-snapshot-adapter';

export interface LoadGltfSceneIntoSceneOptions
    extends GltfSceneSnapshotOptions,
        Pick<SceneSnapshotLoadOptions, 'clearExisting' | 'componentArgsResolver' | 'namePrefix'> {}

export interface LoadGltfSceneIntoSceneResult extends GltfSceneSnapshotResult {
    readonly actors: readonly Actor[];
}

export const loadGltfSceneIntoScene = async <R extends ComponentRegistry = Record<string, never>>(
    scene: Scene<R>,
    database: AssetDatabase<GltfAssetSchemaLike>,
    selector: AssetSelector<GltfAssetSchemaLike, 'gltf.document'>,
    options: LoadGltfSceneIntoSceneOptions = {}
): Promise<LoadGltfSceneIntoSceneResult> => {
    const built = createGltfSceneSnapshot(database, selector, options);
    const actors = await scene.loadScene(built.snapshot, {
        clearExisting: options.clearExisting,
        componentArgsResolver: options.componentArgsResolver,
        namePrefix: options.namePrefix,
    });

    return {
        ...built,
        actors,
    };
};