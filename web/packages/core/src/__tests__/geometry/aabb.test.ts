import { describe, it, expect, beforeEach } from 'vitest';
import { Vec2, Vec3 } from '../../../../numeric/src';
import { AABB2D, AABB3D, AABB, AABBError } from '../../geometry/aabb';

describe('AABB Core Functionality', () => {
    describe('AABB2D Basic Operations', () => {
        describe('Constructor and Properties', () => {
            it('should create an AABB2D with default values', () => {
                const aabb = new AABB2D();
                expect(aabb.min.x).toBe(0);
                expect(aabb.min.y).toBe(0);
                expect(aabb.max.x).toBe(0);
                expect(aabb.max.y).toBe(0);
                expect(aabb.center.x).toBe(0);
                expect(aabb.center.y).toBe(0);

                expect(aabb.isEmpty).toBe(false);
            });

            it('should create an AABB2D with specified min and max', () => {
                const min = Vec2.create(1, 2);
                const max = Vec2.create(3, 4);
                const aabb = new AABB2D(min, max);

                expect(aabb.min.x).toBe(1);
                expect(aabb.min.y).toBe(2);
                expect(aabb.max.x).toBe(3);
                expect(aabb.max.y).toBe(4);
                expect(aabb.center.x).toBe(2);
                expect(aabb.center.y).toBe(3);
                expect(aabb.extents.x).toBe(1);
                expect(aabb.extents.y).toBe(1);
                expect(aabb.isEmpty).toBe(false);
            });

            it('should report as empty when min > max', () => {
                const min = Vec2.create(3, 4);
                const max = Vec2.create(1, 2);
                const aabb = new AABB2D(min, max);
                expect(aabb.isEmpty).toBe(true);
            });

            it('should calculate size correctly', () => {
                const aabb = new AABB2D(Vec2.create(1, 2), Vec2.create(4, 6));
                const size = aabb.size;
                expect(size.x).toBe(3);
                expect(size.y).toBe(4);
            });

            it('should calculate volume correctly', () => {
                const aabb = new AABB2D(Vec2.create(0, 0), Vec2.create(3, 4));
                expect(aabb.volume).toBe(12);
            });

            it('should calculate surface area correctly', () => {
                const aabb = new AABB2D(Vec2.create(0, 0), Vec2.create(3, 4));
                expect(aabb.surfaceArea).toBe(14);
            });

            it('should have correct dimensions', () => {
                const aabb = new AABB2D();
                expect(aabb.dimensions).toBe(2);
            });
        });

        describe('Point and AABB Operations', () => {
            it('should correctly check point containment', () => {
                const aabb = new AABB2D(Vec2.create(0, 0), Vec2.create(4, 4));

                expect(aabb.containsPoint(Vec2.create(2, 2))).toBe(true);
                expect(aabb.containsPoint(Vec2.create(0, 0))).toBe(true);
                expect(aabb.containsPoint(Vec2.create(4, 4))).toBe(true);
                expect(aabb.containsPoint(Vec2.create(-1, 2))).toBe(false);
                expect(aabb.containsPoint(Vec2.create(5, 2))).toBe(false);
            });

            it('should correctly check AABB containment', () => {
                const aabb1 = new AABB2D(Vec2.create(0, 0), Vec2.create(4, 4));
                const aabb2 = new AABB2D(Vec2.create(1, 1), Vec2.create(3, 3));
                const aabb3 = new AABB2D(Vec2.create(2, 2), Vec2.create(6, 6));

                expect(aabb1.containsAABB(aabb2)).toBe(true);
                expect(aabb1.containsAABB(aabb3)).toBe(false);
                expect(aabb2.containsAABB(aabb1)).toBe(false);
            });

            it('should correctly check AABB intersections', () => {
                const aabb1 = new AABB2D(Vec2.create(0, 0), Vec2.create(4, 4));
                const aabb2 = new AABB2D(Vec2.create(2, 2), Vec2.create(6, 6));
                const aabb3 = new AABB2D(Vec2.create(5, 5), Vec2.create(7, 7));

                expect(aabb1.intersectsAABB(aabb2)).toBe(true);
                expect(aabb1.intersectsAABB(aabb3)).toBe(false);
            });
        });

        describe('Copy and Clone Operations', () => {
            it('should clone correctly', () => {
                const original = new AABB2D(Vec2.create(1, 2), Vec2.create(3, 4));
                const clone = original.clone();

                expect(clone).not.toBe(original);
                expect(clone.min.x).toBe(original.min.x);
                expect(clone.min.y).toBe(original.min.y);
                expect(clone.max.x).toBe(original.max.x);
                expect(clone.max.y).toBe(original.max.y);
            });

            it('should copy correctly', () => {
                const source = new AABB2D(Vec2.create(1, 2), Vec2.create(3, 4));
                const target = new AABB2D();

                target.copy(source);

                expect(target.min.x).toBe(source.min.x);
                expect(target.min.y).toBe(source.min.y);
                expect(target.max.x).toBe(source.max.x);
                expect(target.max.y).toBe(source.max.y);
            });
        });
    });

    describe('AABB3D Basic Operations', () => {
        describe('Constructor and Properties', () => {
            it('should create an AABB3D with default values', () => {
                const aabb = new AABB3D();
                expect(aabb.min.x).toBe(0);
                expect(aabb.min.y).toBe(0);
                expect(aabb.min.z).toBe(0);
                expect(aabb.max.x).toBe(0);
                expect(aabb.max.y).toBe(0);
                expect(aabb.max.z).toBe(0);
                expect(aabb.isEmpty).toBe(false);
            });

            it('should create an AABB3D with specified min and max', () => {
                const min = Vec3.create(1, 2, 3);
                const max = Vec3.create(4, 5, 6);
                const aabb = new AABB3D(min, max);

                expect(aabb.min.x).toBe(1);
                expect(aabb.min.y).toBe(2);
                expect(aabb.min.z).toBe(3);
                expect(aabb.max.x).toBe(4);
                expect(aabb.max.y).toBe(5);
                expect(aabb.max.z).toBe(6);
                expect(aabb.center.x).toBe(2.5);
                expect(aabb.center.y).toBe(3.5);
                expect(aabb.center.z).toBe(4.5);
                expect(aabb.isEmpty).toBe(false);
            });

            it('should calculate volume correctly', () => {
                const aabb = new AABB3D(Vec3.create(0, 0, 0), Vec3.create(2, 3, 4));
                expect(aabb.volume).toBe(24);
            });

            it('should have correct dimensions', () => {
                const aabb = new AABB3D();
                expect(aabb.dimensions).toBe(3);
            });
        });
    });

    describe('Factory Functions', () => {
        describe('AABB.create2D and AABB.create3D', () => {
            it('should create 2D AABB from min/max', () => {
                const min = Vec2.create(1, 2);
                const max = Vec2.create(3, 4);
                const aabb = AABB.create2D(min, max);

                expect(aabb.min.x).toBe(1);
                expect(aabb.min.y).toBe(2);
                expect(aabb.max.x).toBe(3);
                expect(aabb.max.y).toBe(4);
            });

            it('should create 3D AABB from min/max', () => {
                const min = Vec3.create(1, 2, 3);
                const max = Vec3.create(4, 5, 6);
                const aabb = AABB.create3D(min, max);

                expect(aabb.min.x).toBe(1);
                expect(aabb.min.y).toBe(2);
                expect((aabb.min as any).z).toBe(3);
                expect(aabb.max.x).toBe(4);
                expect(aabb.max.y).toBe(5);
                expect((aabb.max as any).z).toBe(6);
            });

            it('should handle swapped min/max correctly', () => {
                const min = Vec2.create(3, 4);
                const max = Vec2.create(1, 2);
                const aabb = AABB.create2D(min, max);

                expect(aabb.min.x).toBe(3);
                expect(aabb.max.x).toBe(1);
                expect(aabb.isEmpty).toBe(true);
            });
        });

        describe('AABB.fromCenterAndExtents', () => {
            it('should create AABB from center and extents', () => {
                const center = Vec2.create(2, 3);
                const extents = Vec2.create(2, 3); // half size
                const aabb = AABB.fromCenterAndExtents2D(center, extents);

                expect(aabb.min.x).toBe(0);
                expect(aabb.min.y).toBe(0);
                expect(aabb.max.x).toBe(4);
                expect(aabb.max.y).toBe(6);
                expect(aabb.center.x).toBe(2);
                expect(aabb.center.y).toBe(3);
            });
        });

        describe('AABB.fromPoints', () => {
            it('should create AABB from array of 2D points', () => {
                const points = [
                    Vec2.create(1, 1),
                    Vec2.create(3, 2),
                    Vec2.create(0, 4),
                    Vec2.create(2, 0),
                ];
                const aabb = AABB.fromPoints2D(points);

                expect(aabb.min.x).toBe(0);
                expect(aabb.min.y).toBe(0);
                expect(aabb.max.x).toBe(3);
                expect(aabb.max.y).toBe(4);
            });

            it('should create AABB from array of 3D points', () => {
                const points = [
                    Vec3.create(1, 1, 1),
                    Vec3.create(3, 2, 0),
                    Vec3.create(0, 4, 3),
                    Vec3.create(2, 0, 2),
                ];
                const aabb = AABB.fromPoints3D(points);

                expect(aabb.min.x).toBe(0);
                expect(aabb.min.y).toBe(0);
                expect(aabb.min.z).toBe(0);
                expect(aabb.max.x).toBe(3);
                expect(aabb.max.y).toBe(4);
                expect(aabb.max.z).toBe(3);
            });
        });
    });

    describe('Error Handling', () => {
        it('should handle AABBError correctly', () => {
            expect(() => {
                throw new AABBError('Test error');
            }).toThrow('Test error');

            expect(() => {
                throw new AABBError('Test error');
            }).toThrow(AABBError);
        });
    });
});
