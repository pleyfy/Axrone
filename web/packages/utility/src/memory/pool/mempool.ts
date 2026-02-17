export type PoolObjectStatus = 'free' | 'allocated' | 'reserved';

export interface PoolableObject {
    __poolId?: number;
    __poolStatus?: PoolObjectStatus;
    __lastAccessed?: number;
    __allocCount?: number;
    reset(): void;
}

export type PoolExpansionStrategy = 'fixed' | 'multiplicative' | 'fibonacci' | 'prime';

export type PoolAllocationStrategy =
    | 'first-available'
    | 'least-recently-used'
    | 'most-recently-used'
    | 'round-robin';

export type PoolEvictionPolicy = 'none' | 'lru' | 'ttl' | 'fifo';

export interface MemoryPoolOptions<T extends PoolableObject> {
    readonly initialCapacity?: number;
    readonly maxCapacity?: number;
    readonly minFree?: number;
    readonly highWatermarkRatio?: number;
    readonly lowWatermarkRatio?: number;
    readonly expansionStrategy?: PoolExpansionStrategy;
    readonly expansionFactor?: number;
    readonly expansionRate?: number;
    readonly allocationStrategy?: PoolAllocationStrategy;
    readonly evictionPolicy?: PoolEvictionPolicy;
    readonly ttl?: number;
    readonly factory: () => T;
    readonly resetOnRecycle?: boolean;
    readonly validator?: (obj: T) => boolean;
    readonly preallocate?: boolean;
    readonly autoExpand?: boolean;
    readonly compactionThreshold?: number;
    readonly compactionTriggerRatio?: number;
    readonly onAcquire?: (obj: T) => void;
    readonly onRelease?: (obj: T) => void;
    readonly onEvict?: (obj: T) => void;
    readonly onOutOfMemory?: (requested: number, available: number) => void;
    readonly enableMetrics?: boolean;
    readonly enableInstrumentation?: boolean;
    readonly name?: string;
    readonly maxObjectAge?: number;
    readonly threadSafe?: boolean;
    readonly asyncFactory?: () => Promise<T>;
}

export interface PoolPerformanceMetrics {
    readonly name: string;
    readonly capacity: number;
    readonly available: number;
    readonly allocated: number;
    readonly reserved: number;
    readonly highWaterMark: number;
    readonly allocations: number;
    readonly releases: number;
    readonly creations: number;
    readonly evictions: number;
    readonly expansions: number;
    readonly contractions: number;
    readonly validationFailures: number;
    readonly fastPath: number;
    readonly slowPath: number;
    readonly averageAllocationTime: number;
    readonly averageReleaseTime: number;
    readonly peakMemoryUsage: number;
    readonly fragmentationRatio: number;
    readonly utilizationRatio: number;
    readonly turnoverRate: number;
    readonly missRate: number;
    readonly hitRatio: number;
    readonly allocationsPerSecond: number;
    readonly releasesPerSecond: number;
    readonly lastCompactionDuration: number;
    readonly compactionCount: number;
    readonly lastResizeDuration: number;
    readonly objectCreationTime: {
        readonly min: number;
        readonly max: number;
        readonly avg: number;
    };
    readonly objectLifetime: {
        readonly min: number;
        readonly max: number;
        readonly avg: number;
    };
}

export interface MemoryPoolOperations<T extends PoolableObject> {
    acquire(): T;
    release(obj: T): void;
    tryAcquire(): T | null;
    releaseAll(): void;
    clear(): void;
    drain(): void;
    resize(newCapacity: number): void;
    isFromPool(obj: T): boolean;
    getMetrics(): PoolPerformanceMetrics;
    getAvailableCount(): number;
    getAllocatedCount(): number;
    getTotalCount(): number;
    forceCompact(): void;
    [Symbol.dispose](): void;
}

export interface AsyncMemoryPoolOperations<T extends PoolableObject> {
    acquireAsync(): Promise<T>;
    releaseAsync(obj: T): Promise<void>;
    tryAcquireAsync(timeoutMs?: number): Promise<T | null>;
    releaseAllAsync(): Promise<void>;
    clearAsync(): Promise<void>;
    drainAsync(): Promise<void>;
}

export const enum MemoryPoolErrorCode {
    POOL_DEPLETED = 'POOL_DEPLETED',
    POOL_DISPOSED = 'POOL_DISPOSED',
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    FOREIGN_OBJECT = 'FOREIGN_OBJECT',
    ALREADY_RELEASED = 'ALREADY_RELEASED',
    IN_USE_DURING_OPERATION = 'IN_USE_DURING_OPERATION',
    INITIALIZATION_FAILED = 'INITIALIZATION_FAILED',
    TIMEOUT_EXCEEDED = 'TIMEOUT_EXCEEDED',
    INVALID_OPERATION = 'INVALID_OPERATION',
    INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class MemoryPoolError extends Error {
    readonly code: MemoryPoolErrorCode;
    readonly poolName?: string;
    readonly timestamp: number;
    readonly details?: Record<string, any>;

    constructor(
        message: string,
        code: MemoryPoolErrorCode,
        poolName?: string,
        details?: Record<string, any>
    ) {
        super(`MemoryPool${poolName ? ` "${poolName}"` : ''}: ${message}`);
        this.name = 'MemoryPoolError';
        this.code = code;
        this.poolName = poolName;
        this.timestamp = Date.now();
        this.details = details;
        Object.setPrototypeOf(this, MemoryPoolError.prototype);
    }
}

type PoolSlot<T extends PoolableObject> = {
    obj: T | undefined;
    status: PoolObjectStatus;
    lastAccessed: number;
    allocCount: number;
    createdAt: number;
};

type PerformanceTimer = {
    start(): void;
    stop(): number;
};

type TimerMetric = {
    count: number;
    total: number;
    min: number;
    max: number;
    last: number;
};

type InternalPoolMetrics = {
    allocations: number;
    releases: number;
    creations: number;
    evictions: number;
    expansions: number;
    contractions: number;
    validationFailures: number;
    compactions: number;

    creationTimer: TimerMetric;
    allocationTimer: TimerMetric;
    releaseTimer: TimerMetric;
    compactionTimer: TimerMetric;
    resizeTimer: TimerMetric;

    highWaterMark: number;
    fastPath: number;
    slowPath: number;
    misses: number;
    hits: number;

    objectLifetime: TimerMetric;

    startTime: number;
    lastUpdateTime: number;
};

export class MemoryPool<T extends PoolableObject>
    implements MemoryPoolOperations<T>, AsyncMemoryPoolOperations<T>, Iterable<T>
{
    private readonly _slots: PoolSlot<T>[] = [];
    private readonly _freeList: Set<number> = new Set();
    private readonly _lruHeap: number[] = [];
    private readonly _waitQueue: Array<(obj: T | null) => void> = [];

    private readonly _metrics: InternalPoolMetrics;

    private readonly _options: Required<Omit<MemoryPoolOptions<T>, 'asyncFactory'>> &
        Pick<MemoryPoolOptions<T>, 'asyncFactory'>;

    private _nextId: number = 0;
    private _isDisposed: boolean = false;
    private _lastRoundRobinIndex: number = 0;
    private _asyncFactoryPromise: Promise<void> | null = null;
    private _factoryAvgTime: number = 0;

    constructor(options: MemoryPoolOptions<T>) {
        this._options = {
            initialCapacity: options.initialCapacity ?? 32,
            maxCapacity: options.maxCapacity ?? 4096,
            minFree: options.minFree ?? 0,
            highWatermarkRatio: options.highWatermarkRatio ?? 0.8,
            lowWatermarkRatio: options.lowWatermarkRatio ?? 0.2,
            expansionStrategy: options.expansionStrategy ?? 'multiplicative',
            expansionFactor: options.expansionFactor ?? 2,
            expansionRate: options.expansionRate ?? 0,
            allocationStrategy: options.allocationStrategy ?? 'first-available',
            evictionPolicy: options.evictionPolicy ?? 'none',
            ttl: options.ttl ?? 0,
            factory: options.factory,
            resetOnRecycle: options.resetOnRecycle ?? true,
            validator: options.validator ?? (() => true),
            preallocate: options.preallocate ?? false,
            autoExpand: options.autoExpand ?? true,
            compactionThreshold: options.compactionThreshold ?? 128,
            compactionTriggerRatio: options.compactionTriggerRatio ?? 0.5,
            onAcquire: options.onAcquire ?? (() => undefined),
            onRelease: options.onRelease ?? (() => undefined),
            onEvict: options.onEvict ?? (() => undefined),
            onOutOfMemory: options.onOutOfMemory ?? (() => undefined),
            enableMetrics: options.enableMetrics ?? true,
            enableInstrumentation: options.enableInstrumentation ?? false,
            name: options.name ?? `MemoryPool-${Math.floor(Math.random() * 1000000)}`,
            maxObjectAge: options.maxObjectAge ?? 0,
            threadSafe: options.threadSafe ?? false,
            asyncFactory: options.asyncFactory,
        };

        this._validateOptions();

        this._metrics = this._createMetrics();

        if (this._options.preallocate) {
            this._preallocate();
        } else {
            this._reserve(this._options.initialCapacity);
        }

        if (this._options.asyncFactory !== undefined && this._options.preallocate) {
            this._preloadAsync();
        }
    }

    public acquire(): T {
        if (this._isDisposed) {
            throw new MemoryPoolError(
                'Cannot acquire from disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this._options.name
            );
        }

        let timer: PerformanceTimer | null = null;
        if (this._options.enableMetrics) {
            timer = this._createTimer();
            timer.start();
            this._metrics.allocations++;
        }

        try {
            if (this._freeList.size === 0) {
                if (this._options.enableMetrics) {
                    this._metrics.slowPath++;
                    this._metrics.misses++;
                }

                if (this._options.autoExpand && this._slots.length < this._options.maxCapacity) {
                    this._expand();
                } else {
                    if (this._options.evictionPolicy !== 'none') {
                        const evicted = this._tryEvictObject();
                        if (!evicted) {
                            this._options.onOutOfMemory(1, 0);
                            throw new MemoryPoolError(
                                'Pool depleted and no objects can be evicted',
                                MemoryPoolErrorCode.POOL_DEPLETED,
                                this._options.name,
                                { requested: 1, available: 0 }
                            );
                        }
                    } else {
                        this._options.onOutOfMemory(1, 0);
                        throw new MemoryPoolError(
                            'Pool depleted',
                            MemoryPoolErrorCode.POOL_DEPLETED,
                            this._options.name,
                            { requested: 1, available: 0 }
                        );
                    }
                }
            }

            const id = this._getNextFreeId();

            if (id === -1) {
                throw new MemoryPoolError(
                    'Internal error: failed to get free slot',
                    MemoryPoolErrorCode.INTERNAL_ERROR,
                    this._options.name
                );
            }

            this._freeList.delete(id);

            const slot = this._slots[id];
            slot.status = 'allocated';
            slot.lastAccessed = Date.now();
            slot.allocCount++;

            if (!slot.obj) {
                const createTimer = this._createTimer();
                createTimer.start();
                slot.obj = this._options.factory();
                const createTime = createTimer.stop();

                if (this._options.enableMetrics) {
                    this._metrics.creationTimer.count++;
                    this._metrics.creationTimer.total += createTime;
                    this._metrics.creationTimer.min = Math.min(
                        this._metrics.creationTimer.min,
                        createTime
                    );
                    this._metrics.creationTimer.max = Math.max(
                        this._metrics.creationTimer.max,
                        createTime
                    );
                    this._metrics.creationTimer.last = createTime;
                    this._metrics.creations++;
                }

                slot.createdAt = Date.now();
            }

            const obj = slot.obj!;

            obj.__poolId = id;
            obj.__poolStatus = 'allocated';
            obj.__lastAccessed = slot.lastAccessed;
            obj.__allocCount = slot.allocCount;

            if (!this._options.validator(obj)) {
                this._freeList.add(id);
                slot.status = 'free';

                if (this._options.enableMetrics) {
                    this._metrics.validationFailures++;
                }

                throw new MemoryPoolError(
                    'Object failed validation',
                    MemoryPoolErrorCode.VALIDATION_FAILED,
                    this._options.name
                );
            }

            const allocated = this._slots.length - this._freeList.size;
            if (allocated > this._metrics.highWaterMark) {
                this._metrics.highWaterMark = allocated;
            }

            if (this._options.enableMetrics) {
                this._metrics.fastPath++;
                this._metrics.hits++;
            }

            try {
                this._options.onAcquire(obj);
            } catch (e) {
                this.release(obj);
                throw e;
            }

            return obj;
        } finally {
            if (timer && this._options.enableMetrics) {
                const elapsed = timer.stop();
                this._metrics.allocationTimer.count++;
                this._metrics.allocationTimer.total += elapsed;
                this._metrics.allocationTimer.min = Math.min(
                    this._metrics.allocationTimer.min,
                    elapsed
                );
                this._metrics.allocationTimer.max = Math.max(
                    this._metrics.allocationTimer.max,
                    elapsed
                );
                this._metrics.allocationTimer.last = elapsed;
            }
        }
    }

    public release(obj: T): void {
        if (this._isDisposed) {
            return;
        }

        let timer: PerformanceTimer | null = null;
        if (this._options.enableMetrics) {
            timer = this._createTimer();
            timer.start();
            this._metrics.releases++;
        }

        try {
            if (
                obj.__poolId === undefined ||
                obj.__poolId >= this._slots.length ||
                this._slots[obj.__poolId].obj !== obj
            ) {
                throw new MemoryPoolError(
                    'Object not from this pool',
                    MemoryPoolErrorCode.FOREIGN_OBJECT,
                    this._options.name
                );
            }

            const id = obj.__poolId;
            const slot = this._slots[id];

            if (slot.status !== 'allocated') {
                throw new MemoryPoolError(
                    'Object already released',
                    MemoryPoolErrorCode.ALREADY_RELEASED,
                    this._options.name
                );
            }

            if (this._options.enableMetrics) {
                const lifetime = Date.now() - slot.lastAccessed;
                this._metrics.objectLifetime.count++;
                this._metrics.objectLifetime.total += lifetime;
                this._metrics.objectLifetime.min = Math.min(
                    this._metrics.objectLifetime.min,
                    lifetime
                );
                this._metrics.objectLifetime.max = Math.max(
                    this._metrics.objectLifetime.max,
                    lifetime
                );
                this._metrics.objectLifetime.last = lifetime;
            }

            try {
                this._options.onRelease(obj);
            } catch (e) {
                console.error(`Error in onRelease handler for pool "${this._options.name}":`, e);
            }

            if (this._options.resetOnRecycle) {
                try {
                    obj.reset();
                } catch (e) {
                    console.error(
                        `Error in reset method for object in pool "${this._options.name}":`,
                        e
                    );
                }
            }

            slot.status = 'free';
            obj.__poolStatus = 'free';
            slot.lastAccessed = Date.now();

            if (this._waitQueue.length > 0) {
                const waiter = this._waitQueue.shift();
                if (waiter) {
                    slot.status = 'allocated';
                    obj.__poolStatus = 'allocated';
                    slot.lastAccessed = Date.now();
                    slot.allocCount++;

                    waiter(obj);
                    return;
                }
            }

            this._freeList.add(id);

            if (
                this._options.allocationStrategy === 'least-recently-used' ||
                this._options.allocationStrategy === 'most-recently-used' ||
                this._options.evictionPolicy === 'lru'
            ) {
                this._updateLruHeap(id);
            }

            this._checkForContraction();
        } finally {
            if (timer && this._options.enableMetrics) {
                const elapsed = timer.stop();
                this._metrics.releaseTimer.count++;
                this._metrics.releaseTimer.total += elapsed;
                this._metrics.releaseTimer.min = Math.min(this._metrics.releaseTimer.min, elapsed);
                this._metrics.releaseTimer.max = Math.max(this._metrics.releaseTimer.max, elapsed);
                this._metrics.releaseTimer.last = elapsed;
            }
        }
    }

    public tryAcquire(): T | null {
        if (this._isDisposed || this._freeList.size === 0) {
            return null;
        }

        try {
            return this.acquire();
        } catch (e) {
            if (e instanceof MemoryPoolError && e.code === MemoryPoolErrorCode.POOL_DEPLETED) {
                return null;
            }
            throw e;
        }
    }

    public releaseAll(): void {
        if (this._isDisposed) {
            return;
        }

        const toRelease: T[] = [];

        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (slot.status === 'allocated' && slot.obj) {
                toRelease.push(slot.obj);
            }
        }

        for (const obj of toRelease) {
            try {
                this.release(obj);
            } catch (e) {
                console.error(`Error releasing object during releaseAll:`, e);
            }
        }
    }

    public clear(): void {
        if (this._isDisposed) {
            throw new MemoryPoolError(
                'Cannot clear disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this._options.name
            );
        }

        const allocatedCount = this._slots.length - this._freeList.size;
        if (allocatedCount > 0) {
            throw new MemoryPoolError(
                'Cannot clear pool with allocated objects',
                MemoryPoolErrorCode.IN_USE_DURING_OPERATION,
                this._options.name,
                { allocatedCount }
            );
        }

        this._slots.length = 0;
        this._freeList.clear();
        this._lruHeap.length = 0;
        this._nextId = 0;

        if (this._options.preallocate) {
            this._preallocate();
        } else {
            this._reserve(this._options.initialCapacity);
        }

        if (this._options.enableMetrics) {
            this._metrics.creations = 0;
            this._metrics.expansions = 0;
            this._metrics.contractions = 0;
            this._metrics.highWaterMark = 0;
        }
    }

    public drain(): void {
        if (this._isDisposed) {
            return;
        }

        const allocatedSlots: PoolSlot<T>[] = [];
        const freeSlots: PoolSlot<T>[] = [];

        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (slot.status === 'allocated') {
                allocatedSlots.push(slot);
            } else if (slot.status === 'free' && slot.obj) {
                freeSlots.push(slot);
            }
        }

        const allocatedCount = allocatedSlots.length;
        const targetCapacity = Math.max(
            this._options.initialCapacity,
            allocatedCount,
            this._options.minFree + allocatedCount
        );

        freeSlots.sort((a, b) => b.lastAccessed - a.lastAccessed);

        const freeObjectsToKeep = Math.min(freeSlots.length, targetCapacity - allocatedCount);

        const keptFreeSlots = freeSlots.slice(0, freeObjectsToKeep);

        const newSlots: PoolSlot<T>[] = new Array(targetCapacity);
        const newFreeList = new Set<number>();

        let newId = 0;

        for (const slot of allocatedSlots) {
            const newSlot: PoolSlot<T> = {
                obj: slot.obj,
                status: 'allocated',
                lastAccessed: slot.lastAccessed,
                allocCount: slot.allocCount,
                createdAt: slot.createdAt,
            };

            if (slot.obj) {
                slot.obj.__poolId = newId;
            }

            newSlots[newId] = newSlot;
            newId++;
        }

        for (const slot of keptFreeSlots) {
            const newSlot: PoolSlot<T> = {
                obj: slot.obj,
                status: 'free',
                lastAccessed: slot.lastAccessed,
                allocCount: slot.allocCount,
                createdAt: slot.createdAt,
            };

            if (slot.obj) {
                slot.obj.__poolId = newId;
            }

            newSlots[newId] = newSlot;
            newFreeList.add(newId);
            newId++;
        }

        for (let i = newId; i < targetCapacity; i++) {
            newSlots[i] = {
                obj: undefined,
                status: 'free',
                lastAccessed: 0,
                allocCount: 0,
                createdAt: 0,
            };

            newFreeList.add(i);
        }

        this._lruHeap.length = 0;
        if (
            this._options.allocationStrategy === 'least-recently-used' ||
            this._options.allocationStrategy === 'most-recently-used' ||
            this._options.evictionPolicy === 'lru'
        ) {
            this._rebuildLruHeap(newSlots);
        }

        this._slots.length = 0;
        Object.assign(this._slots, newSlots);
        this._freeList.clear();
        for (const id of newFreeList) {
            this._freeList.add(id);
        }

        this._nextId = targetCapacity;

        if (this._options.enableMetrics) {
            this._metrics.contractions++;
        }
    }

    public resize(newCapacity: number): void {
        if (this._isDisposed) {
            throw new MemoryPoolError(
                'Cannot resize disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this._options.name
            );
        }

        let timer: PerformanceTimer | null = null;
        if (this._options.enableMetrics) {
            timer = this._createTimer();
            timer.start();
        }

        try {
            const allocatedCount = this._slots.length - this._freeList.size;

            const clampedCapacity = Math.max(
                allocatedCount,
                Math.min(newCapacity, this._options.maxCapacity)
            );

            if (clampedCapacity === this._slots.length) {
                return;
            }

            if (clampedCapacity < this._slots.length) {
                this._shrink(clampedCapacity);
            } else {
                this._grow(clampedCapacity);
            }
        } finally {
            if (timer && this._options.enableMetrics) {
                const elapsed = timer.stop();
                this._metrics.resizeTimer.count++;
                this._metrics.resizeTimer.total += elapsed;
                this._metrics.resizeTimer.min = Math.min(this._metrics.resizeTimer.min, elapsed);
                this._metrics.resizeTimer.max = Math.max(this._metrics.resizeTimer.max, elapsed);
                this._metrics.resizeTimer.last = elapsed;
            }
        }
    }

    public isFromPool(obj: T): boolean {
        if (!obj || obj.__poolId === undefined) {
            return false;
        }

        const id = obj.__poolId;
        return id >= 0 && id < this._slots.length && this._slots[id].obj === obj;
    }

    public forceCompact(): void {
        if (this._isDisposed) {
            throw new MemoryPoolError(
                'Cannot compact disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this._options.name
            );
        }

        let timer: PerformanceTimer | null = null;
        if (this._options.enableMetrics) {
            timer = this._createTimer();
            timer.start();
            this._metrics.compactions++;
        }

        try {
            this._compactPool();
        } finally {
            if (timer && this._options.enableMetrics) {
                const elapsed = timer.stop();
                this._metrics.compactionTimer.count++;
                this._metrics.compactionTimer.total += elapsed;
                this._metrics.compactionTimer.min = Math.min(
                    this._metrics.compactionTimer.min,
                    elapsed
                );
                this._metrics.compactionTimer.max = Math.max(
                    this._metrics.compactionTimer.max,
                    elapsed
                );
                this._metrics.compactionTimer.last = elapsed;
            }
        }
    }

    public getAvailableCount(): number {
        return this._freeList.size;
    }

    public getAllocatedCount(): number {
        return this._slots.length - this._freeList.size;
    }

    public getTotalCount(): number {
        return this._slots.length;
    }

    public getMetrics(): PoolPerformanceMetrics {
        if (!this._options.enableMetrics) {
            throw new MemoryPoolError(
                'Metrics are disabled for this pool',
                MemoryPoolErrorCode.INVALID_OPERATION,
                this._options.name
            );
        }

        const now = Date.now();
        const timeWindow = (now - this._metrics.startTime) / 1000;
        const allocatedCount = this._slots.length - this._freeList.size;

        this._metrics.lastUpdateTime = now;

        return {
            name: this._options.name,
            capacity: this._slots.length,
            available: this._freeList.size,
            allocated: allocatedCount,
            reserved: 0,
            highWaterMark: this._metrics.highWaterMark,
            allocations: this._metrics.allocations,
            releases: this._metrics.releases,
            creations: this._metrics.creations,
            evictions: this._metrics.evictions,
            expansions: this._metrics.expansions,
            contractions: this._metrics.contractions,
            validationFailures: this._metrics.validationFailures,
            fastPath: this._metrics.fastPath,
            slowPath: this._metrics.slowPath,
            averageAllocationTime:
                this._metrics.allocationTimer.count > 0
                    ? this._metrics.allocationTimer.total / this._metrics.allocationTimer.count
                    : 0,
            averageReleaseTime:
                this._metrics.releaseTimer.count > 0
                    ? this._metrics.releaseTimer.total / this._metrics.releaseTimer.count
                    : 0,
            peakMemoryUsage: this._getEstimatedMemoryUsage(),
            fragmentationRatio: this._calculateFragmentationRatio(),
            utilizationRatio: this._slots.length > 0 ? allocatedCount / this._slots.length : 0,
            turnoverRate:
                this._metrics.allocations > 0
                    ? this._metrics.releases / this._metrics.allocations
                    : 0,
            missRate:
                this._metrics.hits + this._metrics.misses > 0
                    ? this._metrics.misses / (this._metrics.hits + this._metrics.misses)
                    : 0,
            hitRatio:
                this._metrics.hits + this._metrics.misses > 0
                    ? this._metrics.hits / (this._metrics.hits + this._metrics.misses)
                    : 0,
            allocationsPerSecond: timeWindow > 0 ? this._metrics.allocations / timeWindow : 0,
            releasesPerSecond: timeWindow > 0 ? this._metrics.releases / timeWindow : 0,
            lastCompactionDuration: this._metrics.compactionTimer.last,
            compactionCount: this._metrics.compactions,
            lastResizeDuration: this._metrics.resizeTimer.last,
            objectCreationTime: {
                min:
                    this._metrics.creationTimer.min === Number.MAX_VALUE
                        ? 0
                        : this._metrics.creationTimer.min,
                max: this._metrics.creationTimer.max,
                avg:
                    this._metrics.creationTimer.count > 0
                        ? this._metrics.creationTimer.total / this._metrics.creationTimer.count
                        : 0,
            },
            objectLifetime: {
                min:
                    this._metrics.objectLifetime.min === Number.MAX_VALUE
                        ? 0
                        : this._metrics.objectLifetime.min,
                max: this._metrics.objectLifetime.max,
                avg:
                    this._metrics.objectLifetime.count > 0
                        ? this._metrics.objectLifetime.total / this._metrics.objectLifetime.count
                        : 0,
            },
        };
    }

    public [Symbol.dispose](): void {
        if (this._isDisposed) {
            return;
        }

        this._isDisposed = true;

        for (const waiter of this._waitQueue) {
            try {
                waiter(null);
            } catch (e) {
                console.error(`Error notifying waiter during pool disposal:`, e);
            }
        }

        this._waitQueue.length = 0;

        this._slots.length = 0;
        this._freeList.clear();
        this._lruHeap.length = 0;
    }

    public async acquireAsync(): Promise<T> {
        const obj = this.tryAcquire();
        if (obj !== null) {
            return obj;
        }

        if (!this._options.autoExpand || this._slots.length >= this._options.maxCapacity) {
            return new Promise<T>((resolve, reject) => {
                if (this._isDisposed) {
                    return reject(
                        new MemoryPoolError(
                            'Cannot acquire from disposed pool',
                            MemoryPoolErrorCode.POOL_DISPOSED,
                            this._options.name
                        )
                    );
                }

                this._waitQueue.push((obj) => {
                    if (obj === null) {
                        reject(
                            new MemoryPoolError(
                                'Pool was disposed while waiting for object',
                                MemoryPoolErrorCode.POOL_DISPOSED,
                                this._options.name
                            )
                        );
                    } else {
                        resolve(obj);
                    }
                });
            });
        }

        if (this._options.asyncFactory !== undefined) {
            const expandPromise = this._expandAsync();
            await expandPromise;

            return this.acquire();
        } else {
            return this.acquire();
        }
    }

    public async releaseAsync(obj: T): Promise<void> {
        this.release(obj);
        return Promise.resolve();
    }

    public async tryAcquireAsync(timeoutMs: number = 0): Promise<T | null> {
        const obj = this.tryAcquire();
        if (obj !== null) {
            return obj;
        }

        if (timeoutMs <= 0) {
            return null;
        }

        return new Promise<T | null>((resolve) => {
            if (this._isDisposed) {
                return resolve(null);
            }

            const timeoutId = setTimeout(() => {
                const index = this._waitQueue.findIndex((cb) => cb === callback);
                if (index !== -1) {
                    this._waitQueue.splice(index, 1);
                }
                resolve(null);
            }, timeoutMs);

            const callback = (obj: T | null) => {
                clearTimeout(timeoutId);
                resolve(obj);
            };

            this._waitQueue.push(callback);
        });
    }

    public async releaseAllAsync(): Promise<void> {
        this.releaseAll();
        return Promise.resolve();
    }

    public async clearAsync(): Promise<void> {
        this.clear();
        return Promise.resolve();
    }

    public async drainAsync(): Promise<void> {
        this.drain();
        return Promise.resolve();
    }

    public [Symbol.iterator](): Iterator<T> {
        if (this._isDisposed) {
            throw new MemoryPoolError(
                'Cannot iterate over disposed pool',
                MemoryPoolErrorCode.POOL_DISPOSED,
                this._options.name
            );
        }

        const allocated: T[] = [];
        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (slot.status === 'allocated' && slot.obj) {
                allocated.push(slot.obj);
            }
        }

        let index = 0;
        return {
            next(): IteratorResult<T> {
                if (index < allocated.length) {
                    return { value: allocated[index++], done: false };
                }
                return { value: undefined as any, done: true };
            },
        };
    }

    private _validateOptions(): void {
        if (this._options.initialCapacity <= 0) {
            throw new Error(`Invalid initialCapacity: ${this._options.initialCapacity}`);
        }

        if (this._options.maxCapacity < this._options.initialCapacity) {
            throw new Error(
                `maxCapacity (${this._options.maxCapacity}) cannot be less than initialCapacity (${this._options.initialCapacity})`
            );
        }

        if (this._options.expansionFactor < 1) {
            throw new Error(`Invalid expansionFactor: ${this._options.expansionFactor}`);
        }

        if (this._options.highWatermarkRatio <= 0 || this._options.highWatermarkRatio >= 1) {
            throw new Error(`Invalid highWatermarkRatio: ${this._options.highWatermarkRatio}`);
        }

        if (
            this._options.lowWatermarkRatio <= 0 ||
            this._options.lowWatermarkRatio >= this._options.highWatermarkRatio
        ) {
            throw new Error(`Invalid lowWatermarkRatio: ${this._options.lowWatermarkRatio}`);
        }

        if (
            this._options.compactionTriggerRatio <= 0 ||
            this._options.compactionTriggerRatio >= 1
        ) {
            throw new Error(
                `Invalid compactionTriggerRatio: ${this._options.compactionTriggerRatio}`
            );
        }
    }

    private _createTimer(): PerformanceTimer {
        let startTime = 0;

        return {
            start() {
                startTime = performance.now();
            },
            stop() {
                return performance.now() - startTime;
            },
        };
    }

    private _createMetrics(): InternalPoolMetrics {
        return {
            allocations: 0,
            releases: 0,
            creations: 0,
            evictions: 0,
            expansions: 0,
            contractions: 0,
            validationFailures: 0,
            compactions: 0,

            creationTimer: {
                count: 0,
                total: 0,
                min: Number.MAX_VALUE,
                max: 0,
                last: 0,
            },
            allocationTimer: {
                count: 0,
                total: 0,
                min: Number.MAX_VALUE,
                max: 0,
                last: 0,
            },
            releaseTimer: {
                count: 0,
                total: 0,
                min: Number.MAX_VALUE,
                max: 0,
                last: 0,
            },
            compactionTimer: {
                count: 0,
                total: 0,
                min: Number.MAX_VALUE,
                max: 0,
                last: 0,
            },
            resizeTimer: {
                count: 0,
                total: 0,
                min: Number.MAX_VALUE,
                max: 0,
                last: 0,
            },

            highWaterMark: 0,
            fastPath: 0,
            slowPath: 0,
            misses: 0,
            hits: 0,

            objectLifetime: {
                count: 0,
                total: 0,
                min: Number.MAX_VALUE,
                max: 0,
                last: 0,
            },

            startTime: Date.now(),
            lastUpdateTime: Date.now(),
        };
    }

    private _preallocate(): void {
        for (let i = 0; i < this._options.initialCapacity; i++) {
            this._createSlot(i, true);
            this._freeList.add(i);
        }

        this._nextId = this._options.initialCapacity;

        if (
            this._options.allocationStrategy === 'least-recently-used' ||
            this._options.allocationStrategy === 'most-recently-used' ||
            this._options.evictionPolicy === 'lru'
        ) {
            this._rebuildLruHeap(this._slots);
        }
    }

    private _reserve(capacity: number): void {
        const currentLength = this._slots.length;

        for (let i = currentLength; i < capacity; i++) {
            this._createSlot(i, false);
            this._freeList.add(i);
        }

        this._nextId = capacity;
    }

    private _createSlot(id: number, createObject: boolean): PoolSlot<T> {
        const now = Date.now();
        let obj: T | undefined = undefined;

        if (createObject) {
            const timer = this._createTimer();
            timer.start();

            obj = this._options.factory();
            obj.__poolId = id;
            obj.__poolStatus = 'free';
            obj.__lastAccessed = now;
            obj.__allocCount = 0;

            if (this._options.enableMetrics) {
                const elapsed = timer.stop();
                this._metrics.creationTimer.count++;
                this._metrics.creationTimer.total += elapsed;
                this._metrics.creationTimer.min = Math.min(
                    this._metrics.creationTimer.min,
                    elapsed
                );
                this._metrics.creationTimer.max = Math.max(
                    this._metrics.creationTimer.max,
                    elapsed
                );
                this._metrics.creationTimer.last = elapsed;
                this._metrics.creations++;
            }
        }

        const slot: PoolSlot<T> = {
            obj,
            status: 'free',
            lastAccessed: now,
            allocCount: 0,
            createdAt: now,
        };

        this._slots[id] = slot;
        return slot;
    }

    private _expand(): void {
        const currentCapacity = this._slots.length;
        let newCapacity: number;

        switch (this._options.expansionStrategy) {
            case 'fixed':
                newCapacity = currentCapacity + (this._options.expansionRate || 32);
                break;

            case 'multiplicative':
                newCapacity = Math.ceil(currentCapacity * this._options.expansionFactor);
                break;

            case 'fibonacci':
                let a = 1,
                    b = 1;
                while (b <= currentCapacity) {
                    const temp = a + b;
                    a = b;
                    b = temp;
                }
                newCapacity = b;
                break;

            case 'prime':
                const target = currentCapacity * this._options.expansionFactor;
                newCapacity = this._nextPrime(target);
                break;

            default:
                newCapacity = Math.ceil(currentCapacity * this._options.expansionFactor);
        }

        newCapacity = Math.min(newCapacity, this._options.maxCapacity);

        if (newCapacity > currentCapacity) {
            if (this._options.enableMetrics) {
                this._metrics.expansions++;
            }

            this._grow(newCapacity);
        }
    }

    private _grow(newCapacity: number): void {
        const currentCapacity = this._slots.length;

        if (newCapacity <= currentCapacity) {
            return;
        }

        if (this._options.preallocate) {
            for (let i = currentCapacity; i < newCapacity; i++) {
                this._createSlot(i, true);
                this._freeList.add(i);
            }
        } else {
            for (let i = currentCapacity; i < newCapacity; i++) {
                this._createSlot(i, false);
                this._freeList.add(i);
            }
        }

        this._nextId = Math.max(this._nextId, newCapacity);

        if (
            this._options.allocationStrategy === 'least-recently-used' ||
            this._options.allocationStrategy === 'most-recently-used' ||
            this._options.evictionPolicy === 'lru'
        ) {
            this._rebuildLruHeap(this._slots);
        }
    }

    private _shrink(newCapacity: number): void {
        const currentCapacity = this._slots.length;

        if (newCapacity >= currentCapacity) {
            return;
        }

        const allocatedCount = currentCapacity - this._freeList.size;

        if (newCapacity < allocatedCount) {
            throw new MemoryPoolError(
                'Cannot shrink pool below allocated count',
                MemoryPoolErrorCode.IN_USE_DURING_OPERATION,
                this._options.name,
                { allocatedCount, requestedCapacity: newCapacity }
            );
        }

        const idsToRemove: number[] = [];

        const freeIds = Array.from(this._freeList);

        freeIds.sort((a, b) => {
            return this._slots[a].lastAccessed - this._slots[b].lastAccessed;
        });

        const removeCount = currentCapacity - newCapacity;

        for (let i = 0; i < Math.min(removeCount, freeIds.length); i++) {
            idsToRemove.push(freeIds[i]);
        }

        for (const id of idsToRemove) {
            this._slots[id] = undefined as any;
            this._freeList.delete(id);
        }

        this._compactPool();

        if (this._options.enableMetrics) {
            this._metrics.contractions++;
        }
    }

    private _compactPool(): void {
        const compactedSlots: PoolSlot<T>[] = [];
        const newFreeList = new Set<number>();

        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (slot !== undefined) {
                compactedSlots.push(slot);
            }
        }

        for (let i = 0; i < compactedSlots.length; i++) {
            const slot = compactedSlots[i];

            if (slot.obj) {
                slot.obj.__poolId = i;
            }

            if (slot.status === 'free') {
                newFreeList.add(i);
            }
        }

        this._slots.length = 0;
        Object.assign(this._slots, compactedSlots);
        this._freeList.clear();
        for (const id of newFreeList) {
            this._freeList.add(id);
        }

        this._nextId = compactedSlots.length;

        if (
            this._options.allocationStrategy === 'least-recently-used' ||
            this._options.allocationStrategy === 'most-recently-used' ||
            this._options.evictionPolicy === 'lru'
        ) {
            this._rebuildLruHeap(this._slots);
        }
    }

    private _updateLruHeap(slotId: number): void {
        // This is a simplified heap operation for now
        // A more sophisticated heap implementation would be used in a production environment

        // For now, just rebuild the entire heap
        // This is inefficient but simpler and safer for now
        this._rebuildLruHeap(this._slots);
    }

    private _rebuildLruHeap(slots: PoolSlot<T>[]): void {
        this._lruHeap.length = 0;

        for (let i = 0; i < slots.length; i++) {
            const slot = slots[i];
            if (slot && slot.status === 'free') {
                this._lruHeap.push(i);
            }
        }

        if (
            this._options.allocationStrategy === 'least-recently-used' ||
            this._options.evictionPolicy === 'lru'
        ) {
            // Oldest first (min-heap)
            this._lruHeap.sort((a, b) => slots[a].lastAccessed - slots[b].lastAccessed);
        } else {
            // Newest first (max-heap)
            this._lruHeap.sort((a, b) => slots[b].lastAccessed - slots[a].lastAccessed);
        }
    }

    private _getNextFreeId(): number {
        if (this._freeList.size === 0) {
            return -1; // no free IDs
        }

        switch (this._options.allocationStrategy) {
            case 'least-recently-used':
                if (this._lruHeap.length > 0) {
                    return this._lruHeap.shift() as number;
                }
                break;

            case 'most-recently-used':
                if (this._lruHeap.length > 0) {
                    return this._lruHeap.shift() as number;
                }
                break;

            case 'round-robin':
                const freeIds = Array.from(this._freeList);
                const id = freeIds[this._lastRoundRobinIndex % freeIds.length];
                this._lastRoundRobinIndex = (this._lastRoundRobinIndex + 1) % freeIds.length;
                return id;

            case 'first-available':
            default:
                const firstId = this._freeList.values().next().value;
                return firstId ?? -1;
        }

        const firstId = this._freeList.values().next().value;
        return firstId ?? -1;
    }

    private _checkForContraction(): void {
        if (
            this._slots.length <= this._options.initialCapacity ||
            this._slots.length <= this._options.compactionThreshold
        ) {
            return;
        }

        const totalCapacity = this._slots.length;
        const allocatedCount = totalCapacity - this._freeList.size;
        const utilizationRatio = allocatedCount / totalCapacity;

        if (utilizationRatio < this._options.lowWatermarkRatio) {
            const targetCapacity = Math.max(
                this._options.initialCapacity,
                allocatedCount + this._options.minFree,
                Math.ceil(allocatedCount / this._options.lowWatermarkRatio)
            );

            if (targetCapacity <= totalCapacity * 0.75) {
                this.resize(targetCapacity);
            }
        }

        if (
            this._calculateFragmentationRatio() > this._options.compactionTriggerRatio &&
            this._slots.length > this._options.compactionThreshold
        ) {
            this.forceCompact();
        }
    }

    private _tryEvictObject(): boolean {
        if (this._options.evictionPolicy === 'none') {
            return false;
        }

        const allocatedCount = this._slots.length - this._freeList.size;
        if (allocatedCount === 0) {
            return false;
        }

        let evictId: number | null = null;

        switch (this._options.evictionPolicy) {
            case 'lru':
                evictId = this._findLeastRecentlyUsedObject();
                break;

            case 'ttl':
                evictId = this._findExpiredObject();
                break;

            case 'fifo':
                evictId = this._findOldestObject();
                break;
        }

        if (evictId === null) {
            return false;
        }

        const slot = this._slots[evictId];
        const obj = slot.obj;

        if (!obj) {
            return false;
        }

        try {
            this._options.onEvict(obj);
        } catch (e) {
            console.error(`Error in onEvict handler for pool "${this._options.name}":`, e);
        }

        slot.status = 'free';
        obj.__poolStatus = 'free';
        this._freeList.add(evictId);

        if (this._options.enableMetrics) {
            this._metrics.evictions++;
        }

        return true;
    }

    private _findLeastRecentlyUsedObject(): number | null {
        let leastRecentId: number | null = null;
        let leastRecentTime = Infinity;

        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (slot.status === 'allocated' && slot.lastAccessed < leastRecentTime) {
                leastRecentTime = slot.lastAccessed;
                leastRecentId = i;
            }
        }

        return leastRecentId;
    }

    private _findExpiredObject(): number | null {
        if (this._options.ttl <= 0) {
            return null;
        }

        const now = Date.now();
        const ttl = this._options.ttl;

        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (slot.status === 'allocated' && now - slot.lastAccessed > ttl) {
                return i;
            }
        }

        return null;
    }

    private _findOldestObject(): number | null {
        let oldestId: number | null = null;
        let oldestTime = Infinity;

        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (slot.status === 'allocated' && slot.createdAt < oldestTime) {
                oldestTime = slot.createdAt;
                oldestId = i;
            }
        }

        return oldestId;
    }

    private _calculateFragmentationRatio(): number {
        let holes = 0;
        let lastWasAllocated = false;

        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];

            if (!slot) {
                holes++;
                lastWasAllocated = false;
            } else if (slot.status === 'free') {
                if (lastWasAllocated) {
                    holes++;
                }
                lastWasAllocated = false;
            } else {
                lastWasAllocated = true;
            }
        }

        return this._slots.length > 0 ? holes / this._slots.length : 0;
    }

    private _getEstimatedMemoryUsage(): number {
        // This is a very rough estimate and not accurate in JavaScript
        // In a real implementation, you would use a more sophisticated approach

        // Estimate base object size (slots array, free list, etc.)
        const baseSize =
            // Size of slots array (references)
            this._slots.length * 8 +
            // Size of free list
            this._freeList.size * 8 +
            // Size of LRU heap
            this._lruHeap.length * 8 +
            // Size of wait queue
            this._waitQueue.length * 8 +
            // Fixed overhead
            1024;

        // Add estimate for each created object
        let objectsSize = 0;
        for (const slot of this._slots) {
            if (slot && slot.obj) {
                // Very rough estimate for a complex object
                objectsSize += 512;
            }
        }

        return baseSize + objectsSize;
    }

    private _nextPrime(n: number): number {
        function isPrime(num: number): boolean {
            if (num <= 1) return false;
            if (num <= 3) return true;
            if (num % 2 === 0 || num % 3 === 0) return false;

            const sqrtNum = Math.sqrt(num);
            for (let i = 5; i <= sqrtNum; i += 6) {
                if (num % i === 0 || num % (i + 2) === 0) return false;
            }

            return true;
        }

        if (n <= 1) return 2;

        let prime = n;
        let found = false;

        while (!found) {
            prime++;
            if (isPrime(prime)) found = true;
        }

        return prime;
    }

    private async _preloadAsync(): Promise<void> {
        if (this._options.asyncFactory === undefined) {
            return;
        }

        this._asyncFactoryPromise = Promise.all(
            Array.from({ length: this._options.initialCapacity }).map(async (_, i) => {
                try {
                    const obj = await this._options.asyncFactory!();

                    if (!this._slots[i].obj) {
                        this._slots[i].obj = obj;
                        obj.__poolId = i;
                        obj.__poolStatus = 'free';
                        obj.__lastAccessed = Date.now();
                        obj.__allocCount = 0;
                    }
                } catch (e) {
                    console.error(
                        `Error preloading async object for pool "${this._options.name}":`,
                        e
                    );
                }
            })
        ).then(() => {});

        await this._asyncFactoryPromise;
        this._asyncFactoryPromise = null;
    }

    private async _expandAsync(): Promise<void> {
        if (this._options.asyncFactory === undefined) {
            this._expand();
            return;
        }

        const currentCapacity = this._slots.length;
        let newCapacity: number;

        switch (this._options.expansionStrategy) {
            case 'fixed':
                newCapacity = currentCapacity + (this._options.expansionRate || 32);
                break;
            case 'multiplicative':
                newCapacity = Math.ceil(currentCapacity * this._options.expansionFactor);
                break;
            case 'fibonacci':
                let a = 1,
                    b = 1;
                while (b <= currentCapacity) {
                    const temp = a + b;
                    a = b;
                    b = temp;
                }
                newCapacity = b;
                break;
            case 'prime':
                newCapacity = this._nextPrime(currentCapacity * this._options.expansionFactor);
                break;
            default:
                newCapacity = Math.ceil(currentCapacity * this._options.expansionFactor);
        }

        newCapacity = Math.min(newCapacity, this._options.maxCapacity);

        if (newCapacity <= currentCapacity) {
            return;
        }

        if (this._options.enableMetrics) {
            this._metrics.expansions++;
        }

        for (let i = currentCapacity; i < newCapacity; i++) {
            this._createSlot(i, false);
            this._freeList.add(i);
        }

        this._nextId = Math.max(this._nextId, newCapacity);

        const asyncCreationPromises = [];

        for (let i = currentCapacity; i < newCapacity; i++) {
            asyncCreationPromises.push(
                (async () => {
                    try {
                        const obj = await this._options.asyncFactory!();

                        if (this._isDisposed) {
                            return;
                        }

                        const slot = this._slots[i];
                        if (slot) {
                            slot.obj = obj;
                            slot.createdAt = Date.now();

                            obj.__poolId = i;
                            obj.__poolStatus = 'free';
                            obj.__lastAccessed = Date.now();
                            obj.__allocCount = 0;
                        }
                    } catch (e) {
                        console.error(
                            `Error creating async object for pool "${this._options.name}":`,
                            e
                        );
                    }
                })()
            );
        }

        await Promise.all(asyncCreationPromises);
    }
}

class PoolableWrapper<T extends {}> implements PoolableObject {
    public readonly value: T;
    public __poolId?: number;
    public __poolStatus?: PoolObjectStatus;
    public __lastAccessed?: number;
    public __allocCount?: number;

    constructor(value: T) {
        this.value = value;
    }

    public reset(): void {
        const obj = this.value;

        if (Array.isArray(obj)) {
            (obj as unknown as Array<any>).length = 0;
        } else if (obj instanceof Map) {
            (obj as Map<any, any>).clear();
        } else if (obj instanceof Set) {
            (obj as Set<any>).clear();
        } else if (obj instanceof Date) {
            (obj as Date).setTime(0);
        } else if (obj instanceof RegExp) {
        } else if (obj instanceof Promise) {
        } else if (obj instanceof Error) {
            for (const key in obj) {
                const value = (obj as any)[key];

                if (value === null || value === undefined) {
                    continue;
                } else if (typeof value === 'number') {
                    (obj as any)[key] = 0;
                } else if (typeof value === 'string') {
                    (obj as any)[key] = '';
                } else if (typeof value === 'boolean') {
                    (obj as any)[key] = false;
                } else if (Array.isArray(value)) {
                    value.length = 0;
                } else if (value instanceof Map || value instanceof Set) {
                    value.clear();
                }
            }

            for (const key in obj) {
                const value = (obj as any)[key];

                if (
                    typeof value === 'object' &&
                    value !== null &&
                    !(value instanceof Array) &&
                    !(value instanceof Map) &&
                    !(value instanceof Set) &&
                    !(value instanceof Date) &&
                    !(value instanceof RegExp) &&
                    !(value instanceof Promise) &&
                    !(value instanceof Error)
                ) {
                    for (const nestedKey in value) {
                        delete value[nestedKey];
                    }
                }
            }
        }
    }
}
