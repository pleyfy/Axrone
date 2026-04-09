import { Vec4 } from '@axrone/numeric';
import type { Actor } from '../component-system/core/actor';
import { SceneLifecycleError } from './errors';
import type {
    ScenePrefabDefinition,
    SceneRenderPassDefinition,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
} from './types';

export interface SceneSnapshotLoaderOptions {
    readonly defaultRenderPassId: string;
    readonly defaultClearColor: Vec4;
    readonly clearExisting: () => void;
    readonly clearRenderPasses: () => void;
    readonly registerShader: (shader: SceneSnapshot['shaders'][number]) => void;
    readonly registerMesh: (mesh: SceneSnapshot['meshes'][number]) => void;
    readonly registerSampler: (sampler: SceneSnapshot['samplers'][number]) => void;
    readonly registerTexture: (texture: SceneSnapshot['textures'][number]) => Promise<void>;
    readonly registerRenderPass: (renderPass: SceneRenderPassDefinition) => void;
    readonly createMaterial: (material: SceneSnapshot['materials'][number]) => void;
    readonly instantiatePrefab: (
        prefab: ScenePrefabDefinition,
        options: SceneSnapshotLoadOptions
    ) => readonly Actor[];
}

export class SceneSnapshotLoader {
    constructor(private readonly _options: SceneSnapshotLoaderOptions) {}

    async load(
        snapshot: SceneSnapshot,
        options: SceneSnapshotLoadOptions = {}
    ): Promise<readonly Actor[]> {
        if (snapshot.version !== 1) {
            throw new SceneLifecycleError(
                `Unsupported scene snapshot version '${snapshot.version}'`
            );
        }

        if (options.clearExisting !== false) {
            this._options.clearExisting();
        }

        for (let index = 0; index < snapshot.shaders.length; index += 1) {
            this._options.registerShader(snapshot.shaders[index]!);
        }

        for (let index = 0; index < snapshot.meshes.length; index += 1) {
            this._options.registerMesh(snapshot.meshes[index]!);
        }

        for (let index = 0; index < snapshot.samplers.length; index += 1) {
            this._options.registerSampler(snapshot.samplers[index]!);
        }

        for (let index = 0; index < snapshot.textures.length; index += 1) {
            await this._options.registerTexture(snapshot.textures[index]!);
        }

        if (options.clearExisting !== false) {
            this._options.clearRenderPasses();
        }

        const renderPasses =
            snapshot.renderPasses.length > 0
                ? snapshot.renderPasses
                : [
                      {
                          id: this._options.defaultRenderPassId,
                          order: 0,
                          rendererPassId: this._options.defaultRenderPassId,
                          clearFlags: ['color', 'depth'],
                          clearColor: this._options.defaultClearColor,
                      } satisfies SceneRenderPassDefinition,
                  ];

        for (let index = 0; index < renderPasses.length; index += 1) {
            this._options.registerRenderPass(renderPasses[index]!);
        }

        for (let index = 0; index < snapshot.materials.length; index += 1) {
            this._options.createMaterial(snapshot.materials[index]!);
        }

        return this._options.instantiatePrefab(snapshot.prefab, options);
    }
}
