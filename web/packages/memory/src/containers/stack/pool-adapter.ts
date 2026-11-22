import type { IStackMetricsSink } from './types';
import { ObjectPool, type ObjectPoolOptions } from '../../pool';

export interface ChunkPoolOptions<T>
    extends Omit<ObjectPoolOptions<(T | undefined)[]>, 'factory'> {
    readonly chunkSize?: number;
}

export class ChunkPool<T> {
    private readonly _pool: ObjectPool<(T | undefined)[]>;
    private readonly _chunkSize: number;
    private readonly _metrics: IStackMetricsSink | undefined;

    constructor(options: ChunkPoolOptions<T> = {}) {
        const chunkSize = options.chunkSize ?? 64;
        this._chunkSize = chunkSize;
        this._metrics = options.onAcquireHandler
            ? {
                  onPush: () => {},
                  onPop: () => {},
                  onChunkAllocated: () => options.onAcquireHandler?.([] as any),
                  onChunkDeallocated: () => options.onEvictHandler?.([] as any),
              }
            : undefined;

        this._pool = new ObjectPool<(T | undefined)[]>({
            ...options,
            factory: () => {
                const chunk: (T | undefined)[] = new Array(chunkSize);
                for (let i = 0; i < chunkSize; i++) {
                    chunk[i] = undefined;
                }
                return chunk;
            },
            resetHandler: (chunk) => {
                for (let i = 0; i < chunkSize; i++) {
                    chunk[i] = undefined;
                }
            },
        });
    }

    acquire(): (T | undefined)[] {
        this._metrics?.onChunkAllocated();
        return this._pool.acquire();
    }

    release(chunk: (T | undefined)[]): void {
        this._metrics?.onChunkDeallocated();
        this._pool.release(chunk);
    }

    clear(): void {
        this._pool.clear();
    }

    get available(): number {
        return this._pool.getAvailableCount();
    }

    get allocated(): number {
        return this._pool.getAllocatedCount();
    }

    get total(): number {
        return this._pool.getTotalCount();
    }

    [Symbol.dispose](): void {
        this._pool[Symbol.dispose]();
    }
}

export class StackChunkPoolAdapter<T> {
    private readonly _pool: ChunkPool<T>;
    private readonly _maxPooledChunks: number;
    private _pooledChunks: (T | undefined)[][];

    constructor(maxPooledChunks: number = 4, options?: ChunkPoolOptions<T>) {
        this._pool = new ChunkPool<T>(options);
        this._maxPooledChunks = maxPooledChunks;
        this._pooledChunks = [];
    }

    acquireChunk(): (T | undefined)[] {
        const pooled = this._pooledChunks.pop();
        if (pooled !== undefined) {
            return pooled;
        }
        return this._pool.acquire();
    }

    releaseChunk(chunk: (T | undefined)[]): void {
        if (this._pooledChunks.length < this._maxPooledChunks) {
            this._pooledChunks.push(chunk);
        } else {
            this._pool.release(chunk);
        }
    }

    clear(): void {
        for (const chunk of this._pooledChunks) {
            this._pool.release(chunk);
        }
        this._pooledChunks = [];
        this._pool.clear();
    }

    [Symbol.dispose](): void {
        this.clear();
        this._pool[Symbol.dispose]();
    }
}
