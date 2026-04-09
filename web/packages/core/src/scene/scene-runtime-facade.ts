import type { GameLoop } from '../game-loop';
import { Actor, type ActorConfig } from '../component-system/core/actor';
import { World } from '../component-system/core/world';
import { SystemManager, SystemPhase } from '../component-system/systems/system-manager';
import type { ComponentConstructor, ComponentRegistry } from '../component-system/types/core';
import type { System, SystemQuery } from '../component-system/types/system';
import {
    DEFAULT_SCENE_HEIGHT,
    DEFAULT_SCENE_WIDTH,
} from './scene-runtime-defaults';
import { SceneRuntimeKernel } from './scene-runtime-kernel';
import type {
    SceneLoopState,
    SceneOptions,
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    SceneRegistry,
    SceneSnapshot,
    SceneSnapshotLoadOptions,
} from './types';

type RuntimeRegistry<R extends ComponentRegistry> = SceneRegistry<R>;

const createSceneId = (): string =>
    `scene_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

export class SceneRuntimeFacade<R extends ComponentRegistry = Record<string, never>> {
    readonly id: string;
    readonly canvas: HTMLCanvasElement;
    readonly gl: WebGL2RenderingContext;
    readonly world: World<RuntimeRegistry<R>>;
    readonly systems: SystemManager<RuntimeRegistry<R>>;
    readonly loop: GameLoop<SceneLoopState>;

    protected readonly _kernel: SceneRuntimeKernel<R>;

    constructor(options: SceneOptions<R> = {}) {
        this.id = createSceneId();
        this._kernel = new SceneRuntimeKernel({
            sceneId: this.id,
            options,
        });
        this.canvas = this._kernel.canvas;
        this.gl = this._kernel.gl;
        this.world = this._kernel.world;
        this.systems = this._kernel.systems;
        this.loop = this._kernel.loop;

        if (options.autoStart !== false) {
            this.start();
        }
    }

    get status() {
        return this._kernel.lifecycle.status;
    }

    get isDisposed(): boolean {
        return this._kernel.lifecycle.isDisposed;
    }

    get renderStats() {
        return this._kernel.renderRuntime.stats;
    }

    registerComponent<T extends ComponentConstructor>(componentType: T): this {
        this.assertNotDisposed();
        this._kernel.actors.registerComponent(componentType);
        return this;
    }

    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean {
        this.assertNotDisposed();
        return this._kernel.actors.isComponentRegistered(componentTypeOrName);
    }

    getRegisteredComponentNames(): readonly string[] {
        this.assertNotDisposed();
        return this._kernel.actors.getRegisteredComponentNames();
    }

    createActor(config: ActorConfig = {}): Actor<World<RuntimeRegistry<R>>> {
        this.assertNotDisposed();
        return this._kernel.actors.createActor(config);
    }

    addSystem<Q extends SystemQuery<RuntimeRegistry<R>>>(
        system: System<RuntimeRegistry<R>, Q>,
        phase: SystemPhase = SystemPhase.Update
    ): this {
        this.assertNotDisposed();
        this.systems.addSystem(system, phase);
        return this;
    }

    removeSystem(systemId: string): boolean {
        this.assertNotDisposed();
        return this.systems.removeSystem(systemId as any);
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

    start(now?: number): this {
        this._kernel.lifecycle.start(now);
        return this;
    }

    pause(): this {
        this._kernel.lifecycle.pause();
        return this;
    }

    resume(now?: number): this {
        this._kernel.lifecycle.resume(now);
        return this;
    }

    stop(): this {
        this._kernel.lifecycle.stop();
        return this;
    }

    renderNow(): this {
        this._kernel.lifecycle.renderNow();
        return this;
    }

    resize(
        width: number = this.canvas.clientWidth || DEFAULT_SCENE_WIDTH,
        height: number = this.canvas.clientHeight || DEFAULT_SCENE_HEIGHT,
        pixelRatio?: number
    ): this {
        this._kernel.lifecycle.resize(width, height, pixelRatio);
        return this;
    }

    dispose(): void {
        this._kernel.lifecycle.dispose();
    }

    protected assertNotDisposed(): void {
        this._kernel.assertNotDisposed();
    }
}
