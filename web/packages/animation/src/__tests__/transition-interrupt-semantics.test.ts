import { describe, expect, it } from 'vitest';
import { AnimationClip } from '../clip';
import { buildAnimationTransitionDefinition, AnimationTransitionBuilder } from '../controller-builder';
import { validateAnimationStateMachineDefinition } from '../controller-validator';
import { AnimationValidationError } from '../errors';
import { AnimationParameterStore } from '../parameters';
import { AnimationCurveLayout, AnimationFrame } from '../pose';
import { AnimationRig } from '../rig';
import {
    collectLayerEvents,
    compileStateMachine,
    createLayerRuntime,
    crossFadeLayerState,
    evaluateLayerRuntime,
    updateLayerRuntime,
    type AnimationCompiledStateMachine,
    type AnimationLayerRuntime,
} from '../state-machine';
import { AnimationScratchPool, BlendScratchContext } from '../blend-tree';
import type {
    AnimationConditionDefinition,
    AnimationInterruptHandoff,
    AnimationInterruptMode,
    AnimationParameterDefinition,
    AnimationStateMachineDefinition,
    AnimationTransitionDefinition,
} from '../types';

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
    ['d', makeClip('d')],
]);

const parameterDefinitions: readonly AnimationParameterDefinition[] = [
    { name: 'toB', kind: 'trigger' },
    { name: 'toC', kind: 'trigger' },
    { name: 'toD', kind: 'trigger' },
];

const makeParameters = (): AnimationParameterStore => new AnimationParameterStore(parameterDefinitions);

const triggerCondition = (parameter: string): AnimationConditionDefinition => ({
    kind: 'trigger',
    parameter,
});

const outTransition = (
    to: string,
    parameter: string,
    overrides: Partial<AnimationTransitionDefinition> = {}
): AnimationTransitionDefinition => ({
    to,
    duration: 1,
    fixedDuration: true,
    conditions: [triggerCondition(parameter)],
    ...overrides,
});

const easedTransitions = (
    ...transitions: readonly AnimationTransitionDefinition[]
): readonly AnimationTransitionDefinition[] =>
    transitions.map((transition) => buildAnimationTransitionDefinition(transition));

const makeMachineDefinition = (
    firstOverrides: Partial<AnimationTransitionDefinition> = {},
    secondOverrides: Partial<AnimationTransitionDefinition> = {},
    thirdOverrides: Partial<AnimationTransitionDefinition> = {}
): AnimationStateMachineDefinition => ({
    entryState: 'A',
    states: [
        {
            id: 'A',
            motion: { kind: 'clip', clipId: 'a' },
            transitions: [
                outTransition('B', 'toB', firstOverrides),
                outTransition('C', 'toC', secondOverrides),
                outTransition('D', 'toD', thirdOverrides),
            ],
        },
        { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
        { id: 'C', motion: { kind: 'clip', clipId: 'c' } },
        { id: 'D', motion: { kind: 'clip', clipId: 'd' } },
    ],
});

const makeContext = (parameters: AnimationParameterStore) => ({
    rig,
    parameters,
    restFrame: new AnimationFrame(rig, curveLayout),
    scratch: new AnimationScratchPool(rig, curveLayout),
    blendScratch: new BlendScratchContext(),
});

const startRunning = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    parameters: AnimationParameterStore,
    parameter: string,
    deltaSeconds: number
): void => {
    parameters.setTrigger(parameter);
    updateLayerRuntime(machine, runtime, parameters, 0);
    updateLayerRuntime(machine, runtime, parameters, deltaSeconds);
};

describe('transition interrupt mode resolution', () => {
    it('keeps a canInterrupt false crossfade blocked and supersedes a canInterrupt true one', () => {
        const blocked = compileStateMachine(makeMachineDefinition({ canInterrupt: false }), clips);
        const blockedRuntime = createLayerRuntime(blocked);
        const blockedParameters = makeParameters();
        startRunning(blocked, blockedRuntime, blockedParameters, 'toB', 0.1);
        expect(blockedRuntime.transition?.targetStateIndex).toBe(1);
        expect(blockedRuntime.transition?.progress).toBeCloseTo(0.1, 5);

        blockedParameters.setTrigger('toC');
        updateLayerRuntime(blocked, blockedRuntime, blockedParameters, 0.1);
        expect(blockedRuntime.transition?.targetStateIndex).toBe(1);
        expect(blockedRuntime.transition?.progress).toBeCloseTo(0.2, 5);

        const open = compileStateMachine(makeMachineDefinition({ canInterrupt: true }), clips);
        const openRuntime = createLayerRuntime(open);
        const openParameters = makeParameters();
        startRunning(open, openRuntime, openParameters, 'toB', 0.1);
        expect(openRuntime.transition?.targetStateIndex).toBe(1);
        expect(openRuntime.transition?.progress).toBeCloseTo(0.1, 5);

        openParameters.setTrigger('toC');
        updateLayerRuntime(open, openRuntime, openParameters, 0.1);
        expect(openRuntime.transition?.targetStateIndex).toBe(2);
        expect(openRuntime.transition?.progress).toBe(0);
    });

    it('lets an explicit blocked mode win over canInterrupt true', () => {
        const machine = compileStateMachine(
            makeMachineDefinition({ canInterrupt: true, interruptMode: 'blocked' as AnimationInterruptMode }),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        startRunning(machine, runtime, parameters, 'toB', 0.1);
        expect(runtime.transition?.progress).toBeCloseTo(0.1, 5);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);
        expect(runtime.transition?.progress).toBeCloseTo(0.2, 5);
    });

    it('lets an explicit open mode win over canInterrupt false', () => {
        const machine = compileStateMachine(
            makeMachineDefinition({ canInterrupt: false, interruptMode: 'open' as AnimationInterruptMode }),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        startRunning(machine, runtime, parameters, 'toB', 0.1);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(2);
        expect(runtime.transition?.progress).toBe(0);
    });
});

describe('transition priority gated interruption', () => {
    it('supersedes for a higher priority candidate and waits for equal or lower ones', () => {
        const higher = compileStateMachine(
            makeMachineDefinition(
                { interruptMode: 'priorityGated', priority: 3 },
                { priority: 5 }
            ),
            clips
        );
        const higherRuntime = createLayerRuntime(higher);
        const higherParameters = makeParameters();
        startRunning(higher, higherRuntime, higherParameters, 'toB', 0.1);
        expect(higherRuntime.transition?.progress).toBeCloseTo(0.1, 5);
        higherParameters.setTrigger('toC');
        updateLayerRuntime(higher, higherRuntime, higherParameters, 0.1);
        expect(higherRuntime.transition?.targetStateIndex).toBe(2);
        expect(higherRuntime.transition?.sourceStateIndex).toBe(0);

        const equal = compileStateMachine(
            makeMachineDefinition(
                { interruptMode: 'priorityGated', priority: 3 },
                { priority: 3 }
            ),
            clips
        );
        const equalRuntime = createLayerRuntime(equal);
        const equalParameters = makeParameters();
        startRunning(equal, equalRuntime, equalParameters, 'toB', 0.1);
        equalParameters.setTrigger('toC');
        updateLayerRuntime(equal, equalRuntime, equalParameters, 0.1);
        expect(equalRuntime.transition?.targetStateIndex).toBe(1);
        expect(equalRuntime.transition?.progress).toBeCloseTo(0.2, 5);

        const lower = compileStateMachine(
            makeMachineDefinition(
                { interruptMode: 'priorityGated', priority: 3 },
                { priority: 1 }
            ),
            clips
        );
        const lowerRuntime = createLayerRuntime(lower);
        const lowerParameters = makeParameters();
        startRunning(lower, lowerRuntime, lowerParameters, 'toB', 0.1);
        lowerParameters.setTrigger('toC');
        updateLayerRuntime(lower, lowerRuntime, lowerParameters, 0.1);
        expect(lowerRuntime.transition?.targetStateIndex).toBe(1);
        expect(lowerRuntime.transition?.progress).toBeCloseTo(0.2, 5);
    });

    it('carries the gated mode onto the superseding transition so later candidates wait', () => {
        const gated = compileStateMachine(
            makeMachineDefinition(
                { canInterrupt: true, priority: 3 },
                { interruptMode: 'priorityGated', priority: 5 },
                { priority: 4 }
            ),
            clips
        );
        const gatedRuntime = createLayerRuntime(gated);
        const gatedParameters = makeParameters();
        startRunning(gated, gatedRuntime, gatedParameters, 'toB', 0.1);
        gatedParameters.setTrigger('toC');
        updateLayerRuntime(gated, gatedRuntime, gatedParameters, 0.1);
        expect(gatedRuntime.transition?.targetStateIndex).toBe(2);

        gatedParameters.setTrigger('toD');
        updateLayerRuntime(gated, gatedRuntime, gatedParameters, 0.1);
        expect(gatedRuntime.transition?.targetStateIndex).toBe(2);
        expect(gatedRuntime.transition?.sourceStateIndex).toBe(0);

        const open = compileStateMachine(
            makeMachineDefinition(
                { canInterrupt: true, priority: 3 },
                { interruptMode: 'open', priority: 5 },
                { priority: 4 }
            ),
            clips
        );
        const openRuntime = createLayerRuntime(open);
        const openParameters = makeParameters();
        startRunning(open, openRuntime, openParameters, 'toB', 0.1);
        openParameters.setTrigger('toC');
        updateLayerRuntime(open, openRuntime, openParameters, 0.1);
        openParameters.setTrigger('toD');
        updateLayerRuntime(open, openRuntime, openParameters, 0.1);
        expect(openRuntime.transition?.targetStateIndex).toBe(3);
    });
});

describe('transition interrupt handoff', () => {
    it('follows the half weight rule when handing off automatically', () => {
        const early = compileStateMachine(makeMachineDefinition({ canInterrupt: true }), clips);
        const earlyRuntime = createLayerRuntime(early);
        const earlyParameters = makeParameters();
        startRunning(early, earlyRuntime, earlyParameters, 'toB', 0.1);
        earlyParameters.setTrigger('toC');
        updateLayerRuntime(early, earlyRuntime, earlyParameters, 0.1);
        expect(earlyRuntime.transition?.sourceStateIndex).toBe(0);

        const late = compileStateMachine(makeMachineDefinition({ canInterrupt: true }), clips);
        const lateRuntime = createLayerRuntime(late);
        const lateParameters = makeParameters();
        startRunning(late, lateRuntime, lateParameters, 'toB', 0.6);
        expect(lateRuntime.transition?.progress).toBeCloseTo(0.6, 5);
        lateParameters.setTrigger('toC');
        updateLayerRuntime(late, lateRuntime, lateParameters, 0.05);
        expect(lateRuntime.transition?.sourceStateIndex).toBe(1);
    });

    it('continues from the source state when handing off backward', () => {
        const machine = compileStateMachine(
            makeMachineDefinition({
                canInterrupt: true,
                interruptHandoff: 'source' as AnimationInterruptHandoff,
            }),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        startRunning(machine, runtime, parameters, 'toB', 0.7);
        expect(runtime.transition?.progress).toBeCloseTo(0.7, 5);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.05);
        expect(runtime.transition?.sourceStateIndex).toBe(0);
        expect(runtime.transition?.targetStateIndex).toBe(2);
    });

    it('carries the blend forward when handing off to the target state', () => {
        const machine = compileStateMachine(
            makeMachineDefinition({
                canInterrupt: true,
                interruptHandoff: 'target' as AnimationInterruptHandoff,
            }),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        startRunning(machine, runtime, parameters, 'toB', 0.1);
        expect(runtime.transition?.progress).toBeCloseTo(0.1, 5);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.05);
        expect(runtime.transition?.sourceStateIndex).toBe(1);
        expect(runtime.transition?.targetStateIndex).toBe(2);
    });

    it('reads the handoff from the superseded transition instead of the interrupter', () => {
        const machine = compileStateMachine(
            makeMachineDefinition(
                {
                    canInterrupt: true,
                    interruptHandoff: 'target' as AnimationInterruptHandoff,
                },
                {}
            ),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        startRunning(machine, runtime, parameters, 'toB', 0.1);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.05);
        expect(runtime.transition?.sourceStateIndex).toBe(1);
        expect(runtime.transition?.targetStateIndex).toBe(2);
        expect(runtime.transition?.progress).toBe(0);
    });
});

describe('transition interrupt field compilation', () => {
    it('rejects an unknown interrupt mode at compile time', () => {
        expect(() =>
            compileStateMachine(makeMachineDefinition({ interruptMode: 'Self' as never }), clips)
        ).toThrow(AnimationValidationError);
    });

    it('rejects an unknown interrupt handoff at compile time', () => {
        expect(() =>
            compileStateMachine(makeMachineDefinition({ interruptHandoff: 'Destination' as never }), clips)
        ).toThrow(AnimationValidationError);
    });
});

describe('transition interrupt field validation', () => {
    it('reports a diagnostic for an unsupported interrupt mode', () => {
        const diagnostics = validateAnimationStateMachineDefinition(
            makeMachineDefinition({ interruptMode: 'Current' as never })
        );
        expect(diagnostics.length).toBe(1);
        expect(diagnostics[0]!.code).toBe('animation.controller.transition.interruptMode.invalid');
        expect(diagnostics[0]!.path).toBe('stateMachine.states[0].transitions[0].interruptMode');
    });

    it('reports a diagnostic for an unsupported interrupt handoff', () => {
        const diagnostics = validateAnimationStateMachineDefinition(
            makeMachineDefinition({}, {}, { interruptHandoff: 'Next' as never })
        );
        expect(diagnostics.length).toBe(1);
        expect(diagnostics[0]!.code).toBe('animation.controller.transition.interruptHandoff.invalid');
        expect(diagnostics[0]!.path).toBe('stateMachine.states[0].transitions[2].interruptHandoff');
    });

    it('accepts every documented interrupt mode and handoff', () => {
        const diagnostics = validateAnimationStateMachineDefinition(
            makeMachineDefinition(
                { interruptMode: 'blocked', interruptHandoff: 'auto' },
                { interruptMode: 'open', interruptHandoff: 'source' },
                { interruptMode: 'priorityGated', interruptHandoff: 'target' }
            )
        );
        expect(diagnostics).toEqual([]);
    });

    it('reports a diagnostic for a non boolean fixedDuration', () => {
        const diagnostics = validateAnimationStateMachineDefinition(
            makeMachineDefinition({ fixedDuration: 'true' as never })
        );
        expect(diagnostics.length).toBe(1);
        expect(diagnostics[0]!.code).toBe('animation.controller.transition.fixedDuration.invalid');
        expect(diagnostics[0]!.message).toBe('Transition fixedDuration must be a boolean');
        expect(diagnostics[0]!.path).toBe('stateMachine.states[0].transitions[0].fixedDuration');
    });

    it('reports a diagnostic for a non boolean canInterrupt', () => {
        const diagnostics = validateAnimationStateMachineDefinition(
            makeMachineDefinition({ canInterrupt: 'yes' as never })
        );
        expect(diagnostics.length).toBe(1);
        expect(diagnostics[0]!.code).toBe('animation.controller.transition.canInterrupt.invalid');
        expect(diagnostics[0]!.message).toBe('Transition canInterrupt must be a boolean');
        expect(diagnostics[0]!.path).toBe('stateMachine.states[0].transitions[0].canInterrupt');
    });

    it('accepts both boolean forms of the duration and interrupt flags', () => {
        expect(
            validateAnimationStateMachineDefinition(
                makeMachineDefinition({ fixedDuration: false, canInterrupt: false })
            )
        ).toEqual([]);
        expect(
            validateAnimationStateMachineDefinition(
                makeMachineDefinition({ fixedDuration: true, canInterrupt: true })
            )
        ).toEqual([]);
    });
});

describe('transition interrupt builder round trips', () => {
    it('preserves easing, interrupt mode and handoff through the builder', () => {
        const built = new AnimationTransitionBuilder('B')
            .withEasing('smoothStep')
            .withInterruptMode('priorityGated')
            .withInterruptHandoff('target')
            .buildUnsafe() as AnimationTransitionDefinition;
        expect(built.easing).toBe('smoothStep');
        expect(built.interruptMode).toBe('priorityGated');
        expect(built.interruptHandoff).toBe('target');

        const fromRaw = buildAnimationTransitionDefinition({
            to: 'B',
            easing: 'smoothStep',
            interruptMode: 'open',
            interruptHandoff: 'source',
        });
        expect(fromRaw.easing).toBe('smoothStep');
        expect(fromRaw.interruptMode).toBe('open');
        expect(fromRaw.interruptHandoff).toBe('source');

        const bare = buildAnimationTransitionDefinition({ to: 'B' });
        expect('easing' in bare).toBe(false);
        expect('interruptMode' in bare).toBe(false);
        expect('interruptHandoff' in bare).toBe(false);
    });

    it('passes a garbage fixedDuration through so the validator can flag it', () => {
        const built = buildAnimationTransitionDefinition({ to: 'B', fixedDuration: 'true' as never });
        expect(built.fixedDuration).toBe('true');
    });
});

describe('scripted cross fade interruption', () => {
    it('blocks authored candidates until the scripted fade opens them', () => {
        const machine = compileStateMachine(makeMachineDefinition({}, { priority: 5 }), clips);
        const closedRuntime = createLayerRuntime(machine);
        const closedParameters = makeParameters();
        crossFadeLayerState(machine, closedRuntime, 'B', 1, 0, false);
        expect(closedRuntime.transition?.durationSeconds).toBe(1);
        expect(closedRuntime.transition?.targetStateIndex).toBe(1);

        closedParameters.setTrigger('toC');
        updateLayerRuntime(machine, closedRuntime, closedParameters, 0.1);
        expect(closedRuntime.transition?.targetStateIndex).toBe(1);
        expect(closedRuntime.transition?.progress).toBeCloseTo(0.1, 5);

        const openRuntime = createLayerRuntime(machine);
        const openParameters = makeParameters();
        crossFadeLayerState(machine, openRuntime, 'B', 1, 0, true);
        openParameters.setTrigger('toC');
        updateLayerRuntime(machine, openRuntime, openParameters, 0.1);
        expect(openRuntime.transition?.targetStateIndex).toBe(2);
        expect(openRuntime.transition?.sourceStateIndex).toBe(0);
        expect(openRuntime.transition?.durationSeconds).toBe(1);
    });

    it('honors an explicit interrupt mode and handoff on a scripted fade', () => {
        const machine = compileStateMachine(makeMachineDefinition({}, { priority: 5 }), clips);
        const gatedRuntime = createLayerRuntime(machine);
        const gatedParameters = makeParameters();
        crossFadeLayerState(machine, gatedRuntime, 'B', 1, 0, false, 'linear', 'priorityGated' as AnimationInterruptMode);
        expect(gatedRuntime.transition?.durationSeconds).toBe(1);

        gatedParameters.setTrigger('toC');
        updateLayerRuntime(machine, gatedRuntime, gatedParameters, 0.1);
        expect(gatedRuntime.transition?.targetStateIndex).toBe(2);
        expect(gatedRuntime.transition?.sourceStateIndex).toBe(0);

        const blockedRuntime = createLayerRuntime(machine);
        const blockedParameters = makeParameters();
        crossFadeLayerState(machine, blockedRuntime, 'B', 1, 0, true, 'linear', 'blocked' as AnimationInterruptMode);
        blockedParameters.setTrigger('toC');
        updateLayerRuntime(machine, blockedRuntime, blockedParameters, 0.1);
        expect(blockedRuntime.transition?.targetStateIndex).toBe(1);
        expect(blockedRuntime.transition?.progress).toBeCloseTo(0.1, 5);

        const backRuntime = createLayerRuntime(machine);
        const backParameters = makeParameters();
        crossFadeLayerState(machine, backRuntime, 'B', 1, 0, true, 'linear', undefined, 'target' as AnimationInterruptHandoff);
        backParameters.setTrigger('toC');
        updateLayerRuntime(machine, backRuntime, backParameters, 0.1);
        expect(backRuntime.transition?.sourceStateIndex).toBe(1);
        expect(backRuntime.transition?.durationSeconds).toBe(1);
    });
});

describe('authored easing survives the builder', () => {
    it('samples an eased blend at the eased weight instead of the linear one', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'A',
            states: [
                {
                    id: 'A',
                    motion: { kind: 'clip', clipId: 'a' },
                    transitions: [outTransition('B', 'toB', { easing: 'easeIn' })],
                },
                { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
                { id: 'C', motion: { kind: 'clip', clipId: 'c' } },
                { id: 'D', motion: { kind: 'clip', clipId: 'd' } },
            ],
        };
        const rebuilt: AnimationStateMachineDefinition = {
            ...definition,
            states: definition.states.map((state) => ({
                ...state,
                transitions: (state.transitions ?? []).map(buildAnimationTransitionDefinition),
            })),
        };
        // A constant source pose makes the blend weight observable: both states are sampled at
        // the same normalized time, so an animated source would cancel out the easing difference.
        const constantSourceClip = new AnimationClip(
            {
                id: 'a',
                tracks: [{ target: 'root', path: 'translation', times: [0], values: [0, 0, 0] }],
            },
            rig,
            curveLayout
        );
        const constantTargetClip = new AnimationClip(
            {
                id: 'b',
                tracks: [{ target: 'root', path: 'translation', times: [0], values: [1, 0, 0] }],
            },
            rig,
            curveLayout
        );
        const easedClips = new Map(clips);
        easedClips.set('a', constantSourceClip);
        easedClips.set('b', constantTargetClip);

        const machine = compileStateMachine(rebuilt, easedClips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        const context = makeContext(parameters);
        const out = new AnimationFrame(rig, curveLayout);

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0);
        updateLayerRuntime(machine, runtime, parameters, 0.5);
        expect(runtime.transition?.progress).toBeCloseTo(0.5, 5);

        evaluateLayerRuntime(machine, runtime, context, out);
        expect(out.pose.translations[0]).toBeCloseTo(0.25, 5);

        const linearDefinition: AnimationStateMachineDefinition = {
            ...definition,
            states: definition.states.map((state) => ({
                ...state,
                transitions: (state.transitions ?? []).map(({ easing: _easing, ...rest }) => rest),
            })),
        };
        const linearMachine = compileStateMachine(linearDefinition, easedClips);
        const linearRuntime = createLayerRuntime(linearMachine);
        const linearParameters = makeParameters();
        const linearContext = makeContext(linearParameters);
        const linearOut = new AnimationFrame(rig, curveLayout);
        linearParameters.setTrigger('toB');
        updateLayerRuntime(linearMachine, linearRuntime, linearParameters, 0);
        updateLayerRuntime(linearMachine, linearRuntime, linearParameters, 0.5);
        evaluateLayerRuntime(linearMachine, linearRuntime, linearContext, linearOut);
        expect(linearOut.pose.translations[0]).toBeCloseTo(0.5, 5);
    });

    it('weights collected events by the eased blend after the builder pass', () => {
        const eventClip = new AnimationClip(
            {
                id: 'e',
                tracks: [
                    {
                        target: 'root',
                        path: 'translation',
                        times: [0, 1],
                        values: [0, 0, 0, 1, 0, 0],
                    },
                ],
                events: [{ name: 'footfall', time: 0.5 }],
            },
            rig,
            curveLayout
        );
        const eventClips = new Map<string, AnimationClip>([
            ['a', clips.get('a')!],
            ['e', eventClip],
        ]);
        const definition: AnimationStateMachineDefinition = {
            entryState: 'A',
            states: [
                {
                    id: 'A',
                    motion: { kind: 'clip', clipId: 'a' },
                    transitions: [outTransition('E', 'toB', { easing: 'easeIn' })],
                },
                { id: 'E', motion: { kind: 'clip', clipId: 'e' } },
            ],
        };
        const rebuilt: AnimationStateMachineDefinition = {
            ...definition,
            states: definition.states.map((state) => ({
                ...state,
                transitions: (state.transitions ?? []).map(buildAnimationTransitionDefinition),
            })),
        };
        const machine = compileStateMachine(rebuilt, eventClips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        const context = makeContext(parameters);

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0);
        updateLayerRuntime(machine, runtime, parameters, 0.5);
        expect(runtime.transition?.progress).toBeCloseTo(0.5, 5);

        const events = collectLayerEvents(machine, runtime, context, 'base', 1);
        expect(events.length).toBe(1);
        expect(events[0]!.motionWeight).toBeCloseTo(0.25, 5);
    });
});
