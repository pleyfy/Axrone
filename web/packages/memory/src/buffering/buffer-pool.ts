import { PoolableObject, PoolPerformanceMetrics } from '../pool/mempool';
import { ObjectPool, ObjectPoolOptions } from '../pool/object-pool';
import { POOL_DEFAULTS, BUFFER_DEFAULTS } from './constants';

class PoolableArrayBuffer implements PoolableObject {
    __poolId?: number;
    __poolStatus?: 'free' | 'allocated' | 'reserved';
    __lastAccessed?: number;
    __allocCount?: number;

    constructor(
        public readonly buffer: ArrayBuffer,
        public readonly size: number
    ) {}

    reset(): void {
        new Uint8Array(this.buffer).fill(0);
    }
}

export interface BufferPoolOptions {
    readonly initialCapacityPerBucket?: number;

    readonly maxCapacityPerBucket?: number;

    readonly minFreePerBucket?: number;

    readonly preallocate?: boolean;

    readonly autoExpand?: boolean;

    readonly evictionPolicy?: 'none' | 'lru' | 'ttl' | 'fifo';

    readonly ttl?: number;

    readonly enableMetrics?: boolean;

    readonly enableInstrumentation?: boolean;

    readonly name?: string;

    readonly highWatermarkRatio?: number;

    readonly lowWatermarkRatio?: number;

    readonly validator?: (buffer: ArrayBuffer) => boolean;

    readonly onAcquire?: (buffer: ArrayBuffer) => void;

    readonly onRelease?: (buffer: ArrayBuffer) => void;

    readonly onEvict?: (buffer: ArrayBuffer) => void;

    readonly onOutOfMemory?: (requestedSize: number, bucketIndex: number) => void;
}

export class BufferPool {
    private static instance: BufferPool;
    private readonly pools: Map<number, ObjectPool<PoolableArrayBuffer>>;
    private readonly options: Required<BufferPoolOptions>;
    private readonly bucketSizes: number[];
    private readonly bufferToPoolMap: WeakMap<ArrayBuffer, PoolableArrayBuffer>;

    private constructor(options: BufferPoolOptions = {}) {
        this.options = {
            initialCapacityPerBucket: options.initialCapacityPerBucket ?? 32,
            maxCapacityPerBucket: options.maxCapacityPerBucket ?? 512,
            minFreePerBucket: options.minFreePerBucket ?? 4,
            preallocate: options.preallocate ?? false,
            autoExpand: options.autoExpand ?? true,
            evictionPolicy: options.evictionPolicy ?? 'lru',
            ttl: options.ttl ?? 0,
            enableMetrics: options.enableMetrics ?? true,
            enableInstrumentation: options.enableInstrumentation ?? false,
            name: options.name ?? 'BufferPool',
            highWatermarkRatio: options.highWatermarkRatio ?? 0.85,
            lowWatermarkRatio: options.lowWatermarkRatio ?? 0.25,
            validator: options.validator ?? (() => true),
            onAcquire: options.onAcquire ?? (() => {}),
            onRelease: options.onRelease ?? (() => {}),
            onEvict: options.onEvict ?? (() => {}),
            onOutOfMemory: options.onOutOfMemory ?? (() => {}),
        };

        this.bucketSizes = Array.from({ length: POOL_DEFAULTS.BUCKET_COUNT }, (_, i) =>
            Math.pow(2, 5 + i)
        );
        this.pools = new Map();
        this.bufferToPoolMap = new WeakMap();

        this.initializePools();
    }

    static getInstance(options?: BufferPoolOptions): BufferPool {
        if (!BufferPool.instance) {
            BufferPool.instance = new BufferPool(options);
        }
        return BufferPool.instance;
    }

    static resetInstance(): void {
        if (BufferPool.instance) {
            BufferPool.instance.dispose();
            BufferPool.instance = undefined as any;
        }
    }

    private initializePools(): void {
        for (let i = 0; i < this.bucketSizes.length; i++) {
            const bucketSize = this.bucketSizes[i];

            if (bucketSize > BUFFER_DEFAULTS.MAX_CAPACITY) {
                break;
            }

            const poolOptions: ObjectPoolOptions<PoolableArrayBuffer> = {
                initialCapacity: this.options.initialCapacityPerBucket,
                maxCapacity: this.options.maxCapacityPerBucket,
                minFree: this.options.minFreePerBucket,
                preallocate: this.options.preallocate,
                autoExpand: this.options.autoExpand,
                evictionPolicy: this.options.evictionPolicy,
                ttl: this.options.ttl,
                enableMetrics: this.options.enableMetrics,
                enableInstrumentation: this.options.enableInstrumentation,
                name: `${this.options.name}-Bucket-${bucketSize}`,
                highWatermarkRatio: this.options.highWatermarkRatio,
                lowWatermarkRatio: this.options.lowWatermarkRatio,
                allocationStrategy: 'least-recently-used',
                expansionStrategy: 'multiplicative',
                expansionFactor: 1.5,

                factory: () => new PoolableArrayBuffer(new ArrayBuffer(bucketSize), bucketSize),

                resetHandler: (buffer: PoolableArrayBuffer) => buffer.reset(),

                validateHandler: (buffer: PoolableArrayBuffer) => {
                    return (
                        buffer.buffer.byteLength === bucketSize &&
                        this.options.validator(buffer.buffer)
                    );
                },

                onAcquireHandler: (buffer: PoolableArrayBuffer) => {
                    this.bufferToPoolMap.set(buffer.buffer, buffer);
                    this.options.onAcquire(buffer.buffer);
                },

                onReleaseHandler: (buffer: PoolableArrayBuffer) => {
                    this.bufferToPoolMap.delete(buffer.buffer);
                    this.options.onRelease(buffer.buffer);
                },

                onEvictHandler: (buffer: PoolableArrayBuffer) => {
                    this.bufferToPoolMap.delete(buffer.buffer);
                    this.options.onEvict(buffer.buffer);
                },

                onOutOfMemory: (requested: number, available: number) => {
                    this.options.onOutOfMemory(bucketSize, i);
                },
            };

            this.pools.set(i, new ObjectPool(poolOptions));
        }
    }

    allocate(requestedSize: number): ArrayBuffer {
        if (requestedSize <= 0) {
            throw new Error('Requested size must be positive');
        }

        if (requestedSize > BUFFER_DEFAULTS.MAX_CAPACITY) {
            throw new Error(
                `Requested size ${requestedSize} exceeds maximum capacity ${BUFFER_DEFAULTS.MAX_CAPACITY}`
            );
        }

        const bucketIndex = this.getBucketIndex(requestedSize);
        const actualSize = this.bucketSizes[bucketIndex];
        const pool = this.pools.get(bucketIndex);

        let buffer: ArrayBuffer;

        if (!pool) {
            buffer = new ArrayBuffer(actualSize);
        } else {
            try {
                const poolableBuffer = pool.acquire();
                buffer = poolableBuffer.buffer;
            } catch (error) {
                console.warn(
                    `Pool exhausted for bucket ${bucketIndex}, falling back to direct allocation:`,
                    error
                );
                this.options.onOutOfMemory(requestedSize, bucketIndex);
                buffer = new ArrayBuffer(actualSize);
            }
        }

        return buffer;
    }

    tryAllocate(requestedSize: number): ArrayBuffer | null {
        if (requestedSize <= 0 || requestedSize > BUFFER_DEFAULTS.MAX_CAPACITY) {
            return null;
        }

        const bucketIndex = this.getBucketIndex(requestedSize);
        const actualSize = this.bucketSizes[bucketIndex];
        const pool = this.pools.get(bucketIndex);

        if (!pool) {
            const buffer = new ArrayBuffer(actualSize);
            return buffer;
        }

        try {
            const poolableBuffer = pool.tryAcquire();
            if (poolableBuffer) {
                const buffer = poolableBuffer.buffer;
                return buffer;
            } else {
                return null;
            }
        } catch {
            return null;
        }
    }

    release(buffer: ArrayBuffer): void {
        if (!buffer || buffer.byteLength === 0) {
            return;
        }

        const poolableBuffer = this.bufferToPoolMap.get(buffer);
        if (!poolableBuffer) {
            // Buffer wasn't from pool, just ignore
            return;
        }

        const bucketIndex = this.getBucketIndexForExactSize(buffer.byteLength);
        const pool = this.pools.get(bucketIndex);

        if (!pool) {
            return;
        }

        try {
            pool.release(poolableBuffer);
        } catch (error) {
            console.warn(`Failed to release buffer to pool:`, error);
        }
    }

    getStats(): BufferPoolStats {
        const bucketStats: BucketStats[] = [];
        let totalAllocated = 0;
        let totalAvailable = 0;
        let totalCapacity = 0;

        for (const [bucketIndex, pool] of this.pools) {
            const metrics = pool.getMetrics();
            const bucketSize = this.bucketSizes[bucketIndex];

            const stats: BucketStats = {
                bucketIndex,
                bucketSize,
                allocated: metrics.allocated,
                available: metrics.available,
                capacity: metrics.capacity,
                totalMemory: metrics.capacity * bucketSize,
                allocatedMemory: metrics.allocated * bucketSize,
                hitRatio: metrics.hitRatio,
                missRate: metrics.missRate,
                allocations: metrics.allocations,
                releases: metrics.releases,
                evictions: metrics.evictions,
                fragmentationRatio: metrics.fragmentationRatio,
            };

            bucketStats.push(stats);
            totalAllocated += metrics.allocated;
            totalAvailable += metrics.available;
            totalCapacity += metrics.capacity;
        }

        return {
            name: this.options.name,
            bucketCount: this.pools.size,
            totalAllocated,
            totalAvailable,
            totalCapacity,
            overallHitRatio: this.calculateOverallHitRatio(),
            totalMemoryUsage: this.calculateTotalMemoryUsage(),
            buckets: bucketStats,
        };
    }

    getBucketMetrics(requestedSize: number): PoolPerformanceMetrics | null {
        const bucketIndex = this.getBucketIndex(requestedSize);
        const pool = this.pools.get(bucketIndex);
        return pool ? pool.getMetrics() : null;
    }

    clear(): void {
        for (const pool of this.pools.values()) {
            pool.clear();
        }
    }

    drain(): void {
        for (const pool of this.pools.values()) {
            pool.drain();
        }
    }

    compact(): void {
        for (const pool of this.pools.values()) {
            pool.forceCompact();
        }
    }

    resizeBucket(requestedSize: number, newCapacity: number): void {
        const bucketIndex = this.getBucketIndex(requestedSize);
        const pool = this.pools.get(bucketIndex);
        if (pool) {
            pool.resize(newCapacity);
        }
    }

    dispose(): void {
        for (const pool of this.pools.values()) {
            pool[Symbol.dispose]();
        }
        this.pools.clear();
    }

    private getBucketIndex(requestedSize: number): number {
        const minBits = Math.max(5, Math.ceil(Math.log2(requestedSize)));
        const bucketIndex = minBits - 5;
        return Math.min(bucketIndex, POOL_DEFAULTS.BUCKET_COUNT - 1);
    }

    private getBucketIndexForExactSize(exactSize: number): number {
        const log2Size = Math.log2(exactSize);
        if (log2Size % 1 === 0 && log2Size >= 5) {
            const bucketIndex = log2Size - 5;
            if (bucketIndex >= 0 && bucketIndex < POOL_DEFAULTS.BUCKET_COUNT) {
                return bucketIndex;
            }
        }
        return -1;
    }

    private findPoolableBuffer(
        pool: ObjectPool<PoolableArrayBuffer>,
        buffer: ArrayBuffer
    ): PoolableArrayBuffer | null {
        try {
            return null;
        } catch {
            return null;
        }
    }

    private calculateOverallHitRatio(): number {
        let totalHits = 0;
        let totalRequests = 0;

        for (const pool of this.pools.values()) {
            const metrics = pool.getMetrics();
            const hits = metrics.allocations * metrics.hitRatio;
            totalHits += hits;
            totalRequests += metrics.allocations;
        }

        return totalRequests > 0 ? totalHits / totalRequests : 0;
    }

    private calculateTotalMemoryUsage(): number {
        let totalMemory = 0;

        for (const [bucketIndex, pool] of this.pools) {
            const metrics = pool.getMetrics();
            const bucketSize = this.bucketSizes[bucketIndex];
            totalMemory += metrics.capacity * bucketSize;
        }

        return totalMemory;
    }
}

export interface BucketStats {
    readonly bucketIndex: number;
    readonly bucketSize: number;
    readonly allocated: number;
    readonly available: number;
    readonly capacity: number;
    readonly totalMemory: number;
    readonly allocatedMemory: number;
    readonly hitRatio: number;
    readonly missRate: number;
    readonly allocations: number;
    readonly releases: number;
    readonly evictions: number;
    readonly fragmentationRatio: number;
}

export interface BufferPoolStats {
    readonly name: string;
    readonly bucketCount: number;
    readonly totalAllocated: number;
    readonly totalAvailable: number;
    readonly totalCapacity: number;
    readonly overallHitRatio: number;
    readonly totalMemoryUsage: number;
    readonly buckets: BucketStats[];
}
