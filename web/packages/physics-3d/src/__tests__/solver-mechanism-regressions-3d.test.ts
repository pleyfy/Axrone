import { describe, expect, it } from 'vitest';
import { BodyType, type Friction, type Restitution } from '../types';
import type { BodyId3D } from '../types/physics-3d';
import { PhysicsWorld3D } from '../core/physics-world-3d';

const DT = 1 / 60;
const HALF = 0.4;
const VELOCITY_ITERATIONS = 10;

const newWorld = (allowSleepOff: boolean): PhysicsWorld3D =>
    new PhysicsWorld3D({
        gravity: { x: 0, y: -9.81, z: 0 },
        maxBodies: 64,
        maxShapes: 64,
        maxConstraints: 8,
        ...(allowSleepOff ? { allowSleep: false } : {}),
    });

const addBox = (
    world: PhysicsWorld3D,
    type: BodyType,
    position: { x: number; y: number; z: number },
    halfExtents: [number, number, number],
    friction: number,
    allowSleepOff: boolean
): BodyId3D => {
    const bodyId = world.createBody({
        type,
        position,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        ...(allowSleepOff ? { allowSleep: false } : {}),
    });
    world.createBoxShape(
        bodyId,
        { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: halfExtents[0], y: halfExtents[1], z: halfExtents[2] } },
        { friction: friction as Friction, restitution: 0 as Restitution }
    );
    if (type === BodyType.Dynamic) world.getBody(bodyId)?.resetMassData();
    return bodyId;
};

const buildStack = (count: number, allowSleepOff = true) => {
    const world = newWorld(allowSleepOff);
    const ground = addBox(world, BodyType.Static, { x: 0, y: -0.5, z: 0 }, [40, 0.5, 40], 0.8, allowSleepOff);
    const boxes: BodyId3D[] = [];
    for (let index = 0; index < count; index += 1) {
        boxes.push(addBox(world, BodyType.Dynamic, { x: 0, y: 0.8 + 0.8 * index, z: 0 }, [HALF, HALF, HALF], 0.7, allowSleepOff));
    }
    return { world, ground, boxes };
};

const stackHeights = (count: number, positionIterations: number): string => {
    const { world, boxes } = buildStack(count);
    for (let step = 0; step < 900; step += 1) world.step(DT, VELOCITY_ITERATIONS, positionIterations);
    const manager = world.getBodyManager();
    return boxes.map((box) => manager.getPosition(box).y.toFixed(6)).join(',');
};

describe('solver mechanisms the rest gate cannot see', () => {
    it('positionIterations changes the settled stack, so the parameter is not decorative', () => {
        const none = stackHeights(3, 0);
        const one = stackHeights(3, 1);
        const four = stackHeights(3, 4);
        expect(none).not.toBe(one);
        expect(one).not.toBe(four);
    });

    it('warm starting carries the settled load, reproducibly', () => {
        const { world, boxes } = buildStack(3);
        for (let step = 0; step < 900; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        const manager = world.getBodyManager();
        const heights = boxes.map((box) => manager.getPosition(box).y);
        expect(heights[0]).toBeCloseTo(0.3998857, 5);
        expect(heights[1]).toBeCloseTo(1.1996457, 5);
        expect(heights[2]).toBeCloseTo(1.9978863, 5);

        const diagnostics = world.getSolverDiagnostics();
        let absSum = 0;
        for (const entry of diagnostics.warmImpulses) absSum += Math.abs(entry.normal);
        expect(absSum).toBeGreaterThan(0.5);
    });

    it('a settled pair keeps a non-zero accumulated impulse record', () => {
        const { world, boxes } = buildStack(1);
        for (let step = 0; step < 200; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        const diagnostics = world.getSolverDiagnostics();
        expect(diagnostics.manifolds.length).toBeGreaterThan(0);
        let absSum = 0;
        for (const entry of diagnostics.warmImpulses) absSum += Math.abs(entry.normal);
        expect(absSum).toBeGreaterThan(0);
        let recordSum = 0;
        for (const manifold of diagnostics.manifolds) {
            for (const point of manifold.points) recordSum += Math.abs(Number(point.normalImpulse));
        }
        expect(recordSum).toBeGreaterThan(0);
        void boxes;
    });

    it('a begun pair survives a gap inside the break band', () => {
        const { world, ground } = buildStack(1);
        let begins = 0;
        let ends = 0;
        world.setContactListener({
            onCollisionBegin: () => { begins += 1; },
            onCollisionEnd: () => { ends += 1; },
        } as never);
        for (let step = 0; step < 200; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        expect(begins).toBe(1);
        expect(ends).toBe(0);

        const manager = world.getBodyManager();
        manager.setPosition(ground, { x: 0, y: manager.getPosition(ground).y - 0.005, z: 0 });
        for (let step = 0; step < 2; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        expect(ends).toBe(0);
        expect(begins).toBe(1);
    });

    it('a pair separated beyond the break band ends', () => {
        const { world, ground } = buildStack(1);
        let ends = 0;
        world.setContactListener({ onCollisionEnd: () => { ends += 1; } } as never);
        for (let step = 0; step < 200; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        expect(ends).toBe(0);
        const manager = world.getBodyManager();
        manager.setPosition(ground, { x: 0, y: manager.getPosition(ground).y - 0.05, z: 0 });
        for (let step = 0; step < 3; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        expect(ends).toBeGreaterThan(0);
    });

    it('a box resting on flat ground stays asleep under the shipped default', () => {
        const { world, boxes } = buildStack(1, false);
        const manager = world.getBodyManager();
        let sleptAtStep = 0;
        let asleepSteps = 0;
        for (let step = 1; step <= 900; step += 1) {
            world.step(DT, VELOCITY_ITERATIONS, 4);
            const asleep = !manager.isAwake(boxes[0]);
            if (asleep) {
                asleepSteps += 1;
                if (sleptAtStep === 0) sleptAtStep = step;
            }
        }
        expect(sleptAtStep).toBeGreaterThan(0);
        expect(asleepSteps).toBeGreaterThan(500);
    });

    it('a mixed-sleep pair does not receive a one-way warm-start kick', () => {
        const world = newWorld(true);
        const ground = addBox(world, BodyType.Static, { x: 0, y: -0.5, z: 0 }, [40, 0.5, 40], 0.8, true);
        const lower = addBox(world, BodyType.Dynamic, { x: 0, y: 0.4, z: 0 }, [HALF, HALF, HALF], 0.7, true);
        const upper = addBox(world, BodyType.Dynamic, { x: 0, y: 1.2, z: 0 }, [HALF, HALF, HALF], 0.7, true);
        const manager = world.getBodyManager();
        for (let step = 0; step < 400; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        manager.setAwake(lower, false);
        const upperVelBefore = manager.getLinearVelocity(upper).y;
        for (let step = 0; step < 3; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        const upperVelAfter = manager.getLinearVelocity(upper).y;
        expect(Math.abs(upperVelAfter - upperVelBefore)).toBeLessThan(0.001);
        void ground;
    });

    it('a low-speed separating pair inside the break band does not corrupt contactCount', () => {
        const world = newWorld(true);
        const ground = addBox(world, BodyType.Static, { x: 0, y: -0.5, z: 0 }, [40, 0.5, 40], 0.8, true);
        const box = addBox(world, BodyType.Dynamic, { x: 0, y: 0.42, z: 0 }, [HALF, HALF, HALF], 0.7, true);
        let begins = 0;
        let ends = 0;
        world.setContactListener({
            onCollisionBegin: () => { begins += 1; },
            onCollisionEnd: () => { ends += 1; },
        } as never);
        const manager = world.getBodyManager();
        for (let step = 0; step < 200; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        const yTouch = manager.getPosition(box).y;
        expect(world.getStatistics().contactCount).toBe(1);
        manager.setPosition(box, { x: 0, y: yTouch + 0.015, z: 0 });
        world.step(DT, VELOCITY_ITERATIONS, 4);
        expect(world.getStatistics().contactCount).toBe(0);
        expect(begins).toBe(1);
        expect(ends).toBe(0);
        manager.setPosition(box, { x: 0, y: yTouch - 0.005, z: 0 });
        world.step(DT, VELOCITY_ITERATIONS, 4);
        expect(world.getStatistics().contactCount).toBe(1);
        expect(begins).toBe(1);
        expect(ends).toBe(0);
        void ground;
    });

    it('a pair that never penetrates never begins even while its bounding boxes overlap inside the band', () => {
        const world = newWorld(true);
        const tilt = (10 * Math.PI) / 180;
        const slabRotation = { x: 0, y: 0, z: Math.sin(tilt / 2), w: Math.cos(tilt / 2) };
        const platform = world.createBody({
            type: BodyType.Static,
            position: { x: 0, y: 0, z: 0 },
            rotation: slabRotation,
        });
        world.createBoxShape(platform, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 3, y: 0.05, z: 0.5 } }, { friction: 0.7 as Friction, restitution: 0 as Restitution });
        const hover = world.createBody({
            type: BodyType.Kinematic,
            position: { x: 0, y: 0.115, z: 0 },
            rotation: slabRotation,
        });
        world.createBoxShape(hover, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 3, y: 0.05, z: 0.5 } }, { friction: 0.7 as Friction, restitution: 0 as Restitution });
        let begins = 0;
        let ends = 0;
        world.setContactListener({
            onCollisionBegin: () => { begins += 1; },
            onCollisionEnd: () => { ends += 1; },
        } as never);
        for (let step = 0; step < 30; step += 1) world.step(DT, VELOCITY_ITERATIONS, 4);
        expect(begins).toBe(0);
        expect(ends).toBe(0);
        expect(world.getStatistics().contactCount).toBe(0);
    });
});
