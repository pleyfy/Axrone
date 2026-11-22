import { describe, expect, it } from 'vitest';
import { TileCodec } from '../codec/tile-codec';
import { TilemapBuilder } from '../engine/tilemap-builder';
import type { TilemapEngine } from '../engine/tilemap-engine';
import type { PackedTileWord } from '../types/brands';
import type { ProjectionSpec } from '../types/projection';
import { gridToWorld, worldToGrid, worldToTile } from '../query/projection';
import {
    createRaycastHit,
    raycastTilemap,
    type TileRaycastHit,
} from '../query/raycast';

const LAYERS = [{ name: 'ground' }] as const;

const word = (tileId: number): PackedTileWord => TileCodec.pack(tileId);

const createEngine = (
    projection: ProjectionSpec
): TilemapEngine<typeof LAYERS> =>
    TilemapBuilder.create()
        .withProjection(projection)
        .withChunkShift(3)
        .withCapacity(16)
        .withLayers(LAYERS)
        .build()
        .get();

const orthogonal: ProjectionSpec = {
    kind: 'orthogonal',
    tileWidth: 16,
    tileHeight: 16,
};

const isometric: ProjectionSpec = {
    kind: 'isometric',
    tileWidth: 64,
    tileHeight: 32,
};

const staggered: ProjectionSpec = {
    kind: 'staggered-isometric',
    tileWidth: 64,
    tileHeight: 32,
    staggerAxis: 'y',
    staggerIndex: 'odd',
};

const expectHit = (
    hit: TileRaycastHit,
    gridX: number,
    gridY: number
): void => {
    expect(hit.hit).toBe(true);
    expect(hit.gridX).toBe(gridX);
    expect(hit.gridY).toBe(gridY);
};

describe('raycastTilemap — orthogonal', () => {
    it('hits an axis-aligned wall with the entered face normal', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 1, 0, word(5));

        const hit = createRaycastHit();
        expect(raycastTilemap(engine, 'ground', 8, 8, 1, 0, {}, hit)).toBe(
            true
        );
        expectHit(hit, 1, 0);
        expect(hit.word).toBe(word(5));
        expect(hit.time).toBeCloseTo(8, 9);
        expect(hit.distance).toBeCloseTo(8, 9);
        expect(hit.worldX).toBeCloseTo(16, 9);
        expect(hit.worldY).toBeCloseTo(8, 9);
        expect(hit.normalX).toBeCloseTo(-1, 9);
        expect(hit.normalY).toBeCloseTo(0, 9);
        engine.dispose();
    });

    it('walks in the negative direction and starts on the lower cell', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 0, -1, word(2));

        const hit = createRaycastHit();
        expect(raycastTilemap(engine, 'ground', 8, 1, 0, -1, {}, hit)).toBe(
            true
        );
        expectHit(hit, 0, -1);
        expect(hit.time).toBeCloseTo(1, 9);
        expect(hit.normalY).toBeCloseTo(1, 9);
        engine.dispose();
    });

    it('hits a diagonal ray in the expected tile', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 2, 1, word(9));

        const hit = createRaycastHit();
        expect(raycastTilemap(engine, 'ground', 8, 8, 2, 1, {}, hit)).toBe(
            true
        );
        expectHit(hit, 2, 1);
        engine.dispose();
    });

    it('returns t=0 with the word when the ray starts inside a solid tile', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 0, 0, word(7));

        const hit = createRaycastHit();
        expect(raycastTilemap(engine, 'ground', 8, 8, 1, 0, {}, hit)).toBe(
            true
        );
        expectHit(hit, 0, 0);
        expect(hit.time).toBe(0);
        expect(hit.word).toBe(word(7));
        expect(hit.normalX).toBe(0);
        expect(hit.normalY).toBe(0);
        engine.dispose();
    });

    it('rejects zero direction, zero distance and short rays', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 1, 0, word(1));
        const hit = createRaycastHit();
        expect(raycastTilemap(engine, 'ground', 8, 8, 0, 0, {}, hit)).toBe(
            false
        );
        expect(hit.hit).toBe(false);
        expect(
            raycastTilemap(engine, 'ground', 8, 8, 1, 0, { maxDistance: 0 }, hit)
        ).toBe(false);
        expect(
            raycastTilemap(engine, 'ground', 8, 8, 1, 0, { maxDistance: 7 }, hit)
        ).toBe(false);
        expect(
            raycastTilemap(engine, 'ground', 8, 8, 1, 0, { maxDistance: 8 }, hit)
        ).toBe(true);
        engine.dispose();
    });

    it('honours a custom solid predicate', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 1, 0, word(1));
        engine.write('ground', 3, 0, word(2));
        const hit = createRaycastHit();
        expect(
            raycastTilemap(engine, 'ground', 8, 8, 1, 0, {
                isSolid: (value) => value === word(2),
            }, hit)
        ).toBe(true);
        expect(hit.gridX).toBe(3);
        engine.dispose();
    });
});

describe('raycastTilemap — isometric', () => {
    it('produces a grid-exact hit and a world-space normal', () => {
        const engine = createEngine(isometric);
        engine.write('ground', 1, 0, word(4));

        const origin = gridToWorld(isometric, 0.5, 0);
        const direction = gridToWorld(isometric, 1, 0);
        const hit = createRaycastHit();
        expect(
            raycastTilemap(
                engine,
                'ground',
                origin.worldX,
                origin.worldY,
                direction.worldX,
                direction.worldY,
                {},
                hit
            )
        ).toBe(true);
        expectHit(hit, 1, 0);
        const back = worldToGrid(isometric, hit.worldX, hit.worldY);
        expect(back.gridX).toBeCloseTo(1, 9);
        expect(back.gridY).toBeCloseTo(0, 9);
        expect(hit.normalX).toBeCloseTo(-1 / Math.sqrt(5), 6);
        expect(hit.normalY).toBeCloseTo(-2 / Math.sqrt(5), 6);
        engine.dispose();
    });

    it('hits the same tile as the equivalent grid-space march', () => {
        const engine = createEngine(isometric);
        engine.write('ground', 2, -1, word(6));
        const origin = gridToWorld(isometric, 0, 0);
        const target = gridToWorld(isometric, 2.5, -0.5);
        const hit = createRaycastHit();
        expect(
            raycastTilemap(
                engine,
                'ground',
                origin.worldX,
                origin.worldY,
                target.worldX - origin.worldX,
                target.worldY - origin.worldY,
                {},
                hit
            )
        ).toBe(true);
        expectHit(hit, 2, -1);
        engine.dispose();
    });
});

describe('raycastTilemap — staggered isometric', () => {
    it('follows the shifted rows', () => {
        const engine = createEngine(staggered);
        engine.write('ground', 1, 0, word(1));
        const origin = gridToWorld(staggered, 0.5, 0.5);
        const hit = createRaycastHit();
        expect(
            raycastTilemap(
                engine,
                'ground',
                origin.worldX,
                origin.worldY,
                64,
                0,
                {},
                hit
            )
        ).toBe(true);
        expectHit(hit, 1, 0);
        expect(hit.worldX).toBeCloseTo(64, 9);
        expect(hit.worldY).toBeCloseTo(8, 9);
        engine.dispose();
    });

    it('handles negative coordinates and the odd-row offset', () => {
        const engine = createEngine(staggered);
        engine.write('ground', -2, -1, word(3));
        const origin = gridToWorld(staggered, -0.5, -0.5);
        const hit = createRaycastHit();
        expect(
            raycastTilemap(
                engine,
                'ground',
                origin.worldX,
                origin.worldY,
                -64,
                0,
                {},
                hit
            )
        ).toBe(true);
        expectHit(hit, -2, -1);
        expect(hit.normalX).toBeCloseTo(1, 9);
        expect(hit.normalY).toBeCloseTo(0, 9);
        engine.dispose();
    });

    it('hits a vertical ray across a row boundary', () => {
        const engine = createEngine(staggered);
        engine.write('ground', 0, 2, word(8));
        const origin = gridToWorld(staggered, 0.5, 0.5);
        const hit = createRaycastHit();
        expect(
            raycastTilemap(
                engine,
                'ground',
                origin.worldX,
                origin.worldY,
                0,
                32,
                {},
                hit
            )
        ).toBe(true);
        expectHit(hit, 0, 2);
        expect(hit.normalY).toBeCloseTo(-1, 9);
        expect(worldToTile(staggered, hit.worldX, hit.worldY)).toEqual({
            gridX: 0,
            gridY: 2,
        });
        engine.dispose();
    });
});
