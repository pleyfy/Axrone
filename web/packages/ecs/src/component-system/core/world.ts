import type {
    ComponentRegistry,
    Entity,
    ComponentInstance,
    ComponentConstructor,
} from '../types/core';
import type { QueryResult } from '../types/system';
import type { EventKey } from '../../support/event';
import type { ECSObservables } from '../observers/ecs-observer';
import { OptimizedQueryCache } from '../archetype/query-cache';
import { getComponentMetadata } from '../decorators/script';
import type { ECSEventMap } from '../types/events';
import type { Actor } from './actor';
import { WorldActorRegistry } from './world-actor-registry';
import { WorldDiagnostics, type WorldMetrics } from './world-diagnostics';
import { WorldEventRuntime } from './world-event-runtime';
import { WorldMutationRuntime } from './world-mutation-runtime';
import { WorldQueryRuntime } from './world-query-runtime';
import { WorldSingletonRegistry } from './world-singleton-registry';
import { WorldStorageRuntime } from './world-storage-runtime';

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

interface WorldConfig {
    readonly maxEntities?: number;
    readonly enableMetrics?: boolean;
    readonly enableValidation?: boolean;
    readonly enableEventBatching?: boolean;
    readonly cacheSize?: number;
}

export class World<R extends ComponentRegistry> {
    private readonly _registry: R;
    private readonly _storage: WorldStorageRuntime<R>;
    private readonly _queryCache: OptimizedQueryCache;
    private readonly _queryRuntime: WorldQueryRuntime<R>;
    private readonly _events: WorldEventRuntime<R>;
    private readonly _actorRegistry = new WorldActorRegistry();
    private readonly _mutations: WorldMutationRuntime<R>;
    private readonly _singletonRegistry = new WorldSingletonRegistry();

    private _state: WorldState = 'initializing';
    private readonly _config: Required<WorldConfig>;
    private readonly _diagnostics: WorldDiagnostics;
    private readonly _enableValidation: boolean;
    private _structureBatchDepth = 0;
    private _structureChangedDuringBatch = false;

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
        this._diagnostics = new WorldDiagnostics(this._config.enableMetrics);
        this._enableValidation = this._config.enableValidation;

        try {
            this._storage = new WorldStorageRuntime(this._registry);
            this._queryCache = new OptimizedQueryCache();
            this._queryRuntime = new WorldQueryRuntime({
                cache: this._queryCache,
                getArchetypes: () => this._storage.getArchetypes(),
                createBitMask: (components) => this._storage.createBitMask(components),
            });
            this._events = new WorldEventRuntime(
                Object.keys(this._registry),
                (...components) => this.query(...(components as readonly (keyof R)[]))
            );
            this._mutations = new WorldMutationRuntime({
                registry: this._registry,
                storage: this._storage,
                actorRegistry: this._actorRegistry,
                singletonRegistry: this._singletonRegistry,
                emitEvent: (event, data) => this._safeEmitEvent(event, data),
                onMutation: () => this._diagnostics.markMutation(),
                onStructureChange: () => this._invalidateStructureCaches(),
            });

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
        return this._diagnostics.getMetrics({
            entityCount: this._storage.entityCount,
            archetypeCount: this._storage.archetypeCount,
            actorCount: this._actorRegistry.size,
            freeEntityCount: this._storage.freeEntityCount,
            componentTypes: Object.keys(this._registry),
        });
    }

    batchStructureChanges<T>(callback: () => T): T {
        this._validateWorldState('batchStructureChanges');
        this._structureBatchDepth += 1;

        try {
            return callback();
        } finally {
            this._structureBatchDepth -= 1;

            if (this._structureBatchDepth === 0 && this._structureChangedDuringBatch) {
                this._queryCache.invalidate();
                this._structureChangedDuringBatch = false;
            }
        }
    }

    createEntity(): Entity {
        this._validateWorldState('createEntity');

        if (this._storage.entityCount >= this._config.maxEntities) {
            throw new WorldError(
                `Maximum entity limit (${this._config.maxEntities}) reached`,
                'createEntity'
            );
        }

        try {
            return this._mutations.createEntity();
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
            this._mutations.destroyEntity(entity);
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
            return this._mutations.addComponent(entity, componentName, component);
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
            this._mutations.removeComponent(entity, componentName);
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
            return this._storage.getComponent(entity, componentName as string);
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

        const cached = this._singletonRegistry.get(componentName as string);
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

        return this._singletonRegistry.getEntity(componentName as string);
    }

    query<Q extends readonly (keyof R)[]>(...components: Q): readonly QueryResult<R, Q>[] {
        this._validateWorldState('query');

        if (components.length === 0) {
            throw new WorldError('Query must specify at least one component', 'query');
        }

        try {
            this._diagnostics.recordQuery();
            const matchingArchetypes = this._queryRuntime.resolveMatchingArchetypes(
                components as readonly string[]
            );

            const results: QueryResult<R, Q>[] = [];

            for (const archetypeId of matchingArchetypes) {
                const archetype = this._storage.getArchetype(archetypeId);
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
            this._mutations.registerActor(entity, actor);
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

        this._mutations.unregisterActor(entity);
    }

    getActor(entity: Entity): Actor | undefined {
        return this._actorRegistry.get(entity);
    }

    getAllEntities(): readonly Entity[] {
        this._validateWorldState('getAllEntities');
        return this._storage.getAllEntities();
    }

    getAllActors(): readonly Actor[] {
        this._validateWorldState('getAllActors');
        return this._actorRegistry.getAll();
    }

    getEntityCount(): number {
        return this._storage.entityCount;
    }

    getArchetypeCount(): number {
        return this._storage.archetypeCount;
    }

    registerComponentType<T extends ComponentConstructor>(componentType: T): void {
        this._validateWorldState('registerComponentType');

        if (typeof componentType !== 'function' || componentType.name.trim().length === 0) {
            throw new WorldError(
                'Component type must be a named constructor',
                'registerComponentType'
            );
        }

        const componentName = getComponentMetadata(componentType)?.scriptName ?? componentType.name;
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
        this._mutations.registerComponentType(componentName, componentType);
        this._events.registerComponent(componentName);
    }

    isComponentRegistered(componentTypeOrName: string | ComponentConstructor): boolean {
        const componentName =
            typeof componentTypeOrName === 'string'
                ? componentTypeOrName
                : getComponentMetadata(componentTypeOrName)?.scriptName ?? componentTypeOrName.name;

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
            return this._events.on(event, handler);
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
            return this._events.once(event, handler);
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
            this._diagnostics.recordEvent();

            return await this._events.emit(event, data);
        } catch (error) {
            console.error(`Failed to emit event ${String(event)}:`, error);
            return false;
        }
    }

    emitSync<T extends EventKey<ECSEventMap<R>>>(event: T, data: ECSEventMap<R>[T]): boolean {
        this._validateWorldState('emitSync');

        try {
            this._diagnostics.recordEvent();

            return this._events.emitSync(event, data);
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
            return this._events.off(event, handler);
        } catch (error) {
            console.error(`Failed to unsubscribe from event ${String(event)}:`, error);
            return false;
        }
    }

    getEventMetrics<T extends EventKey<ECSEventMap<R>>>(event: T) {
        try {
            return this._events.getEventMetrics(event);
        } catch (error) {
            console.error(`Failed to get event metrics for ${String(event)}:`, error);
            return undefined;
        }
    }

    getAllEventMetrics() {
        try {
            return this._events.getAllEventMetrics();
        } catch (error) {
            console.error('Failed to get all event metrics:', error);
            return {};
        }
    }

    pauseEvents(): void {
        try {
            this._events.pause();
        } catch (error) {
            console.error('Failed to pause events:', error);
        }
    }

    resumeEvents(): void {
        try {
            this._events.resume();
        } catch (error) {
            console.error('Failed to resume events:', error);
        }
    }

    async drainEvents(): Promise<void> {
        try {
            return await this._events.drain();
        } catch (error) {
            console.error('Failed to drain events:', error);
        }
    }

    getObservables(): ECSObservables<R> {
        this._validateWorldState('getObservables');
        return this._events.getObservables();
    }

    observeEntityLifecycle() {
        this._validateWorldState('observeEntityLifecycle');
        return this._events.observeEntityLifecycle();
    }

    observeComponent<K extends keyof R>(componentName: K) {
        this._validateWorldState('observeComponent');
        this._validateComponentName(componentName, 'observeComponent');
        return this._events.observeComponent(componentName);
    }

    createReactiveQuery<Q extends readonly (keyof R)[]>(...components: Q) {
        this._validateWorldState('createReactiveQuery');

        try {
            return this._events.createReactiveQuery(...components);
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
            this._actorRegistry.clear();
            this._singletonRegistry.clear();
            this._queryCache.invalidate();
            this._storage.reset();

            try {
                this._events.dispose();
            } catch (error) {
                console.error('Failed to dispose world event runtime:', error);
            }

            this._state = 'disposed';
        } catch (error) {
            console.error('Failed to clear world:', error);
            this._state = 'disposed';
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
        this._events.emitSafe(event, data);
        this._diagnostics.recordEvent();
    }

    private _invalidateStructureCaches(): void {
        if (this._structureBatchDepth > 0) {
            this._structureChangedDuringBatch = true;
            return;
        }

        this._queryCache.invalidate();
    }

    toString(): string {
        return `World(${this._state}) [Entities: ${this.getEntityCount()}, Archetypes: ${this.getArchetypeCount()}]`;
    }

    getDebugInfo(): Record<string, any> {
        const storage = this._storage.getDebugInfo();

        return this._diagnostics.getDebugInfo({
            state: this._state,
            config: this._config,
            entityCount: this.getEntityCount(),
            archetypeCount: this.getArchetypeCount(),
            actorCount: this._actorRegistry.size,
            freeEntityCount: storage.freeEntityCount,
            nextEntityId: storage.nextEntityId,
            componentTypes: Object.keys(this._registry),
            archetypes: storage.archetypes,
        });
    }
}

export type { WorldConfig, WorldMetrics };
