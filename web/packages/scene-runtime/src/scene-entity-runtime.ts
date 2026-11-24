import {
    Entity,
    Component,
    Hierarchy,
    Transform,
    getComponentMetadata,
    type EntityConfig,
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

export interface SceneEntityRuntimeOptions<
    R extends ComponentRegistry = Record<string, never>,
> {
    readonly world: World<SceneRegistry<R>>;
    readonly componentCatalog: SceneComponentCatalog;
}

interface SceneEntityComponentCreateEntry {
    readonly type: ComponentConstructor;
    readonly args?: readonly unknown[];
}

interface SceneEntityCreateWithComponentsConfig {
    readonly entityConfig?: EntityConfig;
    readonly components?: readonly SceneEntityComponentCreateEntry[];
}

interface PreparedEntityComponentType {
    readonly type: ComponentConstructor;
    readonly componentName: string;
    readonly metadata?: ComponentMetadata;
}

interface PreparedEntityComponentEntry {
    readonly preparedType: PreparedEntityComponentType;
    readonly args?: readonly unknown[];
}

type SceneEntityBatchProfiling = Record<string, number>;

const captureProfilePhase = <T>(
    profiling: SceneEntityBatchProfiling | undefined,
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

export class SceneEntityRuntime<R extends ComponentRegistry = Record<string, never>> {
    private readonly _world: World<SceneRegistry<R>>;
    private readonly _componentCatalog: SceneComponentCatalog;
    private readonly _prefabs: ScenePrefabRuntime;

    constructor(options: SceneEntityRuntimeOptions<R>) {
        this._world = options.world;
        this._componentCatalog = options.componentCatalog;
        this._prefabs = new ScenePrefabRuntime({
            componentCatalog: this._componentCatalog,
            createEntity: (config) => this.createEntity(config),
            getAllEntities: () => this._world.getAllEntities(),
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

    createEntity(config: EntityConfig = {}): EntityId<World<SceneRegistry<R>>> {
        return new Entity(this._world, config);
    }

    createEntitiesWithComponents(
        configs: readonly SceneEntityCreateWithComponentsConfig[],
        profiling?: SceneEntityBatchProfiling
    ): readonly Entity<World<SceneRegistry<R>>>[] {
        if (configs.length === 0) {
            return [];
        }

        const worldRegistry = this._world.registry as Record<string, ComponentConstructor>;
        const hierarchyType = (worldRegistry.Hierarchy ?? Hierarchy) as ComponentConstructor;
        const transformType = (worldRegistry.Transform ?? Transform) as ComponentConstructor;
        const preparedTypes = new Map<ComponentConstructor, PreparedEntityComponentType>();
        const prepareType = (componentType: ComponentConstructor): PreparedEntityComponentType => {
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
            } satisfies PreparedEntityComponentType;
            preparedTypes.set(componentType, prepared);
            return prepared;
        };

        const preparedConfigs = captureProfilePhase(profiling, 'prepareComponentTypesMs', () => {
            const hierarchyPrepared = prepareType(hierarchyType);
            const transformPrepared = prepareType(transformType);

            return configs.map((config) => ({
                entityConfig: config.entityConfig ?? {},
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
                ] satisfies readonly PreparedEntityComponentEntry[],
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

            return captureProfilePhase(profiling, 'entityCreateMs', () =>
                Entity.createWithComponents(this._world, config.entityConfig, preloadedEntries)
            );
        });
    }

    createEntityWithComponents(
        config: EntityConfig = {},
        components: readonly {
            readonly type: ComponentConstructor;
            readonly args?: readonly unknown[];
        }[] = []
    ): EntityId<World<SceneRegistry<R>>> {
        return this.createEntitiesWithComponents([
            {
                entityConfig: config,
                components,
            },
        ])[0]!;
    }

    createPrefab(
        id: string,
        entities: readonly EntityId[] = this._world.getAllEntities()
    ): ScenePrefabDefinition {
        return this._prefabs.createPrefab(id, entities);
    }

    instantiatePrefab(
        prefab: ScenePrefabDefinition,
        options: ScenePrefabInstantiateOptions = {}
    ): readonly EntityId[] {
        return this._prefabs.instantiatePrefab(prefab, options);
    }

    destroyAllEntities(): void {
        this._prefabs.destroyAllEntities();
    }
}
