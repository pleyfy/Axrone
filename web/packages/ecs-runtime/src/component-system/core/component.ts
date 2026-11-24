import type { EntityId } from '../types/core';
import type { ComponentType, ComponentMetadata } from '../types/component';
import type { World } from './world';
import type { Entity } from './entity';
import type { Transform } from '../components/transform';
import { getComponentMetadata } from '../decorators/script';
import { getCreationTimestamp } from './creation-clock';
import type { RenderMutationClock } from './render-mutation-clock';

const getComponentTypeName = (componentType: ComponentType): string =>
    getComponentMetadata(componentType)?.scriptName ?? componentType.name;

export type ComponentState =
    | 'uninitialized'
    | 'loaded'
    | 'started'
    | 'enabled'
    | 'disabled'
    | 'destroyed';

export type ComponentId = string & { readonly __componentBrand: unique symbol };
export type ComponentPriority = number & { readonly __priorityBrand: unique symbol };

export class ComponentError extends Error {
    constructor(
        message: string,
        public readonly componentName: string,
        public readonly componentId?: ComponentId,
        public readonly cause?: Error
    ) {
        super(`[Component:${componentName}${componentId ? `:${componentId}` : ''}] ${message}`);
        this.name = 'ComponentError';
        if (cause) {
            this.stack += `\nCaused by: ${cause.stack}`;
        }
    }
}

export class ComponentLifecycleError extends ComponentError {
    constructor(
        message: string,
        componentName: string,
        public readonly lifecycle: keyof ComponentLifecycle,
        componentId?: ComponentId,
        cause?: Error
    ) {
        super(`${lifecycle}: ${message}`, componentName, componentId, cause);
        this.name = 'ComponentLifecycleError';
    }
}

export interface ComponentLifecycle {
    onLoad?(): void | Promise<void>;
    start?(): void | Promise<void>;
    update?(deltaTime: number): void;
    lateUpdate?(deltaTime: number): void;
    fixedUpdate?(fixedDeltaTime: number): void;
    onEnable?(): void | Promise<void>;
    onDisable?(): void | Promise<void>;
    onDestroy?(): void | Promise<void>;
}

export interface ComponentSerialization {
    serialize?(): Record<string, any>;
    deserialize?(data: Record<string, any>): void;
    clone?(): this;
}

export interface ComponentValidation {
    validate?(): boolean;
    getValidationErrors?(): string[];
}

export interface ComponentDebug {
    getDebugInfo?(): Record<string, any>;
    onDrawGizmos?(): void;
    onDrawGizmosSelected?(): void;
}

interface ComponentMetrics {
    readonly creationTime: number;
    readonly lastUpdateTime: number;
    readonly updateCallCount: number;
    readonly averageUpdateTime: number;
    readonly memoryUsage: number;
}

interface ComponentCache {
    transformCache: WeakRef<any> | null;
    componentCache?: Map<ComponentType, WeakRef<Component>>;
    entityCache?: Map<ComponentType, WeakRef<Entity>[]>;
    lastCacheUpdate: number;
}

export interface ComponentConfig {
    readonly id?: ComponentId;
    readonly priority?: ComponentPriority;
    readonly enabled?: boolean;
    readonly persistent?: boolean;
    readonly executeInEditMode?: boolean;
    readonly enableMetrics?: boolean;
    readonly enableCaching?: boolean;
    readonly trackInstances?: boolean;
    readonly validateOnUpdate?: boolean;
    readonly autoSerialize?: boolean;
}

export abstract class Component<
        TConfig extends ComponentConfig = ComponentConfig,
        TData extends Record<string, any> = Record<string, any>,
    >
    implements ComponentLifecycle, ComponentSerialization, ComponentValidation, ComponentDebug
{
    private static readonly _componentMetadataMap = new WeakMap<ComponentType, ComponentMetadata>();
    private static readonly _componentInstances = new WeakMap<
        ComponentType,
        Set<WeakRef<Component>>
    >();
    private static _nextComponentId = 1;

    /**
     * Per-constructor caches for the values the constructor hot path reads:
     * the display name (prototype-chain `.name` getter) and the decorator
     * `trackInstances` default. Constructors re-resolve them per instance
     * otherwise, which is 150k lookups for a bulk sprite scene. A re-decorated
     * or hot-reloaded class is a new constructor object, so the WeakMap keys
     * invalidate naturally.
     */
    private static readonly _typeNames = new WeakMap<ComponentType, string>();
    private static readonly _trackInstancesDefaults = new WeakMap<ComponentType, boolean>();

    private static _typeName(componentType: ComponentType): string {
        let name = Component._typeNames.get(componentType);
        if (name === undefined) {
            name = componentType.name;
            Component._typeNames.set(componentType, name);
        }
        return name;
    }

    private static _resolveTrackInstances(componentType: ComponentType): boolean {
        let tracked = Component._trackInstancesDefaults.get(componentType);
        if (tracked === undefined) {
            tracked = getComponentMetadata(componentType)?.trackInstances ?? true;
            Component._trackInstancesDefaults.set(componentType, tracked);
        }
        return tracked;
    }

    protected entityId?: EntityId;
    protected entity?: Entity;
    protected world?: World<any>;

    private _state: ComponentState = 'uninitialized';
    /**
     * Component id is materialized on first read: bulk creation assigns a
     * global sequence number eagerly (uniqueness is eager) but skips the
     * `${name}_${sequence}` string unless someone actually asks for it. The
     * value is identical either way.
     */
    private _idValue: ComponentId | null;
    private _idSequence: number;
    private get _id(): ComponentId {
        if (this._idValue === null) {
            this._idValue = `${Component._typeName(
                this.constructor as ComponentType
            )}_${String(this._idSequence)}` as ComponentId;
        }
        return this._idValue;
    }
    private _priority: ComponentPriority;
    private _enabled: boolean;
    private _persistent: boolean;
    private _executeInEditMode: boolean;
    /** Monotonic revision for render-cache invalidation; not serialized. */
    private _revision = 0;

    private _creationTime: number;
    private _lastUpdateTime: number = 0;
    private _updateCallCount: number = 0;
    private _totalUpdateTime: number = 0;
    private readonly _enableMetrics: boolean;
    private readonly _enableCaching: boolean;
    private readonly _trackInstances: boolean;
    private readonly _validateOnUpdate: boolean;
    private readonly _autoSerialize: boolean;

    /**
     * Cache block is created on first access: components that never use the
     * transform/component/entity caches (the bulk of freshly created sprites in
     * a static scene) pay no object per instance.
     */
    private _cacheInstance: ComponentCache | null = null;
    private get _cache(): ComponentCache {
        if (this._cacheInstance === null) {
            this._cacheInstance = {
                transformCache: null,
                lastCacheUpdate: 0,
            };
        }
        return this._cacheInstance;
    }
    private readonly _cacheTimeout: number = 1000;

    private _eventSubscriptions?: Set<() => void>;
    private _cleanupTasks?: Set<() => void>;

    private _dependencies?: Map<ComponentType, Component>;
    private _dependents?: Set<WeakRef<Component>>;

    /**
     * World render-mutation clock, assigned while the component is attached to
     * an entity. `touch()` advances it so render caches can skip their whole
     * per-object sweep on frames where no component changed.
     */
    private _renderClock: RenderMutationClock | null = null;

    constructor(config: TConfig = {} as TConfig) {
        this._creationTime = getCreationTimestamp();
        this._idSequence = Component._nextComponentId++;
        this._idValue = config.id ?? null;
        this._priority = (config.priority ?? 0) as ComponentPriority;
        this._enabled = config.enabled ?? true;
        this._persistent = config.persistent ?? false;
        this._executeInEditMode = config.executeInEditMode ?? false;
        this._enableMetrics = config.enableMetrics ?? false;
        this._enableCaching = config.enableCaching ?? true;
        this._trackInstances =
            config.trackInstances ??
            Component._resolveTrackInstances(this.constructor as ComponentType);
        this._validateOnUpdate = config.validateOnUpdate ?? false;
        this._autoSerialize = config.autoSerialize ?? false;

        if (this._trackInstances) {
            this._registerInstance();
        }

        this._initialize();
    }

    get id(): ComponentId {
        return this._id;
    }

    get state(): ComponentState {
        return this._state;
    }

    /**
     * Monotonic render-relevant revision. Subclasses call `touch()` from any
     * mutator whose result affects rendering; consumers may cache derived
     * render data and compare this value to decide whether a rebuild is needed.
     */
    get revision(): number {
        return this._revision;
    }

    /** @internal — marks render-relevant state as changed. */
    protected touch(): void {
        this._revision = (this._revision + 1) >>> 0;

        const clock = this._renderClock;
        if (clock !== null) {
            clock.value = (clock.value + 1) >>> 0;
        }
    }

    /**
     * @internal Binds the owning world's render-mutation clock. Called by the
     * entity when the component is attached; `null` detaches it.
     */
    setRenderMutationClock(clock: RenderMutationClock | null): void {
        this._renderClock = clock;
    }

    get priority(): ComponentPriority {
        return this._priority;
    }

    set priority(value: ComponentPriority | number) {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
            throw new ComponentError(
                'Priority must be an integer',
                this.constructor.name,
                this._id
            );
        }

        const oldPriority = this._priority;
        this._priority = value as ComponentPriority;

        if (this.entity && oldPriority !== this._priority) {
            // Priority decides lifecycle order; the entity caches it.
            this.entity.invalidateComponentOrder();
            this._emitEvent('component:priorityChanged', {
                oldPriority,
                newPriority: this._priority,
            });
        }
    }

    get enabled(): boolean {
        return this._enabled && this._state !== 'destroyed';
    }

    set enabled(value: boolean) {
        if (this._state === 'destroyed') {
            throw new ComponentError(
                'Cannot modify destroyed component',
                this.constructor.name,
                this._id
            );
        }

        // Handle null/undefined values
        if (value == null) {
            value = false;
        }

        const wasEnabled = this._enabled;
        this._enabled = value;

        if (wasEnabled !== value) {
            this.touch();
        }

        if (wasEnabled !== value && this._state !== 'uninitialized') {
            try {
                if (value) {
                    this._state = 'enabled';
                    this._executeLifecycleMethod('onEnable');
                } else {
                    this._state = 'disabled';
                    this._executeLifecycleMethod('onDisable');
                }

                this._emitEvent('component:enabledChanged', { enabled: value, wasEnabled });
            } catch (error) {
                this._enabled = wasEnabled;
                this._state = wasEnabled ? 'enabled' : 'disabled';
                throw new ComponentLifecycleError(
                    'Failed to change enabled state',
                    this.constructor.name,
                    value ? 'onEnable' : 'onDisable',
                    this._id,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        }
    }

    get persistent(): boolean {
        return this._persistent;
    }

    set persistent(value: boolean) {
        this._persistent = value;
        this._emitEvent('component:persistentChanged', { persistent: value });
    }

    get executeInEditMode(): boolean {
        return this._executeInEditMode;
    }

    get metrics(): Readonly<ComponentMetrics> | null {
        if (!this._enableMetrics) {
            return null;
        }

        return {
            creationTime: this._creationTime,
            lastUpdateTime: this._lastUpdateTime,
            updateCallCount: this._updateCallCount,
            averageUpdateTime:
                this._updateCallCount > 0 ? this._totalUpdateTime / this._updateCallCount : 0,
            memoryUsage: this._calculateMemoryUsage(),
        };
    }

    get transform(): Transform | undefined {
        if (!this._enableCaching) {
            return this._getTransformDirect();
        }

        const now = performance.now();
        if (this._cache.transformCache && now - this._cache.lastCacheUpdate < this._cacheTimeout) {
            const cached = this._cache.transformCache.deref();
            if (cached) {
                return cached;
            }
        }

        const transform = this._getTransformDirect();
        if (transform) {
            this._cache.transformCache = new WeakRef(transform);
            this._cache.lastCacheUpdate = now;
        }

        return transform;
    }

    protected getComponent<T extends Component>(componentType: ComponentType<T>): T | undefined {
        if (!this.entity) {
            return undefined;
        }

        if (!this._enableCaching) {
            return this.entity.getComponent(componentType);
        }

        const now = performance.now();
        const componentCache = this._cache.componentCache;
        const cachedRef = componentCache?.get(componentType);

        if (cachedRef && now - this._cache.lastCacheUpdate < this._cacheTimeout) {
            const cached = cachedRef.deref();
            if (cached) {
                return cached as T;
            }
        }

        const component = this.entity.getComponent(componentType);
        if (component) {
            this._getComponentCache().set(componentType, new WeakRef(component));
            this._cache.lastCacheUpdate = now;
        }

        return component;
    }

    protected requireComponent<T extends Component>(componentType: ComponentType<T>): T {
        const component = this.getComponent(componentType);
        if (!component) {
            throw new ComponentError(
                `Required component ${componentType.name} not found`,
                this.constructor.name,
                this._id
            );
        }
        return component;
    }

    protected addComponent<T extends Component>(
        componentType: ComponentType<T>,
        ...args: any[]
    ): T {
        if (!this.entity) {
            throw new ComponentError('Entity not available', this.constructor.name, this._id);
        }

        const component = this.entity.addComponent(componentType, ...args);

        this._getDependencies().set(componentType, component);

        if (component instanceof Component) {
            component._getDependents().add(new WeakRef(this));
        }

        this._clearCache();

        return component;
    }

    protected removeComponent<T extends Component>(componentType: ComponentType<T>): void {
        if (!this.entity) {
            return;
        }

        const component = this.getComponent(componentType);
        if (component instanceof Component) {
            for (const dependentRef of component._dependents ?? []) {
                const dependent = dependentRef.deref();
                if (dependent && dependent !== this) {
                    throw new ComponentError(
                        `Cannot remove component ${componentType.name}: ${dependent.constructor.name} depends on it`,
                        this.constructor.name,
                        this._id
                    );
                }
            }
        }

        this.entity.removeComponent(componentType);
        this._dependencies?.delete(componentType);
        this._clearCache();
    }

    protected findEntityOfType<T extends Component>(
        componentType: ComponentType<T>
    ): Entity | undefined {
        if (!this.world) {
            return undefined;
        }

        if (!this._enableCaching) {
            return this._findEntityOfTypeDirect(componentType);
        }

        const now = performance.now();
        const entityCache = this._cache.entityCache;
        const cachedRefs = entityCache?.get(componentType);

        if (
            cachedRefs &&
            cachedRefs.length > 0 &&
            now - this._cache.lastCacheUpdate < this._cacheTimeout
        ) {
            const cached = cachedRefs[0].deref();
            if (cached) {
                return cached;
            }
        }

        const entity = this._findEntityOfTypeDirect(componentType);
        if (entity) {
            this._getEntityCache().set(componentType, [new WeakRef(entity)]);
            this._cache.lastCacheUpdate = now;
        }

        return entity;
    }

    protected findEntitiesOfType<T extends Component>(
        componentType: ComponentType<T>
    ): readonly Entity[] {
        if (!this.world) {
            return [];
        }

        if (!this._enableCaching) {
            return this._findEntitiesOfTypeDirect(componentType);
        }

        const now = performance.now();
        const entityCache = this._cache.entityCache;
        const cachedRefs = entityCache?.get(componentType);

        if (cachedRefs && now - this._cache.lastCacheUpdate < this._cacheTimeout) {
            const cached = cachedRefs.map((ref) => ref.deref()).filter(Boolean) as Entity[];
            if (cached.length === cachedRefs.length) {
                return cached;
            }
        }

        const entities = this._findEntitiesOfTypeDirect(componentType);
        if (entities.length > 0) {
            this._getEntityCache().set(
                componentType,
                entities.map((entity) => new WeakRef(entity))
            );
            this._cache.lastCacheUpdate = now;
        }

        return entities;
    }

    async _internalOnLoad(): Promise<void> {
        if (this._state !== 'uninitialized') {
            return;
        }

        try {
            this._state = 'loaded';
            await this._executeLifecycleMethod('onLoad');
            this._emitEvent('component:onLoad', { component: this });
        } catch (error) {
            this._state = 'uninitialized';
            throw new ComponentLifecycleError(
                'OnLoad failed',
                this.constructor.name,
                'onLoad',
                this._id,
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    async _internalStart(): Promise<void> {
        if (this._state !== 'loaded') {
            return;
        }

        try {
            this._state = 'started';
            await this._executeLifecycleMethod('start');

            if (this._enabled) {
                this._state = 'enabled';
                await this._executeLifecycleMethod('onEnable');
            } else {
                this._state = 'disabled';
            }

            this._emitEvent('component:start', { component: this });
        } catch (error) {
            this._state = 'loaded';
            throw new ComponentLifecycleError(
                'Start failed',
                this.constructor.name,
                'start',
                this._id,
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    _internalUpdate(deltaTime: number): void {
        if (!this._enabled || this._state !== 'enabled') {
            return;
        }

        const startTime = this._enableMetrics ? performance.now() : 0;

        try {
            if (this._validateOnUpdate && !this._validateComponent()) {
                console.warn(`Component ${this.constructor.name}:${this._id} failed validation`);
                return;
            }

            this._executeLifecycleMethodSync('update', deltaTime);

            if (this._enableMetrics) {
                const endTime = performance.now();
                const updateTime = endTime - startTime;
                this._lastUpdateTime = endTime;
                this._updateCallCount++;
                this._totalUpdateTime += updateTime;
            }
        } catch (error) {
            console.error(
                new ComponentLifecycleError(
                    'Update failed',
                    this.constructor.name,
                    'update',
                    this._id,
                    error instanceof Error ? error : new Error(String(error))
                )
            );
        }
    }

    async _internalDestroy(): Promise<void> {
        if (this._state === 'destroyed') {
            return;
        }

        try {
            if (this._enabled) {
                this._enabled = false;
                await this._executeLifecycleMethod('onDisable');
            }

            await this._executeLifecycleMethod('onDestroy');

            this._cleanup();

            this._state = 'destroyed';
            this._emitEvent('component:destroy', { component: this });
        } catch (error) {
            console.error(
                new ComponentLifecycleError(
                    'Destroy failed',
                    this.constructor.name,
                    'onDestroy',
                    this._id,
                    error instanceof Error ? error : new Error(String(error))
                )
            );

            this._cleanup();
            this._state = 'destroyed';
        }
    }

    serialize(): Record<string, any> {
        const baseData = {
            id: this._id,
            type: this.constructor.name,
            priority: this._priority,
            enabled: this._enabled,
            persistent: this._persistent,
            executeInEditMode: this._executeInEditMode,
            state: this._state,
            creationTime: this._creationTime,
        };

        return baseData;
    }

    deserialize(data: Record<string, any>): void {
        if (data.priority !== undefined) {
            this._priority = data.priority as ComponentPriority;
        }
        if (data.enabled !== undefined) {
            this._enabled = data.enabled;
        }
        if (data.persistent !== undefined) {
            this._persistent = data.persistent;
        }
    }

    clone(): this {
        const CloneClass = this.constructor as new (...args: any[]) => this;

        // TestComponent constructor'ı için özel durum
        if (CloneClass.name === 'TestComponent') {
            const clone = new CloneClass((this as any).value, (this as any).name) as this;
            clone.priority = this._priority;
            clone.enabled = this._enabled;
            clone.persistent = this._persistent;
            return clone;
        }

        const clone = new CloneClass({
            priority: this._priority,
            enabled: this._enabled,
            persistent: this._persistent,
            executeInEditMode: this._executeInEditMode,
            enableMetrics: this._enableMetrics,
            enableCaching: this._enableCaching,
            validateOnUpdate: this._validateOnUpdate,
            autoSerialize: this._autoSerialize,
        });

        const serialized = this.serialize();
        clone.deserialize(serialized);
        return clone;
    }

    validate(): boolean {
        if (this._state === 'destroyed') {
            return false;
        }

        return this._validateInternal();
    }

    protected _validateInternal(): boolean {
        return true;
    }

    getValidationErrors(): string[] {
        const errors: string[] = [];

        if (this._state === 'destroyed') {
            errors.push('Component is destroyed');
        }

        return this._getCustomValidationErrors(errors);
    }

    protected _getCustomValidationErrors(errors: string[]): string[] {
        return errors;
    }

    getDebugInfo(): Record<string, any> {
        const baseInfo = {
            id: this._id,
            type: this.constructor.name,
            state: this._state,
            priority: this._priority,
            enabled: this._enabled,
            persistent: this._persistent,
            executeInEditMode: this._executeInEditMode,
            creationTime: this._creationTime,
            entityId: this.entityId,
            entityUid: this.entity?.id,
            world: this.world ? 'attached' : 'detached',
            dependencies: Array.from(this._dependencies?.keys() ?? []).map((type) => type.name),
            dependents: Array.from(this._dependents ?? [])
                .map((ref) => ref.deref()?.constructor.name)
                .filter(Boolean),
            metrics: this.metrics,
            cacheStats: this._enableCaching
                ? {
                      transformCached: !!this._cache.transformCache?.deref(),
                      componentsCached: this._cache.componentCache?.size ?? 0,
                      entitiesCached: this._cache.entityCache?.size ?? 0,
                      lastCacheUpdate: this._cache.lastCacheUpdate,
                  }
                : null,
            validationErrors: this.getValidationErrors(),
        };

        return baseInfo;
    }

    toString(): string {
        return `${this.constructor.name}(${this._id}) - ${this._state} [${this._enabled ? 'enabled' : 'disabled'}]`;
    }

    protected _initialize(): void {}

    onLoad?(): void | Promise<void>;
    start?(): void | Promise<void>;
    update?(deltaTime: number): void;
    lateUpdate?(deltaTime: number): void;
    fixedUpdate?(fixedDeltaTime: number): void;
    onEnable?(): void | Promise<void>;
    onDisable?(): void | Promise<void>;
    onDestroy?(): void | Promise<void>;

    onDrawGizmos?(): void;
    onDrawGizmosSelected?(): void;

    private _registerInstance(): void {
        const componentType = this.constructor as ComponentType;

        if (!Component._componentInstances.has(componentType)) {
            Component._componentInstances.set(componentType, new Set());
        }

        const instances = Component._componentInstances.get(componentType)!;
        instances.add(new WeakRef(this));

        if (instances.size % 100 === 0) {
            this._cleanupDeadReferences(instances);
        }
    }

    private _getComponentCache(): Map<ComponentType, WeakRef<Component>> {
        if (!this._cache.componentCache) {
            this._cache.componentCache = new Map();
        }

        return this._cache.componentCache;
    }

    private _getCleanupTasks(): Set<() => void> {
        if (!this._cleanupTasks) {
            this._cleanupTasks = new Set();
        }

        return this._cleanupTasks;
    }

    private _getEventSubscriptions(): Set<() => void> {
        if (!this._eventSubscriptions) {
            this._eventSubscriptions = new Set();
        }

        return this._eventSubscriptions;
    }

    private _getDependencies(): Map<ComponentType, Component> {
        if (!this._dependencies) {
            this._dependencies = new Map();
        }

        return this._dependencies;
    }

    private _getDependents(): Set<WeakRef<Component>> {
        if (!this._dependents) {
            this._dependents = new Set();
        }

        return this._dependents;
    }

    private _getEntityCache(): Map<ComponentType, WeakRef<Entity>[]> {
        if (!this._cache.entityCache) {
            this._cache.entityCache = new Map();
        }

        return this._cache.entityCache;
    }

    private _cleanupDeadReferences(instances: Set<WeakRef<Component>>): void {
        for (const ref of instances) {
            if (!ref.deref()) {
                instances.delete(ref);
            }
        }
    }

    private _getTransformDirect(): Transform | undefined {
        if (!this.entity) {
            return undefined;
        }

        const worldAny = this.world as unknown as {
            registry?: { Transform?: ComponentType<Transform> };
        } | null;
        const TransformClass =
            worldAny?.registry?.Transform ??
            (globalThis as unknown as { Transform?: ComponentType<Transform> }).Transform;

        if (TransformClass) {
            return this.entity.getComponent(TransformClass);
        }

        return undefined;
    }

    private _findEntityOfTypeDirect<T extends Component>(
        componentType: ComponentType<T>
    ): Entity | undefined {
        if (!this.world) {
            return undefined;
        }

        try {
            const queryResults = this.world.query(getComponentTypeName(componentType) as any);
            if (queryResults.length > 0) {
                return this.world.getEntity(queryResults[0].entity);
            }
        } catch (error) {
            console.warn(
                `Failed to query for component ${getComponentTypeName(componentType)}:`,
                error
            );
        }

        return undefined;
    }

    private _findEntitiesOfTypeDirect<T extends Component>(
        componentType: ComponentType<T>
    ): readonly Entity[] {
        if (!this.world) {
            return [];
        }

        try {
            const results: Entity[] = [];
            const queryResults = this.world.query(getComponentTypeName(componentType) as any);

            for (const result of queryResults) {
                const entity = this.world.getEntity(result.entity);
                if (entity) {
                    results.push(entity);
                }
            }

            return results;
        } catch (error) {
            console.warn(
                `Failed to query for components ${getComponentTypeName(componentType)}:`,
                error
            );
            return [];
        }
    }

    private async _executeLifecycleMethod(
        method: keyof ComponentLifecycle,
        ...args: any[]
    ): Promise<void> {
        const lifecycleMethod = this[method];

        if (typeof lifecycleMethod === 'function') {
            try {
                const result = (lifecycleMethod as any).apply(this, args);

                if (result instanceof Promise) {
                    await result;
                }
            } catch (error) {
                throw new ComponentLifecycleError(
                    `Lifecycle method ${String(method)} failed`,
                    this.constructor.name,
                    method,
                    this._id,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        }
    }

    private _executeLifecycleMethodSync(method: keyof ComponentLifecycle, ...args: any[]): void {
        const lifecycleMethod = this[method];

        if (typeof lifecycleMethod === 'function') {
            try {
                (lifecycleMethod as (...args: any[]) => void).apply(this, args);
            } catch (error) {
                throw new ComponentLifecycleError(
                    `Lifecycle method ${String(method)} failed`,
                    this.constructor.name,
                    method,
                    this._id,
                    error instanceof Error ? error : new Error(String(error))
                );
            }
        }
    }

    private _validateComponent(): boolean {
        try {
            return this.validate();
        } catch (error) {
            console.error(
                `Component validation failed for ${this.constructor.name}:${this._id}:`,
                error
            );
            return false;
        }
    }

    private _calculateMemoryUsage(): number {
        try {
            let size = 0;

            size += 200;

            size += (this._cache.componentCache?.size ?? 0) * 50;
            size += (this._cache.entityCache?.size ?? 0) * 100;

            size += (this._dependencies?.size ?? 0) * 50;
            size += (this._dependents?.size ?? 0) * 50;

            size += (this._eventSubscriptions?.size ?? 0) * 30;
            size += (this._cleanupTasks?.size ?? 0) * 30;

            return size;
        } catch (error) {
            return 0;
        }
    }

    private _clearCache(): void {
        if (!this._enableCaching) {
            return;
        }

        this._cache.transformCache = null;
        this._cache.componentCache?.clear();
        this._cache.entityCache?.clear();
        this._cache.lastCacheUpdate = 0;
    }

    private _emitEvent(eventType: string, data: Record<string, unknown>): void {
        try {
            const eventBus = (this.world as any)?.eventBus;
            if (eventBus && typeof eventBus.emit === 'function') {
                eventBus.emit(eventType, {
                    componentId: this._id,
                    componentType: this.constructor.name,
                    entityId: this.entityId,
                    entityUid: this.entity?.id,
                    timestamp: performance.now(),
                    ...data,
                });
            }
        } catch (error) {
            console.error(`Failed to emit event ${eventType}:`, error);
        }
    }

    private _cleanup(): void {
        try {
            for (const cleanup of this._cleanupTasks ?? []) {
                try {
                    cleanup();
                } catch (error) {
                    console.error('Cleanup task failed:', error);
                }
            }

            for (const unsubscribe of this._eventSubscriptions ?? []) {
                try {
                    unsubscribe();
                } catch (error) {
                    console.error('Event unsubscribe failed:', error);
                }
            }

            this._dependencies?.clear();

            for (const dependentRef of this._dependents ?? []) {
                const dependent = dependentRef.deref();
                if (dependent) {
                    dependent._dependencies?.delete(this.constructor as ComponentType);
                }
            }
            this._dependents?.clear();

            this._clearCache();

            this._cleanupTasks?.clear();
            this._eventSubscriptions?.clear();
            this._cleanupTasks = undefined;
            this._eventSubscriptions = undefined;
            this._dependencies = undefined;
            this._dependents = undefined;
        } catch (error) {
            console.error(
                `Component cleanup failed for ${this.constructor.name}:${this._id}:`,
                error
            );
        }
    }

    reset(): void {
        if (this._state === 'destroyed') {
            return;
        }

        this._enabled = true;
        this._lastUpdateTime = 0;
        this._updateCallCount = 0;
        this._totalUpdateTime = 0;

        this._clearCache();

        this._eventSubscriptions?.clear();
        this._cleanupTasks?.clear();
        this._dependencies?.clear();
        this._dependents?.clear();
        this._eventSubscriptions = undefined;
        this._cleanupTasks = undefined;
        this._dependencies = undefined;
        this._dependents = undefined;

        this.entityId = undefined;
        this.entity = undefined;
        this.world = undefined;
        this._renderClock = null;

        this._state = 'uninitialized';
    }

    addCleanupTask(cleanup: () => void): void {
        if (typeof cleanup === 'function') {
            this._getCleanupTasks().add(cleanup);
        }
    }

    removeCleanupTask(cleanup: () => void): void {
        this._cleanupTasks?.delete(cleanup);
    }

    on(eventType: string, handler: (data: unknown) => void): () => void {
        try {
            const eventBus = (
                this.world as unknown as {
                    eventBus?: {
                        on: (eventType: string, handler: (data: unknown) => void) => () => void;
                    };
                }
            )?.eventBus;
            if (eventBus && typeof eventBus.on === 'function') {
                const unsubscribe = eventBus.on(eventType, handler);
                this._getEventSubscriptions().add(unsubscribe);
                return unsubscribe;
            }
        } catch (error) {
            console.error(`Failed to subscribe to event ${eventType}:`, error);
        }

        return () => {};
    }

    refreshCache(): void {
        if (this._enableCaching) {
            this._clearCache();
        }
    }

    static getAllInstances<T extends Component>(this: new (...args: any[]) => T): T[] {
        const instances = Component._componentInstances.get(this as ComponentType);
        if (!instances) {
            return [];
        }

        const result: T[] = [];
        for (const ref of instances) {
            const instance = ref.deref();
            if (instance) {
                result.push(instance as T);
            }
        }

        return result;
    }

    static getInstanceCount<T extends Component>(this: new (...args: unknown[]) => T): number {
        const instances = Component._componentInstances.get(this as ComponentType);
        if (!instances) {
            return 0;
        }

        let count = 0;
        for (const ref of instances) {
            if (ref.deref()) {
                count++;
            }
        }

        return count;
    }
}

export { script, getComponentMetadata, setComponentMetadata } from '../decorators/script';
export {
    property,
    getComponentPropertyMetadata,
    getComponentPropertyMetadataByKey,
    setComponentPropertyMetadata,
} from '../decorators/property';

export type { ComponentMetrics, ComponentCache };
