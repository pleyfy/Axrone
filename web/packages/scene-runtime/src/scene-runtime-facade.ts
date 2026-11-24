import type { GameLoop } from '@axrone/game-loop';
import { Entity, type EntityConfig } from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import { SystemManager, SystemPhase } from '@axrone/ecs-runtime';
import type { ComponentConstructor, ComponentRegistry } from '@axrone/ecs-runtime';
import type { System, SystemQuery } from '@axrone/ecs-runtime';
import type {
    SceneLoopState,
    SceneOptions,
    SceneRegistry,
} from './types';
import { SceneRuntimeKernel } from './scene-runtime-kernel';
import type { SceneRuntimeProfiler } from './runtime-profiler';

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
            this._kernel.lifecycle.start();
        }
    }

    registerComponent<T extends ComponentConstructor>(componentType: T): this {
        this.assertNotDisposed();
        this._kernel.entities.registerComponent(componentType);
        return this;
    }

    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean {
        this.assertNotDisposed();
        return this._kernel.entities.isComponentRegistered(componentTypeOrName);
    }

    getRegisteredComponentNames(): readonly string[] {
        this.assertNotDisposed();
        return this._kernel.entities.getRegisteredComponentNames();
    }

    createEntity(config: EntityConfig = {}): EntityId<World<RuntimeRegistry<R>>> {
        this.assertNotDisposed();
        return this._kernel.entities.createEntity(config);
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

    getRuntimeProfiler(): SceneRuntimeProfiler {
        this.assertNotDisposed();
        return this._kernel.profiler;
    }

    protected assertNotDisposed(): void {
        this._kernel.assertNotDisposed();
    }
}