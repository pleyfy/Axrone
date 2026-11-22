import { err, ok, type Result } from '@axrone/utility';
import {
    TilemapErrorCode,
    tilemapError,
    type TilemapError,
} from '../errors';
import type { ChunkKey } from '../types/brands';
import type { ChunkSnapshot } from '../types/chunk';

export interface IChunkPager {
    /** `null` means the chunk was never persisted. */
    load(
        key: ChunkKey,
        signal?: AbortSignal
    ): Promise<Result<ChunkSnapshot | null, TilemapError>>;
    save(
        snapshot: ChunkSnapshot,
        signal?: AbortSignal
    ): Promise<Result<void, TilemapError>>;
}

const cloneSnapshot = (snapshot: ChunkSnapshot): ChunkSnapshot => ({
    key: snapshot.key,
    chunkShift: snapshot.chunkShift,
    layerCount: snapshot.layerCount,
    words: snapshot.words.slice(),
});

/**
 * In-memory pager for tests, tooling and single-session editing. It clones on
 * both ends so callers never alias stored words.
 */
export class MemoryChunkPager implements IChunkPager {
    readonly #chunks = new Map<number, ChunkSnapshot>();

    async load(
        key: ChunkKey,
        _signal?: AbortSignal
    ): Promise<Result<ChunkSnapshot | null, TilemapError>> {
        const stored = this.#chunks.get(key as unknown as number);
        return ok(stored === undefined ? null : cloneSnapshot(stored));
    }

    async save(
        snapshot: ChunkSnapshot,
        _signal?: AbortSignal
    ): Promise<Result<void, TilemapError>> {
        this.#chunks.set(
            snapshot.key as unknown as number,
            cloneSnapshot(snapshot)
        );
        return ok(undefined);
    }

    delete(key: ChunkKey): boolean {
        return this.#chunks.delete(key as unknown as number);
    }

    has(key: ChunkKey): boolean {
        return this.#chunks.has(key as unknown as number);
    }

    get size(): number {
        return this.#chunks.size;
    }

    keys(): ChunkKey[] {
        return Array.from(this.#chunks.keys()) as ChunkKey[];
    }

    clear(): void {
        this.#chunks.clear();
    }
}

/** Pager that always reports an empty store and rejects saves. */
export class ReadOnlyChunkPager implements IChunkPager {
    readonly #source: IChunkPager;

    constructor(source: IChunkPager) {
        this.#source = source;
    }

    load(
        key: ChunkKey,
        signal?: AbortSignal
    ): Promise<Result<ChunkSnapshot | null, TilemapError>> {
        return this.#source.load(key, signal);
    }

    async save(): Promise<Result<void, TilemapError>> {
        return err(
            tilemapError(
                TilemapErrorCode.PAGER_IO_ERROR,
                'read-only pager cannot save chunks'
            )
        );
    }
}
