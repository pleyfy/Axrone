import { describe, expect, it } from 'vitest';
import { TileCodec } from '../codec/tile-codec';
import { TilemapBuilder } from '../engine/tilemap-builder';
import type { TilemapEngine } from '../engine/tilemap-engine';
import { TilemapFault } from '../errors';
import type { PackedTileWord } from '../types/brands';
import {
    createTileDefinitionTable,
    type TileDefinition,
} from '../types/tile-definition';
import {
    applyAutotileRect,
    BLOB47_CANONICAL_MASKS,
    canonicalizeBlobMask,
    computeBlob47Index,
    type AutotileGroup,
} from '../query/autotile';

const LAYERS = [{ name: 'ground' }] as const;

const createEngine = (): TilemapEngine<typeof LAYERS> =>
    TilemapBuilder.create()
        .withChunkShift(3)
        .withCapacity(16)
        .withLayers(LAYERS)
        .build()
        .get();

const tile = (id: number): PackedTileWord => TileCodec.pack(id);

const group = (): AutotileGroup => ({
    name: 'grass',
    tileId: 1,
    transforms: BLOB47_CANONICAL_MASKS.map((_, index) => index % 8),
});

describe('blob47 LUT', () => {
    it('maps every canonical mask to its own index', () => {
        expect(BLOB47_CANONICAL_MASKS).toHaveLength(47);
        BLOB47_CANONICAL_MASKS.forEach((mask, index) => {
            expect(computeBlob47Index(mask)).toBe(index);
        });
    });

    it('canonicalizes corner-only bits away', () => {
        expect(canonicalizeBlobMask(2)).toBe(0);
        expect(canonicalizeBlobMask(8)).toBe(0);
        expect(canonicalizeBlobMask(0x20)).toBe(0);
        expect(canonicalizeBlobMask(0x80)).toBe(0);
        expect(canonicalizeBlobMask(1 | 4 | 2)).toBe(7);
        expect(canonicalizeBlobMask(0xff)).toBe(0xff);
    });

    it('keeps every 8-bit mask inside the canonical range', () => {
        for (let mask = 0; mask < 256; mask++) {
            const index = computeBlob47Index(mask);
            expect(index).toBeGreaterThanOrEqual(0);
            expect(index).toBeLessThan(47);
            expect(BLOB47_CANONICAL_MASKS[index]).toBe(
                canonicalizeBlobMask(mask)
            );
        }
    });
});

describe('applyAutotileRect', () => {
    it('assigns blob transforms to a 3x3 block', () => {
        const engine = createEngine();
        for (let gridY = 10; gridY <= 12; gridY++) {
            for (let gridX = 10; gridX <= 12; gridX++) {
                engine.write('ground', gridX, gridY, tile(1));
            }
        }
        const changed = applyAutotileRect(
            engine,
            'ground',
            { x: 10, y: 10, width: 3, height: 3 },
            group()
        );
        expect(changed).toBe(9);
        expect(TileCodec.unpackTransform(engine.readAt('ground', 11, 11))).toBe(
            46 % 8
        );
        // Top-left corner sees E, SE and S only: mask 4 | 8 | 16 = 28.
        expect(TileCodec.unpackTransform(engine.readAt('ground', 10, 10))).toBe(
            10 % 8
        );
        // Top edge sees E, SE, S, SW and W: mask 124.
        expect(TileCodec.unpackTransform(engine.readAt('ground', 11, 10))).toBe(
            31 % 8
        );
        engine.dispose();
    });

    it('is idempotent and leaves other tiles alone', () => {
        const engine = createEngine();
        engine.write('ground', 10, 10, tile(1));
        engine.write('ground', 11, 10, tile(1));
        engine.write('ground', 12, 10, tile(2));
        const first = applyAutotileRect(
            engine,
            'ground',
            { x: 10, y: 10, width: 3, height: 1 },
            group()
        );
        expect(first).toBe(2);
        expect(engine.readAt('ground', 12, 10)).toBe(tile(2));
        const second = applyAutotileRect(
            engine,
            'ground',
            { x: 10, y: 10, width: 3, height: 1 },
            group()
        );
        expect(second).toBe(0);
        engine.dispose();
    });

    it('supports a custom membership predicate', () => {
        const engine = createEngine();
        engine.write('ground', 10, 10, tile(1));
        engine.write('ground', 11, 10, tile(2));
        const changed = applyAutotileRect(
            engine,
            'ground',
            { x: 10, y: 10, width: 2, height: 1 },
            {
                name: 'all',
                transforms: BLOB47_CANONICAL_MASKS.map((_, index) => index % 8),
                matches: (word) => word !== 0,
            }
        );
        expect(changed).toBe(2);
        engine.dispose();
    });

    it('rejects a group without 47 transforms', () => {
        const engine = createEngine();
        expect(() =>
            applyAutotileRect(
                engine,
                'ground',
                { x: 0, y: 0, width: 1, height: 1 },
                { name: 'bad', tileId: 1, transforms: [0, 1] }
            )
        ).toThrow(TilemapFault);
        engine.dispose();
    });
});

describe('tile definition table', () => {
    const definitions: readonly TileDefinition[] = [
        { id: 1, name: 'grass', collision: 0, material: 1 },
        {
            id: 7,
            name: 'torch',
            animation: [
                { tileId: 7, durationMs: 100 },
                { tileId: 8, durationMs: 150 },
            ],
            autotileGroup: 'torch',
        },
    ];

    it('looks up definitions and validates duplicates', () => {
        const table = createTileDefinitionTable(definitions);
        expect(table.size).toBe(2);
        expect(table.get(1)?.name).toBe('grass');
        expect(table.get(7)?.autotileGroup).toBe('torch');
        expect(table.get(99)).toBeUndefined();
        expect(() =>
            createTileDefinitionTable([definitions[0]!, definitions[0]!])
        ).toThrow(TilemapFault);
    });

    it('validates frame durations and ranges', () => {
        expect(() =>
            createTileDefinitionTable([
                { id: 1, name: 'bad', collision: 256 },
            ])
        ).toThrow(TilemapFault);
        expect(() =>
            createTileDefinitionTable([
                {
                    id: 1,
                    name: 'bad',
                    animation: [{ tileId: 1, durationMs: 0 }],
                },
            ])
        ).toThrow(TilemapFault);
    });

    it('selects animation frames at the boundaries', () => {
        const table = createTileDefinitionTable(definitions);
        expect(table.frameAt(1, 0)).toBeNull();
        expect(table.frameAt(7, 0)?.tileId).toBe(7);
        expect(table.frameAt(7, 99.999)?.tileId).toBe(7);
        expect(table.frameAt(7, 100)?.tileId).toBe(8);
        expect(table.frameAt(7, 249.999)?.tileId).toBe(8);
        expect(table.frameAt(7, 250)?.tileId).toBe(7);
        expect(table.frameAt(7, -1)?.tileId).toBe(8);
    });
});
