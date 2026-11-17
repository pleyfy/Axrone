import { describe, it, expect } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';

const STEP = 1 / 60;
const G = 9.81;
const ZERO = { x: 0, y: 0, z: 0 };

function makeGround(world: PhysicsWorld3D): number {
    const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 } });
    world.createBoxShape(ground, { center: ZERO, halfExtents: { x: 10, y: 0.5, z: 10 } }, { friction: 0.8, restitution: 0 });
    return ground;
}

function firstBeginByPair(
    world: PhysicsWorld3D,
    steps: number
): Map<string, number> {
    const firsts = new Map<string, number>();
    let currentStep = 0;
    world.setContactListener({
        onCollisionBegin: (event: any) => {
            const a = Number(event.bodyIdA);
            const b = Number(event.bodyIdB);
            const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
            if (!firsts.has(key)) firsts.set(key, currentStep);
        },
    });
    for (let i = 0; i < steps; i++) {
        currentStep = i + 1;
        world.step(STEP);
    }
    return firsts;
}

describe('D1 — contact detection order (post-integration manifolds)', () => {
    it('single sphere bounce on a plane: first begin at step 65', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 } });
        const ground = makeGround(world);
        const ball = world.createBody({ type: 2, position: { x: 0, y: 6, z: 0 }, allowSleep: false });
        world.createSphereShape(ball, { center: ZERO, radius: 0.3 }, { friction: 0.4, restitution: 0.2 });
        const firsts = firstBeginByPair(world, 200);
        expect(firsts.get(`${ground}-${ball}`)).toBe(65);
    });

    it('two falling boxes stacked laterally: first begins at step 9 and 13', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 } });
        const ground = makeGround(world);
        const b1 = world.createBody({ type: 2, position: { x: 0, y: 0.6, z: 0 }, allowSleep: false });
        world.createBoxShape(b1, { center: ZERO, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }, { friction: 0.4, restitution: 0 });
        const b2 = world.createBody({ type: 2, position: { x: 0.01, y: 1.7, z: 0 }, allowSleep: false });
        world.createBoxShape(b2, { center: ZERO, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }, { friction: 0.4, restitution: 0 });
        const firsts = firstBeginByPair(world, 180);
        expect(firsts.get(`${ground}-${b1}`)).toBe(9);
        expect(firsts.get(`${b1}-${b2}`)).toBe(12);

        const p1 = world.getBodyManager().getPosition(b1);
        const groundPen = 0 - (p1.y - 0.5);
        expect(groundPen).toBeLessThanOrEqual(0.023);
    });

    it('sensor passage with no ground: enter/exit window exactly steps 38..61', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 } });
        const sensor = world.createBody({ type: 0, position: { x: 0, y: 2.5, z: 0 } });
        world.createSphereShape(sensor, { center: ZERO, radius: 1.2 }, { friction: 0.4, restitution: 0 }, undefined, { isSensor: true });
        const ball = world.createBody({ type: 2, position: { x: 0, y: 6, z: 0 }, allowSleep: false });
        world.createSphereShape(ball, { center: ZERO, radius: 0.3 }, { friction: 0.4, restitution: 0.2 });
        let enter = -1;
        let exit = -1;
        let currentStep = 0;
        world.setContactListener({
            onSensorEnter: () => { if (enter < 0) enter = currentStep; },
            onSensorExit: () => { if (exit < 0) exit = currentStep; },
        });
        for (let i = 0; i < 120; i++) {
            currentStep = i + 1;
            world.step(STEP);
        }
        expect(enter).toBe(38);
        expect(exit).toBe(61);
    });
});

describe('D6 — one mass policy: inertia about the body origin', () => {
    it('L-shaped compound converges to the slop band instead of sinking', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 } });
        makeGround(world);
        const body = world.createBody({ type: 2, position: { x: 0, y: 3, z: 0 }, allowSleep: false });
        world.createBoxShape(body, { center: { x: 0, y: 0.1, z: 0 }, halfExtents: { x: 0.8, y: 0.1, z: 0.5 } }, { friction: 0.5, restitution: 0, density: 1 });
        world.createBoxShape(body, { center: { x: 0.7, y: 0.7, z: 0 }, halfExtents: { x: 0.1, y: 0.6, z: 0.5 } }, { friction: 0.5, restitution: 0, density: 1 });
        world.getBody(body).resetMassData();

        for (let i = 1; i <= 180; i++) {
            world.step(STEP);
        }
        const pos = world.getBodyManager().getPosition(body);
        expect(-pos.y).toBeLessThanOrEqual(0.01);

        let maxLin = 0;
        let maxAng = 0;
        for (let i = 181; i <= 240; i++) {
            world.step(STEP);
            const lv = world.getBodyManager().getLinearVelocity(body);
            const av = world.getBodyManager().getAngularVelocity(body);
            maxLin = Math.max(maxLin, Math.hypot(lv.x, lv.y, lv.z));
            maxAng = Math.max(maxAng, Math.hypot(av.x, av.y, av.z));
        }
        expect(maxLin).toBeLessThan(0.05);
        expect(maxAng).toBeLessThan(0.05);
    });

    it('asymmetric hammer compound: alpha = torque / I_origin within 2%', () => {
        const world = new PhysicsWorld3D({ gravity: ZERO });
        const body = world.createBody({ type: 2, position: ZERO, allowSleep: false });
        world.createBoxShape(body, { center: ZERO, halfExtents: { x: 0.3, y: 0.05, z: 0.05 } }, { density: 1 });
        world.createBoxShape(body, { center: { x: 0.6, y: 0, z: 0 }, halfExtents: { x: 0.1, y: 0.3, z: 0.1 } }, { density: 1 });
        world.getBody(body).resetMassData();

        const handleMass = 0.6 * 0.1 * 0.1;
        const headMass = 0.2 * 0.6 * 0.2;
        const handleIz = (handleMass / 12) * (0.6 * 0.6 + 0.1 * 0.1);
        const headIz = (headMass / 12) * (0.2 * 0.2 + 0.6 * 0.6) + headMass * 0.36;
        const iOrigin = handleIz + headIz;

        const inertia = world.getBodyManager().getInertiaTensor(body);
        expect(inertia.z).toBeCloseTo(iOrigin, 10);

        const torque = 0.01;
        world.getBody(body).applyTorque({ x: 0, y: 0, z: torque });
        world.step(STEP);
        const av = world.getBodyManager().getAngularVelocity(body);
        const alphaMeasured = av.z / STEP;
        const alphaExpected = torque / iOrigin;
        expect(Math.abs(alphaMeasured - alphaExpected) / alphaExpected).toBeLessThan(0.02);
    });

    it('resetMassData after adding a second offset shape: invMass equals the shape-mass sum within 1e-6', () => {
        const world = new PhysicsWorld3D({ gravity: ZERO });
        const body = world.createBody({ type: 2, position: ZERO, allowSleep: false });
        world.createSphereShape(body, { center: ZERO, radius: 0.5 }, { density: 1 });
        world.getBody(body).resetMassData();
        const m1 = (4 / 3) * Math.PI * 0.5 * 0.5 * 0.5;
        expect(world.getBodyManager().getMass(body)).toBeCloseTo(m1, 9);

        world.createBoxShape(body, { center: { x: 1, y: 0, z: 0 }, halfExtents: { x: 0.2, y: 0.2, z: 0.2 } }, { density: 1 });
        world.getBody(body).resetMassData();
        const m2 = m1 + 0.4 * 0.4 * 0.4;
        expect(world.getBodyManager().getMass(body)).toBeCloseTo(m2, 9);
        expect(world.getBodyManager().getInverseMass(body)).toBeCloseTo(1 / m2, 9);
    });
});

describe('D6 — managers inertia path matches the world path', () => {
    it('computeInertiaForBody equals resetMassData for an offset compound', () => {
        const world = new PhysicsWorld3D({ gravity: ZERO });
        const body = world.createBody({ type: 2, position: ZERO, allowSleep: false });
        world.createBoxShape(body, { center: ZERO, halfExtents: { x: 0.3, y: 0.05, z: 0.05 } }, { density: 1 });
        world.createBoxShape(body, { center: { x: 0.6, y: 0, z: 0 }, halfExtents: { x: 0.1, y: 0.3, z: 0.1 } }, { density: 1 });
        world.getBody(body).resetMassData();
        const worldInertia = world.getBodyManager().getInertiaTensor(body);
        const managerInertia = world.getBodyManager().computeInertiaForBody(body, world.getShapeManager());
        expect(managerInertia.x).toBeCloseTo(worldInertia.x, 9);
        expect(managerInertia.y).toBeCloseTo(worldInertia.y, 9);
        expect(managerInertia.z).toBeCloseTo(worldInertia.z, 9);
    });

    it('computeInertiaForBody: offset sphere carries its parallel-axis term', () => {
        const world = new PhysicsWorld3D({ gravity: ZERO });
        const body = world.createBody({ type: 2, position: ZERO, allowSleep: false });
        world.createSphereShape(body, { center: { x: 0, y: 1, z: 0 }, radius: 0.5 }, { density: 1 });
        world.getBody(body).resetMassData();
        const m = (4 / 3) * Math.PI * 0.125;
        const inertia = world.getBodyManager().computeInertiaForBody(body, world.getShapeManager());
        const own = 0.4 * m * 0.25;
        expect(inertia.x).toBeCloseTo(own + m, 9);
        expect(inertia.y).toBeCloseTo(own, 9);
        expect(inertia.z).toBeCloseTo(own + m, 9);
    });
});
