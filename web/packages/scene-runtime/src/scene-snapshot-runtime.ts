import { Vec4 } from '@axrone/numeric';
import type { Actor } from '../../core/src/component-system/core/actor';
import { SceneSnapshotLoader } from './scene-snapshot-loader';
import type {
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    SceneRenderPassDefinition,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
} from './types';

export interface SceneSnapshotActorHost {
    createPrefab(id: string, actors?: readonly Actor[]): ScenePrefabDefinition;
    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options?: ScenePrefabInstantiateOptions
    ): readonly Actor[];
    destroyAllActors(): void;
}

export interface SceneSnapshotAssetHost {
    clear(): void;
    clearRenderPasses(): void;
    registerShader(shader: SceneSnapshot['shaders'][number]): void;
    registerMesh(mesh: SceneSnapshot['meshes'][number]): void;
    registerSampler(sampler: SceneSnapshot['samplers'][number]): void;
    registerTexture(texture: SceneSnapshot['textures'][number]): Promise<unknown>;
    registerRenderPass(renderPass: SceneRenderPassDefinition): void;
    createMaterial(material: SceneSnapshot['materials'][number]): void;
    serializeDefinitions(): Omit<SceneSnapshot, 'version' | 'prefab'>;
}

export interface SceneSnapshotRuntimeOptions {
    readonly sceneId: string;
    readonly defaultRenderPassId: string;
    readonly defaultClearColor: Vec4;
    readonly actors: SceneSnapshotActorHost;
    readonly assets: SceneSnapshotAssetHost;
}

export class SceneSnapshotRuntime {
    private readonly _loader: SceneSnapshotLoader;

    constructor(private readonly _options: SceneSnapshotRuntimeOptions) {
        this._loader = new SceneSnapshotLoader({
            defaultRenderPassId: _options.defaultRenderPassId,
            defaultClearColor: _options.defaultClearColor,
            clearExisting: () => {
                _options.actors.destroyAllActors();
                _options.assets.clear();
            },
            clearRenderPasses: () => {
                _options.assets.clearRenderPasses();
            },
            registerShader: (shader) => {
                _options.assets.registerShader(shader);
            },
            registerMesh: (mesh) => {
                _options.assets.registerMesh(mesh);
            },
            registerSampler: (sampler) => {
                _options.assets.registerSampler(sampler);
            },
            registerTexture: async (texture) => {
                await _options.assets.registerTexture(texture);
            },
            registerRenderPass: (renderPass) => {
                _options.assets.registerRenderPass(renderPass);
            },
            createMaterial: (material) => {
                _options.assets.createMaterial(material);
            },
            instantiatePrefab: (prefab, options) =>
                _options.actors.instantiatePrefab(prefab, options),
        });
    }

    initializeRenderPasses(renderPasses?: readonly SceneRenderPassDefinition[]): void {
        const definitions =
            renderPasses && renderPasses.length > 0
                ? renderPasses
                : [
                      {
                          id: this._options.defaultRenderPassId,
                          order: 0,
                          rendererPassId: this._options.defaultRenderPassId,
                          clearFlags: ['color', 'depth'],
                          clearColor: this._options.defaultClearColor,
                      } satisfies SceneRenderPassDefinition,
                  ];

        for (let index = 0; index < definitions.length; index += 1) {
            this._options.assets.registerRenderPass(definitions[index]!);
        }
    }

    createPrefab(id: string, actors?: readonly Actor[]): ScenePrefabDefinition {
        return this._options.actors.createPrefab(id, actors);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
        return this._options.actors.instantiatePrefab(prefab, options);
    }

    serializeScene(): SceneSnapshot {
        return {
            version: 1,
            prefab: this.createPrefab(`${this._options.sceneId}:prefab`),
            ...this._options.assets.serializeDefinitions(),
        };
    }

    async loadScene(
        snapshot: SceneSnapshot,
        options: SceneSnapshotLoadOptions = {}
    ): Promise<readonly Actor[]> {
        return await this._loader.load(snapshot, options);
    }
}