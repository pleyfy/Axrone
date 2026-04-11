import type { EventKey } from '@axrone/event';
import type { WorldStorageRuntime } from '@axrone/ecs-storage/world-storage-runtime';
import { getComponentMetadata } from '../decorators/script';
import type {
    ArchetypeId,
    ComponentConstructor,
    ComponentInstance,
    ComponentRegistry,
    Entity,
} from '../types/core';
import type { ECSEventMap } from '../types/events';
import type { Actor } from './actor';
import { WorldActorRegistry } from './world-actor-registry';
import { WorldSingletonRegistry } from './world-singleton-registry';

type WorldMutationEventDispatcher<R extends ComponentRegistry> = <T extends EventKey<ECSEventMap<R>>>(
    event: T,
    data: ECSEventMap<R>[T]
) => void;

export interface WorldMutationRuntimeOptions<R extends ComponentRegistry> {
    readonly registry: R;
    readonly storage: WorldStorageRuntime<R, Entity, ArchetypeId>;
    readonly actorRegistry: WorldActorRegistry;
    readonly singletonRegistry: WorldSingletonRegistry;
    readonly emitEvent: WorldMutationEventDispatcher<R>;
    readonly onMutation: () => void;
    readonly onStructureChange: () => void;
}

export class WorldMutationRuntime<R extends ComponentRegistry> {
    private readonly _singletonComponents = new Map<string, boolean>();

    constructor(private readonly _options: WorldMutationRuntimeOptions<R>) {
        for (const [componentName, componentType] of Object.entries(this._options.registry)) {
            this._singletonComponents.set(componentName, this._resolveSingletonFlag(componentType));
        }
    }

    createEntity(): Entity {
        const entity = this._options.storage.createEntity();
        this._options.onMutation();
        return entity;
    }

    destroyEntity(entity: Entity): void {
        const removedEntity = this._options.storage.destroyEntity(entity);
        if (!removedEntity) {
            return;
        }

        const { archetype, removedComponents } = removedEntity;
        this._options.singletonRegistry.clearEntity(entity, Object.keys(removedComponents));

        for (const [componentName, component] of Object.entries(removedComponents)) {
            const pool = archetype.components.get(componentName);
            if (pool && component) {
                pool.release(component);
            }
        }

        const actor = this._options.actorRegistry.unregister(entity);
        if (actor) {
            this._options.emitEvent('EntityDestroyed' as EventKey<ECSEventMap<R>>, {
                entity,
                actor,
            } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
        }

        this._options.onMutation();
    }

    addComponent<K extends keyof R>(
        entity: Entity,
        componentName: K,
        component?: ComponentInstance<R[K]>
    ): ComponentInstance<R[K]> {
        const componentKey = componentName as string;

        if (this._isSingletonComponent(componentKey)) {
            const existingSingleton = this._options.singletonRegistry.get(componentKey);
            if (existingSingleton) {
                if (existingSingleton.entity !== entity) {
                    throw new Error(
                        `Singleton component '${componentKey}' already exists on entity ${existingSingleton.entity}`
                    );
                }

                return existingSingleton.instance as ComponentInstance<R[K]>;
            }
        }

        const currentArchetypeId = this._options.storage.getEntityArchetypeId(entity);
        if (!currentArchetypeId) {
            throw new Error('Entity not found');
        }

        const currentArchetype = this._options.storage.getArchetype(currentArchetypeId);
        if (!currentArchetype) {
            throw new Error('Current archetype not found');
        }

        if (currentArchetype.signature.includes(componentKey)) {
            const existingComponent = currentArchetype.getComponent(entity, componentKey);
            if (existingComponent) {
                return existingComponent as ComponentInstance<R[K]>;
            }
        }

        const {
            archetype: targetArchetype,
            created: createdArchetype,
        } = this._options.storage.resolveAddComponentArchetype(currentArchetype, componentKey);

        const pool = targetArchetype.components.get(componentKey);
        if (!pool) {
            throw new Error('Component pool not found');
        }

        const finalComponent = component || pool.acquire();
        const removedComponents = currentArchetype.removeEntity(entity);
        removedComponents[componentKey] = finalComponent;
        targetArchetype.addEntity(entity, removedComponents);
        this._options.storage.setEntityArchetype(entity, targetArchetype.id);

        if (createdArchetype) {
            this._options.onStructureChange();
        }

        if (this._isSingletonComponent(componentKey)) {
            this._options.singletonRegistry.set(componentKey, entity, finalComponent);
        }

        const actor = this._options.actorRegistry.get(entity);
        if (actor) {
            this._options.emitEvent(`${componentKey}Added` as EventKey<ECSEventMap<R>>, {
                entity,
                component: finalComponent,
                actor,
            } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
        }

        this._options.onMutation();
        return finalComponent;
    }

    removeComponent<K extends keyof R>(entity: Entity, componentName: K): void {
        const componentKey = componentName as string;
        const currentArchetypeId = this._options.storage.getEntityArchetypeId(entity);
        if (!currentArchetypeId) {
            return;
        }

        const currentArchetype = this._options.storage.getArchetype(currentArchetypeId);
        if (!currentArchetype || !currentArchetype.signature.includes(componentKey)) {
            return;
        }

        const {
            archetype: targetArchetype,
            created: createdArchetype,
        } = this._options.storage.resolveRemoveComponentArchetype(currentArchetype, componentKey);

        const removedComponents = currentArchetype.removeEntity(entity);
        const removedComponent = removedComponents[componentKey];
        delete removedComponents[componentKey];

        targetArchetype.addEntity(entity, removedComponents);
        this._options.storage.setEntityArchetype(entity, targetArchetype.id);

        if (createdArchetype) {
            this._options.onStructureChange();
        }

        if (this._isSingletonComponent(componentKey)) {
            this._options.singletonRegistry.clearComponent(componentKey, entity);
        }

        const pool = currentArchetype.components.get(componentKey);
        if (pool && removedComponent) {
            pool.release(removedComponent);
        }

        const actor = this._options.actorRegistry.get(entity);
        if (actor) {
            this._options.emitEvent(`${componentKey}Removed` as EventKey<ECSEventMap<R>>, {
                entity,
                component: removedComponent,
                actor,
            } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
        }

        this._options.onMutation();
    }

    registerActor(entity: Entity, actor: Actor): void {
        this._options.actorRegistry.register(entity, actor);
        this._options.emitEvent('EntityCreated' as EventKey<ECSEventMap<R>>, {
            entity,
            actor,
        } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
    }

    unregisterActor(entity: Entity): void {
        this._options.actorRegistry.unregister(entity);
    }

    registerComponentType(componentName: string, componentType: ComponentConstructor): void {
        this._options.storage.registerComponent(componentName);
        this._singletonComponents.set(componentName, this._resolveSingletonFlag(componentType));
    }

    private _isSingletonComponent(componentName: string): boolean {
        return this._singletonComponents.get(componentName) === true;
    }

    private _resolveSingletonFlag(componentType: ComponentConstructor): boolean {
        return getComponentMetadata(componentType as any)?.singleton === true;
    }
}
