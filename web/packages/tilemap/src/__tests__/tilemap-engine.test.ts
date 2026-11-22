import { describe, expect, it } from 'vitest';
import { ok, type Result } from '@axrone/utility';
import { packChunkKey } from '../codec/spatial-codec';
import { TileCodec } from '../codec/tile-codec';
import { TilemapErrorCode, TilemapFault } from '../errors';
import type { TilemapError } from '../errors';
import {
    MemoryChunkPager,
    type IChunkPager,
} from '../grid/chunk-pager';
import { TilemapBuilder } from '../engine/tilemap-builder';
import type { TilemapEngine } from '../engine/tilemap-engine';
import {
    asChunkKey,
    type ChunkKey,
    type PackedTileWord,
} from '../types/brands';
import type { ChunkSnapshot } from '../types/chunk';

const LAYERS = [
    { name: 'ground' },
    { name: 'walls', collision: true },
] as const;

const word = (tileId: number): PackedTileWord => TileCodec.pack(tileId);

const chunkKey = (chunkX: number, chunkY: number): ChunkKey =>
    asChunkKey(packChunkKey(chunkX, chunkY));

const makeSnapshot = (
    chunkX: number,
    chunkY: number,
    chunkShift: 3 | 4 | 5 | 6 = 3,
    layerCount = 2
): ChunkSnapshot => {
    const words = new Uint32Array((1 << (chunkShift * 2)) * layerCount);
    return {
        key: chunkKey(chunkX, chunkY),
        chunkShift,
        layerCount,
        words,
    };
};

const createEngine = (
    options: {
        maxLoadedChunks?: number;
        maxDirtyChunks?: number;
        pager?: IChunkPager;
    } = {}
): TilemapEngine<typeof LAYERS> => {
    const builder = TilemapBuilder.create()
        .withProjection({ kind: 'orthogonal', tileWidth: 16, tileHeight: 16 })
        .withChunkShift(3)
        .withCapacity(options.maxLoadedChunks ?? 16)
        .withDirtyBudget(options.maxDirtyChunks ?? 8);
    const withPager =
        options.pager === undefined ? builder : builder.withPager(options.pager);
    return withPager.withLayers(LAYERS).build().get();
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

describe('TilemapBuilder', () => {
    it('rejects build() before withLayers()', () => {
        // @ts-expect-error build() is only typed after withLayers() sets the typestate.
        const result = TilemapBuilder.create().build();
        expectError(result, 'INVALID_CONFIGURATION');
    });

    it('rejects duplicate layer names at compile time and at runtime', () => {
        expect(() =>
            // @ts-expect-error duplicate layer names collapse the parameter type to never.
            TilemapBuilder.create().withLayers([
                { name: 'ground' },
                { name: 'ground' },
            ])
        ).toThrow(TilemapFault);
    });

    it('validates builder configuration', () => {
        expect(() =>
            TilemapBuilder.create().withChunkShift(7 as never)
        ).toThrow(TilemapFault);
        expect(() => TilemapBuilder.create().withCapacity(0)).toThrow(
            TilemapFault
        );
        expect(() => TilemapBuilder.create().withDirtyBudget(-1)).toThrow(
            TilemapFault
        );
    });

    it('builds an engine with defaults', () => {
        const engine = createEngine();
        expect(engine.chunkShift).toBe(3);
        expect(engine.chunkSize).toBe(8);
        expect(engine.layerCount).toBe(2);
        expect(engine.hasPager).toBe(false);
        expect(engine.projection.kind).toBe('orthogonal');
        engine.dispose();
    });
});

describe('TilemapEngine data access', () => {
    it('writes, reads and reports residency per layer', () => {
        const engine = createEngine();
        expect(engine.read('ground', 0, 0).residency).toBe('unloaded');

        engine.write('ground', 3, 4, word(5));
        expect(engine.read('ground', 3, 4)).toEqual({
            word: word(5),
            residency: 'resident',
        });
        expect(engine.read('ground', 0, 0).residency).toBe('default');
        expect(engine.read('walls', 3, 4).residency).toBe('default');
        expect(engine.getTile('ground', 3, 4)).toBe(word(5));
        expect(engine.isChunkResidentAt(0, 0)).toBe(true);
        expect(engine.isChunkResidentAt(64, 0)).toBe(false);
        engine.dispose();
    });

    it('reads unloaded chunks as the layer default without allocating', () => {
        const engine = createEngine({ maxLoadedChunks: 1 });
        expect(engine.readAt('walls', 100, 100)).toBe(0);
        expect(engine.isChunkResidentAt(100, 100)).toBe(false);
        expect(engine.stats().residentChunks).toBe(0);
        engine.dispose();
    });

    it('does not allocate when writing the default word', () => {
        const engine = createEngine();
        expect(engine.write('ground', 0, 0, word(0)).isOk()).toBe(true);
        expect(engine.isChunkResidentAt(0, 0)).toBe(false);
        engine.dispose();
    });

    it('fills rectangles across chunk boundaries', () => {
        const engine = createEngine();
        const changed = engine.fillRect('ground', 6, 6, 4, 4, word(2));
        expect(changed.get()).toBe(16);
        expect(engine.getTile('ground', 6, 6)).toBe(word(2));
        expect(engine.getTile('ground', 9, 9)).toBe(word(2));
        expect(engine.getTile('ground', 5, 5)).toBe(0);
        expect(engine.isChunkResidentAt(0, 0)).toBe(true);
        expect(engine.isChunkResidentAt(8, 8)).toBe(true);
        expect(engine.fillRect('ground', 0, 0, 0, 4, word(1)).get()).toBe(0);
        engine.dispose();
    });

    it('rejects out-of-range coordinates and invalid words', () => {
        const engine = createEngine();
        expectError(
            engine.write('ground', -32769, 0, word(1)),
            'INVALID_COORDINATE'
        );
        expectError(
            engine.write('ground', 0, 32768, word(1)),
            'INVALID_COORDINATE'
        );
        expectError(
            engine.write('ground', 0, 0, 0x80000000 as never),
            'INVALID_CONFIGURATION'
        );
        expectError(
            engine.fillRect('ground', 32767, 0, 2, 1, word(1)),
            'INVALID_COORDINATE'
        );
        expectError(
            engine.fillRect('ground', 0, 0, -1, 1, word(1)),
            'INVALID_COORDINATE'
        );
        engine.dispose();
    });

    it('resolves layers by name and index', () => {
        const engine = createEngine();
        expect(engine.resolveLayer('walls').get()).toBe(1);
        expect(engine.resolveLayer(0).get()).toBe(0);
        expectError(engine.resolveLayer('sky'), 'INVALID_LAYER');
        expectError(engine.resolveLayer(2), 'INVALID_LAYER');
        expect(() => engine.read('sky' as never, 0, 0)).toThrow(TilemapFault);
        engine.dispose();
    });

    it('builds chunk keys with bounds checking', () => {
        const engine = createEngine();
        expect(engine.chunkKeyFor(1, -2).get()).toBe(chunkKey(1, -2));
        expectError(engine.chunkKeyFor(-40000, 0), 'INVALID_COORDINATE');
        engine.dispose();
    });
});

describe('TilemapEngine paging', () => {
    it('loads a snapshot from the pager once', async () => {
        const pager = new MemoryChunkPager();
        const snapshot = makeSnapshot(0, 0);
        snapshot.words[3] = word(9);
        await pager.save(snapshot);
        const engine = createEngine({ pager });

        const loaded = await engine.loadChunk(0, 0);
        expect(loaded.get()).toBe(true);
        expect(engine.getTile('ground', 3, 0)).toBe(word(9));
        expect(engine.read('ground', 3, 0).residency).toBe('resident');

        const again = await engine.loadChunk(0, 0);
        expect(again.get()).toBe(false);
        engine.dispose();
    });

    it('returns false when the pager has no chunk', async () => {
        const pager = new MemoryChunkPager();
        const engine = createEngine({ pager });
        expect((await engine.loadChunk(0, 0)).get()).toBe(false);
        expect(engine.isChunkResidentAt(0, 0)).toBe(false);
        engine.dispose();
    });

    it('keeps resident dirty data when a reload is requested', async () => {
        const pager = new MemoryChunkPager();
        const engine = createEngine({ pager });
        engine.write('ground', 0, 0, word(3));

        const reloaded = await engine.loadChunk(0, 0);
        expect(reloaded.get()).toBe(false);
        expect(engine.getTile('ground', 0, 0)).toBe(word(3));
        engine.dispose();
    });

    it('rejects a snapshot for a different chunk', async () => {
        const pager: IChunkPager = {
            async load() {
                return ok(makeSnapshot(1, 0));
            },
            async save() {
                return ok(undefined);
            },
        };
        const engine = createEngine({ pager });

        expectError(await engine.loadChunk(0, 0), 'INVALID_SNAPSHOT');
        expect(engine.isChunkResidentAt(0, 0)).toBe(false);
        engine.dispose();
    });

    it('rejects a snapshot with the wrong geometry', async () => {
        const pager = new MemoryChunkPager();
        const snapshot = makeSnapshot(0, 0, 4);
        await pager.save(snapshot);
        const engine = createEngine({ pager });

        expectError(await engine.loadChunk(0, 0), 'INVALID_SNAPSHOT');
        engine.dispose();
    });

    it('maps a throwing pager to PAGER_IO_ERROR', async () => {
        const failing: IChunkPager = {
            async load() {
                throw new Error('offline');
            },
            async save() {
                throw new Error('offline');
            },
        };
        const engine = createEngine({ pager: failing });
        const error = expectError(
            await engine.loadChunk(0, 0),
            'PAGER_IO_ERROR'
        );
        expect(error.cause).toBeInstanceOf(Error);
        expect(engine.isChunkResidentAt(0, 0)).toBe(false);
        engine.dispose();
    });

    it('aborts a load before touching the pager', async () => {
        const pager = new MemoryChunkPager();
        const controller = new AbortController();
        controller.abort();
        const engine = createEngine({ pager });

        expectError(
            await engine.loadChunk(0, 0, controller.signal),
            'OPERATION_ABORTED'
        );
        expect(engine.isChunkResidentAt(0, 0)).toBe(false);
        expect(engine.stats().pinnedChunks).toBe(0);
        expect(engine.pendingOperations).toBe(0);
        engine.dispose();
    });

    it('reports which dirty chunks were flushed', async () => {
        const pager = new MemoryChunkPager();
        const engine = createEngine({ pager });
        engine.write('ground', 0, 0, word(1));
        engine.write('ground', 8, 0, word(2));
        expect(pager.size).toBe(0);

        const flushed = await engine.flushDirty();
        expect(flushed.get()).toBe(2);
        expect(pager.size).toBe(2);
        expect(await engine.flushDirty().then((r) => r.get())).toBe(0);
        expect(engine.stats().dirtyChunks).toBe(0);
        engine.dispose();
    });

    it('flushes a single chunk', async () => {
        const pager = new MemoryChunkPager();
        const engine = createEngine({ pager });
        engine.write('ground', 0, 0, word(1));
        engine.write('ground', 8, 0, word(2));

        expect((await engine.flushChunk(0, 0)).get()).toBe(true);
        expect((await engine.flushChunk(0, 0)).get()).toBe(false);
        expect(pager.has(chunkKey(0, 0))).toBe(true);
        expect(pager.has(chunkKey(1, 0))).toBe(false);
        engine.dispose();
    });

    it('rejects paging calls without a pager', async () => {
        const engine = createEngine();
        expectError(await engine.loadChunk(0, 0), 'PAGER_NOT_CONFIGURED');
        expectError(await engine.flushDirty(), 'PAGER_NOT_CONFIGURED');
        expectError(await engine.flushChunk(0, 0), 'PAGER_NOT_CONFIGURED');
        engine.dispose();
    });

    it('maps a failing save to PAGER_IO_ERROR and keeps data dirty', async () => {
        const source = new MemoryChunkPager();
        const failing: IChunkPager = {
            load: (key, signal) => source.load(key, signal),
            async save() {
                throw new Error('disk full');
            },
        };
        const engine = createEngine({ pager: failing });
        engine.write('ground', 0, 0, word(1));

        expectError(await engine.flushDirty(), 'PAGER_IO_ERROR');
        expect(engine.stats().dirtyChunks).toBe(1);
        engine.dispose();
    });
});

describe('TilemapEngine write-back under pressure', () => {
    it('asks the caller to flush before a new chunk can be written', async () => {
        const pager = new MemoryChunkPager();
        const engine = createEngine({
            pager,
            maxLoadedChunks: 1,
            maxDirtyChunks: 4,
        });
        expect(engine.write('ground', 0, 0, word(1)).isOk()).toBe(true);

        const blocked = engine.write('ground', 16, 0, word(2));
        const error = expectError(blocked, 'CHUNK_POOL_EXHAUSTED');
        expect(error.details).toMatchObject({ dirtyPressure: true });

        const flushed = await engine.flushDirty();
        expect(flushed.get()).toBe(1);

        expect(engine.write('ground', 16, 0, word(2)).isOk()).toBe(true);
        expect(engine.getTile('ground', 0, 0)).toBe(0);
        expect(engine.getTile('ground', 16, 0)).toBe(word(2));
        expect(pager.has(chunkKey(0, 0))).toBe(true);
        engine.dispose();
    });

    it('unloads with write-back and drops with force', async () => {
        const pager = new MemoryChunkPager();
        const engine = createEngine({ pager, maxLoadedChunks: 2 });
        engine.write('ground', 0, 0, word(1));
        engine.write('ground', 8, 0, word(2));

        expect((await engine.unloadChunk(0, 0)).get()).toBe(true);
        expect(pager.has(chunkKey(0, 0))).toBe(true);
        expect(engine.isChunkResidentAt(0, 0)).toBe(false);

        expect(
            (await engine.unloadChunk(1, 0, 'force')).get()
        ).toBe(true);
        expect(pager.has(chunkKey(1, 0))).toBe(false);
        expect((await engine.unloadChunk(9, 9)).get()).toBe(false);
        engine.dispose();
    });
});

describe('TilemapEngine lifecycle', () => {
    it('rejects foreground work after close but still flushes', async () => {
        const pager = new MemoryChunkPager();
        const engine = createEngine({ pager });
        engine.write('ground', 0, 0, word(1));
        engine.close();

        expectError(engine.write('ground', 0, 0, word(2)), 'ENGINE_CLOSED');
        expectError(await engine.loadChunk(0, 0), 'ENGINE_CLOSED');
        expect((await engine.flushDirty()).get()).toBe(1);
        await engine.drain();
        expect(engine.pendingOperations).toBe(0);
        engine.dispose();
    });

    it('rejects write-back after dispose', async () => {
        const pager = new MemoryChunkPager();
        const engine = createEngine({ pager });
        engine.write('ground', 0, 0, word(1));
        engine.dispose();

        expect(engine.isClosed).toBe(true);
        expect(engine.isDisposed).toBe(true);
        expectError(await engine.flushDirty(), 'ENGINE_CLOSED');
        expectError(await engine.unloadChunk(0, 0), 'ENGINE_CLOSED');
        expectError(engine.write('ground', 0, 0, word(2)), 'ENGINE_CLOSED');
        expect(pager.size).toBe(0);
    });

    it('drains an in-flight load before resolving', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const pager: IChunkPager = {
            async load() {
                await gate;
                return ok(makeSnapshot(0, 0));
            },
            async save() {
                return ok(undefined);
            },
        };
        const engine = createEngine({ pager });
        const loading = engine.loadChunk(0, 0);
        expect(engine.pendingOperations).toBe(1);

        let drained = false;
        const draining = engine.drain().then(() => {
            drained = true;
        });
        await Promise.resolve();
        expect(drained).toBe(false);

        release();
        await loading;
        await draining;
        expect(drained).toBe(true);
        expect(engine.pendingOperations).toBe(0);
        engine.dispose();
    });

    it('exposes store stats', () => {
        const engine = createEngine({ maxLoadedChunks: 5, maxDirtyChunks: 2 });
        engine.write('ground', 0, 0, word(1));
        const stats = engine.stats();
        expect(stats).toMatchObject({
            residentChunks: 1,
            dirtyChunks: 1,
            pinnedChunks: 0,
            maxLoadedChunks: 5,
            maxDirtyChunks: 2,
            chunkShift: 3,
            layerCount: 2,
            pendingOperations: 0,
            hasPager: false,
        });
        engine.dispose();
    });

    it('keeps the error codes used by the lifecycle', () => {
        expect(TilemapErrorCode.ENGINE_CLOSED).toBe('ENGINE_CLOSED');
        expect(TilemapErrorCode.OPERATION_ABORTED).toBe('OPERATION_ABORTED');
    });
});
    it('exports and reapplies detached chunk snapshots', () => {
        const engine = createEngine();
        engine.write('ground', 3, 4, word(9));
        engine.write('walls', 3, 4, word(10));
        const snapshot = engine.exportSnapshot(0, 0).get();
        expect(snapshot).not.toBeNull();
        expect(engine.exportDirtySnapshots().get()).toHaveLength(1);

        const restored = createEngine();
        expect(restored.importSnapshot(snapshot!).isOk()).toBe(true);
        expect(restored.getTile('ground', 3, 4)).toBe(word(9));
        expect(restored.getTile('walls', 3, 4)).toBe(word(10));
        expect(restored.exportDirtySnapshots().get()).toHaveLength(0);
        engine.dispose();
        restored.dispose();
    });

    it('rejects snapshots with the wrong geometry on import', () => {
        const engine = createEngine();
        expect(
            engine.importSnapshot(makeSnapshot(0, 0, 4)).isErr()
        ).toBe(true);
        engine.dispose();
    });
