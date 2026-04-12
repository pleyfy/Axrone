import { describe, expect, it } from 'vitest';
import { AnimationBlendGraph } from '../blend-graph';
import { AnimationClip } from '../clip';
import { AnimationControllerGraph } from '../controller-graph';
import { AnimationController } from '../controller';
import { solvePlanarGrounding } from '../grounding';
import { AnimationIkLayer } from '../ik';
import { AnimationMotionMatchDatabase } from '../motion-matching';
import { optimizeAnimationClipDefinition } from '../optimization';
import { AnimationCurveLayout, AnimationFrame, AnimationPose, AnimationWorldPose } from '../pose';
import { AnimationRetargeter } from '../retargeting';
import { AnimationRig } from '../rig';
import { AnimationClipStreamingScheduler } from '../streaming';
import {
    decodeAnimationClipStreamingChunkPayload,
    encodeAnimationClipStreamingChunkPayload,
} from '../streaming-chunk';

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

    it('keeps the last keyframe when a non-looping state seeks to clip end', () => {
        const controller = new AnimationController({
            rig: {
                bones: [{ name: 'hips' }],
            },
            clips: [
                {
                    id: 'pose',
                    tracks: [
                        {
                            target: 'hips',
                            path: 'translation',
                            times: [0, 1],
                            values: [0, 0, 0, 1, 0, 0],
                        },
                    ],
                },
            ],
            layers: [
                {
                    id: 'base',
                    stateMachine: {
                        entryState: 'pose',
                        states: [
                            {
                                id: 'pose',
                                motion: { kind: 'clip', clipId: 'pose' },
                                loop: false,
                            },
                        ],
                    },
                },
            ],
        });

        controller.seek(1);
        const frame = controller.evaluate();

        expect(frame.pose.translations[0]).toBeCloseTo(1);
        expect(frame.pose.translations[1]).toBeCloseTo(0);
        expect(frame.pose.translations[2]).toBeCloseTo(0);
    });

    it('builds blend graphs through the fluent authoring API and exposes active clip activity', () => {
        const motion = AnimationBlendGraph.blend1d('speed')
            .addChild(0, AnimationBlendGraph.clip('idle'))
            .addChild(1, AnimationBlendGraph.clip('run'))
            .build();

        expect(
            AnimationBlendGraph.validate(motion, {
                knownClipIds: ['idle', 'run'],
                knownParameters: ['speed'],
            })
        ).toEqual([]);

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
                                motion,
                            },
                        ],
                    },
                },
            ],
        });

        controller.parameters.setFloat('speed', 1);
        controller.seek(0.5);
        const frame = controller.evaluate();

        expect(frame.pose.translations[0]).toBeCloseTo(1);
        expect(controller.activeClips).toEqual([
            expect.objectContaining({
                clipId: 'run',
                layerId: 'base',
                stateId: 'locomotion',
            }),
        ]);
        expect(controller.profile.activeClipCount).toBe(1);
    });

    it('builds controller definitions through the fluent controller graph API', () => {
        const definition = AnimationControllerGraph.controller({
            bones: [{ name: 'hips' }],
        })
            .addClip({
                id: 'idle',
                tracks: [
                    {
                        target: 'hips',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 0, 0, 0],
                    },
                ],
            })
            .addClip({
                id: 'run',
                tracks: [
                    {
                        target: 'hips',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 2, 0, 0],
                    },
                ],
            })
            .parameter('speed', 'float', 0)
            .layer(
                'base',
                AnimationControllerGraph.machine('idle')
                    .state('idle', AnimationBlendGraph.clip('idle'), (state) => {
                        state.transitionTo('run', (transition) => {
                            transition.withDuration(0.1).whenFloat('speed', '>', 0.5);
                        });
                    })
                    .state('run', AnimationBlendGraph.clip('run'), (state) => {
                        state.transitionTo('idle', (transition) => {
                            transition.withDuration(0.1).whenFloat('speed', '<=', 0.5);
                        });
                    }),
                (layer) => {
                    layer.withWeight(1).withBoneMask(['hips']);
                }
            )
            .withRootMotion({
                bone: 'hips',
                consume: true,
            })
            .build();

        expect(AnimationControllerGraph.validateController(definition)).toEqual([]);

        const controller = new AnimationController(definition);
        controller.parameters.setFloat('speed', 1);
        controller.update(0.25);
        controller.update(0.25);

        expect(controller.activeClips).toEqual([
            expect.objectContaining({
                clipId: 'run',
                layerId: 'base',
                stateId: 'run',
            }),
        ]);
    });

    it('validates controller graph references against clips, parameters, and bones', () => {
        const definition = AnimationControllerGraph.controller({
            bones: [{ name: 'hips' }],
        })
            .addClip({
                id: 'idle',
                tracks: [
                    {
                        target: 'hips',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 0, 0, 0],
                    },
                ],
            })
            .parameter('speed', 'float', 0)
            .layer(
                'base',
                AnimationControllerGraph.machine('idle')
                    .state(
                        'idle',
                        AnimationBlendGraph.blend1d('speed')
                            .addChild(0, AnimationBlendGraph.clip('idle'))
                            .addChild(1, AnimationBlendGraph.clip('missing-clip'))
                    )
                    .anyState('missing-state', (transition) => {
                        transition.whenFloat('missing-parameter', '>', 0.1);
                    }),
                (layer) => {
                    layer.withBoneMask(['missing-bone']);
                }
            )
            .withRootMotion({
                bone: 'missing-bone',
            })
            .build();

        const diagnostics = AnimationControllerGraph.validateController(definition);

        expect(diagnostics).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: 'animation.controller.motion.clip.unknown',
                }),
                expect.objectContaining({
                    code: 'animation.controller.parameter.unknown',
                }),
                expect.objectContaining({
                    code: 'animation.controller.state.unknown',
                }),
                expect.objectContaining({
                    code: 'animation.controller.bone.unknown',
                }),
                expect.objectContaining({
                    code: 'animation.controller.rootMotion.bone.unknown',
                }),
            ])
        );
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

    it('collects animation notifies and controller profiling data during updates', () => {
        const controller = new AnimationController({
            rig: {
                bones: [{ name: 'hips' }],
            },
            clips: [
                {
                    id: 'attack',
                    events: [
                        {
                            id: 'swing',
                            name: 'attack:swing',
                            time: 0.5,
                            payload: { damage: 12 },
                            tags: ['combat'],
                        },
                    ],
                    tracks: [
                        {
                            target: 'hips',
                            path: 'translation',
                            times: [0, 1],
                            values: [0, 0, 0, 1, 0, 0],
                        },
                    ],
                },
            ],
            layers: [
                {
                    id: 'base',
                    stateMachine: {
                        entryState: 'attack',
                        states: [
                            {
                                id: 'attack',
                                motion: { kind: 'clip', clipId: 'attack' },
                                loop: false,
                            },
                        ],
                    },
                },
            ],
        });

        const result = controller.update(0.75);

        expect(result.events).toEqual([
            expect.objectContaining({
                clipId: 'attack',
                layerId: 'base',
                stateId: 'attack',
                name: 'attack:swing',
                id: 'swing',
                payload: { damage: 12 },
                tags: ['combat'],
            }),
        ]);
        expect(result.profile.emittedEventCount).toBe(1);
        expect(result.profile.sampledTrackCount).toBe(1);
        expect(result.profile.activeLayers).toEqual([
            expect.objectContaining({
                layerId: 'base',
                stateId: 'attack',
                transitioning: false,
            }),
        ]);
    });

    it('schedules streamed clip chunks for active playback and preload windows', () => {
        const rig = new AnimationRig({
            bones: [{ name: 'root' }],
        });
        const clip = new AnimationClip(
            {
                id: 'walk',
                tracks: [
                    {
                        target: 'root',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 1, 0, 0],
                    },
                ],
                streaming: {
                    mode: 'streamed',
                    sourceUri: 'clips/walk.anim',
                    chunkDuration: 0.5,
                    preloadWindow: 0.3,
                },
            },
            rig,
            new AnimationCurveLayout()
        );
        const scheduler = new AnimationClipStreamingScheduler([clip]);

        let snapshot = scheduler.update([
            {
                clipId: 'walk',
                layerId: 'base',
                stateId: 'walk',
                layerWeight: 1,
                motionWeight: 1,
                loop: false,
                time: 0.4,
                normalizedTime: 0.4,
            },
        ]);

        expect(snapshot.ready).toBe(false);
        expect(snapshot.pendingRequests).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    clipId: 'walk',
                    chunkId: 'walk:virtual:0',
                    reason: 'active',
                }),
                expect.objectContaining({
                    clipId: 'walk',
                    chunkId: 'walk:virtual:1',
                    reason: 'preload',
                }),
            ])
        );

        scheduler.markChunkLoaded('walk', 'walk:virtual:0');
        snapshot = scheduler.update([
            {
                clipId: 'walk',
                layerId: 'base',
                stateId: 'walk',
                layerWeight: 1,
                motionWeight: 1,
                loop: false,
                time: 0.4,
                normalizedTime: 0.4,
            },
        ]);

        expect(snapshot.ready).toBe(true);
        expect(snapshot.clips[0]).toEqual(
            expect.objectContaining({
                activeChunkIds: ['walk:virtual:0'],
                requestedChunkIds: expect.arrayContaining(['walk:virtual:1']),
            })
        );
    });

    it('decodes and applies streamed clip chunk payloads onto placeholder clips', () => {
        const rig = new AnimationRig({
            bones: [{ name: 'root' }],
        });
        const curveLayout = new AnimationCurveLayout();
        const clip = new AnimationClip(
            {
                id: 'walk',
                duration: 1,
                tracks: [],
                streaming: {
                    mode: 'streamed',
                    sourceUri: 'clips/walk.anim',
                    chunkDuration: 1,
                },
            },
            rig,
            curveLayout
        );
        const chunk = decodeAnimationClipStreamingChunkPayload(
            encodeAnimationClipStreamingChunkPayload({
                version: 1,
                clipId: 'walk',
                startTime: 0,
                endTime: 1,
                tracks: [
                    {
                        target: 'root',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 1, 0, 0],
                    },
                ],
            })
        );

        clip.applyStreamingChunk(chunk, { clipId: 'walk', startTime: 0, endTime: 1 });
        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(0.5, frame);

        expect(clip.definition.tracks).toHaveLength(1);
        expect(frame.pose.translations[0]).toBeCloseTo(0.5, 5);
        expect(frame.pose.translations[1]).toBeCloseTo(0, 5);
        expect(frame.pose.translations[2]).toBeCloseTo(0, 5);
    });

    it('merges sequential streamed chunk payloads into a single clip track timeline', () => {
        const rig = new AnimationRig({
            bones: [{ name: 'root' }],
        });
        const curveLayout = new AnimationCurveLayout();
        const clip = new AnimationClip(
            {
                id: 'walk',
                duration: 1,
                tracks: [],
                streaming: {
                    mode: 'streamed',
                    sourceUri: 'clips/walk.anim',
                    chunkDuration: 0.5,
                },
            },
            rig,
            curveLayout
        );

        clip.applyStreamingChunk(
            decodeAnimationClipStreamingChunkPayload(
                encodeAnimationClipStreamingChunkPayload({
                    version: 1,
                    clipId: 'walk',
                    startTime: 0,
                    endTime: 0.5,
                    tracks: [
                        {
                            target: 'root',
                            path: 'translation',
                            times: [0, 0.5],
                            values: [0, 0, 0, 0.5, 0, 0],
                        },
                    ],
                })
            ),
            { clipId: 'walk', startTime: 0, endTime: 0.5 }
        );
        clip.applyStreamingChunk(
            decodeAnimationClipStreamingChunkPayload(
                encodeAnimationClipStreamingChunkPayload({
                    version: 1,
                    clipId: 'walk',
                    startTime: 0.5,
                    endTime: 1,
                    tracks: [
                        {
                            target: 'root',
                            path: 'translation',
                            times: [0.5, 1],
                            values: [0.5, 0, 0, 1, 0, 0],
                        },
                    ],
                })
            ),
            { clipId: 'walk', startTime: 0.5, endTime: 1 }
        );

        const frame = new AnimationFrame(rig, curveLayout);
        clip.sampleTime(0.75, frame);

        expect(clip.definition.tracks[0]?.times).toEqual(new Float32Array([0, 0.5, 1]));
        expect(frame.pose.translations[0]).toBeCloseTo(0.75, 5);
    });

    it('supports motion matching, grounding, and clip optimization helpers', () => {
        const optimized = optimizeAnimationClipDefinition({
            id: 'stride',
            tags: ['locomotion'],
            features: [
                {
                    time: 0.5,
                    trajectoryPosition: [1, 0, 0],
                    facingDirection: [1, 0, 0],
                    tags: ['forward'],
                },
            ],
            footContacts: [
                {
                    bone: 'foot',
                    startTime: 0,
                    endTime: 0.5,
                    lockTranslationAxes: [true, true, true],
                },
            ],
            compression: {
                codec: 'keyframe-reduced',
                positionTolerance: 1e-3,
            },
            tracks: [
                {
                    target: 'root',
                    path: 'translation',
                    times: [0, 0.5, 1],
                    values: [0, 0, 0, 0.5, 0, 0, 1, 0, 0],
                },
            ],
        });
        const database = new AnimationMotionMatchDatabase([
            optimized,
            {
                id: 'turn',
                tags: ['turn'],
                features: [
                    {
                        time: 0.5,
                        trajectoryPosition: [0, 0, 1],
                        facingDirection: [0, 0, 1],
                    },
                ],
                tracks: [
                    {
                        target: 'root',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 0, 0, 1],
                    },
                ],
            },
        ]);
        const rig = new AnimationRig({
            bones: [
                { name: 'root' },
                { name: 'foot', parent: 'root' },
            ],
        });
        const clip = new AnimationClip(optimized, rig, new AnimationCurveLayout());

        expect(optimized.tracks[0]?.keyframeCount).toBe(2);
        expect(
            database.query({
                desiredTrajectoryPosition: [1, 0, 0],
                desiredFacingDirection: [1, 0, 0],
                requiredTags: ['locomotion'],
            })[0]
        ).toEqual(
            expect.objectContaining({
                clipId: 'stride',
            })
        );
        expect(solvePlanarGrounding(clip, 0.25, { foot: 0.2 }).rootOffset[1]).toBeCloseTo(-0.2, 5);
    });
});