import { describe, expect, it } from 'vitest';
import { AnimationClip } from '../clip';
import { AnimationController } from '../controller';
import { AnimationStateMachineError, AnimationValidationError } from '../errors';
import { AnimationParameterStore } from '../parameters';
import { AnimationCurveLayout } from '../pose';
import { AnimationRig } from '../rig';
import {
    compileStateMachine,
    commitLayerRuntime,
    createLayerRuntime,
    crossFadeLayerState,
    evaluateLayerRuntime,
    extractLayerRootDelta,
    collectLayerEvents,
    collectLayerClipActivities,
    forceLayerState,
    updateLayerRuntime,
} from '../state-machine';
import { AnimationScratchPool, BlendScratchContext } from '../blend-tree';
import { AnimationFrame } from '../pose';
import type { AnimationStateMachineDefinition, AnimationTransitionDefinition, AnimationTransitionOperator } from '../types';

const rig = new AnimationRig({ bones: [{ name: 'root' }] });
const curveLayout = new AnimationCurveLayout();

const makeClip = (id: string): AnimationClip =>
    new AnimationClip(
        {
            id,
            tracks: [
                {
                    target: 'root',
                    path: 'translation',
                    times: [0, 1],
                    values: [0, 0, 0, 1, 0, 0],
                },
            ],
        },
        rig,
        curveLayout
    );

const clips = new Map<string, AnimationClip>([
    ['a', makeClip('a')],
    ['b', makeClip('b')],
    ['c', makeClip('c')],
]);

const makeParameters = (): AnimationParameterStore =>
    new AnimationParameterStore([
        { name: 'toB', kind: 'trigger' },
        { name: 'toC', kind: 'trigger' },
    ]);

const makeMachineDefinition = (
    toBOverrides: Partial<AnimationTransitionDefinition> = {}
): AnimationStateMachineDefinition => ({
    entryState: 'A',
    states: [
        {
            id: 'A',
            motion: { kind: 'clip', clipId: 'a' },
            transitions: [
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditions: [{ kind: 'trigger', parameter: 'toB' }],
                    ...toBOverrides,
                },
                {
                    to: 'C',
                    duration: 0.5,
                    fixedDuration: true,
                    conditions: [{ kind: 'trigger', parameter: 'toC' }],
                },
            ],
        },
        { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
        { id: 'C', motion: { kind: 'clip', clipId: 'c' } },
    ],
});

describe('state machine transition easing', () => {
    it('applies the authored easing to pose and root delta weights', () => {
        const machine = compileStateMachine(makeMachineDefinition({ easing: 'easeIn', duration: 1, fixedDuration: true }), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        const scratch = new AnimationScratchPool(rig, curveLayout);
        const restFrame = new AnimationFrame(rig, curveLayout);
        const context = { rig, parameters, restFrame, scratch, blendScratch: new BlendScratchContext() };
        const out = new AnimationFrame(rig, curveLayout);

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        updateLayerRuntime(machine, runtime, parameters, 0.2);
        expect(runtime.transition?.progress).toBeCloseTo(0.2, 5);

        evaluateLayerRuntime(machine, runtime, context, out);
        // Source x = 0.3, target x = 0.2, easeIn(0.2) = 0.04.
        expect(out.pose.translations[0]).toBeCloseTo(0.3 + (0.2 - 0.3) * 0.04, 5);

        const translation = new Float32Array(3);
        const rotation = new Float32Array(4);
        extractLayerRootDelta(machine, runtime, 0, context, translation, rotation);
        expect(translation[0]).toBeCloseTo(0.2, 5);
        expect(Number.isFinite(translation[0])).toBe(true);
    });

    it('rejects an unknown easing at compile time', () => {
        expect(() =>
            compileStateMachine(makeMachineDefinition({ easing: 'bogus' as never }), clips)
        ).toThrow(AnimationValidationError);
    });
});

describe('state machine transition interruption (canInterrupt)', () => {
    it('keeps non-interruptible transitions running when other conditions fire', () => {
        const machine = compileStateMachine(makeMachineDefinition({ canInterrupt: false }), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);
        expect(runtime.transition?.sourceStateIndex).toBe(0);
    });

    it('interrupts an interruptible transition toward a different target and consumes its trigger', () => {
        const machine = compileStateMachine(makeMachineDefinition({ canInterrupt: true }), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(2);
        expect(runtime.transition?.sourceStateIndex).toBe(0);
        expect(runtime.transition?.progress).toBe(0);
        expect(parameters.get('toC')).toBe(false);
    });

    it('sources the interrupting transition from the previous target once progress reaches 0.5', () => {
        const machine = compileStateMachine(makeMachineDefinition({ canInterrupt: true }), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        updateLayerRuntime(machine, runtime, parameters, 0.5);
        expect(runtime.transition?.progress).toBeCloseTo(0.5, 5);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.05);
        expect(runtime.transition?.sourceStateIndex).toBe(1);
        expect(runtime.transition?.targetStateIndex).toBe(2);
    });

    it('does not restart an interruptible transition toward the same target', () => {
        const machine = compileStateMachine(makeMachineDefinition({ canInterrupt: true }), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);
        expect(runtime.transition?.sourceStateIndex).toBe(0);
        expect(runtime.transition?.progress).toBeCloseTo(0.1, 5);
    });

    it('commits interrupted transitions to their final target', () => {
        const machine = compileStateMachine(makeMachineDefinition({ canInterrupt: true }), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        updateLayerRuntime(machine, runtime, parameters, 1);
        expect(runtime.transition?.complete).toBe(true);
        commitLayerRuntime(runtime);
        expect(runtime.transition).toBeNull();
        expect(runtime.currentStateIndex).toBe(2);
    });
});

describe('state machine condition evaluation', () => {
    it('prefers higher priority transitions when several match', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'a' },
                        transitions: [
                            {
                                to: 'B',
                                priority: 1,
                                conditions: [{ kind: 'trigger', parameter: 'toB' }],
                            },
                            {
                                to: 'C',
                                priority: 5,
                                conditions: [{ kind: 'trigger', parameter: 'toB' }],
                            },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
                    { id: 'C', motion: { kind: 'clip', clipId: 'c' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(2);
    });

    it('throws on unsupported runtime operators instead of failing silently', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'a' },
                        transitions: [
                            {
                                to: 'B',
                                conditions: [
                                    {
                                        kind: 'float',
                                        parameter: 'speed',
                                        operator: '~=' as unknown as AnimationTransitionOperator,
                                        value: 1,
                                    },
                                ],
                            },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([{ name: 'speed', kind: 'float' }]);

        expect(() => updateLayerRuntime(machine, runtime, parameters, 0.1)).toThrow(
            AnimationStateMachineError
        );
    });
});

describe('controller seek', () => {
    it('normalizes seek time against blend tree durations', () => {
        const controller = new AnimationController({
            rig: { bones: [{ name: 'root' }] },
            clips: [
                {
                    id: 'slow',
                    tracks: [
                        { target: 'root', path: 'translation', times: [0, 2], values: [0, 0, 0, 1, 0, 0] },
                    ],
                },
                {
                    id: 'fast',
                    tracks: [
                        { target: 'root', path: 'translation', times: [0, 4], values: [0, 0, 0, 2, 0, 0] },
                    ],
                },
            ],
            parameters: [{ name: 'blend', kind: 'float', defaultValue: 0.5 }],
            layers: [
                {
                    id: 'base',
                    stateMachine: {
                        entryState: 'move',
                        states: [
                            {
                                id: 'move',
                                motion: {
                                    kind: 'blend1d',
                                    parameter: 'blend',
                                    children: [
                                        { threshold: 0, motion: { kind: 'clip', clipId: 'slow' } },
                                        { threshold: 1, motion: { kind: 'clip', clipId: 'fast' } },
                                    ],
                                },
                            },
                        ],
                    },
                },
            ],
        });

        // Blended duration = 2 * 0.5 + 4 * 0.5 = 3 seconds.
        controller.seek(1.5);
        expect(controller.profile.activeLayers[0]?.normalizedTime).toBeCloseTo(0.5, 5);
    });
});

describe('compileStateMachine validation', () => {
    it('throws on empty states array', () => {
        expect(() => compileStateMachine({ entryState: 'A', states: [] }, clips)).toThrow(
            AnimationValidationError
        );
    });

    it('throws on empty state id', () => {
        expect(() =>
            compileStateMachine(
                { entryState: 'A', states: [{ id: '', motion: { kind: 'clip', clipId: 'a' } }] },
                clips
            )
        ).toThrow(AnimationValidationError);
    });

    it('throws on duplicate state id', () => {
        expect(() =>
            compileStateMachine(
                {
                    entryState: 'A',
                    states: [
                        { id: 'A', motion: { kind: 'clip', clipId: 'a' } },
                        { id: 'A', motion: { kind: 'clip', clipId: 'b' } },
                    ],
                },
                clips
            )
        ).toThrow(AnimationValidationError);
    });

    it('throws on unknown entry state', () => {
        expect(() =>
            compileStateMachine(
                {
                    entryState: 'Z',
                    states: [{ id: 'A', motion: { kind: 'clip', clipId: 'a' } }],
                },
                clips
            )
        ).toThrow(AnimationValidationError);
    });

    it('throws on unknown transition target', () => {
        expect(() =>
            compileStateMachine(
                {
                    entryState: 'A',
                    states: [
                        {
                            id: 'A',
                            motion: { kind: 'clip', clipId: 'a' },
                            transitions: [{ to: 'MISSING' }],
                        },
                    ],
                },
                clips
            )
        ).toThrow(AnimationValidationError);
    });
});

describe('forceLayerState', () => {
    it('sets currentStateIndex and clears transition', () => {
        const machine = compileStateMachine(makeMachineDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        forceLayerState(machine, runtime, 'B', 0.5);
        expect(runtime.currentStateIndex).toBe(1);
        expect(runtime.currentNormalizedTime).toBe(0.5);
        expect(runtime.transition).toBeNull();
    });

    it('throws for unknown state id', () => {
        const machine = compileStateMachine(makeMachineDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        expect(() => forceLayerState(machine, runtime, 'MISSING')).toThrow(AnimationStateMachineError);
    });
});

describe('crossFadeLayerState', () => {
    it('creates transition with correct source/target/duration', () => {
        const machine = compileStateMachine(makeMachineDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        crossFadeLayerState(machine, runtime, 'B', 0.5, 0.1, false);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.sourceStateIndex).toBe(0);
        expect(runtime.transition!.targetStateIndex).toBe(1);
        expect(runtime.transition!.durationSeconds).toBeCloseTo(0.5, 5);
        expect(runtime.transition!.targetNormalizedTime).toBeCloseTo(0.1, 5);
    });

    it('throws for unknown state id', () => {
        const machine = compileStateMachine(makeMachineDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        expect(() => crossFadeLayerState(machine, runtime, 'MISSING', 1)).toThrow(
            AnimationStateMachineError
        );
    });
});

describe('evaluateLayerRuntime during transition', () => {
    it('blends source and target frames by progress', () => {
        const machine = compileStateMachine(makeMachineDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        crossFadeLayerState(machine, runtime, 'B', 1, 0, false);
        updateLayerRuntime(machine, runtime, makeParameters(), 0.5);
        const scratchPool = new AnimationScratchPool(rig, curveLayout, new Float32Array(curveLayout.componentCount * 0));
        scratchPool.reset();
        const out = new AnimationFrame(rig, curveLayout);
        const context = { rig, parameters: makeParameters(), restFrame: new AnimationFrame(rig, curveLayout), scratch: scratchPool, blendScratch: new BlendScratchContext() };
        const result = evaluateLayerRuntime(machine, runtime, context, out);
        expect(result).toBe(out);
    });
});

describe('extractLayerRootDelta', () => {
    it('returns zero/identity for negative rootBoneIndex', () => {
        const machine = compileStateMachine(makeMachineDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        const scratchPool = new AnimationScratchPool(rig, curveLayout, new Float32Array(curveLayout.componentCount * 0));
        const context = { rig, parameters, restFrame: new AnimationFrame(rig, curveLayout), scratch: scratchPool, blendScratch: new BlendScratchContext() };
        const outTranslation = new Float32Array(3);
        const outRotation = new Float32Array(4);
        extractLayerRootDelta(machine, runtime, -1, context, outTranslation, outRotation);
        expect(outTranslation[0]).toBe(0);
        expect(outTranslation[1]).toBe(0);
        expect(outTranslation[2]).toBe(0);
        expect(outRotation[3]).toBe(1);
    });
});

describe('collectLayerEvents', () => {
    it('returns empty when layerWeight <= 0', () => {
        const machine = compileStateMachine(makeMachineDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        const scratchPool = new AnimationScratchPool(rig, curveLayout, new Float32Array(curveLayout.componentCount * 0));
        const context = { rig, parameters, restFrame: new AnimationFrame(rig, curveLayout), scratch: scratchPool, blendScratch: new BlendScratchContext() };
        const events = collectLayerEvents(machine, runtime, context, 'base', 0);
        expect(events).toHaveLength(0);
    });
});

describe('collectLayerClipActivities', () => {
    it('returns empty when layerWeight <= 0', () => {
        const machine = compileStateMachine(makeMachineDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        const scratchPool = new AnimationScratchPool(rig, curveLayout, new Float32Array(curveLayout.componentCount * 0));
        const context = { rig, parameters, restFrame: new AnimationFrame(rig, curveLayout), scratch: scratchPool, blendScratch: new BlendScratchContext() };
        const activities = collectLayerClipActivities(machine, runtime, context, 'base', 0);
        expect(activities).toHaveLength(0);
    });
});

describe('exitTime transitions', () => {
    it('fires when time crosses exitTime threshold', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'a' },
                        transitions: [
                            {
                                to: 'B',
                                exitTime: 0.5,
                                duration: 0.2,
                                fixedDuration: true,
                            },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([]);
        // Advance to 0.3 (before exitTime 0.5) - no transition
        updateLayerRuntime(machine, runtime, parameters, 0.3);
        expect(runtime.transition).toBeNull();
        // Advance to 0.6 (past exitTime 0.5) - transition should fire
        updateLayerRuntime(machine, runtime, parameters, 0.3);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.targetStateIndex).toBe(1);
    });
});

describe('anyState transitions', () => {
    it('triggers from any state by priority', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    { id: 'A', motion: { kind: 'clip', clipId: 'a' } },
                    { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
                ],
                anyStateTransitions: [
                    {
                        to: 'B',
                        priority: 10,
                        conditions: [{ kind: 'trigger', parameter: 'toB' }],
                    },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.targetStateIndex).toBe(1);
    });
});

describe('bool condition', () => {
    it('evaluates bool parameter correctly', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'a' },
                        transitions: [
                            {
                                to: 'B',
                                conditions: [{ kind: 'bool', parameter: 'active', value: true }],
                            },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([{ name: 'active', kind: 'bool' }]);
        // active is false by default - no transition
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).toBeNull();
        // Set active to true - transition fires
        parameters.set('active', true);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.targetStateIndex).toBe(1);
    });
});

describe('float operators', () => {
    const makeFloatMachine = (operator: AnimationTransitionOperator, value: number) =>
        compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'a' },
                        transitions: [
                            {
                                to: 'B',
                                conditions: [{ kind: 'float', parameter: 'speed', operator, value }],
                            },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
                ],
            },
            clips
        );

    it('less than', () => {
        const machine = makeFloatMachine('<', 5);
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([{ name: 'speed', kind: 'float' }]);
        parameters.set('speed', 3);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
    });

    it('less than or equal', () => {
        const machine = makeFloatMachine('<=', 5);
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([{ name: 'speed', kind: 'float' }]);
        parameters.set('speed', 5);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
    });

    it('greater than', () => {
        const machine = makeFloatMachine('>', 5);
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([{ name: 'speed', kind: 'float' }]);
        parameters.set('speed', 7);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
    });

    it('greater than or equal', () => {
        const machine = makeFloatMachine('>=', 5);
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([{ name: 'speed', kind: 'float' }]);
        parameters.set('speed', 5);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
    });

    it('equal', () => {
        const machine = makeFloatMachine('==', 5);
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([{ name: 'speed', kind: 'float' }]);
        parameters.set('speed', 5);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
    });

    it('not equal', () => {
        const machine = makeFloatMachine('!=', 5);
        const runtime = createLayerRuntime(machine);
        const parameters = new AnimationParameterStore([{ name: 'speed', kind: 'float' }]);
        parameters.set('speed', 3);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
    });
});
