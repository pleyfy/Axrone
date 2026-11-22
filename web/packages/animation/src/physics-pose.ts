import { SoaQuatBuffer } from '@axrone/numeric';
import type { AnimationPose } from './pose';
import type { AnimationRig } from './rig';

const _inverseParent = new Float32Array(4);
const _localRotation = new Float32Array(4);

const rotate = (q: Float32Array, offset: number, x: number, y: number, z: number): [number, number, number] => {
    const qx = q[offset]!;
    const qy = q[offset + 1]!;
    const qz = q[offset + 2]!;
    const qw = q[offset + 3]!;

    const tx = 2 * (qy * z - qz * y);
    const ty = 2 * (qz * x - qx * z);
    const tz = 2 * (qx * y - qy * x);

    return [
        x + qw * tx + (qy * tz - qz * ty),
        y + qw * ty + (qz * tx - qx * tz),
        z + qw * tz + (qx * ty - qy * tx),
    ];
};

/**
 * Blends physics-driven world body transforms onto an animation pose. The
 * animation-side half of a ragdoll: scales stay animation-owned, and local
 * rotations/translations are derived through the inverted physics parent.
 */
export const blendWorldPose = (
    rig: AnimationRig,
    target: AnimationPose,
    worldPositions: Float32Array,
    worldRotations: Float32Array,
    weight: number = 1
): AnimationPose => {
    if (worldPositions.length < rig.boneCount * 3 || worldRotations.length < rig.boneCount * 4) {
        throw new Error('Physics pose spans do not cover the rig');
    }

    const w = Math.max(0, Math.min(1, Number.isFinite(weight) ? weight : 0));
    if (w <= 0) {
        return target;
    }

    for (let orderIndex = 0; orderIndex < rig.evaluationOrder.length; orderIndex += 1) {
        const boneIndex = rig.evaluationOrder[orderIndex]!;
        const parentIndex = rig.parentIndices[boneIndex]!;
        const translationOffset = boneIndex * 3;
        const rotationOffset = boneIndex * 4;

        let px = worldPositions[translationOffset]!;
        let py = worldPositions[translationOffset + 1]!;
        let pz = worldPositions[translationOffset + 2]!;
        let qx = worldRotations[rotationOffset]!;
        let qy = worldRotations[rotationOffset + 1]!;
        let qz = worldRotations[rotationOffset + 2]!;
        let qw = worldRotations[rotationOffset + 3]!;

        if (parentIndex >= 0) {
            const parentTranslationOffset = parentIndex * 3;
            const parentRotationOffset = parentIndex * 4;
            SoaQuatBuffer.quatInvert(_inverseParent, 0, worldRotations, parentRotationOffset);
            const [lx, ly, lz] = rotate(
                _inverseParent,
                0,
                px - worldPositions[parentTranslationOffset]!,
                py - worldPositions[parentTranslationOffset + 1]!,
                pz - worldPositions[parentTranslationOffset + 2]!
            );
            px = lx;
            py = ly;
            pz = lz;

            SoaQuatBuffer.quatMultiply(
                _localRotation,
                0,
                _inverseParent,
                0,
                worldRotations,
                rotationOffset
            );
            qx = _localRotation[0]!;
            qy = _localRotation[1]!;
            qz = _localRotation[2]!;
            qw = _localRotation[3]!;
        }

        target.translations[translationOffset] =
            target.translations[translationOffset]! + (px - target.translations[translationOffset]!) * w;
        target.translations[translationOffset + 1] =
            target.translations[translationOffset + 1]! + (py - target.translations[translationOffset + 1]!) * w;
        target.translations[translationOffset + 2] =
            target.translations[translationOffset + 2]! + (pz - target.translations[translationOffset + 2]!) * w;

        _localRotation[0] = qx;
        _localRotation[1] = qy;
        _localRotation[2] = qz;
        _localRotation[3] = qw;
        SoaQuatBuffer.quatNormalize(_localRotation, 0, _localRotation, 0);
        SoaQuatBuffer.quatSlerp(
            target.rotations,
            rotationOffset,
            target.rotations,
            rotationOffset,
            _localRotation,
            0,
            w
        );
        SoaQuatBuffer.quatNormalize(target.rotations, rotationOffset, target.rotations, rotationOffset);
    }

    return target;
};
