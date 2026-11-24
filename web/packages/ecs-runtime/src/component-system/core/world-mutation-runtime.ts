import type { EventKey } from '@axrone/event';
import type { Archetype as StorageArchetype } from '../../storage/archetype';
import type { WorldStorageRuntime } from '../../storage/world-storage-runtime';
import { getComponentMetadata } from '../decorators/script';
import type {
    ArchetypeId,
    ComponentConstructor,
    ComponentInstance,
    ComponentRegistry,
    EntityId,
} from '../types/core';
import type { ECSEventMap } from '../types/events';
import type { Entity } from './entity';
import { WorldEntityRegistry } from './world-entity-registry';
import { WorldSingletonRegistry } from './world-singleton-registry';

type WorldMutationEventDispatcher<R extends ComponentRegistry> = <T extends EventKey<ECSEventMap<R>>>(
    event: T,
    data: ECSEventMap<R>[T]
) => void;

const EMPTY_ENTITIES: readonly never[] = Object.freeze([]);

export interface WorldMutationRuntimeOptions<R extends ComponentRegistry> {
    readonly registry: R;
    readonly storage: WorldStorageRuntime<R, EntityId, ArchetypeId>;
    readonly entityRegistry: WorldEntityRegistry;
    readonly singletonRegistry: WorldSingletonRegistry;
    readonly emitEvent: WorldMutationEventDispatcher<R>;
    readonly onMutation: () => void;
    readonly onStructureChange: () => void;
    /**
     * Probes whether anyone is listening for an event. Returning false skips
     * building and dispatching the payload, which is what makes bulk creation
     * cheap; an event with no subscribers has no observable effect. Absent
     * means "assume subscribers" so directly-constructed runtimes keep the
     * unconditional emission behaviour.
     */
    readonly hasEventSubscribers?: (event: string) => boolean;
}

export class WorldMutationRuntime<R extends ComponentRegistry> {
    private readonly _singletonComponents = new Map<string, boolean>();
    /** Number of registered singleton component types; usually zero. */
    private _singletonComponentCount = 0;
    /** Reused resolution target for the add-component hot path. */
    private readonly _transitionScratch: {
        archetype: StorageArchetype<any, EntityId, ArchetypeId> | null;
        created: boolean;
    } = {
        archetype: null,
        created: false,
    };

    constructor(private readonly _options: WorldMutationRuntimeOptions<R>) {
        for (const [componentName, componentType] of Object.entries(this._options.registry)) {
            this._setSingletonFlag(componentName, this._resolveSingletonFlag(componentType));
        }
    }

    createEntity(): EntityId {
        const entity = this._options.storage.createEntity();
        this._options.onMutation();
        return entity;
    }

    createEntityWithComponents(components: Record<string, unknown>): EntityId {
        const entries = Object.entries(components).filter(([, component]) => component !== undefined);

        if (entries.length === 0) {
            return this.createEntity();
        }

        const resolution = this._options.storage.createEntityWithComponents(
            Object.fromEntries(entries)
        );

        if (resolution.createdArchetype) {
            this._options.onStructureChange();
        }

        this._options.onMutation();
        return resolution.entity;
    }

    /**
     * Creates one entity per component set, all sharing the first set's
     * signature, with a single archetype resolution for the whole batch.
     *
     * Each set is validated against the shared signature so a typo cannot
     * silently fall back to a pooled component instance. Callers are
     * responsible for the component instances themselves (the entity bulk path
     * attaches real, fully constructed components and keeps their lifecycle).
     */
    createEntitiesWithComponentsBulk(
        componentSets: readonly Readonly<Record<string, unknown>>[]
    ): readonly EntityId[] {
        const count = componentSets.length;
        if (count === 0) {
            return EMPTY_ENTITIES;
        }

        const signature = Object.keys(componentSets[0]!);
        // Backstop for direct callers: `World.createEntitiesWithComponentsBulk`
        // already validated the shared signature at its boundary.
        for (let index = 0; index < count; index += 1) {
            const set = componentSets[index]!;
            for (let key = 0; key < signature.length; key += 1) {
                const name = signature[key]!;
                if (set[name] === undefined) {
                    throw new Error(
                        `Bulk creation requires one shared component signature: set ${index} is missing '${name}'`
                    );
                }
            }
        }

        const resolution = this._options.storage.getOrCreateArchetype(signature);
        const archetype = resolution.archetype;
        const entities = new Array<EntityId>(count);
        for (let index = 0; index < count; index += 1) {
            entities[index] = this._options.storage.createEntityInArchetype(
                archetype,
                componentSets[index] as Record<string, any>
            );
        }

        if (resolution.created) {
            this._options.onStructureChange();
        }

        this._options.onMutation();
        return entities;
    }

    /**
     * Emits the `${componentName}Added` events that per-component
     * `addComponent` emits, for components a bulk path placed directly in the
     * archetype. Events without subscribers are skipped.
     */
    notifyComponentsAttached(
        entityId: EntityId,
        entity: Entity,
        componentNames: readonly string[],
        components: readonly { readonly component: unknown }[]
    ): void {
        for (let index = 0; index < componentNames.length; index += 1) {
            const componentName = componentNames[index]!;
            if (!this._hasEventSubscribers(`${componentName}Added`)) {
                continue;
            }
            this._options.emitEvent(
                `${componentName}Added` as EventKey<ECSEventMap<R>>,
                {
                    entityId,
                    component: components[index]!.component,
                    entity,
                } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]
            );
        }
    }

    destroyEntity(entityId: EntityId): void {
        const removedEntity = this._options.storage.destroyEntity(entityId);
        if (!removedEntity) {
            return;
        }

        const { archetype, removedComponents } = removedEntity;
        // Singletons are opt-in per component type; most registries have none,
        // so avoid the per-destroy key snapshot in that case.
        if (this._singletonComponentCount > 0) {
            this._options.singletonRegistry.clearEntity(entityId, Object.keys(removedComponents));
        }

        for (const [componentName, component] of Object.entries(removedComponents)) {
            const pool = archetype.components.get(componentName);
            if (pool && component) {
                pool.release(component);
            }
        }

        const entity = this._options.entityRegistry.unregister(entityId);
        if (entity && this._hasEventSubscribers('EntityDestroyed')) {
            this._options.emitEvent('EntityDestroyed' as EventKey<ECSEventMap<R>>, {
                entityId,
                entity,
            } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
        }

        this._options.onMutation();
    }

    addComponent<K extends keyof R>(
        entityId: EntityId,
        componentName: K,
        component?: ComponentInstance<R[K]>
    ): ComponentInstance<R[K]> {
        const componentKey = componentName as string;

        if (this._isSingletonComponent(componentKey)) {
            const existingSingleton = this._options.singletonRegistry.get(componentKey);
            if (existingSingleton) {
                if (existingSingleton.entity !== entityId) {
                    throw new Error(
                        `Singleton component '${componentKey}' already exists on entity ${existingSingleton.entity}`
                    );
                }

                return existingSingleton.instance as ComponentInstance<R[K]>;
            }
        }

        const currentArchetypeId = this._options.storage.getEntityArchetypeId(entityId);
        if (!currentArchetypeId) {
            throw new Error('Entity not found');
        }

        const currentArchetype = this._options.storage.getArchetype(currentArchetypeId);
        if (!currentArchetype) {
            throw new Error('Current archetype not found');
        }

        if (currentArchetype.signature.includes(componentKey)) {
            const existingComponent = currentArchetype.getComponent(entityId, componentKey);
            if (existingComponent) {
                return existingComponent as ComponentInstance<R[K]>;
            }
        }

        // Scratch target: this runs once per added component, so a fresh
        // resolution object per call is pure allocation pressure.
        this._options.storage.resolveAddComponentArchetypeInto(
            currentArchetype,
            componentKey,
            this._transitionScratch
        );
        const targetArchetype = this._transitionScratch.archetype!;
        const createdArchetype = this._transitionScratch.created;

        const pool = targetArchetype.components.get(componentKey);
        if (!pool) {
            throw new Error('Component pool not found');
        }

        const finalComponent = component || pool.acquire();
        const removedComponents = currentArchetype.removeEntity(entityId);
        removedComponents[componentKey] = finalComponent;
        targetArchetype.addEntity(entityId, removedComponents);
        this._options.storage.setEntityArchetype(entityId, targetArchetype.id);

        if (createdArchetype) {
            this._options.onStructureChange();
        }

        if (this._isSingletonComponent(componentKey)) {
            this._options.singletonRegistry.set(componentKey, entityId, finalComponent);
        }

        const entity = this._options.entityRegistry.get(entityId);
        if (entity && this._hasEventSubscribers(`${componentKey}Added`)) {
            this._options.emitEvent(`${componentKey}Added` as EventKey<ECSEventMap<R>>, {
                entityId,
                component: finalComponent,
                entity,
            } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
        }

        this._options.onMutation();
        return finalComponent;
    }

    removeComponent<K extends keyof R>(entityId: EntityId, componentName: K): void {
        const componentKey = componentName as string;
        const currentArchetypeId = this._options.storage.getEntityArchetypeId(entityId);
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

        const removedComponents = currentArchetype.removeEntity(entityId);
        const removedComponent = removedComponents[componentKey];
        delete removedComponents[componentKey];

        targetArchetype.addEntity(entityId, removedComponents);
        this._options.storage.setEntityArchetype(entityId, targetArchetype.id);

        if (createdArchetype) {
            this._options.onStructureChange();
        }

        if (this._isSingletonComponent(componentKey)) {
            this._options.singletonRegistry.clearComponent(componentKey, entityId);
        }

        const pool = currentArchetype.components.get(componentKey);
        if (pool && removedComponent) {
            pool.release(removedComponent);
        }

        const entity = this._options.entityRegistry.get(entityId);
        if (entity && this._hasEventSubscribers(`${componentKey}Removed`)) {
            this._options.emitEvent(`${componentKey}Removed` as EventKey<ECSEventMap<R>>, {
                entityId,
                component: removedComponent,
                entity,
            } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
        }

        this._options.onMutation();
    }

    registerEntity(entityId: EntityId, entity: Entity): void {
        this._options.entityRegistry.register(entityId, entity);
        if (this._hasEventSubscribers('EntityCreated')) {
            this._options.emitEvent('EntityCreated' as EventKey<ECSEventMap<R>>, {
                entityId,
                entity,
            } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
        }
    }

    unregisterEntity(entityId: EntityId): void {
        this._options.entityRegistry.unregister(entityId);
    }

    registerComponentType(componentName: string, componentType: ComponentConstructor): void {
        this._options.storage.registerComponent(componentName);
        this._setSingletonFlag(componentName, this._resolveSingletonFlag(componentType));
    }

    private _setSingletonFlag(componentName: string, isSingleton: boolean): void {
        const previous = this._singletonComponents.get(componentName);
        this._singletonComponents.set(componentName, isSingleton);

        if (isSingleton && previous !== true) {
            this._singletonComponentCount += 1;
        } else if (!isSingleton && previous === true) {
            this._singletonComponentCount -= 1;
        }
    }

    private _hasEventSubscribers(event: string): boolean {
        const probe = this._options.hasEventSubscribers;
        return probe ? probe(event) : true;
    }

    private _isSingletonComponent(componentName: string): boolean {
        return this._singletonComponents.get(componentName) === true;
    }

    private _resolveSingletonFlag(componentType: ComponentConstructor): boolean {
        return getComponentMetadata(componentType as any)?.singleton === true;
    }
}
