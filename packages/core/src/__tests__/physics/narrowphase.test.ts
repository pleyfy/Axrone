import { describe, it, expect, beforeEach } from 'vitest';
import { Narrowphase2D } from '../../physics/core/narrowphase';
import { ShapeManager2D } from '../../physics/core/shape-manager';
import { ShapeType } from '../../physics/types';

describe('Narrowphase2D', () => {
    let narrowphase: Narrowphase2D;
    let shapeManager: ShapeManager2D;
    const bodyIdA = 1 as any;
    const bodyIdB = 2 as any;

    beforeEach(() => {
        narrowphase = new Narrowphase2D();
        shapeManager = new ShapeManager2D(128);
    });

    describe('Circle-Circle Collision', () => {
        it('detects overlapping circles', () => {
            const circleA = shapeManager.createCircle(bodyIdA, { radius: 1, center: { x: 0, y: 0 } });
            const circleB = shapeManager.createCircle(bodyIdB, { radius: 1, center: { x: 0, y: 0 } });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 1, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(circleA, circleB, ShapeType.Circle, ShapeType.Circle, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBeGreaterThan(0);
        });

        it('detects separated circles', () => {
            const circleA = shapeManager.createCircle(bodyIdA, { radius: 1 });
            const circleB = shapeManager.createCircle(bodyIdB, { radius: 1 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 10, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(circleA, circleB, ShapeType.Circle, ShapeType.Circle, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBe(0);
        });

        it('computes collision normal', () => {
            const circleA = shapeManager.createCircle(bodyIdA, { radius: 1 });
            const circleB = shapeManager.createCircle(bodyIdB, { radius: 1 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 1.5, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(circleA, circleB, ShapeType.Circle, ShapeType.Circle, shapeManager, ctx, manifold);

            if (manifold.pointCount > 0) {
                expect(manifold.normal.x * manifold.normal.x + manifold.normal.y * manifold.normal.y).toBeCloseTo(1);
            }
        });
    });

    describe('Box-Box Collision', () => {
        it('detects overlapping boxes', () => {
            const boxA = shapeManager.createBox(bodyIdA, { halfWidth: 1, halfHeight: 1 });
            const boxB = shapeManager.createBox(bodyIdB, { halfWidth: 1, halfHeight: 1 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 1, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(boxA, boxB, ShapeType.Box, ShapeType.Box, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBeGreaterThan(0);
        });

        it('detects separated boxes', () => {
            const boxA = shapeManager.createBox(bodyIdA, { halfWidth: 1, halfHeight: 1 });
            const boxB = shapeManager.createBox(bodyIdB, { halfWidth: 1, halfHeight: 1 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 10, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(boxA, boxB, ShapeType.Box, ShapeType.Box, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBe(0);
        });
    });

    describe('Circle-Box Collision', () => {
        it('detects circle overlapping box', () => {
            const circle = shapeManager.createCircle(bodyIdA, { radius: 1 });
            const box = shapeManager.createBox(bodyIdB, { halfWidth: 1, halfHeight: 1 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 1.5, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(circle, box, ShapeType.Circle, ShapeType.Box, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBeGreaterThan(0);
        });

        it('detects circle separated from box', () => {
            const circle = shapeManager.createCircle(bodyIdA, { radius: 1 });
            const box = shapeManager.createBox(bodyIdB, { halfWidth: 1, halfHeight: 1 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 10, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(circle, box, ShapeType.Circle, ShapeType.Box, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBe(0);
        });
    });

    describe('Polygon-Polygon Collision', () => {
        it('detects overlapping triangles', () => {
            const triA = shapeManager.createPolygon(bodyIdA, {
                vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }],
            });
            const triB = shapeManager.createPolygon(bodyIdB, {
                vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1 }],
            });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 0.5, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(triA, triB, ShapeType.Polygon, ShapeType.Polygon, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBeGreaterThan(0);
        });

        it('detects separated polygons', () => {
            const polyA = shapeManager.createPolygon(bodyIdA, {
                vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
            });
            const polyB = shapeManager.createPolygon(bodyIdB, {
                vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
            });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 10, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(polyA, polyB, ShapeType.Polygon, ShapeType.Polygon, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBe(0);
        });
    });

    describe('Circle-Polygon Collision', () => {
        it('detects circle overlapping polygon', () => {
            const circle = shapeManager.createCircle(bodyIdA, { radius: 1 });
            const poly = shapeManager.createPolygon(bodyIdB, {
                vertices: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 2 }],
            });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 1, y: 0.5 }, rotation: 0 },
                transformB: { position: { x: 0, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(circle, poly, ShapeType.Circle, ShapeType.Polygon, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBeGreaterThan(0);
        });
    });

    describe('Capsule-Capsule Collision', () => {
        it('detects overlapping capsules', () => {
            const capA = shapeManager.createCapsule(bodyIdA, { radius: 0.5, length: 2 });
            const capB = shapeManager.createCapsule(bodyIdB, { radius: 0.5, length: 2 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 1, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(capA, capB, ShapeType.Capsule, ShapeType.Capsule, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBeGreaterThan(0);
        });

        it('detects separated capsules', () => {
            const capA = shapeManager.createCapsule(bodyIdA, { radius: 0.5, length: 2 });
            const capB = shapeManager.createCapsule(bodyIdB, { radius: 0.5, length: 2 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 10, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(capA, capB, ShapeType.Capsule, ShapeType.Capsule, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBe(0);
        });
    });

    describe('Circle-Capsule Collision', () => {
        it('detects circle overlapping capsule', () => {
            const circle = shapeManager.createCircle(bodyIdA, { radius: 1 });
            const capsule = shapeManager.createCapsule(bodyIdB, { radius: 0.5, length: 2 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 1.2, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(circle, capsule, ShapeType.Circle, ShapeType.Capsule, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBeGreaterThan(0);
        });
    });

    describe('Unsupported Collisions', () => {
        it('returns zero contacts for unsupported shape pairs', () => {
            const circle = shapeManager.createCircle(bodyIdA, { radius: 1 });
            const box = shapeManager.createBox(bodyIdB, { halfWidth: 1, halfHeight: 1 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 0, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(circle, box, ShapeType.Segment, ShapeType.Segment, shapeManager, ctx, manifold);

            expect(manifold.pointCount).toBe(0);
        });
    });

    describe('Manifold Generation', () => {
        it('generates contact points', () => {
            const boxA = shapeManager.createBox(bodyIdA, { halfWidth: 1, halfHeight: 1 });
            const boxB = shapeManager.createBox(bodyIdB, { halfWidth: 1, halfHeight: 1 });

            const ctx = {
                bodyIdA: 1,
                bodyIdB: 2,
                transformA: { position: { x: 0, y: 0 }, rotation: 0 },
                transformB: { position: { x: 1.5, y: 0 }, rotation: 0 },
            };

            const manifold = {
                pointCount: 0,
                normal: { x: 0, y: 0 },
                points: [],
            } as any;

            narrowphase.collide(boxA, boxB, ShapeType.Box, ShapeType.Box, shapeManager, ctx, manifold);

            if (manifold.pointCount > 0) {
                expect(manifold.points).toBeDefined();
            }
        });
    });
});
