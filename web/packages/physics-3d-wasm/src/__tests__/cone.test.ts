import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3D, WASM_PHYSICS_CAPABILITIES } from '../index';
import { WasmPhysicsWorld3DCompat } from '../compat';

const DT = 1 / 60;

async function createWorld(maxBodies = 64): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts: Math.max(1024, maxBodies * 16),
        gravity: [0, -9.81, 0]
    });
}

async function createGravitylessWorld(maxBodies = 16): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts: 1024,
        gravity: [0, 0, 0]
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

describe('cone shapes', () => {
    it('reports cone capability', () => {
        expect(WASM_PHYSICS_CAPABILITIES.shapes.cone).toBe(true);
    });

    it('round-trips attachCone shape ids', async () => {
        const world = await createGravitylessWorld();
        const body = world.createBody({ type: 'static' });

        const coneId = world.attachCone(body, { radius: 0.2, halfHeight: 0.5, density: 0, offset: [1, 0, 0] });
        expect(coneId).toBeGreaterThanOrEqual(0);
        expect(world.getShapeBody(coneId)).toBe(body);

        world.setShapeMaterial(coneId, 0.4, 0.1);
        const material = world.getShapeMaterial(coneId);
        expect(material[0]).toBeCloseTo(0.4, 5);
        expect(material[1]).toBeCloseTo(0.1, 5);

        world.destroyShape(coneId);
        expect(() => world.getShapeBody(coneId)).toThrow();

        expect(() => world.attachCone(body, { radius: 0, halfHeight: 1 })).toThrow();
        expect(() => world.attachCone(body, { radius: 1, halfHeight: 0 })).toThrow();
        expect(() => world.attachCone(body, { radius: Number.NaN, halfHeight: 1 })).toThrow();
        expect(() => world.attachCone(body, { radius: 1, halfHeight: 1, density: -1 })).toThrow();
        world.dispose();
    });

    it('rests a dynamic cone on a static box', async () => {
        const world = await createWorld();
        addGround(world);
        const cone = world.createBody({ position: [0, 1.2, 0], density: 1, friction: 0.7 });
        expect(world.attachCone(cone, { radius: 0.3, halfHeight: 0.4 })).toBeGreaterThanOrEqual(0);

        for (let index = 0; index < 240; index += 1) {
            world.step(DT, { velocityIterations: 8, positionIterations: 3 });
        }

        const y = world.readTransform(cone).position[1];
        expect(y).toBeGreaterThan(0.375);
        expect(y).toBeLessThan(0.415);
        expect(world.contactCount).toBeGreaterThanOrEqual(1);
        world.dispose();
    });

    it('creates a body directly with a cone shape', async () => {
        const world = await createWorld();
        addGround(world);
        const cone = world.createBody({
            position: [0, 1.1, 0],
            density: 1,
            shape: { kind: 'cone', radius: 0.25, halfHeight: 0.3 }
        });

        for (let index = 0; index < 240; index += 1) {
            world.step(DT, { velocityIterations: 8, positionIterations: 3 });
        }

        const y = world.readTransform(cone).position[1];
        expect(y).toBeGreaterThan(0.28);
        expect(y).toBeLessThan(0.32);
        world.dispose();
    });

    it('raycasts against the slanted cone polytope faces', async () => {
        const world = await createGravitylessWorld();
        const coneBody = world.createBody({ type: 'static' });
        world.attachCone(coneBody, { radius: 0.3, halfHeight: 0.5, density: 0 });

        const hits = world.raycast([-3, 0, 0], [1, 0, 0], 100);
        expect(hits).toHaveLength(1);
        expect(hits[0].body).toBe(coneBody);
        expect(hits[0].distance).toBeGreaterThan(2.8);
        expect(hits[0].distance).toBeLessThan(2.9);
        expect(hits[0].normal[0]).toBeLessThan(-0.5);
        expect(hits[0].normal[1]).toBeGreaterThan(0.1);

        const miss = world.raycast([-3, 0.8, 0], [1, 0, 0], 100);
        expect(miss).toHaveLength(0);

        const capHits = world.raycast([0, 3, 0], [0, -1, 0], 100);
        expect(capHits.length).toBeGreaterThanOrEqual(1);
        expect(capHits[0].body).toBe(coneBody);
        expect(capHits[0].distance).toBeCloseTo(2.5, 3);
        world.dispose();
    });

    it('uses the cone polytope for overlap queries', async () => {
        const world = await createGravitylessWorld();
        const coneBody = world.createBody({ type: 'static', position: [3, 0, 0] });
        world.attachCone(coneBody, { radius: 0.3, halfHeight: 0.5, density: 0 });

        expect(world.overlapSphere([0, 0, 0], 2.85)).toEqual([coneBody]);
        expect(world.overlapSphere([0, 0, 0], 2.72)).toEqual([]);
        world.dispose();
    });

    it('emits multi-point manifolds for cylinder and cone pairs', async () => {
        const world = await createGravitylessWorld(32);
        const lower = world.createBody({ type: 'static' });
        world.attachCylinder(lower, { radius: 0.3, halfHeight: 0.5, density: 0 });
        const upper = world.createBody({ position: [0, 0.985, 0], density: 1 });
        world.attachCylinder(upper, { radius: 0.3, halfHeight: 0.5, density: 1 });

        world.step(DT);
        expect(world.contactCount).toBeGreaterThanOrEqual(2);
        world.dispose();
    });

    it('maps compat cone full height to halfHeight', async () => {
        const compat = await WasmPhysicsWorld3DCompat.create({ maxBodies: 32 });
        const ground = compat.createBody({ type: 0 });
        compat.createBoxShape(ground, { halfExtents: { x: 10, y: 0.5, z: 10 }, center: { y: -0.5 } });

        const coneBody = compat.createBody({ position: { y: 2 } });
        const coneId = compat.createConeShape(coneBody, { radius: 0.3, height: 0.8 });
        expect(coneId).toBeGreaterThanOrEqual(0);
        expect(compat.getShapeBody(coneId)).toBe(coneBody);

        for (let index = 0; index < 240; index += 1) {
            compat.step(DT, 8, 3);
        }

        const coneY = compat.getTransform(coneBody).position[1];
        expect(coneY).toBeGreaterThan(0.375);
        expect(coneY).toBeLessThan(0.415);

        expect(() => compat.createConeShape(coneBody, { radius: 0.3 })).toThrow();
        expect(() => compat.createConeShape(coneBody, { radius: 0, height: 1 })).toThrow();
        expect(() => compat.createConeShape(coneBody, { radius: 0.3, height: Number.NaN })).toThrow();
        compat.dispose();
    });
});
