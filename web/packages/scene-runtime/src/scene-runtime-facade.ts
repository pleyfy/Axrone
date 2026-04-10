import type { GameLoop } from '../../core/src/game-loop';
import { Actor, type ActorConfig } from '../../core/src/component-system/core/actor';
import { World } from '../../core/src/component-system/core/world';
import { SystemManager, SystemPhase } from '../../core/src/component-system/systems/system-manager';
import type { ComponentConstructor, ComponentRegistry } from '../../core/src/component-system/types/core';
import type { System, SystemQuery } from '../../core/src/component-system/types/system';
import type {
    SceneLoopState,
    SceneOptions,
    SceneRegistry,
} from './types';
import { SceneRuntimeKernel } from './scene-runtime-kernel';

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

    protected assertNotDisposed(): void {
        this._kernel.assertNotDisposed();
    }
}