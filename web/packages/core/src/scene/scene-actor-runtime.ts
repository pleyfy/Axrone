import { Actor, type ActorConfig } from '../component-system/core/actor';
import { World } from '../component-system/core/world';
import type {
    ComponentConstructor,
    ComponentRegistry,
} from '../component-system/types/core';
import type { SceneComponentCatalog } from './component-catalog';
import { Camera, type CameraConfig } from './components/camera';
import { MeshRenderer, type MeshRendererConfig } from './components/mesh-renderer';
import { SceneCapabilityError } from './errors';
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

    createCameraActor(
        actorConfig: ActorConfig = {},
        cameraConfig: CameraConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this._requireRegisteredComponent(
            Camera,
            "camera actor creation requires the 3D scene capability/profile"
        );
        const actor = this.createActor(actorConfig);
        actor.addComponent(Camera, cameraConfig);
        return actor;
    }

    createRenderableActor(
        actorConfig: ActorConfig = {},
        rendererConfig: MeshRendererConfig = {}
    ): Actor<World<SceneRegistry<R>>> {
        this._requireRegisteredComponent(
            MeshRenderer,
            "renderable actor creation requires the 3D scene capability/profile"
        );
        const actor = this.createActor(actorConfig);
        actor.addComponent(MeshRenderer, rendererConfig);
        return actor;
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

    private _requireRegisteredComponent(
        componentType: ComponentConstructor,
        message: string
    ): void {
        if (this._world.isComponentRegistered(componentType)) {
            return;
        }

        throw new SceneCapabilityError(message);
    }
}
