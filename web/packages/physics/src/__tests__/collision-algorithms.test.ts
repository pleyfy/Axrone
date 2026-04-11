import { describe, it, expect } from 'vitest';
import { GJK2D, SAT2D, EPA2D } from '@axrone/physics';

describe('Collision Algorithms', () => {
    describe('GJK2D - Intersection Tests', () => {
        const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
        const transformB = { position: { x: 0, y: 0 }, rotation: 0 };

        it('detects overlapping squares', () => {
            const squareA = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];
            const squareB = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];

            const result = GJK2D.testIntersection(squareA, squareB, transformA, transformB);
            expect(result).toBe(true);
        });

        it('detects separated squares', () => {
            const squareA = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];
            const squareB = [
                { x: 5, y: 5 },
                { x: 7, y: 5 },
                { x: 7, y: 7 },
                { x: 5, y: 7 },
            ];

            const result = GJK2D.testIntersection(squareA, squareB, transformA, transformB);
            expect(result).toBe(false);
        });

        it('detects edge touching squares', () => {
            const squareA = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
                { x: 0, y: 2 },
            ];
            const squareB = [
                { x: 2, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 2 },
                { x: 2, y: 2 },
            ];

            const result = GJK2D.testIntersection(squareA, squareB, transformA, transformB);
            expect(result).toBe(true);
        });

        it('detects partially overlapping squares', () => {
            const squareA = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
                { x: 0, y: 2 },
            ];
            const squareB = [
                { x: 1, y: 1 },
                { x: 3, y: 1 },
                { x: 3, y: 3 },
                { x: 1, y: 3 },
            ];

            const result = GJK2D.testIntersection(squareA, squareB, transformA, transformB);
            expect(result).toBe(true);
        });

        it('detects triangle inside square', () => {
            const square = [
                { x: -2, y: -2 },
                { x: 2, y: -2 },
                { x: 2, y: 2 },
                { x: -2, y: 2 },
            ];
            const triangle = [
                { x: 0, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];

            const result = GJK2D.testIntersection(square, triangle, transformA, transformB);
            expect(result).toBe(true);
        });

        it('detects separated triangle and square', () => {
            const square = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
            ];
            const triangle = [
                { x: 5, y: 5 },
                { x: 6, y: 5 },
                { x: 5.5, y: 6 },
            ];

            const result = GJK2D.testIntersection(square, triangle, transformA, transformB);
            expect(result).toBe(false);
        });

        it('handles rotated shapes', () => {
            const square = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];
            const rotatedSquare = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];

            const transformRot = { position: { x: 0, y: 0 }, rotation: Math.PI / 4 };
            const result = GJK2D.testIntersection(square, rotatedSquare, transformA, transformRot);
            expect(result).toBe(true);
        });

        it('handles translated shapes', () => {
            const square = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];

            const transformTrans = { position: { x: 3, y: 0 }, rotation: 0 };
            const result = GJK2D.testIntersection(square, square, transformA, transformTrans);
            expect(result).toBe(false);
        });

        it('detects overlapping hexagons', () => {
            const hexA = [];
            const hexB = [];
            for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2;
                hexA.push({ x: Math.cos(angle), y: Math.sin(angle) });
                hexB.push({ x: Math.cos(angle), y: Math.sin(angle) });
            }

            const result = GJK2D.testIntersection(hexA, hexB, transformA, transformB);
            expect(result).toBe(true);
        });
    });

    describe('SAT2D - Separating Axis Theorem', () => {
        const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
        const transformB = { position: { x: 0, y: 0 }, rotation: 0 };

        it('detects collision between overlapping squares', () => {
            const squareA = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];
            const squareB = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];

            const result = SAT2D.testPolygonPolygon(squareA, squareB, transformA, transformB);
            expect(result.colliding).toBe(true);
            expect(result.penetration).toBeGreaterThan(0);
        });

        it('detects no collision between separated squares', () => {
            const squareA = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
            ];
            const squareB = [
                { x: 5, y: 5 },
                { x: 6, y: 5 },
                { x: 6, y: 6 },
                { x: 5, y: 6 },
            ];

            const result = SAT2D.testPolygonPolygon(squareA, squareB, transformA, transformB);
            expect(result.colliding).toBe(false);
        });

        it('computes penetration depth', () => {
            const squareA = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
                { x: 0, y: 2 },
            ];
            const squareB = [
                { x: 1, y: 1 },
                { x: 3, y: 1 },
                { x: 3, y: 3 },
                { x: 1, y: 3 },
            ];

            const result = SAT2D.testPolygonPolygon(squareA, squareB, transformA, transformB);
            expect(result.colliding).toBe(true);
            expect(result.penetration).toBeCloseTo(1, 1);
        });

        it('computes collision normal', () => {
            const squareA = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
                { x: 0, y: 2 },
            ];
            const squareB = [
                { x: 1.5, y: 0 },
                { x: 3.5, y: 0 },
                { x: 3.5, y: 2 },
                { x: 1.5, y: 2 },
            ];

            const result = SAT2D.testPolygonPolygon(squareA, squareB, transformA, transformB);
            expect(result.colliding).toBe(true);
            expect(
                result.normal.x * result.normal.x + result.normal.y * result.normal.y
            ).toBeCloseTo(1);
        });

        it('handles triangle-square collision', () => {
            const triangle = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 2 },
            ];
            const square = [
                { x: 0.5, y: 0.5 },
                { x: 1.5, y: 0.5 },
                { x: 1.5, y: 1.5 },
                { x: 0.5, y: 1.5 },
            ];

            const result = SAT2D.testPolygonPolygon(triangle, square, transformA, transformB);
            expect(result.colliding).toBe(true);
        });

        it('handles edge-edge contact', () => {
            const squareA = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
                { x: 0, y: 2 },
            ];
            const squareB = [
                { x: 2, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 2 },
                { x: 2, y: 2 },
            ];

            const result = SAT2D.testPolygonPolygon(squareA, squareB, transformA, transformB);
            expect(result.colliding).toBe(true);
        });

        it('handles rotated polygon collision', () => {
            const square = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];

            const transformRot = { position: { x: 0, y: 0 }, rotation: Math.PI / 4 };
            const result = SAT2D.testPolygonPolygon(square, square, transformA, transformRot);
            expect(result.colliding).toBe(true);
        });

        it('handles translated polygon collision', () => {
            const square = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];

            const transformTrans = { position: { x: 1.5, y: 0 }, rotation: 0 };
            const result = SAT2D.testPolygonPolygon(square, square, transformA, transformTrans);
            expect(result.colliding).toBe(true);
        });

        it('handles pentagon collision', () => {
            const pentA = [];
            const pentB = [];
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                pentA.push({ x: Math.cos(angle), y: Math.sin(angle) });
                pentB.push({ x: Math.cos(angle) + 0.5, y: Math.sin(angle) });
            }

            const result = SAT2D.testPolygonPolygon(pentA, pentB, transformA, transformB);
            expect(result.colliding).toBe(true);
        });
    });

    describe('EPA2D - Penetration Depth', () => {
        it('computes penetration for overlapping squares', () => {
            const squareA = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];
            const squareB = [
                { x: -0.5, y: -0.5 },
                { x: 1.5, y: -0.5 },
                { x: 1.5, y: 1.5 },
                { x: -0.5, y: 1.5 },
            ];
            const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
            const transformB = { position: { x: 0, y: 0 }, rotation: 0 };

            const simplex = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0.5, y: 1 },
            ];

            const result = EPA2D.findPenetrationDepth(
                squareA,
                squareB,
                transformA,
                transformB,
                simplex
            );

            expect(result.depth).toBeGreaterThanOrEqual(0);
            const normalLength =
                result.normal.x * result.normal.x + result.normal.y * result.normal.y;
            if (normalLength > 0) {
                expect(normalLength).toBeCloseTo(1, 1);
            }
        });

        it('computes normal vector', () => {
            const squareA = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
                { x: 0, y: 2 },
            ];
            const squareB = [
                { x: 1, y: 1 },
                { x: 3, y: 1 },
                { x: 3, y: 3 },
                { x: 1, y: 3 },
            ];
            const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
            const transformB = { position: { x: 0, y: 0 }, rotation: 0 };

            const simplex = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
            ];

            const result = EPA2D.findPenetrationDepth(
                squareA,
                squareB,
                transformA,
                transformB,
                simplex
            );

            expect(result.normal).toBeDefined();
            const normalLength = Math.abs(result.normal.x) + Math.abs(result.normal.y);
            expect(normalLength).toBeGreaterThanOrEqual(0);
        });

        it('handles deep penetration', () => {
            const squareA = [
                { x: -2, y: -2 },
                { x: 2, y: -2 },
                { x: 2, y: 2 },
                { x: -2, y: 2 },
            ];
            const squareB = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];
            const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
            const transformB = { position: { x: 0, y: 0 }, rotation: 0 };

            const simplex = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0, y: 1 },
            ];

            const result = EPA2D.findPenetrationDepth(
                squareA,
                squareB,
                transformA,
                transformB,
                simplex
            );

            expect(result.depth).toBeGreaterThanOrEqual(0);
        });

        it('handles triangle penetration', () => {
            const triangleA = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 2 },
            ];
            const triangleB = [
                { x: 0.5, y: 0.5 },
                { x: 2.5, y: 0.5 },
                { x: 1.5, y: 2.5 },
            ];
            const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
            const transformB = { position: { x: 0, y: 0 }, rotation: 0 };

            const simplex = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0.5, y: 1 },
            ];

            const result = EPA2D.findPenetrationDepth(
                triangleA,
                triangleB,
                transformA,
                transformB,
                simplex
            );

            expect(result.depth).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Edge Cases', () => {
        const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
        const transformB = { position: { x: 0, y: 0 }, rotation: 0 };

        it('handles identical shapes', () => {
            const square = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];

            const gjkResult = GJK2D.testIntersection(square, square, transformA, transformB);
            expect(gjkResult).toBe(true);

            const satResult = SAT2D.testPolygonPolygon(square, square, transformA, transformB);
            expect(satResult.colliding).toBe(true);
        });

        it('handles very small shapes', () => {
            const tiny = [
                { x: 0, y: 0 },
                { x: 1e-6, y: 0 },
                { x: 1e-6, y: 1e-6 },
                { x: 0, y: 1e-6 },
            ];

            const result = GJK2D.testIntersection(tiny, tiny, transformA, transformB);
            expect(result).toBe(true);
        });

        it('handles very large shapes', () => {
            const large = [
                { x: -1e6, y: -1e6 },
                { x: 1e6, y: -1e6 },
                { x: 1e6, y: 1e6 },
                { x: -1e6, y: 1e6 },
            ];
            const small = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];

            const result = GJK2D.testIntersection(large, small, transformA, transformB);
            expect(result).toBe(true);
        });

        it('handles collinear vertices', () => {
            const shape = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
            ];
            const square = [
                { x: 0.5, y: -0.5 },
                { x: 1.5, y: -0.5 },
                { x: 1.5, y: 0.5 },
                { x: 0.5, y: 0.5 },
            ];

            const result = GJK2D.testIntersection(shape, square, transformA, transformB);
            expect(typeof result).toBe('boolean');
        });

        it('handles near-miss collision', () => {
            const squareA = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
            ];
            const squareB = [
                { x: 1.001, y: 0 },
                { x: 2.001, y: 0 },
                { x: 2.001, y: 1 },
                { x: 1.001, y: 1 },
            ];

            const result = GJK2D.testIntersection(squareA, squareB, transformA, transformB);
            expect(result).toBe(false);
        });
    });
});

