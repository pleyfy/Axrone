import { describe, expect, it } from 'vitest';
import { WASM_PHYSICS_CAPABILITIES } from '../capabilities';
import { WasmPhysicsWorld3D } from '../index';
import { WasmPhysicsWorld3DCompat } from '../compat';

const DT = 1 / 60;

const kUnitBoxHull = [
    -0.5, -1.0, -1.5,
     0.5, -1.0, -1.5,
    -0.5,  1.0, -1.5,
     0.5,  1.0, -1.5,
    -0.5, -1.0,  1.5,
     0.5, -1.0,  1.5,
    -0.5,  1.0,  1.5,
     0.5,  1.0,  1.5
];

async function createWorld(gravity: readonly [number, number, number], maxBodies = 32, maxContacts = 2048): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts,
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

describe('bulk shape capabilities', () => {
    it('advertises hull, mesh and height field support', () => {
        expect(WASM_PHYSICS_CAPABILITIES.shapes.convexHull).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapes.triangleMesh).toBe(true);
        expect(WASM_PHYSICS_CAPABILITIES.shapes.heightField).toBe(true);
    });
});

describe('attachHull', () => {
    it('round-trips a box hull with raycast and resting behaviour', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            const ground = addGround(world);
            const body = world.createBody({ type: 'dynamic', position: [0, 4, 0] });
            const shapeId = world.attachHull(body, { vertices: kUnitBoxHull, density: 1 });
            expect(shapeId).toBeGreaterThan(0);
            expect(world.getShapeBody(shapeId)).toBe(body);

            const hit = world.raycastClosest([0, 5, 0], [0, -1, 0], 10);
            expect(hit).not.toBeNull();
            expect(hit!.body).toBe(body);
            expect(hit!.point[1]).toBeCloseTo(5, 3);

            for (let i = 0; i < 300; i += 1) {
                world.step(DT);
            }
            const transform = world.readTransform(body);
            expect(transform.position[1]).toBeCloseTo(1.0, 1);
            expect(world.contactCount).toBeGreaterThan(0);
            world.destroyBody(body);
            expect(ground).toBeGreaterThanOrEqual(0);
        } finally {
            world.dispose();
        }
    });

    it('rejects invalid vertex sources', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            const body = world.createBody({ type: 'dynamic', position: [0, 1, 0] });
            expect(() => world.attachHull(body, { vertices: [0, 0, 0, 1, 0, 0, Number.NaN, 1, 0, 0, 1, 1] })).toThrow();
            expect(() => world.attachHull(body, { vertices: [0, 0, 0, 1, 0, 0, 0] })).toThrow();
            expect(() => world.attachHull(body, { vertices: [0, 0, 0] })).toThrow();
            const coplanar = [-1, 0, -1, 1, 0, -1, -1, 0, 1, 1, 0, 1];
            expect(() => world.attachHull(body, { vertices: coplanar })).toThrow();
        } finally {
            world.dispose();
        }
    });

    it('refuses hull kinds through createBody shape shortcut', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            expect(() => world.createBody({
                position: [0, 1, 0],
                shape: { kind: 'hull', vertices: kUnitBoxHull } as never
            })).toThrow();
        } finally {
            world.dispose();
        }
    });

    it('reuses scratch addresses across many attach and destroy cycles', async () => {
        const world = await createWorld([0, 0, 0], 8, 64);
        try {
            const body = world.createBody({ type: 'static', position: [0, 0, 0] });
            let lastShape = -1;
            for (let cycle = 0; cycle < 150; cycle += 1) {
                const shapeId = world.attachHull(body, { vertices: kUnitBoxHull, density: 1 });
                expect(shapeId).toBeGreaterThan(0);
                if (lastShape >= 0) {
                    world.destroyShape(lastShape);
                }
                lastShape = shapeId;
            }
            world.destroyShape(lastShape);
            const revived = world.attachHull(body, { vertices: kUnitBoxHull, density: 1 });
            expect(revived).toBeGreaterThan(0);
            const hit = world.raycastClosest([0, 5, 0], [0, -1, 0], 10);
            expect(hit).not.toBeNull();
            expect(hit!.body).toBe(body);
        } finally {
            world.dispose();
        }
    });
});

describe('attachMesh', () => {
    const floorVertices = [
        -4, 0, -4,
         4, 0, -4,
         4, 0,  4,
        -4, 0,  4
    ];
    const floorIndices = [0, 1, 2, 0, 2, 3];

    it('stops a falling box on a static two-triangle floor', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            const floor = world.createBody({ type: 'static', position: [0, 0, 0] });
            const shapeId = world.attachMesh(floor, { vertices: floorVertices, indices: floorIndices });
            expect(shapeId).toBeGreaterThan(0);

            const box = world.createBody({
                position: [0, 3, 0],
                shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }
            });
            for (let i = 0; i < 240; i += 1) {
                world.step(DT);
            }
            const transform = world.readTransform(box);
            expect(transform.position[1]).toBeCloseTo(0.5, 1);

            const stray = world.createBody({
                position: [30, 3, 30],
                shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }
            });
            for (let i = 0; i < 60; i += 1) {
                world.step(DT);
            }
            for (const event of world.drainEvents()) {
                expect(event.bodyA === stray || event.bodyB === stray).toBe(false);
            }
        } finally {
            world.dispose();
        }
    });

    it('raycasts against mesh triangles', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            const floor = world.createBody({ type: 'static', position: [0, 0, 0] });
            world.attachMesh(floor, { vertices: floorVertices, indices: floorIndices });
            const hit = world.raycastClosest([1, 5, -2], [0, -1, 0], 10);
            expect(hit).not.toBeNull();
            expect(hit!.body).toBe(floor);
            expect(hit!.point[1]).toBeCloseTo(0, 4);
            const miss = world.raycastClosest([30, 5, 30], [0, -1, 0], 10);
            expect(miss).toBeNull();
        } finally {
            world.dispose();
        }
    });

    it('rejects meshes on dynamic and kinematic bodies', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            const dynamic = world.createBody({ type: 'dynamic', position: [0, 1, 0] });
            expect(() => world.attachMesh(dynamic, { vertices: floorVertices, indices: floorIndices })).toThrow();
            const kinematic = world.createBody({ type: 'kinematic', position: [0, 1, 0] });
            expect(() => world.attachMesh(kinematic, { vertices: floorVertices, indices: floorIndices })).toThrow();
        } finally {
            world.dispose();
        }
    });

    it('validates index payloads', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            const floor = world.createBody({ type: 'static', position: [0, 0, 0] });
            expect(() => world.attachMesh(floor, { vertices: floorVertices, indices: [0, 1, 99] })).toThrow();
            expect(() => world.attachMesh(floor, { vertices: floorVertices, indices: [0, 1] })).toThrow();
            expect(() => world.attachMesh(floor, { vertices: floorVertices, indices: [0, 1.5, 2] })).toThrow();
        } finally {
            world.dispose();
        }
    });
});

describe('attachHeightField', () => {
    it('rests a box on a flat field and answers downward rays', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            const field = world.createBody({ type: 'static', position: [0, 0, 0] });
            const heights: number[] = new Array(256).fill(1);
            const shapeId = world.attachHeightField(field, {
                width: 16,
                depth: 16,
                heights,
                scale: [1, 1, 1]
            });
            expect(shapeId).toBeGreaterThan(0);

            const hit = world.raycastClosest([0, 5, 0], [0, -1, 0], 20);
            expect(hit).not.toBeNull();
            expect(hit!.body).toBe(field);
            expect(hit!.point[1]).toBeCloseTo(1, 3);

            const box = world.createBody({
                position: [0, 4, 0],
                shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }
            });
            for (let i = 0; i < 300; i += 1) {
                world.step(DT);
            }
            expect(world.readTransform(box).position[1]).toBeCloseTo(1.5, 1);
        } finally {
            world.dispose();
        }
    });

    it('validates grid configuration', async () => {
        const world = await createWorld([0, -9.81, 0]);
        try {
            const field = world.createBody({ type: 'static', position: [0, 0, 0] });
            expect(() => world.attachHeightField(field, { width: 1, depth: 4, heights: [0, 0, 0, 0] })).toThrow();
            expect(() => world.attachHeightField(field, { width: 2, depth: 2, heights: [0, 0, 0] })).toThrow();
            expect(() => world.attachHeightField(field, { width: 2, depth: 2, heights: [0, Number.POSITIVE_INFINITY, 0, 0] })).toThrow();
            expect(() => world.attachHeightField(field, { width: 2, depth: 2, heights: [0, 0, 0, 0], scale: [1, 0, 1] })).toThrow();
            const dynamic = world.createBody({ type: 'dynamic', position: [0, 0, 0] });
            expect(() => world.attachHeightField(dynamic, { width: 2, depth: 2, heights: [0, 0, 0, 0] })).toThrow();
        } finally {
            world.dispose();
        }
    });
});

describe('bulk pool laziness', () => {
    it('keeps primitive-only worlds free of the bulk pool and bills uploaders for it', async () => {
        const world = await createWorld([0, -9.81, 0], 32, 256);
        try {
            const before = world.memoryBytes;
            addGround(world);
            world.createBody({ type: 'dynamic', position: [0, 4, 0], shape: { kind: 'sphere', radius: 0.5 } });
            world.createBody({ type: 'dynamic', position: [1, 5, 0], shape: { kind: 'capsule', radius: 0.25, halfSegment: 0.5 } });
            world.createBody({ type: 'dynamic', position: [2, 6, 0], shape: { kind: 'cylinder', radius: 0.3, halfHeight: 0.5 } });
            world.createBody({ type: 'dynamic', position: [3, 7, 0], shape: { kind: 'cone', radius: 0.3, halfHeight: 0.5 } });
            for (let i = 0; i < 120; i += 1) {
                world.step(DT);
            }
            expect(world.memoryBytes).toBe(before);
            expect(world.memoryBytes).toBeLessThan(4 * 1024 * 1024);

            const hull = world.createBody({ type: 'dynamic', position: [0, 9, 0] });
            world.attachHull(hull, { vertices: kUnitBoxHull, density: 1 });
            expect(world.memoryBytes).toBeGreaterThanOrEqual(before + 8 * 1024 * 1024);
        } finally {
            world.dispose();
        }
    });
});

describe('compat bulk shape adapters', () => {
    it('maps hull, mesh and height field descriptors onto the wasm facade', async () => {
        const world = await WasmPhysicsWorld3DCompat.create({ gravity: { x: 0, y: -9.81, z: 0 }, maxBodies: 32 });
        try {
            const staticBody = world.createBody({ type: 0, position: { x: 0, y: 0, z: 0 } });
            const hullBody = world.createBody({ type: 2, position: { x: 0, y: 4, z: 0 } });

            const hullShape = world.createHullShape(hullBody, {
                vertices: [
                    { x: -0.5, y: -1, z: -1.5 },
                    { x: 0.5, y: -1, z: -1.5 },
                    { x: -0.5, y: 1, z: -1.5 },
                    { x: 0.5, y: 1, z: -1.5 },
                    { x: -0.5, y: -1, z: 1.5 },
                    { x: 0.5, y: -1, z: 1.5 },
                    { x: -0.5, y: 1, z: 1.5 },
                    { x: 0.5, y: 1, z: 1.5 }
                ]
            }, { friction: 0.4, restitution: 0 });
            expect(hullShape).toBeGreaterThan(0);
            expect(world.getShapeBody(hullShape)).toBe(hullBody);

            const meshShape = world.createTriangleMeshShape(staticBody, {
                vertices: [
                    { x: -4, y: 0, z: -4 },
                    { x: 4, y: 0, z: -4 },
                    { x: 4, y: 0, z: 4 },
                    { x: -4, y: 0, z: 4 }
                ],
                indices: [0, 1, 2, 0, 2, 3],
                isSensor: false
            });
            expect(meshShape).toBeGreaterThan(0);

            const fieldShape = world.createHeightfieldShape(staticBody, {
                width: 4,
                depth: 4,
                heights: new Array(16).fill(0.5),
                scaleX: 1,
                scaleY: 1,
                scaleZ: 1
            });
            expect(fieldShape).toBeGreaterThan(0);

            let began = 0;
            world.setContactListener({
                onCollisionBegin: () => {
                    began += 1;
                }
            });
            for (let i = 0; i < 240; i += 1) {
                world.step(DT);
            }
            expect(began).toBeGreaterThan(0);
            expect(world.getTransform(hullBody).position[1]).toBeCloseTo(1.5, 1);
        } finally {
            world.dispose();
        }
    });

    it('rejects hull vertices missing coordinates', async () => {
        const world = await WasmPhysicsWorld3DCompat.create({ maxBodies: 8 });
        try {
            const body = world.createBody({ type: 2 });
            expect(() => world.createHullShape(body, { vertices: [{ x: 0, y: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 2 }] })).toThrow();
            expect(() => world.createHullShape(body, {})).toThrow();
        } finally {
            world.dispose();
        }
    });
});
