import { describe, expect, it } from 'vitest';
import { makeCollisionPairKey } from '@axrone/physics-core';
import { DynamicAABBTree3D } from '../core/broadphase-3d';
import { PhysicsWorld3DBroadphase, type IBroadphaseHost } from '../core/physics-world-3d-broadphase';
import { SweepAndPrune3D } from '../core/broadphase-sweep-3d';
import type { ShapeId3D } from '../types/physics-3d';
import {
    BODY_TYPE_DYNAMIC,
    BODY_TYPE_STATIC,
    SHAPE_TYPE_BOX,
    type IAabb3D,
    type IShapeDescriptor3D,
} from '../core/physics-world-3d-shared';

interface IFakeShape {
    readonly id: number;
    readonly bodyId: number;
    readonly descriptor: IShapeDescriptor3D;
    readonly box: IAabb3D;
    vx: number;
    vy: number;
    vz: number;
    enabled: boolean;
    staticBody: boolean;
}

const SEED_COUNT = 200;
const STEP_COUNT = 12;
const DT = 1 / 60;

const makeRandom = (seed: number) => {
    let state = (seed * 1103515245 + 12345) >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
};

const quantize = (value: number) => Math.round(value * 2) / 2;

const buildScene = (seed: number): IFakeShape[] => {
    const rnd = makeRandom(seed);
    const count = 6 + Math.floor(rnd() * 34);
    const shapes: IFakeShape[] = [];
    for (let index = 0; index < count; index++) {
        const id = shapes.length + 1;
        const centerX = quantize((rnd() - 0.5) * 12);
        const centerY = quantize((rnd() - 0.5) * 12);
        const centerZ = quantize((rnd() - 0.5) * 12);
        const halfX = quantize(rnd() * 2);
        const halfY = quantize(rnd() * 2);
        const halfZ = quantize(rnd() * 2);
        const box: IAabb3D = {
            min: { x: centerX - halfX, y: centerY - halfY, z: centerZ - halfZ },
            max: { x: centerX + halfX, y: centerY + halfY, z: centerZ + halfZ },
        };
        const descriptor = {
            id,
            bodyId: id,
            type: SHAPE_TYPE_BOX,
            def: { kind: SHAPE_TYPE_BOX, center: { x: 0, y: 0, z: 0 }, halfExtents: { x: halfX, y: halfY, z: halfZ } },
            material: { friction: 0.4, restitution: 0, density: 1 },
            isSensor: false,
            filter: { categoryBits: 1, maskBits: 0xffffffff, groupIndex: 0 },
        } as unknown as IShapeDescriptor3D;
        shapes.push({
            id,
            bodyId: id,
            descriptor,
            box,
            vx: (rnd() - 0.5) * 6,
            vy: (rnd() - 0.5) * 6,
            vz: (rnd() - 0.5) * 6,
            enabled: rnd() > 0.1,
            staticBody: rnd() < 0.15,
        });
    }
    return shapes;
};

const buildHost = (shapes: IFakeShape[]): IBroadphaseHost => {
    const descriptors = new Map<ShapeId3D, IShapeDescriptor3D>();
    for (const shape of shapes) descriptors.set(shape.id as ShapeId3D, shape.descriptor);
    return {
        bodyManager: {
            isEnabled: (bodyId) => shapes[Number(bodyId) - 1]?.enabled ?? false,
            getBodyType: (bodyId) => (shapes[Number(bodyId) - 1]?.staticBody ? BODY_TYPE_STATIC : BODY_TYPE_DYNAMIC),
        },
        shapeDescriptors: descriptors,
        getCollisionFilter: () => null,
        computeShapeAabb: (descriptor) => shapes[Number(descriptor.id) - 1].box,
    };
};

const advanceScene = (shapes: IFakeShape[]) => {
    for (const shape of shapes) {
        if (!shape.enabled) continue;
        shape.box.min.x += shape.vx * DT;
        shape.box.min.y += shape.vy * DT;
        shape.box.min.z += shape.vz * DT;
        shape.box.max.x += shape.vx * DT;
        shape.box.max.y += shape.vy * DT;
        shape.box.max.z += shape.vz * DT;
    }
};

const keySet = (pairs: readonly { pairKey: number }[]) => {
    const set = new Set<number>();
    for (const pair of pairs) set.add(pair.pairKey);
    return set;
};

const setsEqual = (a: ReadonlySet<number>, b: ReadonlySet<number>) => {
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
};

const assertSetsEqual = (a: ReadonlySet<number>, b: ReadonlySet<number>, label: string) => {
    if (setsEqual(a, b)) return;
    const missing: number[] = [];
    const extra: number[] = [];
    for (const value of a) if (!b.has(value)) missing.push(value);
    for (const value of b) if (!a.has(value)) extra.push(value);
    throw new Error(`${label}: sizes ${a.size}/${b.size} missing ${missing.slice(0, 8).join(',')} extra ${extra.slice(0, 8).join(',')}`);
};

const rawTreeKeys = (tree: DynamicAABBTree3D<ShapeId3D>): Set<number> => {
    const set = new Set<number>();
    tree.queryPairs((a, b) => {
        const userDataA = tree.getUserData(a);
        const userDataB = tree.getUserData(b);
        if (userDataA !== null && userDataB !== null) {
            set.add(makeCollisionPairKey(Number(userDataA), Number(userDataB)));
        }
        return true;
    });
    return set;
};

const referenceKeys = (tree: DynamicAABBTree3D<ShapeId3D>): Set<number> => {
    const ids: number[] = [];
    const count = tree.collectLeafIds(ids);
    const set = new Set<number>();
    for (let i = 0; i < count; i++) {
        const a = ids[i];
        const userDataA = tree.getUserData(a);
        if (userDataA === null) continue;
        const boxA = tree.getAABB(a);
        for (let j = i + 1; j < count; j++) {
            const b = ids[j];
            const userDataB = tree.getUserData(b);
            if (userDataB === null) continue;
            const boxB = tree.getAABB(b);
            if (boxA.min.x > boxB.max.x || boxA.max.x < boxB.min.x) continue;
            if (boxA.min.y > boxB.max.y || boxA.max.y < boxB.min.y) continue;
            if (boxA.min.z > boxB.max.z || boxA.max.z < boxB.min.z) continue;
            set.add(makeCollisionPairKey(Number(userDataA), Number(userDataB)));
        }
    }
    return set;
};

const sweepOver = (tree: DynamicAABBTree3D<ShapeId3D>, axis: 'x' | 'y' | 'z'): Set<number> => {
    const sweep = new SweepAndPrune3D(axis);
    sweep.sync(tree);
    const set = new Set<number>();
    sweep.queryPairs((a, b) => {
        const userDataA = tree.getUserData(a);
        const userDataB = tree.getUserData(b);
        if (userDataA !== null && userDataB !== null) {
            set.add(makeCollisionPairKey(Number(userDataA), Number(userDataB)));
        }
        return true;
    });
    return set;
};

describe('broadphase sweep-and-prune vs dynamic AABB tree', () => {
    it(`reports the identical pair-key set on ${SEED_COUNT} randomised scenes`, () => {
        let stepsCompared = 0;
        let pairsCompared = 0;
        let nonEmptySteps = 0;

        for (let seed = 1; seed <= SEED_COUNT; seed++) {
            const shapes = buildScene(seed);
            const host = buildHost(shapes);
            const treeModule = new PhysicsWorld3DBroadphase(new DynamicAABBTree3D<ShapeId3D>(16), 'tree');
            const sweepModule = new PhysicsWorld3DBroadphase(new DynamicAABBTree3D<ShapeId3D>(16), 'sweep');

            for (let step = 0; step < STEP_COUNT; step++) {
                advanceScene(shapes);
                const treeKeys = keySet(treeModule.collectPotentialCollisionPairs(host));
                const sweepKeys = keySet(sweepModule.collectPotentialCollisionPairs(host));
                stepsCompared++;
                pairsCompared += treeKeys.size;
                if (treeKeys.size > 0) nonEmptySteps++;
                assertSetsEqual(treeKeys, sweepKeys, `seed ${seed} step ${step}`);
            }
        }

        expect(stepsCompared).toBe(SEED_COUNT * STEP_COUNT);
        expect(nonEmptySteps).toBeGreaterThan(SEED_COUNT);
        expect(pairsCompared).toBeGreaterThan(SEED_COUNT * 10);
    });

    it('matches a brute-force reference over the same boxes on all three axes', () => {
        for (let seed = 1; seed <= 40; seed++) {
            const shapes = buildScene(seed * 7919);
            const host = buildHost(shapes);
            const tree = new DynamicAABBTree3D<ShapeId3D>(16);
            const module = new PhysicsWorld3DBroadphase(tree, 'tree');
            for (let step = 0; step < STEP_COUNT; step++) {
                advanceScene(shapes);
                module.collectPotentialCollisionPairs(host);
                const raw = rawTreeKeys(tree);
                assertSetsEqual(raw, referenceKeys(tree), `seed ${seed} step ${step} tree-vs-reference`);
                for (const axis of ['x', 'y', 'z'] as const) {
                    assertSetsEqual(raw, sweepOver(tree, axis), `seed ${seed} step ${step} axis ${axis}`);
                }
            }
        }
    });

    it('keeps exactly-touching and zero-extent boxes in both pair sets', () => {
        const shapes = buildScene(424242);
        for (let index = 1; index < shapes.length; index++) {
            const previous = shapes[index - 1];
            const shape = shapes[index];
            const width = previous.box.max.x - previous.box.min.x;
            shape.box.min.x = previous.box.max.x;
            shape.box.max.x = previous.box.min.x + width;
            shape.box.min.y = previous.box.min.y;
            shape.box.max.y = previous.box.max.y;
            shape.box.min.z = previous.box.min.z;
            shape.box.max.z = previous.box.max.z;
            shape.vx = 0;
            shape.vy = 0;
            shape.vz = 0;
            shape.enabled = true;
            shape.staticBody = false;
        }
        const host = buildHost(shapes);
        const treeModule = new PhysicsWorld3DBroadphase(new DynamicAABBTree3D<ShapeId3D>(16), 'tree');
        const sweepModule = new PhysicsWorld3DBroadphase(new DynamicAABBTree3D<ShapeId3D>(16), 'sweep');
        for (let step = 0; step < STEP_COUNT; step++) {
            const treeKeys = keySet(treeModule.collectPotentialCollisionPairs(host));
            const sweepKeys = keySet(sweepModule.collectPotentialCollisionPairs(host));
            expect(treeKeys.size).toBeGreaterThan(0);
            assertSetsEqual(treeKeys, sweepKeys, `touching-boundary step ${step}`);
        }
    });

    it('is proven able to fail when a pair is dropped', () => {
        class DroppingSweep extends SweepAndPrune3D {
            private _dropped = false;
            queryPairs(callback: (a: number, b: number) => boolean): void {
                super.queryPairs((a, b) => {
                    if (!this._dropped) {
                        this._dropped = true;
                        return true;
                    }
                    return callback(a, b);
                });
            }
        }

        const shapes = buildScene(31337);
        const host = buildHost(shapes);
        const tree = new DynamicAABBTree3D<ShapeId3D>(16);
        const module = new PhysicsWorld3DBroadphase(tree, 'tree');
        advanceScene(shapes);
        module.collectPotentialCollisionPairs(host);
        const reference = referenceKeys(tree);
        expect(reference.size).toBeGreaterThan(1);

        const dropping = new DroppingSweep('x');
        dropping.sync(tree);
        const droppedKeys = new Set<number>();
        dropping.queryPairs((a, b) => {
            const userDataA = tree.getUserData(a);
            const userDataB = tree.getUserData(b);
            if (userDataA !== null && userDataB !== null) {
                droppedKeys.add(makeCollisionPairKey(Number(userDataA), Number(userDataB)));
            }
            return true;
        });
        expect(setsEqual(reference, droppedKeys)).toBe(false);
        expect(setsEqual(reference, new Set([...reference].slice(1)))).toBe(false);
    });
});
