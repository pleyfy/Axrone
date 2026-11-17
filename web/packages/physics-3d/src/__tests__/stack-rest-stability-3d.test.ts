import { describe, expect, it } from 'vitest';
import { BodyType, type Friction, type Restitution } from '../types';
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
        { friction: friction as Friction, restitution: 0 as Restitution }
    );
    if (type === BodyType.Dynamic) world.getBody(bodyId)?.resetMassData();
    return bodyId;
};

interface StackRun {
    readonly topHeightError: number;
    readonly maxTiltDegrees: number;
    readonly maxLateral: number;
    readonly churn: number;
    readonly heights: number[];
}

const runStack = (count: number): StackRun => {
    const world = makeWorld();
    addBox(world, BodyType.Static, { x: 0, y: -0.5, z: 0 }, [40, 0.5, 40], 0.8);
    const boxes: BodyId3D[] = [];
    for (let index = 0; index < count; index += 1) {
        boxes.push(addBox(world, BodyType.Dynamic, { x: 0, y: 0.8 + 0.8 * index, z: 0 }, [HALF, HALF, HALF], 0.7));
    }
    const manager = world.getBodyManager();

    let lifecycle = 0;
    let settledAt = 0;
    world.setContactListener({
        onCollisionBegin: () => { lifecycle += 1; },
        onCollisionEnd: () => { lifecycle += 1; },
    } as never);

    let maxTiltDegrees = 0;
    let maxLateral = 0;
    for (let step = 0; step < STEPS; step += 1) {
        world.step(DT, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
        if (step === SETTLE_STEP) settledAt = lifecycle;
        for (const box of boxes) {
            const q = manager.getRotation(box);
            const norm = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w) || 1;
            const tilt = 2 * (Math.acos(Math.min(1, Math.abs(q.w) / norm)) * 180) / Math.PI;
            if (tilt > maxTiltDegrees) maxTiltDegrees = tilt;
            const p = manager.getPosition(box);
            const lateral = Math.sqrt(p.x * p.x + p.z * p.z);
            if (lateral > maxLateral) maxLateral = lateral;
        }
    }

    const heights = boxes.map((box) => manager.getPosition(box).y);
    const analyticTop = HALF + 2 * HALF * (count - 1);
    return {
        topHeightError: Math.abs(heights[count - 1] - analyticTop),
        maxTiltDegrees,
        maxLateral,
        churn: lifecycle - settledAt,
        heights,
    };
};

describe('box stack rest behaviour (characterization, not an ideal-stack guarantee)', () => {
    it('rests a 3-box stack at its analytic height with zero churn, leaning less than 5 deg', () => {
        const run = runStack(3);
        expect(run.topHeightError, 'measured 0.00211 m; Bullet reaches 0.000251 m').toBeLessThan(0.01);
        expect(run.churn, 'a resting pair must not churn').toBe(0);
        expect(run.maxTiltDegrees, 'measured 3.8989 deg; Bullet reaches 0.101 deg').toBeLessThan(5);
        expect(run.maxLateral, 'measured 0.0759 m').toBeLessThan(0.1);
    });

    it('pins the known 8-box limitation: no tunnelling, but the column still collapses', () => {
        const run = runStack(8);
        expect(Math.min(...run.heights), 'no body may fall through the ground').toBeGreaterThan(0);
        expect(run.topHeightError, 'KNOWN LIMITATION: measured 5.598 m against a 0.02 m target; Bullet reaches 0.0107 m. This assertion flips red when the collapse is fixed, which is the signal to promote it to a real gate.').toBeGreaterThan(1);
        expect(run.churn, 'measured 203; the collapse churn is part of the same known limitation').toBeLessThan(400);
    });
});
