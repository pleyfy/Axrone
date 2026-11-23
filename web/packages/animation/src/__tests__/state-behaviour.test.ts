// INCOMPLETE FEATURE — the Waker timed out before the implementation landed.
// Skipped tests are explicit and documented in .tmp/analysis/implementation/IMPLEMENTATION-FINAL.md.
import { describe, expect, it } from 'vitest';
import { AnimationClip } from '../clip';
import { AnimationController } from '../controller';
import { AnimationCurveLayout } from '../pose';
import { AnimationRig } from '../rig';
import { AnimationParameterStore } from '../parameters';
import { buildAnimationStateDefinition, createAnimationState } from '../controller-builder';
import { validateAnimationControllerDefinition } from '../controller-validator';
import {
    compileStateMachine,
    createLayerRuntime,
    dispatchLayerStateBehaviours,
    updateLayerRuntime,
} from '../state-machine';
import type {
    AnimationClipDefinition,
    AnimationControllerDefinition,
    AnimationStateMachineDefinition,
    AnimationStateSignal,
} from '../types';

const rig = new AnimationRig({ bones: [{ name: 'root' }] });
const curveLayout = new AnimationCurveLayout();

const clipOf = (id: string, extent: number): AnimationClipDefinition =>
    ({
        id,
        tracks: [{ target: 'root', path: 'translation', times: [0, 1], values: [0, 0, 0, extent, 0, 0] }],
    }) as unknown as AnimationClipDefinition;

const CLIPS = [clipOf('idle', 1), clipOf('walk', 2), clipOf('attack', 3)];

const CLIP_MAP = new Map<string, AnimationClip>(
    CLIPS.map((definition) => [String(definition.id), new AnimationClip(definition, rig, curveLayout)])
);

const CONTROLLER_PARAMETERS = [
    { name: 'move', kind: 'trigger' },
    { name: 'ready', kind: 'bool' },
    { name: 'charge', kind: 'float' },
    { name: 'fire', kind: 'trigger' },
] as const;

const controllerOf = (
    stateMachine: AnimationStateMachineDefinition,
    parameters: readonly { name: string; kind: string }[] = CONTROLLER_PARAMETERS
): AnimationControllerDefinition =>
    ({
        rig: { bones: [{ name: 'root' }] },
        clips: CLIPS,
        layers: [{ id: 'base', stateMachine }],
        parameters,
    }) as unknown as AnimationControllerDefinition;

const signalNames = (controller: AnimationController): string[] =>
    controller.stateSignals.map((signal) => `${signal.stateId}:${signal.phase}:${signal.signal}`);

const flatMachine = (): AnimationStateMachineDefinition => ({
    entryState: 'Idle',
    states: [
        {
            id: 'Idle',
            motion: { kind: 'clip', clipId: 'idle' },
            behaviours: [
                { id: 'idleEnter', phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'enter' }] },
                { id: 'idleTick', phase: 'update', actions: [{ kind: 'emitSignal', signal: 'tick' }] },
                { id: 'idleExit', phase: 'exit', actions: [{ kind: 'emitSignal', signal: 'exit' }] },
            ],
            transitions: [
                { to: 'Walk', duration: 0.25, fixedDuration: true, conditions: [{ kind: 'trigger', parameter: 'move' }] },
            ],
        },
        {
            id: 'Walk',
            motion: { kind: 'clip', clipId: 'walk' },
            behaviours: [
                { id: 'walkEnter', phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'enter' }] },
                { id: 'walkExit', phase: 'exit', actions: [{ kind: 'emitSignal', signal: 'exit' }] },
            ],
        },
    ],
});

describe('state scoped behaviours', () => {
    it('fires enter on the first step and update on every step after it', () => {
        const controller = new AnimationController(controllerOf(flatMachine()));

        controller.update(0.1);
        expect(signalNames(controller)).toEqual(['Idle:enter:enter', 'Idle:update:tick']);

        controller.update(0.1);
        expect(signalNames(controller)).toEqual(['Idle:update:tick']);
    });

    it('emits exit for the source before enter for the target of a crossfade', () => {
        const controller = new AnimationController(controllerOf(flatMachine()));
        controller.update(0.1);
        controller.parameters.setTrigger('move');
        controller.update(0.1);

        expect(signalNames(controller)).toEqual(['Idle:exit:exit', 'Walk:enter:enter']);
    });

    it('does not repeat enter or exit once the crossfade commits', () => {
        const controller = new AnimationController(controllerOf(flatMachine()));
        controller.update(0.1);
        controller.parameters.setTrigger('move');
        controller.update(0.25);
        expect(signalNames(controller)).toEqual(['Idle:exit:exit', 'Walk:enter:enter']);

        controller.update(0.25);
        expect(signalNames(controller)).toEqual([]);
    });

    it('enters the whole group chain outward-in and exits it inward-out', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Locomotion',
            states: [
                {
                    id: 'Locomotion',
                    childMachine: {
                        entryState: 'Idle',
                        states: [
                            {
                                id: 'Idle',
                                motion: { kind: 'clip', clipId: 'idle' },
                                behaviours: [
                                    { phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'in' }] },
                                    { phase: 'exit', actions: [{ kind: 'emitSignal', signal: 'out' }] },
                                ],
                                transitions: [{ to: 'Walk', duration: 0, conditions: [{ kind: 'trigger', parameter: 'move' }] }],
                            },
                            {
                                id: 'Walk',
                                motion: { kind: 'clip', clipId: 'walk' },
                                behaviours: [
                                    { phase: 'exit', actions: [{ kind: 'emitSignal', signal: 'out' }] },
                                ],
                            },
                        ],
                    },
                    behaviours: [
                        { phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'in' }] },
                        { phase: 'exit', actions: [{ kind: 'emitSignal', signal: 'out' }] },
                    ],
                    transitions: [{ to: 'Attack', duration: 0, conditions: [{ kind: 'trigger', parameter: 'fire' }] }],
                },
                { id: 'Attack', motion: { kind: 'clip', clipId: 'attack' } },
            ],
        };
        const controller = new AnimationController(controllerOf(machine));

        controller.update(0.1);
        expect(signalNames(controller)).toEqual([
            'Locomotion:enter:in',
            'Locomotion/Idle:enter:in',
        ]);

        // A sibling swap stops the leaf it leaves and starts the leaf it enters;
        // the group above them keeps its own enter undispatched.
        controller.parameters.setTrigger('move');
        controller.update(0.1);
        expect(signalNames(controller)).toEqual(['Locomotion/Idle:exit:out']);

        // A zero-length crossfade settles on the following step without touching the
        // lifecycle again, and only then can the group be left.
        controller.update(0.1);
        expect(signalNames(controller)).toEqual([]);

        // Leaving the group exits the whole remaining chain, innermost first.
        controller.parameters.setTrigger('fire');
        controller.update(0.1);
        expect(signalNames(controller)).toEqual([
            'Locomotion/Walk:exit:out',
            'Locomotion:exit:out',
        ]);
    });

    it('writes parameters through behaviour actions', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        {
                            phase: 'enter',
                            actions: [
                                { kind: 'writeParameter', parameter: 'charge', value: 7 },
                                { kind: 'writeParameter', parameter: 'ready', value: true },
                            ],
                        },
                    ],
                },
            ],
        };
        const controller = new AnimationController(controllerOf(machine));
        controller.update(0.1);

        expect(controller.parameters.get('charge')).toBe(7);
        expect(controller.parameters.get('ready')).toBe(true);
    });

    it('pulses a trigger that a later transition can consume', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [{ phase: 'enter', actions: [{ kind: 'pulseTrigger', parameter: 'move' }] }],
                    transitions: [
                        { to: 'Walk', duration: 0.1, fixedDuration: true, conditions: [{ kind: 'trigger', parameter: 'move' }] },
                    ],
                },
                { id: 'Walk', motion: { kind: 'clip', clipId: 'walk' } },
            ],
        };
        const controller = new AnimationController(controllerOf(machine));

        controller.update(0.1);
        expect(controller.profile.activeLayers[0]!.stateId).toContain('Walk');
    });

    it('gates a behaviour on its own conditions and re-evaluates them', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        {
                            phase: 'enter',
                            conditions: [{ kind: 'bool', parameter: 'ready', value: true }],
                            actions: [{ kind: 'emitSignal', signal: 'armed' }],
                        },
                    ],
                },
            ],
        };
        const blocked = new AnimationController(controllerOf(machine));
        blocked.update(0.1);
        expect(signalNames(blocked)).toEqual([]);

        const allowed = new AnimationController(controllerOf(machine));
        allowed.parameters.setBool('ready', true);
        allowed.update(0.1);
        expect(signalNames(allowed)).toEqual(['Idle:enter:armed']);
    });

    it('throttles update behaviours by intervalSeconds', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        {
                            phase: 'update',
                            intervalSeconds: 0.5,
                            actions: [{ kind: 'emitSignal', signal: 'beat' }],
                        },
                    ],
                },
            ],
        };
        const controller = new AnimationController(controllerOf(machine));

        controller.update(0.3);
        expect(signalNames(controller)).toEqual(['Idle:update:beat']);

        controller.update(0.3);
        expect(signalNames(controller)).toEqual([]);

        controller.update(0.3);
        expect(signalNames(controller)).toEqual(['Idle:update:beat']);
    });

    it('keeps behaviours out of the loop when a machine declares none', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [{ id: 'Idle', motion: { kind: 'clip', clipId: 'idle' } }],
        };
        const controller = new AnimationController(controllerOf(machine));

        expect(machineHasBehaviours(machine)).toBe(false);
        controller.update(0.1);
        expect(controller.stateSignals).toEqual([]);
    });

    it('dispatches exit before enter inside a single step', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [{ phase: 'exit', actions: [{ kind: 'emitSignal', signal: 'x' }] }],
                    transitions: [{ to: 'Walk', duration: 0 }],
                },
                {
                    id: 'Walk',
                    motion: { kind: 'clip', clipId: 'walk' },
                    behaviours: [{ phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'e' }] }],
                },
            ],
        };
        const compiled = compileStateMachine(machine, CLIP_MAP);
        const runtime = createLayerRuntime(compiled);
        const parameters = new AnimationParameterStore(CONTROLLER_PARAMETERS);
        const sink: AnimationStateSignal[] = [];

        updateLayerRuntime(compiled, runtime, parameters, 0.1);
        dispatchLayerStateBehaviours(compiled, runtime, parameters, 'base', 0.1, sink);

        expect(sink.map((signal) => `${signal.stateId}:${signal.phase}:${signal.signal}`)).toEqual([
            'Idle:exit:x',
            'Walk:enter:e',
        ]);

        const second: AnimationStateSignal[] = [];
        updateLayerRuntime(compiled, runtime, parameters, 0.1);
        dispatchLayerStateBehaviours(compiled, runtime, parameters, 'base', 0.1, second);
        expect(second).toEqual([]);
    });

    it('carries the behaviour payload through to the signal', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        {
                            id: 'greeter',
                            phase: 'enter',
                            actions: [{ kind: 'emitSignal', signal: 'hello', payload: { who: 'player' } }],
                        },
                    ],
                },
            ],
        };
        const controller = new AnimationController(controllerOf(machine));
        controller.update(0.1);

        expect(controller.stateSignals[0]).toMatchObject({
            layerId: 'base',
            stateId: 'Idle',
            behaviourId: 'greeter',
            phase: 'enter',
            signal: 'hello',
            payload: { who: 'player' },
        });
    });

    it('preserves behaviours through the builder and the raw definition build', () => {
        const built = createAnimationState('Idle', { kind: 'clip', clipId: 'idle' }).onEnter([
            { kind: 'writeParameter', parameter: 'charge', value: 3 },
        ]);
        expect((built.buildUnsafe() as { behaviours?: unknown[] }).behaviours).toHaveLength(1);

        const raw = buildAnimationStateDefinition({
            id: 'Idle',
            motion: { kind: 'clip', clipId: 'idle' },
            behaviours: [{ phase: 'exit', actions: [{ kind: 'emitSignal', signal: 'bye' }] }],
        });
        expect(raw.behaviours?.[0]?.phase).toBe('exit');
        expect(Object.isFrozen(raw.behaviours?.[0]?.actions?.[0])).toBe(true);
    });

    it('rejects actions that are not part of the closed vocabulary', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        {
                            phase: 'enter',
                            actions: [{ kind: 'eval', code: 'doEvil()' } as never],
                        },
                    ],
                },
            ],
        };

        const codes = validateAnimationControllerDefinition(controllerOf(machine)).map((d) => d.code);
        expect(codes).toContain('animation.controller.state.behaviour.action.unsupported');
        expect(() => compileStateMachine(machine, CLIP_MAP)).toThrow(/Unknown animation state behaviour action/);
    });

    it('rejects an unknown phase, an empty action list and a bad interval', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        { phase: 'whenever' as never, actions: [{ kind: 'pulseTrigger', parameter: 'move' }] },
                        { phase: 'exit', actions: [] },
                        {
                            phase: 'update',
                            intervalSeconds: -2,
                            actions: [{ kind: 'emitSignal', signal: 'x' }],
                        },
                    ],
                },
            ],
        };

        const codes = validateAnimationControllerDefinition(controllerOf(machine)).map((d) => d.code);
        expect(codes).toContain('animation.controller.state.behaviour.phase.invalid');
        expect(codes).toContain('animation.controller.state.behaviour.actions.empty');
        expect(codes).toContain('animation.controller.state.behaviour.interval.invalid');
    });

    it('rejects an empty signal and an unknown behaviour parameter', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        { phase: 'enter', actions: [{ kind: 'emitSignal', signal: '' }] },
                        { phase: 'enter', actions: [{ kind: 'writeParameter', parameter: 'ghost', value: 1 }] },
                    ],
                },
            ],
        };

        const codes = validateAnimationControllerDefinition(controllerOf(machine)).map((d) => d.code);
        expect(codes).toContain('animation.controller.state.behaviour.action.signal.empty');
        expect(codes).toContain('animation.controller.parameter.unknown');
    });

    it('accepts a fully authored behaviour set', () => {
        expect(validateAnimationControllerDefinition(controllerOf(flatMachine()))).toEqual([]);
    });

    it('runs the update phase once per step when a pulse starts a crossfade', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        { phase: 'enter', actions: [{ kind: 'pulseTrigger', parameter: 'move' }] },
                        { phase: 'update', actions: [{ kind: 'emitSignal', signal: 'tick' }] },
                    ],
                    transitions: [
                        { to: 'Walk', duration: 0.2, fixedDuration: true, conditions: [{ kind: 'trigger', parameter: 'move' }] },
                    ],
                },
                {
                    id: 'Walk',
                    motion: { kind: 'clip', clipId: 'walk' },
                    behaviours: [{ phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'landed' }] }],
                },
            ],
        };
        const controller = new AnimationController(controllerOf(machine));
        controller.update(0.1);

        expect(signalNames(controller)).toEqual(['Idle:update:tick', 'Walk:enter:landed']);
        expect(controller.parameters.get('move')).toBe(false);
    });

    it('bounds the pulse feedback loop between two states', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                {
                    id: 'Idle',
                    motion: { kind: 'clip', clipId: 'idle' },
                    behaviours: [
                        {
                            phase: 'enter',
                            actions: [
                                { kind: 'emitSignal', signal: 'i' },
                                { kind: 'pulseTrigger', parameter: 'move' },
                            ],
                        },
                    ],
                    transitions: [
                        { to: 'Walk', duration: 0.2, fixedDuration: true, conditions: [{ kind: 'trigger', parameter: 'move' }] },
                    ],
                },
                {
                    id: 'Walk',
                    motion: { kind: 'clip', clipId: 'walk' },
                    behaviours: [
                        {
                            phase: 'enter',
                            actions: [
                                { kind: 'emitSignal', signal: 'w' },
                                { kind: 'pulseTrigger', parameter: 'fire' },
                            ],
                        },
                    ],
                    transitions: [
                        { to: 'Idle', duration: 0.2, fixedDuration: true, conditions: [{ kind: 'trigger', parameter: 'fire' }] },
                    ],
                },
            ],
        };
        const controller = new AnimationController(controllerOf(machine));

        controller.update(0.1);
        expect(signalNames(controller)).toEqual(['Idle:enter:i', 'Walk:enter:w']);
        expect(controller.profile.activeLayers[0]!.stateId).toContain('Walk');
    });

    it('enters and exits the entry chain it superseded inside the same step', () => {
        const machine: AnimationStateMachineDefinition = {
            entryState: 'Locomotion',
            states: [
                {
                    id: 'Locomotion',
                    childMachine: {
                        entryState: 'Idle',
                        states: [
                            {
                                id: 'Idle',
                                motion: { kind: 'clip', clipId: 'idle' },
                                behaviours: [
                                    { phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'in' }] },
                                    { phase: 'exit', actions: [{ kind: 'emitSignal', signal: 'out' }] },
                                ],
                                transitions: [{ to: 'Walk', duration: 0 }],
                            },
                            {
                                id: 'Walk',
                                motion: { kind: 'clip', clipId: 'walk' },
                                behaviours: [{ phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'in' }] }],
                            },
                        ],
                    },
                    behaviours: [{ phase: 'enter', actions: [{ kind: 'emitSignal', signal: 'in' }] }],
                },
            ],
        };
        const compiled = compileStateMachine(machine, CLIP_MAP);
        const runtime = createLayerRuntime(compiled);
        const parameters = new AnimationParameterStore(CONTROLLER_PARAMETERS);
        const sink: AnimationStateSignal[] = [];

        updateLayerRuntime(compiled, runtime, parameters, 0.1);
        dispatchLayerStateBehaviours(compiled, runtime, parameters, 'base', 0.1, sink);

        expect(sink.map((signal) => `${signal.stateId}:${signal.phase}:${signal.signal}`)).toEqual([
            'Locomotion:enter:in',
            'Locomotion/Idle:enter:in',
            'Locomotion/Idle:exit:out',
            'Locomotion/Walk:enter:in',
        ]);
    });
});

const machineHasBehaviours = (machine: AnimationStateMachineDefinition): boolean => {
    const compiled = compileStateMachine(machine, CLIP_MAP);
    return compiled.hasStateBehaviours;
};

