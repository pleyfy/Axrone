import { describe, expect, it } from 'vitest';
import { TileCodec } from '../codec/tile-codec';
import { TilemapBuilder } from '../engine/tilemap-builder';
import type { TilemapEngine } from '../engine/tilemap-engine';
import type { PackedTileWord } from '../types/brands';
import { findPath } from '../path/astar';
import type { PathFound } from '../path/path-types';

const LAYERS = [{ name: 'ground' }] as const;

const word = (tileId: number): PackedTileWord => TileCodec.pack(tileId);

const wall = (): PackedTileWord => TileCodec.pack(1, 0, 1);

const createEngine = (): TilemapEngine<typeof LAYERS> =>
    TilemapBuilder.create()
        .withChunkShift(3)
        .withCapacity(16)
        .withLayers(LAYERS)
        .build()
        .get();

const points = (result: PathFound): number[] =>
    Array.from(result.waypoints.slice(0, result.count * 2));

describe('findPath', () => {
    it('walks a straight line in 4-neighbour mode', () => {
        const engine = createEngine();
        const result = findPath(engine, 'ground', 0, 0, 5, 0, {
            allowDiagonal: false,
        });
        expect(result.status).toBe('found');
        if (result.status !== 'found') throw new Error('expected path');
        expect(result.count).toBe(6);
        expect(result.cost).toBe(5);
        expect(points(result)).toEqual([0, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0]);
        engine.dispose();
    });

    it('takes the diagonal in 8-neighbour mode', () => {
        const engine = createEngine();
        const result = findPath(engine, 'ground', 0, 0, 3, 3);
        expect(result.status).toBe('found');
        if (result.status !== 'found') throw new Error('expected path');
        expect(result.count).toBe(4);
        expect(result.cost).toBeCloseTo(3 * Math.SQRT2, 9);
        engine.dispose();
    });

    it('returns a single waypoint for a zero-length path', () => {
        const engine = createEngine();
        const result = findPath(engine, 'ground', 4, 4, 4, 4);
        expect(result.status).toBe('found');
        if (result.status !== 'found') throw new Error('expected path');
        expect(result.count).toBe(1);
        expect(result.cost).toBe(0);
        expect(points(result)).toEqual([4, 4]);
        engine.dispose();
    });

    it('routes around a wall instead of through it', () => {
        const engine = createEngine();
        for (let gridX = 1; gridX <= 3; gridX++) {
            engine.write('ground', gridX, 0, wall());
        }
        const result = findPath(engine, 'ground', 0, 0, 4, 0, {
            allowDiagonal: false,
        });
        expect(result.status).toBe('found');
        if (result.status !== 'found') throw new Error('expected path');
        expect(result.cost).toBe(6);
        expect(points(result)).toEqual([
            0, 0, 0, 1, 1, 1, 2, 1, 3, 1, 4, 1, 4, 0,
        ]);
        engine.dispose();
    });

    it('rejects blocked start and goal tiles', () => {
        const engine = createEngine();
        engine.write('ground', 0, 0, wall());
        expect(findPath(engine, 'ground', 0, 0, 3, 0).status).toBe('no-path');
        engine.write('ground', 0, 0, word(0));
        engine.write('ground', 3, 0, wall());
        expect(findPath(engine, 'ground', 0, 0, 3, 0).status).toBe('no-path');
        engine.dispose();
    });

    it('returns limit when the expansion cap is reached', () => {
        const engine = createEngine();
        const result = findPath(engine, 'ground', 0, 0, 9, 9, {
            maxExpandedNodes: 5,
        });
        expect(result.status).toBe('limit');
        expect(result.expanded).toBe(5);
        engine.dispose();
    });

    it('reports buffer-too-small instead of truncating', () => {
        const engine = createEngine();
        const result = findPath(engine, 'ground', 0, 0, 5, 0, {
            allowDiagonal: false,
            out: new Int32Array(4),
        });
        expect(result.status).toBe('buffer-too-small');
        if (result.status !== 'buffer-too-small') {
            throw new Error('expected buffer-too-small');
        }
        expect(result.required).toBe(12);
        engine.dispose();
    });

    it('fills a caller buffer exactly when it is large enough', () => {
        const engine = createEngine();
        const out = new Int32Array(16);
        const result = findPath(engine, 'ground', 0, 0, 2, 0, {
            allowDiagonal: false,
            out,
        });
        expect(result.status).toBe('found');
        if (result.status !== 'found') throw new Error('expected path');
        expect(result.waypoints).toBe(out);
        expect(points(result)).toEqual([0, 0, 1, 0, 2, 0]);
        engine.dispose();
    });

    it('is deterministic for equal-cost routes', () => {
        const engine = createEngine();
        const first = findPath(engine, 'ground', 0, 0, 2, 1);
        const second = findPath(engine, 'ground', 0, 0, 2, 1);
        expect(first.status).toBe('found');
        expect(second.status).toBe('found');
        if (first.status !== 'found' || second.status !== 'found') {
            throw new Error('expected paths');
        }
        expect(points(first)).toEqual(points(second));
        expect(points(first)).toEqual([0, 0, 1, 0, 2, 1]);
        engine.dispose();
    });

    it('prefers a longer route when material makes it cheaper', () => {
        const engine = createEngine();
        engine.write('ground', 1, 0, TileCodec.pack(1, 0, 0, 5));
        const result = findPath(engine, 'ground', 0, 0, 2, 0, {
            allowDiagonal: false,
        });
        expect(result.status).toBe('found');
        if (result.status !== 'found') throw new Error('expected path');
        expect(result.cost).toBe(4);
        expect(result.count).toBe(5);
        engine.dispose();
    });

    it('supports custom blocking and step costs', () => {
        const engine = createEngine();
        engine.write('ground', 1, 0, word(1));
        const blocked = findPath(engine, 'ground', 0, 0, 2, 0, {
            allowDiagonal: false,
            isBlocked: (value) => value !== 0,
        });
        expect(blocked.status).toBe('found');
        if (blocked.status !== 'found') throw new Error('expected path');
        expect(blocked.count).toBe(5);

        const priced = findPath(engine, 'ground', 0, 0, 2, 0, {
            allowDiagonal: false,
            stepCost: () => 3,
        });
        expect(priced.status).toBe('found');
        if (priced.status !== 'found') throw new Error('expected path');
        expect(priced.cost).toBe(6);
        engine.dispose();
    });

    it('does not cut corners when the orthogonal neighbours block', () => {
        const engine = createEngine();
        engine.write('ground', 1, 0, wall());
        engine.write('ground', 0, 1, wall());
        const result = findPath(engine, 'ground', 0, 0, 1, 1, {
            preventCornerCutting: true,
        });
        expect(result.status).toBe('found');
        if (result.status !== 'found') throw new Error('expected path');
        expect(result.cost).toBeGreaterThan(Math.SQRT2);
        for (let index = 0; index < result.count; index += 2) {
            const gridX = points(result)[index];
            const gridY = points(result)[index + 1];
            expect([gridX, gridY]).not.toEqual([1, 0]);
            expect([gridX, gridY]).not.toEqual([0, 1]);
        }
        engine.dispose();
    });
});
