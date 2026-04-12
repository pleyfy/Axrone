import { describe, expect, it } from 'vitest';
import { AnimationController } from '../controller';
import { AnimationIkLayer } from '../ik';
import { AnimationCurveLayout, AnimationFrame, AnimationPose, AnimationWorldPose } from '../pose';
import { AnimationRetargeter } from '../retargeting';
import { AnimationRig } from '../rig';

describe('Animation stack', () => {
    it('extracts root motion while consuming the animated root bone', () => {
        const controller = new AnimationController({
            rig: {
                bones: [{ name: 'hips' }],
            },
            clips: [
                {
                    id: 'walk',
                    tracks: [
                        {
                            target: 'hips',
                            path: 'translation',
                            times: [0, 1],
                            values: [0, 0, 0, 2, 0, 0],
                        },
                    ],
                },
            ],
            layers: [
                {
                    id: 'base',
                    stateMachine: {
                        entryState: 'walk',
                        states: [
                            {
                                id: 'walk',
                                motion: { kind: 'clip', clipId: 'walk' },
                                loop: false,
                            },
                        ],
                    },
                },
            ],
            rootMotion: {
                bone: 'hips',
                consume: true,
                projectTranslationAxes: [true, false, false],
            },
        });

        const result = controller.update(0.5);

        expect(result.rootMotion.translation[0]).toBeCloseTo(1);
        expect(result.rootMotion.translation[1]).toBeCloseTo(0);
        expect(result.frame.pose.translations[0]).toBeCloseTo(0);
        expect(result.frame.pose.translations[1]).toBeCloseTo(0);
        expect(result.frame.pose.translations[2]).toBeCloseTo(0);
    });

    it('evaluates a 1D blend tree from controller parameters', () => {
        const controller = new AnimationController({
            rig: {
                bones: [{ name: 'hips' }],
            },
            clips: [
                {
                    id: 'idle',
                    tracks: [
                        {
                            target: 'hips',
                            path: 'translation',
                            times: [0, 1],
                            values: [0, 0, 0, 0, 0, 0],
                        },
                    ],
                },
                {
                    id: 'run',
                    tracks: [
                        {
                            target: 'hips',
                            path: 'translation',
                            times: [0, 1],
                            values: [0, 0, 0, 2, 0, 0],
                        },
                    ],
                },
            ],
            parameters: [{ name: 'speed', kind: 'float', defaultValue: 0 }],
            layers: [
                {
                    id: 'base',
                    stateMachine: {
                        entryState: 'locomotion',
                        states: [
                            {
                                id: 'locomotion',
                                motion: {
                                    kind: 'blend1d',
                                    parameter: 'speed',
                                    children: [
                                        {
                                            threshold: 0,
                                            motion: { kind: 'clip', clipId: 'idle' },
                                        },
                                        {
                                            threshold: 1,
                                            motion: { kind: 'clip', clipId: 'run' },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        });

        controller.seek(0.5);
        controller.parameters.setFloat('speed', 0.5);
        const frame = controller.evaluate();

        expect(frame.pose.translations[0]).toBeCloseTo(0.5);
        expect(frame.pose.translations[1]).toBeCloseTo(0);
        expect(frame.pose.translations[2]).toBeCloseTo(0);
    });

    it('retargets translations with configured scaling', () => {
        const retargeter = new AnimationRetargeter({
            sourceRig: {
                bones: [{ name: 'hips' }],
            },
            targetRig: {
                bones: [{ name: 'pelvis' }],
            },
            mappings: [
                {
                    sourceBone: 'hips',
                    targetBone: 'pelvis',
                    translationMode: 'scaled',
                    scaleTranslation: 2,
                },
            ],
        });
        const sourceRig = new AnimationRig({ bones: [{ name: 'hips' }] });
        const sourceFrame = new AnimationFrame(sourceRig, new AnimationCurveLayout());
        sourceFrame.pose.translations[0] = 1;
        sourceFrame.pose.translations[1] = 2;
        sourceFrame.pose.translations[2] = 3;

        const targetFrame = retargeter.retargetPose(sourceFrame);

        expect(targetFrame.pose.translations[0]).toBeCloseTo(2);
        expect(targetFrame.pose.translations[1]).toBeCloseTo(4);
        expect(targetFrame.pose.translations[2]).toBeCloseTo(6);
    });

    it('solves a simple CCD IK chain toward the requested target', () => {
        const rig = new AnimationRig({
            bones: [
                { name: 'root' },
                { name: 'tip', parent: 'root', translation: [1, 0, 0] },
            ],
        });
        const pose = new AnimationPose(rig.boneCount).reset(rig);
        const ikLayer = new AnimationIkLayer(rig, {
            id: 'aim',
            jobs: [
                {
                    id: 'reach',
                    solver: 'ccd',
                    rootBone: 'root',
                    tipBone: 'tip',
                    targetPosition: [0, 1, 0],
                    precision: 1e-4,
                    maxIterations: 24,
                },
            ],
        });

        ikLayer.apply(pose);

        const worldPose = new AnimationWorldPose(rig.boneCount).update(rig, pose);
        const tipOffset = rig.indexOfBone('tip') * 3;
        expect(worldPose.translations[tipOffset]).toBeCloseTo(0, 3);
        expect(worldPose.translations[tipOffset + 1]).toBeCloseTo(1, 3);
        expect(worldPose.translations[tipOffset + 2]).toBeCloseTo(0, 3);
    });
});