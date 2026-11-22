import type { EventKey } from '@axrone/event';
import type { Archetype as StorageArchetype } from '../../storage/archetype';
import type { WorldStorageRuntime } from '../../storage/world-storage-runtime';
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

const EMPTY_ENTITIES: readonly never[] = Object.freeze([]);

export interface WorldMutationRuntimeOptions<R extends ComponentRegistry> {
    readonly registry: R;
    readonly storage: WorldStorageRuntime<R, Entity, ArchetypeId>;
    readonly actorRegistry: WorldActorRegistry;
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
        archetype: StorageArchetype<any, Entity, ArchetypeId> | null;
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

    createEntity(): Entity {
        const entity = this._options.storage.createEntity();
        this._options.onMutation();
        return entity;
    }

    createEntityWithComponents(components: Record<string, unknown>): Entity {
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
     * responsible for the component instances themselves (the actor bulk path
     * attaches real, fully constructed components and keeps their lifecycle).
     */
    createEntitiesWithComponentsBulk(
        componentSets: readonly Readonly<Record<string, unknown>>[]
    ): readonly Entity[] {
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
        const entities = new Array<Entity>(count);
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
        entity: Entity,
        actor: Actor,
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
                    entity,
                    component: components[index]!.component,
                    actor,
                } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]
            );
        }
    }

    destroyEntity(entity: Entity): void {
        const removedEntity = this._options.storage.destroyEntity(entity);
        if (!removedEntity) {
            return;
        }

        const { archetype, removedComponents } = removedEntity;
        // Singletons are opt-in per component type; most registries have none,
        // so avoid the per-destroy key snapshot in that case.
        if (this._singletonComponentCount > 0) {
            this._options.singletonRegistry.clearEntity(entity, Object.keys(removedComponents));
        }

        for (const [componentName, component] of Object.entries(removedComponents)) {
            const pool = archetype.components.get(componentName);
            if (pool && component) {
                pool.release(component);
            }
        }

        const actor = this._options.actorRegistry.unregister(entity);
        if (actor && this._hasEventSubscribers('EntityDestroyed')) {
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
        if (actor && this._hasEventSubscribers(`${componentKey}Added`)) {
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
        if (actor && this._hasEventSubscribers(`${componentKey}Removed`)) {
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
        if (this._hasEventSubscribers('EntityCreated')) {
            this._options.emitEvent('EntityCreated' as EventKey<ECSEventMap<R>>, {
                entity,
                actor,
            } as ECSEventMap<R>[EventKey<ECSEventMap<R>>]);
        }
    }

    unregisterActor(entity: Entity): void {
        this._options.actorRegistry.unregister(entity);
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
