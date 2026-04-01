import type {
    ComponentRegistry,
    ComponentMask,
    Entity,
    ArchetypeId,
    BitMask,
    ComponentInstance,
    ComponentConstructor,
} from '../types/core';
import type { QueryResult } from '../types/system';
import type { EventKey } from '../../event';
import { Archetype } from '../archetype/archetype';
import { OptimizedQueryCache } from '../archetype/query-cache';
import { createTypedEmitter, IEventEmitter } from '../../event';
import type { ECSEventMap } from '../types/events';
import { ECSObservables } from '../observers/ecs-observer';
import type { Actor } from './actor';
import { getComponentMetadata } from '../decorators/script';

export type WorldState = 'initializing' | 'ready' | 'paused' | 'disposing' | 'disposed';
export type EntityId = Entity & { readonly __entityBrand: unique symbol };

export class WorldError extends Error {
    constructor(
        message: string,
        public readonly operation: string,
        public readonly cause?: Error
    ) {
        super(`[World] ${operation}: ${message}`);
        this.name = 'WorldError';
        if (cause) {
            this.stack += `\nCaused by: ${cause.stack}`;
        }
    }
}

export class EntityError extends WorldError {
    constructor(
        message: string,
        public readonly entity: Entity,
        operation: string,
        cause?: Error
    ) {
        super(`Entity ${entity}: ${message}`, operation, cause);
        this.name = 'EntityError';
    }
}

export class ComponentError extends WorldError {
    constructor(
        message: string,
        public readonly entity: Entity,
        public readonly componentName: string,
        operation: string,
        cause?: Error
    ) {
        super(`Entity ${entity}, Component ${componentName}: ${message}`, operation, cause);
        this.name = 'ComponentError';
    }
}

interface WorldMetrics {
    readonly entityCount: number;
    readonly archetypeCount: number;
    readonly queryCount: number;
    readonly eventCount: number;
    readonly memoryUsage: number;
    readonly lastUpdateTime: number;
}

interface WorldConfig {
    readonly maxEntities?: number;
    readonly enableMetrics?: boolean;
    readonly enableValidation?: boolean;
    readonly enableEventBatching?: boolean;
    readonly cacheSize?: number;
}

export class World<R extends ComponentRegistry> {
    private readonly _registry: R;
    private readonly _componentMask: ComponentMask;
    private readonly _archetypes = new Map<ArchetypeId, Archetype<R>>();
    private readonly _entityArchetypes = new Map<Entity, ArchetypeId>();
    private readonly _queryCache: OptimizedQueryCache;
    private readonly _eventBus: IEventEmitter<ECSEventMap<R>>;
    private readonly _observables: ECSObservables<R>;
    private readonly _actorRegistry = new Map<Entity, Actor>();
    private readonly _singletonComponents = new Map<string, { entity: Entity; instance: any }>();

    private _nextEntityId = 1;
    private readonly _freeEntities: Entity[] = [];
    private _emptyArchetypeId: ArchetypeId;

    private _state: WorldState = 'initializing';
    private readonly _config: Required<WorldConfig>;
    private readonly _creationTime: number;
    private _lastUpdateTime: number = 0;

    private readonly _enableMetrics: boolean;
    private readonly _enableValidation: boolean;
    private _queryCount = 0;
    private _eventCount = 0;

    private readonly _disposables = new Set<() => void>();

    constructor(registry: R, config: WorldConfig = {}) {
        if (!registry || typeof registry !== 'object') {
            throw new WorldError('Invalid component registry provided', 'constructor');
        }

        this._config = {
            maxEntities: config.maxEntities ?? 100000,
            enableMetrics: config.enableMetrics ?? false,
            enableValidation: config.enableValidation ?? true,
            enableEventBatching: config.enableEventBatching ?? true,
            cacheSize: config.cacheSize ?? 1000,
        };

        this._registry = registry;
        this._enableMetrics = this._config.enableMetrics;
        this._enableValidation = this._config.enableValidation;
        this._creationTime = performance.now();

        try {
            this._componentMask = this._createComponentMask();
            this._queryCache = new OptimizedQueryCache();
            this._eventBus = createTypedEmitter<ECSEventMap<R>>();
            this._observables = new ECSObservables<R>();

            this._setupEventObserverBridge();

            this._emptyArchetypeId = this._getOrCreateArchetype([]).id;

            this._state = 'ready';
        } catch (error) {
            this._state = 'disposed';
            throw new WorldError(
                'Failed to initialize world',
                'constructor',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    get registry(): Readonly<R> {
        return this._registry;
    }

    get state(): WorldState {
        return this._state;
    }

    get isReady(): boolean {
        return this._state === 'ready';
    }

    get isDisposed(): boolean {
        return this._state === 'disposed';
    }

    get metrics(): Readonly<WorldMetrics> | null {
        if (!this._enableMetrics) {
            return null;
        }

        return {
            entityCount: this._entityArchetypes.size,
            archetypeCount: this._archetypes.size,
            queryCount: this._queryCount,
            eventCount: this._eventCount,
            memoryUsage: this._calculateMemoryUsage(),
            lastUpdateTime: this._lastUpdateTime,
        };
    }

    createEntity(): Entity {
        this._validateWorldState('createEntity');

        if (this._entityArchetypes.size >= this._config.maxEntities) {
            throw new WorldError(
                `Maximum entity limit (${this._config.maxEntities}) reached`,
                'createEntity'
            );
        }

        try {
            const entity = this._freeEntities.pop() ?? (this._nextEntityId++ as Entity);
            const emptyArchetype = this._archetypes.get(this._emptyArchetypeId);

            if (!emptyArchetype) {
                throw new WorldError('Empty archetype not found', 'createEntity');
            }

            emptyArchetype.addEntity(entity);
            this._entityArchetypes.set(entity, this._emptyArchetypeId);

            if (this._enableMetrics) {
                this._lastUpdateTime = performance.now();
            }

            return entity;
        } catch (error) {
            throw new WorldError(
                'Failed to create entity',
                'createEntity',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    destroyEntity(entity: Entity): void {
        this._validateWorldState('destroyEntity');
        this._validateEntity(entity, 'destroyEntity');

        try {
            const archetypeId = this._entityArchetypes.get(entity);
            if (!archetypeId) {
                return;
            }

            const archetype = this._archetypes.get(archetypeId);
            if (!archetype) {
                throw new EntityError('Archetype not found', entity, 'destroyEntity');
            }

            const removedComponents = archetype.removeEntity(entity);

            // Clear singleton cache for any singleton components being destroyed
            for (const componentName of Object.keys(removedComponents)) {
                const cached = this._singletonComponents.get(componentName);
                if (cached && cached.entity === entity) {
                    this._singletonComponents.delete(componentName);
                }
            }

            for (const [componentName, component] of Object.entries(removedComponents)) {
                try {
                    const pool = archetype.components.get(componentName);
                    if (pool && component) {
                        pool.release(component);
                    }
                } catch (error) {
                    console.warn(
                        `Failed to release component ${componentName} for entity ${entity}:`,
                        error
                    );
                }
            }

            this._entityArchetypes.delete(entity);
            this._freeEntities.push(entity);

            const actor = this._actorRegistry.get(entity);
            if (actor) {
                this._actorRegistry.delete(entity);
                this._safeEmitEvent('EntityDestroyed', { entity, actor });
            }

            if (this._enableMetrics) {
                this._lastUpdateTime = performance.now();
            }
        } catch (error) {
            throw new EntityError(
                'Failed to destroy entity',
                entity,
                'destroyEntity',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    addComponent<K extends keyof R>(
        entity: Entity,
        componentName: K,
        component?: ComponentInstance<R[K]>
    ): ComponentInstance<R[K]> {
        this._validateWorldState('addComponent');
        this._validateEntity(entity, 'addComponent');
        this._validateComponentName(componentName, 'addComponent');

        try {
            const componentConstructor = this._registry[componentName];
            const metadata =
                typeof componentConstructor === 'function'
                    ? getComponentMetadata(componentConstructor as any)
                    : undefined;

            if (metadata?.singleton) {
                const existingSingleton = this._singletonComponents.get(componentName as string);
                if (existingSingleton) {
                    if (existingSingleton.entity !== entity) {
                        throw new ComponentError(
                            `Singleton component '${String(componentName)}' already exists on entity ${existingSingleton.entity}`,
                            entity,
                            String(componentName),
                            'addComponent'
                        );
                    }
                    return existingSingleton.instance as ComponentInstance<R[K]>;
                }
            }

            const currentArchetypeId = this._entityArchetypes.get(entity);
            if (!currentArchetypeId) {
                throw new ComponentError(
                    'Entity not found',
                    entity,
                    String(componentName),
                    'addComponent'
                );
            }

            const currentArchetype = this._archetypes.get(currentArchetypeId);
            if (!currentArchetype) {
                throw new ComponentError(
                    'Current archetype not found',
                    entity,
                    String(componentName),
                    'addComponent'
                );
            }

            if (currentArchetype.signature.includes(componentName as string)) {
                const existingComponent = currentArchetype.getComponent(
                    entity,
                    componentName as string
                );
                if (existingComponent) {
                    return existingComponent as ComponentInstance<R[K]>;
                }
            }

            const newSignature = [...currentArchetype.signature, componentName as string].sort();
            const targetArchetype = this._getOrCreateArchetype(newSignature);

            const pool = targetArchetype.components.get(componentName as string);
            if (!pool) {
                throw new ComponentError(
                    'Component pool not found',
                    entity,
                    String(componentName),
                    'addComponent'
                );
            }

            const finalComponent = component || pool.acquire();

            const removedComponents = currentArchetype.removeEntity(entity);
            removedComponents[componentName as string] = finalComponent;
            targetArchetype.addEntity(entity, removedComponents);

            this._entityArchetypes.set(entity, targetArchetype.id);
            this._queryCache.invalidate();

            if (metadata?.singleton) {
                this._singletonComponents.set(componentName as string, {
                    entity,
                    instance: finalComponent,
                });
            }

            const actor = this._actorRegistry.get(entity);
            if (actor) {
                this._safeEmitEvent(`${componentName as string}Added` as any, {
                    entity,
                    component: finalComponent,
                    actor,
                });
            }

            if (this._enableMetrics) {
                this._lastUpdateTime = performance.now();
            }

            return finalComponent;
        } catch (error) {
            throw new ComponentError(
                'Failed to add component',
                entity,
                String(componentName),
                'addComponent',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    removeComponent<K extends keyof R>(entity: Entity, componentName: K): void {
        this._validateWorldState('removeComponent');
        this._validateEntity(entity, 'removeComponent');
        this._validateComponentName(componentName, 'removeComponent');

        try {
            const currentArchetypeId = this._entityArchetypes.get(entity);
            if (!currentArchetypeId) {
                return;
            }

            const currentArchetype = this._archetypes.get(currentArchetypeId);
            if (
                !currentArchetype ||
                !currentArchetype.signature.includes(componentName as string)
            ) {
                return;
            }

            const newSignature = currentArchetype.signature.filter(
                (name) => name !== (componentName as string)
            );
            const targetArchetype = this._getOrCreateArchetype(newSignature);

            const removedComponents = currentArchetype.removeEntity(entity);
            const removedComponent = removedComponents[componentName as string];
            delete removedComponents[componentName as string];

            targetArchetype.addEntity(entity, removedComponents);
            this._entityArchetypes.set(entity, targetArchetype.id);
            this._queryCache.invalidate();

            // Clear singleton cache if this was a singleton component
            const componentConstructor = this._registry[componentName];
            const metadata =
                typeof componentConstructor === 'function'
                    ? getComponentMetadata(componentConstructor as any)
                    : undefined;

            if (metadata?.singleton) {
                const cached = this._singletonComponents.get(componentName as string);
                if (cached && cached.entity === entity) {
                    this._singletonComponents.delete(componentName as string);
                }
            }

            const pool = currentArchetype.components.get(componentName as string);
            if (pool && removedComponent) {
                try {
                    pool.release(removedComponent);
                } catch (error) {
                    console.warn(`Failed to release component ${String(componentName)}:`, error);
                }
            }

            const actor = this._actorRegistry.get(entity);
            if (actor) {
                this._safeEmitEvent(`${componentName as string}Removed` as any, {
                    entity,
                    component: removedComponent,
                    actor,
                });
            }

            if (this._enableMetrics) {
                this._lastUpdateTime = performance.now();
            }
        } catch (error) {
            throw new ComponentError(
                'Failed to remove component',
                entity,
                String(componentName),
                'removeComponent',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    getComponent<K extends keyof R>(
        entity: Entity,
        componentName: K
    ): ComponentInstance<R[K]> | undefined {
        if (this._enableValidation) {
            this._validateWorldState('getComponent');
            this._validateEntity(entity, 'getComponent');
            this._validateComponentName(componentName, 'getComponent');
        }

        try {
            const archetypeId = this._entityArchetypes.get(entity);
            if (!archetypeId) {
                return undefined;
            }

            const archetype = this._archetypes.get(archetypeId);
            if (!archetype) {
                return undefined;
            }

            return archetype.getComponent(entity, componentName as string);
        } catch (error) {
            if (this._enableValidation) {
                console.warn(
                    `Failed to get component ${String(componentName)} for entity ${entity}:`,
                    error
                );
            }
            return undefined;
        }
    }

    hasComponent<K extends keyof R>(entity: Entity, componentName: K): boolean {
        return this.getComponent(entity, componentName) !== undefined;
    }

    /**
     * Gets a singleton component instance regardless of which entity owns it.
     * Returns undefined if the component is not a singleton or not registered.
     */
    getSingletonComponent<K extends keyof R>(
        componentName: K
    ): ComponentInstance<R[K]> | undefined {
        this._validateWorldState('getSingletonComponent');
        this._validateComponentName(componentName, 'getSingletonComponent');

        const cached = this._singletonComponents.get(componentName as string);
        if (!cached) {
            return undefined;
        }

        return this.getComponent(cached.entity, componentName);
    }

    /**
     * Gets the entity that owns a singleton component.
     * Returns undefined if the component is not a singleton or not registered.
     */
    getSingletonEntity<K extends keyof R>(componentName: K): Entity | undefined {
        this._validateComponentName(componentName, 'getSingletonEntity');

        const cached = this._singletonComponents.get(componentName as string);
        return cached?.entity;
    }

    query<Q extends readonly (keyof R)[]>(...components: Q): readonly QueryResult<R, Q>[] {
        this._validateWorldState('query');

        if (components.length === 0) {
            throw new WorldError('Query must specify at least one component', 'query');
        }

        try {
            if (this._enableMetrics) {
                this._queryCount++;
                this._lastUpdateTime = performance.now();
            }

            const queryKey = components.slice().sort().join(',');
            let matchingArchetypes = this._queryCache.getQuery(queryKey);

            if (!matchingArchetypes) {
                const queryMask = this._createBitMask(components as readonly string[]);
                matchingArchetypes = [];

                for (const archetype of this._archetypes.values()) {
                    if ((archetype.mask & queryMask) === queryMask) {
                        matchingArchetypes.push(archetype.id);
                    }
                }

                this._queryCache.setQuery(queryKey, matchingArchetypes);
            }

            const results: QueryResult<R, Q>[] = [];

            for (const archetypeId of matchingArchetypes) {
                const archetype = this._archetypes.get(archetypeId);
                if (!archetype) {
                    continue;
                }

                for (let i = 0; i < archetype.entityCount; i++) {
                    const entity = archetype.entities[i];
                    const componentData = {} as { [K in Q[number]]: ComponentInstance<R[K]> };

                    let hasAllComponents = true;
                    for (const componentName of components) {
                        const component = archetype.getComponent(entity, componentName as string);
                        if (component) {
                            componentData[componentName] = component as ComponentInstance<
                                R[typeof componentName]
                            >;
                        } else {
                            hasAllComponents = false;
                            break;
                        }
                    }

                    if (hasAllComponents) {
                        results.push({
                            entity,
                            components: componentData,
                        });
                    }
                }
            }

            return results;
        } catch (error) {
            throw new WorldError(
                'Query execution failed',
                'query',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    registerActor(entity: Entity, actor: Actor): void {
        this._validateWorldState('registerActor');
        this._validateEntity(entity, 'registerActor');

        if (!actor) {
            throw new EntityError('Actor cannot be null or undefined', entity, 'registerActor');
        }

        try {
            this._actorRegistry.set(entity, actor);
            this._safeEmitEvent('EntityCreated', { entity, actor });
        } catch (error) {
            throw new EntityError(
                'Failed to register actor',
                entity,
                'registerActor',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    unregisterActor(entity: Entity): void {
        if (this._state === 'disposed') {
            return;
        }

        const actor = this._actorRegistry.get(entity);
        if (actor) {
            this._actorRegistry.delete(entity);
        }
    }

    getActor(entity: Entity): Actor | undefined {
        return this._actorRegistry.get(entity);
    }

    getAllEntities(): readonly Entity[] {
        this._validateWorldState('getAllEntities');
        return Array.from(this._entityArchetypes.keys());
    }

    getAllActors(): readonly Actor[] {
        this._validateWorldState('getAllActors');
        return Array.from(this._actorRegistry.values());
    }

    getEntityCount(): number {
        return this._entityArchetypes.size;
    }

    getArchetypeCount(): number {
        return this._archetypes.size;
    }

    registerComponentType<T extends ComponentConstructor>(componentType: T): void {
        this._validateWorldState('registerComponentType');

        if (typeof componentType !== 'function' || componentType.name.trim().length === 0) {
            throw new WorldError(
                'Component type must be a named constructor',
                'registerComponentType'
            );
        }

        const componentName = componentType.name;
        const registry = this._registry as Record<string, ComponentConstructor>;
        const existing = registry[componentName];

        if (existing !== undefined) {
            if (existing !== componentType) {
                throw new WorldError(
                    `Component '${componentName}' is already registered with a different constructor`,
                    'registerComponentType'
                );
            }

            return;
        }

        registry[componentName] = componentType;
        this._componentMask.set(componentName, this._componentMask.size);
        this._registerComponentEventBridge(componentName);
        this._queryCache.invalidate();
    }

    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean {
        const componentName =
            typeof componentTypeOrName === 'string'
                ? componentTypeOrName
                : componentTypeOrName.name;

        return componentName in this._registry;
    }

    getRegisteredComponentNames(): readonly string[] {
        return Object.keys(this._registry);
    }

    on<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler: (data: ECSEventMap<R>[T]) => void
    ): () => void {
        this._validateWorldState('on');

        if (!event || typeof event !== 'string') {
            throw new WorldError('Event name must be a non-empty string', 'on');
        }

        if (typeof handler !== 'function') {
            throw new WorldError('Event handler must be a function', 'on');
        }

        try {
            const unsubscribe = this._eventBus.on(event, handler);
            this._disposables.add(unsubscribe);

            return () => {
                unsubscribe();
                this._disposables.delete(unsubscribe);
            };
        } catch (error) {
            throw new WorldError(
                'Failed to subscribe to event',
                'on',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    once<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler: (data: ECSEventMap<R>[T]) => void
    ): () => void {
        this._validateWorldState('once');

        try {
            const unsubscribe = this._eventBus.once(event, handler);
            this._disposables.add(unsubscribe);

            return () => {
                unsubscribe();
                this._disposables.delete(unsubscribe);
            };
        } catch (error) {
            throw new WorldError(
                'Failed to subscribe to event once',
                'once',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    async emit<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        data: ECSEventMap<R>[T]
    ): Promise<boolean> {
        this._validateWorldState('emit');

        try {
            if (this._enableMetrics) {
                this._eventCount++;
            }

            return await this._eventBus.emit(event, data);
        } catch (error) {
            console.error(`Failed to emit event ${String(event)}:`, error);
            return false;
        }
    }

    emitSync<T extends EventKey<ECSEventMap<R>>>(event: T, data: ECSEventMap<R>[T]): boolean {
        this._validateWorldState('emitSync');

        try {
            if (this._enableMetrics) {
                this._eventCount++;
            }

            return this._eventBus.emitSync(event, data);
        } catch (error) {
            console.error(`Failed to emit sync event ${String(event)}:`, error);
            return false;
        }
    }

    off<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        handler?: (data: ECSEventMap<R>[T]) => void
    ): boolean {
        try {
            return this._eventBus.off(event, handler);
        } catch (error) {
            console.error(`Failed to unsubscribe from event ${String(event)}:`, error);
            return false;
        }
    }

    getEventMetrics<T extends EventKey<ECSEventMap<R>>>(event: T) {
        try {
            return this._eventBus.getMetrics(event);
        } catch (error) {
            console.error(`Failed to get event metrics for ${String(event)}:`, error);
            return undefined;
        }
    }

    getAllEventMetrics() {
        try {
            const allMetrics: Record<string, any> = {};
            const eventNames = this._eventBus.eventNames();

            for (const eventName of eventNames) {
                try {
                    allMetrics[eventName] = this._eventBus.getMetrics(eventName);
                } catch (error) {
                    console.warn(`Failed to get metrics for event ${eventName}:`, error);
                }
            }

            return allMetrics;
        } catch (error) {
            console.error('Failed to get all event metrics:', error);
            return {};
        }
    }

    pauseEvents(): void {
        try {
            this._eventBus.pause();
        } catch (error) {
            console.error('Failed to pause events:', error);
        }
    }

    resumeEvents(): void {
        try {
            this._eventBus.resume();
        } catch (error) {
            console.error('Failed to resume events:', error);
        }
    }

    async drainEvents(): Promise<void> {
        try {
            return await this._eventBus.drain();
        } catch (error) {
            console.error('Failed to drain events:', error);
        }
    }

    getObservables(): ECSObservables<R> {
        this._validateWorldState('getObservables');
        return this._observables;
    }

    observeEntityLifecycle() {
        this._validateWorldState('observeEntityLifecycle');
        return this._observables.createEntityLifecycle();
    }

    observeComponent<K extends keyof R>(componentName: K) {
        this._validateWorldState('observeComponent');
        this._validateComponentName(componentName, 'observeComponent');
        return this._observables.createComponentStream(componentName);
    }

    createReactiveQuery<Q extends readonly (keyof R)[]>(...components: Q) {
        this._validateWorldState('createReactiveQuery');

        try {
            const queryKey = components.slice().sort().join(',');
            const queryObservable = this._observables.getQueryObservable(queryKey);

            const updateQuery = () => {
                try {
                    const results = this.query(...components);
                    queryObservable.notify([...results]);
                } catch (error) {
                    console.error('Failed to update reactive query:', error);
                }
            };

            const unsubscribes: (() => void)[] = [];

            for (const componentName of components) {
                unsubscribes.push(
                    this._eventBus.on(`${componentName as string}Added` as any, updateQuery),
                    this._eventBus.on(`${componentName as string}Removed` as any, updateQuery)
                );
            }

            unsubscribes.push(
                this._eventBus.on('EntityCreated', updateQuery),
                this._eventBus.on('EntityDestroyed', updateQuery)
            );

            for (const unsubscribe of unsubscribes) {
                this._disposables.add(unsubscribe);
            }

            updateQuery();

            return queryObservable;
        } catch (error) {
            throw new WorldError(
                'Failed to create reactive query',
                'createReactiveQuery',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    clear(): void {
        if (this._state === 'disposed') {
            return;
        }

        try {
            this._state = 'disposing';

            const entitiesToDestroy = Array.from(this._entityArchetypes.keys());

            for (const entity of entitiesToDestroy) {
                try {
                    const archetypeId = this._entityArchetypes.get(entity);
                    if (archetypeId) {
                        const archetype = this._archetypes.get(archetypeId);
                        if (archetype) {
                            archetype.removeEntity(entity);
                        }
                        this._entityArchetypes.delete(entity);
                    }
                } catch (error) {
                    console.error(`Failed to destroy entity ${entity} during clear:`, error);
                }
            }

            this._archetypes.clear();
            this._entityArchetypes.clear();
            this._actorRegistry.clear();
            this._queryCache.invalidate();
            this._freeEntities.length = 0;
            this._nextEntityId = 1;

            try {
                this._eventBus.dispose();
            } catch (error) {
                console.error('Failed to dispose event bus:', error);
            }

            try {
                this._observables.dispose();
            } catch (error) {
                console.error('Failed to dispose observables:', error);
            }

            for (const dispose of this._disposables) {
                try {
                    dispose();
                } catch (error) {
                    console.error('Failed to execute disposal task:', error);
                }
            }
            this._disposables.clear();

            this._emptyArchetypeId = this._getOrCreateArchetype([]).id;

            this._state = 'disposed';
        } catch (error) {
            console.error('Failed to clear world:', error);
            this._state = 'disposed';
        }
    }

    private _createComponentMask(): ComponentMask {
        const mask = new Map<string, number>();
        let bit = 0;

        for (const componentName of Object.keys(this._registry)) {
            mask.set(componentName, bit++);
        }

        return mask;
    }

    private _createBitMask(components: readonly string[]): BitMask {
        let mask = 0n;

        for (const componentName of components) {
            const bit = this._componentMask.get(componentName);
            if (bit !== undefined) {
                mask |= 1n << BigInt(bit);
            }
        }

        return mask;
    }

    private _setupEventObserverBridge(): void {
        try {
            this._eventBus.on('EntityCreated', (data) => {
                try {
                    this._observables.entityCreated.notify(data);
                } catch (error) {
                    console.error('Failed to notify entity created:', error);
                }
            });

            this._eventBus.on('EntityDestroyed', (data) => {
                try {
                    this._observables.entityDestroyed.notify(data);
                } catch (error) {
                    console.error('Failed to notify entity destroyed:', error);
                }
            });

            for (const componentName of Object.keys(this._registry)) {
                this._registerComponentEventBridge(componentName);
            }
        } catch (error) {
            throw new WorldError(
                'Failed to setup event-observer bridge',
                '_setupEventObserverBridge',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }


    private _registerComponentEventBridge(componentName: string): void {
        this._eventBus.on(`${componentName}Added` as any, (data) => {
            try {
                const observables = this._observables.getComponentObservables(
                    componentName as keyof R
                );
                observables.added.notify(data);
            } catch (error) {
                console.error(`Failed to notify ${componentName} added:`, error);
            }
        });

        this._eventBus.on(`${componentName}Removed` as any, (data) => {
            try {
                const observables = this._observables.getComponentObservables(
                    componentName as keyof R
                );
                observables.removed.notify(data);
            } catch (error) {
                console.error(`Failed to notify ${componentName} removed:`, error);
            }
        });
    }
    private _getOrCreateArchetype(signature: readonly string[]): Archetype<R> {
        try {
            const sortedSignature = signature.slice().sort();
            const id = (
                sortedSignature.length === 0 ? 'EMPTY' : sortedSignature.join('|')
            ) as ArchetypeId;

            let archetype = this._archetypes.get(id);
            if (!archetype) {
                const mask = this._createBitMask(sortedSignature);
                archetype = new Archetype(
                    sortedSignature,
                    mask,
                    this._registry,
                    this._componentMask
                );
                this._archetypes.set(id, archetype);
                this._queryCache.invalidate();
            }

            return archetype;
        } catch (error) {
            throw new WorldError(
                'Failed to get or create archetype',
                '_getOrCreateArchetype',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    private _validateWorldState(operation: string): void {
        if (this._state === 'disposed') {
            throw new WorldError('World is disposed', operation);
        }

        if (this._state !== 'ready') {
            throw new WorldError(`World is not ready (current state: ${this._state})`, operation);
        }
    }

    private _validateEntity(entity: Entity, operation: string): void {
        if (!this._enableValidation) {
            return;
        }

        if (entity === null || entity === undefined) {
            throw new EntityError('Entity cannot be null or undefined', entity, operation);
        }

        if (typeof entity !== 'number' || !Number.isInteger(entity) || entity <= 0) {
            throw new EntityError('Entity must be a positive integer', entity, operation);
        }
    }

    private _validateComponentName<K extends keyof R>(componentName: K, operation: string): void {
        if (!this._enableValidation) {
            return;
        }

        if (!componentName || typeof componentName !== 'string') {
            throw new WorldError('Component name must be a non-empty string', operation);
        }

        if (!(componentName in this._registry)) {
            throw new WorldError(
                `Component '${String(componentName)}' not found in registry`,
                operation
            );
        }
    }

    private _safeEmitEvent<T extends EventKey<ECSEventMap<R>>>(
        event: T,
        data: ECSEventMap<R>[T]
    ): void {
        try {
            this._eventBus.emitSync(event, data);

            if (this._enableMetrics) {
                this._eventCount++;
            }
        } catch (error) {
            console.error(`Failed to emit event ${String(event)}:`, error);
        }
    }

    private _calculateMemoryUsage(): number {
        try {
            let totalSize = 0;

            totalSize += 1000;

            totalSize += this._entityArchetypes.size * 50;
            totalSize += this._actorRegistry.size * 100;
            totalSize += this._freeEntities.length * 10;

            totalSize += this._archetypes.size * 500;

            totalSize += this._componentMask.size * 20;

            totalSize += 200;

            totalSize += 300;

            return totalSize;
        } catch (error) {
            console.error('Failed to calculate memory usage:', error);
            return 0;
        }
    }

    toString(): string {
        return `World(${this._state}) [Entities: ${this.getEntityCount()}, Archetypes: ${this.getArchetypeCount()}]`;
    }

    getDebugInfo(): Record<string, any> {
        return {
            state: this._state,
            creationTime: this._creationTime,
            lastUpdateTime: this._lastUpdateTime,
            config: this._config,
            entityCount: this.getEntityCount(),
            archetypeCount: this.getArchetypeCount(),
            freeEntityCount: this._freeEntities.length,
            nextEntityId: this._nextEntityId,
            componentTypes: Object.keys(this._registry),
            metrics: this.metrics,
            archetypes: Array.from(this._archetypes.entries()).map(([id, archetype]) => ({
                id,
                signature: archetype.signature,
                entityCount: archetype.entityCount,
                mask: archetype.mask.toString(2),
            })),
            queryCache: {
                enabled: true,
                invalidated: false,
            },
        };
    }
}

export type { WorldConfig, WorldMetrics };
