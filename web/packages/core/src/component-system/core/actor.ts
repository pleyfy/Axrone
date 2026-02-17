import type { Entity, ActorId } from '../types/core';
import type { ComponentType, ComponentMetadata } from '../types/component';
import type { World } from './world';
import { Component, getComponentMetadata } from './component';

export interface EventBus {
    emit(eventType: string, data: any): void;
    on(eventType: string, handler: (data: any) => void): () => void;
}

export type ActorState = 'initializing' | 'active' | 'inactive' | 'destroying' | 'destroyed';
export type ActorLayer = number & { readonly __brand: unique symbol };
export type ActorTag = string & { readonly __brand: unique symbol };

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

export class Actor<
    TWorld extends World<any> = World<any>,
    TComponents extends readonly ComponentType[] = readonly ComponentType[],
> {
    private static readonly _componentMetadataMap = new WeakMap<ComponentType, ComponentMetadata>();

    public readonly entity: Entity;
    public readonly world: TWorld;
    public readonly id: ActorId;
    public readonly creationTime: number;

    private _state: ActorState = 'initializing';
    private _name: string;
    private _active: boolean;
    private _layer: ActorLayer;
    private _tag: ActorTag;
    private _persistent: boolean;
    private _pooled: boolean;

    private readonly _components = new Map<ComponentType, Component>();
    private readonly _componentDependencies = new Map<ComponentType, Set<ComponentType>>();
    private readonly _componentPriorities = new Map<ComponentType, number>();
    private readonly _maxComponents: number;

    private _started = false;
    private _destroyed = false;

    private readonly _eventBus: EventBus | null;
    private readonly _eventSubscriptions = new Set<() => void>();

    private readonly _cleanupTasks = new Set<() => void>();
    private _updateFrame = 0;

    constructor(world: TWorld, config: ActorConfig = {}) {
        if (!world || typeof world !== 'object') {
            throw new ActorError('Invalid world instance provided', '' as ActorId, 'constructor');
        }

        this.world = world;
        this.entity = world.createEntity();
        this.creationTime = performance.now();

        this._name = config.name ?? 'Actor';
        this.id = `${this._name}_${this.entity}_${Date.now()}` as ActorId;
        this._active = config.active ?? true;
        this._layer = (config.layer ?? 0) as ActorLayer;
        this._tag = (config.tag ?? 'Default') as ActorTag;
        this._persistent = config.persistent ?? false;
        this._pooled = config.pooled ?? false;
        this._maxComponents = config.maxComponents ?? 64;

        this._eventBus = (world as any).eventBus || null;

        try {
            world.registerActor(this.entity, this);

            this._initializeTransformComponent();

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
            try {
                const sortedComponents = this._getSortedComponents();

                for (const [componentType, component] of sortedComponents) {
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

    addComponent<T extends Component>(componentType: ComponentType<T>, ...args: any[]): T {
        this._validateNotDestroyed('addComponent');

        if (!componentType || typeof componentType !== 'function') {
            throw new ComponentError(
                'Invalid component type provided',
                this.id,
                (componentType as any)?.name ?? 'unknown'
            );
        }

        if (this._components.size >= this._maxComponents) {
            throw new ComponentError(
                `Maximum component limit (${this._maxComponents}) reached`,
                this.id,
                componentType.name
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
                componentType.name
            );
        }

        try {
            const metadata = this._getComponentMetadata(componentType);
            if (metadata?.dependencies) {
                this._resolveDependencies(componentType, metadata.dependencies as ComponentType[]);
            }

            const component = new componentType(...args);

            (component as any).entity = this.entity;
            (component as any).actor = this;
            (component as any).world = this.world;

            this._components.set(componentType, component);
            this._componentPriorities.set(componentType, metadata?.priority ?? 0);

            this.world.addComponent(this.entity, componentType.name as any, component);

            this._executeComponentLifecycle(component, 'awake');

            if (this._started) {
                this._executeComponentLifecycle(component, 'start');
            }

            if (this._active) {
                this._executeComponentLifecycle(component, 'onEnable');
            }

            this._emitEvent('actor:componentAdded', {
                componentType: componentType.name,
                component,
            });

            return component;
        } catch (error) {
            throw new ComponentError(
                'Failed to add component',
                this.id,
                componentType.name,
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
            this._componentDependencies.delete(componentType);

            this.world.removeComponent(this.entity, componentType.name as any);

            this._emitEvent('actor:componentRemoved', {
                componentType: componentType.name,
                component,
            });

            return true;
        } catch (error) {
            throw new ComponentError(
                'Failed to remove component',
                this.id,
                componentType.name,
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
            throw new ComponentError('Required component not found', this.id, componentType.name);
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

            const sortedComponents = this._getSortedComponents();

            for (const [componentType, component] of sortedComponents) {
                try {
                    this._executeComponentLifecycle(component, 'start');
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

            const sortedComponents = this._getSortedComponents();

            for (const [componentType, component] of sortedComponents) {
                try {
                    if (component.update) {
                        component.update(deltaTime);
                    }
                } catch (error) {
                    console.error(
                        new ComponentError(
                            'Component update failed',
                            this.id,
                            componentType.name,
                            error instanceof Error ? error : new Error(String(error))
                        )
                    );
                }
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

    destroy(immediate: boolean = false): void {
        if (this._destroyed) {
            return;
        }

        try {
            this._state = 'destroying';

            this._emitEvent('actor:destroying', { actor: this, immediate });

            const sortedComponents = this._getSortedComponents().reverse();

            for (const [componentType, component] of sortedComponents) {
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

            this._components.clear();
            this._componentDependencies.clear();
            this._componentPriorities.clear();
            this._cleanupTasks.clear();
            this._eventSubscriptions.clear();

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

    private _initializeTransformComponent(): void {
        try {
            const TransformClass =
                (this.world as any).registry?.Transform || (globalThis as any).Transform;

            if (TransformClass) {
                this.addComponent(TransformClass);
            } else {
                console.warn(
                    `[Actor:${this.id}] Transform component not found in registry. ` +
                        'Every Actor should have a Transform component for spatial operations.'
                );
            }
        } catch (error) {
            console.error(
                new ComponentError(
                    'Failed to initialize Transform component',
                    this.id,
                    'Transform',
                    error instanceof Error ? error : new Error(String(error))
                )
            );
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

    private _getSortedComponents(): Array<[ComponentType, Component]> {
        return Array.from(this._components.entries()).sort(([typeA], [typeB]) => {
            const priorityA = this._componentPriorities.get(typeA) ?? 0;
            const priorityB = this._componentPriorities.get(typeB) ?? 0;
            return priorityB - priorityA;
        });
    }

    private _resolveDependencies(
        componentType: ComponentType,
        dependencies: ComponentType[]
    ): void {
        const visited = new Set<ComponentType>();
        const resolving = new Set<ComponentType>();

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

        this._componentDependencies.set(componentType, new Set(dependencies));
    }

    private _checkComponentDependents(componentType: ComponentType): void {
        for (const [type, dependencies] of this._componentDependencies) {
            if (dependencies.has(componentType) && this._components.has(type)) {
                throw new ComponentError(
                    `Cannot remove component: ${type.name} depends on it`,
                    this.id,
                    componentType.name
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

    private _emitEvent(eventType: string, data: any): void {
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
            this._cleanupTasks.add(cleanup);
        }
    }

    on(eventType: string, handler: (data: any) => void): () => void {
        if (!this._eventBus || typeof this._eventBus.on !== 'function') {
            console.warn('Event bus not available');
            return () => {};
        }

        const unsubscribe = this._eventBus.on(eventType, handler);
        this._eventSubscriptions.add(unsubscribe);

        return () => {
            unsubscribe();
            this._eventSubscriptions.delete(unsubscribe);
        };
    }

    toString(): string {
        const componentNames = Array.from(this._components.keys()).map((type) => type.name);
        return `Actor(${this.id}) [${componentNames.join(', ')}] - ${this._state}`;
    }
}
