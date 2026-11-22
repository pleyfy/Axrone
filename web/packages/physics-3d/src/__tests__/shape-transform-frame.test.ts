import { describe, expect, it } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';
import { refreshShapeFrame, resolveShapeFrame } from '../core/physics-world-3d-shape-geometry';
import {
    DEFAULT_FILTER,
    DEFAULT_MATERIAL,
    SHAPE_TYPE_BOX,
    SHAPE_TYPE_SPHERE,
    type IShapeDescriptor3D,
} from '../core/physics-world-3d-shared';
import type { BodyId3D, ShapeId3D } from '../types/physics-3d';

/**
 * Focused coverage for the per-step shape transform frame — the cache the
 * broadphase fills while computing AABBs and that the box–box narrowphase reads
 * instead of re-deriving centres, world rotations and basis axes per candidate
 * pair.
 *
 * These tests target the two ways a transform cache can be wrong while a
 * stack-settling benchmark still passes: reading a frame after its body moved,
 * and handing a frame-owned vector to something that outlives the step.
 */

const FIXED_STEP = 1 / 60;
const STATIC_BODY = 0;
const DYNAMIC_BODY = 2;
const KINEMATIC_BODY = 1;

const quatYaw = (radians: number) => ({
    x: 0,
    y: Math.sin(radians / 2),
    z: 0,
    w: Math.cos(radians / 2),
});

/**
 * Body/shape ids are branded, so tests that need a stand-alone descriptor
 * (without a world) build the ids through these helpers rather than lying with
 * `any`.
 */
const asBodyId = (value: bigint): BodyId3D => value as unknown as BodyId3D;
const asShapeId = (value: bigint): ShapeId3D => value as unknown as ShapeId3D;

const makeDescriptor = (
    bodyId: BodyId3D,
    id: ShapeId3D,
    def: IShapeDescriptor3D['def'] = {
        kind: SHAPE_TYPE_BOX,
        center: { x: 0.25, y: 0, z: 0 },
        halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    }
): IShapeDescriptor3D => ({
    id,
    bodyId,
    type: def.kind,
    def,
    material: { ...DEFAULT_MATERIAL },
    isSensor: false,
    filter: { ...DEFAULT_FILTER },
});

describe('shape transform frame', () => {
    it('reuses one frame object per shape and rewrites it per generation', () => {
        const descriptor = makeDescriptor(asBodyId(1n), asShapeId(1n));

        const first = refreshShapeFrame(descriptor, { x: 1.5, y: 2.5, z: 3.5 }, quatYaw(0), 1);
        const second = refreshShapeFrame(descriptor, { x: 4, y: 5, z: 6 }, quatYaw(Math.PI / 2), 2);

        expect(first).toBeTruthy();
        expect(second).toBe(first); // mutated in place, never reallocated
        expect(first!.bodyPosition.x).toBe(4);
        expect(first!.generation).toBe(2);
        // transformPoint3D of the local +0.25 centre offset, yawed 90 degrees,
        // lands on -Z of the body position.
        expect(first!.center.x).toBeCloseTo(4, 12);
        expect(first!.center.z).toBeCloseTo(6 - 0.25, 12);
        // World axes follow the same yaw.
        expect(first!.axes[0].x).toBeCloseTo(0, 12);
        expect(first!.axes[0].z).toBeCloseTo(-1, 12);
    });

    it('returns null instead of a frame for non-box shapes', () => {
        // A sphere-shaped def: the frame cache only serves the box narrowphase.
        const sphereDef = {
            kind: SHAPE_TYPE_SPHERE,
            radius: 0.5,
            center: { x: 0, y: 0, z: 0 },
        } as unknown as IShapeDescriptor3D['def'];
        const descriptor = makeDescriptor(asBodyId(1n), asShapeId(1n), sphereDef);

        expect(refreshShapeFrame(descriptor, { x: 0, y: 0, z: 0 }, quatYaw(0), 1)).toBeNull();
        expect(descriptor.frame ?? null).toBeNull();
    });

    it('recomputes rather than returning a frame from an older generation', () => {
        const descriptor = makeDescriptor(asBodyId(1n), asShapeId(1n));
        const manager = {
            position: { x: 7, y: 1, z: 1 },
            getPosition: () => manager.position,
            getRotation: () => quatYaw(0),
        };

        const fresh = resolveShapeFrame(descriptor, manager, 5);
        expect(fresh!.generation).toBe(5);
        expect(fresh!.center.x).toBe(7 + 0.25);

        // Force the stored frame stale, then move the body it belongs to.
        fresh!.generation = 2;
        manager.position = { x: -3, y: 1, z: 1 };
        const refreshed = resolveShapeFrame(descriptor, manager, 6);
        expect(refreshed!.generation).toBe(6);
        expect(refreshed!.center.x).toBe(-3 + 0.25);
    });

    it('finds the contact only after a rotated orientation is re-read', () => {
        // 0.05 m apart axis-aligned: no contact. Yawed 45 degrees the half
        // extent along X grows to 0.7071, so the boxes must overlap. A stale
        // orientation would keep this pair contact-free forever.
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: 0, z: 0 }, maxBodies: 8 });
        const anchor = world.createBody({ type: STATIC_BODY, position: { x: 0, y: 0, z: 0 }, allowSleep: false });
        world.createBoxShape(anchor, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        const swing = world.createBody({
            type: KINEMATIC_BODY,
            position: { x: 1.05, y: 0, z: 0 },
            rotation: quatYaw(0),
            allowSleep: false,
        });
        world.createBoxShape(swing, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        world.step(FIXED_STEP);
        expect(world.getStatistics().contactCount).toBe(0);

        world.getBody(swing)!.setRotation(quatYaw(Math.PI / 4));
        world.step(FIXED_STEP);
        expect(world.getStatistics().contactCount).toBeGreaterThan(0);

        world.getBody(swing)!.setRotation(quatYaw(0));
        world.step(FIXED_STEP);
        expect(world.getStatistics().contactCount).toBe(0);

        world[Symbol.dispose]();
    });

    it('does not leak a reused frame axis into the reported contact normal', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -9.81, z: 0 }, maxBodies: 8 });
        const ground = world.createBody({ type: STATIC_BODY, position: { x: 0, y: -0.5, z: 0 }, allowSleep: false });
        world.createBoxShape(ground, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 10, y: 0.5, z: 10 } });

        const captured: { x: number; y: number; z: number }[] = [];
        world.setContactListener({
            onCollisionBegin: (event) => {
                // Retain the manifold's normal object itself, not a copy: if the
                // solver handed out a frame-owned vector, later steps would
                // rewrite it through this reference.
                captured.push(event.manifold.normal as { x: number; y: number; z: number });
            },
        });

        const box = world.createBody({ type: DYNAMIC_BODY, position: { x: 0, y: 1.2, z: 0 }, allowSleep: false });
        world.createBoxShape(box, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        for (let step = 0; step < 60; step++) {
            world.step(FIXED_STEP);
        }
        expect(captured.length).toBeGreaterThan(0);
        const before = captured.map((normal) => ({ ...normal }));

        // A violent orientation change rewrites every frame axis in place.
        world.getBody(box)!.setRotation(quatYaw(Math.PI / 3));
        for (let step = 0; step < 30; step++) {
            world.step(FIXED_STEP);
        }

        captured.forEach((normal, index) => {
            expect(normal.x).toBe(before[index]!.x);
            expect(normal.y).toBe(before[index]!.y);
            expect(normal.z).toBe(before[index]!.z);
        });

        world[Symbol.dispose]();
    });
});

describe('island counting', () => {
    /** Kinematic boxes keep their overlap, so contact sets stay predictable. */
    const addPair = (world: PhysicsWorld3D, originX: number): void => {
        for (const offset of [0, 0.9]) {
            const id = world.createBody({
                type: KINEMATIC_BODY,
                position: { x: originX + offset, y: 0, z: 0 },
                allowSleep: false,
            });
            world.createBoxShape(id, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
        }
    };

    it('counts two disjoint contact groups as two islands', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: 0, z: 0 }, maxBodies: 16 });
        addPair(world, -20);
        addPair(world, 20);

        world.step(FIXED_STEP);

        expect(world.getStatistics().contactCount).toBe(2);
        expect(world.getStatistics().islandCount).toBe(2);

        world[Symbol.dispose]();
    });

    it('counts a three-body contact chain as one island', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: 0, z: 0 }, maxBodies: 16 });
        for (const offset of [0, 0.9, 1.8]) {
            const id = world.createBody({
                type: KINEMATIC_BODY,
                position: { x: -20 + offset, y: 0, z: 0 },
                allowSleep: false,
            });
            world.createBoxShape(id, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
        }

        world.step(FIXED_STEP);

        // Body 1 touches 2 and 2 touches 3, but 1 and 3 are 1.8 apart.
        expect(world.getStatistics().contactCount).toBe(2);
        expect(world.getStatistics().islandCount).toBe(1);

        world[Symbol.dispose]();
    });

    it('reports no islands when nothing is in contact', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: 0, z: 0 }, maxBodies: 16 });
        const near = world.createBody({ type: KINEMATIC_BODY, position: { x: -20, y: 0, z: 0 }, allowSleep: false });
        world.createBoxShape(near, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });
        const far = world.createBody({ type: KINEMATIC_BODY, position: { x: -19.1, y: 0, z: 0 }, allowSleep: false });
        world.createBoxShape(far, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

        world.step(FIXED_STEP);
        expect(world.getStatistics().contactCount).toBe(1);
        expect(world.getStatistics().islandCount).toBe(1);

        world.getBody(far)!.setPosition({ x: 40, y: 0, z: 0 });
        world.step(FIXED_STEP);

        expect(world.getStatistics().contactCount).toBe(0);
        expect(world.getStatistics().islandCount).toBe(0);

        world[Symbol.dispose]();
    });
});
