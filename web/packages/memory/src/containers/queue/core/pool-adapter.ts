import { ObjectPool, type ObjectPoolOptions } from '../../../pool';
import { type IChunkAllocator, MemoryChunk } from './chunk';

export type ObjectPoolChunkAllocatorOptions = Omit<
    ObjectPoolOptions<MemoryChunk<unknown>>,
    'factory' | 'asyncFactory' | 'resetHandler' | 'validateHandler'
>;

/**
 * Chunk allocator backed by the shared ObjectPool. Use when chunk reuse must
 * participate in pool metrics, eviction, or a shared pool budget.
 */
export class ObjectPoolChunkAllocator<T> implements IChunkAllocator<T> {
    private readonly _pool: ObjectPool<MemoryChunk<T>>;

    constructor(options: ObjectPoolChunkAllocatorOptions = {}) {
        this._pool = new ObjectPool<MemoryChunk<T>>({
            ...(options as ObjectPoolOptions<MemoryChunk<T>>),
            factory: () => new MemoryChunk<T>(),
        });
    }

    public acquire(): MemoryChunk<T> {
        return this._pool.acquire();
    }

    public release(chunk: MemoryChunk<T>): void {
        this._pool.release(chunk);
    }

    public clear(): void {
        this._pool.releaseAll();
        this._pool.clear();
    }

    public get availableCount(): number {
        return this._pool.getAvailableCount();
    }

    public get allocatedCount(): number {
        return this._pool.getAllocatedCount();
    }

    public get totalCount(): number {
        return this._pool.getTotalCount();
    }

    public getMetrics() {
        return this._pool.getMetrics();
    }

    public [Symbol.dispose](): void {
        this._pool[Symbol.dispose]();
    }
}
