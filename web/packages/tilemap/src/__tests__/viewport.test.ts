import { describe, expect, it } from 'vitest';
import { TileCodec } from '../codec/tile-codec';
import { TilemapBuilder } from '../engine/tilemap-builder';
import type { TilemapEngine } from '../engine/tilemap-engine';
import type { ProjectionSpec } from '../types/projection';
import type { PackedTileWord } from '../types/brands';
import {
    clampGridRect,
    extractViewportInstances,
    viewportGridBounds,
    ViewportTileBuffer,
    visitViewportTiles,
    type GridRect,
} from '../query/viewport';

const LAYERS = [{ name: 'ground' }, { name: 'walls' }] as const;

const word = (tileId: number): PackedTileWord => TileCodec.pack(tileId);

const createEngine = (): TilemapEngine<typeof LAYERS> =>
    TilemapBuilder.create()
        .withProjection({ kind: 'orthogonal', tileWidth: 64, tileHeight: 32 })
        .withChunkShift(3)
        .withCapacity(16)
        .withLayers(LAYERS)
        .build()
        .get();

const brutalCount = (
    engine: TilemapEngine<typeof LAYERS>,
    rect: GridRect
): number => {
    const bounds = clampGridRect(rect);
    let count = 0;
    for (let gridY = bounds.y; gridY < bounds.y + bounds.height; gridY++) {
        for (let gridX = bounds.x; gridX < bounds.x + bounds.width; gridX++) {
            if (engine.readAt('ground', gridX, gridY) !== 0) count++;
        }
    }
    return count;
};

describe('clampGridRect', () => {
    it('clamps to the signed 16-bit grid and drops empty rectangles', () => {
        expect(clampGridRect({ x: -40000, y: 0, width: 10, height: 4 })).toEqual(
            { x: 0, y: 0, width: 0, height: 0 }
        );
        expect(
            clampGridRect({ x: 32760, y: 32760, width: 100, height: 100 })
        ).toEqual({ x: 32760, y: 32760, width: 8, height: 8 });
        expect(clampGridRect({ x: 0, y: 0, width: 0, height: 5 })).toEqual({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
        });
    });
});

describe('viewportGridBounds', () => {
    it('returns exact bounds for orthogonal cameras', () => {
        const projection: ProjectionSpec = {
            kind: 'orthogonal',
            tileWidth: 64,
            tileHeight: 32,
        };
        expect(
            viewportGridBounds(projection, { x: 0, y: 0, width: 64, height: 64 })
        ).toEqual({ x: 0, y: 0, width: 2, height: 3 });
        expect(
            viewportGridBounds(projection, {
                x: -64,
                y: -32,
                width: 128,
                height: 64,
            })
        ).toEqual({ x: -1, y: -1, width: 3, height: 3 });
    });

    it('bounds the diamond of an isometric camera', () => {
        const projection: ProjectionSpec = {
            kind: 'isometric',
            tileWidth: 64,
            tileHeight: 32,
        };
        expect(
            viewportGridBounds(projection, { x: -32, y: 0, width: 64, height: 32 })
        ).toEqual({ x: -1, y: -1, width: 3, height: 3 });
    });

    it('adds a one-tile margin for staggered cameras', () => {
        const projection: ProjectionSpec = {
            kind: 'staggered-isometric',
            tileWidth: 64,
            tileHeight: 32,
            staggerAxis: 'y',
            staggerIndex: 'odd',
        };
        expect(
            viewportGridBounds(projection, { x: 0, y: 0, width: 64, height: 32 })
        ).toEqual({ x: -1, y: -1, width: 4, height: 5 });
    });
});

describe('extractViewportInstances', () => {
    it('extracts non-empty tiles in row-major order', () => {
        const engine = createEngine();
        for (let gridY = 6; gridY <= 9; gridY++) {
            for (let gridX = 6; gridX <= 9; gridX++) {
                if (
                    (gridX === 7 && gridY === 7) ||
                    (gridX === 9 && gridY === 8)
                ) {
                    continue;
                }
                engine.write('ground', gridX, gridY, word(gridX * 10 + gridY));
            }
        }

        const buffer = extractViewportInstances(engine, 'ground', {
            x: 6,
            y: 6,
            width: 4,
            height: 4,
        });

        expect(buffer.count).toBe(14);
        let index = 0;
        for (let gridY = 6; gridY <= 9; gridY++) {
            for (let gridX = 6; gridX <= 9; gridX++) {
                if (
                    (gridX === 7 && gridY === 7) ||
                    (gridX === 9 && gridY === 8)
                ) {
                    continue;
                }
                expect(buffer.gridXs[index]).toBe(gridX);
                expect(buffer.gridYs[index]).toBe(gridY);
                expect(buffer.words[index]).toBe(word(gridX * 10 + gridY));
                index++;
            }
        }
        engine.dispose();
    });

    it('matches a brute-force scan across chunk boundaries', () => {
        const engine = createEngine();
        for (let gridY = 6; gridY <= 9; gridY++) {
            for (let gridX = 6; gridX <= 9; gridX++) {
                engine.write('ground', gridX, gridY, word(1));
            }
        }
        engine.write('ground', 6, 6, word(0));

        const rect = { x: 6, y: 6, width: 4, height: 4 };
        const buffer = extractViewportInstances(engine, 'ground', rect);
        expect(buffer.count).toBe(brutalCount(engine, rect));
        expect(buffer.count).toBe(15);
        expect(engine.isChunkResidentAt(8, 8)).toBe(true);
        engine.dispose();
    });

    it('handles rectangles fully inside one chunk and empty tiles', () => {
        const engine = createEngine();
        engine.write('ground', 1, 2, word(4));
        engine.write('ground', 3, 2, word(5));
        engine.write('ground', 2, 4, word(6));

        const buffer = extractViewportInstances(engine, 'ground', {
            x: 1,
            y: 2,
            width: 3,
            height: 2,
        });
        expect(buffer.count).toBe(2);
        expect([buffer.gridXs[0], buffer.gridYs[0]]).toEqual([1, 2]);
        expect(buffer.words[0]).toBe(word(4));
        expect([buffer.gridXs[1], buffer.gridYs[1]]).toEqual([3, 2]);
        expect(buffer.words[1]).toBe(word(5));
        engine.dispose();
    });

    it('handles negative coordinates and other layers', () => {
        const engine = createEngine();
        engine.write('ground', -10, -5, word(1));
        engine.write('ground', -1, -1, word(2));
        engine.write('walls', 9, 4, word(3));

        const rect = { x: -10, y: -5, width: 20, height: 10 };
        const ground = extractViewportInstances(engine, 'ground', rect);
        expect(ground.count).toBe(2);
        expect([ground.gridXs[0], ground.gridYs[0]]).toEqual([-10, -5]);
        expect([ground.gridXs[1], ground.gridYs[1]]).toEqual([-1, -1]);

        const walls = extractViewportInstances(engine, 'walls', rect);
        expect(walls.count).toBe(1);
        expect([walls.gridXs[0], walls.gridYs[0]]).toEqual([9, 4]);
        engine.dispose();
    });

    it('clamps rectangles to the addressable grid', () => {
        const engine = createEngine();
        engine.write('ground', 32767, 32767, word(7));

        const buffer = extractViewportInstances(engine, 'ground', {
            x: 32760,
            y: 32760,
            width: 100,
            height: 100,
        });
        expect(buffer.count).toBe(1);
        expect([buffer.gridXs[0], buffer.gridYs[0]]).toEqual([32767, 32767]);

        const outside = extractViewportInstances(engine, 'ground', {
            x: -40000,
            y: -40000,
            width: 100,
            height: 100,
        });
        expect(outside.count).toBe(0);
        engine.dispose();
    });

    it('reuses a buffer and resets its count', () => {
        const engine = createEngine();
        engine.write('ground', 0, 0, word(1));
        engine.write('ground', 1, 0, word(2));

        const buffer = new ViewportTileBuffer();
        const first = extractViewportInstances(
            engine,
            'ground',
            { x: 0, y: 0, width: 8, height: 8 },
            buffer
        );
        const second = extractViewportInstances(
            engine,
            'ground',
            { x: 0, y: 0, width: 1, height: 1 },
            buffer
        );
        expect(first).toBe(buffer);
        expect(first.count).toBe(1);
        expect(second.count).toBe(1);
        expect(second.words[0]).toBe(word(1));
        engine.dispose();
    });

    it('visits tiles through the streaming API', () => {
        const engine = createEngine();
        engine.write('ground', 2, 3, word(8));
        const visited: number[] = [];
        const count = visitViewportTiles(
            engine,
            'ground',
            { x: 0, y: 0, width: 4, height: 4 },
            (gridX, gridY, tileWord) => {
                visited.push(gridX, gridY, tileWord as unknown as number);
            }
        );
        expect(count).toBe(1);
        expect(visited).toEqual([2, 3, word(8)]);
        engine.dispose();
    });
});
