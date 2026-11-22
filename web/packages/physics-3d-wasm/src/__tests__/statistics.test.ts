import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3D, WasmPhysicsWorld3DCompat } from '../index';
import type { CompatWorldConfig } from '../compat';

const DT = 1 / 60;

async function createWorld(maxBodies = 32): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts: Math.max(1024, maxBodies * 16),
        gravity: [0, -9.81, 0]
    });
}

function addGround(world: WasmPhysicsWorld3D): number {
    return world.createBody({
        type: 'static',
        position: [0, -0.5, 0],
        shape: { kind: 'box', halfExtents: [20, 0.5, 20] },
        friction: 0.8
    });
}

function addSettledBox(world: WasmPhysicsWorld3D): number {
    return world.createBody({
        position: [0, 0.4, 0],
        shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
        density: 1,
        friction: 0.7
    });
}

describe('step statistics', () => {
    it('starts at zero before any step ran', async () => {
        const world = await createWorld(8);
        addGround(world);
        const stats = world.getStepStatistics();
        expect(stats.broadphasePairsTested).toBe(0);
        expect(stats.shapePairsTested).toBe(0);
        expect(stats.contactsGenerated).toBe(0);
        expect(stats.sensorContacts).toBe(0);
        expect(stats.velocityIterations).toBe(0);
        expect(stats.positionIterations).toBe(0);
        expect(stats.sleepingBodies).toBe(0);
        expect(stats.liveBodies).toBe(0);
        world.dispose();
    });

    it('counts pairs, contacts and iterations from the last step', async () => {
        const world = await createWorld(8);
        addGround(world);
        addSettledBox(world);

        world.step(DT, { velocityIterations: 8, positionIterations: 3 });
        const stats = world.getStepStatistics();
        expect(stats.broadphasePairsTested).toBe(1);
        expect(stats.shapePairsTested).toBe(1);
        expect(stats.contactsGenerated).toBe(world.contactCount);
        expect(stats.contactsGenerated).toBeGreaterThanOrEqual(1);
        expect(stats.sensorContacts).toBe(0);
        expect(stats.velocityIterations).toBe(8);
        expect(stats.positionIterations).toBe(3);
        expect(stats.sleepingBodies).toBe(0);
        expect(stats.liveBodies).toBe(world.bodyCount);
        expect(stats.liveBodies).toBe(2);
        world.dispose();
    });

    it('uses the facade defaults when step options are omitted', async () => {
        const world = await createWorld(8);
        addGround(world);
        addSettledBox(world);
        world.step(DT);
        const stats = world.getStepStatistics();
        expect(stats.velocityIterations).toBe(10);
        expect(stats.positionIterations).toBe(4);
        world.dispose();
    });

    it('clamps iteration reporting to the engine maximum', async () => {
        const world = await createWorld(8);
        addGround(world);
        addSettledBox(world);
        world.step(DT, { velocityIterations: 100, positionIterations: 70 });
        const stats = world.getStepStatistics();
        expect(stats.velocityIterations).toBe(64);
        expect(stats.positionIterations).toBe(64);
        world.dispose();
    });

    it('separates sensor contacts from generated contacts', async () => {
        const world = await createWorld(16);
        const trigger = world.createBody({
            type: 'static',
            position: [0, 0, 0],
            shape: { kind: 'sphere', radius: 0.8 }
        });
        world.setShapeSensor((1 << 21) | (trigger << 3), true);
        const ball = world.createBody({
            position: [0, 3, 0],
            shape: { kind: 'sphere', radius: 0.25 },
            density: 1
        });

        let sawSensorStats = false;
        for (let index = 0; index < 120 && !sawSensorStats; index += 1) {
            world.step(DT);
            const stats = world.getStepStatistics();
            sawSensorStats = stats.sensorContacts > 0;
        }
        expect(sawSensorStats).toBe(true);
        const stats = world.getStepStatistics();
        expect(stats.sensorContacts).toBeLessThanOrEqual(stats.contactsGenerated);
        expect(world.hasBody(ball)).toBe(true);
        world.dispose();
    });

    it('is identical for two worlds running the same scene', async () => {
        const first = await createWorld(8);
        const second = await createWorld(8);
        for (const world of [first, second]) {
            addGround(world);
            addSettledBox(world);
        }

        for (let index = 0; index < 30; index += 1) {
            first.step(DT);
            second.step(DT);
        }

        expect(first.getStepStatistics()).toEqual(second.getStepStatistics());
        first.dispose();
        second.dispose();
    });
});

describe('compat profiler', () => {
    it('measures step time host-side and reports unmeasured sub-phases as null', async () => {
        const world = await WasmPhysicsWorld3DCompat.create({ maxBodies: 16 });
        const before = world.getProfiler();
        expect(before.stepTime).toBe(0);

        const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 } });
        world.createBoxShape(ground, { halfExtents: { x: 10, y: 0.5, z: 10 } });
        const box = world.createBody({ type: 2, position: { x: 0, y: 1, z: 0 } });
        world.createBoxShape(box, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        world.step(DT, 8, 3);
        const profile = world.getProfiler();
        expect(Number.isFinite(profile.stepTime)).toBe(true);
        expect(profile.stepTime).toBeGreaterThanOrEqual(0);
        expect(profile.collisionTime).toBeNull();
        expect(profile.solveTime).toBeNull();
        expect(profile.broadphaseTime).toBeNull();
        expect(profile.narrowphaseTime).toBeNull();
        expect(profile.sweepSortTime).toBeNull();
        expect(profile.pairLoopTime).toBeNull();
        expect(profile.solveVelocityTime).toBeNull();
        expect(profile.solvePositionTime).toBeNull();
        expect(profile.sleepTime).toBeNull();
        expect(profile.sleepAndCacheSwapTime).toBeNull();
        expect(profile.warmStartTime).toBeNull();
        expect(profile.persistTime).toBeNull();
        expect(profile.integrateVelocityTime).toBeNull();
        expect(profile.integratePositionTime).toBeNull();
        expect(profile.eventsTime).toBeNull();
        world.dispose();
    });
});

describe('compat world config', () => {
    it('applies sleep and iteration defaults and surfaces ignored keys', async () => {
        const config: CompatWorldConfig = {
            maxBodies: 16,
            allowSleep: true,
            velocityIterations: 5,
            positionIterations: 2,
            maxConstraints: 64
        };
        (config as Record<string, unknown>).legacySolver = 'janitor';

        const world = await WasmPhysicsWorld3DCompat.create(config);
        const ground = world.createBody({
            type: 0,
            position: { x: 0, y: -0.5, z: 0 },
            allowSleep: false
        });
        world.createBoxShape(ground, { halfExtents: { x: 10, y: 0.5, z: 10 } });
        const box = world.createBody({ type: 2, position: { x: 0, y: 0.6, z: 0 } });
        world.createBoxShape(box, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        world.step(DT);
        expect(world.getStepStatistics().velocityIterations).toBe(5);
        expect(world.getStepStatistics().positionIterations).toBe(2);

        world.step(DT, 7, 1);
        expect(world.getStepStatistics().velocityIterations).toBe(7);
        expect(world.getStepStatistics().positionIterations).toBe(1);

        const ignored = world.getStatistics().ignoredConfigKeys;
        expect(ignored).toContain('maxConstraints');
        expect(ignored).toContain('legacySolver');
        expect(ignored).toContain('bodyDef.allowSleep');

        let slept = false;
        for (let index = 0; index < 900 && !slept; index += 1) {
            world.step(DT);
            slept = world.getStepStatistics().sleepingBodies > 0;
        }
        expect(slept).toBe(true);
        world.dispose();
    });

    it('keeps sleep disabled by default regardless of body defs', async () => {
        const world = await WasmPhysicsWorld3DCompat.create({ maxBodies: 16 });
        const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 }, allowSleep: true });
        world.createBoxShape(ground, { halfExtents: { x: 10, y: 0.5, z: 10 } });
        world.createBody({ type: 2, position: { x: 0, y: 0.6, z: 0 }, allowSleep: true });
        world.createBoxShape(1, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        for (let index = 0; index < 600; index += 1) {
            world.step(DT);
        }
        expect(world.getStepStatistics().sleepingBodies).toBe(0);
        world.dispose();
    });

    it('rejects invalid config values', async () => {
        await expect(WasmPhysicsWorld3DCompat.create({ maxBodies: 8, velocityIterations: 65 })).rejects.toThrow();
        await expect(WasmPhysicsWorld3DCompat.create({ maxBodies: 8, positionIterations: -1 })).rejects.toThrow();
        await expect(WasmPhysicsWorld3DCompat.create({ maxBodies: 8, positionIterations: 1.5 })).rejects.toThrow();
        await expect(WasmPhysicsWorld3DCompat.create({ maxBodies: 8, maxConstraints: 0 })).rejects.toThrow();
    });
});
