import { describe, it, expect } from 'vitest';
import { RayCast3D } from '../../components/raycast3d';

describe('RayCast3D', () => {
    function create(config?: any) { return new RayCast3D(config); }

    describe('default state', () => {
        it('has default direction (0, -1, 0)', () => {
            const d = create().direction;
            expect(d.x).toBe(0); expect(d.y).toBe(-1); expect(d.z).toBe(0);
        });
        it('has default maxDistance 100', () => { expect(create().maxDistance).toBe(100); });
        it('has default layerMask 0xffffffff', () => { expect(create().layerMask).toBe(0xffffffff); });
        it('has default queryTriggerInteraction "use-global"', () => {
            expect(create().queryTriggerInteraction).toBe('use-global');
        });
        it('has debugDraw false', () => { expect(create().debugDraw).toBe(false); });
        it('has no hit initially', () => { expect(create().hasHit).toBe(false); });
        it('has hitPoint null', () => { expect(create().hitPoint).toBeNull(); });
        it('has hitNormal null', () => { expect(create().hitNormal).toBeNull(); });
        it('has hitDistance 0', () => { expect(create().hitDistance).toBe(0); });
        it('has hitEntityUid null', () => { expect(create().hitEntityUid).toBeNull(); });
        it('has lastHit null', () => { expect(create().lastHit).toBeNull(); });
    });

    describe('direction', () => {
        it('sets and normalizes direction', () => {
            const r = create();
            r.direction = { x: 3, y: 0, z: 0 };
            expect(r.direction.x).toBeCloseTo(1, 5);
            expect(r.direction.y).toBeCloseTo(0, 5);
        });
        it('accepts custom direction in constructor', () => {
            const r = create({ direction: { x: 1, y: 0, z: 0 } });
            expect(r.direction.x).toBeCloseTo(1, 5);
        });
    });

    describe('maxDistance', () => {
        it('sets maxDistance', () => {
            const r = create(); r.maxDistance = 50;
            expect(r.maxDistance).toBe(50);
        });
        it('clamps minimum to 0.001', () => {
            const r = create(); r.maxDistance = 0;
            expect(r.maxDistance).toBe(0.001);
        });
        it('accepts maxDistance in constructor', () => {
            const r = create({ maxDistance: 10 });
            expect(r.maxDistance).toBe(10);
        });
    });

    describe('layerMask', () => {
        it('sets layerMask', () => {
            const r = create(); r.layerMask = 0x01;
            expect(r.layerMask).toBe(0x01);
        });
        it('accepts layerMask in constructor', () => {
            const r = create({ layerMask: 0x02 });
            expect(r.layerMask).toBe(0x02);
        });
    });

    describe('layer operations', () => {
        it('includesLayer checks bit', () => {
            const r = create();
            r.layerMask = 0x05; // bits 0 and 2
            expect(r.includesLayer(0)).toBe(true);
            expect(r.includesLayer(1)).toBe(false);
            expect(r.includesLayer(2)).toBe(true);
        });
        it('addLayer sets bit', () => {
            const r = create();
            r.layerMask = 0;
            r.addLayer(3);
            expect(r.includesLayer(3)).toBe(true);
        });
        it('removeLayer clears bit', () => {
            const r = create();
            r.layerMask = 0xffffffff;
            r.removeLayer(5);
            expect(r.includesLayer(5)).toBe(false);
        });
    });

    describe('queryTriggerInteraction', () => {
        it('sets to "ignore"', () => {
            const r = create();
            r.queryTriggerInteraction = 'ignore';
            expect(r.queryTriggerInteraction).toBe('ignore');
        });
        it('sets to "collide"', () => {
            const r = create();
            r.queryTriggerInteraction = 'collide';
            expect(r.queryTriggerInteraction).toBe('collide');
        });
    });

    describe('debug properties', () => {
        it('toggles debugDraw', () => {
            const r = create(); r.debugDraw = true;
            expect(r.debugDraw).toBe(true);
        });
        it('sets debugColor', () => {
            const r = create();
            r.debugColor = [0, 1, 0];
            expect(r.debugColor.x).toBe(0);
            expect(r.debugColor.y).toBe(1);
            expect(r.debugColor.z).toBe(0);
        });
        it('sets debugHitColor', () => {
            const r = create();
            r.debugHitColor = [1, 0, 0];
            expect(r.debugHitColor.x).toBe(1);
        });
    });

    describe('hit result', () => {
        it('cast returns false with no hit', () => {
            expect(create().cast()).toBe(false);
        });
        it('setHitResult updates lastHit', () => {
            const r = create();
            const { Vec3 } = require('@axrone/numeric');
            const hit = {
                hit: true,
                point: new Vec3(1, 2, 3),
                normal: new Vec3(0, 1, 0),
                distance: 5,
                colliderId: 42,
                entityUid: 'target',
            };
            r.setHitResult(hit);
            expect(r.hasHit).toBe(true);
            expect(r.hitPoint).not.toBeNull();
            expect(r.hitPoint!.x).toBeCloseTo(1, 5);
            expect(r.hitPoint!.y).toBeCloseTo(2, 5);
            expect(r.hitPoint!.z).toBeCloseTo(3, 5);
            expect(r.hitDistance).toBe(5);
            expect(r.hitEntityUid).toBe('target');
        });
        it('clearHit resets hit state', () => {
            const r = create();
            const { Vec3 } = require('@axrone/numeric');
            r.setHitResult({
                hit: true,
                point: new Vec3(0, 0, 0),
                normal: new Vec3(0, 1, 0),
                distance: 1,
                colliderId: 0,
                entityUid: null,
            });
            expect(r.hasHit).toBe(true);
            r.clearHit();
            expect(r.hasHit).toBe(false);
            expect(r.hitPoint).toBeNull();
        });
    });

    describe('ray geometry', () => {
        it('getRayOrigin returns zero without transform', () => {
            const r = create();
            const origin = r.getRayOrigin();
            expect(origin.x).toBe(0); expect(origin.y).toBe(0); expect(origin.z).toBe(0);
        });
        it('getWorldDirection returns direction without transform', () => {
            const r = create({ direction: { x: 1, y: 0, z: 0 } });
            const dir = r.getWorldDirection();
            expect(dir.x).toBeCloseTo(1, 5);
        });
        it('getRayEndPoint computes origin + direction * maxDistance', () => {
            const r = create({ direction: { x: 0, y: -1, z: 0 }, maxDistance: 10 });
            const end = r.getRayEndPoint();
            // Without transform, origin is (0,0,0), direction is (0,-1,0), maxDistance=10
            expect(end.x).toBeCloseTo(0, 5);
            expect(end.y).toBeCloseTo(-10, 5);
            expect(end.z).toBeCloseTo(0, 5);
        });
    });

    describe('serialization', () => {
        it('serialize returns config object', () => {
            const r = create({ direction: { x: 1, y: 0, z: 0 }, maxDistance: 25 });
            const s = r.serialize();
            expect(s.maxDistance).toBe(25);
            expect(Array.isArray(s.direction)).toBe(true);
        });
        it('deserialize restores config', () => {
            const r = create();
            r.deserialize({
                direction: [0, 0, -1],
                maxDistance: 50,
                layerMask: 0x10,
                queryTriggerInteraction: 'ignore',
                debugDraw: true,
            });
            expect(r.direction.z).toBeCloseTo(-1, 5);
            expect(r.maxDistance).toBe(50);
            expect(r.layerMask).toBe(0x10);
            expect(r.queryTriggerInteraction).toBe('ignore');
            expect(r.debugDraw).toBe(true);
        });
    });
});
