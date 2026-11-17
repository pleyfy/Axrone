import { describe, it, expect } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';
import { BodyType, type Friction, type Restitution } from '@axrone/physics-core';

type BodyId = ReturnType<PhysicsWorld3D['createBody']>;

/**
 * P1-4: Kinematic body wakes sleeping dynamic contact neighbors (3D).
 *
 * Uses zero gravity + high damping + initial velocity to reliably produce
 * sleeping bodies (same pattern as the 2D test and existing 3D regression).
 * Then verifies kinematic movement wakes contacts.
 */
describe('Kinematic body wakes sleeping contacts 3D (P1-4)', () => {
    const DT = 1 / 60;

    function createWorld() {
        return new PhysicsWorld3D({
            gravity: { x: 0, y: 0, z: 0 }, // zero gravity for reliable sleeping
            allowSleep: true,
            maxBodies: 64,
            maxShapes: 64,
        });
    }

    /** Step until a body falls asleep, or maxSteps. Returns whether it slept. */
    function stepUntilAsleep(world: PhysicsWorld3D, bodyId: BodyId, maxSteps = 600): boolean {
        for (let i = 0; i < maxSteps; i++) {
            world.step(DT);
            if (!world.getBodyManager().isAwake(bodyId)) return true;
        }
        return false;
    }

    it('positive: sleeping body on kinematic platform wakes when platform moves', () => {
        const world = createWorld();
        const bm = world.getBodyManager();

        // Kinematic platform (large box)
        const platformId = world.createBody({
            type: BodyType.Kinematic,
            position: { x: 0, y: 0, z: 0 },
            allowSleep: false,
        });
        world.createBoxShape(platformId, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 5, y: 0.25, z: 5 },
        });

        // Dynamic body overlapping with platform (contact)
        const bodyOnPlatform = world.createBody({
            type: BodyType.Dynamic,
            position: { x: 0, y: 0.5, z: 0 },
            allowSleep: true,
            linearDamping: 8,
            angularDamping: 8,
        });
        world.createBoxShape(bodyOnPlatform, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        }, { density: 1 });

        // Give it initial velocity so it moves then settles
        bm.setLinearVelocity(bodyOnPlatform, { x: 3, y: 0, z: 0.5 });

        // Step until it falls asleep
        const slept = stepUntilAsleep(world, bodyOnPlatform);
        expect(slept).toBe(true);
        expect(bm.isAwake(bodyOnPlatform)).toBe(false);

        // Move the kinematic platform
        bm.setPosition(platformId, { x: 2, y: 0, z: 0 });

        // The body on the platform should be awake now
        expect(bm.isAwake(bodyOnPlatform)).toBe(true);

        world[Symbol.dispose]();
    });

    it('negative: far sleeping body does NOT wake when kinematic moves', () => {
        const world = createWorld();
        const bm = world.getBodyManager();

        // Kinematic platform
        const platformId = world.createBody({
            type: BodyType.Kinematic,
            position: { x: 0, y: 0, z: 0 },
            allowSleep: false,
        });
        world.createBoxShape(platformId, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 2, y: 0.25, z: 2 },
        });

        // Dynamic body on platform (overlapping)
        const bodyOnPlatform = world.createBody({
            type: BodyType.Dynamic,
            position: { x: 0, y: 0.5, z: 0 },
            allowSleep: true,
            linearDamping: 8,
            angularDamping: 8,
        });
        world.createBoxShape(bodyOnPlatform, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        }, { density: 1 });
        bm.setLinearVelocity(bodyOnPlatform, { x: 2, y: 0, z: 0.5 });

        // Dynamic body FAR AWAY (no contact with platform)
        const bodyFarAway = world.createBody({
            type: BodyType.Dynamic,
            position: { x: 200, y: 200, z: 200 },
            allowSleep: true,
            linearDamping: 8,
            angularDamping: 8,
        });
        world.createBoxShape(bodyFarAway, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        }, { density: 1 });
        bm.setLinearVelocity(bodyFarAway, { x: -1, y: -1, z: -0.5 });

        // Step until BOTH are asleep simultaneously
        let bothSlept = false;
        for (let i = 0; i < 600; i++) {
            world.step(DT);
            if (!bm.isAwake(bodyOnPlatform) && !bm.isAwake(bodyFarAway)) {
                bothSlept = true;
                break;
            }
        }
        expect(bothSlept).toBe(true);
        expect(bm.isAwake(bodyOnPlatform)).toBe(false);
        expect(bm.isAwake(bodyFarAway)).toBe(false);

        // Move kinematic
        bm.setPosition(platformId, { x: 5, y: 3, z: 1 });

        // On-platform body wakes
        expect(bm.isAwake(bodyOnPlatform)).toBe(true);

        // Far body MUST stay asleep — negative control
        expect(bm.isAwake(bodyFarAway)).toBe(false);

        world[Symbol.dispose]();
    });

    it('cost: dynamic body transform write does NOT trigger wake scan (RB-1 symmetry)', () => {
        const world = createWorld();
        const bm = world.getBodyManager();

        // Create a dynamic body with high damping
        const dynBody = world.createBody({
            type: BodyType.Dynamic,
            position: { x: 0, y: 0, z: 0 },
            allowSleep: true,
            linearDamping: 10,
            angularDamping: 10,
        });
        world.createBoxShape(dynBody, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        }, { density: 1 });
        bm.setLinearVelocity(dynBody, { x: 2, y: 1, z: 0.5 });

        // Let it fall asleep
        const slept = stepUntilAsleep(world, dynBody);
        expect(slept).toBe(true);

        // Writing position to a DYNAMIC body should NOT re-wake it
        // (setPosition only fires kinematic callback for bodyType === 1)
        bm.setPosition(dynBody, { x: 5, y: 5, z: 5 });

        // Body should still be asleep
        expect(bm.isAwake(dynBody)).toBe(false);

        world[Symbol.dispose]();
    });

    it('static body transform does NOT trigger kinematic wake scan', () => {
        const world = createWorld();
        const bm = world.getBodyManager();

        // Static body
        const staticBody = world.createBody({
            type: BodyType.Static,
            position: { x: 0, y: 0, z: 0 },
        });
        world.createBoxShape(staticBody, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 5, y: 0.25, z: 5 },
        });

        // Moving static body should NOT trigger kinematic callback
        bm.setPosition(staticBody, { x: 5, y: 0, z: 0 });

        // Static body transform was written successfully
        const pos = bm.getPosition(staticBody);
        expect(pos.x).toBe(5);

        world[Symbol.dispose]();
    });

    it('kinematic with no contacts — moving it has no effect on any sleeping body', () => {
        const world = createWorld();
        const bm = world.getBodyManager();

        // Kinematic body with no shapes (no contacts possible)
        const kinBody = world.createBody({
            type: BodyType.Kinematic,
            position: { x: 0, y: 0, z: 0 },
            allowSleep: false,
        });

        // Dynamic body far away, no contact
        const dynBody = world.createBody({
            type: BodyType.Dynamic,
            position: { x: 50, y: 50, z: 50 },
            allowSleep: true,
            linearDamping: 8,
        });
        world.createBoxShape(dynBody, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        }, { density: 1 });
        bm.setLinearVelocity(dynBody, { x: 1, y: 1, z: 0.5 });

        // Let dynamic body fall asleep
        const slept = stepUntilAsleep(world, dynBody);
        expect(slept).toBe(true);

        // Move kinematic (no contacts → no wake)
        bm.setPosition(kinBody, { x: 10, y: 5, z: 3 });

        // Dynamic body should still be asleep
        expect(bm.isAwake(dynBody)).toBe(false);

        world[Symbol.dispose]();
    });

    it('sleeping still works after kinematic wake feature (regression)', () => {
        // Critical regression: the existing sleeping mechanism must still work.
        const world = createWorld();
        const bm = world.getBodyManager();

        const body = world.createBody({
            type: BodyType.Dynamic,
            position: { x: 0, y: 0, z: 0 },
            allowSleep: true,
            linearDamping: 10,
            angularDamping: 10,
        });
        world.createBoxShape(body, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
        }, { density: 1 });

        bm.setLinearVelocity(body, { x: 3, y: 2, z: 1 });
        expect(bm.isAwake(body)).toBe(true);

        const slept = stepUntilAsleep(world, body);
        expect(slept).toBe(true);

        world[Symbol.dispose]();
    });

    it('a gap pair inside the break band does not wake a sleeping neighbour through the kinematic contact graph', () => {
        const world = new PhysicsWorld3D({
            gravity: { x: 0, y: -9.81, z: 0 },
            allowSleep: false,
            maxBodies: 64,
            maxShapes: 64,
        });
        const bm = world.getBodyManager();
        const HALF = 0.4;
        const sleeper = world.createBody({
            type: BodyType.Dynamic,
            position: { x: 0, y: 5, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
        });
        world.createBoxShape(sleeper, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: HALF, y: HALF, z: HALF },
        }, { friction: 0.7 as Friction, restitution: 0 as Restitution });
        world.getBody(sleeper)?.resetMassData();
        const kinematic = world.createBody({
            type: BodyType.Kinematic,
            position: { x: -3, y: 5, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
        });
        world.createBoxShape(kinematic, {
            center: { x: 0, y: 0, z: 0 },
            halfExtents: { x: HALF, y: HALF, z: HALF },
        }, { friction: 0.7 as Friction, restitution: 0 as Restitution });

        bm.setLinearVelocity(sleeper, { x: 0, y: 0, z: 0 }, false);
        bm.setAwake(sleeper, false);

        bm.setPosition(kinematic, { x: -0.79, y: 5, z: 0 });
        expect(bm.isAwake(sleeper)).toBe(false);
        world.step(DT, 10, 4);
        expect(bm.isAwake(sleeper)).toBe(false);
        world.step(DT, 10, 4);
        expect(bm.isAwake(sleeper)).toBe(false);

        bm.setPosition(kinematic, { x: -0.805, y: 5, z: 0 });
        world.step(DT, 10, 4);
        bm.setLinearVelocity(sleeper, { x: 0, y: 0, z: 0 }, false);
        bm.setAwake(sleeper, false);

        bm.setPosition(kinematic, { x: -0.806, y: 5.003, z: 0 });
        expect(bm.isAwake(sleeper)).toBe(false);
        world.step(DT, 10, 4);
        expect(bm.isAwake(sleeper)).toBe(false);

        world[Symbol.dispose]();
    });
});
