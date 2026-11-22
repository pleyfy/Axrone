import { describe, expect, it } from 'vitest';
import { AnimationController } from '../controller';
import { AnimationMotionMatchDatabase } from '../motion-matching';
import { AnimationBlendGraph } from '../blend-graph';

const makeDatabase = (): AnimationMotionMatchDatabase =>
    new AnimationMotionMatchDatabase([
        {
            id: 'walk',
            features: [
                { time: 0, trajectoryPosition: [0, 0, 0], facingDirection: [1, 0, 0] },
                { time: 0.5, trajectoryPosition: [0.5, 0, 0], facingDirection: [1, 0, 0] },
            ],
        },
        {
            id: 'run',
            features: [
                { time: 0, trajectoryPosition: [10, 0, 0], facingDirection: [1, 0, 0] },
                { time: 0.5, trajectoryPosition: [10.5, 0, 0], facingDirection: [1, 0, 0] },
            ],
        },
    ]);

const makeController = (database: AnimationMotionMatchDatabase, reselectIntervalSeconds = 0) =>
    new AnimationController({
        rig: { bones: [{ name: 'root' }] },
        clips: [
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
            },
            {
                id: 'run',
                tracks: [
                    {
                        target: 'root',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 5, 0, 0],
                    },
                ],
            },
        ],
        parameters: [
            { name: 'trajectoryX', kind: 'float', defaultValue: 0 },
            { name: 'trajectoryZ', kind: 'float', defaultValue: 0 },
            { name: 'facingX', kind: 'float', defaultValue: 1 },
            { name: 'facingZ', kind: 'float', defaultValue: 0 },
        ],
        layers: [
            {
                id: 'base',
                stateMachine: {
                    entryState: 'match',
                    states: [
                        {
                            id: 'match',
                            motion: {
                                kind: 'motionMatching',
                                database,
                                trajectoryXParameter: 'trajectoryX',
                                trajectoryZParameter: 'trajectoryZ',
                                facingXParameter: 'facingX',
                                facingZParameter: 'facingZ',
                                reselectIntervalSeconds,
                                continuityBias: 0,
                            },
                        },
                    ],
                },
            },
        ],
    });

describe('motion-matching graph node', () => {
    it('selects the clip whose pose matches the trajectory', () => {
        const controller = makeController(makeDatabase());

        controller.parameters.setFloat('trajectoryX', 10);
        controller.update(0.016);

        expect(controller.activeClips[0]!.clipId).toBe('run');
    });

    it('selects the walk clip when the actor is slow', () => {
        const controller = makeController(makeDatabase());

        controller.parameters.setFloat('trajectoryX', 0);
        controller.update(0.016);

        expect(controller.activeClips[0]!.clipId).toBe('walk');
    });

    it('samples the clip from the matched time', () => {
        const controller = makeController(makeDatabase());

        controller.parameters.setFloat('trajectoryX', 10.5);
        controller.update(0.016);

        const activity = controller.activeClips[0]!;
        expect(activity.clipId).toBe('run');
        // The match starts at 0.5 s and the timeline advances by the frame.
        expect(activity.time).toBeCloseTo(0.516, 3);
    });

    it('throttles the search to the reselect interval', () => {
        const database = makeDatabase();
        const controller = makeController(database, 10);

        controller.parameters.setFloat('trajectoryX', 0);
        controller.update(0.016);
        expect(controller.activeClips[0]!.clipId).toBe('walk');

        controller.parameters.setFloat('trajectoryX', 10);
        controller.update(0.016);
        expect(controller.activeClips[0]!.clipId).toBe('walk');
    });

    it('re-selects when the timeline loops', () => {
        const controller = makeController(makeDatabase());

        controller.parameters.setFloat('trajectoryX', 0);
        controller.update(0.016);
        expect(controller.activeClips[0]!.clipId).toBe('walk');

        controller.parameters.setFloat('trajectoryX', 10);
        // The clip duration is one second, so a two second step wraps the
        // timeline and forces a fresh search.
        controller.update(2);
        expect(controller.activeClips[0]!.clipId).toBe('run');
    });

    it('validates the motion-matching parameters', () => {
        const database = makeDatabase();
        const diagnostics = AnimationBlendGraph.validate(
            {
                kind: 'motionMatching',
                database,
                trajectoryXParameter: 'trajectoryX',
                trajectoryZParameter: 'trajectoryZ',
                facingXParameter: 'facingX',
                facingZParameter: 'facingZ',
            },
            { knownParameters: ['trajectoryX'] }
        );

        expect(diagnostics.some((d) => d.code === 'animation.blendGraph.parameter.unknown')).toBe(true);
    });

    it('rejects an empty database', () => {
        expect(
            () =>
                new AnimationController({
                    rig: { bones: [{ name: 'root' }] },
                    clips: [{ id: 'walk', tracks: [] }],
                    parameters: [
                        { name: 'trajectoryX', kind: 'float', defaultValue: 0 },
                        { name: 'trajectoryZ', kind: 'float', defaultValue: 0 },
                        { name: 'facingX', kind: 'float', defaultValue: 1 },
                        { name: 'facingZ', kind: 'float', defaultValue: 0 },
                    ],
                    layers: [
                        {
                            id: 'base',
                            stateMachine: {
                                entryState: 'match',
                                states: [
                                    {
                                        id: 'match',
                                        motion: {
                                            kind: 'motionMatching',
                                            database: new AnimationMotionMatchDatabase([]),
                                            trajectoryXParameter: 'trajectoryX',
                                            trajectoryZParameter: 'trajectoryZ',
                                            facingXParameter: 'facingX',
                                            facingZParameter: 'facingZ',
                                        },
                                    },
                                ],
                            },
                        },
                    ],
                })
        ).toThrow(/Motion matching requires at least one database entry/);
    });
});
