import type { IMemoryManager } from './interfaces';
import { ParticleSystemException } from './error';
import {
    TypedArrayPool as UtilityTypedArrayPool,
    TypedArrayPools,
    PoolableTypedArray,
} from '@axrone/utility';

export class ParticleMemoryManager implements IMemoryManager {
    private readonly _alignedManager: AlignedMemoryManager;
    private readonly _pooledManager: PooledMemoryManager;
    private readonly _typedArrayPools: Map<string, any>;
    private readonly _activeTypedArrays = new WeakSet<PoolableTypedArray<any>>();

    private _stats = {
        totalTypedArrayAllocations: 0,
        totalTypedArrayReleases: 0,
        activeTypedArrays: 0,
        poolHitRate: 0,
    };

    constructor() {
        this._alignedManager = new AlignedMemoryManager();
        this._pooledManager = new PooledMemoryManager();
        this._typedArrayPools = new Map();

        this._typedArrayPools.set('Float32Array', TypedArrayPools.Float32);
        this._typedArrayPools.set('Float64Array', TypedArrayPools.Float64);
        this._typedArrayPools.set('Uint32Array', TypedArrayPools.Uint32);
        this._typedArrayPools.set('Uint16Array', TypedArrayPools.Uint16);
        this._typedArrayPools.set('Uint8Array', TypedArrayPools.Uint8);
    }

    allocateTypedArray<
        T extends Float32Array | Float64Array | Uint32Array | Uint16Array | Uint8Array,
    >(constructor: new (length: number) => T, length: number): PoolableTypedArray<T> {
        const pool = this._typedArrayPools.get(constructor.name);
        if (!pool) {
            throw new Error(`No pool available for ${constructor.name}`);
        }

        const pooled = pool.acquire(length);
        this._activeTypedArrays.add(pooled);
        this._stats.totalTypedArrayAllocations++;
        this._stats.activeTypedArrays++;

        return pooled;
    }

    releaseTypedArray<
        T extends Float32Array | Float64Array | Uint32Array | Uint16Array | Uint8Array,
    >(pooled: PoolableTypedArray<T>): void {
        if (!this._activeTypedArrays.has(pooled)) {
            console.warn('Attempting to release TypedArray that was not allocated by this manager');
            return;
        }

        const constructorName = pooled.array.constructor.name;
        const pool = this._typedArrayPools.get(constructorName);

        if (pool) {
            pool.release(pooled);
            this._activeTypedArrays.delete(pooled);
            this._stats.totalTypedArrayReleases++;
            this._stats.activeTypedArrays--;
        }
    }

    createTypedArrayWithData<
        T extends Float32Array | Float64Array | Uint32Array | Uint16Array | Uint8Array,
    >(constructor: new (length: number) => T, data: ArrayLike<number>): PoolableTypedArray<T> {
        const pool = this._typedArrayPools.get(constructor.name);
        if (!pool) {
            throw new Error(`No pool available for ${constructor.name}`);
        }

        const pooled = pool.acquireWithData(data);
        this._activeTypedArrays.add(pooled);
        this._stats.totalTypedArrayAllocations++;
        this._stats.activeTypedArrays++;

        return pooled;
    }

    getExtendedStats() {
        const alignedStats = this._alignedManager.getStats();
        const pooledStats = this._pooledManager.getStats();

        const typedArrayStats = Array.from(this._typedArrayPools.entries()).map(
            ([typeName, pool]) => ({
                type: typeName,
                stats: pool.getStats(),
            })
        );

        return {
            aligned: alignedStats,
            pooled: pooledStats,
            typedArrays: typedArrayStats,
            manager: {
                ...this._stats,
                poolHitRate:
                    this._stats.totalTypedArrayReleases > 0
                        ? this._stats.totalTypedArrayReleases /
                          this._stats.totalTypedArrayAllocations
                        : 0,
            },
        };
    }

    allocate(size: number, alignment: number = 16): ArrayBuffer | null {
        return (
            this._pooledManager.allocate(size, alignment) ??
            this._alignedManager.allocate(size, alignment)
        );
    }

    deallocate(buffer: ArrayBuffer): void {
        this._pooledManager.deallocate(buffer);
        this._alignedManager.deallocate(buffer);
    }

    reallocate(buffer: ArrayBuffer, newSize: number): ArrayBuffer | null {
        return (
            this._pooledManager.reallocate(buffer, newSize) ??
            this._alignedManager.reallocate(buffer, newSize)
        );
    }

    getStats() {
        const pooledStats = this._pooledManager.getStats();
        const alignedStats = this._alignedManager.getStats();

        return {
            totalAllocated: pooledStats.totalAllocated + alignedStats.totalAllocated,
            totalUsed: pooledStats.totalUsed + alignedStats.totalUsed,
            allocationCount: pooledStats.allocationCount + alignedStats.allocationCount,
            fragmentationRatio:
                (pooledStats.fragmentationRatio + alignedStats.fragmentationRatio) / 2,
        } as const;
    }

    clear(): void {
        for (const pool of this._typedArrayPools.values()) {
            pool.clear();
        }

        this._stats.totalTypedArrayAllocations = 0;
        this._stats.totalTypedArrayReleases = 0;
        this._stats.activeTypedArrays = 0;
        this._stats.poolHitRate = 0;
    }

    dispose(): void {
        this.clear();

        for (const pool of this._typedArrayPools.values()) {
            pool.dispose();
        }

        this._typedArrayPools.clear();
    }
}

export class AlignedMemoryManager implements IMemoryManager {
    private readonly _allocations = new Map<ArrayBuffer, { size: number; alignment: number }>();
    private _totalAllocated = 0;
    private _allocationCount = 0;

    allocate(size: number, alignment: number = 16): ArrayBuffer | null {
        if (size <= 0) return null;

        const alignedSize = this._alignSize(size, alignment);

        try {
            const buffer = new ArrayBuffer(alignedSize);
            this._allocations.set(buffer, { size: alignedSize, alignment });
            this._totalAllocated += alignedSize;
            this._allocationCount++;
            return buffer;
        } catch {
            throw ParticleSystemException.memoryAllocationFailed(alignedSize);
        }
    }

    deallocate(buffer: ArrayBuffer): void {
        const allocation = this._allocations.get(buffer);
        if (!allocation) return;

        this._allocations.delete(buffer);
        this._totalAllocated -= allocation.size;
        this._allocationCount--;
    }

    reallocate(buffer: ArrayBuffer, newSize: number): ArrayBuffer | null {
        const allocation = this._allocations.get(buffer);
        if (!allocation) return null;

        const newBuffer = this.allocate(newSize, allocation.alignment);
        if (!newBuffer) return null;

        const copySize = Math.min(buffer.byteLength, newSize);
        new Uint8Array(newBuffer).set(new Uint8Array(buffer, 0, copySize));

        this.deallocate(buffer);
        return newBuffer;
    }

    getStats() {
        return {
            totalAllocated: this._totalAllocated,
            totalUsed: this._totalAllocated,
            allocationCount: this._allocationCount,
            fragmentationRatio: 0,
        } as const;
    }

    private _alignSize(size: number, alignment: number): number {
        return Math.ceil(size / alignment) * alignment;
    }
}

export class PooledMemoryManager implements IMemoryManager {
    private readonly _pools = new Map<number, ArrayBuffer[]>();
    private readonly _allocations = new Map<ArrayBuffer, number>();
    private readonly _poolSizes: readonly number[];
    private _totalAllocated = 0;
    private _totalUsed = 0;
    private _allocationCount = 0;

    constructor(poolSizes: readonly number[] = [64, 256, 1024, 4096, 16384, 65536]) {
        this._poolSizes = [...poolSizes].sort((a, b) => a - b);
        for (const size of this._poolSizes) {
            this._pools.set(size, []);
        }
    }

    allocate(size: number, alignment: number = 16): ArrayBuffer | null {
        if (size <= 0) return null;

        const alignedSize = this._alignSize(size, alignment);
        const poolSize = this._findPoolSize(alignedSize);

        if (poolSize) {
            const pool = this._pools.get(poolSize)!;
            let buffer = pool.pop();

            if (!buffer) {
                try {
                    buffer = new ArrayBuffer(poolSize);
                } catch {
                    throw ParticleSystemException.memoryAllocationFailed(poolSize);
                }
            }

            this._allocations.set(buffer, poolSize);
            this._totalUsed += alignedSize;
            this._allocationCount++;
            return buffer;
        }

        try {
            const buffer = new ArrayBuffer(alignedSize);
            this._allocations.set(buffer, alignedSize);
            this._totalAllocated += alignedSize;
            this._totalUsed += alignedSize;
            this._allocationCount++;
            return buffer;
        } catch {
            throw ParticleSystemException.memoryAllocationFailed(alignedSize);
        }
    }

    deallocate(buffer: ArrayBuffer): void {
        const size = this._allocations.get(buffer);
        if (!size) return;

        this._allocations.delete(buffer);
        this._totalUsed -= buffer.byteLength;
        this._allocationCount--;

        const pool = this._pools.get(size);
        if (pool && pool.length < 100) {
            pool.push(buffer);
        } else if (!pool) {
            this._totalAllocated -= size;
        }
    }

    reallocate(buffer: ArrayBuffer, newSize: number): ArrayBuffer | null {
        const oldSize = this._allocations.get(buffer);
        if (!oldSize) return null;

        const newBuffer = this.allocate(newSize);
        if (!newBuffer) return null;

        const copySize = Math.min(buffer.byteLength, newSize);
        new Uint8Array(newBuffer).set(new Uint8Array(buffer, 0, copySize));

        this.deallocate(buffer);
        return newBuffer;
    }

    getStats() {
        const totalPooled = Array.from(this._pools.entries()).reduce(
            (sum, [size, pool]) => sum + size * pool.length,
            0
        );

        return {
            totalAllocated: this._totalAllocated + totalPooled,
            totalUsed: this._totalUsed,
            allocationCount: this._allocationCount,
            fragmentationRatio: totalPooled / (this._totalAllocated + totalPooled),
        } as const;
    }

    private _alignSize(size: number, alignment: number): number {
        return Math.ceil(size / alignment) * alignment;
    }

    private _findPoolSize(size: number): number | null {
        for (const poolSize of this._poolSizes) {
            if (poolSize >= size) return poolSize;
        }
        return null;
    }
}

export const MemoryManager = {
    aligned: new AlignedMemoryManager(),
    pooled: new PooledMemoryManager(),
    particle: new ParticleMemoryManager(),
} as const;
