import { describe, expect, it } from 'vitest';
import { BODY_FLAGS, WasmPhysicsWorld3D } from '../index';

const DT = 1 / 60;

async function createGravitylessWorld(maxBodies = 32): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts: 256,
        gravity: [0, 0, 0]
    });
}

async function createFallingWorld(maxBodies = 32): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts: 256,
        gravity: [0, -9.81, 0]
    });
}

function addBox(world: WasmPhysicsWorld3D, x: number, y: number, z = 0): number {
    return world.createBody({
        position: [x, y, z],
        shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
        density: 1,
        friction: 0.7
    });
}

describe('body dynamics controls', () => {
    it('decays linear velocity with damping each step', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);

        world.setDamping(body, 0.5, 0);
        world.setVelocity(body, [1, 0, 0]);
        world.step(DT);
        expect(world.readVelocity(body)[0]).toBeCloseTo(1 * (1 - 0.5 * DT), 6);
        expect(world.readVelocity(body)[0]).toBeGreaterThan(0.98);

        for (let index = 0; index < 60; index += 1) {
            world.step(DT);
        }
        expect(world.readVelocity(body)[0]).toBeLessThan(0.72);
        expect(world.readVelocity(body)[0]).toBeGreaterThan(0.55);
        world.dispose();
    });

    it('rejects invalid damping arguments', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);
        expect(() => world.setDamping(body, -0.1, 0)).toThrow();
        expect(() => world.setDamping(body, 0, -1)).toThrow();
        expect(() => world.setDamping(body, Number.NaN, 0)).toThrow();
        expect(() => world.setDamping(99, 0, 0)).toThrow();
        world.dispose();
    });

    it('scales gravity per body', async () => {
        const world = await createFallingWorld();
        const floater = addBox(world, -4, 100);
        const normal = addBox(world, 0, 100);
        const heavyPull = addBox(world, 4, 100);

        world.setGravityScale(floater, 0);
        world.setGravityScale(heavyPull, 2);

        for (let index = 0; index < 60; index += 1) {
            world.step(DT);
        }

        expect(world.readTransform(floater).position[1]).toBe(100);
        const normalDrop = 100 - world.readTransform(normal).position[1];
        const heavyDrop = 100 - world.readTransform(heavyPull).position[1];
        expect(normalDrop).toBeGreaterThan(1);
        expect(Math.abs(heavyDrop - 2 * normalDrop)).toBeLessThan(0.05);
        expect(() => world.setGravityScale(normal, Number.POSITIVE_INFINITY)).toThrow();
        world.dispose();
    });

    it('freezes position axes through flags', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);

        world.setFlags(body, BODY_FLAGS.freezePositionY | BODY_FLAGS.freezePositionZ);
        world.setVelocity(body, [1, 1, 1]);
        for (let index = 0; index < 10; index += 1) {
            world.step(DT);
        }

        const position = world.readTransform(body).position;
        expect(position[0]).toBeCloseTo(10 * DT, 5);
        expect(position[1]).toBe(10);
        expect(position[2]).toBe(0);
        expect(world.readVelocity(body)).toEqual([1, 0, 0]);
        world.dispose();
    });

    it('freezes rotation axes and keeps the free axis spinning', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);

        world.setFlags(body, BODY_FLAGS.freezeRotationX | BODY_FLAGS.freezeRotationZ);
        world.setAngularVelocity(body, [1, 2, 1]);
        for (let index = 0; index < 10; index += 1) {
            world.step(DT);
        }

        expect(world.readAngularVelocity(body)).toEqual([0, 2, 0]);
        const rotation = world.readTransform(body).rotation;
        expect(rotation[0]).toBe(0);
        expect(rotation[2]).toBe(0);
        expect(Math.abs(rotation[1])).toBeGreaterThan(1e-3);
        world.dispose();
    });

    it('rejects invalid flag masks', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);
        expect(() => world.setFlags(body, -1)).toThrow();
        expect(() => world.setFlags(body, 0, -1)).toThrow();
        expect(() => world.setFlags(body, 1.5)).toThrow();
        expect(() => world.setFlags(99, 1)).toThrow();

        world.setFlags(body, 64 | 128);
        world.setFlags(body, 0, 64 | 128);
        world.dispose();
    });

    it('applies accumulated force on the next step only', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);

        world.applyForce(body, [60, 0, 0]);
        expect(world.readVelocity(body)).toEqual([0, 0, 0]);

        world.step(DT);
        expect(world.readVelocity(body)[0]).toBeCloseTo(1, 5);

        world.step(DT);
        expect(world.readVelocity(body)[0]).toBeCloseTo(1, 5);
        expect(world.readTransform(body).position[0]).toBeGreaterThan(2 * DT - 1e-4);
        world.dispose();
    });

    it('applies impulses immediately including angular coupling', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);

        world.applyImpulse(body, [1, 0, 0]);
        expect(world.readVelocity(body)[0]).toBeCloseTo(1, 5);

        world.applyImpulse(body, [0, 0, 10], [1, 0, 0]);
        expect(world.readVelocity(body)[2]).toBeCloseTo(10, 4);
        expect(world.readAngularVelocity(body)[1]).toBeCloseTo(-60, 1);
        world.dispose();
    });

    it('accumulates torque for one step and applies angular impulses immediately', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);

        world.applyTorque(body, [0, 0, 6]);
        expect(world.readAngularVelocity(body)).toEqual([0, 0, 0]);
        world.step(DT);
        const spun = world.readAngularVelocity(body)[2];
        expect(spun).toBeGreaterThan(0.5);
        expect(spun).toBeLessThan(0.7);
        world.step(DT);
        expect(world.readAngularVelocity(body)[2]).toBeCloseTo(spun, 5);

        world.applyAngularImpulse(body, [0, 0, -0.1]);
        expect(Math.abs(world.readAngularVelocity(body)[2])).toBeLessThan(1e-3);
        world.dispose();
    });

    it('overrides mass data and honors inertia axes', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);

        world.setMassData(body, 4);
        world.applyImpulse(body, [4, 0, 0]);
        expect(world.readVelocity(body)[0]).toBeCloseTo(1, 5);

        world.setDamping(body, 0, 0);
        world.setMassData(body, 2, [0.1, 0, 0]);
        world.applyAngularImpulse(body, [0.1, 0, 0]);
        expect(world.readAngularVelocity(body)[0]).toBeCloseTo(1, 4);
        world.dispose();
    });

    it('rejects invalid dynamics arguments and non-dynamic bodies', async () => {
        const world = await createGravitylessWorld();
        const body = addBox(world, 0, 10);
        const staticBody = world.createBody({
            type: 'static',
            position: [6, 10, 0],
            shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }
        });

        expect(() => world.applyForce(body, [Number.NaN, 0, 0])).toThrow();
        expect(() => world.applyForce(body, [1, 0, 0], [Number.POSITIVE_INFINITY, 0, 0])).toThrow();
        expect(() => world.applyImpulse(body, [0, 0, 0], [0, Number.NaN, 0])).toThrow();
        expect(() => world.applyTorque(99, [1, 0, 0])).toThrow();
        expect(() => world.setMassData(body, Number.NaN)).toThrow();
        expect(() => world.setMassData(body, 1, [0, Number.POSITIVE_INFINITY, 0])).toThrow();

        expect(() => world.applyForce(staticBody, [1, 0, 0])).toThrow();
        expect(() => world.applyImpulse(staticBody, [1, 0, 0])).toThrow();
        world.dispose();
    });

    it('proves force moves a body through a step while an impulse acts immediately', async () => {
        const world = await createFallingWorld();
        world.setGravity([0, 0, 0]);
        const pushed = addBox(world, 0, 10);
        const struck = addBox(world, 5, 10);

        world.applyForce(pushed, [30, 0, 0]);
        world.applyImpulse(struck, [2, 0, 0]);

        expect(world.readVelocity(pushed)).toEqual([0, 0, 0]);
        expect(world.readVelocity(struck)[0]).toBeCloseTo(2, 5);

        world.step(DT);
        expect(world.readVelocity(pushed)[0]).toBeCloseTo(0.5, 5);
        expect(world.readTransform(pushed).position[0]).toBeGreaterThan(0);
        expect(world.readTransform(struck).position[0]).toBeGreaterThan(2 * DT - 1e-6);
        world.dispose();
    });

    it('keeps kinematic bodies damping-only', async () => {
        const world = await createFallingWorld();
        const platform = world.createBody({
            type: 'kinematic',
            position: [0, 10, 0],
            shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }
        });

        world.setDamping(platform, 0.5, 0);
        world.setVelocity(platform, [1, 0, 0]);
        world.step(DT);
        expect(world.readVelocity(platform)[0]).toBeCloseTo(1 - 0.5 * DT, 6);
        expect(world.readTransform(platform).position[1]).toBe(10);
        expect(() => world.applyForce(platform, [1, 0, 0])).toThrow();
        world.dispose();
    });
});
