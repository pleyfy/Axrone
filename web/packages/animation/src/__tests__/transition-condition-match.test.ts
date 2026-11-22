import { describe, expect, it } from 'vitest';
import { AnimationClip } from '../clip';
import { buildAnimationTransitionDefinition, AnimationTransitionBuilder } from '../controller-builder';
import { validateAnimationStateMachineDefinition } from '../controller-validator';
import { AnimationValidationError } from '../errors';
import { AnimationParameterStore } from '../parameters';
import { AnimationCurveLayout } from '../pose';
import { AnimationRig } from '../rig';
import { compileStateMachine, createLayerRuntime, updateLayerRuntime } from '../state-machine';
import type {
    AnimationConditionDefinition,
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
]);

const makeParameters = (definitions: readonly AnimationParameterDefinition[]) =>
    new AnimationParameterStore(definitions);

const makeMachineDefinition = (
    transitions: readonly AnimationTransitionDefinition[]
): AnimationStateMachineDefinition => ({
    entryState: 'A',
    states: [
        { id: 'A', motion: { kind: 'clip', clipId: 'a' }, transitions },
        { id: 'B', motion: { kind: 'clip', clipId: 'b' } },
        { id: 'C', motion: { kind: 'clip', clipId: 'c' } },
    ],
});

const passingFloat = (): AnimationConditionDefinition => ({
    kind: 'float',
    parameter: 'speed',
    operator: '>',
    value: 0.5,
});

const failingFloat = (): AnimationConditionDefinition => ({
    kind: 'float',
    parameter: 'speed',
    operator: '>',
    value: 5,
});

const passingTrigger = (parameter: string): AnimationConditionDefinition => ({
    kind: 'trigger',
    parameter,
});

describe('transition condition match mode', () => {
    it('requires every condition when matching with all', () => {
        const machine = compileStateMachine(
            makeMachineDefinition([
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditionMatch: 'all',
                    conditions: [passingFloat(), failingFloat()],
                },
            ]),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([{ name: 'speed', kind: 'float', defaultValue: 1 }]);

        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).toBeNull();
        expect(runtime.currentStateIndex).toBe(0);
    });

    it('starts the transition when matching with any and one condition passes', () => {
        const machine = compileStateMachine(
            makeMachineDefinition([
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditionMatch: 'any',
                    conditions: [failingFloat(), passingTrigger('toB')],
                },
            ]),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([
            { name: 'speed', kind: 'float', defaultValue: 1 },
            { name: 'toB', kind: 'trigger' },
        ]);

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);
    });

    it('keeps an any transition idle when no condition passes', () => {
        const machine = compileStateMachine(
            makeMachineDefinition([
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditionMatch: 'any',
                    conditions: [failingFloat(), { kind: 'bool', parameter: 'active', value: true }],
                },
            ]),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([
            { name: 'speed', kind: 'float', defaultValue: 1 },
            { name: 'active', kind: 'bool', defaultValue: false },
        ]);

        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).toBeNull();
    });

    it('treats a transition without a condition match key as all', () => {
        const definition = makeMachineDefinition([
            {
                to: 'B',
                duration: 1,
                fixedDuration: true,
                conditions: [passingFloat(), failingFloat()],
            },
        ]);
        const implicit = compileStateMachine(definition, clips);
        const explicit = compileStateMachine(
            makeMachineDefinition([
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditionMatch: 'all',
                    conditions: [passingFloat(), failingFloat()],
                },
            ]),
            clips
        );
        const parameters = makeParameters([{ name: 'speed', kind: 'float', defaultValue: 1 }]);

        const implicitRuntime = createLayerRuntime(implicit);
        updateLayerRuntime(implicit, implicitRuntime, parameters, 0.1);
        const explicitRuntime = createLayerRuntime(explicit);
        updateLayerRuntime(explicit, explicitRuntime, parameters, 0.1);

        expect(implicitRuntime.transition).toBeNull();
        expect(explicitRuntime.transition).toBeNull();
    });

    it('fires an any transition that has no conditions', () => {
        const machine = compileStateMachine(
            makeMachineDefinition([
                { to: 'B', duration: 1, fixedDuration: true, conditionMatch: 'any', conditions: [] },
            ]),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([{ name: 'speed', kind: 'float', defaultValue: 0 }]);

        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);
    });

    it('rejects an unknown condition match at compile time', () => {
        expect(() =>
            compileStateMachine(
                makeMachineDefinition([
                    {
                        to: 'B',
                        duration: 1,
                        fixedDuration: true,
                        conditionMatch: 'or' as never,
                        conditions: [passingFloat()],
                    },
                ]),
                clips
            )
        ).toThrow(AnimationValidationError);
    });

    it('reports a diagnostic for an unsupported condition match in a definition', () => {
        const diagnostics = validateAnimationStateMachineDefinition(
            makeMachineDefinition([
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditionMatch: 'some' as never,
                    conditions: [passingFloat()],
                },
            ])
        );
        expect(diagnostics.length).toBe(1);
        expect(diagnostics[0]!.code).toBe('animation.controller.transition.conditionMatch.invalid');
    });

    it('accepts a definition using the any condition match', () => {
        const diagnostics = validateAnimationStateMachineDefinition(
            makeMachineDefinition([
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditionMatch: 'any',
                    conditions: [passingFloat()],
                },
            ])
        );
        expect(diagnostics.length).toBe(0);
    });

    it('preserves the condition match through builder round trips', () => {
        const built = new AnimationTransitionBuilder('B').withConditionMatch('any').buildUnsafe();
        expect(built.conditionMatch).toBe('any');

        const fromRaw = buildAnimationTransitionDefinition({ to: 'B', conditionMatch: 'any' });
        expect(fromRaw.conditionMatch).toBe('any');

        const withoutMatch = buildAnimationTransitionDefinition({ to: 'B' });
        expect('conditionMatch' in withoutMatch).toBe(false);
    });

    it('consumes every trigger of an any transition that fired on its last condition', () => {
        const machine = compileStateMachine(
            makeMachineDefinition([
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditionMatch: 'any',
                    conditions: [
                        { kind: 'trigger', parameter: 'toB' },
                        { kind: 'trigger', parameter: 'toC' },
                    ],
                },
            ]),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([
            { name: 'toB', kind: 'trigger' },
            { name: 'toC', kind: 'trigger' },
        ]);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);
        expect(parameters.get('toB')).toBe(false);
        expect(parameters.get('toC')).toBe(false);
    });

    it('mixes failing numeric and passing boolean conditions under any', () => {
        const machine = compileStateMachine(
            makeMachineDefinition([
                {
                    to: 'B',
                    duration: 1,
                    fixedDuration: true,
                    conditionMatch: 'any',
                    conditions: [failingFloat(), { kind: 'bool', parameter: 'active', value: true }],
                },
            ]),
            clips
        );
        const parameters = makeParameters([
            { name: 'speed', kind: 'float', defaultValue: 1 },
            { name: 'active', kind: 'bool' },
        ]);
        const runtime = createLayerRuntime(machine);

        parameters.set('active', true);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);

        parameters.set('active', false);
        const idleRuntime = createLayerRuntime(machine);
        updateLayerRuntime(machine, idleRuntime, parameters, 0.1);
        expect(idleRuntime.transition).toBeNull();
    });

    it('honors the any condition match while interrupting a running transition', () => {
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
                                duration: 1,
                                fixedDuration: true,
                                canInterrupt: true,
                                conditions: [{ kind: 'trigger', parameter: 'toB' }],
                            },
                            {
                                to: 'C',
                                duration: 0.5,
                                fixedDuration: true,
                                conditionMatch: 'any',
                                conditions: [
                                    { kind: 'trigger', parameter: 'unused' },
                                    { kind: 'trigger', parameter: 'toC' },
                                ],
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
        const parameters = makeParameters([
            { name: 'toB', kind: 'trigger' },
            { name: 'toC', kind: 'trigger' },
            { name: 'unused', kind: 'trigger' },
        ]);

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(1);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition?.targetStateIndex).toBe(2);
    });
});
