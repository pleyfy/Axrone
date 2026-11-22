import { describe, expect, it } from 'vitest';
import { TileCodec } from '../codec/tile-codec';
import { TilemapBuilder } from '../engine/tilemap-builder';
import type { TilemapEngine } from '../engine/tilemap-engine';
import type { PackedTileWord } from '../types/brands';
import {
    createTileChangeSubject,
    TileChangeWriter,
    type TileChangeBatch,
} from '../observable/tile-events';

const LAYERS = [{ name: 'ground' }] as const;

const word = (tileId: number): PackedTileWord => TileCodec.pack(tileId);

const createEngine = (): TilemapEngine<typeof LAYERS> =>
    TilemapBuilder.create()
        .withChunkShift(3)
        .withCapacity(16)
        .withLayers(LAYERS)
        .build()
        .get();

describe('tile change subject', () => {
    it('batches one event per write and skips no-op writes', () => {
        const engine = createEngine();
        const changes = createTileChangeSubject();
        const writer = new TileChangeWriter(engine, changes);
        const batches: TileChangeBatch[] = [];
        const unsubscribe = changes.subscribe((batch) => batches.push(batch));

        expect(changes.subscriberCount).toBe(1);
        writer.write('ground', 1, 2, word(3)).get();
        writer.write('ground', 1, 2, word(3)).get();
        writer.write('ground', 2, 2, word(4)).get();

        expect(batches).toHaveLength(2);
        expect(batches[0]).toMatchObject({
            layer: 'ground',
            operation: 'write',
            gridX: 1,
            gridY: 2,
            width: 1,
            height: 1,
            changed: 1,
            word: word(3),
        });
        expect(batches[1]!.gridX).toBe(2);

        unsubscribe();
        expect(changes.subscriberCount).toBe(0);
        writer.write('ground', 3, 2, word(5)).get();
        expect(batches).toHaveLength(2);
        changes.dispose();
        engine.dispose();
    });

    it('batches a fillRect into a single event', () => {
        const engine = createEngine();
        const changes = createTileChangeSubject();
        const writer = new TileChangeWriter(engine, changes);
        const batches: TileChangeBatch[] = [];
        changes.subscribe((batch) => batches.push(batch));

        writer.fillRect('ground', 0, 0, 4, 4, word(1)).get();
        expect(batches).toHaveLength(1);
        expect(batches[0]).toMatchObject({
            operation: 'fill',
            width: 4,
            height: 4,
            changed: 16,
            word: word(1),
        });

        writer.fillRect('ground', 0, 0, 4, 4, word(1)).get();
        expect(batches).toHaveLength(1);
        changes.dispose();
        engine.dispose();
    });

    it('ignores events after dispose', () => {
        const engine = createEngine();
        const changes = createTileChangeSubject();
        const writer = new TileChangeWriter(engine, changes);
        const batches: TileChangeBatch[] = [];
        changes.subscribe((batch) => batches.push(batch));
        changes.dispose();
        expect(() => writer.write('ground', 0, 0, word(1)).get()).not.toThrow();
        expect(batches).toHaveLength(0);
        engine.dispose();
    });
});
