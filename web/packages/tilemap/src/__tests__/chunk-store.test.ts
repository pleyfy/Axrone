import { describe, expect, it, vi } from 'vitest';
import { ok, type Result } from '@axrone/utility';
import { packChunkKey } from '../codec/spatial-codec';
import { TileCodec } from '../codec/tile-codec';
import { ChunkStore, type ChunkStoreOptions } from '../grid/chunk-store';
import type { TilemapMetricsSink } from '../metrics';
import {
    asChunkKey,
    type ChunkKey,
    type PackedTileWord,
} from '../types/brands';
import type { ChunkSnapshot } from '../types/chunk';
import type { TilemapError } from '../errors';

const key = (chunkX: number, chunkY: number): ChunkKey =>
    asChunkKey(packChunkKey(chunkX, chunkY));

const word = (tileId: number): PackedTileWord => TileCodec.pack(tileId);

interface MetricRecord {
    allocated: ChunkKey[];
    loaded: ChunkKey[];
    evicted: { key: ChunkKey; dirty: boolean }[];
    dirtied: ChunkKey[];
    gauges: { name: string; value: number }[];
    exhausted: number;
}

const createMetrics = (): {
    record: MetricRecord;
    metrics: TilemapMetricsSink;
} => {
    const record: MetricRecord = {
        allocated: [],
        loaded: [],
        evicted: [],
        dirtied: [],
        gauges: [],
        exhausted: 0,
    };
    return {
        record,
        metrics: {
            onChunkAllocated: (chunkKey) => record.allocated.push(chunkKey),
            onChunkLoaded: (chunkKey) => record.loaded.push(chunkKey),
            onChunkEvicted: (chunkKey, dirty) =>
                record.evicted.push({ key: chunkKey, dirty }),
            onChunkDirtied: (chunkKey) => record.dirtied.push(chunkKey),
            onGauge: (name, value) => record.gauges.push({ name, value }),
            onPoolExhausted: () => record.exhausted++,
        },
    };
};

const createStore = (
    overrides: Partial<ChunkStoreOptions> = {}
): ChunkStore =>
    new ChunkStore({
        chunkShift: 3,
        layerCount: 2,
        maxLoadedChunks: 4,
        maxDirtyChunks: 4,
        defaultWords: new Uint32Array([0, 0]),
        ...overrides,
    });

const markClean = (store: ChunkStore, chunkKey: ChunkKey): void => {
    const generation = store.dirtyGeneration(chunkKey);
    if (generation !== null) store.markClean(chunkKey, generation);
};

const expectError = (
    result: Result<unknown, TilemapError>,
    code: string
): TilemapError => {
    expect(result.isErr()).toBe(true);
    const error = result.expectErr('expected error');
    expect(error.code).toBe(code);
    return error;
};

const snapshot = (
    chunkKey: ChunkKey,
    words: number[] = [1, 2, 3, 4],
    chunkShift: 3 | 4 | 5 | 6 = 3,
    layerCount = 2
): ChunkSnapshot => ({
    key: chunkKey,
    chunkShift,
    layerCount,
    words: Uint32Array.from(words),
});

describe('ChunkStore', () => {
    it('allocates lazily and reports residency', () => {
        const store = createStore();
        const chunk = key(0, 0);

        expect(store.isResident(chunk)).toBe(false);
        const unloaded = store.readWord(chunk, 0, 0, 0);
        expect(unloaded.residency).toBe('unloaded');
        expect(unloaded.word).toBe(0);

        expect(store.writeWord(chunk, 0, 1, 2, word(5)).isOk()).toBe(true);
        expect(store.isResident(chunk)).toBe(true);
        expect(store.readWord(chunk, 0, 1, 2)).toEqual({
            word: word(5),
            residency: 'resident',
        });
        expect(store.readWord(chunk, 0, 0, 0)).toEqual({
            word: 0,
            residency: 'default',
        });
        expect(store.readWord(chunk, 1, 1, 2).residency).toBe('default');
    });

    it('does not allocate a chunk when writing the default word', () => {
        const store = createStore();
        const chunk = key(0, 0);
        expect(store.writeWord(chunk, 0, 0, 0, word(0)).isOk()).toBe(true);
        expect(store.isResident(chunk)).toBe(false);
        expect(store.writeWord(chunk, 1, 0, 0, word(0)).isOk()).toBe(true);
        expect(store.isResident(chunk)).toBe(false);
    });

    it('tracks dirty chunks and the dirty budget', () => {
        const store = createStore({ maxDirtyChunks: 1 });
        const { record, metrics } = createMetrics();
        const tracked = createStore({ maxDirtyChunks: 1, metrics });

        expect(store.writeWord(key(0, 0), 0, 0, 0, word(1)).isOk()).toBe(true);
        expect(store.dirtyChunkCount).toBe(1);
        expect(store.dirtyBudgetExceeded).toBe(false);
        expect(store.writeWord(key(1, 0), 0, 0, 0, word(1)).isOk()).toBe(true);
        expect(store.dirtyChunkCount).toBe(2);
        expect(store.dirtyBudgetExceeded).toBe(true);

        expect(tracked.writeWord(key(0, 0), 0, 0, 0, word(1)).isOk()).toBe(true);
        expect(record.dirtied).toEqual([key(0, 0)]);
        expect(
            record.gauges.filter((gauge) => gauge.name === 'dirtyChunks')
        ).toEqual([{ name: 'dirtyChunks', value: 1 }]);
    });

    it('does not dirty a chunk when the word is unchanged', () => {
        const store = createStore();
        const chunk = key(0, 0);
        store.writeWord(chunk, 0, 0, 0, word(2));
        markClean(store, chunk);
        expect(store.hasDirtyChunk(chunk)).toBe(false);
        store.writeWord(chunk, 0, 0, 0, word(2));
        expect(store.hasDirtyChunk(chunk)).toBe(false);
        store.writeWord(chunk, 0, 0, 0, word(3));
        expect(store.hasDirtyChunk(chunk)).toBe(true);
    });

    it('evicts a clean LRU victim and keeps the touched chunk', () => {
        const store = createStore({ maxLoadedChunks: 2 });
        const a = key(0, 0);
        const b = key(1, 0);
        const c = key(2, 0);
        store.writeWord(a, 0, 0, 0, word(1));
        store.writeWord(b, 0, 0, 0, word(2));
        markClean(store, a);
        markClean(store, b);

        // Touch A so B becomes the least recently used chunk.
        store.readWordFast(a, 0, 0, 0);
        expect(store.writeWord(c, 0, 0, 0, word(3)).isOk()).toBe(true);

        expect(store.isResident(a)).toBe(true);
        expect(store.isResident(b)).toBe(false);
        expect(store.isResident(c)).toBe(true);
    });

    it('refuses to evict a pinned chunk', () => {
        const store = createStore({ maxLoadedChunks: 1 });
        const a = key(0, 0);
        const b = key(1, 0);
        store.writeWord(a, 0, 0, 0, word(1));
        markClean(store, a);

        const lease = store.acquireLease(a).get();
        expect(store.writeWord(b, 0, 0, 0, word(1)).isErr()).toBe(true);
        expect(store.evict(a, 'force').isErr()).toBe(true);
        expectError(store.evict(a, 'force'), 'CHUNK_PINNED');

        lease.release();
        expect(store.writeWord(b, 0, 0, 0, word(1)).isOk()).toBe(true);
        expect(store.isResident(a)).toBe(false);
        expect(store.isResident(b)).toBe(true);
    });

    it('reports dirty pressure instead of dropping dirty data', () => {
        const store = createStore({ maxLoadedChunks: 1 });
        const a = key(0, 0);
        store.writeWord(a, 0, 0, 0, word(1));

        const failed = store.writeWord(key(1, 0), 0, 0, 0, word(2));
        const error = expectError(failed, 'CHUNK_POOL_EXHAUSTED');
        expect(error.details).toMatchObject({ dirtyPressure: true });
        expect(store.isResident(a)).toBe(true);
        expect(store.dirtyChunkCount).toBe(1);
    });

    it('evicts a dirty chunk when the write-back hook succeeds', () => {
        const { record, metrics } = createMetrics();
        const flushes: ChunkSnapshot[] = [];
        const store = createStore({
            maxLoadedChunks: 1,
            metrics,
            onBeforeEvict: (chunkSnapshot) => {
                flushes.push(chunkSnapshot);
                return ok(undefined);
            },
        });
        const a = key(0, 0);
        store.writeWord(a, 0, 0, 0, word(1));
        expect(store.writeWord(key(1, 0), 0, 0, 0, word(2)).isOk()).toBe(
            true
        );
        expect(flushes).toHaveLength(1);
        expect(flushes[0]!.key).toBe(a);
        expect(record.evicted).toEqual([{ key: a, dirty: true }]);
    });

    it('keeps dirty data when the hook fails', () => {
        const { metrics } = createMetrics();
        const store = createStore({
            maxLoadedChunks: 1,
            metrics,
            onBeforeEvict: () => ({
                isOk: () => false,
                isErr: () => true,
                expectErr: () => ({
                    code: 'PAGER_IO_ERROR' as const,
                    message: 'offline',
                }),
            }) as never,
        });
        store.writeWord(key(0, 0), 0, 0, 0, word(1));
        expectError(
            store.writeWord(key(1, 0), 0, 0, 0, word(2)),
            'CHUNK_POOL_EXHAUSTED'
        );
    });

    it('rejects write-back eviction without a hook and allows force', () => {
        const store = createStore();
        const a = key(0, 0);
        store.writeWord(a, 0, 0, 0, word(1));

        expectError(store.evict(a, 'write-back'), 'CHUNK_DIRTY');
        expect(store.isResident(a)).toBe(true);
        expect(store.evict(a, 'force').get()).toBe(true);
        expect(store.isResident(a)).toBe(false);
    });

    it('imports validated snapshots and refuses dirty overwrite', () => {
        const store = createStore({ chunkShift: 3, layerCount: 2 });
        const a = key(0, 0);
        const words = new Array<number>(128).fill(0);
        words[5] = 11;

        expect(store.importSnapshot(snapshot(a, words)).isOk()).toBe(true);
        expect(store.readWordFast(a, 0, 5, 0)).toBe(11);
        expect(store.dirtyChunkCount).toBe(0);

        store.writeWord(a, 0, 0, 0, word(3));
        expectError(store.importSnapshot(snapshot(a, words)), 'CHUNK_DIRTY');
        expect(
            store.importSnapshot(snapshot(a, words), { force: true }).isOk()
        ).toBe(true);
        expect(store.readWordFast(a, 0, 0, 0)).toBe(0);
    });

    it('rejects snapshot geometry mismatches on import', () => {
        const store = createStore({ chunkShift: 3, layerCount: 2 });
        const a = key(0, 0);

        expectError(
            store.importSnapshot(snapshot(a, new Array(128).fill(0), 4, 2)),
            'INVALID_SNAPSHOT'
        );
        expectError(
            store.importSnapshot(snapshot(a, new Array(128).fill(0), 3, 1)),
            'INVALID_SNAPSHOT'
        );
        expectError(
            store.importSnapshot(snapshot(a, [1, 2, 3, 4], 3, 2)),
            'INVALID_SNAPSHOT'
        );
        expectError(
            store.importSnapshot(snapshot(a, new Array(128).fill(0), 3, 0)),
            'INVALID_SNAPSHOT'
        );
    });

    it('exports detached snapshots', () => {
        const store = createStore();
        const a = key(0, 0);
        store.writeWord(a, 1, 0, 0, word(9));

        const first = store.exportSnapshot(a).get();
        expect(first).not.toBeNull();
        first!.words[64] = 0;
        const second = store.exportSnapshot(a).get();
        expect(second!.words[64]).toBe(word(9));
        expect(store.exportSnapshot(key(9, 9)).get()).toBeNull();
    });

    it('fills and reads local rectangles', () => {
        const store = createStore();
        const a = key(0, 0);
        expect(store.fillWords(a, 0, 1, 1, 3, 2, word(4)).get()).toBe(6);
        expect(store.readWordFast(a, 0, 1, 1)).toBe(word(4));
        expect(store.readWordFast(a, 0, 3, 2)).toBe(word(4));
        expect(store.readWordFast(a, 0, 0, 0)).toBe(0);
        expect(store.fillWords(a, 0, 1, 1, 3, 2, word(4)).get()).toBe(0);

        const out = new Uint32Array(6);
        expect(store.readWords(a, 0, out, 1, 1, 3, 2).get()).toBe(6);
        expect(Array.from(out)).toEqual(new Array(6).fill(word(4)));

        expect(store.fillWords(a, 0, 7, 0, 2, 1, word(1)).isErr()).toBe(true);
        expect(store.fillWords(a, 0, 0, 0, 1, 1, word(1)).get()).toBe(1);
        expect(store.fillWords(a, 0, 0, 0, 1, 1, word(0)).get()).toBe(1);
        expect(store.fillWords(a, 0, 0, 0, 1, 1, word(0)).get()).toBe(0);
    });

    it('lists dirty chunks in LRU order', () => {
        const store = createStore();
        const a = key(0, 0);
        const b = key(1, 0);
        store.writeWord(a, 0, 0, 0, word(1));
        store.writeWord(b, 0, 0, 0, word(2));
        const dirtyKeys = store.listDirty().map((entry) => entry.key);
        expect(dirtyKeys).toEqual([a, b]);

        const entry = store.listDirty()[0]!;
        expect(store.dirtyGeneration(entry.key)).toBe(entry.generation);
        store.markClean(entry.key, entry.generation);
        expect(store.listDirty().map((item) => item.key)).toEqual([b]);
    });

    it('rejects writes and leases after dispose', () => {
        const store = createStore();
        const a = key(0, 0);
        store.writeWord(a, 0, 0, 0, word(1));
        const lease = store.acquireLease(a).get();
        store.dispose();
        expect(store.isClosed).toBe(true);
        expectError(store.writeWord(a, 0, 0, 0, word(2)), 'ENGINE_CLOSED');
        expectError(store.acquireLease(a), 'ENGINE_CLOSED');
        expect(() => lease.release()).not.toThrow();
    });

    it('rejects invalid layers and local coordinates as programming errors', () => {
        const store = createStore();
        const a = key(0, 0);
        expect(() => store.readWord(a, 2, 0, 0)).toThrow();
        expect(() => store.readWord(a, 0, 8, 0)).toThrow();
        expect(() => store.readWordFast(a, 0, -1, 0)).toThrow();
    });

    it('reports stats and gauges', () => {
        const { metrics, record } = createMetrics();
        const store = createStore({ maxLoadedChunks: 3, maxDirtyChunks: 1, metrics });
        store.writeWord(key(0, 0), 0, 0, 0, word(1));
        const stats = store.stats();
        expect(stats.residentChunks).toBe(1);
        expect(stats.dirtyChunks).toBe(1);
        expect(stats.maxLoadedChunks).toBe(3);
        expect(record.gauges).toContainEqual({
            name: 'residentChunks',
            value: 1,
        });
    });
});
