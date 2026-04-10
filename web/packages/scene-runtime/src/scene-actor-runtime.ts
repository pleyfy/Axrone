import { Actor, type ActorConfig } from '../../core/src/component-system/core/actor';
import { World } from '../../core/src/component-system/core/world';
import type {
    ComponentConstructor,
    ComponentRegistry,
} from '../../core/src/component-system/types/core';
import type { SceneComponentCatalog } from './component-catalog';
import { ScenePrefabRuntime } from './scene-prefab-runtime';
import type {
    ScenePrefabDefinition,
    ScenePrefabInstantiateOptions,
    SceneRegistry,
} from './types';

export interface SceneActorRuntimeOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly world: World<SceneRegistry<R>>;
    readonly componentCatalog: SceneComponentCatalog;
}

export class SceneActorRuntime<R extends ComponentRegistry = Record<string, never>> {
    private readonly _world: World<SceneRegistry<R>>;
    private readonly _componentCatalog: SceneComponentCatalog;
    private readonly _prefabs: ScenePrefabRuntime;

    constructor(options: SceneActorRuntimeOptions<R>) {
        this._world = options.world;
        this._componentCatalog = options.componentCatalog;
        this._prefabs = new ScenePrefabRuntime({
            componentCatalog: this._componentCatalog,
            createActor: (config) => this.createActor(config),
            getAllActors: () => this._world.getAllActors(),
        });
    }

    registerComponent<T extends ComponentConstructor>(componentType: T): void {
        this._componentCatalog.register(componentType);
        this._world.registerComponentType(componentType);
    }

    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean {
        return this._world.isComponentRegistered(componentTypeOrName);
    }

    getRegisteredComponentNames(): readonly string[] {
        return this._world.getRegisteredComponentNames();
    }

    createActor(config: ActorConfig = {}): Actor<World<SceneRegistry<R>>> {
        return new Actor(this._world, config);
    }

    createPrefab(
        id: string,
        actors: readonly Actor[] = this._world.getAllActors()
    ): ScenePrefabDefinition {
        return this._prefabs.createPrefab(id, actors);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly Actor[] {
        return this._prefabs.instantiatePrefab(prefab, options);
    }

    destroyAllActors(): void {
        this._prefabs.destroyAllActors();
    }
}