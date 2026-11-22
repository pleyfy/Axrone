import type { Brand } from '@axrone/utility';
import type { Entity, ActorId } from '../types/core';
import type { ComponentType, ComponentMetadata } from '../types/component';
import type { World } from './world';
import { Component, getComponentMetadata } from './component';
import { Hierarchy } from '../components/hierarchy';
import { Transform } from '../components/transform';
import type { RenderMutationClock } from './render-mutation-clock';
import { getCreationTimestamp } from './creation-clock';

const getComponentTypeName = (componentType: ComponentType): string =>
    getComponentMetadata(componentType)?.scriptName ?? componentType.name;

export interface EventBus<T extends string = string> {
    emit(eventType: T, data: unknown): void;
    on(eventType: T, handler: (data: unknown) => void): () => void;
}

export type ActorState = 'initializing' | 'active' | 'inactive' | 'destroying' | 'destroyed';
export type ActorLayer = Brand<number, 'ActorLayer'>;
export type ActorTag = Brand<string, 'ActorTag'>;

export class ActorError extends Error {
    constructor(
        message: string,
        public readonly actorId: ActorId,
        public readonly operation: string,
        public readonly cause?: Error
    ) {
        super(`[Actor:${actorId}] ${operation}: ${message}`);
        this.name = 'ActorError';
        if (cause) {
            this.stack += `\nCaused by: ${cause.stack}`;
        }
    }
}

export class ComponentError extends ActorError {
    constructor(
        message: string,
        actorId: ActorId,
        public readonly componentType: string,
        cause?: Error
    ) {
        super(message, actorId, `Component[${componentType}]`, cause);
        this.name = 'ComponentError';
    }
}

type ComponentInstance<T> = T extends ComponentType<infer U> ? U : never;
type ComponentTuple<T extends readonly ComponentType[]> = {
    readonly [K in keyof T]: ComponentInstance<T[K]>;
};

export interface ActorConfig {
    readonly name?: string;
    readonly layer?: ActorLayer;
    readonly tag?: ActorTag;
    readonly active?: boolean;
    readonly persistent?: boolean;
    readonly pooled?: boolean;
    readonly maxComponents?: number;
    readonly enableMetrics?: boolean;
    readonly autoStart?: boolean;
}

/**
 * A fully constructed component plus its registry name, for the preloaded
 * component paths (`createWithComponents`, `createManyWithComponents`).
 */
export interface ActorComponentEntry {
    readonly componentType: ComponentType<Component>;
    readonly component: Component;
    readonly componentName?: string;
    readonly metadata?: ComponentMetadata;
}

type ActorPreloadedComponentEntry = ActorComponentEntry;

const FINALIZE_FLAG_ON_LOAD = 1;
const FINALIZE_FLAG_START = 2;
const FINALIZE_FLAG_ENABLE = 4;
const FINALIZE_FLAG_EMIT = 8;

/**
 * Scratch arrays for the preloaded-components finalize pass. Creating one
 * record object per attached component meant ~150k short-lived objects for a
 * 50k-actor bulk build; parallel scratch arrays reused across actors collapse
 * that to zero. Lifecycle hooks can attach components re-entrantly, so the
 * scratch is guarded and a nested call falls back to its own arrays.
 */
const finalizeComponentsScratch: Component[] = [];
const finalizeFlagsScratch: number[] = [];
const finalizeNamesScratch: string[] = [];
let finalizeScratchInUse = false;

interface ActorInternalConfig extends ActorConfig {
    readonly entity?: Entity;
    readonly skipCoreComponents?: boolean;
    readonly preloadedComponents?: readonly ActorPreloadedComponentEntry[];
}

export class Actor<
    TWorld extends World<any> = World<any>,
    TComponents extends readonly ComponentType[] = readonly ComponentType[],
> {
    private static readonly _componentMetadataMap = new WeakMap<ComponentType, ComponentMetadata>();
    private static _nextActorId = 1;

    public readonly entity: Entity;
    public readonly world: TWorld;
    public readonly creationTime: number;

    /**
     * Actor id is materialized on first read. Bulk creation assigns the global
     * sequence eagerly (uniqueness) but skips the template string unless
     * someone asks — 50k-sprite scenes that never read actor ids during setup
     * allocate nothing. The value is identical either way.
     */
    private _idValue: ActorId | null = null;
    private readonly _idSequence: number;
    private readonly _nameAtCreation: string;

    get id(): ActorId {
        if (this._idValue === null) {
            this._idValue = `${this._nameAtCreation}_${String(this.entity)}_${String(
                this._idSequence
            )}` as ActorId;
        }
        return this._idValue;
    }

    private _state: ActorState = 'initializing';
    private _name: string;
    private _active: boolean;
    private _layer: ActorLayer;
    private _tag: ActorTag;
    private _persistent: boolean;
    private _pooled: boolean;

    private readonly _components = new Map<ComponentType, Component>();
    /**
     * Dependency bookkeeping is lazily allocated: scenes that declare no
     * component dependencies never pay a Map per actor.
     */
    private _componentDependencies: Map<ComponentType, Set<ComponentType>> | null = null;
    private readonly _componentPriorities = new Map<ComponentType, number>();
    private readonly _maxComponents: number;
    /**
     * Priority-ordered component lists reused by every lifecycle phase, kept
     * as two parallel arrays so revalidating the order allocates no pair
     * tuples. The component set changes rarely, so rebuilding these on each
     * `start` / `update` / `destroy` would be pure allocation churn.
     */
    private _sortedComponentTypes: ComponentType[] | null = null;
    private _sortedComponentList: Component[] | null = null;

    private _started = false;
    private _destroyed = false;
    /** Monotonic revision for render-cache invalidation; not serialized. */
    private _revision = 0;
    /**
     * The world's render-mutation clock. Cached per actor so attaching a
     * component and bumping on actor-level changes cost one field access
     * instead of a world lookup.
     */
    private readonly _renderClock: RenderMutationClock | null;

    private readonly _eventBus: EventBus | null;
    private _eventSubscriptions: Set<() => void> | null = null;
    private _indexChangeHandler:
        | ((kind: 'tag' | 'layer', oldValue: string | number, newValue: string | number) => void)
        | null = null;

    private _cleanupTasks: Set<() => void> | null = null;
    private _updateFrame = 0;

    constructor(world: TWorld, config: ActorConfig = {}) {
        if (!world || typeof world !== 'object') {
            throw new ActorError('Invalid world instance provided', '' as ActorId, 'constructor');
        }

        const internalConfig = config as ActorInternalConfig;

        this.world = world;
        this._renderClock =
            (world as unknown as { renderMutationClock?: RenderMutationClock })
                .renderMutationClock ?? null;
        this.entity = internalConfig.entity ?? world.createEntity();
        this.creationTime = getCreationTimestamp();

        this._name = config.name ?? 'Actor';
        this._nameAtCreation = this._name;
        this._idSequence = Actor._nextActorId++;
        this._active = config.active ?? true;
        this._layer = (config.layer ?? 0) as ActorLayer;
        this._tag = (config.tag ?? 'Default') as ActorTag;
        this._persistent = config.persistent ?? false;
        this._pooled = config.pooled ?? false;
        this._maxComponents = (config.maxComponents ?? 64) + 1;

        this._eventBus = (world as any).eventBus || null;

        try {
            world.registerActor(this.entity, this);

            if (internalConfig.preloadedComponents?.length) {
                this._initializePreloadedComponents(internalConfig.preloadedComponents);
            }

            if (!internalConfig.skipCoreComponents) {
                this._initializeCoreComponents();
            }

            this._state = 'active';

            if (config.autoStart !== false) {
                this.start();
            }
        } catch (error) {
            this._state = 'destroyed';
            throw new ActorError(
                'Failed to initialize actor',
                this.id,
                'constructor',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    static setComponentMetadata<T extends Component>(
        componentType: ComponentType<T>,
        metadata: ComponentMetadata
    ): void {
        Actor._componentMetadataMap.set(componentType, metadata);
    }

    static getComponentMetadata<T extends Component>(
        componentType: ComponentType<T>
    ): ComponentMetadata | undefined {
        return Actor._componentMetadataMap.get(componentType);
    }

    static createWithComponents<TWorld extends World<any> = World<any>>(
        world: TWorld,
        config: ActorConfig,
        components: readonly ActorPreloadedComponentEntry[]
    ): Actor<TWorld> {
        const componentMap: Record<string, Component> = {};

        for (const entry of components) {
            componentMap[entry.componentName ?? getComponentTypeName(entry.componentType)] =
                entry.component;
        }

        const entity = world.createEntityWithComponents(componentMap);

        return new Actor(world, {
            ...config,
            entity,
            skipCoreComponents: true,
            preloadedComponents: components,
        } as ActorConfig) as Actor<TWorld>;
    }

    /**
     * Creates many actors whose component sets share one signature, resolving
     * that signature's archetype once for the whole batch.
     *
     * Semantics match creating each actor with `createWithComponents`: the
     * components are the caller's own instances (so lifecycle, identity and
     * per-actor configuration are preserved), `EntityCreated` fires per actor,
     * and the `…Added` events that `addComponent` would emit are emitted
     * afterwards for components that have subscribers.
     *
     * All sets must use the same component names; a mismatch throws before any
     * entity is created.
     */
    static createManyWithComponents<TWorld extends World<any> = World<any>>(
        world: TWorld,
        configs: readonly ActorConfig[],
        componentsPerActor: readonly (readonly ActorComponentEntry[])[]
    ): Actor<TWorld>[] {
        const count = configs.length;
        if (componentsPerActor.length !== count) {
            throw new ActorError(
                'Bulk actor creation requires one component set per actor config',
                '' as ActorId,
                'createManyWithComponents'
            );
        }
        if (count === 0) {
            return [];
        }

        // Announce component attachment only when someone observes the events;
        // otherwise the whole batch stays free of per-actor payload work and
        // free of a names array per actor (50k arrays in a bulk sprite build).
        const resolveName = (entry: ActorComponentEntry): string =>
            entry.componentName ?? getComponentTypeName(entry.componentType);

        const firstEntries = componentsPerActor[0]!;
        let announceComponents = false;
        for (let index = 0; index < firstEntries.length; index += 1) {
            if (world.hasEventSubscribers(`${resolveName(firstEntries[index]!)}Added`)) {
                announceComponents = true;
                break;
            }
        }

        const componentMaps = new Array<Record<string, Component>>(count);
        const componentNames: string[][] | null = announceComponents
            ? new Array<string[]>(count)
            : null;
        for (let index = 0; index < count; index += 1) {
            const entries = componentsPerActor[index]!;
            const map: Record<string, Component> = {};
            if (componentNames !== null) {
                const names = new Array<string>(entries.length);
                for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
                    const entry = entries[entryIndex]!;
                    const name = resolveName(entry);
                    map[name] = entry.component;
                    names[entryIndex] = name;
                }
                componentNames[index] = names;
            } else {
                for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
                    const entry = entries[entryIndex]!;
                    map[resolveName(entry)] = entry.component;
                }
            }
            componentMaps[index] = map;
        }

        const entities = world.createEntitiesWithComponentsBulk(componentMaps);
        const actors = new Array<Actor<TWorld>>(count);

        for (let index = 0; index < count; index += 1) {
            const entries = componentsPerActor[index]!;
            const actor = new Actor(world, {
                ...configs[index],
                entity: entities[index],
                skipCoreComponents: true,
                preloadedComponents: entries,
            } as ActorConfig) as Actor<TWorld>;
            actors[index] = actor;

            if (announceComponents) {
                world.notifyComponentsAttached(
                    entities[index]!,
                    actor,
                    componentNames![index]!,
                    entries
                );
            }
        }

        return actors;
    }

    /**
     * Monotonic render-relevant revision. Incremented when the actor or its
     * component set changes in a way that can affect rendering.
     */
    get revision(): number {
        return this._revision;
    }

    private _touchRevision(): void {
        this._revision = (this._revision + 1) >>> 0;

        const clock = this._renderClock;
        if (clock !== null) {
            clock.value = (clock.value + 1) >>> 0;
        }
    }

    get name(): string {
        return this._name;
    }

    set name(value: string) {
        if (this._destroyed) {
            throw new ActorError('Cannot modify destroyed actor', this.id, 'setName');
        }

        if (!value || typeof value !== 'string' || value.trim().length === 0) {
            throw new ActorError('Actor name must be a non-empty string', this.id, 'setName');
        }

        const oldName = this._name;
        this._name = value.trim();

        this._emitEvent('actor:nameChanged', { oldName, newName: this._name });
    }

    get active(): boolean {
        return this._active && this._state === 'active';
    }

    set active(value: boolean) {
        if (this._destroyed) {
            throw new ActorError('Cannot modify destroyed actor', this.id, 'setActive');
        }

        const wasActive = this._active;
        this._active = value;
        this._state = value ? 'active' : 'inactive';

        if (wasActive !== value) {
            this._touchRevision();
        }

        if (wasActive !== value) {
            try {
                const sortedTypes = this._resolveSortedComponents();
                const sortedComponents = this._sortedComponentList!;

                for (let componentIndex = 0; componentIndex < sortedTypes.length; componentIndex += 1) {
                    const componentType = sortedTypes[componentIndex]!;
                    const component = sortedComponents[componentIndex]!;
                    try {
                        if (value && component.onEnable) {
                            component.onEnable();
                        } else if (!value && component.onDisable) {
                            component.onDisable();
                        }
                    } catch (error) {
                        console.error(
                            new ComponentError(
                                `Failed to ${value ? 'enable' : 'disable'} component`,
                                this.id,
                                componentType.name,
                                error instanceof Error ? error : new Error(String(error))
                            )
                        );
                    }
                }

                this._emitEvent('actor:activeChanged', { active: value, wasActive });
            } catch (error) {
                this._active = wasActive;
                this._state = wasActive ? 'active' : 'inactive';
                throw new ActorError(
                    'Failed to change active state',
                    this.id,
                    'setActive',
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        }
    }

    get layer(): ActorLayer {
        return this._layer;
    }

    set layer(value: ActorLayer | number) {
        if (this._destroyed) {
            throw new ActorError('Cannot modify destroyed actor', this.id, 'setLayer');
        }

        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
            throw new ActorError('Layer must be a non-negative integer', this.id, 'setLayer');
        }

        const oldLayer = this._layer;
        this._layer = value as ActorLayer;

        this._indexChangeHandler?.('layer', oldLayer as number, this._layer as number);
        this._emitEvent('actor:layerChanged', { oldLayer, newLayer: this._layer });
    }

    get tag(): ActorTag {
        return this._tag;
    }

    set tag(value: ActorTag | string) {
        if (this._destroyed) {
            throw new ActorError('Cannot modify destroyed actor', this.id, 'setTag');
        }

        if (!value || typeof value !== 'string') {
            throw new ActorError('Tag must be a non-empty string', this.id, 'setTag');
        }

        const oldTag = this._tag;
        this._tag = value as ActorTag;

        this._indexChangeHandler?.('tag', oldTag as string, this._tag as string);
        this._emitEvent('actor:tagChanged', { oldTag, newTag: this._tag });
    }

    get state(): ActorState {
        return this._state;
    }

    get isDestroyed(): boolean {
        return this._destroyed;
    }

    get componentCount(): number {
        return this._components.size;
    }

    get parent(): Actor | undefined {
        return this._getHierarchyComponent()?.parentActor;
    }

    get children(): readonly Actor[] {
        return this._getHierarchyComponent()?.childActors ?? [];
    }

    get persistent(): boolean {
        return this._persistent;
    }

    get pooled(): boolean {
        return this._pooled;
    }

    get started(): boolean {
        return this._started;
    }

    setParent(parent?: Actor): void {
        this._validateNotDestroyed('setParent');

        const hierarchy = this._getHierarchyComponent();
        if (!hierarchy) {
            return;
        }

        if (!parent) {
            hierarchy.parent = undefined;
            return;
        }

        const parentHierarchy = parent._getHierarchyComponent();
        if (parentHierarchy) {
            hierarchy.parent = parentHierarchy;
        }
    }

    addComponent<T extends Component>(componentType: ComponentType<T>, ...args: any[]): T {
        this._validateNotDestroyed('addComponent');

        if (!componentType || typeof componentType !== 'function') {
            throw new ComponentError(
                'Invalid component type provided',
                this.id,
                getComponentTypeName(
                    (componentType as unknown as ComponentType) ?? { name: 'unknown' }
                )
            );
        }

        const componentName = getComponentTypeName(componentType);

        if (this._components.size >= this._maxComponents) {
            throw new ComponentError(
                `Maximum component limit (${this._maxComponents}) reached`,
                this.id,
                componentName
            );
        }

        if (this._components.has(componentType)) {
            const metadata = this._getComponentMetadata(componentType);
            if (metadata?.singleton) {
                return this._components.get(componentType) as T;
            }
            throw new ComponentError(
                'Component already exists and is not singleton',
                this.id,
                componentName
            );
        }

        try {
            const metadata = this._getComponentMetadata(componentType);
            if (metadata?.dependencies && metadata.dependencies.length > 0) {
                this._resolveDependencies(componentType, metadata.dependencies as ComponentType[]);
            }

            const component = new componentType(...args);

            (component as any).entity = this.entity;
            (component as any).actor = this;
            (component as any).world = this.world;
            component.setRenderMutationClock(this._renderClock);

            this._components.set(componentType, component);
            this._componentPriorities.set(componentType, metadata?.priority ?? 0);
            this._invalidateSortedComponents();
            this._touchRevision();

            this.world.addComponent(this.entity, componentName as any, component);

            this._executeComponentLifecycle(component, 'onLoad');

            if (this._started) {
                this._executeComponentLifecycle(component, 'start');
            }

            if (this._active) {
                this._executeComponentLifecycle(component, 'onEnable');
            }

            this._emitEvent('actor:componentAdded', {
                componentType: componentName,
                component,
            });

            return component;
        } catch (error) {
            throw new ComponentError(
                'Failed to add component',
                this.id,
                componentName,
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    removeComponent<T extends Component>(componentType: ComponentType<T>): boolean {
        this._validateNotDestroyed('removeComponent');

        const component = this._components.get(componentType);
        if (!component) {
            return false;
        }

        try {
            this._checkComponentDependents(componentType);

            if (this._active) {
                this._executeComponentLifecycle(component, 'onDisable');
            }

            this._executeComponentLifecycle(component, 'onDestroy');

            this._components.delete(componentType);
            this._componentPriorities.delete(componentType);
            this._componentDependencies?.delete(componentType);
            component.setRenderMutationClock(null);
            this._invalidateSortedComponents();
            this._touchRevision();

            this.world.removeComponent(this.entity, getComponentTypeName(componentType) as any);

            this._emitEvent('actor:componentRemoved', {
                componentType: getComponentTypeName(componentType),
                component,
            });

            return true;
        } catch (error) {
            throw new ComponentError(
                'Failed to remove component',
                this.id,
                getComponentTypeName(componentType),
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    getComponent<T extends Component>(componentType: ComponentType<T>): T | undefined {
        return this._components.get(componentType) as T | undefined;
    }

    requireComponent<T extends Component>(componentType: ComponentType<T>): T {
        const component = this.getComponent(componentType);
        if (!component) {
            throw new ComponentError(
                'Required component not found',
                this.id,
                getComponentTypeName(componentType)
            );
        }
        return component;
    }

    hasComponent<T extends Component>(componentType: ComponentType<T>): boolean {
        return this._components.has(componentType);
    }

    getAllComponents(): readonly Component[] {
        return Array.from(this._components.values());
    }

    start(): void {
        if (this._started || this._destroyed) {
            return;
        }

        try {
            this._started = true;

            const sortedTypes = this._resolveSortedComponents();
            const sortedComponents = this._sortedComponentList!;

            for (let componentIndex = 0; componentIndex < sortedTypes.length; componentIndex += 1) {
                const componentType = sortedTypes[componentIndex]!;
                try {
                    this._executeComponentLifecycle(sortedComponents[componentIndex]!, 'start');
                } catch (error) {
                    console.error(
                        new ComponentError(
                            'Component start failed',
                            this.id,
                            componentType.name,
                            error instanceof Error ? error : new Error(String(error))
                        )
                    );
                }
            }

            this._emitEvent('actor:started', { actor: this });
        } catch (error) {
            this._started = false;
            throw new ActorError(
                'Failed to start actor',
                this.id,
                'start',
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    update(deltaTime: number): void {
        if (!this._active || this._destroyed || this._state !== 'active') {
            return;
        }

        try {
            this._updateFrame++;

            const sortedTypes = this._resolveSortedComponents();
            const sortedComponents = this._sortedComponentList!;

            for (let componentIndex = 0; componentIndex < sortedTypes.length; componentIndex += 1) {
                this._executeComponentPhase(
                    sortedTypes[componentIndex]!,
                    sortedComponents[componentIndex]!,
                    'update',
                    deltaTime
                );
            }
        } catch (error) {
            console.error(
                new ActorError(
                    'Actor update failed',
                    this.id,
                    'update',
                    error instanceof Error ? error : new Error(String(error))
                )
            );
        }
    }

    fixedUpdate(fixedDeltaTime: number): void {
        if (!this._active || this._destroyed || this._state !== 'active') {
            return;
        }

        try {
            const sortedTypes = this._resolveSortedComponents();
            const sortedComponents = this._sortedComponentList!;

            for (let componentIndex = 0; componentIndex < sortedTypes.length; componentIndex += 1) {
                this._executeComponentPhase(
                    sortedTypes[componentIndex]!,
                    sortedComponents[componentIndex]!,
                    'fixedUpdate',
                    fixedDeltaTime
                );
            }
        } catch (error) {
            console.error(
                new ActorError(
                    'Actor fixed update failed',
                    this.id,
                    'fixedUpdate',
                    error instanceof Error ? error : new Error(String(error))
                )
            );
        }
    }

    lateUpdate(deltaTime: number): void {
        if (!this._active || this._destroyed || this._state !== 'active') {
            return;
        }

        try {
            const sortedTypes = this._resolveSortedComponents();
            const sortedComponents = this._sortedComponentList!;

            for (let componentIndex = 0; componentIndex < sortedTypes.length; componentIndex += 1) {
                this._executeComponentPhase(
                    sortedTypes[componentIndex]!,
                    sortedComponents[componentIndex]!,
                    'lateUpdate',
                    deltaTime
                );
            }
        } catch (error) {
            console.error(
                new ActorError(
                    'Actor late update failed',
                    this.id,
                    'lateUpdate',
                    error instanceof Error ? error : new Error(String(error))
                )
            );
        }
    }

    destroy(immediate: boolean = false): void {
        if (this._destroyed) {
            return;
        }

        try {
            this._state = 'destroying';
            this._touchRevision();

            this._emitEvent('actor:destroying', { actor: this, immediate });

            const sortedTypes = this._resolveSortedComponents();
            const sortedComponentList = this._sortedComponentList!;

            // Reverse destruction order without mutating the shared cache.
            for (let index = sortedTypes.length - 1; index >= 0; index -= 1) {
                const componentType = sortedTypes[index]!;
                const component = sortedComponentList[index]!;
                try {
                    if (this._active && component.onDisable) {
                        component.onDisable();
                    }

                    if (component.onDestroy) {
                        component.onDestroy();
                    }
                } catch (error) {
                    console.error(
                        new ComponentError(
                            'Component destroy failed',
                            this.id,
                            componentType.name,
                            error instanceof Error ? error : new Error(String(error))
                        )
                    );
                }
            }

            if (this._cleanupTasks !== null) {
                for (const cleanup of this._cleanupTasks) {
                    try {
                        cleanup();
                    } catch (error) {
                        console.error('Cleanup task failed:', error);
                    }
                }
            }

            if (this._eventSubscriptions !== null) {
                for (const unsubscribe of this._eventSubscriptions) {
                    try {
                        unsubscribe();
                    } catch (error) {
                        console.error('Event unsubscribe failed:', error);
                    }
                }
            }

            this._components.clear();
            this._componentDependencies = null;
            this._componentPriorities.clear();
            this._invalidateSortedComponents();
            this._cleanupTasks = null;
            this._eventSubscriptions = null;

            this.world.unregisterActor(this.entity);
            this.world.destroyEntity(this.entity);

            this._destroyed = true;
            this._state = 'destroyed';

            this._emitEvent('actor:destroyed', { actor: this });
        } catch (error) {
            console.error(
                new ActorError(
                    'Actor destruction failed',
                    this.id,
                    'destroy',
                    error instanceof Error ? error : new Error(String(error))
                )
            );

            this._destroyed = true;

            this._state = 'destroyed';
        }
    }

    private _getComponentMetadata<T extends Component>(
        componentType: ComponentType<T>
    ): ComponentMetadata | undefined {
        return getComponentMetadata(componentType);
    }

    private _initializeCoreComponents(): void {
        try {
            const HierarchyClass = this._resolveCoreComponent('Hierarchy', Hierarchy);
            const TransformClass = this._resolveCoreComponent('Transform', Transform);

            if (HierarchyClass) this.addComponent(HierarchyClass as ComponentType<Hierarchy>);
            if (TransformClass) this.addComponent(TransformClass as ComponentType<Transform>);
        } catch (error) {
            console.error(
                new ComponentError(
                    'Failed to initialize core spatial components',
                    this.id,
                    'Hierarchy/Transform',
                    error instanceof Error ? error : new Error(String(error))
                )
            );
        }
    }

    private _initializePreloadedComponents(entries: readonly ActorPreloadedComponentEntry[]): void {
        const emitComponentAdded = !!(this._eventBus && typeof this._eventBus.emit === 'function');
        const usingScratch = !finalizeScratchInUse;
        let finalizeComponents = finalizeComponentsScratch;
        let finalizeFlags = finalizeFlagsScratch;
        let finalizeNames = finalizeNamesScratch;
        if (usingScratch) {
            finalizeScratchInUse = true;
        } else {
            finalizeComponents = [];
            finalizeFlags = [];
            finalizeNames = [];
        }

        try {
            for (const entry of entries) {
                const metadata = entry.metadata ?? this._getComponentMetadata(entry.componentType);
                const componentName =
                    entry.componentName ?? getComponentTypeName(entry.componentType);

                if (metadata?.dependencies && metadata.dependencies.length > 0) {
                    throw new ComponentError(
                        'Preloaded component fast path does not support dependencies',
                        this.id,
                        componentName
                    );
                }

                if (this._components.has(entry.componentType)) {
                    throw new ComponentError(
                        'Component already exists and is not singleton',
                        this.id,
                        componentName
                    );
                }

                (entry.component as any).entity = this.entity;
                (entry.component as any).actor = this;
                (entry.component as any).world = this.world;
                entry.component.setRenderMutationClock(this._renderClock);

                this._components.set(entry.componentType, entry.component);
                this._componentPriorities.set(entry.componentType, metadata?.priority ?? 0);

                const flags =
                    (typeof entry.component.onLoad === 'function' ? FINALIZE_FLAG_ON_LOAD : 0) |
                    (this._started && typeof entry.component.start === 'function'
                        ? FINALIZE_FLAG_START
                        : 0) |
                    (this._active && typeof entry.component.onEnable === 'function'
                        ? FINALIZE_FLAG_ENABLE
                        : 0) |
                    (emitComponentAdded ? FINALIZE_FLAG_EMIT : 0);

                if (flags !== 0) {
                    finalizeComponents.push(entry.component);
                    finalizeFlags.push(flags);
                    finalizeNames.push(componentName);
                }
            }

            this._invalidateSortedComponents();

            for (let index = 0; index < finalizeComponents.length; index += 1) {
                const component = finalizeComponents[index]!;
                const flags = finalizeFlags[index]!;

                if ((flags & FINALIZE_FLAG_ON_LOAD) !== 0) {
                    this._executeComponentLifecycle(component, 'onLoad');
                }

                if ((flags & FINALIZE_FLAG_START) !== 0) {
                    this._executeComponentLifecycle(component, 'start');
                }

                if ((flags & FINALIZE_FLAG_ENABLE) !== 0) {
                    this._executeComponentLifecycle(component, 'onEnable');
                }

                if ((flags & FINALIZE_FLAG_EMIT) !== 0) {
                    this._emitEvent('actor:componentAdded', {
                        componentType: finalizeNames[index]!,
                        component,
                    });
                }
            }
        } finally {
            if (usingScratch) {
                finalizeComponents.length = 0;
                finalizeFlags.length = 0;
                finalizeNames.length = 0;
                finalizeScratchInUse = false;
            }
        }
    }

    private _validateNotDestroyed(operation: string): void {
        if (this._destroyed) {
            throw new ActorError(
                `Cannot perform ${operation} on destroyed actor`,
                this.id,
                operation
            );
        }
    }

    private _getHierarchyComponent(): Hierarchy | undefined {
        const HierarchyClass = this._resolveCoreComponent('Hierarchy', Hierarchy, false);

        if (!HierarchyClass) {
            return undefined;
        }

        return this.getComponent(HierarchyClass as ComponentType<Hierarchy>);
    }

    private _resolveCoreComponent(
        name: 'Hierarchy' | 'Transform',
        fallback: ComponentType<Component>,
        ensureRegistered: boolean = true
    ): ComponentType<Component> | undefined {
        const worldAny = this.world as unknown as {
            registry?: Record<string, ComponentType<Component>>;
        };
        const globalAny = globalThis as unknown as {
            Hierarchy?: ComponentType<Hierarchy>;
            Transform?: ComponentType<Transform>;
        };
        const registryComponent = (worldAny.registry?.[name] ??
            globalAny[name] ??
            fallback) as ComponentType<Component>;

        if (!registryComponent) {
            return undefined;
        }

        if (ensureRegistered && !this.world.isComponentRegistered(registryComponent)) {
            this.world.registerComponentType(registryComponent);
        }

        return registryComponent;
    }

    /**
     * Resolves (and caches) the priority-ordered component lists as two
     * parallel arrays. The overwhelmingly common case — all priorities equal,
     * insertion order already canonical — is a single allocation-free pass
     * over the component Map; destructuring iteration avoids materializing
     * entry tuples and the ordering check replaces a comparator sort per
     * actor.
     */
    private _resolveSortedComponents(): ComponentType[] {
        const cached = this._sortedComponentTypes;
        if (cached !== null) {
            return cached;
        }

        const types: ComponentType[] = [];
        const components: Component[] = [];
        let ordered = true;
        let previousPriority = Number.POSITIVE_INFINITY;
        for (const [componentType, component] of this._components) {
            const priority = this._componentPriorities.get(componentType) ?? 0;
            if (priority > previousPriority) {
                ordered = false;
            }
            previousPriority = priority;
            types.push(componentType);
            components.push(component);
        }

        if (!ordered && types.length > 1) {
            const indices = types.map((_, index) => index);
            indices.sort((left, right) => {
                const leftPriority = this._componentPriorities.get(types[right]!) ?? 0;
                const rightPriority = this._componentPriorities.get(types[left]!) ?? 0;
                return leftPriority - rightPriority;
            });
            const orderedTypes: ComponentType[] = [];
            const orderedComponents: Component[] = [];
            for (const index of indices) {
                orderedTypes.push(types[index]!);
                orderedComponents.push(components[index]!);
            }
            this._sortedComponentTypes = orderedTypes;
            this._sortedComponentList = orderedComponents;
            return orderedTypes;
        }

        this._sortedComponentTypes = types;
        this._sortedComponentList = components;
        return types;
    }

    private _invalidateSortedComponents(): void {
        this._sortedComponentTypes = null;
        this._sortedComponentList = null;
    }

    /**
     * @internal Drops the cached lifecycle order. Called when the component
     * set or a component priority changes.
     */
    invalidateComponentOrder(): void {
        this._invalidateSortedComponents();
    }

    private _resolveDependencies(
        componentType: ComponentType,
        dependencies: ComponentType[]
    ): void {
        const visited = new Set<ComponentType>();
        const resolving = new Set<ComponentType>();

        if (dependencies.length === 0) {
            // The decorator defaults `dependencies` to an empty array for every
            // component, so this is the overwhelmingly common path: there is
            // nothing to resolve and nothing to record.
            return;
        }

        const resolve = (type: ComponentType, deps: ComponentType[]): void => {
            if (resolving.has(type)) {
                throw new ComponentError('Circular dependency detected', this.id, type.name);
            }

            if (visited.has(type)) {
                return;
            }

            resolving.add(type);

            for (const dep of deps) {
                if (!this._components.has(dep)) {
                    const depMetadata = this._getComponentMetadata(dep);
                    if (depMetadata?.dependencies) {
                        resolve(dep, depMetadata.dependencies as ComponentType[]);
                    }
                    this.addComponent(dep);
                }
            }

            resolving.delete(type);
            visited.add(type);
        };

        resolve(componentType, dependencies);

        const dependenciesByType = (this._componentDependencies ??= new Map());
        dependenciesByType.set(componentType, new Set(dependencies));
    }

    private _checkComponentDependents(componentType: ComponentType): void {
        if (this._componentDependencies === null) {
            return;
        }
        for (const [type, dependencies] of this._componentDependencies) {
            if (dependencies.has(componentType) && this._components.has(type)) {
                throw new ComponentError(
                    `Cannot remove component: ${type.name} depends on it`,
                    this.id,
                    getComponentTypeName(componentType)
                );
            }
        }
    }

    private _executeComponentLifecycle(component: Component, method: keyof Component): void {
        try {
            const lifecycleMethod = component[method];
            if (typeof lifecycleMethod === 'function') {
                (lifecycleMethod as Function).call(component);
            }
        } catch (error) {
            throw new ComponentError(
                `Component lifecycle method ${String(method)} failed`,
                this.id,
                component.constructor.name,
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    private _executeComponentPhase(
        componentType: ComponentType,
        component: Component,
        phase: 'update' | 'fixedUpdate' | 'lateUpdate',
        deltaTime: number
    ): void {
        if (!component.enabled) {
            return;
        }

        try {
            const lifecycleMethod = component[phase];
            if (typeof lifecycleMethod === 'function') {
                (lifecycleMethod as (deltaTime: number) => void).call(component, deltaTime);
            }
        } catch (error) {
            console.error(
                new ComponentError(
                    `Component ${phase} failed`,
                    this.id,
                    componentType.name,
                    error instanceof Error ? error : new Error(String(error))
                )
            );
        }
    }

    private _emitEvent(eventType: string, data: Record<string, unknown>): void {
        try {
            if (this._eventBus && typeof this._eventBus.emit === 'function') {
                this._eventBus.emit(eventType, {
                    actorId: this.id,
                    entity: this.entity,
                    timestamp: performance.now(),
                    ...data,
                });
            }
        } catch (error) {
            console.error(`Failed to emit event ${eventType}:`, error);
        }
    }

    addCleanupTask(cleanup: () => void): void {
        if (typeof cleanup === 'function') {
            const tasks = (this._cleanupTasks ??= new Set());
            tasks.add(cleanup);
        }
    }

    on(eventType: string, handler: (data: unknown) => void): () => void {
        if (!this._eventBus || typeof this._eventBus.on !== 'function') {
            console.warn('Event bus not available');
            return () => {};
        }

        const unsubscribe = this._eventBus.on(eventType, handler);
        const subscriptions = (this._eventSubscriptions ??= new Set());
        subscriptions.add(unsubscribe);

        return () => {
            unsubscribe();
            this._eventSubscriptions?.delete(unsubscribe);
        };
    }

    subscribeIndexChanges(
        handler: (
            kind: 'tag' | 'layer',
            oldValue: string | number,
            newValue: string | number
        ) => void
    ): () => void {
        this._indexChangeHandler = handler;
        return () => {
            this._indexChangeHandler = null;
        };
    }

    toString(): string {
        const componentNames = Array.from(this._components.keys()).map((type) => type.name);
        return `Actor(${this.id}) [${componentNames.join(', ')}] - ${this._state}`;
    }
}
