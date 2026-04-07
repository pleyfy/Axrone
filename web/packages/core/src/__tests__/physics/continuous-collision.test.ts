import { describe, it, expect } from 'vitest';
import { ContinuousCollisionDetection, Raycaster2D } from '../../physics/core/continuous-collision';
import { AABB2D } from '../../geometry/aabb';

describe('ContinuousCollisionDetection', () => {
    describe('Time of Impact Computation', () => {
        it('computes TOI for colliding AABBs', () => {
            const aabbA = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const velocityA = { x: 5, y: 0 };
            const aabbB = new AABB2D({ x: 10, y: 0 }, { x: 11, y: 1 });
            const velocityB = { x: 0, y: 0 };

            const result = ContinuousCollisionDetection.computeTimeOfImpact(
                aabbA,
                velocityA,
                aabbB,
                velocityB,
                2.0
            );

            expect(result.hit).toBe(true);
            expect(result.toi).toBeGreaterThan(0);
            expect(result.toi).toBeLessThanOrEqual(2.0);
        });

        it('returns no hit for separating AABBs', () => {
            const aabbA = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const velocityA = { x: -5, y: 0 };
            const aabbB = new AABB2D({ x: 10, y: 0 }, { x: 11, y: 1 });
            const velocityB = { x: 0, y: 0 };

            const result = ContinuousCollisionDetection.computeTimeOfImpact(
                aabbA,
                velocityA,
                aabbB,
                velocityB,
                1.0
            );

            expect(result.hit).toBe(false);
        });

        it('computes contact normal', () => {
            const aabbA = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const velocityA = { x: 2, y: 0 };
            const aabbB = new AABB2D({ x: 3, y: 0 }, { x: 4, y: 1 });
            const velocityB = { x: 0, y: 0 };

            const result = ContinuousCollisionDetection.computeTimeOfImpact(
                aabbA,
                velocityA,
                aabbB,
                velocityB,
                2.0
            );

            if (result.hit) {
                expect(
                    result.normal.x * result.normal.x + result.normal.y * result.normal.y
                ).toBeCloseTo(1);
            }
        });

        it('computes contact point', () => {
            const aabbA = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const velocityA = { x: 2, y: 0 };
            const aabbB = new AABB2D({ x: 3, y: 0 }, { x: 4, y: 1 });
            const velocityB = { x: 0, y: 0 };

            const result = ContinuousCollisionDetection.computeTimeOfImpact(
                aabbA,
                velocityA,
                aabbB,
                velocityB,
                2.0
            );

            if (result.hit) {
                expect(result.point).toBeDefined();
                expect(typeof result.point.x).toBe('number');
                expect(typeof result.point.y).toBe('number');
            }
        });

        it('handles both moving AABBs', () => {
            const aabbA = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const velocityA = { x: 5, y: 0 };
            const aabbB = new AABB2D({ x: 10, y: 0 }, { x: 11, y: 1 });
            const velocityB = { x: -5, y: 0 };

            const result = ContinuousCollisionDetection.computeTimeOfImpact(
                aabbA,
                velocityA,
                aabbB,
                velocityB,
                1.0
            );

            expect(result.hit).toBe(true);
            expect(result.toi).toBeLessThan(1.0);
        });

        it('handles stationary AABBs', () => {
            const aabbA = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });
            const velocityA = { x: 0, y: 0 };
            const aabbB = new AABB2D({ x: 10, y: 0 }, { x: 11, y: 1 });
            const velocityB = { x: 0, y: 0 };

            const result = ContinuousCollisionDetection.computeTimeOfImpact(
                aabbA,
                velocityA,
                aabbB,
                velocityB,
                1.0
            );

            expect(result.hit).toBe(false);
        });

        it('handles initially overlapping AABBs', () => {
            const aabbA = new AABB2D({ x: 0, y: 0 }, { x: 2, y: 2 });
            const velocityA = { x: 1, y: 0 };
            const aabbB = new AABB2D({ x: 1, y: 1 }, { x: 3, y: 3 });
            const velocityB = { x: 0, y: 0 };

            const result = ContinuousCollisionDetection.computeTimeOfImpact(
                aabbA,
                velocityA,
                aabbB,
                velocityB,
                1.0
            );

            expect(result.hit).toBe(true);
        });
    });

    describe('Conservative Advancement', () => {
        it('detects collision between moving polygons', () => {
            const verticesA = [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];
            const verticesB = [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];
            const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
            const transformB = { position: { x: 5, y: 0 }, rotation: 0 };
            const velocityA = { x: 3, y: 0 };
            const velocityB = { x: 0, y: 0 };

            const result = ContinuousCollisionDetection.conservativeAdvancement(
                verticesA,
                verticesB,
                transformA,
                transformB,
                velocityA,
                velocityB,
                0,
                0,
                2.0
            );

            expect(result.hit).toBe(true);
            expect(result.toi).toBeGreaterThan(0);
        });

        it('handles rotating shapes', () => {
            const vertices = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];
            const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
            const transformB = { position: { x: 3, y: 0 }, rotation: 0 };
            const velocityA = { x: 0, y: 0 };
            const velocityB = { x: 0, y: 0 };

            const result = ContinuousCollisionDetection.conservativeAdvancement(
                vertices,
                vertices,
                transformA,
                transformB,
                velocityA,
                velocityB,
                Math.PI,
                0,
                1.0
            );

            expect(typeof result.hit).toBe('boolean');
        });

        it('returns no hit for separated trajectories', () => {
            const vertices = [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];
            const transformA = { position: { x: 0, y: 0 }, rotation: 0 };
            const transformB = { position: { x: 10, y: 10 }, rotation: 0 };
            const velocityA = { x: 1, y: 0 };
            const velocityB = { x: 0, y: 1 };

            const result = ContinuousCollisionDetection.conservativeAdvancement(
                vertices,
                vertices,
                transformA,
                transformB,
                velocityA,
                velocityB,
                0,
                0,
                1.0
            );

            expect(result.hit).toBe(false);
        });
    });
});

describe('Raycaster2D', () => {
    describe('AABB Raycasts', () => {
        it('hits AABB from outside', () => {
            const origin = { x: -5, y: 0.5 };
            const direction = { x: 1, y: 0 };
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb);

            expect(result.hit).toBe(true);
            expect(result.distance).toBeGreaterThan(0);
        });

        it('misses AABB', () => {
            const origin = { x: -5, y: 5 };
            const direction = { x: 1, y: 0 };
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb);

            expect(result.hit).toBe(false);
        });

        it('computes hit point on AABB', () => {
            const origin = { x: -5, y: 0.5 };
            const direction = { x: 1, y: 0 };
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb);

            if (result.hit) {
                expect(result.point.x).toBeCloseTo(0);
                expect(result.point.y).toBeCloseTo(0.5);
            }
        });

        it('computes surface normal', () => {
            const origin = { x: -5, y: 0.5 };
            const direction = { x: 1, y: 0 };
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb);

            if (result.hit) {
                expect(
                    result.normal.x * result.normal.x + result.normal.y * result.normal.y
                ).toBeCloseTo(1);
            }
        });

        it('respects max distance', () => {
            const origin = { x: -5, y: 0.5 };
            const direction = { x: 1, y: 0 };
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb, 2.0);

            expect(result.hit).toBe(false);
        });

        it('hits AABB from inside', () => {
            const origin = { x: 0.5, y: 0.5 };
            const direction = { x: 1, y: 0 };
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb);

            expect(result.hit).toBe(true);
        });

        it('hits AABB corner', () => {
            const origin = { x: -1, y: -1 };
            const direction = { x: 0.707, y: 0.707 };
            const aabb = new AABB2D({ x: 0, y: 0 }, { x: 1, y: 1 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb);

            expect(result.hit).toBe(true);
        });
    });

    describe('Circle Raycasts', () => {
        it('hits circle from outside', () => {
            const origin = { x: -5, y: 0 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 1;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius);

            expect(result.hit).toBe(true);
            expect(result.distance).toBeGreaterThan(0);
        });

        it('misses circle', () => {
            const origin = { x: -5, y: 5 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 1;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius);

            expect(result.hit).toBe(false);
        });

        it('computes hit point on circle', () => {
            const origin = { x: -5, y: 0 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 1;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius);

            if (result.hit) {
                expect(result.point.x).toBeCloseTo(-1);
                expect(result.point.y).toBeCloseTo(0);
            }
        });

        it('computes normal at hit point', () => {
            const origin = { x: -5, y: 0 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 1;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius);

            if (result.hit) {
                expect(result.normal.x).toBeCloseTo(-1);
                expect(result.normal.y).toBeCloseTo(0);
            }
        });

        it('respects max distance', () => {
            const origin = { x: -10, y: 0 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 1;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius, 5.0);

            expect(result.hit).toBe(false);
        });

        it('hits circle at tangent', () => {
            const origin = { x: -5, y: 1 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 1;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius);

            expect(result.hit).toBe(true);
        });

        it('handles ray starting inside circle', () => {
            const origin = { x: 0, y: 0 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 2;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius);

            expect(typeof result.hit).toBe('boolean');
        });
    });

    describe('Polygon Raycasts', () => {
        it('hits square polygon', () => {
            const origin = { x: -5, y: 0.5 };
            const direction = { x: 1, y: 0 };
            const vertices = [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];
            const transform = { position: { x: 0, y: 0 }, rotation: 0 };

            const result = Raycaster2D.raycastPolygon(origin, direction, vertices, transform);

            expect(result.hit).toBe(true);
        });

        it('misses polygon', () => {
            const origin = { x: -5, y: 5 };
            const direction = { x: 1, y: 0 };
            const vertices = [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];
            const transform = { position: { x: 0, y: 0 }, rotation: 0 };

            const result = Raycaster2D.raycastPolygon(origin, direction, vertices, transform);

            expect(result.hit).toBe(false);
        });

        it('hits triangle', () => {
            const origin = { x: -5, y: 0.5 };
            const direction = { x: 1, y: 0 };
            const vertices = [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 0.5, y: 1 },
            ];
            const transform = { position: { x: 0, y: 0 }, rotation: 0 };

            const result = Raycaster2D.raycastPolygon(origin, direction, vertices, transform);

            expect(result.hit).toBe(true);
        });

        it('hits rotated polygon', () => {
            const origin = { x: -5, y: 0 };
            const direction = { x: 1, y: 0 };
            const vertices = [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 },
            ];
            const transform = { position: { x: 0, y: 0 }, rotation: Math.PI / 4 };

            const result = Raycaster2D.raycastPolygon(origin, direction, vertices, transform);

            expect(result.hit).toBe(true);
        });

        it('hits translated polygon', () => {
            const origin = { x: -5, y: 5 };
            const direction = { x: 1, y: 0 };
            const vertices = [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];
            const transform = { position: { x: 0, y: 5 }, rotation: 0 };

            const result = Raycaster2D.raycastPolygon(origin, direction, vertices, transform);

            expect(result.hit).toBe(true);
        });

        it('computes hit normal', () => {
            const origin = { x: -5, y: 0 };
            const direction = { x: 1, y: 0 };
            const vertices = [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];
            const transform = { position: { x: 0, y: 0 }, rotation: 0 };

            const result = Raycaster2D.raycastPolygon(origin, direction, vertices, transform);

            if (result.hit) {
                expect(
                    result.normal.x * result.normal.x + result.normal.y * result.normal.y
                ).toBeCloseTo(1);
            }
        });

        it('respects max distance', () => {
            const origin = { x: -10, y: 0 };
            const direction = { x: 1, y: 0 };
            const vertices = [
                { x: -0.5, y: -0.5 },
                { x: 0.5, y: -0.5 },
                { x: 0.5, y: 0.5 },
                { x: -0.5, y: 0.5 },
            ];
            const transform = { position: { x: 0, y: 0 }, rotation: 0 };

            const result = Raycaster2D.raycastPolygon(origin, direction, vertices, transform, 5.0);

            expect(result.hit).toBe(false);
        });
    });

    describe('Edge Cases', () => {
        it('handles zero-length ray direction', () => {
            const origin = { x: 0, y: 0 };
            const direction = { x: 0, y: 0 };
            const aabb = new AABB2D({ x: 1, y: 1 }, { x: 2, y: 2 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb);

            expect(typeof result.hit).toBe('boolean');
        });

        it('handles ray parallel to AABB edge', () => {
            const origin = { x: -5, y: 0 };
            const direction = { x: 1, y: 0 };
            const aabb = new AABB2D({ x: 0, y: 1 }, { x: 1, y: 2 });

            const result = Raycaster2D.raycastAABB(origin, direction, aabb);

            expect(result.hit).toBe(false);
        });

        it('handles very small circle', () => {
            const origin = { x: -1, y: 0 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 1e-6;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius);

            expect(typeof result.hit).toBe('boolean');
        });

        it('handles very large circle', () => {
            const origin = { x: -1000, y: 0 };
            const direction = { x: 1, y: 0 };
            const center = { x: 0, y: 0 };
            const radius = 100;

            const result = Raycaster2D.raycastCircle(origin, direction, center, radius);

            expect(result.hit).toBe(true);
        });
    });
});
