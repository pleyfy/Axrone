import { describe, expect, it } from 'vitest';
import { BodyType } from '../types';
import type { BodyId3D } from '../types/physics-3d';
import { PhysicsWorld3D } from '../core/physics-world-3d';

const DT = 1 / 60;
const HALF = 0.4;
const STEPS = 900;
const SETTLE_STEP = 60;
const VELOCITY_ITERATIONS = 10;
const POSITION_ITERATIONS = 4;

const makeWorld = (): PhysicsWorld3D =>
    new PhysicsWorld3D({
        gravity: { x: 0, y: -9.81, z: 0 },
        maxBodies: 64,
        maxShapes: 64,
        maxConstraints: 8,
        allowSleep: false,
    });

const addBox = (
    world: PhysicsWorld3D,
    type: BodyType,
    position: { x: number; y: number; z: number },
    halfExtents: [number, number, number],
    friction: number
): BodyId3D => {
    const bodyId = world.createBody({
        type,
        position,
        rotation: { x: 0, y: 0, z: 0, w: 1 },
        allowSleep: false,
    });
    world.createBoxShape(
        bodyId,
        { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: halfExtents[0], y: halfExtents[1], z: halfExtents[2] } },
        { friction, restitution: 0 }
    );
    if (type === BodyType.Dynamic) world.getBody(bodyId)?.resetMassData();
    return bodyId;
};

describe('rest stability of a single aligned box on flat ground', () => {
    it('keeps a released box upright, centred and non-rotating over 900 steps', () => {
        const world = makeWorld();
        addBox(world, BodyType.Static, { x: 0, y: -0.5, z: 0 }, [40, 0.5, 40], 0.8);
        const box = addBox(world, BodyType.Dynamic, { x: 0, y: 0.8, z: 0 }, [HALF, HALF, HALF], 0.7);
        const manager = world.getBodyManager();

        let maxTiltDegrees = 0;
        let maxLateral = 0;
        let maxOmega = 0;
        let lifecycleCount = 0;
        world.setContactListener({
            onCollisionBegin: () => { lifecycleCount += 1; },
            onCollisionEnd: () => { lifecycleCount += 1; },
        } as never);
        let settledAt = 0;
        for (let step = 0; step < STEPS; step += 1) {
            world.step(DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
            if (step === SETTLE_STEP) settledAt = lifecycleCount;
            const q = manager.getRotation(box);
            const norm = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
            const tilt = 2 * (Math.acos(Math.min(1, Math.abs(q.w) / norm)) * 180) / Math.PI;
            if (tilt > maxTiltDegrees) maxTiltDegrees = tilt;
            const p = manager.getPosition(box);
            const lateral = Math.sqrt(p.x * p.x + p.z * p.z);
            if (lateral > maxLateral) maxLateral = lateral;
            const av = manager.getAngularVelocity(box);
            const omega = Math.sqrt(av.x * av.x + av.y * av.y + av.z * av.z);
            if (omega > maxOmega) maxOmega = omega;
        }

        const finalY = manager.getPosition(box).y;
        expect(maxTiltDegrees).toBeLessThan(0.05);
        expect(Math.abs(finalY - 0.4)).toBeLessThanOrEqual(0.005);
        expect(maxLateral).toBeLessThan(0.005);
        expect(maxOmega).toBeLessThan(0.01);
        expect(lifecycleCount - settledAt).toBe(0);
    });
});
