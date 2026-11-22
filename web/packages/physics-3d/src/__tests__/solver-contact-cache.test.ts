import { describe, expect, it } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';
import { ContactSolverCache, HEADER_FLOATS, POINT_FLOATS } from '../core/physics-world-3d-solver';

/**
 * Focused coverage for the per-step contact solver cache introduced with the
 * physics-3d step optimisation, plus the behaviours the cache must not change:
 * warm-start geometry, the wake side effect of an applied impulse, and the
 * guarantee that static bodies are never written by the solver.
 */

const FIXED_STEP = 1 / 60;

type BodyId = ReturnType<PhysicsWorld3D['createBody']>;

const addGround = (world: PhysicsWorld3D): BodyId => {
    const ground = world.createBody({ type: 0, position: { x: 0, y: -0.5, z: 0 }, allowSleep: false });
    world.createBoxShape(ground, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 20, y: 0.5, z: 20 } });
    return ground;
};

const addBox = (
    world: PhysicsWorld3D,
    position: { x: number; y: number; z: number },
    options: { allowSleep?: boolean; linearVelocity?: { x: number; y: number; z: number } } = {}
): BodyId => {
    const id = world.createBody({
        type: 2,
        position,
        allowSleep: options.allowSleep ?? false,
        linearVelocity: options.linearVelocity,
    });
    world.createBoxShape(id, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
    return id;
};

describe('ContactSolverCache', () => {
    it('hands out one header plus one slot group per point, without gaps', () => {
        const cache = new ContactSolverCache();
        cache.reset();

        const first = cache.allocate(2);
        const second = cache.allocate(4);
        expect(first).toBe(0);
        expect(second).toBe(HEADER_FLOATS + 2 * POINT_FLOATS);
        expect(cache.values.length).toBeGreaterThanOrEqual(second + HEADER_FLOATS + 4 * POINT_FLOATS);
    });

    it('restarts block assignment on reset', () => {
        const cache = new ContactSolverCache();
        cache.allocate(3);
        cache.allocate(1);
        cache.reset();
        expect(cache.allocate(2)).toBe(0);
    });

    it('preserves earlier blocks when the buffer grows', () => {
        const cache = new ContactSolverCache();
        const first = cache.allocate(1);
        cache.values[first] = 12.5;

        // Force a reallocation far beyond the current capacity.
        const big = cache.allocate(100000);
        expect(cache.values.length).toBeGreaterThanOrEqual(big + HEADER_FLOATS + 100000 * POINT_FLOATS);
        expect(cache.values[first]).toBe(12.5);
    });

    it('keeps written values addressable across reads', () => {
        const cache = new ContactSolverCache();
        const offset = cache.allocate(2);
        const values = cache.values;
        values[offset] = 1;
        values[offset + HEADER_FLOATS + POINT_FLOATS + 6] = 3.75;
        expect(values[offset]).toBe(1);
        expect(values[offset + HEADER_FLOATS + POINT_FLOATS + 6]).toBe(3.75);
    });
});

describe('contact solver cache behaviour', () => {
    it('does not solve a manifold whose bodies moved away last step', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -9.81, z: 0 }, maxBodies: 8 });
        addGround(world);
        const box = addBox(world, { x: 0, y: 0.6, z: 0 });

        for (let step = 0; step < 60; step++) {
            world.step(FIXED_STEP);
        }
        expect(world.getStatistics().contactCount).toBeGreaterThan(0);
        const resting = world.getBody(box)!.getPosition().y;
        expect(resting).toBeLessThan(1);

        // Teleport clear of everything. The post-integration detection order
        // solves the manifold collected at the end of the previous step, so the
        // resting impulse is applied once more, then the pair is pruned by this
        // step's collect and never re-enters the solver.
        world.getBody(box)!.setPosition({ x: 40, y: 12, z: 40 });
        world.getBody(box)!.setLinearVelocity({ x: 0, y: 0, z: 0 });
        world.step(FIXED_STEP);

        expect(world.getStatistics().contactCount).toBe(0);
        const velocity = world.getBody(box)!.getLinearVelocity();
        expect(velocity.y).toBeCloseTo(0, 10);

        world.step(FIXED_STEP);
        expect(world.getBody(box)!.getLinearVelocity().y).toBeCloseTo(-9.81 * FIXED_STEP, 10);
        expect(Math.abs(world.getBody(box)!.getLinearVelocity().x)).toBe(0);
        expect(Math.abs(world.getBody(box)!.getLinearVelocity().z)).toBe(0);

        world[Symbol.dispose]();
    });

    it('wakes a sleeping body that receives a contact impulse', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -9.81, z: 0 }, maxBodies: 8 });
        addGround(world);

        // Approaching pair: the solver applies a normal impulse to both bodies.
        const sleeping = addBox(world, { x: 0, y: 1.05, z: 0 }, { allowSleep: true });
        const driver = addBox(world, { x: 0, y: 0.2, z: 0 }, { linearVelocity: { x: 0, y: 3, z: 0 } });
        // Control with no neighbours must stay asleep, which proves the wake
        // came from the contact solve and not from force integration.
        const lonely = addBox(world, { x: 60, y: 40, z: 60 }, { allowSleep: true });

        world.getBody(sleeping)!.setSleeping(true);
        world.getBody(lonely)!.setSleeping(true);
        expect(world.getBody(sleeping)!.isSleeping()).toBe(true);

        // Detection runs after position integration: the overlap this pair
        // already has is first collected at the end of step 1, so the impulse
        // that wakes `sleeping` lands in step 2's velocity solve.
        world.step(FIXED_STEP);
        expect(world.getBody(sleeping)!.isSleeping()).toBe(true);
        world.step(FIXED_STEP);

        expect(world.getBody(sleeping)!.isSleeping()).toBe(false);
        expect(world.getBody(lonely)!.isSleeping()).toBe(true);
        // allowSleep: false — the driver must never be parked by the sleep pass.
        expect(world.getBody(driver)!.isSleeping()).toBe(false);

        world[Symbol.dispose]();
    });

    it('leaves the static ground body untouched while boxes press on it', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -9.81, z: 0 }, maxBodies: 16 });
        const ground = addGround(world);
        for (let index = 0; index < 4; index++) {
            addBox(world, { x: index * 0.2 - 0.3, y: 0.7 + index * 1.05, z: index * 0.15 });
        }

        for (let step = 0; step < 120; step++) {
            world.step(FIXED_STEP);
        }

        const body = world.getBody(ground)!;
        const position = body.getPosition();
        const rotation = body.getRotation();
        const velocity = body.getLinearVelocity();
        expect(position.x).toBe(0);
        expect(position.y).toBe(-0.5);
        expect(position.z).toBe(0);
        expect(velocity.x).toBe(0);
        expect(velocity.y).toBe(0);
        expect(velocity.z).toBe(0);
        expect(rotation.x).toBe(0);
        expect(rotation.y).toBe(0);
        expect(rotation.z).toBe(0);
        expect(rotation.w).toBe(1);

        // The stack must still be supported: nothing fell through the ground.
        expect(world.getStatistics().contactCount).toBeGreaterThan(0);

        world[Symbol.dispose]();
    });
});
