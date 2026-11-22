import { describe, expect, it } from 'vitest';
import { AnimationIkLayer } from '../ik';
import { AnimationPose, AnimationWorldPose } from '../pose';
import { AnimationRig } from '../rig';

const makeArmRig = (): AnimationRig =>
    new AnimationRig({
        bones: [
            { name: 'root' },
            { name: 'upper', parent: 'root', translation: [1, 0, 0] },
            { name: 'lower', parent: 'upper', translation: [1, 0, 0] },
        ],
    });

const worldPositions = (
    rig: AnimationRig,
    pose: AnimationPose
): ReadonlyMap<string, readonly [number, number, number]> => {
    const world = new AnimationWorldPose(rig.boneCount).update(rig, pose);
    const result = new Map<string, readonly [number, number, number]>();
    for (let index = 0; index < rig.boneCount; index += 1) {
        result.set(rig.boneNames[index]!, [
            world.translations[index * 3]!,
            world.translations[index * 3 + 1]!,
            world.translations[index * 3 + 2]!,
        ]);
    }
    return result;
};

describe('two-bone IK', () => {
    it('places the tip on a reachable target', () => {
        const rig = makeArmRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'arm',
            jobs: [
                {
                    id: 'reach',
                    solver: 'twoBone',
                    rootBone: 'root',
                    tipBone: 'lower',
                    targetPosition: [1.5, 0, 0],
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const tip = worldPositions(rig, pose).get('lower')!;
        expect(tip[0]).toBeCloseTo(1.5, 4);
        expect(tip[1]).toBeCloseTo(0, 4);
        expect(tip[2]).toBeCloseTo(0, 4);
    });

    it('stops at full extension instead of hyperextending', () => {
        const rig = makeArmRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'arm',
            jobs: [
                {
                    id: 'reach',
                    solver: 'twoBone',
                    rootBone: 'root',
                    tipBone: 'lower',
                    targetPosition: [9, 0, 0],
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const positions = worldPositions(rig, pose);
        const tip = positions.get('lower')!;
        const mid = positions.get('upper')!;

        const upperLength = Math.hypot(mid[0] - 0, mid[1], mid[2]);
        const lowerLength = Math.hypot(tip[0] - mid[0], tip[1] - mid[1], tip[2] - mid[2]);
        expect(upperLength).toBeCloseTo(1, 4);
        expect(lowerLength).toBeCloseTo(1, 4);
        expect(tip[0]).toBeCloseTo(2, 4);
    });

    it('bends the mid joint toward the pole vector', () => {
        const rig = makeArmRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'arm',
            jobs: [
                {
                    id: 'reach',
                    solver: 'twoBone',
                    rootBone: 'root',
                    tipBone: 'lower',
                    targetPosition: [1.5, 0, 0],
                    polePosition: [0, 1, 0],
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const mid = worldPositions(rig, pose).get('upper')!;
        expect(mid[1]).toBeGreaterThan(0.1);
    });

    it('keeps the mid joint on the opposite side when the pole flips', () => {
        const rig = makeArmRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'arm',
            jobs: [
                {
                    id: 'reach',
                    solver: 'twoBone',
                    rootBone: 'root',
                    tipBone: 'lower',
                    targetPosition: [1.5, 0, 0],
                    polePosition: [0, -1, 0],
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const mid = worldPositions(rig, pose).get('upper')!;
        expect(mid[1]).toBeLessThan(-0.1);
    });

    it('respects the minimum bend angle', () => {
        const rig = makeArmRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'arm',
            jobs: [
                {
                    id: 'reach',
                    solver: 'twoBone',
                    rootBone: 'root',
                    tipBone: 'lower',
                    targetPosition: [0.2, 0, 0],
                    minBendDegrees: 20,
                    polePosition: [0, 1, 0],
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const positions = worldPositions(rig, pose);
        const mid = positions.get('upper')!;
        const tip = positions.get('lower')!;

        const rootToMid = Math.hypot(mid[0], mid[1], mid[2]);
        const rootToTip = Math.hypot(tip[0], tip[1], tip[2]);
        const dot =
            (mid[0] * tip[0] + mid[1] * tip[1] + mid[2] * tip[2]) /
            Math.max(1e-6, rootToMid * rootToTip);
        const bendDegrees = (Math.acos(Math.min(1, Math.max(-1, dot))) * 180) / Math.PI;

        expect(bendDegrees).toBeGreaterThanOrEqual(20 - 1e-3);
    });

    it('rejects a chain that is not three bones', () => {
        const rig = new AnimationRig({
            bones: [
                { name: 'root' },
                { name: 'mid', parent: 'root' },
            ],
        });

        expect(
            () =>
                new AnimationIkLayer(rig, {
                    id: 'arm',
                    jobs: [
                        {
                            id: 'reach',
                            solver: 'twoBone',
                            rootBone: 'root',
                            tipBone: 'mid',
                            targetPosition: [1, 0, 0],
                        },
                    ],
                })
        ).toThrow(/Three-bone|three bones/);
    });

    it('takes the bend plane from a pole bone', () => {
        const rig = new AnimationRig({
            bones: [
                { name: 'root' },
                { name: 'upper', parent: 'root', translation: [1, 0, 0] },
                { name: 'lower', parent: 'upper', translation: [1, 0, 0] },
                { name: 'pole', parent: 'root', translation: [0, 1, 0] },
            ],
        });
        const layer = new AnimationIkLayer(rig, {
            id: 'arm',
            jobs: [
                {
                    id: 'reach',
                    solver: 'twoBone',
                    rootBone: 'root',
                    tipBone: 'lower',
                    targetPosition: [1.5, 0, 0],
                    poleBone: 'pole',
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const mid = worldPositions(rig, pose).get('upper')!;
        expect(mid[1]).toBeGreaterThan(0.1);
    });

    it('rejects inverted bend limits', () => {
        const rig = makeArmRig();

        expect(
            () =>
                new AnimationIkLayer(rig, {
                    id: 'arm',
                    jobs: [
                        {
                            id: 'reach',
                            solver: 'twoBone',
                            rootBone: 'root',
                            tipBone: 'lower',
                            targetPosition: [1, 0, 0],
                            minBendDegrees: 120,
                            maxBendDegrees: 30,
                        },
                    ],
                })
        ).toThrow(/bend limits/);
    });

    it('rejects an out-of-range aim angle', () => {
        const rig = makeArmRig();

        expect(
            () =>
                new AnimationIkLayer(rig, {
                    id: 'head',
                    jobs: [
                        {
                            id: 'look',
                            solver: 'aim',
                            rootBone: 'root',
                            tipBone: 'root',
                            targetPosition: [1, 0, 0],
                            maxAimAngleDegrees: 200,
                        },
                    ],
                })
        ).toThrow(/max aim angle/);
    });
});

describe('aim solver', () => {
    const makeHeadRig = (): AnimationRig =>
        new AnimationRig({
            bones: [{ name: 'head' }],
        });

    const forwardOf = (rig: AnimationRig, pose: AnimationPose): readonly [number, number, number] => {
        const world = new AnimationWorldPose(rig.boneCount).update(rig, pose);
        const qx = world.rotations[0]!;
        const qy = world.rotations[1]!;
        const qz = world.rotations[2]!;
        const qw = world.rotations[3]!;

        // Rotate the local +Z axis by the world rotation.
        const tx = 2 * (qy * 1 - qz * 0);
        const ty = 2 * (qz * 0 - qx * 1);
        const tz = 2 * (qx * 0 - qy * 0);
        return [
            0 + qw * tx + (qy * tz - qz * ty),
            0 + qw * ty + (qz * tx - qx * tz),
            1 + qw * tz + (qx * ty - qy * tx),
        ];
    };

    it('turns the forward axis toward the target', () => {
        const rig = makeHeadRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'head',
            jobs: [
                {
                    id: 'look',
                    solver: 'aim',
                    rootBone: 'head',
                    tipBone: 'head',
                    targetPosition: [5, 0, 0],
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const forward = forwardOf(rig, pose);
        expect(forward[0]).toBeCloseTo(1, 4);
        expect(forward[1]).toBeCloseTo(0, 4);
        expect(forward[2]).toBeCloseTo(0, 4);
    });

    it('honours the maximum turn angle', () => {
        const rig = makeHeadRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'head',
            jobs: [
                {
                    id: 'look',
                    solver: 'aim',
                    rootBone: 'head',
                    tipBone: 'head',
                    targetPosition: [5, 0, 0],
                    maxAimAngleDegrees: 30,
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const forward = forwardOf(rig, pose);
        const angle = (Math.acos(Math.min(1, Math.max(-1, forward[2]!))) * 180) / Math.PI;
        expect(angle).toBeCloseTo(30, 3);
    });

    it('removes roll with the aim up vector', () => {
        const rig = makeHeadRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'head',
            jobs: [
                {
                    id: 'look',
                    solver: 'aim',
                    rootBone: 'head',
                    tipBone: 'head',
                    targetPosition: [5, 0, 0],
                    aimUp: [0, 1, 0],
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        const world = new AnimationWorldPose(rig.boneCount).update(rig, pose);
        const qx = world.rotations[0]!;
        const qy = world.rotations[1]!;
        const qz = world.rotations[2]!;
        const qw = world.rotations[3]!;

        // Rotate the local +Y axis by the world rotation.
        const tx = 2 * (qy * 0 - qz * 1);
        const ty = 2 * (qz * 0 - qx * 0);
        const tz = 2 * (qx * 1 - qy * 0);
        const up: readonly [number, number, number] = [
            0 + qw * tx + (qy * tz - qz * ty),
            1 + qw * ty + (qz * tx - qx * tz),
            0 + qw * tz + (qx * ty - qy * tx),
        ];

        expect(up[0]).toBeCloseTo(0, 3);
        expect(up[1]).toBeCloseTo(1, 3);
        expect(up[2]).toBeCloseTo(0, 3);
    });

    it('keeps the pose finite when the target coincides with the bone', () => {
        const rig = makeHeadRig();
        const layer = new AnimationIkLayer(rig, {
            id: 'head',
            jobs: [
                {
                    id: 'look',
                    solver: 'aim',
                    rootBone: 'head',
                    tipBone: 'head',
                    targetPosition: [0, 0, 0],
                },
            ],
        });

        const pose = new AnimationPose(rig.boneCount).reset(rig);
        layer.apply(pose);

        for (let index = 0; index < pose.rotations.length; index += 1) {
            expect(Number.isFinite(pose.rotations[index]!)).toBe(true);
        }
    });
});
