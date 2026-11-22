import { describe, it, expect } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';
import type { Friction, Restitution } from '@axrone/physics-core';
import { Vec3, Quat } from '@axrone/numeric';

const STEP = 1 / 60;
const G = 9.81;

const R30 = { x: 0, y: 0, z: 0.25881904510252074, w: 0.9659258262890683 };

const dropDistance = (steps: number): number => G * STEP * STEP * (steps * (steps + 1)) / 2;

const firstOverlapStep = (gap: number): number => {
    for (let n = 1; n < 200; n++) {
        if (dropDistance(n) >= gap) return n;
    }
    throw new Error('no overlap');
};

function makeCapsuleDropWorld(capPosition: { x: number; y: number; z: number }, boxHalfExtents: { x: number; y: number; z: number }, boxTopY: number) {
    const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 } });
    const box = world.createBody({ type: 0, position: { x: 0, y: boxTopY - boxHalfExtents.y, z: 0 }, allowSleep: false });
    world.createBoxShape(box, { center: { x: 0, y: 0, z: 0 }, halfExtents: boxHalfExtents }, { friction: 0.8 as Friction, restitution: 0 as Restitution });
    const cap = world.createBody({ type: 2, position: capPosition, allowSleep: false });
    world.createCapsuleShape(cap, { p1: { x: 0, y: -0.2, z: 0 }, p2: { x: 0, y: 0.2, z: 0 }, radius: 0.3 }, { friction: 0.4 as Friction, restitution: 0 as Restitution });
    return { world, cap };
}

function simulateWithBegin(world: PhysicsWorld3D, steps: number): { begin: number; lastStep: number } {
    let begin = -1;
    let currentStep = 0;
    world.setContactListener({
        onCollisionBegin: () => { if (begin < 0) begin = currentStep; },
    });
    for (let i = 0; i < steps; i++) {
        currentStep = i + 1;
        world.step(STEP);
    }
    return { begin, lastStep: steps };
}

describe('capsule-vs-box narrowphase (defect D2)', () => {
    it('begins contact at the analytic step and rests on the box surface', () => {
        const gap = capSurfaceGap(2, 0);
        const overlapStep = firstOverlapStep(gap);
        expect(overlapStep).toBe(33);
        const { world, cap } = makeCapsuleDropWorld({ x: 0, y: 2, z: 0 }, { x: 10, y: 0.5, z: 10 }, 0);
        const { begin } = simulateWithBegin(world, 100);
        expect(begin).toBeGreaterThanOrEqual(overlapStep);
        expect(begin).toBeLessThanOrEqual(overlapStep + 1);
        const pos = world.getBodyManager().getPosition(cap);
        expect(pos.y).toBeGreaterThanOrEqual(0.45);
        expect(pos.y).toBeLessThanOrEqual(0.505);
    });

    it('capsule offset laterally off the box centre still contacts instead of falling through', () => {
        const { world, cap } = makeCapsuleDropWorld({ x: 3, y: 2, z: 4 }, { x: 10, y: 0.5, z: 10 }, 0);
        const { begin } = simulateWithBegin(world, 100);
        expect(begin).toBeGreaterThanOrEqual(33);
        expect(begin).toBeLessThanOrEqual(34);
        const pos = world.getBodyManager().getPosition(cap);
        expect(pos.y).toBeGreaterThanOrEqual(0.45);
        expect(pos.y).toBeLessThanOrEqual(0.505);
        expect(pos.x).toBeCloseTo(3, 3);
        expect(pos.z).toBeCloseTo(4, 3);
    });

    it('capsule dropped exactly over the box centre never throws', () => {
        const { world } = makeCapsuleDropWorld({ x: 0, y: 1.2, z: 0 }, { x: 2, y: 0.5, z: 2 }, 0);
        expect(() => {
            for (let i = 0; i < 150; i++) world.step(STEP);
        }).not.toThrow();
    });

    it('capsule resting on a small box begins at the analytic step and rests at 1.5 minus slop', () => {
        const gap = capSurfaceGap(2, 1);
        const overlapStep = firstOverlapStep(gap);
        expect(overlapStep).toBe(19);
        const { world, cap } = makeCapsuleDropWorld({ x: 0, y: 2, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 }, 1);
        const { begin } = simulateWithBegin(world, 100);
        expect(begin).toBeGreaterThanOrEqual(overlapStep);
        expect(begin).toBeLessThanOrEqual(overlapStep + 1);
        const pos = world.getBodyManager().getPosition(cap);
        expect(pos.y).toBeGreaterThanOrEqual(1.45);
        expect(pos.y).toBeLessThanOrEqual(1.505);
    });
});

const capSurfaceGap = (capCenterY: number, boxTopY: number): number => capCenterY - 0.5 - boxTopY;

describe('box-vs-box narrowphase (defect D5)', () => {
    it('rotated boxes in edge contact produce a normal perpendicular to both edge directions', () => {
        const rA = { x: -0.414372, y: -0.027588, z: 0.774915, w: -0.476489 };
        const rB = { x: 0.424386, y: 0.161246, z: -0.428616, w: -0.781143 };
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 } });
        const a = world.createBody({ type: 2, position: { x: 0, y: 0, z: 0 }, rotation: rA, allowSleep: false });
        world.createBoxShape(a, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
        const b = world.createBody({ type: 2, position: { x: -0.159743, y: 0.704474, z: 0.172544 }, rotation: rB, allowSleep: false });
        world.createBoxShape(b, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
        const normals: { x: number; y: number; z: number }[] = [];
        world.setContactListener({ onCollisionBegin: (e) => { if (normals.length === 0) normals.push({ ...e.manifold.normal }); } });
        world.step(STEP);
        expect(normals.length).toBe(1);
        const n = normals[0];
        const axesA = [Quat.rotateVector(rA, { x: 1, y: 0, z: 0 }), Quat.rotateVector(rA, { x: 0, y: 1, z: 0 }), Quat.rotateVector(rA, { x: 0, y: 0, z: 1 })];
        const axesB = [Quat.rotateVector(rB, { x: 1, y: 0, z: 0 }), Quat.rotateVector(rB, { x: 0, y: 1, z: 0 }), Quat.rotateVector(rB, { x: 0, y: 0, z: 1 })];
        const faceAlign = Math.max(...axesA.concat(axesB).map(ax => Math.abs(Vec3.dot(n, ax))));
        expect(faceAlign).toBeLessThan(0.99);
        let bestPairSum = 1;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const cross = Vec3.cross(axesA[i], axesB[j]);
                if (Vec3.len(cross) < 1e-3) continue;
                const sum = Math.abs(Vec3.dot(n, axesA[i])) + Math.abs(Vec3.dot(n, axesB[j]));
                if (sum < bestPairSum) bestPairSum = sum;
            }
        }
        expect(bestPairSum).toBeLessThan(1e-12);
    });

    it('box on a 30 degree ramp slides at the closed-form acceleration', () => {
        const mu = Math.sqrt(0.2 * 0.6);
        const theta = Math.PI / 6;
        const a = G * (Math.sin(theta) - mu * Math.cos(theta));
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 } });
        const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 }, allowSleep: false });
        world.createBoxShape(ground, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 10 } }, { friction: 0.8 as Friction, restitution: 0 as Restitution });
        const ramp = world.createBody({ type: 0, position: { x: -1.5, y: 1.2, z: 0 }, rotation: R30, allowSleep: false });
        world.createBoxShape(ramp, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 8, y: 0.3, z: 4 } }, { friction: 0.6 as Friction, restitution: 0 as Restitution });
        const slide = world.createBody({ type: 2, position: { x: -2.5660254, y: 1.0464102, z: 0 }, rotation: R30, allowSleep: false });
        world.createBoxShape(slide, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.35, y: 0.35, z: 0.35 } }, { friction: 0.2 as Friction, restitution: 0 as Restitution });
        const samples: number[] = [];
        for (let i = 1; i <= 60; i++) {
            world.step(STEP);
            if (i === 30 || i === 40 || i === 60) {
                const v = world.getBodyManager().getLinearVelocity(slide);
                samples.push(Math.hypot(v.x, v.y, v.z));
            }
        }
        const expected = [a * 30 * STEP, a * 40 * STEP, a * 60 * STEP];
        for (let k = 0; k < 3; k++) {
            const ratio = samples[k] / expected[k];
            expect(ratio).toBeGreaterThan(0.94);
            expect(ratio).toBeLessThan(1.1);
        }
    });

    it('offset two-box stack keeps lateral drift below one millimetre over 120 steps', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 } });
        const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 }, allowSleep: false });
        world.createBoxShape(ground, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 10 } }, { friction: 0.4 as Friction, restitution: 0 as Restitution });
        const bottom = world.createBody({ type: 2, position: { x: 0, y: 0.6, z: 0 }, allowSleep: false });
        world.createBoxShape(bottom, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }, { friction: 0.4 as Friction, restitution: 0 as Restitution });
        const top = world.createBody({ type: 2, position: { x: 0.01, y: 1.7, z: 0 }, allowSleep: false });
        world.createBoxShape(top, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } }, { friction: 0.4 as Friction, restitution: 0 as Restitution });
        for (let i = 0; i < 120; i++) world.step(STEP);
        const topPos = world.getBodyManager().getPosition(top);
        expect(Math.abs(topPos.x - 0.01)).toBeLessThan(0.001);
        expect(Math.abs(topPos.z)).toBeLessThan(0.001);
    });
});

describe('oriented box-box emission (M2 incident face selection)', () => {
    const TILT_X = Math.PI / 6;
    const SPIN_Z = Math.PI / 2;
    const tilt = { x: Math.sin(TILT_X / 2), y: 0, z: 0, w: Math.cos(TILT_X / 2) };
    const spin = { x: 0, y: 0, z: Math.sin(SPIN_Z / 2), w: Math.cos(SPIN_Z / 2) };
    const quatMul = (a: { x: number; y: number; z: number; w: number }, b: { x: number; y: number; z: number; w: number }) => ({
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    });

    it('emits the sphere-path separation convention on an oriented pair whose best-axis indices differ', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -G, z: 0 }, allowSleep: false });
        const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 } });
        world.createBoxShape(ground, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 2, y: 0.5, z: 2 } }, { friction: 0.8 as Friction, restitution: 0 as Restitution });
        const rot = quatMul(tilt, spin);
        const box = world.createBody({ type: 2, position: { x: 0, y: 0.35, z: 0 }, rotation: rot, allowSleep: false });
        world.createBoxShape(box, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.3, y: 0.5, z: 0.4 } }, { friction: 0.7 as Friction, restitution: 0 as Restitution });
        world.getBody(box)!.resetMassData();

        world.step(STEP);

        const { manifolds } = world.getSolverDiagnostics();
        expect(manifolds.length).toBeGreaterThan(0);
        const bodyA = world.getBody(manifolds[0].bodyIdA)!;
        const bodyB = world.getBody(manifolds[0].bodyIdB)!;
        const n = manifolds[0].normal;
        expect(manifolds[0].points.length).toBeGreaterThan(0);
        for (const pt of manifolds[0].points) {
            expect(pt.separation).toBeLessThan(0);
            const wA = bodyA.getWorldPoint(pt.localPointA);
            const wB = bodyB.getWorldPoint(pt.localPointB);
            const gap = (wB.x - wA.x) * n.x + (wB.y - wA.y) * n.y + (wB.z - wA.z) * n.z;
            expect(Math.abs(gap - pt.separation)).toBeLessThan(1e-9);
        }
    });

});
