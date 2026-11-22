import { Builder } from '@axrone/utility';
import {
    buildAnimationMotionDefinition,
    type AnimationMotionBuilder,
} from './blend-graph';
import {
    cloneBehaviourAction,
    cloneClipDefinition,
    cloneCondition,
    cloneParameterDefinition,
    cloneRigDefinition,
    cloneRootMotionDefinition,
    cloneStateBehaviour,
} from './controller-clone';
import { spreadIfFinite } from './internal';
import type {
    AnimationConditionDefinition,
    AnimationConditionMatch,
    AnimationControllerDefinition,
    AnimationIkJobDefinition,
    AnimationIkLayerDefinition,
    AnimationInterruptHandoff,
    AnimationInterruptMode,
    AnimationLayerBlendMode,
    AnimationLayerDefinition,
    AnimationLayerSyncMode,
    AnimationMotionDefinition,
    AnimationParameterDefinition,
    AnimationParameterKind,
    AnimationParameterValue,
    AnimationRigDefinition,
    AnimationRootMotionDefinition,
    AnimationStateBehaviourActionDefinition,
    AnimationStateBehaviourDefinition,
    AnimationStateBehaviourPhase,
    AnimationStateDefinition,
    AnimationStateMachineDefinition,
    AnimationTransitionDefinition,
    AnimationTransitionEasing,
    AnimationTransitionOperator,
} from './types';

export type AnimationMotionInput = AnimationMotionDefinition | AnimationMotionBuilder;
export type AnimationTransitionInput = AnimationTransitionDefinition | AnimationTransitionBuilder;
export type AnimationStateInput = AnimationStateDefinition | AnimationStateBuilder;
export type AnimationStateMachineInput = AnimationStateMachineDefinition | AnimationStateMachineBuilder;
export type AnimationIkLayerInput = AnimationIkLayerDefinition | AnimationIkLayerBuilder;
export type AnimationLayerInput = AnimationLayerDefinition | AnimationLayerBuilder;
export type AnimationControllerInput =
    | AnimationControllerDefinition<readonly AnimationParameterDefinition[]>
    | AnimationControllerBuilder;

// ─── AnimationTransitionBuilder ──────────────────────────────────────────────

export class AnimationTransitionBuilder<
    TSupplied extends keyof AnimationTransitionDefinition = 'to',
> extends Builder<AnimationTransitionDefinition, TSupplied> {
    constructor(to: string) {
        super({ to, conditions: Object.freeze([]) as readonly AnimationConditionDefinition[] });
    }

    withDuration(duration: number): AnimationTransitionBuilder<'to' | 'duration'> {
        return this.set('duration', duration) as unknown as AnimationTransitionBuilder<'to' | 'duration'>;
    }

    withOffset(offset: number): AnimationTransitionBuilder<'to' | 'offset'> {
        return this.set('offset', offset) as unknown as AnimationTransitionBuilder<'to' | 'offset'>;
    }

    withExitTime(exitTime: number): AnimationTransitionBuilder<'to' | 'exitTime'> {
        return this.set('exitTime', exitTime) as unknown as AnimationTransitionBuilder<'to' | 'exitTime'>;
    }

    withFixedDuration(fixedDuration = true): AnimationTransitionBuilder<'to' | 'fixedDuration'> {
        return this.set('fixedDuration', fixedDuration) as unknown as AnimationTransitionBuilder<'to' | 'fixedDuration'>;
    }

    withInterruptible(canInterrupt = true): AnimationTransitionBuilder<'to' | 'canInterrupt'> {
        return this.set('canInterrupt', canInterrupt) as unknown as AnimationTransitionBuilder<'to' | 'canInterrupt'>;
    }

    withEasing(easing: AnimationTransitionEasing): AnimationTransitionBuilder<'to' | 'easing'> {
        return this.set('easing', easing) as unknown as AnimationTransitionBuilder<'to' | 'easing'>;
    }

    withInterruptMode(interruptMode: AnimationInterruptMode): AnimationTransitionBuilder<'to' | 'interruptMode'> {
        return this.set('interruptMode', interruptMode) as unknown as AnimationTransitionBuilder<'to' | 'interruptMode'>;
    }

    withInterruptHandoff(interruptHandoff: AnimationInterruptHandoff): AnimationTransitionBuilder<'to' | 'interruptHandoff'> {
        return this.set('interruptHandoff', interruptHandoff) as unknown as AnimationTransitionBuilder<'to' | 'interruptHandoff'>;
    }

    withConditionMatch(conditionMatch: AnimationConditionMatch): AnimationTransitionBuilder<'to' | 'conditionMatch'> {
        return this.set('conditionMatch', conditionMatch) as unknown as AnimationTransitionBuilder<'to' | 'conditionMatch'>;
    }

    withPriority(priority: number): AnimationTransitionBuilder<'to' | 'priority'> {
        return this.set('priority', priority) as unknown as AnimationTransitionBuilder<'to' | 'priority'>;
    }

    addCondition(condition: AnimationConditionDefinition): AnimationTransitionBuilder<'to' | 'conditions'> {
        return this._append('conditions', cloneCondition(condition)) as unknown as AnimationTransitionBuilder<'to' | 'conditions'>;
    }

    whenFloat(parameter: string, operator: AnimationTransitionOperator, value: number): AnimationTransitionBuilder<'to' | 'conditions'> {
        return this.addCondition({ kind: 'float', parameter, operator, value });
    }

    whenInt(parameter: string, operator: AnimationTransitionOperator, value: number): AnimationTransitionBuilder<'to' | 'conditions'> {
        return this.addCondition({ kind: 'int', parameter, operator, value });
    }

    whenBool(parameter: string, value: boolean): AnimationTransitionBuilder<'to' | 'conditions'> {
        return this.addCondition({ kind: 'bool', parameter, value });
    }

    whenTriggered(parameter: string): AnimationTransitionBuilder<'to' | 'conditions'> {
        return this.addCondition({ kind: 'trigger', parameter });
    }
}

// ─── AnimationStateBehaviourBuilder ──────────────────────────────────────────

export class AnimationStateBehaviourBuilder<
    TSupplied extends keyof AnimationStateBehaviourDefinition = 'phase' | 'actions',
> extends Builder<AnimationStateBehaviourDefinition, TSupplied> {
    constructor(phase: AnimationStateBehaviourPhase, actions: readonly AnimationStateBehaviourActionDefinition[]) {
        super({
            phase,
            actions: Object.freeze(actions.map(cloneBehaviourAction)),
            conditions: Object.freeze([]) as readonly AnimationConditionDefinition[],
        });
    }

    withId(id: string): AnimationStateBehaviourBuilder<'phase' | 'actions' | 'id'> {
        return this.set('id', id) as unknown as AnimationStateBehaviourBuilder<'phase' | 'actions' | 'id'>;
    }

    withConditionMatch(
        conditionMatch: AnimationConditionMatch
    ): AnimationStateBehaviourBuilder<'phase' | 'actions' | 'conditionMatch'> {
        return this.set(
            'conditionMatch',
            conditionMatch
        ) as unknown as AnimationStateBehaviourBuilder<'phase' | 'actions' | 'conditionMatch'>;
    }

    /** `phase: 'update'` only: fire at most once every `intervalSeconds`. */
    withInterval(
        intervalSeconds: number
    ): AnimationStateBehaviourBuilder<'phase' | 'actions' | 'intervalSeconds'> {
        return this.set(
            'intervalSeconds',
            intervalSeconds
        ) as unknown as AnimationStateBehaviourBuilder<'phase' | 'actions' | 'intervalSeconds'>;
    }

    addAction(
        action: AnimationStateBehaviourActionDefinition
    ): AnimationStateBehaviourBuilder<'phase' | 'actions'> {
        return this._append('actions', cloneBehaviourAction(action)) as unknown as AnimationStateBehaviourBuilder<
            'phase' | 'actions'
        >;
    }

    addCondition(condition: AnimationConditionDefinition): AnimationStateBehaviourBuilder<'phase' | 'actions' | 'conditions'> {
        return this._append('conditions', cloneCondition(condition)) as unknown as AnimationStateBehaviourBuilder<
            'phase' | 'actions' | 'conditions'
        >;
    }
}

// ─── AnimationStateBuilder ───────────────────────────────────────────────────

export class AnimationStateBuilder<
    TSupplied extends keyof AnimationStateDefinition = 'id' | 'motion',
> extends Builder<AnimationStateDefinition, TSupplied> {
    constructor(id: string, motion?: AnimationMotionInput) {
        super({
            id,
            ...(motion ? { motion: buildAnimationMotionDefinition(motion) } : {}),
            transitions: Object.freeze([]) as readonly AnimationTransitionDefinition[],
        });
    }

    withMotion(motion: AnimationMotionInput): AnimationStateBuilder<'id' | 'motion'> {
        return this.set('motion', buildAnimationMotionDefinition(motion)) as unknown as AnimationStateBuilder<'id' | 'motion'>;
    }

    /** Turns this state into a group: the child machine supplies the playable states. */
    withChildMachine(stateMachine: AnimationStateMachineInput): AnimationStateBuilder<'id' | 'childMachine'> {
        return this.set(
            'childMachine',
            buildAnimationStateMachineDefinition(stateMachine)
        ) as unknown as AnimationStateBuilder<'id' | 'childMachine'>;
    }

    addBehaviour(behaviour: AnimationStateBehaviourDefinition): AnimationStateBuilder<'id' | 'behaviours'> {
        return this._append(
            'behaviours',
            cloneStateBehaviour(behaviour)
        ) as unknown as AnimationStateBuilder<'id' | 'behaviours'>;
    }

    onEnter(
        actions: readonly AnimationStateBehaviourActionDefinition[],
        configure?: (behaviour: AnimationStateBehaviourBuilder) => AnimationStateBehaviourBuilder
    ): AnimationStateBuilder<'id' | 'behaviours'> {
        return this._addPhaseBehaviour('enter', actions, configure);
    }

    onUpdate(
        actions: readonly AnimationStateBehaviourActionDefinition[],
        configure?: (behaviour: AnimationStateBehaviourBuilder) => AnimationStateBehaviourBuilder
    ): AnimationStateBuilder<'id' | 'behaviours'> {
        return this._addPhaseBehaviour('update', actions, configure);
    }

    onExit(
        actions: readonly AnimationStateBehaviourActionDefinition[],
        configure?: (behaviour: AnimationStateBehaviourBuilder) => AnimationStateBehaviourBuilder
    ): AnimationStateBuilder<'id' | 'behaviours'> {
        return this._addPhaseBehaviour('exit', actions, configure);
    }

    private _addPhaseBehaviour(
        phase: AnimationStateBehaviourPhase,
        actions: readonly AnimationStateBehaviourActionDefinition[],
        configure?: (behaviour: AnimationStateBehaviourBuilder) => AnimationStateBehaviourBuilder
    ): AnimationStateBuilder<'id' | 'behaviours'> {
        let behaviour = new AnimationStateBehaviourBuilder(phase, actions);
        if (configure) {
            behaviour = configure(behaviour) as AnimationStateBehaviourBuilder;
        }
        return this.addBehaviour(behaviour.buildUnsafe() as AnimationStateBehaviourDefinition);
    }

    withSpeed(speed: number): AnimationStateBuilder<'id' | 'motion' | 'speed'> {
        return this.set('speed', speed) as unknown as AnimationStateBuilder<'id' | 'motion' | 'speed'>;
    }

    withLoop(loop: boolean): AnimationStateBuilder<'id' | 'motion' | 'loop'> {
        return this.set('loop', loop) as unknown as AnimationStateBuilder<'id' | 'motion' | 'loop'>;
    }

    addTransition(transition: AnimationTransitionInput): AnimationStateBuilder<'id' | 'motion' | 'transitions'> {
        return this._append('transitions', buildAnimationTransitionDefinition(transition)) as unknown as AnimationStateBuilder<'id' | 'motion' | 'transitions'>;
    }

    transitionTo(
        to: string,
        configure?: (transition: AnimationTransitionBuilder) => AnimationTransitionBuilder
    ): AnimationStateBuilder<'id' | 'motion' | 'transitions'> {
        let transition = new AnimationTransitionBuilder(to);
        if (configure) {
            const configured = configure(transition);
            // `configure` may return a new immutable instance
            transition = configured as AnimationTransitionBuilder;
        }
        return this.addTransition(transition);
    }
}

// ─── AnimationStateMachineBuilder ────────────────────────────────────────────

export class AnimationStateMachineBuilder<
    TSupplied extends keyof AnimationStateMachineDefinition = 'entryState' | 'states',
> extends Builder<AnimationStateMachineDefinition, TSupplied> {
    constructor(entryState?: string) {
        super({
            entryState: entryState ?? '',
            states: Object.freeze([]) as readonly AnimationStateDefinition[],
            anyStateTransitions: Object.freeze([]) as readonly AnimationTransitionDefinition[],
        });
    }

    withEntryState(entryState: string): AnimationStateMachineBuilder<'entryState' | 'states'> {
        return this.set('entryState', entryState) as unknown as AnimationStateMachineBuilder<'entryState' | 'states'>;
    }

    addState(state: AnimationStateInput): AnimationStateMachineBuilder<'entryState' | 'states'> {
        const built = buildAnimationStateDefinition(state);
        const next = this._append('states', built) as unknown as AnimationStateMachineBuilder<'entryState' | 'states'>;
        if (!next.peek().entryState) {
            return next.set('entryState', built.id) as AnimationStateMachineBuilder<'entryState' | 'states'>;
        }
        return next;
    }

    state(
        id: string,
        motion?: AnimationMotionInput,
        configure?: (state: AnimationStateBuilder) => AnimationStateBuilder
    ): AnimationStateMachineBuilder<'entryState' | 'states'> {
        let stateBuilder = new AnimationStateBuilder(id, motion);
        if (configure) {
            const configured = configure(stateBuilder);
            stateBuilder = configured as AnimationStateBuilder;
        }
        return this.addState(stateBuilder);
    }

    /**
     * Adds a group state: a state that owns `childMachine` instead of a motion.
     * Transitions authored on the group fire from any state inside the child.
     */
    group(
        id: string,
        childMachine: AnimationStateMachineInput,
        configure?: (state: AnimationStateBuilder) => AnimationStateBuilder
    ): AnimationStateMachineBuilder<'entryState' | 'states'> {
        let stateBuilder = new AnimationStateBuilder(id).withChildMachine(childMachine);
        if (configure) {
            stateBuilder = configure(stateBuilder) as AnimationStateBuilder;
        }
        return this.addState(stateBuilder);
    }

    addAnyStateTransition(transition: AnimationTransitionInput): AnimationStateMachineBuilder<'entryState' | 'states' | 'anyStateTransitions'> {
        return this._append('anyStateTransitions', buildAnimationTransitionDefinition(transition)) as unknown as AnimationStateMachineBuilder<'entryState' | 'states' | 'anyStateTransitions'>;
    }

    anyState(
        to: string,
        configure?: (transition: AnimationTransitionBuilder) => AnimationTransitionBuilder
    ): AnimationStateMachineBuilder<'entryState' | 'states' | 'anyStateTransitions'> {
        let transition = new AnimationTransitionBuilder(to);
        if (configure) {
            const configured = configure(transition);
            transition = configured as AnimationTransitionBuilder;
        }
        return this.addAnyStateTransition(transition);
    }
}

// ─── AnimationIkLayerBuilder ─────────────────────────────────────────────────

export class AnimationIkLayerBuilder<
    TSupplied extends keyof AnimationIkLayerDefinition = 'id' | 'jobs',
> extends Builder<AnimationIkLayerDefinition, TSupplied> {
    constructor(id: string) {
        super({ id, jobs: Object.freeze([]) as readonly AnimationIkJobDefinition[] });
    }

    withWeight(weight: number): AnimationIkLayerBuilder<'id' | 'jobs' | 'weight'> {
        return this.set('weight', weight) as unknown as AnimationIkLayerBuilder<'id' | 'jobs' | 'weight'>;
    }

    addJob(job: AnimationIkJobDefinition): AnimationIkLayerBuilder<'id' | 'jobs'> {
        return this._append('jobs', Object.freeze({ ...job })) as unknown as AnimationIkLayerBuilder<'id' | 'jobs'>;
    }
}

// ─── AnimationLayerBuilder ───────────────────────────────────────────────────

export class AnimationLayerBuilder<
    TSupplied extends keyof AnimationLayerDefinition = 'id' | 'stateMachine',
> extends Builder<AnimationLayerDefinition, TSupplied> {
    constructor(id: string, stateMachine: AnimationStateMachineInput) {
        super({
            id,
            stateMachine: buildAnimationStateMachineDefinition(stateMachine),
        });
    }

    withWeight(weight: number): AnimationLayerBuilder<'id' | 'stateMachine' | 'weight'> {
        return this.set('weight', weight) as unknown as AnimationLayerBuilder<'id' | 'stateMachine' | 'weight'>;
    }

    withMode(mode: AnimationLayerBlendMode): AnimationLayerBuilder<'id' | 'stateMachine' | 'mode'> {
        return this.set('mode', mode) as unknown as AnimationLayerBuilder<'id' | 'stateMachine' | 'mode'>;
    }

    withBoneMask(bones: readonly string[]): AnimationLayerBuilder<'id' | 'stateMachine' | 'boneMask'> {
        return this.set('boneMask', Object.freeze([...bones])) as unknown as AnimationLayerBuilder<'id' | 'stateMachine' | 'boneMask'>;
    }

    /**
     * Makes this layer follow another one. `mode` selects what is borrowed:
     * state and clock (default), just the state identity, or just the clock.
     */
    withSyncSource(
        layerId: string,
        mode: AnimationLayerSyncMode = 'stateAndTime',
        timeOffset = 0
    ): AnimationLayerBuilder<'id' | 'stateMachine' | 'syncSourceLayerId'> {
        return this.set('syncSourceLayerId', layerId)
            .set('syncMode', mode)
            .set('syncTimeOffset', timeOffset) as unknown as AnimationLayerBuilder<
            'id' | 'stateMachine' | 'syncSourceLayerId'
        >;
    }

    withSyncMode(mode: AnimationLayerSyncMode): AnimationLayerBuilder<'id' | 'stateMachine' | 'syncMode'> {
        return this.set('syncMode', mode) as unknown as AnimationLayerBuilder<'id' | 'stateMachine' | 'syncMode'>;
    }

    withSyncTimeOffset(
        timeOffset: number
    ): AnimationLayerBuilder<'id' | 'stateMachine' | 'syncTimeOffset'> {
        return this.set(
            'syncTimeOffset',
            timeOffset
        ) as unknown as AnimationLayerBuilder<'id' | 'stateMachine' | 'syncTimeOffset'>;
    }

    withStateMachine(stateMachine: AnimationStateMachineInput): AnimationLayerBuilder<'id' | 'stateMachine'> {
        return this.set('stateMachine', buildAnimationStateMachineDefinition(stateMachine)) as unknown as AnimationLayerBuilder<'id' | 'stateMachine'>;
    }

    addIkLayer(layer: AnimationIkLayerInput): AnimationLayerBuilder<'id' | 'stateMachine' | 'ikLayers'> {
        return this._append('ikLayers', buildAnimationIkLayerDefinition(layer)) as unknown as AnimationLayerBuilder<'id' | 'stateMachine' | 'ikLayers'>;
    }
}

// ─── AnimationControllerBuilder ──────────────────────────────────────────────

type ControllerClips = AnimationControllerDefinition<readonly AnimationParameterDefinition[]>['clips'];

export class AnimationControllerBuilder<
    TSupplied extends keyof AnimationControllerDefinition<readonly AnimationParameterDefinition[]> = 'rig' | 'clips' | 'layers',
> extends Builder<AnimationControllerDefinition<readonly AnimationParameterDefinition[]>, TSupplied> {
    constructor(rig: AnimationRigDefinition) {
        super({
            rig: cloneRigDefinition(rig),
            clips: Object.freeze([]) as unknown as ControllerClips,
            layers: Object.freeze([]) as readonly AnimationLayerDefinition[],
        });
    }

    addClip(clip: ControllerClips[number]): AnimationControllerBuilder<'rig' | 'clips' | 'layers' | 'clips'> {
        return this._append('clips', clip) as unknown as AnimationControllerBuilder<'rig' | 'clips' | 'layers' | 'clips'>;
    }

    addParameter(parameter: AnimationParameterDefinition): AnimationControllerBuilder<'rig' | 'clips' | 'layers' | 'parameters'> {
        return this._append('parameters', cloneParameterDefinition(parameter)) as unknown as AnimationControllerBuilder<'rig' | 'clips' | 'layers' | 'parameters'>;
    }

    parameter<TKind extends AnimationParameterKind>(
        name: string,
        kind: TKind,
        defaultValue?: AnimationParameterValue<TKind>
    ): AnimationControllerBuilder<'rig' | 'clips' | 'layers' | 'parameters'> {
        return this.addParameter({
            name,
            kind,
            ...(defaultValue !== undefined ? { defaultValue } : {}),
        });
    }

    addLayer(layer: AnimationLayerInput): AnimationControllerBuilder<'rig' | 'clips' | 'layers'> {
        return this._append('layers', buildAnimationLayerDefinition(layer)) as unknown as AnimationControllerBuilder<'rig' | 'clips' | 'layers'>;
    }

    layer(
        id: string,
        stateMachine: AnimationStateMachineInput,
        configure?: (layer: AnimationLayerBuilder) => AnimationLayerBuilder
    ): AnimationControllerBuilder<'rig' | 'clips' | 'layers'> {
        let layerBuilder = new AnimationLayerBuilder(id, stateMachine);
        if (configure) {
            const configured = configure(layerBuilder);
            layerBuilder = configured as AnimationLayerBuilder;
        }
        return this.addLayer(layerBuilder);
    }

    withRootMotion(rootMotion: AnimationRootMotionDefinition | null): AnimationControllerBuilder<'rig' | 'clips' | 'layers' | 'rootMotion'> {
        const cloned = rootMotion ? cloneRootMotionDefinition(rootMotion) : null;
        return this.set('rootMotion', cloned) as unknown as AnimationControllerBuilder<'rig' | 'clips' | 'layers' | 'rootMotion'>;
    }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

export const createAnimationTransition = (to: string): AnimationTransitionBuilder =>
    new AnimationTransitionBuilder(to);

export const createAnimationState = (
    id: string,
    motion?: AnimationMotionInput
): AnimationStateBuilder => new AnimationStateBuilder(id, motion);

export const createAnimationGroupState = (
    id: string,
    childMachine: AnimationStateMachineInput
): AnimationStateBuilder => new AnimationStateBuilder(id).withChildMachine(childMachine);

export const createAnimationStateBehaviour = (
    phase: AnimationStateBehaviourPhase,
    actions: readonly AnimationStateBehaviourActionDefinition[]
): AnimationStateBehaviourBuilder => new AnimationStateBehaviourBuilder(phase, actions);

export const createAnimationStateMachine = (
    entryState?: string
): AnimationStateMachineBuilder => new AnimationStateMachineBuilder(entryState);

export const createAnimationIkLayer = (id: string): AnimationIkLayerBuilder =>
    new AnimationIkLayerBuilder(id);

export const createAnimationLayer = (
    id: string,
    stateMachine: AnimationStateMachineInput
): AnimationLayerBuilder => new AnimationLayerBuilder(id, stateMachine);

export const createAnimationController = (
    rig: AnimationRigDefinition
): AnimationControllerBuilder => new AnimationControllerBuilder(rig);

// ─── buildAnimation*Definition (backward compat for raw definitions) ─────────

export const buildAnimationTransitionDefinition = (
    transition: AnimationTransitionInput
): AnimationTransitionDefinition =>
    transition instanceof AnimationTransitionBuilder
        ? transition.buildUnsafe() as AnimationTransitionDefinition
        : Object.freeze({
              to: transition.to,
              ...spreadIfFinite('duration', transition.duration),
              ...spreadIfFinite('offset', transition.offset),
              ...spreadIfFinite('exitTime', transition.exitTime),
              ...(transition.fixedDuration !== undefined
                  ? { fixedDuration: transition.fixedDuration }
                  : {}),
              ...(transition.canInterrupt !== undefined
                  ? { canInterrupt: transition.canInterrupt }
                  : {}),
              ...(transition.conditionMatch !== undefined ? { conditionMatch: transition.conditionMatch } : {}),
              ...(transition.easing !== undefined ? { easing: transition.easing } : {}),
              ...(transition.interruptMode !== undefined ? { interruptMode: transition.interruptMode } : {}),
              ...(transition.interruptHandoff !== undefined ? { interruptHandoff: transition.interruptHandoff } : {}),
              ...spreadIfFinite('priority', transition.priority),
              ...(transition.conditions
                  ? { conditions: Object.freeze(transition.conditions.map(cloneCondition)) }
                  : {}),
          });

export const buildAnimationStateDefinition = (state: AnimationStateInput): AnimationStateDefinition =>
    state instanceof AnimationStateBuilder
        ? state.buildUnsafe() as AnimationStateDefinition
        : Object.freeze({
              id: state.id,
              ...(state.motion ? { motion: buildAnimationMotionDefinition(state.motion) } : {}),
              ...(state.childMachine
                  ? { childMachine: buildAnimationStateMachineDefinition(state.childMachine) }
                  : {}),
              ...(state.behaviours
                  ? { behaviours: Object.freeze(state.behaviours.map(cloneStateBehaviour)) }
                  : {}),
              ...spreadIfFinite('speed', state.speed),
              ...(typeof state.loop === 'boolean' ? { loop: state.loop } : {}),
              ...(state.transitions
                  ? {
                        transitions: Object.freeze(
                            state.transitions.map(buildAnimationTransitionDefinition)
                        ),
                    }
                  : {}),
          });

export const buildAnimationStateMachineDefinition = (
    stateMachine: AnimationStateMachineInput
): AnimationStateMachineDefinition =>
    stateMachine instanceof AnimationStateMachineBuilder
        ? stateMachine.buildUnsafe() as AnimationStateMachineDefinition
        : Object.freeze({
              entryState: stateMachine.entryState,
              states: Object.freeze(stateMachine.states.map(buildAnimationStateDefinition)),
              ...(stateMachine.anyStateTransitions
                  ? {
                      anyStateTransitions: Object.freeze(
                          stateMachine.anyStateTransitions.map(buildAnimationTransitionDefinition)
                      ),
                  }
                  : {}),
          });

export const buildAnimationIkLayerDefinition = (
    layer: AnimationIkLayerInput
): AnimationIkLayerDefinition =>
    layer instanceof AnimationIkLayerBuilder
        ? layer.buildUnsafe() as AnimationIkLayerDefinition
        : Object.freeze({
              id: layer.id,
              ...spreadIfFinite('weight', layer.weight),
              jobs: Object.freeze(layer.jobs.map((job) => Object.freeze({ ...job }))),
          });

export const buildAnimationLayerDefinition = (layer: AnimationLayerInput): AnimationLayerDefinition =>
    layer instanceof AnimationLayerBuilder
        ? layer.buildUnsafe() as AnimationLayerDefinition
        : Object.freeze({
              id: layer.id,
              ...spreadIfFinite('weight', layer.weight),
              ...(layer.mode ? { mode: layer.mode } : {}),
              ...(layer.boneMask ? { boneMask: Object.freeze([...layer.boneMask]) } : {}),
              ...(layer.syncSourceLayerId !== undefined ? { syncSourceLayerId: layer.syncSourceLayerId } : {}),
              ...(layer.syncMode !== undefined ? { syncMode: layer.syncMode } : {}),
              ...spreadIfFinite('syncTimeOffset', layer.syncTimeOffset),
              stateMachine: buildAnimationStateMachineDefinition(layer.stateMachine),
              ...(layer.ikLayers
                  ? { ikLayers: Object.freeze(layer.ikLayers.map(buildAnimationIkLayerDefinition)) }
                  : {}),
          });

export const buildAnimationControllerDefinition = (
    controller: AnimationControllerInput
): AnimationControllerDefinition<readonly AnimationParameterDefinition[]> =>
    controller instanceof AnimationControllerBuilder
        ? controller.buildUnsafe() as AnimationControllerDefinition<readonly AnimationParameterDefinition[]>
        : Object.freeze({
              rig: cloneRigDefinition(controller.rig),
              clips: Object.freeze(controller.clips.map(cloneClipDefinition)),
              layers: Object.freeze(controller.layers.map(buildAnimationLayerDefinition)),
              ...(controller.parameters
                  ? { parameters: Object.freeze(controller.parameters.map(cloneParameterDefinition)) }
                  : {}),
              ...(controller.rootMotion !== undefined
                  ? {
                        rootMotion: controller.rootMotion
                            ? cloneRootMotionDefinition(controller.rootMotion)
                            : null,
                    }
                  : {}),
          });
