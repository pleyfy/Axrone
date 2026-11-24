import {
    compileMotion,
    evaluateMotion,
    extractMotionRootDelta,
    resolveMotionDuration,
    type AnimationCompiledMotion,
    type AnimationMotionEvaluationContext,
    BlendScratchContext,
} from './blend-tree';
import { collectMotionEvents } from './blend-tree';
import { collectMotionClipActivities } from './blend-tree';
import { assertNever, AnimationStateMachineError, AnimationValidationError } from './errors';
import { AnimationParameterStore } from './parameters';
import { blendFrame, type AnimationFrame } from './pose';
import { SoaQuatBuffer } from '@axrone/numeric';
import { AnimationClip } from './clip';
import type {
    AnimationConditionDefinition,
    AnimationConditionMatch,
    AnimationControllerClipActivity,
    AnimationStateBehaviourActionDefinition,
    AnimationStateBehaviourDefinition,
    AnimationStateBehaviourPhase,
    AnimationStateDefinition,
    AnimationStateMachineDefinition,
    AnimationStateSignal,
    AnimationTransitionDefinition,
    AnimationTransitionEasing,
    AnimationInterruptHandoff,
    AnimationInterruptMode,
    AnimationLayerSyncMode,
    AnimationMotionDefinition,
    AnimationControllerEvent,
} from './types';

/** Anything gated by a condition list: transitions and state behaviours alike. */
interface AnimationConditionGate {
    readonly conditions: readonly AnimationConditionDefinition[];
    readonly conditionMatch: AnimationConditionMatch;
}

export interface AnimationCompiledTransition {
    readonly targetStateIndex: number;
    readonly duration: number;
    readonly offset: number;
    readonly exitTime?: number;
    readonly fixedDuration: boolean;
    readonly canInterrupt: boolean;
    readonly interruptMode: AnimationInterruptMode;
    readonly interruptHandoff: AnimationInterruptHandoff;
    readonly easing: AnimationTransitionEasing;
    readonly priority: number;
    readonly conditionMatch: AnimationConditionMatch;
    readonly conditions: readonly AnimationConditionDefinition[];
}

export interface AnimationCompiledStateBehaviour {
    readonly id: string;
    readonly phase: AnimationStateBehaviourPhase;
    readonly actions: readonly AnimationStateBehaviourActionDefinition[];
    readonly conditionMatch: AnimationConditionMatch;
    readonly conditions: readonly AnimationConditionDefinition[];
    readonly intervalSeconds: number;
    /** Index into `AnimationLayerRuntime.behaviourTimers`, or -1 when unthrottled. */
    readonly intervalSlot: number;
}

/** One state on the path from the outermost group down to the active leaf. */
export interface AnimationCompiledStateOwner {
    readonly stateId: string;
    readonly behaviours: readonly AnimationCompiledStateBehaviour[];
}

export interface AnimationCompiledState {
    readonly id: string;
    readonly motion: AnimationCompiledMotion;
    readonly speed: number;
    readonly loop: boolean;
    readonly transitions: readonly AnimationCompiledTransition[];
    /** Authored id, without the group prefix. Equals `id` in a flat machine. */
    readonly localId: string;
    /** Group ids from the outermost owner down to this state, this state last. */
    readonly ownerChain: readonly AnimationCompiledStateOwner[];
    readonly nestingDepth: number;
    readonly behaviours: readonly AnimationCompiledStateBehaviour[];
}

export interface AnimationCompiledStateMachine {
    readonly entryStateIndex: number;
    readonly states: readonly AnimationCompiledState[];
    readonly anyStateTransitions: readonly AnimationCompiledTransition[];
    readonly stateIndexById: ReadonlyMap<string, number>;
    /** Deepest group nesting present after flattening; 0 for a flat machine. */
    readonly maxNestingDepth: number;
    /** Size of the throttle timer window a layer runtime needs; 0 when nothing is throttled. */
    readonly intervalBehaviourCount: number;
    /** True when at least one state on this machine declares behaviours. */
    readonly hasStateBehaviours: boolean;
}

export interface AnimationTransitionRuntime {
    sourceStateIndex: number;
    targetStateIndex: number;
    durationSeconds: number;
    progress: number;
    previousProgress: number;
    sourceNormalizedTime: number;
    previousSourceNormalizedTime: number;
    targetNormalizedTime: number;
    previousTargetNormalizedTime: number;
    complete: boolean;
    canInterrupt?: boolean;
    interruptMode?: AnimationInterruptMode;
    interruptHandoff?: AnimationInterruptHandoff;
    priority?: number;
    easing?: AnimationTransitionEasing;
}

export interface AnimationLayerRuntime {
    currentStateIndex: number;
    currentNormalizedTime: number;
    previousNormalizedTime: number;
    transition: AnimationTransitionRuntime | null;
    /** Owner chain the behaviours were last dispatched for; undefined until the first update. */
    dispatchedOwners?: readonly AnimationCompiledStateOwner[];
    /** Per-state, per-behaviour seconds since the last `update` dispatch. Created on first use. */
    behaviourTimers?: Float32Array;
}

const normalizePriority = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

const resolveTransitionEasing = (
    value: AnimationTransitionEasing | undefined
): AnimationTransitionEasing => {
    switch (value) {
        case undefined:
        case 'linear':
        case 'smoothStep':
        case 'easeIn':
        case 'easeOut':
        case 'easeInOut':
            return value ?? 'linear';
        default:
            throw new AnimationValidationError(`Unknown transition easing '${String(value)}'`);
    }
};

const resolveConditionMatch = (value: AnimationConditionMatch | undefined): AnimationConditionMatch => {
    switch (value) {
        case undefined:
        case 'all':
        case 'any':
            return value ?? 'all';
        default:
            throw new AnimationValidationError(`Unknown transition condition match '${String(value)}'`);
    }
};

const resolveInterruptMode = (
    value: AnimationInterruptMode | undefined,
    canInterrupt: boolean
): AnimationInterruptMode => {
    switch (value) {
        case undefined:
            return canInterrupt ? 'open' : 'blocked';
        case 'blocked':
        case 'open':
        case 'priorityGated':
            return value;
        default:
            throw new AnimationValidationError(`Unknown transition interrupt mode '${String(value)}'`);
    }
};

const resolveInterruptHandoff = (
    value: AnimationInterruptHandoff | undefined
): AnimationInterruptHandoff => {
    switch (value) {
        case undefined:
        case 'auto':
        case 'source':
        case 'target':
            return value ?? 'auto';
        default:
            throw new AnimationValidationError(`Unknown transition interrupt handoff '${String(value)}'`);
    }
};

const applyTransitionEasing = (easing: AnimationTransitionEasing | undefined, progress: number): number => {
    const t = Math.max(0, Math.min(1, progress));
    switch (easing) {
        case 'smoothStep':
            return t * t * (3 - 2 * t);
        case 'easeIn':
            return t * t;
        case 'easeOut':
            return 1 - (1 - t) * (1 - t);
        case 'easeInOut':
            return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        default:
            return t;
    }
};

const sortTransitions = (
    transitions: readonly AnimationCompiledTransition[]
): readonly AnimationCompiledTransition[] =>
    Object.freeze([...transitions].sort((left, right) => right.priority - left.priority));

const evaluateCondition = (
    condition: AnimationConditionDefinition,
    parameters: AnimationParameterStore
): boolean => {
    switch (condition.kind) {
        case 'float':
        case 'int': {
            const value = parameters.get(condition.parameter);
            const numericValue = typeof value === 'number' ? value : value ? 1 : 0;
            switch (condition.operator) {
                case '<':
                    return numericValue < condition.value;
                case '<=':
                    return numericValue <= condition.value;
                case '>':
                    return numericValue > condition.value;
                case '>=':
                    return numericValue >= condition.value;
                case '==':
                    return numericValue === condition.value;
                case '!=':
                    return numericValue !== condition.value;
                default:
                    throw new AnimationStateMachineError(
                        `Unsupported transition operator '${String(condition.operator)}'`
                    );
            }
        }
        case 'bool':
            return parameters.get(condition.parameter) === condition.value;
        case 'trigger':
            return parameters.get(condition.parameter) === true;
        default:
            return assertNever(condition, 'Unsupported transition condition kind');
    }
};

const conditionsSatisfied = (
    gate: AnimationConditionGate,
    parameters: AnimationParameterStore
): boolean => {
    const count = gate.conditions.length;
    if (count === 0) {
        return true;
    }
    if (gate.conditionMatch === 'any') {
        for (let index = 0; index < count; index += 1) {
            if (evaluateCondition(gate.conditions[index]!, parameters)) {
                return true;
            }
        }
        return false;
    }
    for (let index = 0; index < count; index += 1) {
        if (!evaluateCondition(gate.conditions[index]!, parameters)) {
            return false;
        }
    }
    return true;
};

const consumeTransitionTriggers = (
    transition: AnimationCompiledTransition,
    parameters: AnimationParameterStore
): void => {
    for (let index = 0; index < transition.conditions.length; index += 1) {
        const condition = transition.conditions[index]!;
        if (condition.kind === 'trigger') {
            parameters.consumeTrigger(condition.parameter);
        }
    }
};

const crossedExitTime = (
    previousNormalizedTime: number,
    currentNormalizedTime: number,
    exitTime: number,
    loop: boolean
): boolean => {
    if (!loop || currentNormalizedTime >= previousNormalizedTime) {
        return previousNormalizedTime < exitTime && currentNormalizedTime >= exitTime;
    }
    return exitTime >= previousNormalizedTime || exitTime <= currentNormalizedTime;
};

const resolveTransitionCandidate = (
    machine: AnimationCompiledStateMachine,
    stateIndex: number,
    previousNormalizedTime: number,
    currentNormalizedTime: number,
    parameters: AnimationParameterStore,
    excludeTargetIndex?: number
): AnimationCompiledTransition | undefined => {
    const state = machine.states[stateIndex]!;
    const anyStateTransitions = machine.anyStateTransitions;
    const stateTransitions = state.transitions;
    let anyIndex = 0;
    let stateIndexCursor = 0;
    while (anyIndex < anyStateTransitions.length || stateIndexCursor < stateTransitions.length) {
        const anyCandidate = anyStateTransitions[anyIndex];
        const stateCandidate = stateTransitions[stateIndexCursor];
        let transition: AnimationCompiledTransition;
        if (anyCandidate && (!stateCandidate || anyCandidate.priority >= stateCandidate.priority)) {
            transition = anyCandidate;
            anyIndex += 1;
        } else {
            transition = stateCandidate!;
            stateIndexCursor += 1;
        }
        if (excludeTargetIndex !== undefined && transition.targetStateIndex === excludeTargetIndex) {
            continue;
        }
        if (
            transition.exitTime !== undefined &&
            !crossedExitTime(previousNormalizedTime, currentNormalizedTime, transition.exitTime, state.loop)
        ) {
            continue;
        }
        if (conditionsSatisfied(transition, parameters)) {
            return transition;
        }
    }
    return undefined;
};

const resolveStateDurationSeconds = (
    state: AnimationCompiledState,
    parameters: AnimationParameterStore
): number =>
    Math.max(1e-6, resolveMotionDuration(state.motion, parameters) / Math.max(Math.abs(state.speed), 1e-6));

/**
 * Separator inserted between a group state and the ids of its child machine.
 * Authored ids may contain it until a machine actually nests.
 */
export const ANIMATION_NESTED_STATE_SEPARATOR = '/';

/** Maximum number of group states between the root machine and a playable leaf. */
export const ANIMATION_MAX_STATE_NESTING_DEPTH = 4;

/**
 * How many extra transition re-checks a single behaviour dispatch may trigger when its
 * actions write parameters. Bounded so two states that pulse each other's entry trigger
 * cannot spin the loop.
 */
const ANIMATION_BEHAVIOUR_TRANSITION_PASSES = 3;

const EMPTY_TRANSITION_DEFINITIONS: readonly AnimationTransitionDefinition[] = Object.freeze([]);
const EMPTY_BEHAVIOURS: readonly AnimationCompiledStateBehaviour[] = Object.freeze([]);
const EMPTY_OWNERS: readonly AnimationCompiledStateOwner[] = Object.freeze([]);
const EMPTY_SCOPES: readonly ReadonlyMap<string, number>[] = Object.freeze([]);
const EMPTY_MACHINE_ANCESTORS: readonly AnimationStateMachineDefinition[] = Object.freeze([]);

interface FlattenedState {
    readonly definition: AnimationStateDefinition;
    readonly id: string;
    readonly motion: AnimationMotionDefinition;
    readonly transitionDefinitions: readonly AnimationTransitionDefinition[];
    /** Id-to-index maps from the innermost machine outward, used to resolve `to`. */
    readonly scopes: readonly ReadonlyMap<string, number>[];
    readonly ownerChain: readonly AnimationCompiledStateOwner[];
    readonly speedScale: number;
    readonly nestingDepth: number;
}

interface FlattenContext {
    readonly states: FlattenedState[];
    readonly aliases: Map<string, number>;
    readonly nested: boolean;
    maxNestingDepth: number;
    intervalBehaviours: number;
    behaviourCount: number;
}

const resolveStateSpeed = (state: AnimationStateDefinition): number =>
    typeof state.speed === 'number' && Number.isFinite(state.speed) ? state.speed : 1;

const compileStateBehaviour = (
    behaviour: AnimationStateBehaviourDefinition,
    position: number,
    context: FlattenContext
): AnimationCompiledStateBehaviour => {
    if (!behaviour) {
        throw new AnimationValidationError('Animation state behaviours require a definition object');
    }
    const phase = behaviour.phase;
    if (phase !== 'enter' && phase !== 'update' && phase !== 'exit') {
        throw new AnimationValidationError(
            `Unknown animation state behaviour phase '${String(behaviour.phase)}'`
        );
    }
    if (!Array.isArray(behaviour.actions) || behaviour.actions.length === 0) {
        throw new AnimationValidationError(
            `Animation state behaviour '${behaviour.id ?? `#${position}`}' requires at least one action`
        );
    }
    const actions = Object.freeze(
        behaviour.actions.map((action) => {
            if (!action) {
                throw new AnimationValidationError(
                    `Animation state behaviour '${behaviour.id ?? `#${position}`}' has an empty action`
                );
            }
            switch (action.kind) {
                case 'writeParameter':
                    if (typeof action.value !== 'number' && typeof action.value !== 'boolean') {
                        throw new AnimationValidationError(
                            `Animation state behaviour 'writeParameter' requires a number or boolean value`
                        );
                    }
                    break;
                case 'pulseTrigger':
                    break;
                case 'emitSignal':
                    if (typeof action.signal !== 'string' || action.signal.length === 0) {
                        throw new AnimationValidationError(
                            `Animation state behaviour 'emitSignal' requires a non-empty signal`
                        );
                    }
                    break;
                default:
                    throw new AnimationValidationError(
                        `Unknown animation state behaviour action '${String(
                            (action as { kind?: unknown }).kind
                        )}'`
                    );
            }
            return Object.freeze({ ...action });
        })
    );
    const rawInterval = behaviour.intervalSeconds;
    const intervalSeconds =
        typeof rawInterval === 'number' && Number.isFinite(rawInterval) ? Math.max(0, rawInterval) : 0;
    const intervalSlot =
        intervalSeconds > 0 && phase === 'update' ? context.intervalBehaviours++ : -1;
    return Object.freeze({
        id: behaviour.id ?? `${phase}#${position}`,
        phase,
        actions,
        conditionMatch: resolveConditionMatch(behaviour.conditionMatch),
        conditions: Object.freeze([...(behaviour.conditions ?? [])]),
        intervalSeconds,
        intervalSlot,
    });
};

const compileStateBehaviours = (
    behaviours: readonly AnimationStateBehaviourDefinition[] | undefined,
    context: FlattenContext
): readonly AnimationCompiledStateBehaviour[] => {
    if (!behaviours || behaviours.length === 0) {
        return EMPTY_BEHAVIOURS;
    }
    context.behaviourCount += behaviours.length;
    return Object.freeze(
        behaviours.map((behaviour, index) => compileStateBehaviour(behaviour, index, context))
    );
};

const machineIsNested = (definition: AnimationStateMachineDefinition): boolean => {
    for (let index = 0; index < (definition.states?.length ?? 0); index += 1) {
        if (definition.states![index]?.childMachine) {
            return true;
        }
    }
    return false;
};

const flattenMachine = (
    definition: AnimationStateMachineDefinition,
    prefix: string,
    inherited: readonly AnimationTransitionDefinition[],
    scopes: readonly ReadonlyMap<string, number>[],
    ownerChain: readonly AnimationCompiledStateOwner[],
    speedScale: number,
    depth: number,
    ancestors: readonly AnimationStateMachineDefinition[],
    context: FlattenContext
): { readonly entryStateIndex: number } => {
    if (depth > ANIMATION_MAX_STATE_NESTING_DEPTH) {
        throw new AnimationValidationError(
            `Animation state nesting exceeds the maximum of ${ANIMATION_MAX_STATE_NESTING_DEPTH} levels`
        );
    }
    if (ancestors.indexOf(definition) >= 0) {
        throw new AnimationValidationError('Animation child machines must not reference themselves');
    }

    const localScope = new Map<string, number>();
    const innerScopes = [localScope, ...scopes];
    const machineAnyState =
        depth > 0 ? definition.anyStateTransitions ?? EMPTY_TRANSITION_DEFINITIONS : EMPTY_TRANSITION_DEFINITIONS;
    const applicableHere =
        inherited.length > 0 || machineAnyState.length > 0
            ? [...inherited, ...machineAnyState]
            : EMPTY_TRANSITION_DEFINITIONS;
    const nextAncestors = [...ancestors, definition];
    const states = context.states;

    for (let index = 0; index < definition.states.length; index += 1) {
        const state = definition.states[index]!;
        if (!state || typeof state.id !== 'string' || state.id.length === 0) {
            throw new AnimationValidationError('Animation states require a non-empty id');
        }
        if (context.nested && state.id.indexOf(ANIMATION_NESTED_STATE_SEPARATOR) >= 0) {
            throw new AnimationValidationError(
                `Animation state '${state.id}' may not contain '${ANIMATION_NESTED_STATE_SEPARATOR}' in a nested machine`
            );
        }
        if (localScope.has(state.id)) {
            throw new AnimationValidationError(`Duplicate animation state '${prefix}${state.id}'`);
        }
        if (depth > context.maxNestingDepth) {
            context.maxNestingDepth = depth;
        }

        if (state.childMachine) {
            if (state.motion) {
                throw new AnimationValidationError(
                    `Animation state '${prefix}${state.id}' must declare either a motion or a child machine, not both`
                );
            }
            const groupId = `${prefix}${state.id}`;
            const owners = Object.freeze([
                ...ownerChain,
                Object.freeze({ stateId: groupId, behaviours: compileStateBehaviours(state.behaviours, context) }),
            ]);
            const groupInherited = Object.freeze([
                ...applicableHere,
                ...(state.transitions ?? EMPTY_TRANSITION_DEFINITIONS),
            ]);
            const child = flattenMachine(
                state.childMachine,
                `${groupId}${ANIMATION_NESTED_STATE_SEPARATOR}`,
                groupInherited,
                innerScopes,
                owners,
                speedScale * resolveStateSpeed(state),
                depth + 1,
                nextAncestors,
                context
            );
            localScope.set(state.id, child.entryStateIndex);
            context.aliases.set(groupId, child.entryStateIndex);
            continue;
        }

        if (!state.motion) {
            throw new AnimationValidationError(
                `Animation state '${prefix}${state.id}' requires a motion or a child machine`
            );
        }
        const position = states.length;
        localScope.set(state.id, position);
        const id = `${prefix}${state.id}`;
        context.aliases.set(id, position);
        states.push({
            definition: state,
            id,
            motion: state.motion,
            transitionDefinitions:
                applicableHere.length > 0 || (state.transitions?.length ?? 0) > 0
                    ? [...(state.transitions ?? EMPTY_TRANSITION_DEFINITIONS), ...applicableHere]
                    : EMPTY_TRANSITION_DEFINITIONS,
            scopes: innerScopes,
            ownerChain: Object.freeze([
                ...ownerChain,
                Object.freeze({ stateId: id, behaviours: compileStateBehaviours(state.behaviours, context) }),
            ]),
            speedScale,
            nestingDepth: depth,
        });
    }

    const entryStateIndex = localScope.get(definition.entryState);
    if (entryStateIndex === undefined) {
        throw new AnimationValidationError(`Unknown animation entry state '${definition.entryState}'`);
    }
    return { entryStateIndex };
};

export const compileStateMachine = (
    definition: AnimationStateMachineDefinition,
    clips: ReadonlyMap<string, AnimationClip>
): AnimationCompiledStateMachine => {
    if (!definition || !Array.isArray(definition.states) || definition.states.length === 0) {
        throw new AnimationValidationError('Animation state machines require at least one state');
    }
    const nested = machineIsNested(definition);
    const context: FlattenContext = {
        states: [],
        aliases: new Map<string, number>(),
        nested,
        maxNestingDepth: 0,
        intervalBehaviours: 0,
        behaviourCount: 0,
    };
    const { entryStateIndex } = flattenMachine(
        definition,
        '',
        EMPTY_TRANSITION_DEFINITIONS,
        EMPTY_SCOPES,
        EMPTY_OWNERS,
        1,
        0,
        EMPTY_MACHINE_ANCESTORS,
        context
    );
    if (context.states.length === 0) {
        throw new AnimationValidationError('Animation state machines require at least one playable state');
    }

    const compileTransition = (
        transition: AnimationTransitionDefinition,
        scopes: readonly ReadonlyMap<string, number>[]
    ): AnimationCompiledTransition => {
        let targetStateIndex: number | undefined;
        for (let scope = 0; scope < scopes.length && targetStateIndex === undefined; scope += 1) {
            targetStateIndex = scopes[scope]!.get(transition.to);
        }
        if (targetStateIndex === undefined) {
            throw new AnimationValidationError(`Unknown animation transition target '${transition.to}'`);
        }
        return Object.freeze({
            targetStateIndex,
            duration: typeof transition.duration === 'number' && Number.isFinite(transition.duration) ? transition.duration : 0,
            offset: typeof transition.offset === 'number' && Number.isFinite(transition.offset) ? transition.offset : 0,
            exitTime:
                typeof transition.exitTime === 'number' && Number.isFinite(transition.exitTime)
                    ? transition.exitTime
                    : undefined,
            fixedDuration: transition.fixedDuration ?? false,
            canInterrupt: transition.canInterrupt ?? false,
            interruptMode: resolveInterruptMode(transition.interruptMode, transition.canInterrupt ?? false),
            interruptHandoff: resolveInterruptHandoff(transition.interruptHandoff),
            easing: resolveTransitionEasing(transition.easing),
            priority: normalizePriority(transition.priority),
            conditionMatch: resolveConditionMatch(transition.conditionMatch),
            conditions: Object.freeze([...(transition.conditions ?? [])]),
        });
    };

    const states = Object.freeze(
        context.states.map((entry) =>
            Object.freeze({
                id: entry.id,
                localId: entry.definition.id,
                motion: compileMotion(entry.motion, clips),
                speed: entry.speedScale * resolveStateSpeed(entry.definition),
                loop: entry.definition.loop ?? true,
                transitions: sortTransitions(
                    Object.freeze(
                        entry.transitionDefinitions.map((transition: AnimationTransitionDefinition) =>
                            compileTransition(transition, entry.scopes)
                        )
                    )
                ),
                ownerChain: entry.ownerChain,
                nestingDepth: entry.nestingDepth,
                behaviours: entry.ownerChain[entry.ownerChain.length - 1]!.behaviours,
            } satisfies AnimationCompiledState)
        )
    );

    return Object.freeze({
        entryStateIndex,
        states,
        anyStateTransitions: sortTransitions(
            Object.freeze(
                (definition.anyStateTransitions ?? []).map((transition: AnimationTransitionDefinition) =>
                    compileTransition(transition, [context.aliases])
                )
            )
        ),
        stateIndexById: context.aliases,
        maxNestingDepth: context.maxNestingDepth,
        intervalBehaviourCount: context.intervalBehaviours,
        hasStateBehaviours: context.behaviourCount > 0,
    });
};

export const createLayerRuntime = (machine: AnimationCompiledStateMachine): AnimationLayerRuntime => ({
    currentStateIndex: machine.entryStateIndex,
    currentNormalizedTime: 0,
    previousNormalizedTime: 0,
    transition: null,
});

const runningInterruptMode = (transition: AnimationTransitionRuntime): AnimationInterruptMode =>
    transition.interruptMode ?? (transition.canInterrupt === true ? 'open' : 'blocked');

export const forceLayerState = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    stateId: string,
    normalizedTime: number = 0
): void => {
    const stateIndex = machine.stateIndexById.get(stateId);
    if (stateIndex === undefined) {
        throw new AnimationStateMachineError(`Unknown animation state '${stateId}'`);
    }
    runtime.currentStateIndex = stateIndex;
    runtime.currentNormalizedTime = normalizedTime;
    runtime.previousNormalizedTime = normalizedTime;
    runtime.transition = null;
};

export const crossFadeLayerState = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    stateId: string,
    durationSeconds: number,
    offset: number = 0,
    canInterrupt: boolean = false,
    easing: AnimationTransitionEasing = 'linear',
    interruptMode?: AnimationInterruptMode,
    interruptHandoff?: AnimationInterruptHandoff
): void => {
    const stateIndex = machine.stateIndexById.get(stateId);
    if (stateIndex === undefined) {
        throw new AnimationStateMachineError(`Unknown animation state '${stateId}'`);
    }
    runtime.transition = {
        sourceStateIndex: runtime.currentStateIndex,
        targetStateIndex: stateIndex,
        durationSeconds: Math.max(0, durationSeconds),
        progress: 0,
        previousProgress: 0,
        sourceNormalizedTime: runtime.currentNormalizedTime,
        previousSourceNormalizedTime: runtime.currentNormalizedTime,
        targetNormalizedTime: offset,
        previousTargetNormalizedTime: offset,
        complete: false,
        canInterrupt,
        interruptMode: interruptMode ?? (canInterrupt ? 'open' : 'blocked'),
        interruptHandoff: interruptHandoff ?? 'auto',
        priority: 0,
        easing,
    };
};

export const updateLayerRuntime = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    parameters: AnimationParameterStore,
    deltaSeconds: number
): void => {
    if (runtime.transition) {
        const transition = runtime.transition;
        const sourceState = machine.states[transition.sourceStateIndex]!;
        const targetState = machine.states[transition.targetStateIndex]!;
        const sourceDuration = resolveStateDurationSeconds(sourceState, parameters);
        const targetDuration = resolveStateDurationSeconds(targetState, parameters);
        transition.previousSourceNormalizedTime = transition.sourceNormalizedTime;
        transition.previousTargetNormalizedTime = transition.targetNormalizedTime;
        transition.previousProgress = transition.progress;
        transition.sourceNormalizedTime = sourceState.loop
            ? ((transition.sourceNormalizedTime + deltaSeconds / sourceDuration) % 1 + 1) % 1
            : Math.min(1, transition.sourceNormalizedTime + deltaSeconds / sourceDuration);
        transition.targetNormalizedTime = targetState.loop
            ? ((transition.targetNormalizedTime + deltaSeconds / targetDuration) % 1 + 1) % 1
            : Math.min(1, transition.targetNormalizedTime + deltaSeconds / targetDuration);
        if (transition.durationSeconds <= 0) {
            transition.progress = 1;
            transition.complete = true;
            return;
        }
        transition.progress = Math.min(1, transition.progress + deltaSeconds / transition.durationSeconds);
        transition.complete = transition.progress >= 1;
        if (transition.complete) {
            return;
        }
        const interruptMode = runningInterruptMode(transition);
        if (interruptMode === 'blocked') {
            return;
        }

        const interrupter = resolveTransitionCandidate(
            machine,
            transition.sourceStateIndex,
            transition.previousSourceNormalizedTime,
            transition.sourceNormalizedTime,
            parameters,
            transition.targetStateIndex
        );
        if (!interrupter) {
            return;
        }
        if (interruptMode === 'priorityGated' && !(interrupter.priority > (transition.priority ?? 0))) {
            return;
        }

        consumeTransitionTriggers(interrupter, parameters);
        const handoff = transition.interruptHandoff ?? 'auto';
        const interruptFromTarget =
            handoff === 'target' ? true : handoff === 'source' ? false : transition.progress >= 0.5;
        const interruptSourceStateIndex = interruptFromTarget
            ? transition.targetStateIndex
            : transition.sourceStateIndex;
        const interruptSourceNormalizedTime = interruptFromTarget
            ? transition.targetNormalizedTime
            : transition.sourceNormalizedTime;
        const interruptSourceDuration = resolveStateDurationSeconds(
            machine.states[interruptSourceStateIndex]!,
            parameters
        );
        const interruptDuration = interrupter.fixedDuration
            ? interrupter.duration
            : interrupter.duration * interruptSourceDuration;
        runtime.transition = {
            sourceStateIndex: interruptSourceStateIndex,
            targetStateIndex: interrupter.targetStateIndex,
            durationSeconds: Math.max(0, interruptDuration),
            progress: 0,
            previousProgress: 0,
            sourceNormalizedTime: interruptSourceNormalizedTime,
            previousSourceNormalizedTime: interruptSourceNormalizedTime,
            targetNormalizedTime: interrupter.offset,
            previousTargetNormalizedTime: interrupter.offset,
            complete: false,
            canInterrupt: interrupter.canInterrupt,
            interruptMode: interrupter.interruptMode,
            interruptHandoff: interrupter.interruptHandoff,
            priority: interrupter.priority,
            easing: interrupter.easing,
        };
        return;
    }

    runtime.previousNormalizedTime = runtime.currentNormalizedTime;
    const currentState = machine.states[runtime.currentStateIndex]!;
    const durationSeconds = resolveStateDurationSeconds(currentState, parameters);
    runtime.currentNormalizedTime = currentState.loop
        ? ((runtime.currentNormalizedTime + deltaSeconds / durationSeconds) % 1 + 1) % 1
        : Math.min(1, runtime.currentNormalizedTime + deltaSeconds / durationSeconds);

    const candidate = resolveTransitionCandidate(
        machine,
        runtime.currentStateIndex,
        runtime.previousNormalizedTime,
        runtime.currentNormalizedTime,
        parameters
    );
    if (!candidate) {
        return;
    }

    consumeTransitionTriggers(candidate, parameters);
    const duration = candidate.fixedDuration
        ? candidate.duration
        : candidate.duration * durationSeconds;
    runtime.transition = {
        sourceStateIndex: runtime.currentStateIndex,
        targetStateIndex: candidate.targetStateIndex,
        durationSeconds: Math.max(0, duration),
        progress: 0,
        previousProgress: 0,
        sourceNormalizedTime: runtime.currentNormalizedTime,
        previousSourceNormalizedTime: runtime.currentNormalizedTime,
        targetNormalizedTime: candidate.offset,
        previousTargetNormalizedTime: candidate.offset,
        complete: false,
        canInterrupt: candidate.canInterrupt,
        interruptMode: candidate.interruptMode,
        interruptHandoff: candidate.interruptHandoff,
        priority: candidate.priority,
        easing: candidate.easing,
    };
}

export interface AnimationLayerSyncOptions {
    readonly mode?: AnimationLayerSyncMode;
    readonly timeOffset?: number;
}

const wrapUnit = (value: number): number => ((value % 1) + 1) % 1;

const resolveSyncOffset = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

const applySyncOffset = (value: number, offset: number): number =>
    offset === 0 ? value : wrapUnit(value + offset);

export const syncLayerRuntime = (
    machine: AnimationCompiledStateMachine,
    target: AnimationLayerRuntime,
    sourceMachine: AnimationCompiledStateMachine,
    source: AnimationLayerRuntime,
    options?: AnimationLayerSyncOptions
): void => {
    const mode = options?.mode ?? 'stateAndTime';
    const offset = resolveSyncOffset(options?.timeOffset);
    const mirrorsState = mode !== 'timeOnly';
    const mirrorsTime = mode !== 'stateOnly';

    if (mode === 'stateOnly') {
        const designatedIndex = source.transition
            ? source.transition.targetStateIndex
            : source.currentStateIndex;
        const sourceStateId = sourceMachine.states[designatedIndex]!.id;
        const targetIndex = machine.stateIndexById.get(sourceStateId);
        if (targetIndex === undefined) {
            return;
        }
        target.currentStateIndex = targetIndex;
        target.transition = null;
        return;
    }

    let mirroredIndex: number | undefined;
    if (mirrorsState) {
        const sourceStateId = sourceMachine.states[source.currentStateIndex]!.id;
        mirroredIndex = machine.stateIndexById.get(sourceStateId);
        if (mirroredIndex === undefined) {
            return;
        }
        target.currentStateIndex = mirroredIndex;
    }
    if (mirrorsTime) {
        target.currentNormalizedTime = applySyncOffset(source.currentNormalizedTime, offset);
        target.previousNormalizedTime = applySyncOffset(source.previousNormalizedTime, offset);
    }

    if (!source.transition) {
        if (mirrorsState) {
            target.transition = null;
        }
        return;
    }

    if (!mirrorsState) {
        if (mirrorsTime && target.transition) {
            const transition = target.transition;
            transition.sourceNormalizedTime = applySyncOffset(source.transition.sourceNormalizedTime, offset);
            transition.targetNormalizedTime = applySyncOffset(source.transition.targetNormalizedTime, offset);
        }
        return;
    }

    const sourceTargetId = sourceMachine.states[source.transition.targetStateIndex]!.id;
    const targetTargetIndex = machine.stateIndexById.get(sourceTargetId);
    if (targetTargetIndex === undefined) {
        target.transition = null;
        return;
    }

    target.transition = {
        ...source.transition,
        sourceStateIndex: mirroredIndex!,
        targetStateIndex: targetTargetIndex,
        sourceNormalizedTime: applySyncOffset(source.transition.sourceNormalizedTime, offset),
        previousSourceNormalizedTime: applySyncOffset(source.transition.previousSourceNormalizedTime, offset),
        targetNormalizedTime: applySyncOffset(source.transition.targetNormalizedTime, offset),
        previousTargetNormalizedTime: applySyncOffset(source.transition.previousTargetNormalizedTime, offset),
    };
};

const designatedStateIndex = (runtime: AnimationLayerRuntime): number =>
    runtime.transition ? runtime.transition.targetStateIndex : runtime.currentStateIndex;

const designatedNormalizedTime = (runtime: AnimationLayerRuntime): number =>
    runtime.transition ? runtime.transition.targetNormalizedTime : runtime.currentNormalizedTime;

const runStateBehaviourPhase = (
    owner: AnimationCompiledStateOwner,
    phase: AnimationStateBehaviourPhase,
    parameters: AnimationParameterStore,
    layerId: string,
    normalizedTime: number,
    timers: Float32Array | undefined,
    out: AnimationStateSignal[] | undefined
): boolean => {
    let mutatedParameters = false;
    const behaviours = owner.behaviours;
    for (let index = 0; index < behaviours.length; index += 1) {
        const behaviour = behaviours[index]!;
        if (behaviour.phase !== phase) {
            continue;
        }
        if (!conditionsSatisfied(behaviour, parameters)) {
            continue;
        }
        if (behaviour.intervalSlot >= 0) {
            if ((timers?.[behaviour.intervalSlot] ?? 0) < behaviour.intervalSeconds) {
                continue;
            }
            if (timers) {
                timers[behaviour.intervalSlot] = 0;
            }
        }
        for (let actionIndex = 0; actionIndex < behaviour.actions.length; actionIndex += 1) {
            const action = behaviour.actions[actionIndex]!;
            switch (action.kind) {
                case 'writeParameter':
                    parameters.set(String(action.parameter), action.value);
                    mutatedParameters = true;
                    break;
                case 'pulseTrigger':
                    parameters.setTrigger(String(action.parameter));
                    mutatedParameters = true;
                    break;
                case 'emitSignal':
                    if (out) {
                        out.push({
                            layerId,
                            stateId: owner.stateId,
                            behaviourId: behaviour.id,
                            phase,
                            signal: action.signal,
                            payload: action.payload ?? null,
                            normalizedTime,
                        });
                    }
                    break;
                default:
                    assertNever(action, 'Unsupported animation state behaviour action');
            }
        }
    }
    return mutatedParameters;
};

/**
 * Exits the superseded owner chain inward-out and enters the new one outward-in,
 * skipping the prefix both chains share so a sibling swap inside a group state
 * never disturbs the group itself.
 */
const dispatchChainSwitch = (
    previous: readonly AnimationCompiledStateOwner[],
    next: readonly AnimationCompiledStateOwner[],
    parameters: AnimationParameterStore,
    layerId: string,
    normalizedTime: number,
    timers: Float32Array | undefined,
    out: AnimationStateSignal[] | undefined
): boolean => {
    let common = 0;
    while (
        common < previous.length &&
        common < next.length &&
        previous[common]!.stateId === next[common]!.stateId
    ) {
        common += 1;
    }
    let mutatedParameters = false;
    for (let index = previous.length - 1; index >= common; index -= 1) {
        mutatedParameters =
            runStateBehaviourPhase(previous[index]!, 'exit', parameters, layerId, normalizedTime, timers, out) ||
            mutatedParameters;
    }
    for (let index = common; index < next.length; index += 1) {
        mutatedParameters =
            runStateBehaviourPhase(next[index]!, 'enter', parameters, layerId, normalizedTime, timers, out) ||
            mutatedParameters;
    }
    return mutatedParameters;
};

/**
 * Fires the declarative behaviours of every state whose designation changed
 * since the last call. The designated state of a layer is the crossfade target
 * while a transition runs, so `exit` for the superseded chain always precedes
 * `enter` for the new one, and `update` follows both. Group states own the same
 * lifecycle as their leaves: entering a leaf enters every group above it.
 *
 * Behaviours may write parameters or pulse triggers. Those side effects are fed
 * back into the layer before the step ends, so a trigger a behaviour pulses is
 * consumed by the transition that watches it in the same step rather than one
 * step late.
 */
export const dispatchLayerStateBehaviours = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    parameters: AnimationParameterStore,
    layerId: string,
    deltaSeconds: number,
    out?: AnimationStateSignal[]
): void => {
    const nextOwners = machine.states[designatedStateIndex(runtime)]?.ownerChain ?? EMPTY_OWNERS;
    const previousOwners = runtime.dispatchedOwners;
    const switched = previousOwners !== nextOwners;
    runtime.dispatchedOwners = nextOwners;

    let timers = runtime.behaviourTimers;
    if (machine.intervalBehaviourCount > 0) {
        if (!timers) {
            timers = new Float32Array(machine.intervalBehaviourCount).fill(Number.MAX_VALUE);
            runtime.behaviourTimers = timers;
        } else {
            for (let index = 0; index < timers.length; index += 1) {
                timers[index] = timers[index]! + Math.max(0, deltaSeconds);
            }
        }
    }

    const normalizedTime = designatedNormalizedTime(runtime);
    let mutatedParameters = false;
    if (switched) {
        let previous = previousOwners ?? EMPTY_OWNERS;
        if (previousOwners === undefined) {
            // A fresh runtime is designated on the entry chain before its first
            // dispatch. When a transition supersedes that chain inside the very
            // first step, the entry chain still has to be entered before it can
            // be exited, otherwise its `exit` behaviours are silently dropped.
            const entryOwners = machine.states[machine.entryStateIndex]?.ownerChain ?? EMPTY_OWNERS;
            if (entryOwners !== nextOwners) {
                for (let index = 0; index < entryOwners.length; index += 1) {
                    mutatedParameters =
                        runStateBehaviourPhase(
                            entryOwners[index]!,
                            'enter',
                            parameters,
                            layerId,
                            runtime.currentNormalizedTime,
                            timers,
                            out
                        ) || mutatedParameters;
                }
                previous = entryOwners;
            }
        }
        mutatedParameters =
            dispatchChainSwitch(previous, nextOwners, parameters, layerId, normalizedTime, timers, out) ||
            mutatedParameters;
    }
    for (let index = 0; index < nextOwners.length; index += 1) {
        mutatedParameters =
            runStateBehaviourPhase(nextOwners[index]!, 'update', parameters, layerId, normalizedTime, timers, out) ||
            mutatedParameters;
    }

    if (!mutatedParameters) {
        return;
    }
    // Zero delta keeps this a pure condition re-check: no time advances, so
    // exitTime gates cannot be crossed by the extra pass itself. Only the switch
    // half of the lifecycle is dispatched again - `update` already ran this step.
    for (let pass = 0; pass < ANIMATION_BEHAVIOUR_TRANSITION_PASSES; pass += 1) {
        const designatedBefore = designatedStateIndex(runtime);
        updateLayerRuntime(machine, runtime, parameters, 0);
        const designatedAfter = designatedStateIndex(runtime);
        if (designatedAfter === designatedBefore) {
            return;
        }
        const chainedOwners = machine.states[designatedAfter]?.ownerChain ?? EMPTY_OWNERS;
        const superseded = runtime.dispatchedOwners ?? EMPTY_OWNERS;
        runtime.dispatchedOwners = chainedOwners;
        if (
            !dispatchChainSwitch(
                superseded,
                chainedOwners,
                parameters,
                layerId,
                designatedNormalizedTime(runtime),
                timers,
                out
            )
        ) {
            return;
        }
    }
};

export const evaluateLayerRuntime = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame
): AnimationFrame => {
    if (!runtime.transition) {
        const state = machine.states[runtime.currentStateIndex]!;
        return evaluateMotion(
            state.motion,
            runtime.currentNormalizedTime,
            context,
            out,
            state.loop
        );
    }
    const sourceState = machine.states[runtime.transition.sourceStateIndex]!;
    const targetState = machine.states[runtime.transition.targetStateIndex]!;
    const sourceFrame = context.scratch.acquire();
    const targetFrame = context.scratch.acquire();
    evaluateMotion(
        sourceState.motion,
        runtime.transition.sourceNormalizedTime,
        context,
        sourceFrame,
        sourceState.loop
    );
    evaluateMotion(
        targetState.motion,
        runtime.transition.targetNormalizedTime,
        context,
        targetFrame,
        targetState.loop
    );
    return blendFrame(out, sourceFrame, targetFrame, applyTransitionEasing(runtime.transition.easing, runtime.transition.progress));
};

export const extractLayerRootDelta = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    rootBoneIndex: number,
    context: AnimationMotionEvaluationContext,
    outTranslation: Float32Array,
    outRotation: Float32Array
): void => {
    if (rootBoneIndex < 0) {
        outTranslation.fill(0);
        SoaQuatBuffer.quatIdentity(outRotation, 0);
        return;
    }
    if (!runtime.transition) {
        const state = machine.states[runtime.currentStateIndex]!;
        extractMotionRootDelta(
            state.motion,
            runtime.previousNormalizedTime,
            runtime.currentNormalizedTime,
            state.loop,
            rootBoneIndex,
            context.rig,
            context.parameters,
            outTranslation,
            outRotation,
            context
        );
        return;
    }

    const scratch = context.blendScratch.transitionRootDeltaScratch;
    const sourceTranslation = scratch.sourceTranslation;
    const targetTranslation = scratch.targetTranslation;
    const sourceRotation = scratch.sourceRotation;
    const targetRotation = scratch.targetRotation;
    const sourceState = machine.states[runtime.transition.sourceStateIndex]!;
    const targetState = machine.states[runtime.transition.targetStateIndex]!;

    extractMotionRootDelta(
        sourceState.motion,
        runtime.transition.previousSourceNormalizedTime,
        runtime.transition.sourceNormalizedTime,
        sourceState.loop,
        rootBoneIndex,
        context.rig,
        context.parameters,
        sourceTranslation,
        sourceRotation,
        context
    );
    extractMotionRootDelta(
        targetState.motion,
        runtime.transition.previousTargetNormalizedTime,
        runtime.transition.targetNormalizedTime,
        targetState.loop,
        rootBoneIndex,
        context.rig,
        context.parameters,
        targetTranslation,
        targetRotation,
        context
    );

    const transitionWeight = applyTransitionEasing(runtime.transition.easing, runtime.transition.progress);
    outTranslation[0] =
        sourceTranslation[0]! +
        (targetTranslation[0]! - sourceTranslation[0]!) * transitionWeight;
    outTranslation[1] =
        sourceTranslation[1]! +
        (targetTranslation[1]! - sourceTranslation[1]!) * transitionWeight;
    outTranslation[2] =
        sourceTranslation[2]! +
        (targetTranslation[2]! - sourceTranslation[2]!) * transitionWeight;
    SoaQuatBuffer.quatIdentity(outRotation, 0);
    SoaQuatBuffer.quatSlerp(outRotation, 0, sourceRotation, 0, targetRotation, 0, transitionWeight);
}

export const collectLayerEvents = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    context: AnimationMotionEvaluationContext,
    layerId: string,
    layerWeight: number,
    out: AnimationControllerEvent[] = []
): readonly AnimationControllerEvent[] => {
    if (layerWeight <= 0) {
        return out;
    }

    if (!runtime.transition) {
        const state = machine.states[runtime.currentStateIndex]!;
        return collectMotionEvents(
            state.motion,
            runtime.previousNormalizedTime,
            runtime.currentNormalizedTime,
            state.loop,
            context.parameters,
            layerId,
            state.id,
            layerWeight,
            1,
            out
        );
    }

    const sourceState = machine.states[runtime.transition.sourceStateIndex]!;
    const targetState = machine.states[runtime.transition.targetStateIndex]!;
    const transitionWeight = applyTransitionEasing(runtime.transition.easing, runtime.transition.progress);
    const sourceWeight = Math.max(0, 1 - transitionWeight);
    const targetWeight = Math.max(0, transitionWeight);

    collectMotionEvents(
        sourceState.motion,
        runtime.transition.previousSourceNormalizedTime,
        runtime.transition.sourceNormalizedTime,
        sourceState.loop,
        context.parameters,
        layerId,
        sourceState.id,
        layerWeight,
        sourceWeight,
        out
    );
    collectMotionEvents(
        targetState.motion,
        runtime.transition.previousTargetNormalizedTime,
        runtime.transition.targetNormalizedTime,
        targetState.loop,
        context.parameters,
        layerId,
        targetState.id,
        layerWeight,
        targetWeight,
        out
    );
    return out;
};

export const collectLayerClipActivities = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    context: AnimationMotionEvaluationContext,
    layerId: string,
    layerWeight: number,
    out: AnimationControllerClipActivity[] = []
): readonly AnimationControllerClipActivity[] => {
    if (layerWeight <= 0) {
        return out;
    }

    if (!runtime.transition) {
        const state = machine.states[runtime.currentStateIndex]!;
        return collectMotionClipActivities(
            state.motion,
            runtime.currentNormalizedTime,
            state.loop,
            context.parameters,
            layerId,
            state.id,
            layerWeight,
            1,
            out
        );
    }

    const sourceState = machine.states[runtime.transition.sourceStateIndex]!;
    const targetState = machine.states[runtime.transition.targetStateIndex]!;
    const transitionWeight = applyTransitionEasing(runtime.transition.easing, runtime.transition.progress);
    const sourceWeight = Math.max(0, 1 - transitionWeight);
    const targetWeight = Math.max(0, transitionWeight);

    collectMotionClipActivities(
        sourceState.motion,
        runtime.transition.sourceNormalizedTime,
        sourceState.loop,
        context.parameters,
        layerId,
        sourceState.id,
        layerWeight,
        sourceWeight,
        out
    );
    collectMotionClipActivities(
        targetState.motion,
        runtime.transition.targetNormalizedTime,
        targetState.loop,
        context.parameters,
        layerId,
        targetState.id,
        layerWeight,
        targetWeight,
        out
    );
    return out;
};
export const commitLayerRuntime = (runtime: AnimationLayerRuntime): void => {
    if (!runtime.transition || !runtime.transition.complete) {
        return;
    }
    runtime.currentStateIndex = runtime.transition.targetStateIndex;
    runtime.currentNormalizedTime = runtime.transition.targetNormalizedTime;
    runtime.previousNormalizedTime = runtime.transition.targetNormalizedTime;
    runtime.transition = null;
};
