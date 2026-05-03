import { MemoryPool, MemoryPoolOptions, PoolableObject } from './mempool';

export interface PoolableWrapper<T> extends PoolableObject {
    readonly value: T;
    readonly isWrapped: true;
}

export interface ObjectPoolOptions<T>
    extends Omit<MemoryPoolOptions<PoolableWrapper<T>>, 'factory' | 'asyncFactory'> {
    readonly factory: () => T;
    readonly asyncFactory?: () => Promise<T>;
    readonly resetHandler?: (obj: T) => void;
    readonly validateHandler?: (obj: T) => boolean;
    readonly onAcquireHandler?: (obj: T) => void;
    readonly onReleaseHandler?: (obj: T) => void;
    readonly onEvictHandler?: (obj: T) => void;
}

type ObjectPoolState = 'active' | 'draining' | 'disposed';

const enum ObjectPoolInternalError {
    INVALID_STATE = 'INVALID_STATE',
    WRAPPER_CORRUPTION = 'WRAPPER_CORRUPTION',
    FACTORY_ERROR = 'FACTORY_ERROR',
}

class ObjectPoolError extends Error {
    readonly code: ObjectPoolInternalError;
    readonly timestamp: number;

    constructor(message: string, code: ObjectPoolInternalError) {
        super(message);
        this.name = 'ObjectPoolError';
        this.code = code;
        this.timestamp = performance.now();
        Object.setPrototypeOf(this, ObjectPoolError.prototype);
    }
}

const createWrapper = <T>(value: T, resetHandler?: (obj: T) => void): PoolableWrapper<T> => {
    const wrapper: PoolableWrapper<T> = {
        value,
        isWrapped: true as const,
        reset(): void {
            if (resetHandler) {
                resetHandler(value);
            } else if (typeof (value as any)?.reset === 'function') {
                (value as any).reset();
            }
        },
    };

    return wrapper;
};

export class ObjectPool<T extends {}> implements Disposable {
    private readonly _pool: MemoryPool<PoolableWrapper<T>>;
    private readonly _options: Required<
        Omit<
            ObjectPoolOptions<T>,
            | 'asyncFactory'
            | 'resetHandler'
            | 'validateHandler'
            | 'onAcquireHandler'
            | 'onReleaseHandler'
            | 'onEvictHandler'
        >
    > &
        Pick<
            ObjectPoolOptions<T>,
            | 'asyncFactory'
            | 'resetHandler'
            | 'validateHandler'
            | 'onAcquireHandler'
            | 'onReleaseHandler'
            | 'onEvictHandler'
        >;
    private _state: ObjectPoolState = 'active';
    private readonly _activeObjects = new WeakSet<T>();

    constructor(options: ObjectPoolOptions<T>) {
        this._options = {
            initialCapacity: options.initialCapacity ?? 16,
            maxCapacity: options.maxCapacity ?? 1024,
            minFree: options.minFree ?? 0,
            highWatermarkRatio: options.highWatermarkRatio ?? 0.85,
            lowWatermarkRatio: options.lowWatermarkRatio ?? 0.15,
            expansionStrategy: options.expansionStrategy ?? 'multiplicative',
            expansionFactor: options.expansionFactor ?? 1.5,
            expansionRate: options.expansionRate ?? 0,
            allocationStrategy: options.allocationStrategy ?? 'first-available',
            evictionPolicy: options.evictionPolicy ?? 'lru',
            ttl: options.ttl ?? 0,
            factory: options.factory,
            resetOnRecycle: options.resetOnRecycle ?? true,
            preallocate: options.preallocate ?? false,
            autoExpand: options.autoExpand ?? true,
            compactionThreshold: options.compactionThreshold ?? 64,
            compactionTriggerRatio: options.compactionTriggerRatio ?? 0.3,
            enableMetrics: options.enableMetrics ?? true,
            enableInstrumentation: options.enableInstrumentation ?? false,
            name: options.name ?? `ObjectPool-${Date.now()}`,
            maxObjectAge: options.maxObjectAge ?? 0,
            threadSafe: options.threadSafe ?? false,
            asyncFactory: options.asyncFactory,
            resetHandler: options.resetHandler,
            validateHandler: options.validateHandler,
            onAcquireHandler: options.onAcquireHandler,
            onReleaseHandler: options.onReleaseHandler,
            onEvictHandler: options.onEvictHandler,

            validator: () => true,
            onAcquire: () => {},
            onRelease: () => {},
            onEvict: () => {},
            onOutOfMemory: () => {},
        };

        const poolOptions: MemoryPoolOptions<PoolableWrapper<T>> = {
            ...this._options,
            factory: this._createWrapperFactory(),
            asyncFactory: this._options.asyncFactory
                ? this._createAsyncWrapperFactory()
                : undefined,
            validator: this._createValidator(),
            onAcquire: this._createOnAcquireHandler(),
            onRelease: this._createOnReleaseHandler(),
            onEvict: this._createOnEvictHandler(),
        };

        this._pool = new MemoryPool(poolOptions);
    }

    public acquire(): T {
        this._assertActive();

        const wrapper = this._pool.acquire();
        const obj = wrapper.value;

        this._activeObjects.add(obj);

        return obj;
    }

    public release(obj: T): void {
        if (this._state === 'disposed') {
            return;
        }

        if (!this._activeObjects.has(obj)) {
            throw new ObjectPoolError(
                'Object not acquired from this pool',
                ObjectPoolInternalError.INVALID_STATE
            );
        }

        const wrapper = this._findWrapper(obj);
        if (!wrapper) {
            throw new ObjectPoolError(
                'Wrapper not found for object',
                ObjectPoolInternalError.WRAPPER_CORRUPTION
            );
        }

        this._activeObjects.delete(obj);
        this._pool.release(wrapper);
    }

    public tryAcquire(): T | null {
        if (this._state !== 'active') {
            return null;
        }

        const wrapper = this._pool.tryAcquire();
        if (!wrapper) {
            return null;
        }

        const obj = wrapper.value;
        this._activeObjects.add(obj);

        return obj;
    }

    public async acquireAsync(): Promise<T> {
        this._assertActive();

        const wrapper = await this._pool.acquireAsync();
        const obj = wrapper.value;

        this._activeObjects.add(obj);

        return obj;
    }

    public async releaseAsync(obj: T): Promise<void> {
        if (this._state === 'disposed') {
            return;
        }

        if (!this._activeObjects.has(obj)) {
            throw new ObjectPoolError(
                'Object not acquired from this pool',
                ObjectPoolInternalError.INVALID_STATE
            );
        }

        const wrapper = this._findWrapper(obj);
        if (!wrapper) {
            throw new ObjectPoolError(
                'Wrapper not found for object',
                ObjectPoolInternalError.WRAPPER_CORRUPTION
            );
        }

        this._activeObjects.delete(obj);
        await this._pool.releaseAsync(wrapper);
    }

    public async tryAcquireAsync(timeoutMs?: number): Promise<T | null> {
        if (this._state !== 'active') {
            return null;
        }

        const wrapper = await this._pool.tryAcquireAsync(timeoutMs);
        if (!wrapper) {
            return null;
        }

        const obj = wrapper.value;
        this._activeObjects.add(obj);

        return obj;
    }

    public releaseAll(): void {
        if (this._state === 'disposed') {
            return;
        }

        this._pool.releaseAll();
    }

    public async releaseAllAsync(): Promise<void> {
        if (this._state === 'disposed') {
            return;
        }

        await this._pool.releaseAllAsync();
    }

    public clear(): void {
        this._assertActive();
        this._pool.clear();
    }

    public async clearAsync(): Promise<void> {
        this._assertActive();
        await this._pool.clearAsync();
    }

    public drain(): void {
        if (this._state === 'disposed') {
            return;
        }

        this._state = 'draining';
        try {
            this._pool.drain();
        } finally {
            this._state = 'active';
        }
    }

    public async drainAsync(): Promise<void> {
        if (this._state === 'disposed') {
            return;
        }

        this._state = 'draining';
        try {
            await this._pool.drainAsync();
        } finally {
            this._state = 'active';
        }
    }

    public resize(newCapacity: number): void {
        this._assertActive();
        this._pool.resize(newCapacity);
    }

    public forceCompact(): void {
        this._assertActive();
        this._pool.forceCompact();
    }

    public isFromPool(obj: T): boolean {
        return this._activeObjects.has(obj);
    }

    public getAvailableCount(): number {
        return this._pool.getAvailableCount();
    }

    public getAllocatedCount(): number {
        return this._pool.getAllocatedCount();
    }

    public getTotalCount(): number {
        return this._pool.getTotalCount();
    }

    public getMetrics() {
        return this._pool.getMetrics();
    }

    public get state(): ObjectPoolState {
        return this._state;
    }

    public get name(): string {
        return this._options.name;
    }

    public [Symbol.dispose](): void {
        if (this._state === 'disposed') {
            return;
        }

        this._state = 'disposed';
        this._pool[Symbol.dispose]();
    }

    private _assertActive(): void {
        if (this._state !== 'active') {
            throw new ObjectPoolError(
                `Pool is ${this._state}`,
                ObjectPoolInternalError.INVALID_STATE
            );
        }
    }

    private _createWrapperFactory(): () => PoolableWrapper<T> {
        return () => {
            try {
                const obj = this._options.factory();
                return createWrapper(obj, this._options.resetHandler);
            } catch (error) {
                throw new ObjectPoolError(
                    `Factory failed: ${error}`,
                    ObjectPoolInternalError.FACTORY_ERROR
                );
            }
        };
    }

    private _createAsyncWrapperFactory(): () => Promise<PoolableWrapper<T>> {
        return async () => {
            try {
                const obj = await this._options.asyncFactory!();
                return createWrapper(obj, this._options.resetHandler);
            } catch (error) {
                throw new ObjectPoolError(
                    `Async factory failed: ${error}`,
                    ObjectPoolInternalError.FACTORY_ERROR
                );
            }
        };
    }

    private _createValidator(): (wrapper: PoolableWrapper<T>) => boolean {
        if (!this._options.validateHandler) {
            return () => true;
        }

        return (wrapper: PoolableWrapper<T>) => {
            try {
                return this._options.validateHandler!(wrapper.value);
            } catch {
                return false;
            }
        };
    }

    private _createOnAcquireHandler(): (wrapper: PoolableWrapper<T>) => void {
        if (!this._options.onAcquireHandler) {
            return () => {};
        }

        return (wrapper: PoolableWrapper<T>) => {
            try {
                this._options.onAcquireHandler!(wrapper.value);
            } catch (error) {
                console.warn(`onAcquire handler error in pool "${this._options.name}":`, error);
            }
        };
    }

    private _createOnReleaseHandler(): (wrapper: PoolableWrapper<T>) => void {
        if (!this._options.onReleaseHandler) {
            return () => {};
        }

        return (wrapper: PoolableWrapper<T>) => {
            try {
                this._options.onReleaseHandler!(wrapper.value);
            } catch (error) {
                console.warn(`onRelease handler error in pool "${this._options.name}":`, error);
            }
        };
    }

    private _createOnEvictHandler(): (wrapper: PoolableWrapper<T>) => void {
        if (!this._options.onEvictHandler) {
            return () => {};
        }

        return (wrapper: PoolableWrapper<T>) => {
            try {
                this._options.onEvictHandler!(wrapper.value);
            } catch (error) {
                console.warn(`onEvict handler error in pool "${this._options.name}":`, error);
            }
        };
    }

    private _findWrapper(obj: T): PoolableWrapper<T> | null {
        for (let i = 0; i < this._pool.getTotalCount(); i++) {
            try {
                const slot = (this._pool as any)._slots[i];
                if (slot?.obj?.value === obj) {
                    return slot.obj;
                }
            } catch {
                continue;
            }
        }
        return null;
    }
}

export type { PoolableObject, MemoryPoolOptions, PoolPerformanceMetrics } from './mempool';
