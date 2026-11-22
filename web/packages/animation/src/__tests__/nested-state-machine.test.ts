import { describe, expect, it } from 'vitest';
import { AnimationClip } from '../clip';
import { AnimationController } from '../controller';
import { AnimationValidationError } from '../errors';
import { AnimationParameterStore } from '../parameters';
import { AnimationCurveLayout } from '../pose';
import { AnimationRig } from '../rig';
import { buildAnimationStateDefinition, createAnimationStateMachine } from '../controller-builder';
import { validateAnimationControllerDefinition } from '../controller-validator';
import {
    ANIMATION_MAX_STATE_NESTING_DEPTH,
    ANIMATION_NESTED_STATE_SEPARATOR,
    compileStateMachine,
    commitLayerRuntime,
    createLayerRuntime,
    forceLayerState,
    updateLayerRuntime,
    type AnimationCompiledStateMachine,
    type AnimationLayerRuntime,
} from '../state-machine';
import type {
    AnimationClipDefinition,
    AnimationControllerDefinition,
    AnimationStateMachineDefinition,
    AnimationStateDefinition,
} from '../types';

const rig = new AnimationRig({ bones: [{ name: 'root' }] });
const curveLayout = new AnimationCurveLayout();

const CLIP_EXTENTS: Readonly<Record<string, number>> = { idle: 1, walk: 2, run: 3, attack: 4 };

const CLIP_DEFINITIONS: readonly AnimationClipDefinition[] = Object.entries(CLIP_EXTENTS).map(
    ([id, extent]) =>
        ({
            id,
            tracks: [
                { target: 'root', path: 'translation', times: [0, 1], values: [0, 0, 0, extent, 0, 0] },
            ],
        }) as AnimationClipDefinition
);

const clips = new Map<string, AnimationClip>(
    CLIP_DEFINITIONS.map((definition) => [String(definition.id), new AnimationClip(definition, rig, curveLayout)])
);

const leaf = (
    id: string,
    clipId: string,
    extra: Partial<AnimationStateDefinition> = {}
): AnimationStateDefinition => ({
    id,
    motion: { kind: 'clip', clipId },
    ...extra,
});

const locomotionMachine = (): AnimationStateMachineDefinition => ({
    entryState: 'Idle',
    states: [
        leaf('Idle', 'idle', {
            transitions: [
                {
                    to: 'Walk',
                    duration: 0.5,
                    fixedDuration: true,
                    conditions: [{ kind: 'trigger', parameter: 'move' }],
                },
            ],
        }),
        leaf('Walk', 'walk', {
            transitions: [
                {
                    to: 'Run',
                    duration: 0.5,
                    fixedDuration: true,
                    conditions: [{ kind: 'trigger', parameter: 'sprint' }],
                },
            ],
        }),
        leaf('Run', 'run'),
    ],
});

const groupDefinition = (
    groupTransitions: readonly AnimationStateDefinition['transitions'][number][] = []
): AnimationStateMachineDefinition => ({
    entryState: 'Locomotion',
    states: [
        { id: 'Locomotion', childMachine: locomotionMachine(), transitions: groupTransitions },
        leaf('Attack', 'attack', {
            transitions: [{ to: 'Locomotion', duration: 0.25, fixedDuration: true }],
        }),
    ],
});

const PARAMETERS = [
    { name: 'move', kind: 'trigger' },
    { name: 'sprint', kind: 'trigger' },
    { name: 'exit', kind: 'trigger' },
] as const;

const makeParameters = (): AnimationParameterStore => new AnimationParameterStore(PARAMETERS);

const activeStateId = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime
): string =>
    machine.states[runtime.transition ? runtime.transition.targetStateIndex : runtime.currentStateIndex]!.id;

/** Runs whole update+commit steps until the layer settles on a state without a crossfade. */
const settle = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    parameters: AnimationParameterStore,
    deltaSeconds: number,
    maxSteps = 16
): void => {
    for (let step = 0; step < maxSteps; step += 1) {
        updateLayerRuntime(machine, runtime, parameters, deltaSeconds);
        commitLayerRuntime(runtime);
        if (!runtime.transition) {
            return;
        }
    }
    throw new Error('layer did not settle');
};

const controllerOf = (
    stateMachine: AnimationStateMachineDefinition
): AnimationControllerDefinition =>
    ({
        rig: { bones: [{ name: 'root' }] },
        clips: CLIP_DEFINITIONS,
        layers: [{ id: 'base', stateMachine }],
        parameters: PARAMETERS,
    }) as unknown as AnimationControllerDefinition;

describe('nested state machines', () => {
    it('flattens a child machine into prefixed leaf states', () => {
        const machine = compileStateMachine(groupDefinition(), clips);

        expect(machine.states.map((state) => state.id)).toEqual([
            `Locomotion${ANIMATION_NESTED_STATE_SEPARATOR}Idle`,
            `Locomotion${ANIMATION_NESTED_STATE_SEPARATOR}Walk`,
            `Locomotion${ANIMATION_NESTED_STATE_SEPARATOR}Run`,
            'Attack',
        ]);
        expect(machine.maxNestingDepth).toBe(1);
        expect(machine.entryStateIndex).toBe(0);
    });

    it('resolves a group id to the entry state of its child machine', () => {
        const machine = compileStateMachine(groupDefinition(), clips);

        expect(machine.stateIndexById.get('Locomotion')).toBe(machine.stateIndexById.get('Locomotion/Idle'));
        expect(machine.states[machine.stateIndexById.get('Locomotion')!]!.id).toBe('Locomotion/Idle');
    });

    it('keeps flat machines on the pre-nesting shape', () => {
        const flat: AnimationStateMachineDefinition = {
            entryState: 'Idle',
            states: [
                leaf('Idle', 'idle', { transitions: [{ to: 'Walk', duration: 1 }] }),
                leaf('Walk', 'walk'),
            ],
        };
        const machine = compileStateMachine(flat, clips);

        expect(machine.states.map((state) => state.id)).toEqual(['Idle', 'Walk']);
        expect(machine.states.map((state) => state.localId)).toEqual(['Idle', 'Walk']);
        expect(machine.maxNestingDepth).toBe(0);
        expect(machine.states[0]!.transitions[0]!.targetStateIndex).toBe(1);
        expect(machine.states[0]!.nestingDepth).toBe(0);
    });

    it('enters, advances and exits inside the child machine at runtime', () => {
        const machine = compileStateMachine(groupDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        expect(activeStateId(machine, runtime)).toBe('Locomotion/Idle');

        parameters.setTrigger('move');
        settle(machine, runtime, parameters, 0.5);
        expect(activeStateId(machine, runtime)).toBe('Locomotion/Walk');
        expect(runtime.currentStateIndex).toBe(machine.stateIndexById.get('Locomotion/Walk'));

        parameters.setTrigger('sprint');
        settle(machine, runtime, parameters, 0.5);
        expect(activeStateId(machine, runtime)).toBe('Locomotion/Run');
    });

    it('fires a transition authored on the group from any state inside it', () => {
        const machine = compileStateMachine(
            groupDefinition([
                {
                    to: 'Attack',
                    duration: 0.25,
                    fixedDuration: true,
                    conditions: [{ kind: 'trigger', parameter: 'exit' }],
                },
            ]),
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        parameters.setTrigger('move');
        settle(machine, runtime, parameters, 0.5);
        expect(activeStateId(machine, runtime)).toBe('Locomotion/Walk');

        parameters.setTrigger('exit');
        settle(machine, runtime, parameters, 0.25);
        expect(activeStateId(machine, runtime)).toBe('Attack');
        expect(runtime.currentStateIndex).toBe(machine.stateIndexById.get('Attack'));
    });

    it('maps a group to its entry leaf no matter where the group is declared', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'Attack',
            states: [
                leaf('Attack', 'attack'),
                { id: 'Locomotion', childMachine: locomotionMachine() },
                leaf('Idle', 'run'),
            ],
        };
        const machine = compileStateMachine(definition, clips);

        expect(machine.states.map((state) => state.id)).toEqual([
            'Attack',
            'Locomotion/Idle',
            'Locomotion/Walk',
            'Locomotion/Run',
            'Idle',
        ]);
        expect(machine.stateIndexById.get('Locomotion')).toBe(1);
        expect(machine.states[1]!.id).toBe('Locomotion/Idle');
    });

    it('re-enters the child machine entry when a transition targets the group', () => {
        const machine = compileStateMachine(groupDefinition(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        forceLayerState(machine, runtime, 'Attack');
        expect(activeStateId(machine, runtime)).toBe('Attack');

        settle(machine, runtime, parameters, 0.25);
        expect(activeStateId(machine, runtime)).toBe('Locomotion/Idle');
        expect(runtime.currentStateIndex).toBe(machine.stateIndexById.get('Locomotion/Idle'));
    });

    it('scales the clock of every leaf by the speed of its groups', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'Locomotion',
            states: [
                {
                    id: 'Locomotion',
                    childMachine: { entryState: 'Idle', states: [leaf('Idle', 'idle', { speed: 2 })] },
                    speed: 2,
                },
            ],
        };
        const machine = compileStateMachine(definition, clips);

        expect(machine.states[0]!.speed).toBeCloseTo(4, 6);
    });

    it('drives the pose of a nested leaf through the controller', () => {
        const controller = new AnimationController(controllerOf(groupDefinition()));
        controller.seek(0.75);

        expect(controller.profile.activeLayers[0]!.stateId).toBe('Locomotion/Idle');
        expect(controller.currentFrame.pose.translations[0]).toBeCloseTo(0.75 * CLIP_EXTENTS.idle, 5);
    });

    it('supports the group builder and the raw definition round trip', () => {
        const built = createAnimationStateMachine()
            .group(
                'Locomotion',
                createAnimationStateMachine('Idle').state('Idle', { kind: 'clip', clipId: 'idle' })
            )
            .state('Attack', { kind: 'clip', clipId: 'attack' });
        const machine = compileStateMachine(
            built.buildUnsafe() as unknown as AnimationStateMachineDefinition,
            clips
        );

        expect(machine.states.map((state) => state.id)).toEqual(['Locomotion/Idle', 'Attack']);

        const raw = buildAnimationStateDefinition({
            id: 'Locomotion',
            childMachine: locomotionMachine(),
        });
        expect(raw.childMachine?.states).toHaveLength(3);
        expect(raw.motion).toBeUndefined();
    });

    it('rejects a state that declares both a motion and a child machine', () => {
        expect(() =>
            compileStateMachine(
                {
                    entryState: 'G',
                    states: [
                        {
                            id: 'G',
                            motion: { kind: 'clip', clipId: 'idle' },
                            childMachine: locomotionMachine(),
                        },
                    ],
                },
                clips
            )
        ).toThrow(AnimationValidationError);
    });

    it('rejects a child machine whose entry state does not exist', () => {
        expect(() =>
            compileStateMachine(
                {
                    entryState: 'G',
                    states: [{ id: 'G', childMachine: { entryState: 'Nope', states: [leaf('Idle', 'idle')] } }],
                },
                clips
            )
        ).toThrow(/Unknown animation entry state 'Nope'/);
    });

    it('rejects a leaf without motion and without child machine', () => {
        expect(() =>
            compileStateMachine({ entryState: 'A', states: [{ id: 'A' }] }, clips)
        ).toThrow(/requires a motion or a child machine/);
    });

    it('rejects ids containing the nesting separator once the machine nests', () => {
        expect(() =>
            compileStateMachine(
                {
                    entryState: 'G',
                    states: [
                        {
                            id: 'G',
                            childMachine: { entryState: 'Bad', states: [leaf('Bad/Deep', 'idle')] },
                        },
                    ],
                },
                clips
            )
        ).toThrow(/may not contain/);
    });

    it('rejects nesting deeper than the engine maximum', () => {
        let inner: AnimationStateMachineDefinition = {
            entryState: 'Leaf',
            states: [leaf('Leaf', 'idle')],
        };
        for (let level = 0; level <= ANIMATION_MAX_STATE_NESTING_DEPTH; level += 1) {
            inner = { entryState: `G${level}`, states: [{ id: `G${level}`, childMachine: inner }] };
        }

        expect(() => compileStateMachine(inner, clips)).toThrow(/exceeds the maximum/);
    });
});

describe('nested state machine validation', () => {
    it('accepts a well formed nested controller', () => {
        expect(validateAnimationControllerDefinition(controllerOf(groupDefinition()))).toEqual([]);
    });

    it('reports a transition target that exists nowhere in scope', () => {
        const definition = groupDefinition();
        (definition.states[0]!.childMachine as AnimationStateMachineDefinition).states[0]!.transitions = [
            { to: 'Nowhere' },
        ];

        expect(validateAnimationControllerDefinition(controllerOf(definition)).map((d) => d.code)).toContain(
            'animation.controller.state.unknown'
        );
    });

    it('resolves a child transition against an outer sibling', () => {
        const definition = groupDefinition();
        (definition.states[0]!.childMachine as AnimationStateMachineDefinition).states[2]!.transitions = [
            { to: 'Attack' },
        ];

        expect(validateAnimationControllerDefinition(controllerOf(definition))).toEqual([]);
    });

    it('reports the state that mixes a motion with a child machine', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'G',
            states: [{ id: 'G', motion: { kind: 'clip', clipId: 'idle' }, childMachine: locomotionMachine() }],
        };

        const diagnostics = validateAnimationControllerDefinition(controllerOf(definition));
        expect(diagnostics.map((d) => d.code)).toContain('animation.controller.state.source.conflict');
        expect(diagnostics.some((d) => d.path.endsWith('states[0].childMachine'))).toBe(true);
    });

    it('reports the state that has neither motion nor child machine', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'G',
            states: [{ id: 'G' }],
        };

        expect(validateAnimationControllerDefinition(controllerOf(definition)).map((d) => d.code)).toContain(
            'animation.controller.state.motion.missing'
        );
    });

    it('reports a duplicate state inside a child machine', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'G',
            states: [
                {
                    id: 'G',
                    childMachine: { entryState: 'Idle', states: [leaf('Idle', 'idle'), leaf('Idle', 'walk')] },
                },
            ],
        };

        expect(validateAnimationControllerDefinition(controllerOf(definition)).map((d) => d.code)).toContain(
            'animation.controller.state.duplicate'
        );
    });

    it('reports nesting beyond the maximum', () => {
        let inner: AnimationStateMachineDefinition = { entryState: 'Leaf', states: [leaf('Leaf', 'idle')] };
        for (let level = 0; level <= ANIMATION_MAX_STATE_NESTING_DEPTH; level += 1) {
            inner = { entryState: `G${level}`, states: [{ id: `G${level}`, childMachine: inner }] };
        }

        expect(validateAnimationControllerDefinition(controllerOf(inner)).map((d) => d.code)).toContain(
            'animation.controller.state.nesting.depth'
        );
    });
});
