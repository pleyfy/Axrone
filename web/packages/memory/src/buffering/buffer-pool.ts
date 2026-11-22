import type { PoolPerformanceMetrics } from '../pool/mempool';
import { BUFFER_DEFAULTS, POOL_DEFAULTS } from './constants';
import { ByteChunk, ByteChunkPool } from './byte-chunk';

/**
 * Configuration options for BufferPool.
 * @stable
 */
export interface BufferPoolOptions {
    readonly initialCapacityPerBucket?: number;
    readonly maxCapacityPerBucket?: number;
    readonly preallocate?: boolean;
    /**
     * When true, buckets may grow past maxCapacityPerBucket; when false,
     * allocation falls back to a direct (unpooled) ArrayBuffer at the limit.
     */
    readonly autoExpand?: boolean;
    /** Idle eviction age in milliseconds. 0 disables TTL eviction. */
    readonly ttl?: number;
    readonly enableInstrumentation?: boolean;
    readonly name?: string;
    /**
     * When true (default), buffers are zero-filled on release.
     * @default true
     */
    readonly zeroOnRelease?: boolean;
    readonly validator?: (buffer: ArrayBuffer) => boolean;
    readonly onAcquire?: (buffer: ArrayBuffer) => void;
    readonly onRelease?: (buffer: ArrayBuffer) => void;
    readonly onEvict?: (buffer: ArrayBuffer) => void;
    readonly onOutOfMemory?: (requestedSize: number, bucketIndex: number) => void;
}

/**
 * Power-of-two bucket pool for ArrayBuffer instances, backed by ByteChunkPool.
 * ByteBuffer and direct callers share one chunk-based allocation policy.
 * @stable
 */
export class BufferPool {
    private static instance: BufferPool | undefined;

    private readonly pools = new Map<number, ByteChunkPool>();
    private readonly options: Required<BufferPoolOptions>;
    private readonly bucketSizes: number[];
    private readonly bufferToChunk = new WeakMap<ArrayBuffer, ByteChunk<'MUT', 'OWNED'>>();

    private constructor(options: BufferPoolOptions = {}) {
        this.options = {
            initialCapacityPerBucket: options.initialCapacityPerBucket ?? 32,
            maxCapacityPerBucket: options.maxCapacityPerBucket ?? 512,
            preallocate: options.preallocate ?? false,
            autoExpand: options.autoExpand ?? true,
            ttl: options.ttl ?? 0,
            enableInstrumentation: options.enableInstrumentation ?? false,
            name: options.name ?? 'BufferPool',
            zeroOnRelease: options.zeroOnRelease ?? true,
            validator: options.validator ?? (() => true),
            onAcquire: options.onAcquire ?? (() => {}),
            onRelease: options.onRelease ?? (() => {}),
            onEvict: options.onEvict ?? (() => {}),
            onOutOfMemory: options.onOutOfMemory ?? (() => {}),
        };

        this.bucketSizes = Array.from({ length: POOL_DEFAULTS.BUCKET_COUNT }, (_, i) =>
            Math.pow(2, 5 + i)
        );

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
            BufferPool.instance = undefined;
        }
    }

    private initializePools(): void {
        for (let i = 0; i < this.bucketSizes.length; i++) {
            const bucketSize = this.bucketSizes[i];
            if (bucketSize > BUFFER_DEFAULTS.MAX_CAPACITY) {
                break;
            }

            const pool = new ByteChunkPool({
                chunkSize: bucketSize,
                maxIdle: this.options.maxCapacityPerBucket,
                maxTotal: this.options.autoExpand
                    ? Number.POSITIVE_INFINITY
                    : this.options.maxCapacityPerBucket,
                preallocate: this.options.preallocate ? this.options.initialCapacityPerBucket : 0,
                clearOnRelease: this.options.zeroOnRelease,
                ttl: this.options.ttl,
                validator: (chunk) =>
                    chunk.byteLength === bucketSize && this.options.validator(chunk.buffer),
                onAcquire: (chunk) => {
                    this.bufferToChunk.set(chunk.buffer, chunk);
                    this.options.onAcquire(chunk.buffer);
                },
                onRelease: (chunk) => {
                    this.bufferToChunk.delete(chunk.buffer);
                    this.options.onRelease(chunk.buffer);
                },
                onEvict: (chunk) => {
                    this.bufferToChunk.delete(chunk.buffer);
                    this.options.onEvict(chunk.buffer);
                },
            });

            this.pools.set(i, pool);
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

        if (!pool) {
            return new ArrayBuffer(actualSize);
        }

        try {
            return pool.acquire().buffer;
        } catch (error) {
            if (this.options.enableInstrumentation) {
                console.debug(
                    `Pool exhausted for bucket ${bucketIndex}, falling back to direct allocation:`,
                    error
                );
            }
            this.options.onOutOfMemory(requestedSize, bucketIndex);
            return new ArrayBuffer(actualSize);
        }
    }

    tryAllocate(requestedSize: number): ArrayBuffer | null {
        if (requestedSize <= 0 || requestedSize > BUFFER_DEFAULTS.MAX_CAPACITY) {
            return null;
        }

        const bucketIndex = this.getBucketIndex(requestedSize);
        const pool = this.pools.get(bucketIndex);
        if (!pool) {
            return null;
        }

        const chunk = pool.tryAcquire();
        return chunk !== null ? chunk.buffer : null;
    }

    release(buffer: ArrayBuffer): void {
        const chunk = this.bufferToChunk.get(buffer);
        if (chunk === undefined) {
            return;
        }
        chunk.dispose();
    }

    getStats(): BufferPoolStats {
        const bucketStats: BucketStats[] = [];
        let totalAllocated = 0;
        let totalAvailable = 0;
        let totalCapacity = 0;
        let totalHits = 0;
        let totalAllocations = 0;
        let totalMemoryUsage = 0;

        for (const [bucketIndex, pool] of this.pools) {
            const bucketSize = this.bucketSizes[bucketIndex];
            const metrics = this.toMetrics(pool, bucketSize);

            bucketStats.push({
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
            });

            totalAllocated += metrics.allocated;
            totalAvailable += metrics.available;
            totalCapacity += metrics.capacity;
            totalHits += metrics.hitRatio * metrics.allocations;
            totalAllocations += metrics.allocations;
            totalMemoryUsage += metrics.capacity * bucketSize;
        }

        return {
            name: this.options.name,
            bucketCount: this.pools.size,
            totalAllocated,
            totalAvailable,
            totalCapacity,
            overallHitRatio: totalAllocations > 0 ? totalHits / totalAllocations : 0,
            totalMemoryUsage,
            buckets: bucketStats,
        };
    }

    getBucketMetrics(requestedSize: number): PoolPerformanceMetrics | null {
        const bucketIndex = this.getBucketIndex(requestedSize);
        const pool = this.pools.get(bucketIndex);
        if (!pool) {
            return null;
        }
        return this.toMetrics(pool, this.bucketSizes[bucketIndex]);
    }

    clear(): void {
        for (const pool of this.pools.values()) {
            pool.clear();
        }
    }

    drain(): void {
        this.clear();
    }

    compact(): void {
        // Chunk pools have no movable backing store; idle trimming is handled by TTL/clear.
    }

    resizeBucket(requestedSize: number, newCapacity: number): void {
        const bucketIndex = this.getBucketIndex(requestedSize);
        this.pools.get(bucketIndex)?.resize(newCapacity);
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

    private toMetrics(pool: ByteChunkPool, bucketSize: number): PoolPerformanceMetrics {
        const capacity = pool.getTotalCount();
        const allocated = pool.getAllocatedCount();
        const available = pool.getAvailableCount();
        const allocations = pool.getAllocations();
        const releases = pool.getReleases();
        const evictions = pool.getEvictions();
        const hitRatio = pool.getHitRatio();

        return {
            name: `${this.options.name}-Bucket-${bucketSize}`,
            capacity,
            available,
            allocated,
            reserved: 0,
            highWaterMark: capacity,
            allocations,
            releases,
            creations: capacity,
            evictions,
            expansions: 0,
            contractions: 0,
            validationFailures: 0,
            fastPath: pool.getHits(),
            slowPath: allocations - pool.getHits(),
            averageAllocationTime: 0,
            averageReleaseTime: 0,
            peakMemoryUsage: capacity * bucketSize,
            fragmentationRatio: 0,
            utilizationRatio: capacity > 0 ? allocated / capacity : 0,
            turnoverRate: capacity > 0 ? allocations / capacity : 0,
            missRate: allocations > 0 ? 1 - hitRatio : 0,
            hitRatio,
            allocationsPerSecond: 0,
            releasesPerSecond: 0,
            lastCompactionDuration: 0,
            compactionCount: 0,
            lastResizeDuration: 0,
            objectCreationTime: { min: 0, max: 0, avg: 0 },
            objectLifetime: { min: 0, max: 0, avg: 0 },
        };
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
