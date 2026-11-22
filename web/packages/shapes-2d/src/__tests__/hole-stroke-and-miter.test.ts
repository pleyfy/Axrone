import { describe, expect, it } from 'vitest';
import { buildStrokeMesh, createPolygonShape } from '../index';
import type { ShapeMesh2D } from '../types';

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

describe('hole boundary stroking', () => {
    it('generates stroke mesh that includes hole boundaries', () => {
        const shape = createPolygonShape({
            points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
            ],
            holes: [{ points: [{ x: 7, y: 7 }, { x: 7, y: 13 }, { x: 13, y: 13 }, { x: 13, y: 7 }] }],
            stroke: { paint: '#000', width: 2 },
        });

        const mesh = buildStrokeMesh(shape);
        expect(mesh).not.toBeNull();

        const area = meshTriangleAreaSum(mesh!);
        // Outer perimeter = 80, hole perimeter = 24, total = 104
        // Expected stroke area ≈ perimeter × width = 104 × 2 = 208
        expect(area).toBeGreaterThan(150);
    });

    it('stroke mesh covers hole edge but not hole interior', () => {
        const shape = createPolygonShape({
            points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
            ],
            holes: [{ points: [{ x: 7, y: 7 }, { x: 7, y: 13 }, { x: 13, y: 13 }, { x: 13, y: 7 }] }],
            stroke: { paint: '#000', width: 2 },
        });

        const mesh = buildStrokeMesh(shape)!;

        // Point on hole edge (should be covered)
        const onHoleEdge = isPointInMesh(mesh, 7, 10);
        expect(onHoleEdge).toBe(true);

        // Deep inside hole (should NOT be covered)
        const deepInHole = isPointInMesh(mesh, 10, 10);
        expect(deepInHole).toBe(false);
    });

    it('generates stroke for polygon with multiple holes', () => {
        const shape = createPolygonShape({
            points: [
                { x: 0, y: 0 },
                { x: 30, y: 0 },
                { x: 30, y: 30 },
                { x: 0, y: 30 },
            ],
            holes: [
                { points: [{ x: 3, y: 3 }, { x: 3, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 3 }] },
                { points: [{ x: 20, y: 20 }, { x: 20, y: 26 }, { x: 26, y: 26 }, { x: 26, y: 20 }] },
            ],
            stroke: { paint: '#000', width: 1 },
        });

        const mesh = buildStrokeMesh(shape);
        expect(mesh).not.toBeNull();
        expect(mesh!.indexCount).toBeGreaterThan(0);
    });
});

describe('miter limit clamping', () => {
    it('clamps extreme miter at near-180° angle', () => {
        // Create a shape with a very sharp concave vertex (near 180°)
        const shape = createPolygonShape({
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 5.001, y: 0.001 },
                { x: 0, y: 10 },
            ],
            stroke: { paint: '#000', width: 4 },
        });

        const mesh = buildStrokeMesh(shape);
        expect(mesh).not.toBeNull();

        const area = meshTriangleAreaSum(mesh!);
        // Without miter limit, the sharp vertex would produce an enormous spike
        // With miter limit of 4, the area should be bounded
        expect(area).toBeLessThan(1000);
        expect(area).toBeGreaterThan(0);
    });

    it('produces finite coordinates for all stroke vertices', () => {
        const shape = createPolygonShape({
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 5.0001, y: 5 },
                { x: 0, y: 10 },
            ],
            stroke: { paint: '#000', width: 8 },
        });

        const mesh = buildStrokeMesh(shape)!;
        for (let i = 0; i < mesh.positions.length; i++) {
            expect(Number.isFinite(mesh.positions[i] as number)).toBe(true);
        }
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

describe('combineMeshes index width', () => {
    it('produces valid indices for a polygon with many holes', () => {
        const outerPoints = [];
        for (let i = 0; i < 100; i++) {
            const angle = (i / 100) * Math.PI * 2;
            outerPoints.push({ x: Math.cos(angle) * 200, y: Math.sin(angle) * 200 });
        }
        const holes = [];
        for (let h = 0; h < 20; h++) {
            const cx = (h % 5 - 2) * 60;
            const cy = (Math.floor(h / 5) - 1) * 60;
            const ring = [];
            for (let i = 0; i < 16; i++) {
                const angle = (i / 16) * Math.PI * 2 * -1;
                ring.push({ x: cx + Math.cos(angle) * 10, y: cy + Math.sin(angle) * 10 });
            }
            holes.push({ points: ring, winding: 'cw' as const });
        }

        const shape = createPolygonShape({
            outer: { points: outerPoints, winding: 'ccw' },
            holes,
            stroke: { paint: '#000', width: 4 },
        });

        const mesh = buildStrokeMesh(shape)!;
        const totalVertices = mesh.vertexCount;
        for (let i = 0; i < mesh.indices.length; i++) {
            expect(mesh.indices[i] as number).toBeLessThan(totalVertices);
            expect(mesh.indices[i] as number).toBeGreaterThanOrEqual(0);
        }
    });
});
