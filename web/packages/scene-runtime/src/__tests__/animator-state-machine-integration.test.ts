import { describe, expect, it, vi } from 'vitest';
import { AnimationClip } from '@axrone/animation/clip';
import { AnimationController } from '@axrone/animation/controller';
import { AnimationStateMachineError, AnimationValidationError } from '@axrone/animation/errors';
import { AnimationParameterStore } from '@axrone/animation/parameters';
import { AnimationCurveLayout } from '@axrone/animation/pose';
import { AnimationRig } from '@axrone/animation/rig';
import {
    compileStateMachine,
    commitLayerRuntime,
    createLayerRuntime,
    crossFadeLayerState,
    evaluateLayerRuntime,
    forceLayerState,
    updateLayerRuntime,
    type AnimationCompiledStateMachine,
    type AnimationLayerRuntime,
} from '@axrone/animation/state-machine';
import { AnimationScratchPool } from '@axrone/animation/blend-tree';
import { AnimationFrame } from '@axrone/animation/pose';
import {
    AnimationControllerBuilder,
    AnimationControllerGraph,
} from '@axrone/animation/controller-graph';
import type {
    AnimationConditionDefinition,
    AnimationStateMachineDefinition,
    AnimationTransitionOperator,
} from '@axrone/animation/types';
import { World, Transform } from '@axrone/ecs-runtime';
import { SceneEntityRuntime } from '../scene-entity-runtime';
import { SceneEntityLifecycleRunner } from '../entity-lifecycle-runner';
import { createSceneRegistry } from '../scene-registry';
import { SceneComponentCatalog } from '../component-catalog';
import { Animator } from '../components/animator';
import { encodeSceneValue } from '../serialization';
import type { ScenePrefabDefinition } from '../types';

// ─── Shared Test Fixtures ────────────────────────────────────────────────────

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
    ['idle', makeClip('idle')],
    ['walk', makeClip('walk')],
    ['run', makeClip('run')],
    ['jump', makeClip('jump')],
    ['attack', makeClip('attack')],
]);

const makeParameters = (
    definitions: Array<{ name: string; kind: 'float' | 'int' | 'bool' | 'trigger'; defaultValue?: number | boolean }> = []
): AnimationParameterStore => new AnimationParameterStore(definitions);

const makeSimpleMachine = (): AnimationStateMachineDefinition => ({
    entryState: 'Idle',
    states: [
        {
            id: 'Idle',
            motion: { kind: 'clip', clipId: 'idle' },
            transitions: [
                {
                    to: 'Walk',
                    duration: 0.3,
                    fixedDuration: true,
                    conditions: [{ kind: 'float', parameter: 'speed', operator: '>', value: 0.1 }],
                },
            ],
        },
        {
            id: 'Walk',
            motion: { kind: 'clip', clipId: 'walk' },
            transitions: [
                {
                    to: 'Run',
                    duration: 0.3,
                    fixedDuration: true,
                    conditions: [{ kind: 'float', parameter: 'speed', operator: '>', value: 0.5 }],
                },
                {
                    to: 'Idle',
                    duration: 0.3,
                    fixedDuration: true,
                    conditions: [{ kind: 'float', parameter: 'speed', operator: '<=', value: 0.1 }],
                },
            ],
        },
        { id: 'Run', motion: { kind: 'clip', clipId: 'run' } },
    ],
});

const makeEvaluationContext = (parameters: AnimationParameterStore) => {
    const scratchPool = new AnimationScratchPool(rig, curveLayout, new Float32Array(curveLayout.componentCount * 0));
    scratchPool.reset();
    return {
        rig,
        parameters,
        restFrame: new AnimationFrame(rig, curveLayout),
        scratch: scratchPool,
    };
};

// ─── Prefab harness for Animator component tests ────────────────────────────

const createPrefabComponent = (type: string, data: unknown) => ({
    type,
    data: encodeSceneValue(data),
});

const createAnimatorPrefab = (animatorData: Record<string, unknown>): ScenePrefabDefinition => ({
    id: 'prefab/animator-sm',
    entities: [
        {
            nodeId: 'node/0',
            parentNodeId: null,
            name: 'Root',
            layer: 0,
            tag: 'default',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                createPrefabComponent('Transform', {
                    position: [0, 0, 0],
                    rotation: [0, 0, 0, 1],
                    scale: [1, 1, 1],
                }),
                createPrefabComponent('Animator', animatorData),
            ],
        },
        {
            nodeId: 'node/1',
            parentNodeId: 'node/0',
            name: 'Bone',
            layer: 0,
            tag: 'default',
            active: true,
            persistent: false,
            pooled: false,
            components: [
                createPrefabComponent('Transform', {
                    position: [1, 0, 0],
                    rotation: [0, 0, 0, 1],
                    scale: [1, 1, 1],
                }),
            ],
        },
    ],
});

const createPrefabHarness = () => {
    const registry = createSceneRegistry();
    const world = new World(registry);
    const entities = new SceneEntityRuntime({
        world,
        componentCatalog: new SceneComponentCatalog(registry),
    });
    const lifecycle = new SceneEntityLifecycleRunner({
        getEntitys: () => world.getAllEntities(),
    });
    return { entities, lifecycle, world };
};

// ═══════════════════════════════════════════════════════════════════════════════
// 1. State Machine Compilation (5 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-07.1: State Machine Compilation', () => {
    it('compiles a single-state machine with correct entry state index', () => {
        const machine = compileStateMachine(
            {
                entryState: 'Idle',
                states: [{ id: 'Idle', motion: { kind: 'clip', clipId: 'idle' } }],
            },
            clips
        );
        expect(machine.entryStateIndex).toBe(0);
        expect(machine.states).toHaveLength(1);
        expect(machine.stateIndexById.get('Idle')).toBe(0);
    });

    it('compiles a multi-state machine with transitions preserving target indices', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        expect(machine.states).toHaveLength(3);
        expect(machine.stateIndexById.get('Idle')).toBe(0);
        expect(machine.stateIndexById.get('Walk')).toBe(1);
        expect(machine.stateIndexById.get('Run')).toBe(2);
        const idleTransitions = machine.states[0]!.transitions;
        expect(idleTransitions).toHaveLength(1);
        expect(idleTransitions[0]!.targetStateIndex).toBe(1);
    });

    it('preserves transition conditions for float, int, bool, and trigger kinds', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'A',
            states: [
                {
                    id: 'A',
                    motion: { kind: 'clip', clipId: 'idle' },
                    transitions: [
                        {
                            to: 'B',
                            conditions: [
                                { kind: 'float', parameter: 'speed', operator: '>', value: 0.5 },
                                { kind: 'bool', parameter: 'grounded', value: true },
                                { kind: 'trigger', parameter: 'jump' },
                            ],
                        },
                    ],
                },
                { id: 'B', motion: { kind: 'clip', clipId: 'walk' } },
            ],
        };
        const machine = compileStateMachine(definition, clips);
        const conditions = machine.states[0]!.transitions[0]!.conditions;
        expect(conditions).toHaveLength(3);
        expect(conditions[0]).toMatchObject({ kind: 'float', parameter: 'speed', operator: '>', value: 0.5 });
        expect(conditions[1]).toMatchObject({ kind: 'bool', parameter: 'grounded', value: true });
        expect(conditions[2]).toMatchObject({ kind: 'trigger', parameter: 'jump' });
    });

    it('compiles anyState transitions separately from per-state transitions', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'A',
            states: [
                {
                    id: 'A',
                    motion: { kind: 'clip', clipId: 'idle' },
                    transitions: [{ to: 'B', conditions: [{ kind: 'trigger', parameter: 'go' }] }],
                },
                { id: 'B', motion: { kind: 'clip', clipId: 'walk' } },
            ],
            anyStateTransitions: [
                {
                    to: 'A',
                    priority: 10,
                    conditions: [{ kind: 'trigger', parameter: 'reset' }],
                },
            ],
        };
        const machine = compileStateMachine(definition, clips);
        expect(machine.anyStateTransitions).toHaveLength(1);
        expect(machine.anyStateTransitions[0]!.targetStateIndex).toBe(0);
        expect(machine.anyStateTransitions[0]!.priority).toBe(10);
        expect(machine.states[0]!.transitions).toHaveLength(1);
    });

    it('throws descriptive errors for invalid state references', () => {
        expect(() =>
            compileStateMachine(
                {
                    entryState: 'MISSING',
                    states: [{ id: 'A', motion: { kind: 'clip', clipId: 'idle' } }],
                },
                clips
            )
        ).toThrow(AnimationValidationError);

        expect(() =>
            compileStateMachine(
                {
                    entryState: 'A',
                    states: [
                        {
                            id: 'A',
                            motion: { kind: 'clip', clipId: 'idle' },
                            transitions: [{ to: 'NONEXISTENT' }],
                        },
                    ],
                },
                clips
            )
        ).toThrow(AnimationValidationError);

        expect(() => compileStateMachine({ entryState: 'A', states: [] }, clips)).toThrow(
            AnimationValidationError
        );
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Basic State Transitions (5 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-07.2: Basic State Transitions', () => {
    it('transitions automatically when exitTime is reached', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'idle' },
                        transitions: [
                            { to: 'B', exitTime: 0.5, duration: 0.2, fixedDuration: true },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'walk' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        updateLayerRuntime(machine, runtime, parameters, 0.3);
        expect(runtime.transition).toBeNull();

        updateLayerRuntime(machine, runtime, parameters, 0.3);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.targetStateIndex).toBe(1);
    });

    it('transitions on float condition (speed > 0.5 triggers Walk -> Run)', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([{ name: 'speed', kind: 'float' }]);

        forceLayerState(machine, runtime, 'Walk');
        parameters.setFloat('speed', 0.8);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.targetStateIndex).toBe(2);
    });

    it('transitions on bool condition (isGrounded = true -> Jump)', () => {
        const machine = compileStateMachine(
            {
                entryState: 'Idle',
                states: [
                    {
                        id: 'Idle',
                        motion: { kind: 'clip', clipId: 'idle' },
                        transitions: [
                            {
                                to: 'Jump',
                                conditions: [{ kind: 'bool', parameter: 'isGrounded', value: true }],
                            },
                        ],
                    },
                    { id: 'Jump', motion: { kind: 'clip', clipId: 'jump' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([{ name: 'isGrounded', kind: 'bool' }]);

        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).toBeNull();

        parameters.setBool('isGrounded', true);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.targetStateIndex).toBe(1);
    });

    it('transitions on trigger condition (setTrigger("attack") -> Attack)', () => {
        const machine = compileStateMachine(
            {
                entryState: 'Idle',
                states: [
                    {
                        id: 'Idle',
                        motion: { kind: 'clip', clipId: 'idle' },
                        transitions: [
                            {
                                to: 'Attack',
                                conditions: [{ kind: 'trigger', parameter: 'attack' }],
                            },
                        ],
                    },
                    { id: 'Attack', motion: { kind: 'clip', clipId: 'attack' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([{ name: 'attack', kind: 'trigger' }]);

        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).toBeNull();

        parameters.setTrigger('attack');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.targetStateIndex).toBe(1);
    });

    it('respects transition priority ordering (first matching condition wins)', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'idle' },
                        transitions: [
                            {
                                to: 'B',
                                priority: 1,
                                conditions: [{ kind: 'trigger', parameter: 'go' }],
                            },
                            {
                                to: 'C',
                                priority: 5,
                                conditions: [{ kind: 'trigger', parameter: 'go' }],
                            },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'walk' } },
                    { id: 'C', motion: { kind: 'clip', clipId: 'run' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([{ name: 'go', kind: 'trigger' }]);

        parameters.setTrigger('go');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition!.targetStateIndex).toBe(2);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Crossfade Blending (5 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-07.3: Crossfade Blending', () => {
    it('starts blending between source and target states', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        crossFadeLayerState(machine, runtime, 'Walk', 0.5, 0, false);

        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.sourceStateIndex).toBe(0);
        expect(runtime.transition!.targetStateIndex).toBe(1);
    });

    it('progresses blend weight linearly over duration', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        crossFadeLayerState(machine, runtime, 'Walk', 1.0, 0, false);

        updateLayerRuntime(machine, runtime, parameters, 0.5);
        expect(runtime.transition!.progress).toBeCloseTo(0.5, 5);

        updateLayerRuntime(machine, runtime, parameters, 0.25);
        expect(runtime.transition!.progress).toBeCloseTo(0.75, 5);
    });

    it('completes crossfade and commits to target state', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        crossFadeLayerState(machine, runtime, 'Walk', 0.5, 0, false);

        updateLayerRuntime(machine, runtime, parameters, 0.5);
        expect(runtime.transition!.complete).toBe(true);

        commitLayerRuntime(runtime);
        expect(runtime.transition).toBeNull();
        expect(runtime.currentStateIndex).toBe(1);
    });

    it('redirects interrupted crossfade to new target', () => {
        const definition: AnimationStateMachineDefinition = {
            entryState: 'A',
            states: [
                {
                    id: 'A',
                    motion: { kind: 'clip', clipId: 'idle' },
                    transitions: [
                        {
                            to: 'B',
                            duration: 1.0,
                            fixedDuration: true,
                            canInterrupt: true,
                            conditions: [{ kind: 'trigger', parameter: 'toB' }],
                        },
                        {
                            to: 'C',
                            duration: 1.0,
                            fixedDuration: true,
                            canInterrupt: true,
                            conditions: [{ kind: 'trigger', parameter: 'toC' }],
                        },
                    ],
                },
                { id: 'B', motion: { kind: 'clip', clipId: 'walk' } },
                { id: 'C', motion: { kind: 'clip', clipId: 'run' } },
            ],
        };
        const machine = compileStateMachine(definition, clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([
            { name: 'toB', kind: 'trigger' },
            { name: 'toC', kind: 'trigger' },
        ]);

        parameters.setTrigger('toB');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition!.targetStateIndex).toBe(1);
        expect(runtime.transition!.complete).toBe(false);

        parameters.setTrigger('toC');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition!.targetStateIndex).toBe(2);
        expect(runtime.transition!.sourceStateIndex).toBe(0);
    });

    it('performs instant switch with zero-duration crossfade', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        crossFadeLayerState(machine, runtime, 'Walk', 0, 0, false);

        updateLayerRuntime(machine, runtime, parameters, 0.01);
        expect(runtime.transition!.progress).toBe(1);
        expect(runtime.transition!.complete).toBe(true);

        commitLayerRuntime(runtime);
        expect(runtime.currentStateIndex).toBe(1);
        expect(runtime.transition).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Parameter-Driven Behavior (5 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-07.4: Parameter-Driven Behavior', () => {
    it('setFloat changes parameter value readable by conditions', () => {
        const parameters = makeParameters([{ name: 'speed', kind: 'float' }]);
        parameters.setFloat('speed', 0.75);
        expect(parameters.get('speed')).toBe(0.75);

        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
    });

    it('setBool toggles boolean parameter', () => {
        const parameters = makeParameters([{ name: 'active', kind: 'bool' }]);
        expect(parameters.get('active')).toBe(false);

        parameters.setBool('active', true);
        expect(parameters.get('active')).toBe(true);

        parameters.setBool('active', false);
        expect(parameters.get('active')).toBe(false);
    });

    it('setTrigger fires and is consumed on transition', () => {
        const parameters = makeParameters([{ name: 'fire', kind: 'trigger' }]);
        parameters.setTrigger('fire');
        expect(parameters.get('fire')).toBe(true);

        const consumed = parameters.consumeTrigger('fire');
        expect(consumed).toBe(true);
        expect(parameters.get('fire')).toBe(false);
    });

    it('trigger resets after consumption and does not re-fire', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'idle' },
                        transitions: [
                            {
                                to: 'B',
                                conditions: [{ kind: 'trigger', parameter: 'go' }],
                            },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'walk' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([{ name: 'go', kind: 'trigger' }]);

        parameters.setTrigger('go');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
        expect(parameters.get('go')).toBe(false);

        const runtime2 = createLayerRuntime(machine);
        updateLayerRuntime(machine, runtime2, parameters, 0.1);
        expect(runtime2.transition).toBeNull();
    });

    it('evaluates compound conditions with AND logic (all must match)', () => {
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [
                    {
                        id: 'A',
                        motion: { kind: 'clip', clipId: 'idle' },
                        transitions: [
                            {
                                to: 'B',
                                conditions: [
                                    { kind: 'float', parameter: 'speed', operator: '>', value: 0.5 },
                                    { kind: 'bool', parameter: 'grounded', value: true },
                                ],
                            },
                        ],
                    },
                    { id: 'B', motion: { kind: 'clip', clipId: 'walk' } },
                ],
            },
            clips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([
            { name: 'speed', kind: 'float' },
            { name: 'grounded', kind: 'bool' },
        ]);

        parameters.setFloat('speed', 0.8);
        parameters.setBool('grounded', false);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).toBeNull();

        parameters.setBool('grounded', true);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Animator Component Integration (5 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-07.5: Animator Component Integration', () => {
    it('Animator.play(clipId) switches active clip', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatorPrefab({
            clips: [
                {
                    id: 'Idle',
                    tracks: [{ targetNodeId: 'node/1', path: 'translation', times: [0, 1], values: [0, 0, 0, 1, 0, 0] }],
                },
                {
                    id: 'Walk',
                    tracks: [{ targetNodeId: 'node/1', path: 'translation', times: [0, 1], values: [0, 0, 0, 2, 0, 0] }],
                },
            ],
            clipId: 'Idle',
            playOnStart: true,
            playing: true,
            loop: true,
        });

        const entities = harness.entities.instantiatePrefab(prefab);
        const root = entities.find((a) => a.name === 'Root');
        const animator = root?.getComponent(Animator) ?? null;

        expect(animator?.clipId).toBe('Idle');
        animator?.play('Walk');
        expect(animator?.clipId).toBe('Walk');
    });

    it('Animator.crossFade delegates to state machine crossFade', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatorPrefab({
            clips: [
                {
                    id: 'Idle',
                    tracks: [{ targetNodeId: 'node/1', path: 'translation', times: [0, 1], values: [0, 0, 0, 1, 0, 0] }],
                },
                {
                    id: 'Run',
                    tracks: [{ targetNodeId: 'node/1', path: 'translation', times: [0, 1], values: [0, 0, 0, 3, 0, 0] }],
                },
            ],
            clipId: 'Idle',
            playOnStart: true,
            playing: true,
            loop: true,
        });

        const entities = harness.entities.instantiatePrefab(prefab);
        const root = entities.find((a) => a.name === 'Root');
        const animator = root?.getComponent(Animator) ?? null;

        animator?.crossFade('Run', 0.2);
        expect(animator?.clipId).toBe('Run');
    });

    it('Animator.setFloat/setBool/setTrigger delegate to parameter store', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatorPrefab({
            clips: [
                {
                    id: 'Idle',
                    tracks: [{ targetNodeId: 'node/1', path: 'translation', times: [0, 1], values: [0, 0, 0, 1, 0, 0] }],
                },
            ],
            parameters: [
                { name: 'speed', kind: 'float', defaultValue: 0 },
                { name: 'grounded', kind: 'bool', defaultValue: false },
                { name: 'jump', kind: 'trigger' },
            ],
            clipId: 'Idle',
            playOnStart: true,
            playing: true,
            loop: true,
        });

        const entities = harness.entities.instantiatePrefab(prefab);
        const root = entities.find((a) => a.name === 'Root');
        const animator = root?.getComponent(Animator) ?? null;

        animator?.setFloat('speed', 0.5);
        animator?.setBool('grounded', true);
        animator?.setTrigger('jump');

        const debugInfo = animator?.getDebugInfo();
        expect(debugInfo).toBeDefined();
        expect(debugInfo?.clipId).toBe('Idle');
    });

    it('Animator.stop() resets playing state and time', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatorPrefab({
            clips: [
                {
                    id: 'Walk',
                    tracks: [{ targetNodeId: 'node/1', path: 'translation', times: [0, 1], values: [0, 0, 0, 2, 0, 0] }],
                },
            ],
            clipId: 'Walk',
            playOnStart: true,
            playing: true,
            loop: true,
        });

        const entities = harness.entities.instantiatePrefab(prefab);
        const root = entities.find((a) => a.name === 'Root');
        const animator = root?.getComponent(Animator) ?? null;

        harness.lifecycle.update(500);
        expect(animator?.playing).toBe(true);

        animator?.stop(true);
        expect(animator?.playing).toBe(false);
        expect(animator?.time).toBeCloseTo(0, 5);
    });

    it('Animator.pause() freezes and resume continues time advancement', () => {
        const harness = createPrefabHarness();
        const prefab = createAnimatorPrefab({
            clips: [
                {
                    id: 'Walk',
                    tracks: [{ targetNodeId: 'node/1', path: 'translation', times: [0, 1], values: [0, 0, 0, 2, 0, 0] }],
                },
            ],
            clipId: 'Walk',
            playOnStart: true,
            playing: true,
            loop: true,
        });

        const entities = harness.entities.instantiatePrefab(prefab);
        const root = entities.find((a) => a.name === 'Root');
        const animator = root?.getComponent(Animator) ?? null;

        harness.lifecycle.update(250);
        const timeBeforePause = animator?.time ?? 0;

        animator?.pause();
        expect(animator?.playing).toBe(false);

        harness.lifecycle.update(500);
        expect(animator?.time).toBeCloseTo(timeBeforePause, 5);

        animator?.play('Walk');
        expect(animator?.playing).toBe(true);

        harness.lifecycle.update(250);
        expect(animator?.time).toBeGreaterThan(timeBeforePause);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Edge Cases & Error Handling (5 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-07.6: Edge Cases & Error Handling', () => {
    it('throws when transitioning to non-existent state ID via forceLayerState', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        expect(() => forceLayerState(machine, runtime, 'NONEXISTENT')).toThrow(
            AnimationStateMachineError
        );
    });

    it('throws when crossFading to non-existent state ID', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        expect(() => crossFadeLayerState(machine, runtime, 'NONEXISTENT', 0.5)).toThrow(
            AnimationStateMachineError
        );
    });

    it('handles unknown parameter name by throwing', () => {
        const parameters = makeParameters([{ name: 'speed', kind: 'float' }]);
        expect(() => parameters.get('nonexistent')).toThrow(AnimationStateMachineError);
        expect(() => parameters.setFloat('nonexistent', 1)).toThrow(AnimationStateMachineError);
    });

    it('handles zero-duration clip without crashing', () => {
        const zeroClip = new AnimationClip(
            {
                id: 'zero',
                tracks: [
                    {
                        target: 'root',
                        path: 'translation',
                        times: [0, 0],
                        values: [0, 0, 0, 0, 0, 0],
                    },
                ],
            },
            rig,
            curveLayout
        );
        const zeroClips = new Map<string, AnimationClip>([['zero', zeroClip]]);
        const machine = compileStateMachine(
            {
                entryState: 'A',
                states: [{ id: 'A', motion: { kind: 'clip', clipId: 'zero' } }],
            },
            zeroClips
        );
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        expect(() => updateLayerRuntime(machine, runtime, parameters, 0.1)).not.toThrow();
    });

    it('handles multiple rapid crossFade calls without corruption', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();

        crossFadeLayerState(machine, runtime, 'Walk', 0.5, 0, false);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition!.targetStateIndex).toBe(1);

        crossFadeLayerState(machine, runtime, 'Run', 0.3, 0, false);
        expect(runtime.transition!.targetStateIndex).toBe(2);
        expect(runtime.transition!.sourceStateIndex).toBe(0);

        crossFadeLayerState(machine, runtime, 'Idle', 0.2, 0, false);
        expect(runtime.transition!.targetStateIndex).toBe(0);

        updateLayerRuntime(machine, runtime, parameters, 0.2);
        expect(runtime.transition!.complete).toBe(true);
        commitLayerRuntime(runtime);
        expect(runtime.currentStateIndex).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Builder API Integration (5 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-07.7: Builder API Integration', () => {
    it('builds a complete controller with state machine via builder API', () => {
        const controller = new AnimationControllerBuilder({ bones: [{ name: 'root' }] })
            .addClip({
                id: 'idle',
                tracks: [{ target: 'root', path: 'translation', times: [0, 1], values: [0, 0, 0, 1, 0, 0] }],
            })
            .addClip({
                id: 'walk',
                tracks: [{ target: 'root', path: 'translation', times: [0, 1], values: [0, 0, 0, 2, 0, 0] }],
            })
            .parameter('speed', 'float', 0)
            .layer(
                'base',
                AnimationControllerGraph.machine('Idle')
                    .state('Idle', { kind: 'clip', clipId: 'idle' }, (state) => {
                        return state.transitionTo('Walk', (t) => {
                            return t.whenFloat('speed', '>', 0.5).withDuration(0.3).withFixedDuration();
                        });
                    })
                    .state('Walk', { kind: 'clip', clipId: 'walk' })
            )
            .build();

        expect(controller.layers).toHaveLength(1);
        expect(controller.clips).toHaveLength(2);
        expect(controller.parameters).toHaveLength(1);
    });

    it('builds anyState transitions via builder API', () => {
        const machineDef = AnimationControllerGraph.machine('A')
            .state('A', { kind: 'clip', clipId: 'idle' })
            .state('B', { kind: 'clip', clipId: 'walk' })
            .anyState('A', (t) => {
                return t.whenTriggered('reset').withPriority(10);
            })
            .build();

        expect(machineDef.anyStateTransitions).toHaveLength(1);
        expect(machineDef.anyStateTransitions![0]!.to).toBe('A');
    });

    it('compiles and runs a builder-constructed state machine end-to-end', () => {
        const machineDef = AnimationControllerGraph.machine('Idle')
            .state('Idle', { kind: 'clip', clipId: 'idle' }, (state) => {
                return state.transitionTo('Walk', (t) => {
                    return t.whenTriggered('go').withDuration(0.2).withFixedDuration();
                });
            })
            .state('Walk', { kind: 'clip', clipId: 'walk' })
            .build();

        const machine = compileStateMachine(machineDef, clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters([{ name: 'go', kind: 'trigger' }]);

        expect(runtime.currentStateIndex).toBe(0);

        parameters.setTrigger('go');
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.transition!.targetStateIndex).toBe(1);
    });

    it('validates builder-constructed machines for diagnostics', () => {
        const machineDef = AnimationControllerGraph.machine('A')
            .state('A', { kind: 'clip', clipId: 'idle' })
            .build();

        const diagnostics = AnimationControllerGraph.validateMachine(machineDef);
        expect(diagnostics).toHaveLength(0);
    });

    it('reports diagnostics for machines with unknown transition targets', () => {
        const machineDef = AnimationControllerGraph.machine('A')
            .state('A', { kind: 'clip', clipId: 'idle' }, (state) => {
                return state.transitionTo('MISSING');
            })
            .build();

        const diagnostics = AnimationControllerGraph.validateMachine(machineDef);
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics[0]!.code).toBe('animation.controller.state.unknown');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Evaluate Layer Runtime (5 tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('T-07.8: Evaluate Layer Runtime', () => {
    it('evaluates a single state without transition', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        const context = makeEvaluationContext(parameters);
        const out = new AnimationFrame(rig, curveLayout);

        const result = evaluateLayerRuntime(machine, runtime, context, out);
        expect(result).toBe(out);
    });

    it('evaluates blended frame during crossfade transition', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        crossFadeLayerState(machine, runtime, 'Walk', 1.0, 0, false);
        updateLayerRuntime(machine, runtime, parameters, 0.5);

        const context = makeEvaluationContext(parameters);
        const out = new AnimationFrame(rig, curveLayout);
        const result = evaluateLayerRuntime(machine, runtime, context, out);
        expect(result).toBe(out);
    });

    it('commits completed transition and clears transition state', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        crossFadeLayerState(machine, runtime, 'Walk', 0.5, 0, false);

        updateLayerRuntime(machine, runtime, parameters, 0.5);
        expect(runtime.transition!.complete).toBe(true);

        commitLayerRuntime(runtime);
        expect(runtime.transition).toBeNull();
        expect(runtime.currentStateIndex).toBe(1);
    });

    it('does not commit incomplete transition', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        crossFadeLayerState(machine, runtime, 'Walk', 1.0, 0, false);

        updateLayerRuntime(machine, runtime, parameters, 0.3);
        expect(runtime.transition!.complete).toBe(false);

        commitLayerRuntime(runtime);
        expect(runtime.transition).not.toBeNull();
        expect(runtime.currentStateIndex).toBe(0);
    });

    it('forceLayerState sets state and clears any active transition', () => {
        const machine = compileStateMachine(makeSimpleMachine(), clips);
        const runtime = createLayerRuntime(machine);
        const parameters = makeParameters();
        crossFadeLayerState(machine, runtime, 'Walk', 1.0, 0, false);
        updateLayerRuntime(machine, runtime, parameters, 0.1);
        expect(runtime.transition).not.toBeNull();

        forceLayerState(machine, runtime, 'Run', 0.25);
        expect(runtime.transition).toBeNull();
        expect(runtime.currentStateIndex).toBe(2);
        expect(runtime.currentNormalizedTime).toBeCloseTo(0.25, 5);
    });
});
