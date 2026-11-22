import { describe, expect, it } from 'vitest';
import { TileCodec } from '../codec/tile-codec';
import { TilemapBuilder } from '../engine/tilemap-builder';
import type { TilemapEngine } from '../engine/tilemap-engine';
import type { PackedTileWord } from '../types/brands';
import type { ProjectionSpec } from '../types/projection';
import { gridToWorld } from '../query/projection';
import {
    createSweepHit,
    sweepTilemapAabb,
    type TileAabb,
} from '../query/sweep';

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

const box = (x: number, y: number, size = 8): TileAabb => ({
    x,
    y,
    width: size,
    height: size,
});

describe('sweepTilemapAabb — orthogonal', () => {
    it('stops flush against a wall with a world-space normal', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 2, 0, word(1));

        const hit = createSweepHit();
        expect(
            sweepTilemapAabb(engine, 'ground', box(0, 0), 40, 0, {}, hit)
        ).toBe(true);
        expect(hit.collided).toBe(true);
        expect(hit.time).toBeCloseTo(0.6, 9);
        expect(hit.gridX).toBe(2);
        expect(hit.gridY).toBe(0);
        expect(hit.x).toBeCloseTo(24 - 1e-5, 6);
        expect(hit.y).toBeCloseTo(0, 9);
        expect(hit.normalX).toBeCloseTo(-1, 9);
        expect(hit.normalY).toBeCloseTo(0, 9);
        engine.dispose();
    });

    it('resolves a start penetration at t=0 without moving the box', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 0, 0, word(1));

        const hit = createSweepHit();
        expect(
            sweepTilemapAabb(engine, 'ground', box(0, 0), 10, 0, {}, hit)
        ).toBe(true);
        expect(hit.time).toBe(0);
        expect(hit.x).toBe(0);
        expect(hit.y).toBe(0);
        expect(Math.hypot(hit.normalX, hit.normalY)).toBeCloseTo(1, 9);
        engine.dispose();
    });

    it('reports t=0 when the whole box starts inside a solid tile', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 0, 0, word(3));

        const hit = createSweepHit();
        expect(
            sweepTilemapAabb(engine, 'ground', box(4, 4, 4), 0, 10, {}, hit)
        ).toBe(true);
        expect(hit.time).toBe(0);
        expect(hit.gridX).toBe(0);
        expect(hit.gridY).toBe(0);
        expect(hit.word).toBe(word(3));
        engine.dispose();
    });

    it('returns no hit for a zero-length sweep and reports the final position', () => {
        const engine = createEngine(orthogonal);
        const hit = createSweepHit();
        expect(
            sweepTilemapAabb(engine, 'ground', box(5, 5), 0, 0, {}, hit)
        ).toBe(false);
        expect(hit.collided).toBe(false);
        expect(hit.x).toBe(5);
        expect(hit.y).toBe(5);
        engine.dispose();
    });

    it('does not jitter over 1000 frames against the same wall', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 2, 0, word(1));

        let current = box(0, 0);
        const hit = createSweepHit();
        for (let frame = 0; frame < 1000; frame++) {
            const collided = sweepTilemapAabb(
                engine,
                'ground',
                current,
                1,
                0,
                {},
                hit
            );
            current = { ...current, x: hit.x, y: hit.y };
            if (!collided) continue;
            expect(hit.time).toBeLessThanOrEqual(1);
            expect(hit.normalX).toBeCloseTo(-1, 9);
            expect(current.x + current.width).toBeLessThanOrEqual(32 + 1e-6);
        }
        expect(current.x).toBeCloseTo(24 - 1e-5, 6);
        engine.dispose();
    });

    it('sweeps diagonally into a corner tile', () => {
        const engine = createEngine(orthogonal);
        engine.write('ground', 1, 1, word(2));

        const hit = createSweepHit();
        expect(
            sweepTilemapAabb(engine, 'ground', box(0, 0), 32, 32, {}, hit)
        ).toBe(true);
        expect(hit.gridX).toBe(1);
        expect(hit.gridY).toBe(1);
        expect(hit.time).toBeCloseTo(0.25, 9);
        engine.dispose();
    });
});

describe('sweepTilemapAabb — isometric', () => {
    it('runs the sweep in grid space and returns a world normal', () => {
        const engine = createEngine(isometric);
        engine.write('ground', 1, 0, word(1));
        const center = gridToWorld(isometric, 0.5, 0);
        const start = {
            x: center.worldX - 4,
            y: center.worldY - 4,
            width: 8,
            height: 8,
        };

        const hit = createSweepHit();
        expect(
            sweepTilemapAabb(engine, 'ground', start, 32, 16, {}, hit)
        ).toBe(true);
        expect(hit.gridX).toBe(1);
        expect(hit.gridY).toBe(0);
        expect(hit.time).toBeCloseTo(0.3125, 9);
        expect(hit.normalX).toBeCloseTo(-1 / Math.sqrt(5), 6);
        expect(hit.normalY).toBeCloseTo(-2 / Math.sqrt(5), 6);
        engine.dispose();
    });
});

describe('sweepTilemapAabb — staggered isometric', () => {
    it('accounts for the shifted row when sweeping right', () => {
        const engine = createEngine(staggered);
        engine.write('ground', 1, 0, word(1));

        const hit = createSweepHit();
        expect(
            sweepTilemapAabb(engine, 'ground', box(0, 0), 64, 0, {}, hit)
        ).toBe(true);
        expect(hit.gridX).toBe(1);
        expect(hit.gridY).toBe(0);
        expect(hit.time).toBeCloseTo(0.875, 9);
        expect(hit.x).toBeCloseTo(56 - 1e-5, 6);
        expect(hit.normalX).toBeCloseTo(-1, 9);
        engine.dispose();
    });

    it('sweeps in the negative direction across a row boundary', () => {
        const engine = createEngine(staggered);
        engine.write('ground', -1, -1, word(2));

        const hit = createSweepHit();
        expect(
            sweepTilemapAabb(engine, 'ground', box(-8, -16), -64, 0, {}, hit)
        ).toBe(true);
        expect(hit.gridX).toBe(-1);
        expect(hit.gridY).toBe(-1);
        engine.dispose();
    });
});
