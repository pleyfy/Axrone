import { describe, it, expect } from 'vitest';
import { PhysicsWorld3D } from '@axrone/physics-3d';
import { Vec3, Quat, type IVec3Like, type IQuatLike } from '@axrone/numeric';

/**
 * D3 regression — hinge/fixed anchor-row Jacobian sign.
 *
 * The engine convention (configurable.ts + cone-twist.ts) is:
 *   j1Angular = -(rA × j1Linear)
 *   j2Angular = +(rB × j2Linear)
 *
 * Before the fix the hinge (rows 1–3) and fixed anchor rows used
 * j2Angular = -(rB × j2Linear), which connects the anchor row to the MIRRORED
 * anchor point. Under gravity that drove a hinged door UP instead of DOWN.
 *
 * These tests exercise the anchor rows with a NON-zero lever arm (rB != 0),
 * which is the only configuration where the sign error is observable. The
 * existing acceptance tests pin both bodies' anchors to their own centers
 * (rA = rB = 0), so they pass with or without the fix.
 */

const GRAVITY_DOWN: IVec3Like = { x: 0, y: -9.81, z: 0 };

function worldPoint(local: IVec3Like, position: IVec3Like, rotation: IQuatLike): IVec3Like {
    const rotated = Quat.rotateVector(rotation, local);
    return { x: position.x + rotated.x, y: position.y + rotated.y, z: position.z + rotated.z };
}

function dynamicBox(
    world: PhysicsWorld3D,
    position: IVec3Like,
    halfExtents: IVec3Like
): number {
    const bodyId = world.createBody({
        type: 2,
        position,
        linearDamping: 0,
        angularDamping: 0,
        allowSleep: false,
    });
    world.createBoxShape(bodyId, { center: { x: 0, y: 0, z: 0 }, halfExtents });
    world.getBody(bodyId)!.resetMassData();
    return bodyId;
}

describe('D3 hinge anchor rows — free pendulum', () => {
    it('hinged box swings DOWN under gravity and reaches the analytic pendulum bottom', () => {
        const pivotY = 3.6;
        const d = 0.9; // center-of-mass to pivot lever arm

        const world = new PhysicsWorld3D({ gravity: GRAVITY_DOWN });

        // Static frame pivot at (0, 3.6, 0).
        const anchor = world.createBody({ type: 0, position: { x: 0, y: pivotY, z: 0 } });

        // Door: box centered at its body origin, COM starts on the +x side at the
        // same height as the pivot (released from horizontal). The hinge anchor sits
        // at the door's -x face, so rB = (-0.9, 0, 0) — a real lever arm.
        const door = dynamicBox(world, { x: d, y: pivotY, z: 0 }, { x: d, y: 0.2, z: 0.2 });

        world.createHingeConstraint({
            bodyIdA: anchor, bodyIdB: door,
            localAnchorA: { x: 0, y: 0, z: 0 },
            localAnchorB: { x: -d, y: 0, z: 0 },
            localAxisA: { x: 0, y: 0, z: 1 },
            localAxisB: { x: 0, y: 0, z: 1 },
        });

        const startY = world.getBodyManager().getPosition(door).y;

        let lowest = startY;
        let lowestStep = 0;
        let wzAtLowest = 0;

        for (let i = 1; i <= 120; i++) {
            world.step(1 / 60, 10, 10);
            const pos = world.getBodyManager().getPosition(door);
            if (pos.y < lowest) {
                lowest = pos.y;
                lowestStep = i;
                wzAtLowest = world.getBodyManager().getAngularVelocity(door).z;
            }
        }

        // 1) The door must swing DOWN, not climb.
        expect(lowest).toBeLessThan(startY);
        expect(lowest).toBeLessThan(3.0); // triage activity gate: below y=3.0

        // 2) wz must be NEGATIVE while it descends from the +x side (τ_z = -m·g·d).
        expect(wzAtLowest).toBeLessThan(0);

        // 3) Lowest centre height matches the analytic pendulum: the COM traces a
        //    circle of radius d about the pivot, so the bottom of the arc is
        //    pivot.y - d = 3.6 - 0.9 = 2.700.
        expect(lowest).toBeGreaterThanOrEqual(2.55);
        expect(lowest).toBeLessThanOrEqual(2.85);

        // 4) It reaches the bottom within roughly a quarter period (~50 steps at
        //    dt = 1/60 for this door), not after a full swing or never.
        expect(lowestStep).toBeGreaterThan(10);
        expect(lowestStep).toBeLessThan(90);
    });
});

describe('D3 fixed anchor rows — hanging lever', () => {
    it('body locked to a static anchor keeps anchor error below 1e-3 and does not climb', () => {
        const pivotY = 3.6;
        const d = 0.9;

        const world = new PhysicsWorld3D({ gravity: GRAVITY_DOWN });

        const anchorPos: IVec3Like = { x: 0, y: pivotY, z: 0 };
        const anchor = world.createBody({ type: 0, position: anchorPos });

        // Lever locked rigidly to the anchor; the fixed joint holds orientation,
        // so gravity loads a cantilever whose anchor arm rB = (-0.9, 0, 0).
        const lever = dynamicBox(world, { x: d, y: pivotY, z: 0 }, { x: d, y: 0.2, z: 0.2 });

        const localAnchorA: IVec3Like = { x: 0, y: 0, z: 0 };
        const localAnchorB: IVec3Like = { x: -d, y: 0, z: 0 };

        world.createFixedConstraint({
            bodyIdA: anchor, bodyIdB: lever,
            localAnchorA, localAnchorB,
        });

        const startY = world.getBodyManager().getPosition(lever).y;

        let maxAnchorError = 0;
        let highestY = startY;

        for (let i = 0; i < 120; i++) {
            world.step(1 / 60, 10, 10);
            const posA = world.getBodyManager().getPosition(anchor);
            const rotA = world.getBodyManager().getRotation(anchor);
            const posB = world.getBodyManager().getPosition(lever);
            const rotB = world.getBodyManager().getRotation(lever);

            const worldA = worldPoint(localAnchorA, posA, rotA);
            const worldB = worldPoint(localAnchorB, posB, rotB);
            maxAnchorError = Math.max(maxAnchorError, Vec3.len(Vec3.subtract(worldB, worldA)));
            highestY = Math.max(highestY, posB.y);
        }

        // Anchor points must stay coincident.
        expect(maxAnchorError).toBeLessThan(1e-3);
        // The lever must not climb against gravity.
        expect(highestY).toBeLessThanOrEqual(startY + 1e-4);
    });
});
