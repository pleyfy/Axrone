import { describe, expect, it } from 'vitest';
import {
    isPointInTriangle,
    polygonSignedArea,
    triangulatePolygonWithHoles,
    type TriangulatedPolygonWithHoles,
} from '../common';
import { buildFillMesh } from '../mesh';
import { createPolygonShape } from '../shape';
import type { ShapeMesh2D } from '../types';

const CCW_SQUARE = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10]);
const CW_SQUARE_HOLE = new Float32Array([4, 4, 4, 6, 6, 6, 6, 4]);

const triangleArea = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number
): number => Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;

const meshTriangleAreaSum = (mesh: TriangulatedPolygonWithHoles): number => {
    const { positions, indices } = mesh;
    let sum = 0;
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] as number * 2;
        const b = indices[t + 1] as number * 2;
        const c = indices[t + 2] as number * 2;
        sum += triangleArea(
            positions[a] as number,
            positions[a + 1] as number,
            positions[b] as number,
            positions[b + 1] as number,
            positions[c] as number,
            positions[c + 1] as number
        );
    }
    return sum;
};

const referencedVertexCount = (mesh: TriangulatedPolygonWithHoles): number => {
    const used = new Set<number>();
    for (let i = 0; i < mesh.indices.length; i++) {
        used.add(mesh.indices[i] as number);
    }
    return used.size;
};

const isPointCoveredByMesh = (
    mesh: ShapeMesh2D,
    px: number,
    py: number
): boolean => {
    const { positions, indices } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t] as number * 2;
        const b = indices[t + 1] as number * 2;
        const c = indices[t + 2] as number * 2;
        if (
            isPointInTriangle(
                px,
                py,
                positions[a] as number,
                positions[a + 1] as number,
                positions[b] as number,
                positions[b + 1] as number,
                positions[c] as number,
                positions[c + 1] as number
            )
        ) {
            return true;
        }
    }
    return false;
};

describe('triangulatePolygonWithHoles', () => {
    it('cuts a square hole out of a square with area- and vertex-preserving mesh', () => {
        const mesh = triangulatePolygonWithHoles(CCW_SQUARE, [CW_SQUARE_HOLE]);

        // 4 outer + 4 hole vertices + 2 seam duplicates = 10 nodes → 8 triangles.
        expect(mesh.positions.length).toBe(16);
        expect(mesh.indices.length).toBe(24);
        expect(referencedVertexCount(mesh)).toBe(8);
        expect(meshTriangleAreaSum(mesh)).toBeCloseTo(96, 5);
    });

    it('normalizes a clockwise outer ring before bridging', () => {
        const cwOuter = new Float32Array([0, 10, 10, 10, 10, 0, 0, 0]);
        const mesh = triangulatePolygonWithHoles(cwOuter, [CW_SQUARE_HOLE]);

        expect(meshTriangleAreaSum(mesh)).toBeCloseTo(96, 5);
        expect(referencedVertexCount(mesh)).toBe(8);
    });

    it('normalizes a counter-clockwise hole ring before bridging', () => {
        const ccwHole = new Float32Array([4, 4, 6, 4, 6, 6, 4, 6]);
        const mesh = triangulatePolygonWithHoles(CCW_SQUARE, [ccwHole]);

        expect(meshTriangleAreaSum(mesh)).toBeCloseTo(96, 5);
    });

    it('meshes a concave outer ring with a hole', () => {
        // L-shape (area 64) with a 2x2 hole at (3,1)..(5,3) → net area 60.
        const lShape = new Float32Array([0, 0, 10, 0, 10, 10, 6, 10, 6, 4, 0, 4]);
        const hole = new Float32Array([3, 1, 3, 3, 5, 3, 5, 1]);
        const mesh = triangulatePolygonWithHoles(lShape, [hole]);

        expect(meshTriangleAreaSum(mesh)).toBeCloseTo(60, 5);
        expect(referencedVertexCount(mesh)).toBe(10);
    });

    it('bridges multiple holes with every vertex referenced', () => {
        const mesh = triangulatePolygonWithHoles(CCW_SQUARE, [
            CW_SQUARE_HOLE,
            new Float32Array([1, 7, 1, 9, 3, 9, 3, 7]),
        ]);

        // 4 + 4 + 4 vertices + 2 seam duplicates per hole = 16 nodes → 14 triangles.
        expect(mesh.indices.length).toBe(42);
        expect(referencedVertexCount(mesh)).toBe(12);
        expect(meshTriangleAreaSum(mesh)).toBeCloseTo(100 - 4 - 4, 5);
    });

    it('produces no triangle covering the hole interior', () => {
        const mesh = triangulatePolygonWithHoles(CCW_SQUARE, [CW_SQUARE_HOLE]);

        for (let t = 0; t < mesh.indices.length; t += 3) {
            const a = mesh.indices[t] as number * 2;
            const b = mesh.indices[t + 1] as number * 2;
            const c = mesh.indices[t + 2] as number * 2;
            const coversHoleCenter = isPointInTriangle(
                5,
                5,
                mesh.positions[a] as number,
                mesh.positions[a + 1] as number,
                mesh.positions[b] as number,
                mesh.positions[b + 1] as number,
                mesh.positions[c] as number,
                mesh.positions[c + 1] as number
            );
            expect(coversHoleCenter).toBe(false);
        }
    });

    it('throws when the outer ring has fewer than 3 vertices', () => {
        expect(() => triangulatePolygonWithHoles(new Float32Array([0, 0, 1, 0]), [])).toThrow();
    });

    it('throws when a hole ring has fewer than 3 vertices', () => {
        expect(() =>
            triangulatePolygonWithHoles(CCW_SQUARE, [new Float32Array([1, 1, 2, 2])])
        ).toThrow();
    });
});

describe('polygon hole fill mesh (public API)', () => {
    it('builds a hole-aware fill mesh through buildFillMesh', () => {
        const shape = createPolygonShape({
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
            holes: [{ points: [{ x: 4, y: 4 }, { x: 4, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 4 }] }],
        });

        const mesh = buildFillMesh(shape);
        expect(mesh).not.toBeNull();
        expect(mesh!.indexCount).toBe(24);
        expect(meshTriangleAreaSum({
            positions: mesh!.positions,
            indices: mesh!.indices as unknown as TriangulatedPolygonWithHoles['indices'],
        })).toBeCloseTo(96, 5);
    });

    it('mesh coverage matches point-in-polygon-with-holes on a probe grid', () => {
        const shape = createPolygonShape({
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
            holes: [{ points: [{ x: 4, y: 4 }, { x: 4, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 4 }] }],
        });
        const mesh = buildFillMesh(shape)!;

        const probes: Array<{ x: number; y: number; inside: boolean }> = [
            { x: 1, y: 1, inside: true },
            { x: 9, y: 9, inside: true },
            { x: 1, y: 9, inside: true },
            { x: 9, y: 1, inside: true },
            { x: 5, y: 5, inside: false },
            { x: 4.5, y: 5.5, inside: false },
            { x: 20, y: 5, inside: false },
        ];

        for (const probe of probes) {
            expect(isPointCoveredByMesh(mesh, probe.x, probe.y)).toBe(probe.inside);
        }
    });

    it('fills a concave polygon with a hole without collapsing triangles', () => {
        const shape = createPolygonShape({
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 6, y: 10 },
                { x: 6, y: 4 },
                { x: 0, y: 4 },
            ],
            holes: [{ points: [{ x: 1, y: 1 }, { x: 1, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 1 }] }],
        });

        const mesh = buildFillMesh(shape)!;
        expect(mesh.indexCount).toBeGreaterThan(0);
        expect(meshTriangleAreaSum({
            positions: mesh.positions,
            indices: mesh.indices as unknown as TriangulatedPolygonWithHoles['indices'],
        })).toBeCloseTo(64 - 4, 5);
    });

    it('produces a positively-wound index buffer (signed area preserved)', () => {
        const shape = createPolygonShape({
            points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
            holes: [{ points: [{ x: 4, y: 4 }, { x: 4, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 4 }] }],
        });
        const mesh = buildFillMesh(shape)!;
        const { positions, indices } = mesh;

        let signedSum = 0;
        for (let t = 0; t < indices.length; t += 3) {
            const a = indices[t] as number * 2;
            const b = indices[t + 1] as number * 2;
            const c = indices[t + 2] as number * 2;
            signedSum += polygonSignedArea(
                new Float32Array([
                    positions[a] as number,
                    positions[a + 1] as number,
                    positions[b] as number,
                    positions[b + 1] as number,
                    positions[c] as number,
                    positions[c + 1] as number,
                ])
            );
        }
        expect(signedSum).toBeCloseTo(96, 5);
    });
});
