import {
    Actor,
    Component,
    Hierarchy,
    Transform,
    getComponentMetadata,
    type ActorConfig,
    type ComponentMetadata,
} from '@axrone/ecs-runtime';
import { World } from '@axrone/ecs-runtime';
import type {
    ComponentConstructor,
    ComponentRegistry,
} from '@axrone/ecs-runtime';
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

interface SceneActorComponentCreateEntry {
    readonly type: ComponentConstructor;
    readonly args?: readonly unknown[];
}

interface SceneActorCreateWithComponentsConfig {
    readonly actorConfig?: ActorConfig;
    readonly components?: readonly SceneActorComponentCreateEntry[];
}

interface PreparedActorComponentType {
    readonly type: ComponentConstructor;
    readonly componentName: string;
    readonly metadata?: ComponentMetadata;
}

interface PreparedActorComponentEntry {
    readonly preparedType: PreparedActorComponentType;
    readonly args?: readonly unknown[];
}

type SceneActorBatchProfiling = Record<string, number>;

const captureProfilePhase = <T>(
    profiling: SceneActorBatchProfiling | undefined,
    phaseName: string,
    action: () => T
): T => {
    if (!profiling) {
        return action();
    }

    const startedAt = performance.now();

    try {
        return action();
    } finally {
        profiling[phaseName] = (profiling[phaseName] ?? 0) + (performance.now() - startedAt);
    }
};

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

    runInStructureBatch<T>(callback: () => T): T {
        return this._world.batchStructureChanges(callback);
    }

    createActor(config: ActorConfig = {}): Actor<World<SceneRegistry<R>>> {
        return new Actor(this._world, config);
    }

    createActorsWithComponents(
        configs: readonly SceneActorCreateWithComponentsConfig[],
        profiling?: SceneActorBatchProfiling
    ): readonly Actor<World<SceneRegistry<R>>>[] {
        if (configs.length === 0) {
            return [];
        }

        const worldRegistry = this._world.registry as Record<string, ComponentConstructor>;
        const hierarchyType = (worldRegistry.Hierarchy ?? Hierarchy) as ComponentConstructor;
        const transformType = (worldRegistry.Transform ?? Transform) as ComponentConstructor;
        const preparedTypes = new Map<ComponentConstructor, PreparedActorComponentType>();
        const prepareType = (componentType: ComponentConstructor): PreparedActorComponentType => {
            const existing = preparedTypes.get(componentType);
            if (existing) {
                return existing;
            }

            if (!this._world.isComponentRegistered(componentType)) {
                this.registerComponent(componentType);
            }

            const prepared = {
                type: componentType,
                componentName: getComponentMetadata(componentType)?.scriptName ?? componentType.name,
                metadata: getComponentMetadata(componentType),
            } satisfies PreparedActorComponentType;
            preparedTypes.set(componentType, prepared);
            return prepared;
        };

        const preparedConfigs = captureProfilePhase(profiling, 'prepareComponentTypesMs', () => {
            const hierarchyPrepared = prepareType(hierarchyType);
            const transformPrepared = prepareType(transformType);

            return configs.map((config) => ({
                actorConfig: config.actorConfig ?? {},
                preparedEntries: [
                    {
                        preparedType: hierarchyPrepared,
                        args: undefined,
                    },
                    {
                        preparedType: transformPrepared,
                        args: undefined,
                    },
                    ...(config.components ?? []).map((entry) => ({
                        preparedType: prepareType(entry.type),
                        args: entry.args,
                    })),
                ] satisfies readonly PreparedActorComponentEntry[],
            }));
        });

        return preparedConfigs.map((config) => {
            const preloadedEntries = captureProfilePhase(profiling, 'componentInstantiateMs', () =>
                config.preparedEntries.map((entry) => ({
                    componentType: entry.preparedType.type as any,
                    componentName: entry.preparedType.componentName,
                    metadata: entry.preparedType.metadata,
                    component: new (entry.preparedType.type as new (...args: any[]) => Component)(
                        ...(entry.args ?? [])
                    ),
                }))
            );

            return captureProfilePhase(profiling, 'actorCreateMs', () =>
                Actor.createWithComponents(this._world, config.actorConfig, preloadedEntries)
            );
        });
    }

    createActorWithComponents(
        config: ActorConfig = {},
        components: readonly {
            readonly type: ComponentConstructor;
            readonly args?: readonly unknown[];
        }[] = []
    ): Actor<World<SceneRegistry<R>>> {
        return this.createActorsWithComponents([
            {
                actorConfig: config,
                components,
            },
        ])[0]!;
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
