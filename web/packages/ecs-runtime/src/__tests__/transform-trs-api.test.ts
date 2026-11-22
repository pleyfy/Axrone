import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { Mat4, Quat, Vec3 } from '@axrone/numeric';

const Z_AXIS = new Vec3(0, 0, 1);

describe('Transform atomic local TRS API', () => {
    let transform: Transform;

    beforeEach(() => {
        transform = new Transform();
    });

    afterEach(() => {
        transform.onDestroy();
    });

    it('setLocalTRS writes position, rotation and scale', () => {
        const position = new Vec3(1, -2, 3);
        const rotation = Quat.fromAxisAngle(Z_AXIS, 0.4, new Quat());
        const scale = new Vec3(2, 3, 4);

        transform.setLocalTRS(position, rotation, scale);

        expect(transform.position.x).toBe(1);
        expect(transform.position.y).toBe(-2);
        expect(transform.position.z).toBe(3);
        expect(transform.rotation.equals(rotation)).toBe(true);
        expect(transform.scale.x).toBe(2);
        expect(transform.scale.y).toBe(3);
        expect(transform.scale.z).toBe(4);
    });

    it('setLocalTRS bumps the revision exactly once', () => {
        const before = transform.revision;

        transform.setLocalTRS(new Vec3(1, 2, 3), Quat.IDENTITY, Vec3.ONE);

        expect(transform.revision).toBe((before + 1) >>> 0);
    });

    it('setLocalTRS bumps even when the values are unchanged (documented hot-path semantics)', () => {
        transform.setLocalTRS(new Vec3(1, 2, 3), Quat.IDENTITY, Vec3.ONE);
        const before = transform.revision;

        transform.setLocalTRS(new Vec3(1, 2, 3), Quat.IDENTITY, Vec3.ONE);

        expect(transform.revision).toBe((before + 1) >>> 0);
    });

    it('individual setters remain revision-neutral for unchanged values', () => {
        transform.position = new Vec3(5, 5, 5);
        const before = transform.revision;

        transform.position = new Vec3(5, 5, 5);
        transform.rotation = Quat.IDENTITY.clone();
        transform.scale = Vec3.ONE.clone();

        expect(transform.revision).toBe(before);
    });

    it('setLocalTRS2D writes the same quaternion as Quat.fromAxisAngle', () => {
        const angle = 0.73;
        transform.setLocalTRS2D(4, -6, angle, 2, 3);

        const expected = Quat.fromAxisAngle(Z_AXIS, angle, new Quat());

        expect(transform.rotation.x).toBe(0);
        expect(transform.rotation.y).toBe(0);
        expect(transform.rotation.z).toBe(expected.z);
        expect(transform.rotation.w).toBe(expected.w);
        expect(transform.position.x).toBe(4);
        expect(transform.position.y).toBe(-6);
        expect(transform.scale.x).toBe(2);
        expect(transform.scale.y).toBe(3);
    });

    it('setLocalTRS2D leaves Z translation and Z scale untouched', () => {
        transform.position = new Vec3(0, 0, 7);
        transform.scale = new Vec3(1, 1, 3);

        transform.setLocalTRS2D(1, 2, 0.25, 4, 5);

        expect(transform.position.z).toBe(7);
        expect(transform.scale.z).toBe(3);
    });

    it('setLocalTRS2D bumps the revision exactly once', () => {
        const before = transform.revision;

        transform.setLocalTRS2D(1, 2, Math.PI, 1, 1);

        expect(transform.revision).toBe((before + 1) >>> 0);
    });

    it('updates world state and the local matrix after an atomic write', () => {
        transform.setLocalTRS2D(2, 3, 0, 4, 4);

        expect(transform.worldPosition.x).toBe(2);
        expect(transform.worldPosition.y).toBe(3);
        expect(transform.worldMatrix.equals(Mat4.fromTRS(transform.position, transform.rotation, transform.scale))).toBe(
            true
        );
    });

    it('supports repeated per-frame writes without retaining stale values', () => {
        for (let index = 0; index < 10; index += 1) {
            transform.setLocalTRS2D(index, index * 2, index * 0.1, 1 + index, 1 + index);
        }

        expect(transform.position.x).toBe(9);
        expect(transform.position.y).toBe(18);
        expect(transform.scale.x).toBe(10);
        expect(transform.worldPosition.y).toBe(18);
    });
});
