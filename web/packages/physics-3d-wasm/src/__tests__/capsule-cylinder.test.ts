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

describe('capsule and cylinder shapes', () => {
    it('reports capsule and cylinder capabilities', () => {
        expect(WASM_PHYSICS_CAPABILITIES.shapes.capsule).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapes.cylinder).toBe(true);
    });

    it('round-trips attachCapsule and attachCylinder shape ids', async () => {
        const world = await createGravitylessWorld();
        const body = world.createBody({ type: 'static' });

        const capsuleId = world.attachCapsule(body, { radius: 0.3, halfSegment: 0.4, density: 0 });
        const cylinderId = world.attachCylinder(body, { radius: 0.2, halfHeight: 0.5, density: 0, offset: [1, 0, 0] });

        expect(capsuleId).toBeGreaterThanOrEqual(0);
        expect(cylinderId).toBeGreaterThanOrEqual(0);
        expect(capsuleId).not.toBe(cylinderId);
        expect(world.getShapeBody(capsuleId)).toBe(body);
        expect(world.getShapeBody(cylinderId)).toBe(body);

        world.setShapeMaterial(capsuleId, 0.4, 0.1);
        const material = world.getShapeMaterial(capsuleId);
        expect(material[0]).toBeCloseTo(0.4, 5);
        expect(material[1]).toBeCloseTo(0.1, 5);

        world.destroyShape(capsuleId);
        expect(() => world.getShapeBody(capsuleId)).toThrow();
        expect(world.getShapeBody(cylinderId)).toBe(body);

        expect(() => world.attachCapsule(body, { radius: 0, halfSegment: 1 })).toThrow();
        expect(() => world.attachCapsule(body, { radius: 1, halfSegment: -0.001 })).toThrow();
        expect(() => world.attachCapsule(body, { radius: Number.NaN, halfSegment: 1 })).toThrow();
        expect(() => world.attachCylinder(body, { radius: 1, halfHeight: 0 })).toThrow();
        expect(() => world.attachCylinder(body, { radius: 1, halfHeight: 1, density: -1 })).toThrow();
        world.dispose();
    });

    it('rests a dynamic capsule upright on a static box', async () => {
        const world = await createWorld();
        addGround(world);
        const capsule = world.createBody({ position: [0, 1.5, 0], density: 1, friction: 0.7 });
        expect(world.attachCapsule(capsule, { radius: 0.25, halfSegment: 0.5 })).toBeGreaterThanOrEqual(0);

        for (let index = 0; index < 240; index += 1) {
            world.step(DT, { velocityIterations: 8, positionIterations: 3 });
        }

        const y = world.readTransform(capsule).position[1];
        expect(y).toBeGreaterThan(0.725);
        expect(y).toBeLessThan(0.752);
        expect(world.contactCount).toBeGreaterThanOrEqual(1);
        world.dispose();
    });

    it('rests a dynamic cylinder on a static box', async () => {
        const world = await createWorld();
        addGround(world);
        const cylinder = world.createBody({ position: [0, 1.2, 0], density: 1, friction: 0.7 });
        expect(world.attachCylinder(cylinder, { radius: 0.3, halfHeight: 0.4 })).toBeGreaterThanOrEqual(0);

        for (let index = 0; index < 240; index += 1) {
            world.step(DT, { velocityIterations: 8, positionIterations: 3 });
        }

        const y = world.readTransform(cylinder).position[1];
        expect(y).toBeGreaterThan(0.375);
        expect(y).toBeLessThan(0.402);
        expect(world.contactCount).toBeGreaterThanOrEqual(1);
        world.dispose();
    });

    it('raycasts against capsule surface and cylinder polytope', async () => {
        const world = await createGravitylessWorld();
        const capsuleBody = world.createBody({ type: 'static' });
        world.attachCapsule(capsuleBody, { radius: 0.2, halfSegment: 0.5, density: 0 });
        const cylinderBody = world.createBody({ type: 'static', position: [0, 0, -6] });
        world.attachCylinder(cylinderBody, { radius: 0.3, halfHeight: 0.5, density: 0 });

        const capsuleHits = world.raycast([-3, 0, 0], [1, 0, 0], 100);
        expect(capsuleHits).toHaveLength(1);
        expect(capsuleHits[0].body).toBe(capsuleBody);
        expect(capsuleHits[0].shape).toBeGreaterThanOrEqual(0);
        expect(capsuleHits[0].distance).toBeCloseTo(2.8, 3);
        expect(capsuleHits[0].normal[0]).toBeCloseTo(-1, 4);
        expect(capsuleHits[0].normal[1]).toBeCloseTo(0, 4);

        const capHits = world.raycast([0, 3, 0], [0, -1, 0], 100);
        expect(capHits.length).toBeGreaterThanOrEqual(1);
        expect(capHits[0].body).toBe(capsuleBody);
        expect(capHits[0].distance).toBeCloseTo(2.3, 3);
        expect(capHits[0].normal[1]).toBeCloseTo(1, 4);

        const cylinderHits = world.raycast([-3, 0, -6], [1, 0, 0], 100);
        expect(cylinderHits).toHaveLength(1);
        expect(cylinderHits[0].body).toBe(cylinderBody);
        expect(cylinderHits[0].distance).toBeCloseTo(2.7, 3);
        expect(cylinderHits[0].normal[0]).toBeCloseTo(-0.9239, 3);
        expect(Math.abs(cylinderHits[0].normal[2])).toBeCloseTo(0.3827, 3);
        world.dispose();
    });

    it('finds capsule and cylinder bodies with overlapSphere', async () => {
        const world = await createGravitylessWorld();
        const capsuleBody = world.createBody({ type: 'static', position: [-2, 0, 0] });
        world.attachCapsule(capsuleBody, { radius: 0.2, halfSegment: 0.5, density: 0 });
        const cylinderBody = world.createBody({ type: 'static', position: [2, 0, 0] });
        world.attachCylinder(cylinderBody, { radius: 0.3, halfHeight: 0.5, density: 0 });
        world.createBody({ type: 'static', position: [0, 0, -8], shape: { kind: 'sphere', radius: 0.1 } });

        expect(world.overlapSphere([0, 0, 0], 2.5).sort((a, b) => a - b)).toEqual([capsuleBody, cylinderBody]);
        expect(world.overlapSphere([0, 0, 0], 1)).toEqual([]);
        world.dispose();
    });

    it('creates bodies directly with capsule and cylinder shapes', async () => {
        const world = await createWorld();
        addGround(world);
        const capsule = world.createBody({
            position: [0, 1.4, 0],
            density: 1,
            shape: { kind: 'capsule', radius: 0.2, halfSegment: 0.4 }
        });
        const cylinder = world.createBody({
            position: [3, 1.1, 0],
            density: 1,
            shape: { kind: 'cylinder', radius: 0.25, halfHeight: 0.3 }
        });

        for (let index = 0; index < 240; index += 1) {
            world.step(DT, { velocityIterations: 8, positionIterations: 3 });
        }

        expect(world.readTransform(capsule).position[1]).toBeGreaterThan(0.5);
        expect(world.readTransform(capsule).position[1]).toBeLessThan(0.62);
        expect(world.readTransform(cylinder).position[1]).toBeGreaterThan(0.23);
        expect(world.readTransform(cylinder).position[1]).toBeLessThan(0.31);
        world.dispose();
    });

    it('maps compat capsule total height to halfSegment and cylinder height to halfHeight', async () => {
        const compat = await WasmPhysicsWorld3DCompat.create({ maxBodies: 32 });
        const ground = compat.createBody({ type: 0 });
        compat.createBoxShape(ground, { halfExtents: { x: 10, y: 0.5, z: 10 }, center: { y: -0.5 } });

        const capsuleBody = compat.createBody({ position: { y: 2.5 } });
        const capsuleId = compat.createCapsuleShape(capsuleBody, { radius: 0.5, height: 2.0 });
        expect(capsuleId).toBeGreaterThanOrEqual(0);
        expect(compat.getShapeBody(capsuleId)).toBe(capsuleBody);

        const cylinderBody = compat.createBody({ position: { x: 3, y: 2 } });
        const cylinderId = compat.createCylinderShape(cylinderBody, { radius: 0.4, height: 1.0 });
        expect(cylinderId).toBeGreaterThanOrEqual(0);

        compat.step(DT, 8, 3);
        for (let index = 0; index < 239; index += 1) {
            compat.step(DT, 8, 3);
        }

        const capsuleY = compat.getTransform(capsuleBody).position[1];
        expect(capsuleY).toBeGreaterThan(0.96);
        expect(capsuleY).toBeLessThan(1.01);

        const cylinderY = compat.getTransform(cylinderBody).position[1];
        expect(cylinderY).toBeGreaterThan(0.46);
        expect(cylinderY).toBeLessThan(0.51);

        expect(() => compat.createCapsuleShape(capsuleBody, { radius: 0.5 })).toThrow();
        expect(() => compat.createCapsuleShape(capsuleBody, { radius: 0, height: 2 })).toThrow();
        expect(() => compat.createCapsuleShape(capsuleBody, { radius: 0.5, height: Number.NaN })).toThrow();
        expect(() => compat.createCylinderShape(cylinderBody, { radius: -1, height: 1 })).toThrow();
        compat.dispose();
    });
});
