import { describe, it, expect, beforeEach } from 'vitest';
import { BodyManager2D } from '../../physics/core/body-manager';
import { BodyType } from '../../physics/types';

describe('BodyManager2D', () => {
    let manager: BodyManager2D;

    beforeEach(() => {
        manager = new BodyManager2D(128);
    });

    describe('Construction and Capacity', () => {
        it('initializes with correct capacity', () => {
            expect(manager.capacity).toBe(128);
            expect(manager.bodyCount).toBe(0);
        });

        it('initializes with default capacity', () => {
            const defaultManager = new BodyManager2D();
            expect(defaultManager.capacity).toBe(1024);
        });
    });

    describe('Body Creation', () => {
        it('creates static body with default values', () => {
            const bodyId = manager.createBody({ type: BodyType.Static });
            expect(manager.hasBody(bodyId)).toBe(true);
            expect(manager.bodyCount).toBe(1);
            expect(manager.getBodyType(bodyId)).toBe(BodyType.Static);
        });

        it('creates kinematic body', () => {
            const bodyId = manager.createBody({ type: BodyType.Kinematic });
            expect(manager.getBodyType(bodyId)).toBe(BodyType.Kinematic);
        });

        it('creates dynamic body', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            expect(manager.getBodyType(bodyId)).toBe(BodyType.Dynamic);
        });

        it('creates body with position', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                position: { x: 5, y: 10 },
            });
            const pos = manager.getPosition(bodyId);
            expect(pos.x).toBe(5);
            expect(pos.y).toBe(10);
        });

        it('creates body with rotation', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                rotation: Math.PI / 4,
            });
            const rot = manager.getRotation(bodyId);
            expect(rot).toBeCloseTo(Math.PI / 4);
        });

        it('creates body with linear velocity', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                linearVelocity: { x: 2, y: 3 },
            });
            const vel = manager.getLinearVelocity(bodyId);
            expect(vel.x).toBe(2);
            expect(vel.y).toBe(3);
        });

        it('creates body with angular velocity', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                angularVelocity: 1.5,
            });
            const angVel = manager.getAngularVelocity(bodyId);
            expect(angVel).toBe(1.5);
        });

        it('creates body with awake state', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                awake: true,
            });
            expect(manager.isAwake(bodyId)).toBe(true);
        });

        it('creates body with awake false', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                awake: false,
            });
            expect(manager.isAwake(bodyId)).toBe(false);
        });

        it('increments body count', () => {
            expect(manager.bodyCount).toBe(0);
            manager.createBody({ type: BodyType.Dynamic });
            expect(manager.bodyCount).toBe(1);
            manager.createBody({ type: BodyType.Static });
            expect(manager.bodyCount).toBe(2);
        });

        it('generates unique body IDs', () => {
            const id1 = manager.createBody({ type: BodyType.Dynamic });
            const id2 = manager.createBody({ type: BodyType.Dynamic });
            const id3 = manager.createBody({ type: BodyType.Dynamic });
            expect(id1).not.toBe(id2);
            expect(id2).not.toBe(id3);
            expect(id1).not.toBe(id3);
        });

        it('throws when capacity exceeded', () => {
            const smallManager = new BodyManager2D(2);
            smallManager.createBody({ type: BodyType.Dynamic });
            smallManager.createBody({ type: BodyType.Dynamic });
            expect(() => {
                smallManager.createBody({ type: BodyType.Dynamic });
            }).toThrow();
        });
    });

    describe('Body Destruction', () => {
        it('destroys body', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            expect(manager.hasBody(bodyId)).toBe(true);
            manager.destroyBody(bodyId);
            expect(manager.hasBody(bodyId)).toBe(false);
        });

        it('decrements body count', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            expect(manager.bodyCount).toBe(1);
            manager.destroyBody(bodyId);
            expect(manager.bodyCount).toBe(0);
        });

        it('throws on destroying non-existent body', () => {
            expect(() => {
                manager.destroyBody(9999 as any);
            }).toThrow();
        });

        it('reuses indices after destruction', () => {
            const id1 = manager.createBody({ type: BodyType.Dynamic });
            manager.destroyBody(id1);
            const id2 = manager.createBody({ type: BodyType.Dynamic });
            expect(manager.bodyCount).toBe(1);
        });
    });

    describe('Position Operations', () => {
        it('gets position', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                position: { x: 1, y: 2 },
            });
            const pos = manager.getPosition(bodyId);
            expect(pos.x).toBe(1);
            expect(pos.y).toBe(2);
        });

        it('sets position', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setPosition(bodyId, { x: 5, y: 6 });
            const pos = manager.getPosition(bodyId);
            expect(pos.x).toBe(5);
            expect(pos.y).toBe(6);
        });

        it('gets position with output parameter', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                position: { x: 3, y: 4 },
            });
            const out = { x: 0, y: 0 };
            const result = manager.getPosition(bodyId, out);
            expect(result).toBe(out);
            expect(out.x).toBe(3);
            expect(out.y).toBe(4);
        });
    });

    describe('Rotation Operations', () => {
        it('gets rotation', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                rotation: 1.5,
            });
            expect(manager.getRotation(bodyId)).toBe(1.5);
        });

        it('sets rotation', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setRotation(bodyId, Math.PI);
            expect(manager.getRotation(bodyId)).toBeCloseTo(Math.PI);
        });
    });

    describe('Velocity Operations', () => {
        it('gets linear velocity', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                linearVelocity: { x: 1, y: 2 },
            });
            const vel = manager.getLinearVelocity(bodyId);
            expect(vel.x).toBe(1);
            expect(vel.y).toBe(2);
        });

        it('sets linear velocity', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setLinearVelocity(bodyId, { x: 3, y: 4 });
            const vel = manager.getLinearVelocity(bodyId);
            expect(vel.x).toBe(3);
            expect(vel.y).toBe(4);
        });

        it('gets linear velocity with output parameter', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                linearVelocity: { x: 5, y: 6 },
            });
            const out = { x: 0, y: 0 };
            const result = manager.getLinearVelocity(bodyId, out);
            expect(result).toBe(out);
            expect(out.x).toBe(5);
            expect(out.y).toBe(6);
        });

        it('gets angular velocity', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                angularVelocity: 2.5,
            });
            expect(manager.getAngularVelocity(bodyId)).toBe(2.5);
        });

        it('sets angular velocity', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setAngularVelocity(bodyId, 3.14);
            expect(manager.getAngularVelocity(bodyId)).toBeCloseTo(3.14);
        });
    });

    describe('Force and Impulse', () => {
        it('applies force without point', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.applyForce(bodyId, { x: 10, y: 20 });
        });

        it('applies force with point', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
            });
            manager.setMassData(bodyId, 1, 1, { x: 0, y: 0 });
            manager.applyForce(bodyId, { x: 10, y: 0 }, { x: 1, y: 0 });
        });

        it('applies impulse without point', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setMassData(bodyId, 2, 1, { x: 0, y: 0 });
            manager.applyImpulse(bodyId, { x: 4, y: 6 });
            const vel = manager.getLinearVelocity(bodyId);
            expect(vel.x).toBe(2);
            expect(vel.y).toBe(3);
        });

        it('applies impulse with point', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                position: { x: 0, y: 0 },
            });
            manager.setMassData(bodyId, 1, 1, { x: 0, y: 0 });
            manager.applyImpulse(bodyId, { x: 1, y: 0 }, { x: 0, y: 1 });
            const angVel = manager.getAngularVelocity(bodyId);
            expect(angVel).not.toBe(0);
        });
    });

    describe('Mass Data', () => {
        it('gets mass', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setMassData(bodyId, 5, 2, { x: 0, y: 0 });
            expect(manager.getMass(bodyId)).toBe(5);
        });

        it('gets inverse mass', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setMassData(bodyId, 4, 2, { x: 0, y: 0 });
            expect(manager.getInverseMass(bodyId)).toBeCloseTo(0.25);
        });

        it('sets zero mass for static bodies', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setMassData(bodyId, 0, 0, { x: 0, y: 0 });
            expect(manager.getMass(bodyId)).toBe(0);
            expect(manager.getInverseMass(bodyId)).toBe(0);
        });

        it('sets mass data with center', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setMassData(bodyId, 10, 5, { x: 1, y: 2 });
            expect(manager.getMass(bodyId)).toBe(10);
        });
    });

    describe('Body Type', () => {
        it('gets body type', () => {
            const staticId = manager.createBody({ type: BodyType.Static });
            const dynamicId = manager.createBody({ type: BodyType.Dynamic });
            const kinematicId = manager.createBody({ type: BodyType.Kinematic });

            expect(manager.getBodyType(staticId)).toBe(BodyType.Static);
            expect(manager.getBodyType(dynamicId)).toBe(BodyType.Dynamic);
            expect(manager.getBodyType(kinematicId)).toBe(BodyType.Kinematic);
        });
    });

    describe('Awake State', () => {
        it('gets awake state', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                awake: true,
            });
            expect(manager.isAwake(bodyId)).toBe(true);
        });

        it('sets awake to true', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                awake: false,
            });
            manager.setAwake(bodyId, true);
            expect(manager.isAwake(bodyId)).toBe(true);
        });

        it('sets awake to false clears velocities', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                linearVelocity: { x: 5, y: 5 },
                angularVelocity: 2,
            });
            manager.setAwake(bodyId, false);
            expect(manager.isAwake(bodyId)).toBe(false);
            const vel = manager.getLinearVelocity(bodyId);
            expect(vel.x).toBe(0);
            expect(vel.y).toBe(0);
            expect(manager.getAngularVelocity(bodyId)).toBe(0);
        });
    });

    describe('Clear Forces', () => {
        it('clears all forces', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.applyForce(bodyId, { x: 10, y: 20 });
            manager.clearForces();
        });
    });

    describe('Body Iteration', () => {
        it('iterates over body IDs', () => {
            const id1 = manager.createBody({ type: BodyType.Dynamic });
            const id2 = manager.createBody({ type: BodyType.Dynamic });
            const id3 = manager.createBody({ type: BodyType.Dynamic });

            const ids = Array.from(manager.getBodyIds());
            expect(ids).toHaveLength(3);
            expect(ids).toContain(id1);
            expect(ids).toContain(id2);
            expect(ids).toContain(id3);
        });

        it('returns empty iterator when no bodies', () => {
            const ids = Array.from(manager.getBodyIds());
            expect(ids).toHaveLength(0);
        });
    });

    describe('Error Handling', () => {
        it('throws on accessing non-existent body position', () => {
            expect(() => {
                manager.getPosition(9999 as any);
            }).toThrow();
        });

        it('throws on setting position of non-existent body', () => {
            expect(() => {
                manager.setPosition(9999 as any, { x: 0, y: 0 });
            }).toThrow();
        });

        it('throws on getting rotation of non-existent body', () => {
            expect(() => {
                manager.getRotation(9999 as any);
            }).toThrow();
        });

        it('throws on applying force to non-existent body', () => {
            expect(() => {
                manager.applyForce(9999 as any, { x: 1, y: 1 });
            }).toThrow();
        });
    });

    describe('Disposal', () => {
        it('disposes manager', () => {
            manager[Symbol.dispose]();
        });

        it('throws when using after disposal', () => {
            manager[Symbol.dispose]();
            expect(() => {
                manager.createBody({ type: BodyType.Dynamic });
            }).toThrow();
        });

        it('allows double disposal', () => {
            manager[Symbol.dispose]();
            manager[Symbol.dispose]();
        });
    });

    describe('Edge Cases', () => {
        it('handles multiple creates and destroys', () => {
            for (let i = 0; i < 50; i++) {
                const id = manager.createBody({ type: BodyType.Dynamic });
                manager.destroyBody(id);
            }
            expect(manager.bodyCount).toBe(0);
        });

        it('handles very large mass values', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setMassData(bodyId, 1e10, 1e10, { x: 0, y: 0 });
            expect(manager.getMass(bodyId)).toBe(1e10);
        });

        it('handles very small mass values', () => {
            const bodyId = manager.createBody({ type: BodyType.Dynamic });
            manager.setMassData(bodyId, 1e-10, 1e-10, { x: 0, y: 0 });
            expect(manager.getMass(bodyId)).toBe(1e-10);
        });

        it('handles extreme position values', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                position: { x: 1e10, y: -1e10 },
            });
            const pos = manager.getPosition(bodyId);
            expect(pos.x).toBe(1e10);
            expect(pos.y).toBe(-1e10);
        });

        it('handles extreme rotation values', () => {
            const bodyId = manager.createBody({
                type: BodyType.Dynamic,
                rotation: Math.PI * 100,
            });
            expect(manager.getRotation(bodyId)).toBeCloseTo(Math.PI * 100);
        });
    });
});
