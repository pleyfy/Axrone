import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3D, WASM_PHYSICS_CAPABILITIES } from '../index';

const DT = 1 / 60;

async function createWorld(gravity: readonly [number, number, number]): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies: 32,
        maxContacts: 256,
        gravity
    });
}

function addDynamicSphere(world: WasmPhysicsWorld3D, position: readonly [number, number, number]): number {
    return world.createBody({
        type: 'dynamic',
        position,
        shape: { kind: 'sphere', radius: 0.3 },
        density: 1
    });
}

describe('joint constraints', () => {
    it('holds a fixed joint rigidly under gravity', async () => {
        const world = await createWorld([0, -9.81, 0]);
        const support = world.createBody({ type: 'static', position: [0, 5, 0] });
        const payload = addDynamicSphere(world, [0, 4, 0]);
        const joint = world.createFixedJoint(support, payload, {
            localAnchorA: [0, -1, 0],
            localAnchorB: [0, 0, 0],
            collideConnected: true
        });
        expect(joint).toBeGreaterThanOrEqual(0);
        expect(world.constraintCount()).toBe(1);

        for (let index = 0; index < 300; index += 1) {
            world.step(DT);
        }

        const transform = world.readTransform(payload);
        expect(transform.position[0]).toBeCloseTo(0, 3);
        expect(transform.position[1]).toBeCloseTo(4, 2);
        expect(transform.position[2]).toBeCloseTo(0, 3);
        world.dispose();
    });

    it('swings a hinged door and clamps it at the upper limit', async () => {
        const world = await createWorld([0, -9.81, 0]);
        const frame = world.createBody({ type: 'static', position: [0, 3, 0] });
        const half = 0.025;
        const door = world.createBody({
            type: 'dynamic',
            position: [-0.4 * Math.cos(2 * half), 3 - 0.4 * Math.sin(2 * half), 0],
            rotation: [0, 0, Math.sin(half), Math.cos(half)],
            shape: { kind: 'box', halfExtents: [0.4, 0.08, 0.2] },
            density: 1
        });
        const joint = world.createHingeJoint(frame, door, {
            localAnchorA: [0, 0, 0],
            localAnchorB: [0.4, 0, 0],
            localAxisA: [0, 0, 1],
            localAxisB: [0, 0, 1],
            enableLimit: true,
            lowerLimit: 0,
            upperLimit: 0.35,
            collideConnected: true
        });
        expect(joint).toBeGreaterThanOrEqual(0);

        for (let index = 0; index < 300; index += 1) {
            world.step(DT, { velocityIterations: 10, positionIterations: 4 });
        }

        const rotation = world.readTransform(door).rotation;
        expect(rotation[2]).toBeGreaterThan(0.17);
        expect(rotation[2]).toBeLessThan(0.23);
        world.dispose();
    });

    it('drives a hinge motor to the target angular speed', async () => {
        const world = await createWorld([0, 0, 0]);
        const mount = world.createBody({ type: 'static', position: [0, 0, 0] });
        const rotor = world.createBody({
            type: 'dynamic',
            position: [0, 0, 0],
            shape: { kind: 'box', halfExtents: [0.2, 0.2, 0.2] },
            density: 1
        });
        world.createHingeJoint(mount, rotor, {
            localAnchorA: [0, 0, 0],
            localAnchorB: [0, 0, 0],
            localAxisA: [0, 1, 0],
            localAxisB: [0, 1, 0],
            enableMotor: true,
            motorSpeed: 2,
            maxMotorTorque: 50,
            collideConnected: true
        });

        for (let index = 0; index < 60; index += 1) {
            world.step(DT, { velocityIterations: 10, positionIterations: 4 });
        }

        const angular = world.readAngularVelocity(rotor);
        expect(angular[1]).toBeCloseTo(2, 1);
        world.dispose();
    });

    it('keeps a slider carriage on its axis and clamps at the limit', async () => {
        const world = await createWorld([0, -9.81, 0]);
        const mount = world.createBody({ type: 'static', position: [0, 3, 0] });
        const carriage = world.createBody({
            type: 'dynamic',
            position: [0, 2, 0],
            shape: { kind: 'box', halfExtents: [0.2, 0.2, 0.2] },
            density: 1
        });
        world.createSliderJoint(mount, carriage, {
            localAnchorA: [0, 0, 0],
            localAnchorB: [0, 1, 0],
            localAxisA: [0, -1, 0],
            enableLimit: true,
            lowerLimit: 0,
            upperLimit: 1,
            collideConnected: true
        });

        for (let index = 0; index < 300; index += 1) {
            world.step(DT, { velocityIterations: 10, positionIterations: 4 });
        }

        const transform = world.readTransform(carriage);
        expect(Math.abs(transform.position[0])).toBeLessThan(0.05);
        expect(Math.abs(transform.position[2])).toBeLessThan(0.05);
        expect(transform.position[1]).toBeGreaterThan(0.9);
        expect(transform.position[1]).toBeLessThan(1.1);
        world.dispose();
    });

    it('oscillates a spring bob without diverging', async () => {
        const world = await createWorld([0, 0, 0]);
        const mount = world.createBody({ type: 'static', position: [0, 3, 0] });
        const bob = world.createBody({
            type: 'dynamic',
            position: [0, 1.5, 0],
            shape: { kind: 'sphere', radius: 0.2 },
            density: 1
        });
        world.setMassData(bob, 1);
        world.createSpringJoint(mount, bob, {
            localAnchorA: [0, 0, 0],
            localAnchorB: [0, 0, 0],
            restLength: 1,
            stiffness: 10,
            damping: 0,
            collideConnected: true
        });

        let low = Number.POSITIVE_INFINITY;
        let high = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < 400; index += 1) {
            world.step(DT);
            const y = world.readTransform(bob).position[1];
            expect(Number.isFinite(y)).toBe(true);
            low = Math.min(low, y);
            high = Math.max(high, y);
        }

        expect(low).toBeGreaterThan(1.2);
        expect(high).toBeLessThan(2.8);
        expect(high - low).toBeGreaterThan(0.5);
        world.dispose();
    });

    it('suppresses contacts for collideConnected false and restores them after destroy', async () => {
        const world = await createWorld([0, -9.81, 0]);
        const left = world.createBody({
            type: 'dynamic',
            position: [0, 1.2, 0],
            shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
            density: 1
        });
        const right = world.createBody({
            type: 'dynamic',
            position: [1.2, 1.2, 0],
            shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
            density: 1
        });
        const joint = world.createFixedJoint(left, right, {
            localAnchorA: [0.1, 0, 0],
            localAnchorB: [-0.1, 0, 0],
            collideConnected: false
        });

        for (let index = 0; index < 120; index += 1) {
            const contacts = world.step(DT);
            const view = world.readContacts();
            for (const contact of view) {
                expect(
                    (contact.a === left && contact.b === right) ||
                    (contact.a === right && contact.b === left)
                ).toBe(false);
            }
            expect(contacts).toBeGreaterThanOrEqual(0);
        }

        world.destroyConstraint(joint);
        let sawPairContact = false;
        for (let index = 0; index < 60; index += 1) {
            world.step(DT);
            for (const contact of world.readContacts()) {
                if (
                    (contact.a === left && contact.b === right) ||
                    (contact.a === right && contact.b === left)
                ) {
                    sawPairContact = true;
                }
            }
        }
        expect(sawPairContact).toBe(true);
        world.dispose();
    });

    it('rejects stale constraint ids after destroy and keeps slots stable', async () => {
        const world = await createWorld([0, -9.81, 0]);
        const support = world.createBody({ type: 'static', position: [0, 5, 0] });
        const payload = addDynamicSphere(world, [0, 4, 0]);
        const first = world.createFixedJoint(support, payload, {
            localAnchorA: [0, -1, 0],
            localAnchorB: [0, 0, 0],
            collideConnected: true
        });
        expect(first).toBe(0);
        world.destroyConstraint(first);
        expect(world.constraintCount()).toBe(0);

        const second = world.createFixedJoint(support, payload, {
            localAnchorA: [0, -1, 0],
            localAnchorB: [0, 0, 0],
            collideConnected: true
        });
        expect(second).not.toBe(first);
        expect(world.constraintKind(second)).toBe(0);
        expect(() => world.constraintKind(first)).toThrow();
        expect(() => world.setConstraintEnabled(first, true)).toThrow();
        expect(() => world.destroyConstraint(first)).toThrow();
        expect(world.constraintCount()).toBe(1);
        world.dispose();
    });

    it('throws for invalid constraint and body identifiers', async () => {
        const world = await createWorld([0, -9.81, 0]);
        expect(() => world.destroyConstraint(12345)).toThrow();
        expect(() => world.setHingeMotor(99999, 1, 1)).toThrow();
        expect(() => world.setHingeLimit(-1, true, 0, 1)).toThrow();
        expect(() => world.setSliderMotor(7, 1, 1)).toThrow();
        expect(() => world.setSliderLimit(7, true, 0, 1)).toThrow();
        const support = world.createBody({ type: 'static', position: [0, 3, 0] });
        expect(() => world.createHingeJoint(support, 999, {
            localAnchorA: [0, 0, 0],
            localAnchorB: [0, 0, 0],
            localAxisA: [0, 1, 0],
            localAxisB: [0, 1, 0]
        })).toThrow();
        const payload = world.createBody({
            type: 'dynamic',
            position: [0, 2, 0],
            shape: { kind: 'sphere', radius: 0.3 },
            density: 1
        });
        expect(() => world.createSliderJoint(support, payload, {
            localAnchorA: [0, 0, 0],
            localAnchorB: [Number.NaN, 0, 0],
            localAxisA: [0, 1, 0]
        })).toThrow();
        expect(world.constraintCount()).toBe(0);
        world.dispose();
    });

    it('clears constraints on reset and reports zero reactions', async () => {
        const world = await createWorld([0, -9.81, 0]);
        const support = world.createBody({ type: 'static', position: [0, 5, 0] });
        const payload = addDynamicSphere(world, [0, 4, 0]);
        const joint = world.createFixedJoint(support, payload, {
            localAnchorA: [0, -1, 0],
            localAnchorB: [0, 0, 0],
            collideConnected: true
        });
        world.step(DT);
        expect(world.constraintCount()).toBe(1);
        expect(world.getJointReactionForce(joint)).toEqual([0, 0, 0]);
        expect(world.getJointReactionTorque(joint)).toBe(0);

        world.reset();
        expect(world.constraintCount()).toBe(0);
        expect(() => world.constraintKind(joint)).toThrow();
        expect(WASM_PHYSICS_CAPABILITIES.constraints).toBe(true);
        world.dispose();
    });
});
