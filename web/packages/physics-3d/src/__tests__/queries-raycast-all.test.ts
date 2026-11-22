import { describe, it, expect } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';
import type { ShapeId3D } from '../types/physics-3d';

/**
 * D4 regression — rayCastAll must not clip the BVH traversal like a closest-hit query.
 *
 * Before the fix, the rayCastAll BVH callback returned `hit.fraction` per hit,
 * which `DynamicAABBTree3D.rayCast` then used as the new `maxFraction` — every
 * hit after the first pruned farther leaves. Which hits survived therefore
 * depended on tree topology / visit order, and the pre-first-step fallback path
 * (which never clipped) disagreed with the post-step BVH path.
 *
 * After the fix the rayCastAll callback returns the query's `maxFraction`
 * (no clipping), so every overlapping shape is tested. Closest-hit clipping
 * stays only in the rayCastClosest path.
 */

function staticBox(
    world: PhysicsWorld3D,
    position: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number }
): ShapeId3D {
    const bodyId = world.createBody({ type: 0, position });
    return world.createBoxShape(bodyId, { center: { x: 0, y: 0, z: 0 }, halfExtents });
}

function dynamicBox(
    world: PhysicsWorld3D,
    position: { x: number; y: number; z: number },
    halfExtents: { x: number; y: number; z: number }
): ShapeId3D {
    const bodyId = world.createBody({
        type: 2,
        position,
        linearDamping: 0,
        angularDamping: 0,
        allowSleep: false,
    });
    const shapeId = world.createBoxShape(bodyId, { center: { x: 0, y: 0, z: 0 }, halfExtents });
    world.getBody(bodyId)!.resetMassData();
    return shapeId;
}

describe('D4 rayCastAll — no closest-hit clipping', () => {
    it('three static boxes at different depths along the ray all return, at step 0 and after 60 steps', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -9.81, z: 0 } });

        // Three static boxes stacked along a downward ray at (x=3, z=0),
        // at clearly separated depths: near (~5), mid (~2.5), floor (~0).
        const floor = staticBox(world, { x: 0, y: 0, z: 0 }, { x: 20, y: 0.5, z: 20 });
        const mid = staticBox(world, { x: 3, y: 2.5, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 });
        const near = staticBox(world, { x: 3, y: 5, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 });
        const expected = new Set<ShapeId3D>([floor, mid, near]);

        const origin = { x: 3, y: 10, z: 0 };
        const direction = { x: 0, y: -1, z: 0 };
        const maxFraction = 15;

        // Step 0: broadphase tree is still empty → fallback scan path.
        const hitsStep0 = world.rayCastAll(origin, direction, maxFraction);
        expect(hitsStep0.length).toBe(3);
        for (const hit of hitsStep0) expect(expected.has(hit.shapeId)).toBe(true);

        // Fractions must be strictly ascending (the sort contract is preserved).
        for (let i = 1; i < hitsStep0.length; i++) {
            expect(hitsStep0[i].fraction).toBeGreaterThan(hitsStep0[i - 1].fraction);
        }

        // After 60 steps the BVH is populated → previously clipping path.
        for (let i = 0; i < 60; i++) world.step(1 / 60, 10, 10);

        const hitsAfter = world.rayCastAll(origin, direction, maxFraction);
        expect(hitsAfter.length).toBe(3);
        for (const hit of hitsAfter) expect(expected.has(hit.shapeId)).toBe(true);

        // Both paths must now agree on hit count and identity.
        const idsStep0 = hitsStep0.map((h) => h.shapeId).sort();
        const idsAfter = hitsAfter.map((h) => h.shapeId).sort();
        expect(idsAfter).toEqual(idsStep0);
    });

    it('P6: falling box + ground yields 2 hits at steps 0, 30 and 48', () => {
        const world = new PhysicsWorld3D({ gravity: { x: 0, y: -9.81, z: 0 } });

        const floorShape = staticBox(world, { x: 0, y: 0, z: 0 }, { x: 20, y: 0.5, z: 20 });

        // Dynamic box released from y=6, still above the floor at step 48.
        const boxShape = dynamicBox(world, { x: 0, y: 6, z: 0 }, { x: 0.5, y: 0.5, z: 0.5 });

        const origin = { x: 0, y: 12, z: 0 };
        const direction = { x: 0, y: -1, z: 0 };
        const maxFraction = 15;

        const expectedShapes = new Set<ShapeId3D>([floorShape, boxShape]);

        const assertBothHitsAt = (label: string, hits: readonly { shapeId: ShapeId3D }[]) => {
            const ids = new Set(hits.map((h) => h.shapeId));
            expect(hits.length, `hit count at ${label}`).toBe(2);
            expect(ids.has(floorShape), `floor hit at ${label}`).toBe(true);
            expect(ids.has(boxShape), `box hit at ${label}`).toBe(true);
        };

        assertBothHitsAt('step 0', world.rayCastAll(origin, direction, maxFraction));
        for (let i = 0; i < 30; i++) world.step(1 / 60, 10, 10);
        assertBothHitsAt('step 30', world.rayCastAll(origin, direction, maxFraction));
        for (let i = 0; i < 18; i++) world.step(1 / 60, 10, 10);
        assertBothHitsAt('step 48', world.rayCastAll(origin, direction, maxFraction));
    });
});
