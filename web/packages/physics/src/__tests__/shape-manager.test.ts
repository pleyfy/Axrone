import { describe, it, expect, beforeEach } from 'vitest';
import { ShapeManager2D } from '@axrone/physics';
import { ShapeType } from '@axrone/physics';
import type { IVec2Like } from '@axrone/numeric';

describe('ShapeManager2D', () => {
    let manager: ShapeManager2D;
    const bodyId = 1 as any;

    beforeEach(() => {
        manager = new ShapeManager2D(128);
    });

    describe('Construction', () => {
        it('initializes with correct capacity', () => {
            expect(manager.shapeCount).toBe(0);
        });

        it('initializes with default capacity', () => {
            const defaultManager = new ShapeManager2D();
            expect(defaultManager).toBeDefined();
        });
    });

    describe('Circle Shapes', () => {
        it('creates circle with radius', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 2 });
            expect(manager.hasShape(shapeId)).toBe(true);
            expect(manager.shapeCount).toBe(1);
            expect(manager.getShapeType(shapeId)).toBe(ShapeType.Circle);
        });

        it('creates circle with center', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1.5,
                center: { x: 1, y: 2 },
            });
            const data = manager.getCircleData(shapeId);
            expect(data.center.x).toBe(1);
            expect(data.center.y).toBe(2);
            expect(data.radius).toBe(1.5);
        });

        it('creates circle with default center', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1 });
            const data = manager.getCircleData(shapeId);
            expect(data.center.x).toBe(0);
            expect(data.center.y).toBe(0);
        });

        it('gets circle data', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 3,
                center: { x: 5, y: 6 },
            });
            const data = manager.getCircleData(shapeId);
            expect(data.radius).toBe(3);
            expect(data.center.x).toBe(5);
            expect(data.center.y).toBe(6);
        });

        it('computes circle mass data', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 2 });
            const massData = manager.computeCircleMassData(shapeId, 1 as any);
            expect(massData.mass).toBeGreaterThan(0);
            expect(massData.inertia).toBeGreaterThan(0);
            expect(massData.inverseMass).toBeGreaterThan(0);
            expect(massData.inverseInertia).toBeGreaterThan(0);
        });

        it('throws on getting non-existent circle', () => {
            expect(() => {
                manager.getCircleData(9999 as any);
            }).toThrow();
        });
    });

    describe('Box Shapes', () => {
        it('creates box with dimensions', () => {
            const shapeId = manager.createBox(bodyId, {
                halfWidth: 2,
                halfHeight: 3,
            });
            expect(manager.getShapeType(shapeId)).toBe(ShapeType.Box);
        });

        it('creates box with center', () => {
            const shapeId = manager.createBox(bodyId, {
                halfWidth: 1,
                halfHeight: 1,
                center: { x: 5, y: 10 },
            });
            const data = manager.getBoxData(shapeId);
            expect(data.center.x).toBe(5);
            expect(data.center.y).toBe(10);
        });

        it('creates box with rotation', () => {
            const shapeId = manager.createBox(bodyId, {
                halfWidth: 1,
                halfHeight: 1,
                rotation: Math.PI / 4,
            });
            const data = manager.getBoxData(shapeId);
            expect(data.rotation).toBeCloseTo(Math.PI / 4);
        });

        it('gets box data', () => {
            const shapeId = manager.createBox(bodyId, {
                halfWidth: 3,
                halfHeight: 4,
                center: { x: 1, y: 2 },
                rotation: 0.5,
            });
            const data = manager.getBoxData(shapeId);
            expect(data.halfWidth).toBe(3);
            expect(data.halfHeight).toBe(4);
            expect(data.center.x).toBe(1);
            expect(data.center.y).toBe(2);
            expect(data.rotation).toBe(0.5);
        });

        it('computes box mass data', () => {
            const shapeId = manager.createBox(bodyId, {
                halfWidth: 2,
                halfHeight: 3,
            });
            const massData = manager.computeBoxMassData(shapeId, 1 as any);
            expect(massData.mass).toBeGreaterThan(0);
            expect(massData.inertia).toBeGreaterThan(0);
        });

        it('throws on getting non-existent box', () => {
            expect(() => {
                manager.getBoxData(9999 as any);
            }).toThrow();
        });
    });

    describe('Polygon Shapes', () => {
        it('creates triangle', () => {
            const shapeId = manager.createPolygon(bodyId, {
                vertices: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 0.5, y: 1 },
                ],
            });
            expect(manager.getShapeType(shapeId)).toBe(ShapeType.Polygon);
        });

        it('creates square polygon', () => {
            const shapeId = manager.createPolygon(bodyId, {
                vertices: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 1 },
                    { x: 0, y: 1 },
                ],
            });
            const data = manager.getPolygonData(shapeId);
            expect(data.vertices).toHaveLength(4);
        });

        it('creates pentagon', () => {
            const shapeId = manager.createPolygon(bodyId, {
                vertices: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1.5, y: 0.5 },
                    { x: 1, y: 1 },
                    { x: 0, y: 1 },
                ],
            });
            const data = manager.getPolygonData(shapeId);
            expect(data.vertices).toHaveLength(5);
        });

        it('creates max vertex polygon', () => {
            const vertices = [];
            for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2;
                vertices.push({
                    x: Math.cos(angle),
                    y: Math.sin(angle),
                });
            }
            const shapeId = manager.createPolygon(bodyId, { vertices });
            const data = manager.getPolygonData(shapeId);
            expect(data.vertices).toHaveLength(8);
        });

        it('gets polygon vertices', () => {
            const vertices = [
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 2 },
            ];
            const shapeId = manager.createPolygon(bodyId, { vertices });
            const data = manager.getPolygonData(shapeId);
            expect(data.vertices[0].x).toBe(0);
            expect(data.vertices[1].x).toBe(2);
            expect(data.vertices[2].y).toBe(2);
        });

        it('throws on too few vertices', () => {
            expect(() => {
                manager.createPolygon(bodyId, {
                    vertices: [
                        { x: 0, y: 0 },
                        { x: 1, y: 0 },
                    ],
                });
            }).toThrow();
        });

        it('throws on too many vertices', () => {
            const vertices: Readonly<IVec2Like>[] = [];
            for (let i = 0; i < 10; i++) {
                vertices.push({ x: i, y: i });
            }
            expect(() => {
                manager.createPolygon(bodyId, { vertices });
            }).toThrow();
        });
    });

    describe('Segment Shapes', () => {
        it('creates segment', () => {
            const shapeId = manager.createSegment(bodyId, {
                start: { x: 0, y: 0 },
                end: { x: 1, y: 1 },
            });
            expect(manager.getShapeType(shapeId)).toBe(ShapeType.Segment);
        });

        it('creates horizontal segment', () => {
            const shapeId = manager.createSegment(bodyId, {
                start: { x: 0, y: 5 },
                end: { x: 10, y: 5 },
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('creates vertical segment', () => {
            const shapeId = manager.createSegment(bodyId, {
                start: { x: 3, y: 0 },
                end: { x: 3, y: 10 },
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });
    });

    describe('Capsule Shapes', () => {
        it('creates capsule', () => {
            const shapeId = manager.createCapsule(bodyId, {
                radius: 1,
                length: 4,
            });
            expect(manager.getShapeType(shapeId)).toBe(ShapeType.Capsule);
        });

        it('creates capsule with center', () => {
            const shapeId = manager.createCapsule(bodyId, {
                radius: 0.5,
                length: 2,
                center: { x: 1, y: 2 },
            });
            const data = manager.getCapsuleData(shapeId);
            expect(data.radius).toBe(0.5);
        });

        it('gets capsule data', () => {
            const shapeId = manager.createCapsule(bodyId, {
                radius: 1.5,
                length: 6,
                center: { x: 0, y: 0 },
            });
            const data = manager.getCapsuleData(shapeId);
            expect(data.radius).toBe(1.5);
            expect(data.p1.x).toBeLessThan(data.p2.x);
        });

        it('throws on getting non-existent capsule', () => {
            expect(() => {
                manager.getCapsuleData(9999 as any);
            }).toThrow();
        });
    });

    describe('Shape Destruction', () => {
        it('destroys circle shape', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1 });
            expect(manager.shapeCount).toBe(1);
            manager.destroyShape(shapeId);
            expect(manager.shapeCount).toBe(0);
            expect(manager.hasShape(shapeId)).toBe(false);
        });

        it('destroys box shape', () => {
            const shapeId = manager.createBox(bodyId, {
                halfWidth: 1,
                halfHeight: 1,
            });
            manager.destroyShape(shapeId);
            expect(manager.hasShape(shapeId)).toBe(false);
        });

        it('destroys multiple shapes', () => {
            const id1 = manager.createCircle(bodyId, { radius: 1 });
            const id2 = manager.createBox(bodyId, { halfWidth: 1, halfHeight: 1 });
            const id3 = manager.createPolygon(bodyId, {
                vertices: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 0.5, y: 1 },
                ],
            });

            manager.destroyShape(id1);
            manager.destroyShape(id2);
            manager.destroyShape(id3);
            expect(manager.shapeCount).toBe(0);
        });

        it('throws on destroying non-existent shape', () => {
            expect(() => {
                manager.destroyShape(9999 as any);
            }).toThrow();
        });
    });

    describe('Shape Queries', () => {
        it('gets shapes for body', () => {
            const bodyId2 = 2 as any;
            const id1 = manager.createCircle(bodyId, { radius: 1 });
            const id2 = manager.createBox(bodyId, { halfWidth: 1, halfHeight: 1 });
            const id3 = manager.createCircle(bodyId2, { radius: 1 });

            const shapes = manager.getShapesForBody(bodyId);
            expect(shapes).toHaveLength(2);
            expect(shapes).toContain(id1);
            expect(shapes).toContain(id2);
            expect(shapes).not.toContain(id3);
        });

        it('returns empty array for body with no shapes', () => {
            const shapes = manager.getShapesForBody(999 as any);
            expect(shapes).toHaveLength(0);
        });

        it('gets body ID from shape', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1 });
            expect(manager.getBodyId(shapeId)).toBe(bodyId);
        });

        it('checks shape existence', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1 });
            expect(manager.hasShape(shapeId)).toBe(true);
            expect(manager.hasShape(9999 as any)).toBe(false);
        });

        it('gets shape type', () => {
            const circleId = manager.createCircle(bodyId, { radius: 1 });
            const boxId = manager.createBox(bodyId, { halfWidth: 1, halfHeight: 1 });
            const polyId = manager.createPolygon(bodyId, {
                vertices: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 0.5, y: 1 },
                ],
            });

            expect(manager.getShapeType(circleId)).toBe(ShapeType.Circle);
            expect(manager.getShapeType(boxId)).toBe(ShapeType.Box);
            expect(manager.getShapeType(polyId)).toBe(ShapeType.Polygon);
        });
    });

    describe('Material Properties', () => {
        it('creates shape with friction', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                friction: 0.5 as any,
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('creates shape with restitution', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                restitution: 0.8 as any,
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('creates shape with density', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                density: 2 as any,
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('creates shape with material', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                material: {
                    friction: 0.3 as any,
                    restitution: 0.5 as any,
                    density: 1.5 as any,
                },
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });
    });

    describe('Sensor Shapes', () => {
        it('creates sensor shape', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                isSensor: true,
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('creates non-sensor shape by default', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1 });
            expect(manager.hasShape(shapeId)).toBe(true);
        });
    });

    describe('Collision Filtering', () => {
        it('creates shape with collision filter', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                filter: {
                    categoryBits: 0x0001 as any,
                    maskBits: 0x0002 as any,
                    groupIndex: 1,
                },
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('uses default filter when not specified', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1 });
            expect(manager.hasShape(shapeId)).toBe(true);
        });
    });

    describe('User Data', () => {
        it('stores user data', () => {
            const userData = { id: 123, name: 'test' };
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                userData,
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('stores null user data', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                userData: null,
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });
    });

    describe('Capacity Management', () => {
        it('throws when capacity exceeded', () => {
            const smallManager = new ShapeManager2D(2);
            smallManager.createCircle(bodyId, { radius: 1 });
            smallManager.createCircle(bodyId, { radius: 1 });
            expect(() => {
                smallManager.createCircle(bodyId, { radius: 1 });
            }).toThrow();
        });

        it('handles many shapes', () => {
            for (let i = 0; i < 50; i++) {
                manager.createCircle(bodyId, { radius: 1 });
            }
            expect(manager.shapeCount).toBe(50);
        });
    });

    describe('Mass Data Calculations', () => {
        it('computes mass data with density', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1 });
            const massData = manager.computeCircleMassData(shapeId, 2 as any);
            expect(massData.mass).toBeGreaterThan(0);
            expect(massData.inertia).toBeGreaterThan(0);
        });

        it('computes box mass data', () => {
            const shapeId = manager.createBox(bodyId, {
                halfWidth: 2,
                halfHeight: 1,
            });
            const massData = manager.computeBoxMassData(shapeId, 1 as any);
            expect(massData.mass).toBeCloseTo(8);
            expect(massData.inertia).toBeGreaterThan(0);
        });

        it('computes zero mass for zero density', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1 });
            const massData = manager.computeCircleMassData(shapeId, 0 as any);
            expect(massData.mass).toBe(0);
            expect(massData.inverseMass).toBe(0);
        });
    });

    describe('Disposal', () => {
        it('disposes manager', () => {
            manager[Symbol.dispose]();
        });

        it('throws when using after disposal', () => {
            manager[Symbol.dispose]();
            expect(() => {
                manager.createCircle(bodyId, { radius: 1 });
            }).toThrow();
        });

        it('allows double disposal', () => {
            manager[Symbol.dispose]();
            manager[Symbol.dispose]();
        });
    });

    describe('Edge Cases', () => {
        it('handles very small shapes', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1e-6 });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('handles very large shapes', () => {
            const shapeId = manager.createCircle(bodyId, { radius: 1e6 });
            expect(manager.hasShape(shapeId)).toBe(true);
        });

        it('handles extreme coordinates', () => {
            const shapeId = manager.createCircle(bodyId, {
                radius: 1,
                center: { x: 1e10, y: -1e10 },
            });
            const data = manager.getCircleData(shapeId);
            expect(data.center.x).toBe(1e10);
            expect(data.center.y).toBe(-1e10);
        });

        it('handles zero dimensions', () => {
            const shapeId = manager.createBox(bodyId, {
                halfWidth: 0.001,
                halfHeight: 0.001,
            });
            expect(manager.hasShape(shapeId)).toBe(true);
        });
    });
});

