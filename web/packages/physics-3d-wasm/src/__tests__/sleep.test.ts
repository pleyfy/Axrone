import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3D } from '../index';

const DT = 1 / 60;

async function createWorld(gravity: readonly [number, number, number]): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies: 32,
        maxContacts: 256,
        gravity
    });
}

function addGround(world: WasmPhysicsWorld3D): number {
    return world.createBody({
        type: 'static',
        position: [0, -0.5, 0],
        shape: { kind: 'box', halfExtents: [10, 0.5, 10] }
    });
}

function addSettledBox(world: WasmPhysicsWorld3D): number {
    return world.createBody({
        position: [0, 0.5, 0],
        shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] },
        density: 1,
        friction: 0.7
    });
}

function settleUntilSleep(world: WasmPhysicsWorld3D, id: number, steps: number): boolean {
    for (let index = 0; index < steps; index += 1) {
        world.step(DT);
        if (world.isSleeping(id)) {
            return true;
        }
    }
    return false;
}

describe('body sleeping', () => {
    it('keeps bodies awake while allow sleep is off', async () => {
        const world = await createWorld([0, -9.81, 0]);
        addGround(world);
        const box = addSettledBox(world);

        world.setAllowSleep(false);
        for (let index = 0; index < 400; index += 1) {
            world.step(DT);
        }
        expect(world.isSleeping(box)).toBe(false);
        world.dispose();
    });

    it('sleeps a settled box once allow sleep is enabled', async () => {
        const world = await createWorld([0, -9.81, 0]);
        addGround(world);
        const box = addSettledBox(world);

        world.setAllowSleep(true);
        expect(settleUntilSleep(world, box, 600)).toBe(true);
        expect(world.isSleeping(box)).toBe(true);
        expect(world.readVelocity(box)).toEqual([0, 0, 0]);
        expect(world.readAngularVelocity(box)).toEqual([0, 0, 0]);

        const before = world.readTransform(box);
        for (let index = 0; index < 120; index += 1) {
            world.step(DT);
        }
        const after = world.readTransform(box);
        expect(after.position).toEqual(before.position);
        expect(after.rotation).toEqual(before.rotation);
        expect(world.isSleeping(box)).toBe(true);
        world.dispose();
    });

    it('wakes a sleeping body on impulse', async () => {
        const world = await createWorld([0, -9.81, 0]);
        addGround(world);
        const box = addSettledBox(world);

        world.setAllowSleep(true);
        expect(settleUntilSleep(world, box, 600)).toBe(true);

        world.applyImpulse(box, [0, 5, 0]);
        expect(world.isSleeping(box)).toBe(false);
        expect(world.readVelocity(box)[1]).toBeGreaterThan(4);

        world.step(DT);
        expect(world.isSleeping(box)).toBe(false);
        expect(world.readTransform(box).position[1]).toBeGreaterThan(0.45);
        world.dispose();
    });

    it('wakes a sleeping body with explicit wake and transform updates', async () => {
        const world = await createWorld([0, -9.81, 0]);
        addGround(world);
        const box = addSettledBox(world);

        world.setAllowSleep(true);
        expect(settleUntilSleep(world, box, 600)).toBe(true);

        world.setAwake(box, true);
        expect(world.isSleeping(box)).toBe(false);

        expect(settleUntilSleep(world, box, 600)).toBe(true);
        world.setTransform(box, [0, 0.5, 0]);
        expect(world.isSleeping(box)).toBe(false);

        expect(settleUntilSleep(world, box, 600)).toBe(true);
        world.setVelocity(box, [0, 0, 0]);
        expect(world.isSleeping(box)).toBe(false);
        world.dispose();
    });

    it('forces sleep and freezes the body through setAwake', async () => {
        const world = await createWorld([0, -9.81, 0]);
        addGround(world);
        const box = addSettledBox(world);

        world.setAllowSleep(true);
        world.setVelocity(box, [1, 0, 0]);
        world.setAwake(box, false);
        expect(world.isSleeping(box)).toBe(true);
        expect(world.readVelocity(box)).toEqual([0, 0, 0]);

        const before = world.readTransform(box);
        world.step(DT);
        world.step(DT);
        expect(world.isSleeping(box)).toBe(true);
        expect(world.readTransform(box).position[0]).toBe(before.position[0]);

        world.setAwake(box, true);
        expect(world.isSleeping(box)).toBe(false);
        world.dispose();
    });

    it('rejects invalid sleep control usage', async () => {
        const world = await createWorld([0, -9.81, 0]);
        const ground = addGround(world);
        const box = addSettledBox(world);

        expect(() => world.isSleeping(99)).toThrow();
        expect(() => world.setAwake(99, true)).toThrow();
        expect(() => world.setAwake(ground, false)).toThrow();
        expect(world.isSleeping(ground)).toBe(false);
        expect(world.isSleeping(box)).toBe(false);

        world.setAwake(box, false);
        expect(world.isSleeping(box)).toBe(true);
        world.step(DT);
        expect(world.isSleeping(box)).toBe(false);
        world.dispose();
    });
});
