import { MemoryPool, MemoryPoolOptions, PoolableObject } from './mempool';

export type TypedArrayType =
    | Float32Array
    | Float64Array
    | Int8Array
    | Int16Array
    | Int32Array
    | Uint8Array
    | Uint16Array
    | Uint32Array
    | BigInt64Array
    | BigUint64Array;

export type TypedArrayConstructor<T extends TypedArrayType> = {
    new (length: number): T;
    new (buffer: ArrayBuffer, byteOffset?: number, length?: number): T;
    BYTES_PER_ELEMENT: number;
};

export interface PoolableTypedArray<T extends TypedArrayType> extends PoolableObject {
    readonly array: T;
    readonly byteLength: number;
    readonly length: number;
    readonly bytesPerElement: number;
    readonly isAligned: boolean;
    readonly alignment: number;
    readonly buffer: ArrayBuffer;

    zero(): void;

    fill(value: number, start?: number, end?: number): this;

    resize(newLength: number): boolean;

    copyFrom(
        source: ArrayLike<number>,
        sourceOffset?: number,
        targetOffset?: number,
        length?: number
    ): void;

    subarray(start?: number, end?: number): T;
}

export interface TypedArrayPoolOptions<T extends TypedArrayType>
    extends Omit<MemoryPoolOptions<PoolableTypedArray<T>>, 'factory'> {
    readonly arrayConstructor: TypedArrayConstructor<T>;

    readonly defaultLength?: number;

    readonly alignment?: number;

    readonly sizeBuckets?: readonly number[];

    readonly maxPoolableLength?: number;

    readonly zeroOnRelease?: boolean;

    readonly validateIntegrity?: boolean;

    readonly initializeArray?: (array: T) => void;

    readonly growthStrategy?: 'exact' | 'bucket' | 'exponential';

    readonly growthFactor?: number;
}

export interface TypedArrayPoolStats {
    readonly poolMetrics: ReturnType<MemoryPool<any>['getMetrics']>;
    readonly arrayStats: {
        readonly totalArrays: number;
        readonly totalMemory: number;
        readonly averageLength: number;
        readonly lengthDistribution: Map<number, number>;
        readonly alignmentUtilization: number;
        readonly wasteRatio: number;
    };
    readonly performanceStats: {
        readonly allocationTime: {
            readonly min: number;
            readonly max: number;
            readonly avg: number;
            readonly samples: number;
        };
        readonly zeroingTime: {
            readonly min: number;
            readonly max: number;
            readonly avg: number;
            readonly samples: number;
        };
        readonly copyTime: {
            readonly min: number;
            readonly max: number;
            readonly avg: number;
            readonly samples: number;
        };
    };
}

export class TypedArrayPool<T extends TypedArrayType> {
    private readonly _pools: Map<number, MemoryPool<PoolableTypedArray<T>>>;
    private readonly _options: Partial<TypedArrayPoolOptions<T>> & {
        arrayConstructor: TypedArrayConstructor<T>;
        defaultLength: number;
        alignment: number;
        maxPoolableLength: number;
        zeroOnRelease: boolean;
        growthStrategy: 'exact' | 'bucket' | 'exponential';
        growthFactor: number;
    };
    private readonly _buckets: readonly number[];
    private readonly _performanceTracker: {
        allocationTimes: number[];
        zeroingTimes: number[];
        copyTimes: number[];
    };
    private readonly _stats = {
        totalAllocations: 0,
        totalReleases: 0,
        totalMemoryAllocated: 0,
        bucketsHit: new Map<number, number>(),
        oversizedRequests: 0,
        alignmentMisses: 0,
    };

    constructor(options: TypedArrayPoolOptions<T>) {
        this._options = {
            arrayConstructor: options.arrayConstructor,
            defaultLength: options.defaultLength ?? 1024,
            alignment: options.alignment ?? 0,
            maxPoolableLength: options.maxPoolableLength ?? 1024 * 1024,
            zeroOnRelease: options.zeroOnRelease ?? true,
            growthStrategy: options.growthStrategy ?? 'bucket',
            growthFactor: options.growthFactor ?? 1.5,
            initialCapacity: options.initialCapacity ?? 16,
            maxCapacity: options.maxCapacity ?? 256,
            minFree: options.minFree ?? 4,
            highWatermarkRatio: options.highWatermarkRatio ?? 0.85,
            lowWatermarkRatio: options.lowWatermarkRatio ?? 0.25,
            expansionStrategy: options.expansionStrategy ?? 'multiplicative',
            expansionFactor: options.expansionFactor ?? 1.5,
            expansionRate: options.expansionRate ?? 0,
            allocationStrategy: options.allocationStrategy ?? 'least-recently-used',
            evictionPolicy: options.evictionPolicy ?? 'lru',
            ttl: options.ttl ?? 0,
            resetOnRecycle: options.resetOnRecycle ?? true,
            preallocate: options.preallocate ?? true,
            autoExpand: options.autoExpand ?? true,
            compactionThreshold: options.compactionThreshold ?? 32,
            compactionTriggerRatio: options.compactionTriggerRatio ?? 0.3,
            enableMetrics: options.enableMetrics ?? true,
            enableInstrumentation: options.enableInstrumentation ?? false,
            name: options.name ?? `TypedArrayPool<${options.arrayConstructor.name}>`,
            maxObjectAge: options.maxObjectAge ?? 300000,
            threadSafe: options.threadSafe ?? false,
            sizeBuckets: options.sizeBuckets,
            initializeArray: options.initializeArray,
            validateIntegrity: options.validateIntegrity,
        };

        this._buckets = this._options.sizeBuckets ?? this._generateDefaultBuckets();

        this._pools = new Map();
        this._performanceTracker = {
            allocationTimes: [],
            zeroingTimes: [],
            copyTimes: [],
        };

        this._initializePools();
    }

    acquire(length: number = this._options.defaultLength): PoolableTypedArray<T> {
        const startTime = performance.now();

        const bucketSize = this._findBestBucket(length);
        const pool = this._pools.get(bucketSize);

        if (!pool) {
            throw new Error(`No pool available for bucket size ${bucketSize}`);
        }

        this._stats.totalAllocations++;
        this._stats.bucketsHit.set(bucketSize, (this._stats.bucketsHit.get(bucketSize) ?? 0) + 1);

        if (length > this._options.maxPoolableLength) {
            this._stats.oversizedRequests++;
            return this._createOversizedArray(length);
        }

        const pooled = pool.acquire();

        if (pooled.length !== length) {
            pooled.resize(length);
        }

        const allocationTime = performance.now() - startTime;
        this._trackPerformance('allocation', allocationTime);

        return pooled;
    }

    release(pooledArray: PoolableTypedArray<T>): void {
        const startTime = performance.now();

        if (this._options.validateIntegrity && !this._validateArray(pooledArray)) {
            console.warn('TypedArrayPool: Invalid array detected during release');
            return;
        }

        if (this._options.zeroOnRelease) {
            const zeroStart = performance.now();
            pooledArray.zero();
            this._trackPerformance('zeroing', performance.now() - zeroStart);
        }

        this._stats.totalReleases++;

        const bucketSize = this._findBestBucket(pooledArray.length);
        const pool = this._pools.get(bucketSize);

        if (pool && pooledArray.length <= this._options.maxPoolableLength) {
            pool.release(pooledArray);
        }

        const releaseTime = performance.now() - startTime;
        this._trackPerformance('allocation', releaseTime); // Track as negative allocation time
    }

    acquireWithData(source: ArrayLike<number>): PoolableTypedArray<T> {
        const startTime = performance.now();

        const pooled = this.acquire(source.length);
        pooled.copyFrom(source);

        this._trackPerformance('copy', performance.now() - startTime);
        return pooled;
    }

    getStats(): TypedArrayPoolStats {
        const poolMetrics = Array.from(this._pools.values()).map((pool) => pool.getMetrics());
        const totalArrays = poolMetrics.reduce((sum, m) => sum + m.allocated, 0);
        const totalMemory = poolMetrics.reduce((sum, m) => sum + m.allocated * m.capacity, 0);

        return {
            poolMetrics: poolMetrics[0], // Primary pool metrics
            arrayStats: {
                totalArrays,
                totalMemory: this._stats.totalMemoryAllocated,
                averageLength: totalArrays > 0 ? totalMemory / totalArrays : 0,
                lengthDistribution: new Map(this._stats.bucketsHit),
                alignmentUtilization: this._calculateAlignmentUtilization(),
                wasteRatio: this._calculateWasteRatio(),
            },
            performanceStats: {
                allocationTime: this._getPerformanceStats('allocation'),
                zeroingTime: this._getPerformanceStats('zeroing'),
                copyTime: this._getPerformanceStats('copy'),
            },
        };
    }

    clear(): void {
        for (const pool of this._pools.values()) {
            pool.clear();
        }

        this._stats.totalAllocations = 0;
        this._stats.totalReleases = 0;
        this._stats.totalMemoryAllocated = 0;
        this._stats.bucketsHit.clear();
        this._stats.oversizedRequests = 0;
        this._stats.alignmentMisses = 0;

        this._performanceTracker.allocationTimes.length = 0;
        this._performanceTracker.zeroingTimes.length = 0;
        this._performanceTracker.copyTimes.length = 0;
    }

    dispose(): void {
        for (const pool of this._pools.values()) {
            pool.clear();
        }
        this._pools.clear();
        this.clear();
    }

    private _initializePools(): void {
        for (const bucketSize of this._buckets) {
            const poolOptions: MemoryPoolOptions<PoolableTypedArray<T>> = {
                ...this._options,
                factory: () => this._createPoolableArray(bucketSize),
                name: `${this._options.name}[${bucketSize}]`,
            };

            this._pools.set(bucketSize, new MemoryPool(poolOptions));
        }
    }

    private _createPoolableArray(length: number): PoolableTypedArray<T> {
        const buffer =
            this._options.alignment > 0
                ? this._createAlignedBuffer(length)
                : new ArrayBuffer(length * this._options.arrayConstructor.BYTES_PER_ELEMENT);

        const array = new this._options.arrayConstructor(buffer) as T;

        if (this._options.initializeArray) {
            this._options.initializeArray(array);
        }

        this._stats.totalMemoryAllocated += buffer.byteLength;

        const poolable: PoolableTypedArray<T> = {
            array,
            byteLength: buffer.byteLength,
            length: array.length,
            bytesPerElement: this._options.arrayConstructor.BYTES_PER_ELEMENT,
            isAligned: this._options.alignment > 0,
            alignment: this._options.alignment,
            buffer,

            zero(): void {
                (array as any).fill(0);
            },

            fill(value: number, start?: number, end?: number): any {
                (array as any).fill(value, start, end);
                return this;
            },

            resize(newLength: number): boolean {
                if (newLength === array.length) return true;
                if (newLength > array.length) return false; // Can't expand existing buffer

                (this as any).array = new (this.array.constructor as any)(
                    buffer,
                    0,
                    newLength
                ) as T;
                (this as any).length = newLength;
                return true;
            },

            copyFrom(
                source: ArrayLike<number>,
                sourceOffset: number = 0,
                targetOffset: number = 0,
                length?: number
            ): void {
                const copyLength =
                    length ?? Math.min(source.length - sourceOffset, array.length - targetOffset);

                if (source instanceof array.constructor) {
                    array.set(
                        (source as any).subarray(sourceOffset, sourceOffset + copyLength),
                        targetOffset
                    );
                } else {
                    for (let i = 0; i < copyLength; i++) {
                        array[targetOffset + i] = source[sourceOffset + i];
                    }
                }
            },

            subarray(start?: number, end?: number): T {
                return array.subarray(start, end) as T;
            },

            reset(): void {},
        };

        return poolable;
    }

    private _createOversizedArray(length: number): PoolableTypedArray<T> {
        return this._createPoolableArray(length);
    }

    private _createAlignedBuffer(length: number): ArrayBuffer {
        const requiredBytes = length * this._options.arrayConstructor.BYTES_PER_ELEMENT;
        const alignedBytes =
            Math.ceil(requiredBytes / this._options.alignment) * this._options.alignment;

        const buffer = new ArrayBuffer(alignedBytes);

        if (this._options.alignment > 1) {
            const address = this._getBufferAddress(buffer);
            if (address % this._options.alignment !== 0) {
                this._stats.alignmentMisses++;
            }
        }

        return buffer;
    }

    private _getBufferAddress(buffer: ArrayBuffer): number {
        // This is a heuristic - JavaScript doesn't expose actual memory addresses
        // We use the buffer's identity hash as a proxy
        return buffer.byteLength; // Simplified approach
    }

    private _generateDefaultBuckets(): number[] {
        const buckets: number[] = [];
        const max = this._options.maxPoolableLength;

        for (let size = 64; size <= max; size *= 2) {
            buckets.push(size);
        }

        return buckets;
    }

    private _findBestBucket(length: number): number {
        for (const bucket of this._buckets) {
            if (bucket >= length) {
                return bucket;
            }
        }

        switch (this._options.growthStrategy) {
            case 'exact':
                return length;
            case 'exponential':
                return Math.ceil(length * this._options.growthFactor);
            case 'bucket':
            default:
                return this._buckets[this._buckets.length - 1];
        }
    }

    private _validateArray(pooledArray: PoolableTypedArray<T>): boolean {
        return (
            pooledArray.array instanceof this._options.arrayConstructor &&
            pooledArray.array.buffer === pooledArray.buffer &&
            pooledArray.array.byteLength <= pooledArray.buffer.byteLength
        );
    }

    private _trackPerformance(type: 'allocation' | 'zeroing' | 'copy', time: number): void {
        const tracker = this._performanceTracker;
        const array = tracker[`${type}Times`];

        array.push(time);

        if (array.length > 1000) {
            array.shift();
        }
    }

    private _getPerformanceStats(type: 'allocation' | 'zeroing' | 'copy') {
        const times = this._performanceTracker[`${type}Times`];

        if (times.length === 0) {
            return { min: 0, max: 0, avg: 0, samples: 0 };
        }

        const min = Math.min(...times);
        const max = Math.max(...times);
        const avg = times.reduce((sum, t) => sum + t, 0) / times.length;

        return { min, max, avg, samples: times.length };
    }

    private _calculateAlignmentUtilization(): number {
        if (this._options.alignment <= 1) return 1.0;

        const totalMisses = this._stats.alignmentMisses;
        const totalAllocations = this._stats.totalAllocations;

        return totalAllocations > 0 ? 1.0 - totalMisses / totalAllocations : 1.0;
    }

    private _calculateWasteRatio(): number {
        let totalWaste = 0;
        let totalUsed = 0;

        for (const [bucketSize, hitCount] of this._stats.bucketsHit) {
            const avgUtilization = bucketSize * 0.75; // Assume 75% average utilization
            totalWaste += (bucketSize - avgUtilization) * hitCount;
            totalUsed += avgUtilization * hitCount;
        }

        return totalUsed > 0 ? totalWaste / (totalWaste + totalUsed) : 0;
    }
}

export const TypedArrayPools = {
    Float32: new TypedArrayPool({
        arrayConstructor: Float32Array,
        defaultLength: 1024,
        sizeBuckets: [64, 256, 1024, 4096, 16384, 65536],
        name: 'Float32Pool',
        alignment: 16, // SIMD alignment
        enableMetrics: true,
    }),

    Float64: new TypedArrayPool({
        arrayConstructor: Float64Array,
        defaultLength: 512,
        sizeBuckets: [32, 128, 512, 2048, 8192, 32768],
        name: 'Float64Pool',
        alignment: 16,
        enableMetrics: true,
    }),

    Uint32: new TypedArrayPool({
        arrayConstructor: Uint32Array,
        defaultLength: 1024,
        sizeBuckets: [64, 256, 1024, 4096, 16384, 65536],
        name: 'Uint32Pool',
        alignment: 16,
        enableMetrics: true,
    }),

    Uint16: new TypedArrayPool({
        arrayConstructor: Uint16Array,
        defaultLength: 2048,
        sizeBuckets: [128, 512, 2048, 8192, 32768, 131072],
        name: 'Uint16Pool',
        enableMetrics: true,
    }),

    Uint8: new TypedArrayPool({
        arrayConstructor: Uint8Array,
        defaultLength: 4096,
        sizeBuckets: [256, 1024, 4096, 16384, 65536, 262144],
        name: 'Uint8Pool',
        enableMetrics: true,
    }),
} as const;
