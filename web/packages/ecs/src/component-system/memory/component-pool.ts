import type { ComponentConstructor, Entity } from '../types/core';
import type { IComponentPool } from '../types/component';
import { ObjectPool, type ObjectPoolOptions } from '@axrone/utility';

export interface ComponentPoolConfig<T = any> {
    initialCapacity?: number;
    maxCapacity?: number;
    minFree?: number;
    enableMetrics?: boolean;
    enableValidation?: boolean;
    ttl?: number;
    resetHandler?: (component: T) => void;
    name?: string;
}

export class ComponentPool<T extends {}> implements IComponentPool<T> {
    readonly dense: T[] = [];
    readonly sparse: (number | undefined)[] = [];
    readonly entities: Entity[] = [];

    size = 0;
    capacity = 0;

    private readonly componentConstructor: ComponentConstructor<T>;
    private readonly objectPool: ObjectPool<T>;
    private readonly config: Required<ComponentPoolConfig<T>>;

    constructor(constructor: ComponentConstructor<T>, config: ComponentPoolConfig<T> = {}) {
        this.componentConstructor = constructor;

        this.config = {
            initialCapacity: config.initialCapacity ?? 32,
            maxCapacity: config.maxCapacity ?? 2048,
            minFree: config.minFree ?? 8,
            enableMetrics: config.enableMetrics ?? true,
            enableValidation: config.enableValidation ?? true,
            ttl: config.ttl ?? 300000,
            resetHandler: config.resetHandler ?? this.defaultResetHandler.bind(this),
            name: config.name ?? `ComponentPool<${constructor.name}>`,
        };

        const poolOptions: ObjectPoolOptions<T> = {
            initialCapacity: this.config.initialCapacity,
            maxCapacity: this.config.maxCapacity,
            minFree: this.config.minFree,
            factory: () => new this.componentConstructor(),
            resetHandler: this.config.resetHandler,
            validateHandler: this.config.enableValidation
                ? this.validateComponent.bind(this)
                : undefined,

            expansionStrategy: 'multiplicative',
            expansionFactor: 1.5,
            allocationStrategy: 'least-recently-used',
            evictionPolicy: 'lru',
            ttl: this.config.ttl,

            resetOnRecycle: true,
            preallocate: true,
            autoExpand: true,
            compactionThreshold: 64,
            compactionTriggerRatio: 0.3,

            enableMetrics: this.config.enableMetrics,
            enableInstrumentation: false,
            name: this.config.name,

            onAcquireHandler: this.onComponentAcquired.bind(this),
            onReleaseHandler: this.onComponentReleased.bind(this),
            onEvictHandler: this.onComponentEvicted.bind(this),
        };

        this.objectPool = new ObjectPool(poolOptions);
        this.capacity = this.config.initialCapacity;
    }

    acquire(): T {
        try {
            const component = this.objectPool.acquire();
            this.size++;
            return component;
        } catch (error) {
            console.error(`Failed to acquire component from ${this.config.name}:`, error);

            return new this.componentConstructor();
        }
    }

    tryAcquire(): T | null {
        try {
            const component = this.objectPool.tryAcquire();
            if (component) {
                this.size++;
            }
            return component;
        } catch (error) {
            console.warn(`Failed to try acquire component from ${this.config.name}:`, error);
            return null;
        }
    }

    async acquireAsync(): Promise<T> {
        try {
            const component = await this.objectPool.acquireAsync();
            this.size++;
            return component;
        } catch (error) {
            console.error(`Failed to acquire component async from ${this.config.name}:`, error);

            return new this.componentConstructor();
        }
    }

    release(item: T): void {
        try {
            if (this.objectPool.isFromPool(item)) {
                this.objectPool.release(item);
                this.size = Math.max(0, this.size - 1);
            } else {
                this.config.resetHandler(item);
            }
        } catch (error) {
            console.error(`Failed to release component to ${this.config.name}:`, error);
        }
    }

    async releaseAsync(item: T): Promise<void> {
        try {
            if (this.objectPool.isFromPool(item)) {
                await this.objectPool.releaseAsync(item);
                this.size = Math.max(0, this.size - 1);
            } else {
                this.config.resetHandler(item);
            }
        } catch (error) {
            console.error(`Failed to release component async to ${this.config.name}:`, error);
        }
    }

    grow(): void {
        const newCapacity = Math.min(Math.floor(this.capacity * 1.5), this.config.maxCapacity);

        if (newCapacity > this.capacity) {
            this.objectPool.resize(newCapacity);
            this.capacity = newCapacity;
        }
    }

    clear(): void {
        try {
            this.objectPool.clear();
            this.dense.length = 0;
            this.entities.length = 0;
            this.size = 0;

            this.sparse.length = 0;
        } catch (error) {
            console.error(`Failed to clear ${this.config.name}:`, error);
        }
    }

    drain(): void {
        try {
            this.objectPool.drain();
        } catch (error) {
            console.error(`Failed to drain ${this.config.name}:`, error);
        }
    }

    compact(): void {
        try {
            this.objectPool.forceCompact();
        } catch (error) {
            console.error(`Failed to compact ${this.config.name}:`, error);
        }
    }

    getMetrics() {
        if (!this.config.enableMetrics) {
            return null;
        }

        try {
            return this.objectPool.getMetrics();
        } catch (error) {
            console.error(`Failed to get metrics from ${this.config.name}:`, error);
            return null;
        }
    }

    getAvailableCount(): number {
        return this.objectPool.getAvailableCount();
    }

    getAllocatedCount(): number {
        return this.objectPool.getAllocatedCount();
    }

    getTotalCount(): number {
        return this.objectPool.getTotalCount();
    }

    isFromPool(item: T): boolean {
        return this.objectPool.isFromPool(item);
    }

    dispose(): void {
        try {
            this.objectPool[Symbol.dispose]();
        } catch (error) {
            console.error(`Failed to dispose ${this.config.name}:`, error);
        }
    }

    private defaultResetHandler(component: T): void {
        if (typeof component === 'object' && component !== null) {
            if (typeof (component as any).reset === 'function') {
                try {
                    (component as any).reset();
                } catch (error) {
                    console.warn(`Component reset method failed:`, error);
                }
            } else {
                const keys = Object.keys(component);
                for (const key of keys) {
                    const descriptor = Object.getOwnPropertyDescriptor(component, key);
                    if (descriptor && descriptor.writable && !key.startsWith('_')) {
                        try {
                            if (typeof (component as any)[key] === 'number') {
                                (component as any)[key] = 0;
                            } else if (typeof (component as any)[key] === 'string') {
                                (component as any)[key] = '';
                            } else if (typeof (component as any)[key] === 'boolean') {
                                (component as any)[key] = false;
                            } else {
                                (component as any)[key] = undefined;
                            }
                        } catch (error) {
                            // Ignore read-only properties
                        }
                    }
                }
            }
        }
    }

    private validateComponent(component: T): boolean {
        if (!component) {
            return false;
        }

        if (!(component instanceof this.componentConstructor)) {
            return false;
        }

        if (typeof (component as any).validate === 'function') {
            try {
                const result = (component as any).validate();
                if (result === false && (component as any)._state === 'destroyed') {
                    return false;
                }
                return true;
            } catch (error) {
                console.warn(`Component validation failed:`, error);
                return false;
            }
        }

        return true;
    }

    private onComponentAcquired(component: T): void {
        if (typeof (component as any).onPoolAcquire === 'function') {
            try {
                (component as any).onPoolAcquire();
            } catch (error) {
                console.warn(`Component onPoolAcquire failed:`, error);
            }
        }
    }

    private onComponentReleased(component: T): void {
        if (typeof (component as any).onPoolRelease === 'function') {
            try {
                (component as any).onPoolRelease();
            } catch (error) {
                console.warn(`Component onPoolRelease failed:`, error);
            }
        }
    }

    private onComponentEvicted(component: T): void {
        if (typeof (component as any).onPoolEvict === 'function') {
            try {
                (component as any).onPoolEvict();
            } catch (error) {
                console.warn(`Component onPoolEvict failed:`, error);
            }
        }
    }
}
