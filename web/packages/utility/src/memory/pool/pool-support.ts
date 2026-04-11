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

export type PoolSlot<T extends PoolableObject> = {
    obj: T | undefined;
    status: PoolObjectStatus;
    lastAccessed: number;
    allocCount: number;
    createdAt: number;
};

export type PerformanceTimer = {
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

export type InternalPoolMetrics = {
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

type ResolvedMemoryPoolOptions<T extends PoolableObject> = Required<
    Omit<MemoryPoolOptions<T>, 'asyncFactory'>
> &
    Pick<MemoryPoolOptions<T>, 'asyncFactory'>;

export const validateMemoryPoolOptions = <T extends PoolableObject>(
    options: ResolvedMemoryPoolOptions<T>
): void => {
    if (options.initialCapacity <= 0) {
        throw new Error(`Invalid initialCapacity: ${options.initialCapacity}`);
    }

    if (options.maxCapacity < options.initialCapacity) {
        throw new Error(
            `maxCapacity (${options.maxCapacity}) cannot be less than initialCapacity (${options.initialCapacity})`
        );
    }

    if (options.expansionFactor < 1) {
        throw new Error(`Invalid expansionFactor: ${options.expansionFactor}`);
    }

    if (options.highWatermarkRatio <= 0 || options.highWatermarkRatio >= 1) {
        throw new Error(`Invalid highWatermarkRatio: ${options.highWatermarkRatio}`);
    }

    if (
        options.lowWatermarkRatio <= 0 ||
        options.lowWatermarkRatio >= options.highWatermarkRatio
    ) {
        throw new Error(`Invalid lowWatermarkRatio: ${options.lowWatermarkRatio}`);
    }

    if (options.compactionTriggerRatio <= 0 || options.compactionTriggerRatio >= 1) {
        throw new Error(`Invalid compactionTriggerRatio: ${options.compactionTriggerRatio}`);
    }
};

export const createPerformanceTimer = (): PerformanceTimer => {
    let startTime = 0;

    return {
        start() {
            startTime = performance.now();
        },
        stop() {
            return performance.now() - startTime;
        },
    };
};

export const createInternalPoolMetrics = (): InternalPoolMetrics => {
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
};