import { describe, expect, it } from 'vitest';
import { buildStrokeMesh, compileShape, hitTestShape } from '../index';
import { createPolygonShape, createRectangleShape } from '../shape';
import type { ShapeMesh2D } from '../types';

const lShapePoints = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 6, y: 10 },
    { x: 6, y: 4 },
    { x: 0, y: 4 },
];

const makeConcavePolygon = (width = 2, alignment: 'center' | 'inside' | 'outside' = 'center') =>
    createPolygonShape({
        points: lShapePoints,
        fill: '#333',
        stroke: { paint: '#000', width, alignment },
    });

const meshTriangleAreaSum = (mesh: ShapeMesh2D): number => {
    const { positions, indices } = mesh;
    let sum = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const a = (indices[t] as number) * 2;
        const b = (indices[t + 1] as number) * 2;
        const c = (indices[t + 2] as number) * 2;
        const ax = positions[a] as number;
        const ay = positions[a + 1] as number;
        const bx = positions[b] as number;
        const by = positions[b + 1] as number;
        const cx = positions[c] as number;
        const cy = positions[c + 1] as number;
        sum += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
    }
    return sum;
};

describe('concave polygon stroke hit-test', () => {
    it('detects stroke on a concave polygon edge (center alignment)', () => {
        const shape = makeConcavePolygon(2, 'center');

        // Point on the bottom edge (0,0)→(10,0), offset 0.5 outward
        expect(hitTestShape(shape, { x: 5, y: -0.5 })).toBe('stroke');

        // Point on the left edge (0,0)→(0,4), offset 0.5 outward
        expect(hitTestShape(shape, { x: -0.5, y: 2 })).toBe('stroke');

        // Point on the inner edge (6,4)→(0,4), offset 0.5 inward (into the notch)
        expect(hitTestShape(shape, { x: 3, y: 4.5 })).toBe('stroke');
    });

    it('does not detect stroke far from any edge', () => {
        const shape = makeConcavePolygon(2, 'center');

        // Deep inside the shape (far from any edge)
        expect(hitTestShape(shape, { x: 3, y: 2 })).toBe('fill');

        // Far outside
        expect(hitTestShape(shape, { x: 5, y: -5 })).toBe('none');
    });

    it('respects inside alignment for concave polygons', () => {
        const shape = makeConcavePolygon(2, 'inside');

        // Point just inside the bottom edge
        expect(hitTestShape(shape, { x: 5, y: 0.5 })).toBe('stroke');

        // Point just outside the bottom edge — should NOT be stroke for 'inside'
        const result = hitTestShape(shape, { x: 5, y: -0.5 });
        expect(result).not.toBe('stroke');
    });

    it('respects outside alignment for concave polygons', () => {
        const shape = makeConcavePolygon(2, 'outside');

        // Point just outside the bottom edge
        expect(hitTestShape(shape, { x: 5, y: -0.5 })).toBe('stroke');

        // Point just inside the bottom edge — should NOT be stroke for 'outside'
        const result = hitTestShape(shape, { x: 5, y: 0.5 });
        expect(result).not.toBe('stroke');
    });

    it('detects stroke near the concave reflex vertex', () => {
        const shape = makeConcavePolygon(2, 'center');

        // Point near the reflex vertex (6,4), on the outer side of the inner edge
        expect(hitTestShape(shape, { x: 5, y: 4 })).toBe('stroke');

        // Point in the notch, close to the inner vertical edge (6,4)→(6,10)
        expect(hitTestShape(shape, { x: 6.5, y: 7 })).toBe('stroke');
    });

    it('still works correctly for convex polygons (regression)', () => {
        const rect = createRectangleShape({
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            fill: '#333',
            stroke: { paint: '#000', width: 2, alignment: 'center' },
        });

        // On the edge
        expect(hitTestShape(rect, { x: 5, y: -0.5 })).toBe('stroke');

        // Inside
        expect(hitTestShape(rect, { x: 5, y: 5 })).toBe('fill');

        // Outside
        expect(hitTestShape(rect, { x: 5, y: -5 })).toBe('none');
    });
});

describe('concave polygon stroke mesh', () => {
    it('generates a non-null stroke mesh for a concave polygon', () => {
        const shape = makeConcavePolygon(2);
        const mesh = buildStrokeMesh(shape);

        expect(mesh).not.toBeNull();
        expect(mesh!.indexCount).toBeGreaterThan(0);
        expect(mesh!.vertexCount).toBeGreaterThan(0);
    });

    it('produces a stroke mesh with positive area', () => {
        const shape = makeConcavePolygon(2);
        const mesh = buildStrokeMesh(shape)!;

        const area = meshTriangleAreaSum(mesh);
        expect(area).toBeGreaterThan(0);
    });

    it('stroke mesh area approximates perimeter × width for center alignment', () => {
        const width = 2;
        const shape = makeConcavePolygon(width, 'center');
        const mesh = buildStrokeMesh(shape)!;

        // L-shape perimeter: 10 + 10 + 4 + 6 + 6 + 4 = 40
        // Expected stroke area ≈ perimeter × width = 40 × 2 = 80
        // (miter joins add a small amount at convex vertices)
        const area = meshTriangleAreaSum(mesh);
        expect(area).toBeGreaterThan(60);
        expect(area).toBeLessThan(120);
    });

    it('generates stroke mesh for inside alignment', () => {
        const shape = makeConcavePolygon(2, 'inside');
        const mesh = buildStrokeMesh(shape);

        expect(mesh).not.toBeNull();
        expect(mesh!.indexCount).toBeGreaterThan(0);
    });

    it('generates stroke mesh for outside alignment', () => {
        const shape = makeConcavePolygon(2, 'outside');
        const mesh = buildStrokeMesh(shape);

        expect(mesh).not.toBeNull();
        expect(mesh!.indexCount).toBeGreaterThan(0);
    });

    it('stroke mesh covers edge-adjacent points but not deep interior', () => {
        const shape = makeConcavePolygon(2, 'center');
        const compiled = compileShape(shape, { includeStrokeMesh: true });
        const mesh = compiled.strokeMesh!;

        // Point on bottom edge (should be covered)
        const onEdge = isPointInMesh(mesh, 5, 0);
        expect(onEdge).toBe(true);

        // Deep interior (should NOT be covered)
        const deepInside = isPointInMesh(mesh, 3, 2);
        expect(deepInside).toBe(false);
    });
});

const isPointInMesh = (mesh: ShapeMesh2D, px: number, py: number): boolean => {
    const { positions, indices } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
        const ai = (indices[t] as number) * 2;
        const bi = (indices[t + 1] as number) * 2;
        const ci = (indices[t + 2] as number) * 2;
        const ax = positions[ai] as number;
        const ay = positions[ai + 1] as number;
        const bx = positions[bi] as number;
        const by = positions[bi + 1] as number;
        const cx = positions[ci] as number;
        const cy = positions[ci + 1] as number;

        const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
        const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
        const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
        const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
        const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
        if (!(hasNeg && hasPos)) {
            return true;
        }
    }
    return false;
};
