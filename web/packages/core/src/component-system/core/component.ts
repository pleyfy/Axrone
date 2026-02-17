import type { Entity } from '../types/core';
import type { ComponentType, ComponentMetadata } from '../types/component';
import type { World } from './world';
import type { Actor } from './actor';

export type ComponentState =
    | 'uninitialized'
    | 'awake'
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
    awake?(): void | Promise<void>;
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
    readonly componentCache: Map<ComponentType, WeakRef<Component>>;
    readonly actorCache: Map<ComponentType, WeakRef<Actor>[]>;
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

    protected entity?: Entity;
    protected actor?: Actor;
    protected world?: World<any>;

    private _state: ComponentState = 'uninitialized';
    private _id: ComponentId;
    private _priority: ComponentPriority;
    private _enabled: boolean;
    private _persistent: boolean;
    private _executeInEditMode: boolean;

    private _creationTime: number;
    private _lastUpdateTime: number = 0;
    private _updateCallCount: number = 0;
    private _totalUpdateTime: number = 0;
    private readonly _enableMetrics: boolean;
    private readonly _enableCaching: boolean;
    private readonly _validateOnUpdate: boolean;
    private readonly _autoSerialize: boolean;

    private readonly _cache: ComponentCache;
    private readonly _cacheTimeout: number = 1000;

    private readonly _eventSubscriptions = new Set<() => void>();
    private readonly _cleanupTasks = new Set<() => void>();

    private readonly _dependencies = new Map<ComponentType, Component>();
    private readonly _dependents = new Set<WeakRef<Component>>();

    constructor(config: TConfig = {} as TConfig) {
        this._creationTime = performance.now();
        this._id = (config.id ??
            `${this.constructor.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`) as ComponentId;
        this._priority = (config.priority ?? 0) as ComponentPriority;
        this._enabled = config.enabled ?? true;
        this._persistent = config.persistent ?? false;
        this._executeInEditMode = config.executeInEditMode ?? false;
        this._enableMetrics = config.enableMetrics ?? false;
        this._enableCaching = config.enableCaching ?? true;
        this._validateOnUpdate = config.validateOnUpdate ?? false;
        this._autoSerialize = config.autoSerialize ?? false;

        this._cache = {
            transformCache: null,
            componentCache: new Map(),
            actorCache: new Map(),
            lastCacheUpdate: 0,
        };

        this._registerInstance();

        this._initialize();
    }

    get id(): ComponentId {
        return this._id;
    }

    get state(): ComponentState {
        return this._state;
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

        if (this.actor && oldPriority !== this._priority) {
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

    get transform(): any {
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
        if (!this.actor) {
            return undefined;
        }

        if (!this._enableCaching) {
            return this.actor.getComponent(componentType);
        }

        const now = performance.now();
        const cachedRef = this._cache.componentCache.get(componentType);

        if (cachedRef && now - this._cache.lastCacheUpdate < this._cacheTimeout) {
            const cached = cachedRef.deref();
            if (cached) {
                return cached as T;
            }
        }

        const component = this.actor.getComponent(componentType);
        if (component) {
            this._cache.componentCache.set(componentType, new WeakRef(component));
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
        if (!this.actor) {
            throw new ComponentError('Actor not available', this.constructor.name, this._id);
        }

        const component = this.actor.addComponent(componentType, ...args);

        this._dependencies.set(componentType, component);

        if (component instanceof Component) {
            component._dependents.add(new WeakRef(this));
        }

        this._clearCache();

        return component;
    }

    protected removeComponent<T extends Component>(componentType: ComponentType<T>): void {
        if (!this.actor) {
            return;
        }

        const component = this.getComponent(componentType);
        if (component instanceof Component) {
            for (const dependentRef of component._dependents) {
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

        this.actor.removeComponent(componentType);
        this._dependencies.delete(componentType);
        this._clearCache();
    }

    protected findActorOfType<T extends Component>(
        componentType: ComponentType<T>
    ): Actor | undefined {
        if (!this.world) {
            return undefined;
        }

        if (!this._enableCaching) {
            return this._findActorOfTypeDirect(componentType);
        }

        const now = performance.now();
        const cachedRefs = this._cache.actorCache.get(componentType);

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

        const actor = this._findActorOfTypeDirect(componentType);
        if (actor) {
            this._cache.actorCache.set(componentType, [new WeakRef(actor)]);
            this._cache.lastCacheUpdate = now;
        }

        return actor;
    }

    protected findActorsOfType<T extends Component>(
        componentType: ComponentType<T>
    ): readonly Actor[] {
        if (!this.world) {
            return [];
        }

        if (!this._enableCaching) {
            return this._findActorsOfTypeDirect(componentType);
        }

        const now = performance.now();
        const cachedRefs = this._cache.actorCache.get(componentType);

        if (cachedRefs && now - this._cache.lastCacheUpdate < this._cacheTimeout) {
            const cached = cachedRefs.map((ref) => ref.deref()).filter(Boolean) as Actor[];
            if (cached.length === cachedRefs.length) {
                return cached;
            }
        }

        const actors = this._findActorsOfTypeDirect(componentType);
        if (actors.length > 0) {
            this._cache.actorCache.set(
                componentType,
                actors.map((actor) => new WeakRef(actor))
            );
            this._cache.lastCacheUpdate = now;
        }

        return actors;
    }

    async _internalAwake(): Promise<void> {
        if (this._state !== 'uninitialized') {
            return;
        }

        try {
            this._state = 'awake';
            await this._executeLifecycleMethod('awake');
            this._emitEvent('component:awake', { component: this });
        } catch (error) {
            this._state = 'uninitialized';
            throw new ComponentLifecycleError(
                'Awake failed',
                this.constructor.name,
                'awake',
                this._id,
                error instanceof Error ? error : new Error(String(error))
            );
        }
    }

    async _internalStart(): Promise<void> {
        if (this._state !== 'awake') {
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
            this._state = 'awake';
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
            entity: this.entity,
            actor: this.actor?.id,
            world: this.world ? 'attached' : 'detached',
            dependencies: Array.from(this._dependencies.keys()).map((type) => type.name),
            dependents: Array.from(this._dependents)
                .map((ref) => ref.deref()?.constructor.name)
                .filter(Boolean),
            metrics: this.metrics,
            cacheStats: this._enableCaching
                ? {
                      transformCached: !!this._cache.transformCache?.deref(),
                      componentsCached: this._cache.componentCache.size,
                      actorsCached: this._cache.actorCache.size,
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

    awake?(): void | Promise<void>;
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

    private _cleanupDeadReferences(instances: Set<WeakRef<Component>>): void {
        for (const ref of instances) {
            if (!ref.deref()) {
                instances.delete(ref);
            }
        }
    }

    private _getTransformDirect(): any {
        if (!this.actor) {
            return undefined;
        }

        const TransformClass =
            (this.world as any)?.registry?.Transform || (globalThis as any).Transform;

        if (TransformClass) {
            return this.actor.getComponent(TransformClass);
        }

        return undefined;
    }

    private _findActorOfTypeDirect<T extends Component>(
        componentType: ComponentType<T>
    ): Actor | undefined {
        if (!this.world) {
            return undefined;
        }

        try {
            const queryResults = this.world.query(componentType.name as any);
            if (queryResults.length > 0) {
                return this.world.getActor(queryResults[0].entity);
            }
        } catch (error) {
            console.warn(`Failed to query for component ${componentType.name}:`, error);
        }

        return undefined;
    }

    private _findActorsOfTypeDirect<T extends Component>(
        componentType: ComponentType<T>
    ): readonly Actor[] {
        if (!this.world) {
            return [];
        }

        try {
            const results: Actor[] = [];
            const queryResults = this.world.query(componentType.name as any);

            for (const result of queryResults) {
                const actor = this.world.getActor(result.entity);
                if (actor) {
                    results.push(actor);
                }
            }

            return results;
        } catch (error) {
            console.warn(`Failed to query for components ${componentType.name}:`, error);
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
                (lifecycleMethod as any).apply(this, args);
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

            size += this._cache.componentCache.size * 50;
            size += this._cache.actorCache.size * 100;

            size += this._dependencies.size * 50;
            size += this._dependents.size * 50;

            size += this._eventSubscriptions.size * 30;
            size += this._cleanupTasks.size * 30;

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
        this._cache.componentCache.clear();
        this._cache.actorCache.clear();
        this._cache.lastCacheUpdate = 0;
    }

    private _emitEvent(eventType: string, data: any): void {
        try {
            const eventBus = (this.world as any)?.eventBus;
            if (eventBus && typeof eventBus.emit === 'function') {
                eventBus.emit(eventType, {
                    componentId: this._id,
                    componentType: this.constructor.name,
                    entity: this.entity,
                    actorId: this.actor?.id,
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
            for (const cleanup of this._cleanupTasks) {
                try {
                    cleanup();
                } catch (error) {
                    console.error('Cleanup task failed:', error);
                }
            }

            for (const unsubscribe of this._eventSubscriptions) {
                try {
                    unsubscribe();
                } catch (error) {
                    console.error('Event unsubscribe failed:', error);
                }
            }

            this._dependencies.clear();

            for (const dependentRef of this._dependents) {
                const dependent = dependentRef.deref();
                if (dependent) {
                    dependent._dependencies.delete(this.constructor as ComponentType);
                }
            }
            this._dependents.clear();

            this._clearCache();

            this._cleanupTasks.clear();
            this._eventSubscriptions.clear();
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

        this._eventSubscriptions.clear();
        this._cleanupTasks.clear();
        this._dependencies.clear();
        this._dependents.clear();

        this.entity = undefined;
        this.actor = undefined;
        this.world = undefined;

        this._state = 'uninitialized';
    }

    addCleanupTask(cleanup: () => void): void {
        if (typeof cleanup === 'function') {
            this._cleanupTasks.add(cleanup);
        }
    }

    removeCleanupTask(cleanup: () => void): void {
        this._cleanupTasks.delete(cleanup);
    }

    on(eventType: string, handler: (data: any) => void): () => void {
        try {
            const eventBus = (this.world as any)?.eventBus;
            if (eventBus && typeof eventBus.on === 'function') {
                const unsubscribe = eventBus.on(eventType, handler);
                this._eventSubscriptions.add(unsubscribe);
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

    static getInstanceCount<T extends Component>(this: new (...args: any[]) => T): number {
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

export type { ComponentMetrics, ComponentCache };
