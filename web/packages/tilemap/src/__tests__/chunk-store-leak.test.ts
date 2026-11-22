import { describe, expect, it } from 'vitest';
import { packChunkKey } from '../codec/spatial-codec';
import { TileCodec } from '../codec/tile-codec';
import { ChunkStore } from '../grid/chunk-store';
import { asChunkKey, type ChunkKey } from '../types/brands';

const key = (chunkX: number, chunkY: number): ChunkKey =>
    asChunkKey(packChunkKey(chunkX, chunkY));

const createStore = (maxLoadedChunks = 8): ChunkStore =>
    new ChunkStore({
        chunkShift: 4,
        layerCount: 1,
        maxLoadedChunks,
        maxDirtyChunks: 4,
        defaultWords: new Uint32Array([0]),
    });

describe('ChunkStore lease lifecycle', () => {
    it('balances pin counts across 100k acquire/release cycles', () => {
        const store = createStore(8);
        for (let iteration = 0; iteration < 100_000; iteration++) {
            const chunk = key(iteration % 512, 0);
            const lease = store.acquireLease(chunk).get();
            expect(lease.isReleased).toBe(false);
            lease.release();
            expect(lease.isReleased).toBe(true);
        }
        const stats = store.stats();
        expect(stats.pinnedChunks).toBe(0);
        expect(store.pinnedChunkCount).toBe(0);
        expect(stats.residentChunks).toBeLessThanOrEqual(8);
        expect(store.isResident(key(99_999 % 512, 0))).toBe(true);
    });

    it('keeps one slot for one key no matter how often it is leased', () => {
        const store = createStore(4);
        const chunk = key(3, 3);
        for (let iteration = 0; iteration < 10_000; iteration++) {
            store.acquireLease(chunk).get().release();
        }
        expect(store.residentChunkCount).toBe(1);
        expect(store.pinnedChunkCount).toBe(0);
    });

    it('supports nested leases on the same chunk', () => {
        const store = createStore(2);
        const chunk = key(0, 0);
        const outer = store.acquireLease(chunk).get();
        const inner = store.acquireLease(chunk).get();
        expect(store.pinnedChunkCount).toBe(1);
        expect(store.stats().pinnedChunks).toBe(1);

        inner.release();
        expect(store.pinnedChunkCount).toBe(1);
        expect(store.evict(chunk, 'force').isErr()).toBe(true);

        outer.release();
        expect(store.pinnedChunkCount).toBe(0);
        expect(store.evict(chunk, 'force').isOk()).toBe(true);
    });

    it('makes release idempotent', () => {
        const store = createStore(2);
        const chunk = key(0, 0);
        const lease = store.acquireLease(chunk).get();
        lease.release();
        expect(() => lease.release()).not.toThrow();
        expect(store.pinnedChunkCount).toBe(0);
    });

    it('ignores stale releases after the slot is reused', () => {
        const store = createStore(1);
        const a = key(0, 0);
        const b = key(1, 0);

        const oldLease = store.acquireLease(a).get();
        oldLease.release();
        expect(store.evict(a, 'force').get()).toBe(true);

        // Reusing the slab slot for B advances the generation; the old lease
        // must not unpin B even if it were released again.
        store.writeWord(b, 0, 0, 0, TileCodec.pack(7));
        const current = store.acquireLease(b).get();
        oldLease.release();
        expect(store.pinnedChunkCount).toBe(1);
        expect(store.evict(b, 'force').isErr()).toBe(true);
        current.release();
        expect(store.pinnedChunkCount).toBe(0);
    });

    it('releases every pin on dispose without throwing', () => {
        const store = createStore(4);
        const leases = [0, 1, 2, 3].map((x) =>
            store.acquireLease(key(x, 0)).get()
        );
        expect(store.pinnedChunkCount).toBe(4);
        store.dispose();
        expect(store.pinnedChunkCount).toBe(0);
        for (const lease of leases) {
            expect(() => lease.release()).not.toThrow();
        }
    });
});
