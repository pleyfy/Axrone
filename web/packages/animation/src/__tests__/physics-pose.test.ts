import { describe, expect, it } from 'vitest';
import { blendWorldPose } from '../physics-pose';
import { AnimationPose } from '../pose';
import { AnimationRig } from '../rig';

const rig = new AnimationRig({
    bones: [
        { name: 'root' },
        { name: 'child', parent: 'root', translation: [0, 1, 0] },
    ],
});

describe('physics pose blending', () => {
    it('converts world transforms to local bone space', () => {
        const pose = new AnimationPose(rig.boneCount).reset(rig);
        const worldPositions = Float32Array.from([1, 0, 0, 1, 2, 0]);
        const worldRotations = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1]);

        blendWorldPose(rig, pose, worldPositions, worldRotations);

        expect(pose.translations[0]).toBeCloseTo(1, 5);
        expect(pose.translations[3]).toBeCloseTo(0, 5);
        expect(pose.translations[4]).toBeCloseTo(2, 5);
        expect(pose.rotations[7]).toBeCloseTo(1, 5);
    });

    it('removes the parent rotation when deriving local space', () => {
        const pose = new AnimationPose(rig.boneCount).reset(rig);
        const half = Math.SQRT1_2;
        const worldPositions = Float32Array.from([1, 0, 0, -1, 0, 0]);
        const worldRotations = Float32Array.from([0, 0, half, half, 0, 0, half, half]);

        blendWorldPose(rig, pose, worldPositions, worldRotations);

        expect(pose.translations[3]).toBeCloseTo(0, 4);
        expect(pose.translations[4]).toBeCloseTo(2, 4);
        expect(Math.abs(pose.rotations[7])).toBeCloseTo(1, 4);
    });

    it('honours the blend weight', () => {
        const pose = new AnimationPose(rig.boneCount).reset(rig);
        const worldPositions = Float32Array.from([2, 0, 0, 2, 1, 0]);
        const worldRotations = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1]);

        blendWorldPose(rig, pose, worldPositions, worldRotations, 0.25);

        expect(pose.translations[0]).toBeCloseTo(0.5, 5);
    });
});
