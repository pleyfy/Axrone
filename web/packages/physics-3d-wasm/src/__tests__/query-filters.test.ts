import { describe, expect, it } from 'vitest';
import { WasmPhysicsWorld3D, loadEmbeddedWasm } from '../index';

async function createWorld(maxBodies = 32): Promise<WasmPhysicsWorld3D> {
    return WasmPhysicsWorld3D.create({
        maxBodies,
        maxContacts: Math.max(1024, maxBodies * 16),
        gravity: [0, -9.81, 0]
    });
}

function firstShapeId(body: number): number {
    return (1 << 21) | (body << 3) | 0;
}

function addStaticBox(
    world: WasmPhysicsWorld3D,
    position: readonly [number, number, number],
    halfExtents: readonly [number, number, number] = [0.5, 0.5, 0.5]
): number {
    return world.createBody({
        type: 'static',
        position,
        shape: { kind: 'box', halfExtents }
    });
}

function addStaticSphere(
    world: WasmPhysicsWorld3D,
    position: readonly [number, number, number],
    radius: number
): number {
    return world.createBody({
        type: 'static',
        position,
        shape: { kind: 'sphere', radius }
    });
}

describe('query filters', () => {
    it('raycastAllV2 keeps only shapes matching category and mask bits', async () => {
        const world = await createWorld();
        const near = addStaticBox(world, [0, 0, -5]);
        const far = addStaticBox(world, [0, 0, -9]);
        world.setShapeFilter(firstShapeId(near), 2, 2, 0);
        world.setShapeFilter(firstShapeId(far), 4, 4, 0);

        const onlyNear = world.raycastAllV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 2, maskBits: 2 });
        expect(onlyNear).toHaveLength(1);
        expect(onlyNear[0].body).toBe(near);

        const onlyFar = world.raycastAllV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 4, maskBits: 4 });
        expect(onlyFar).toHaveLength(1);
        expect(onlyFar[0].body).toBe(far);

        expect(world.raycastAllV2([0, 0, 0], [0, 0, -1], 100)).toHaveLength(2);
        expect(world.raycastAllV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 0, maskBits: 0 })).toHaveLength(2);
        expect(world.raycastAllV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 8, maskBits: 8 })).toHaveLength(0);
        world.dispose();
    });

    it('raycastClosestV2 honors the filter', async () => {
        const world = await createWorld();
        const near = addStaticBox(world, [0, 0, -5]);
        const far = addStaticBox(world, [0, 0, -9]);
        world.setShapeFilter(firstShapeId(near), 2, 2, 0);
        world.setShapeFilter(firstShapeId(far), 2, 2, 0);

        const hit = world.raycastClosestV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 2, maskBits: 2 });
        expect(hit).not.toBeNull();
        expect(hit?.body).toBe(near);

        expect(world.raycastClosestV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 4, maskBits: 4 })).toBeNull();
        world.dispose();
    });

    it('body-level group rules do not apply to queries', async () => {
        const world = await createWorld();
        const first = addStaticBox(world, [0, 0, -5]);
        const second = addStaticBox(world, [0, 0, -9]);
        world.setShapeFilter(firstShapeId(first), 1, 0xffff, -7);
        world.setShapeFilter(firstShapeId(second), 1, 0xffff, -7);

        expect(world.raycastAllV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 1, maskBits: 0xffff })).toHaveLength(2);
        expect(world.raycast([0, 0, 0], [0, 0, -1], 100)).toHaveLength(2);
        world.dispose();
    });

    it('overlapSphereV2 filters by shape category and mask', async () => {
        const world = await createWorld();
        const first = addStaticSphere(world, [0, 0, 0], 1);
        const second = addStaticSphere(world, [2.5, 0, 0], 1);
        world.setShapeFilter(firstShapeId(first), 2, 2, 0);
        world.setShapeFilter(firstShapeId(second), 4, 4, 0);

        expect(world.overlapSphereV2([1.25, 0, 0], 2, { categoryBits: 2, maskBits: 2 })).toEqual([first]);
        expect(world.overlapSphereV2([1.25, 0, 0], 2, { categoryBits: 4, maskBits: 4 })).toEqual([second]);
        expect(world.overlapSphereV2([1.25, 0, 0], 2)).toEqual([first, second]);
        world.dispose();
    });

    it('rejects invalid filter parameters', async () => {
        const world = await createWorld();
        addStaticBox(world, [0, 0, -5]);
        expect(() => world.raycastAllV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 1.5, maskBits: 1 })).toThrow();
        expect(() => world.raycastAllV2([0, 0, 0], [0, 0, -1], 100, { categoryBits: 1, maskBits: Number.NaN })).toThrow();
        expect(() => world.overlapSphereV2([0, 0, 0], 1, { categoryBits: 1, maskBits: 2 ** 31 })).toThrow();
        world.dispose();
    });
});

describe('reference fraction convention', () => {
    it('reports fraction against the un-normalized direction', async () => {
        const world = await createWorld();
        const box = addStaticBox(world, [0, 0, -5], [1, 1, 1]);

        const hits = world.raycastAllV2([0, 0, 0], [0, 0, -4], 100);
        expect(hits).toHaveLength(1);
        expect(hits[0].body).toBe(box);
        expect(hits[0].fraction).toBe(1);
        expect(hits[0].point[2]).toBeCloseTo(-4, 4);

        const slow = world.raycastAllV2([0, 0, 0], [0, 0, -0.5], 100);
        expect(slow[0].fraction).toBe(8);
        expect(slow[0].point[2]).toBeCloseTo(-4, 4);

        const closest = world.raycastClosestV2([0, 0, 0], [0, 0, -2], 100);
        expect(closest?.fraction).toBe(2);
        expect(closest?.point[2]).toBeCloseTo(-4, 4);

        const legacy = world.raycast([0, 0, 0], [0, 0, -4], 100);
        expect(legacy[0].distance).toBeCloseTo(4, 4);
        world.dispose();
    });

    it('keeps body, shape, point and normal in the fraction record', async () => {
        const world = await createWorld();
        const body = world.createBody({ type: 'static', position: [0, 0, 0] });
        const side = world.addBox(body, [1, 1, 1], 0, [2, 0, 0]);

        const hits = world.raycastAllV2([-5, 0, 0], [2, 0, 0], 30);
        expect(hits).toHaveLength(1);
        expect(hits[0].body).toBe(body);
        expect(hits[0].shape).toBe(side);
        expect(hits[0].fraction).toBe(3);
        expect(hits[0].point[0]).toBeCloseTo(1, 4);
        expect(hits[0].normal[0]).toBeCloseTo(-1, 4);
        world.dispose();
    });
});

describe('box and point overlap', () => {
    it('overlapBoxAll returns ascending body ids once per body', async () => {
        const world = await createWorld();
        const box = addStaticBox(world, [0, 0, 0], [1, 1, 1]);
        const sphere = addStaticSphere(world, [6, 0, 0], 1);
        const compound = world.createBody({ type: 'static', position: [0, 0, 0] });
        world.addSphere(compound, 1, 0, [12, 0, 0]);
        world.addSphere(compound, 1, 0, [14, 0, 0]);

        expect(world.overlapBoxAll([-2, -2, -2], [2, 2, 2])).toEqual([box]);
        expect(world.overlapBoxAll([4.5, -2, -2], [7.5, 2, 2])).toEqual([sphere]);
        expect(world.overlapBoxAll([-100, -100, -100], [100, 100, 100])).toEqual([box, sphere, compound]);
        expect(world.overlapBoxAll([1, -1, -1], [2, 1, 1])).toEqual([box]);
        expect(world.overlapBoxAll([2, -1, -1], [3, 1, 1])).toEqual([]);
        expect(world.overlapBoxAll([1, 1, 1], [-1, -1, -1])).toEqual([]);
        expect(world.overlapBoxAll([-100, -100, -100], [100, 100, 100], 2)).toEqual([box, sphere]);
        expect(world.overlapBoxAll([100, 100, 100], [101, 101, 101])).toEqual([]);
        world.dispose();
    });

    it('queryPointAll tests the degenerate box against body AABBs', async () => {
        const world = await createWorld();
        const box = addStaticBox(world, [0, 0, 0], [1, 1, 1]);
        const sphere = addStaticSphere(world, [6, 0, 0], 1);

        expect(world.queryPointAll([0, 0, 0])).toEqual([box]);
        expect(world.queryPointAll([1, 1, 1])).toEqual([box]);
        expect(world.queryPointAll([1.1, 0, 0])).toEqual([]);
        expect(world.queryPointAll([6, 0, 0])).toEqual([sphere]);
        expect(world.queryPointAll([5, 0, 0])).toEqual([sphere]);
        expect(world.queryPointAll([4.9, 0, 0])).toEqual([]);
        world.dispose();
    });

    it('validates arguments in the facade', async () => {
        const world = await createWorld();
        addStaticBox(world, [0, 0, 0], [1, 1, 1]);
        expect(() => world.overlapBoxAll([0, 0, Number.NaN], [1, 1, 1])).toThrow();
        expect(() => world.overlapBoxAll([0, 0, 0], [1, 1, 1], 0)).toThrow();
        expect(() => world.overlapBoxAll([0, 0, 0], [1, 1, 1], 1.5)).toThrow();
        expect(() => world.queryPointAll([0, Number.POSITIVE_INFINITY, 0])).toThrow();
        expect(() => world.queryPointAll([0, 0, 0], -1)).toThrow();
        world.dispose();
    });
});

describe('query v2 raw ABI', () => {
    it('keeps v1 exports unchanged while v2 adds filters and fraction', async () => {
        const wasm = await loadEmbeddedWasm();
        expect(wasm.worldInit(16, 256, 0, 0, 0)).toBe(0);

        const near = wasm.bodyCreate(0, 0, 0, -5, 0, 0, 0, 1);
        const nearShape = wasm.shapeCreateSphere(near, 1, 0, 0, 0, 0);
        expect(nearShape).toBeGreaterThanOrEqual(0);
        expect(wasm.shapeSetFilter(nearShape, 2, 2, 0)).toBe(0);
        const far = wasm.bodyCreate(0, 0, 0, -9, 0, 0, 0, 1);
        const farShape = wasm.shapeCreateSphere(far, 1, 0, 0, 0, 0);
        expect(wasm.shapeSetFilter(farShape, 4, 4, 0)).toBe(0);

        const scratch = wasm.queryScratchPtr();
        const hits = new Float32Array(wasm.memory.buffer, scratch, 20);
        const ids = new Int32Array(wasm.memory.buffer, scratch, 20);

        expect(wasm.raycastAll(0, 0, 0, 0, 0, -1, 100, scratch, 4)).toBe(2);
        expect(hits[2]).toBe(4);

        expect(wasm.raycastAllV2(0, 0, 0, 0, 0, -2, 100, 0, 0, scratch, 4)).toBe(2);
        expect(hits[2]).toBe(2);
        expect(hits[12]).toBe(4);

        expect(wasm.raycastAllV2(0, 0, 0, 0, 0, -1, 100, 4, 4, scratch, 4)).toBe(1);
        expect(ids[0]).toBe(far);
        expect(wasm.raycastClosestV2(0, 0, 0, 0, 0, -1, 100, 2, 2, scratch)).toBe(1);
        expect(ids[0]).toBe(near);
        expect(wasm.raycastClosestV2(0, 0, 0, 0, 0, -1, 100, 8, 8, scratch)).toBe(0);

        expect(wasm.overlapSphere(0, 0, -7, 3, scratch, 8)).toBe(2);
        expect(wasm.overlapSphereV2(0, 0, -7, 3, 2, 2, scratch, 8)).toBe(1);
        expect(ids[0]).toBe(near);
        expect(wasm.overlapSphereV2(0, 0, -7, 3, 4, 4, scratch, 8)).toBe(1);
        expect(ids[0]).toBe(far);
        expect(wasm.overlapSphereV2(0, 0, -7, 3, 1, 1, scratch, 8)).toBe(0);
    });

    it('rejects out-of-range output pointers for the new exports', async () => {
        const wasm = await loadEmbeddedWasm();
        expect(wasm.worldInit(16, 256, 0, 0, 0)).toBe(0);
        const body = wasm.bodyCreate(0, 0, 0, 0, 0, 0, 0, 1);
        expect(wasm.bodySetSphere(body, 1, 0)).toBe(0);

        const scratch = wasm.queryScratchPtr();
        const memoryBefore = wasm.worldMemoryBytes();

        expect(wasm.raycastAllV2(0, 0, -10, 0, 0, 1, 30, 1, 1, scratch + 1, 8)).toBe(0);
        expect(wasm.raycastAllV2(0, 0, -10, 0, 0, 1, 30, 1, 1, 0, 8)).toBe(0);
        expect(wasm.raycastAllV2(0, 0, -10, 0, 0, 1, 30, 1, 1, scratch, 1 << 26)).toBe(0);
        expect(wasm.raycastClosestV2(0, 0, -10, 0, 0, 1, 30, 1, 1, scratch + 1)).toBe(0);
        expect(wasm.overlapSphereV2(0, 0, 0, 10, 1, 1, scratch, -1)).toBe(0);
        expect(wasm.overlapBoxAll(scratch + 1, 8, -1, -1, -1, 1, 1, 1)).toBe(0);
        expect(wasm.overlapBoxAll(scratch, 0, -1, -1, -1, 1, 1, 1)).toBe(0);
        expect(wasm.overlapBoxAll(0, 8, -1, -1, -1, 1, 1, 1)).toBe(0);
        expect(wasm.queryPointAll(scratch, 1 << 26, 0, 0, 0)).toBe(0);

        const ids = new Int32Array(wasm.memory.buffer, scratch, 8);
        expect(wasm.overlapBoxAll(scratch, 8, -2, -2, -2, 2, 2, 2)).toBe(1);
        expect(ids[0]).toBe(body);
        expect(wasm.queryPointAll(scratch, 8, 0, 0, 0)).toBe(1);
        expect(ids[0]).toBe(body);
        expect(wasm.worldMemoryBytes()).toBe(memoryBefore);
    });
});
