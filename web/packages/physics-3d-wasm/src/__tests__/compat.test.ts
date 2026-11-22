import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3DCompat } from '../index';
import type { CompatCollisionEvent, CompatSensorEvent } from '../compat';

async function createCompat(maxBodies = 32): Promise<WasmPhysicsWorld3DCompat> {
    return WasmPhysicsWorld3DCompat.create({
        maxBodies,
        maxContacts: Math.max(1024, maxBodies * 16),
        gravity: { x: 0, y: -9.81, z: 0 }
    });
}

function addGround(world: WasmPhysicsWorld3DCompat): number {
    const ground = world.createBody({
        type: 0,
        position: { x: 0, y: -0.5, z: 0 },
        allowSleep: false
    });
    world.createBoxShape(ground, { halfExtents: { x: 10, y: 0.5, z: 10 } });
    return ground;
}

function shapeBodyOf(shapeId: number): number {
    return (shapeId >> 3) & 0x3ffff;
}

function shapeSlotOf(shapeId: number): number {
    return shapeId & 7;
}

describe('WasmPhysicsWorld3DCompat', () => {
    it('runs a benchmark-style box scene', async () => {
        const world = await createCompat();
        const ground = world.createBody({
            type: 0,
            position: { x: 0, y: -0.5, z: 0 },
            allowSleep: false
        });
        expect(ground).toBe(0);
        world.createBoxShape(ground, { halfExtents: { x: 10, y: 0.5, z: 10 } });

        const body = world.createBody({
            type: 2,
            position: { x: 0, y: 1, z: 0 },
            allowSleep: false
        });
        const shape = world.createBoxShape(body, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
        expect(shapeSlotOf(shape)).toBe(0);
        expect(shapeBodyOf(shape)).toBe(body);
        expect(world.getShapeBody(shape)).toBe(body);
        world.getBody(body)?.resetMassData();

        for (let index = 0; index < 120; index += 1) {
            world.step(1 / 60, 8, 3);
        }

        expect(world.bodyCount).toBe(2);
        expect(world.contactCount).toBeGreaterThan(0);
        expect(world.getStatistics().contactCount).toBe(world.contactCount);
        expect(world.getBody(999)).toBe(null);
        world.dispose();
    });

    it('accepts kinematic bodies', async () => {
        const world = await createCompat(8);
        const platform = world.createBody({
            type: 1,
            position: { x: 0, y: 0, z: 0 },
            allowSleep: false
        });
        expect(platform).toBe(0);
        const shape = world.createBoxShape(platform, { halfExtents: { x: 1, y: 0.1, z: 1 } });
        expect(shape).toBeGreaterThanOrEqual(0);
        expect(world.getShapeBody(shape)).toBe(platform);
        world.step(1 / 60, 8, 3);
        expect(world.bodyCount).toBe(1);
        expect(world.contactCount).toBe(0);
        expect(world.getStatistics().bodyCount).toBe(1);
        world.dispose();
    });

    it('rejects invalid shapes and reports disposals', async () => {
        const world = await createCompat(8);
        const body = world.createBody({ type: 2 });
        expect(() => world.createBoxShape(body, {})).toThrow(/halfExtents/);
        expect(() => world.createSphereShape(body, {})).toThrow(/radius/);
        world.createBoxShape(body, {
            center: { x: 1, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 }
        });
        world.createSphereShape(body, { radius: 0.5 });
        world.dispose();
        expect(() => world.bodyCount).toThrow(/disposed/);
    });

    it('accepts offset and multiple shapes per body', async () => {
        const world = await createCompat(8);
        const body = world.createBody({ type: 2 });
        const first = world.createBoxShape(body, {
            center: { x: 1, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 }
        });
        const second = world.createSphereShape(body, {
            center: { x: -1, y: 0, z: 0 },
            radius: 0.5
        });
        expect(first).not.toBe(second);
        expect(shapeSlotOf(first)).toBe(0);
        expect(shapeSlotOf(second)).toBe(1);
        expect(shapeBodyOf(first)).toBe(body);
        expect(shapeBodyOf(second)).toBe(body);
        expect(world.getShapeBody(first)).toBe(body);
        expect(world.getShapeBody(second)).toBe(body);
        world.step(1 / 60);
        expect(world.contactCount).toBe(0);
        world.dispose();
    });

    it('rests an offset box shape at the core rest height', async () => {
        const world = await createCompat(16);
        addGround(world);
        const body = world.createBody({
            type: 2,
            position: { x: 0, y: 2, z: 0 },
            allowSleep: false
        });
        world.createBoxShape(body, {
            center: { x: 0, y: 0.75, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 }
        });

        for (let index = 0; index < 300; index += 1) {
            world.step(1 / 60, 10, 4);
        }

        const transform = world.getTransform(body);
        expect(transform.position[1]).toBeCloseTo(-0.25, 1);
        expect(world.contactCount).toBeGreaterThan(0);
        world.dispose();
    });

    it('collides with both shapes of one body', async () => {
        const world = await createCompat(16);
        addGround(world);
        const body = world.createBody({
            type: 2,
            position: { x: 0, y: 1, z: 0 },
            allowSleep: false
        });
        world.createBoxShape(body, {
            center: { x: -0.6, y: 0, z: 0 },
            halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
        });
        world.createBoxShape(body, {
            center: { x: 0.6, y: 0, z: 0 },
            halfExtents: { x: 0.4, y: 0.4, z: 0.4 }
        });

        let maxContacts = 0;
        for (let index = 0; index < 240; index += 1) {
            world.step(1 / 60, 10, 4);
            maxContacts = Math.max(maxContacts, world.contactCount);
        }
        expect(maxContacts).toBeGreaterThanOrEqual(2);

        const transform = world.getTransform(body);
        expect(transform.position[1]).toBeGreaterThanOrEqual(-0.05);
        expect(Number.isFinite(transform.position[1])).toBe(true);
        world.dispose();
    });

    it('keeps shape ids stable and destroyable', async () => {
        const world = await createCompat(16);
        const body = world.createBody({ type: 2, allowSleep: false });
        const kept = world.createBoxShape(body, {
            center: { x: 1, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 }
        });
        const doomed = world.createSphereShape(body, {
            center: { x: -1, y: 0, z: 0 },
            radius: 0.5
        });
        expect(doomed).not.toBe(kept);

        world.destroyShape(doomed);
        expect(() => world.getShapeBody(doomed)).toThrow();
        expect(() => world.destroyShape(doomed)).toThrow();
        expect(world.getShapeBody(kept)).toBe(body);

        const replacement = world.createSphereShape(body, { radius: 0.3 });
        expect(replacement).not.toBe(doomed);
        world.step(1 / 60);
        expect(world.getShapeBody(kept)).toBe(body);
        expect(world.getShapeBody(replacement)).toBe(body);

        world.destroyBody(body);
        expect(() => world.getShapeBody(kept)).toThrow();
        world.dispose();
    });

    it('resets the compatibility world', async () => {
        const world = await createCompat(8);
        const body = world.createBody({ type: 2 });
        const shape = world.createSphereShape(body, { radius: 0.5 });
        world.step(1 / 60);
        expect(world.bodyCount).toBe(1);
        world.reset();
        expect(world.bodyCount).toBe(0);
        expect(world.contactCount).toBe(0);
        expect(() => world.getShapeBody(shape)).toThrow();
        world.dispose();
    });

    it('drives a contact listener through collision begin, stay and end', async () => {
        const world = await createCompat(16);
        const ground = addGround(world);
        const box = world.createBody({
            type: 2,
            position: { x: 0, y: 1, z: 0 },
            allowSleep: false
        });
        world.createBoxShape(box, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        const calls: string[] = [];
        const timestamps: number[] = [];
        const pairs: number[][] = [];
        world.setContactListener({
            onCollisionBegin: (event: CompatCollisionEvent) => {
                calls.push('begin');
                timestamps.push(event.timestamp);
                pairs.push([event.bodyIdA, event.bodyIdB]);
                expect(event.type).toBe(0);
                expect(event.manifold.normal).toBeDefined();
            },
            onCollisionStay: (event: CompatCollisionEvent) => {
                calls.push('stay');
                timestamps.push(event.timestamp);
                expect(event.type).toBe(1);
            },
            onCollisionEnd: (event: CompatCollisionEvent) => {
                calls.push('end');
                timestamps.push(event.timestamp);
                expect(event.type).toBe(2);
            }
        });

        let began = false;
        for (let index = 0; index < 240 && !began; index += 1) {
            began = calls.includes('begin');
            if (!began) {
                world.step(1 / 60, 10, 4);
                began = calls.includes('begin');
            }
        }
        expect(began).toBe(true);
        expect(pairs[0].slice().sort((a, b) => a - b)).toEqual([ground, box].sort((a, b) => a - b));

        for (let index = 0; index < 5; index += 1) {
            world.step(1 / 60, 10, 4);
        }
        expect(calls.filter((call) => call === 'stay').length).toBeGreaterThan(0);

        world.destroyBody(box);
        world.step(1 / 60, 10, 4);
        expect(calls.filter((call) => call === 'end')).toHaveLength(1);
        expect(calls.filter((call) => call === 'begin')).toHaveLength(1);

        expect(timestamps.length).toBeGreaterThan(0);
        for (const stamp of timestamps) {
            expect(Number.isFinite(stamp)).toBe(true);
        }
        for (let index = 1; index < timestamps.length; index += 1) {
            expect(timestamps[index]).toBeGreaterThanOrEqual(timestamps[index - 1]);
        }

        const callsBeforeSilence = calls.length;
        world.step(1 / 60, 10, 4);
        expect(calls.length).toBe(callsBeforeSilence);
        world.dispose();
    });

    it('routes sensor pairs only to sensor callbacks', async () => {
        const world = await createCompat(16);
        const trigger = world.createBody({
            type: 0,
            position: { x: 0, y: 0, z: 0 },
            allowSleep: false
        });
        const triggerShape = world.createSphereShape(trigger, { radius: 0.8, isSensor: true });

        const ball = world.createBody({
            type: 2,
            position: { x: 0, y: 3, z: 0 },
            allowSleep: false
        });
        const ballShape = world.createSphereShape(ball, { radius: 0.25 });

        const collisionCalls: string[] = [];
        const sensorCalls: string[] = [];
        const sensorEvents: CompatSensorEvent[] = [];
        world.setContactListener({
            onCollisionBegin: () => collisionCalls.push('begin'),
            onCollisionStay: () => collisionCalls.push('stay'),
            onCollisionEnd: () => collisionCalls.push('end'),
            onSensorEnter: (event: CompatSensorEvent) => {
                sensorCalls.push('enter');
                sensorEvents.push(event);
            },
            onSensorStay: () => sensorCalls.push('stay'),
            onSensorExit: () => sensorCalls.push('exit')
        });

        for (let index = 0; index < 300; index += 1) {
            world.step(1 / 60, 10, 4);
        }

        expect(sensorCalls.filter((call) => call === 'enter')).toHaveLength(1);
        expect(sensorCalls.filter((call) => call === 'stay').length).toBeGreaterThan(0);
        expect(sensorCalls.filter((call) => call === 'exit')).toHaveLength(1);
        expect(collisionCalls).toEqual([]);
        expect(sensorEvents.length).toBeGreaterThan(0);
        for (const event of sensorEvents) {
            expect(event.sensorBodyId).toBe(trigger);
            expect(event.sensorShapeId).toBe(triggerShape);
            expect(event.visitorBodyId).toBe(ball);
            expect(event.visitorShapeId).toBe(ballShape);
            expect(event.type).toBeLessThanOrEqual(2);
        }
        world.dispose();
    });

    it('clears the listener on disposal', async () => {
        const world = await createCompat(16);
        addGround(world);
        const box = world.createBody({
            type: 2,
            position: { x: 0, y: 1, z: 0 },
            allowSleep: false
        });
        world.createBoxShape(box, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        let calls = 0;
        world.setContactListener({ onCollisionBegin: () => { calls += 1; } });
        for (let index = 0; index < 240 && calls === 0; index += 1) {
            world.step(1 / 60, 10, 4);
        }
        expect(calls).toBeGreaterThan(0);

        world.setContactListener(null);
        const callsAfterUnbind = calls;
        world.step(1 / 60, 10, 4);
        expect(calls).toBe(callsAfterUnbind);

        world.dispose();
        expect(() => world.step(1 / 60)).toThrow(/disposed/);
        expect(() => world.setContactListener({ onCollisionBegin: () => { calls += 1; } })).toThrow(/disposed/);
        expect(calls).toBe(callsAfterUnbind);
    });
});
