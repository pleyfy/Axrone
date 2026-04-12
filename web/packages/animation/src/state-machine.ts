import { compileMotion, evaluateMotion, extractMotionRootDelta, resolveMotionDuration, type AnimationCompiledMotion, type AnimationMotionEvaluationContext } from './blend-tree';
import { AnimationStateMachineError, AnimationValidationError } from './errors';
import { AnimationParameterStore } from './parameters';
import { blendFrame, type AnimationFrame } from './pose';
import { quatIdentity, quatSlerp } from './math';
import { AnimationClip } from './clip';
import type {
    AnimationConditionDefinition,
    AnimationStateMachineDefinition,
    AnimationTransitionDefinition,
} from './types';

export interface AnimationCompiledTransition {
    readonly targetStateIndex: number;
    readonly duration: number;
    readonly offset: number;
    readonly exitTime?: number;
    readonly fixedDuration: boolean;
    readonly canInterrupt: boolean;
    readonly priority: number;
    readonly conditions: readonly AnimationConditionDefinition[];
}

export interface AnimationCompiledState {
    readonly id: string;
    readonly motion: AnimationCompiledMotion;
    readonly speed: number;
    readonly loop: boolean;
    readonly transitions: readonly AnimationCompiledTransition[];
}

export interface AnimationCompiledStateMachine {
    readonly entryStateIndex: number;
    readonly states: readonly AnimationCompiledState[];
    readonly anyStateTransitions: readonly AnimationCompiledTransition[];
    readonly stateIndexById: ReadonlyMap<string, number>;
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
}

export interface AnimationLayerRuntime {
    currentStateIndex: number;
    currentNormalizedTime: number;
    previousNormalizedTime: number;
    transition: AnimationTransitionRuntime | null;
}

const normalizePriority = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

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
                    return false;
            }
        }
        case 'bool':
            return parameters.get(condition.parameter) === condition.value;
        case 'trigger':
            return parameters.get(condition.parameter) === true;
        default:
            return false;
    }
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
    parameters: AnimationParameterStore
): AnimationCompiledTransition | undefined => {
    const state = machine.states[stateIndex]!;
    const candidates = [...machine.anyStateTransitions, ...state.transitions].sort(
        (left, right) => right.priority - left.priority
    );
    for (let index = 0; index < candidates.length; index += 1) {
        const transition = candidates[index]!;
        if (
            transition.exitTime !== undefined &&
            !crossedExitTime(previousNormalizedTime, currentNormalizedTime, transition.exitTime, state.loop)
        ) {
            continue;
        }
        let matches = true;
        for (let conditionIndex = 0; conditionIndex < transition.conditions.length; conditionIndex += 1) {
            if (!evaluateCondition(transition.conditions[conditionIndex]!, parameters)) {
                matches = false;
                break;
            }
        }
        if (matches) {
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

export const compileStateMachine = (
    definition: AnimationStateMachineDefinition,
    clips: ReadonlyMap<string, AnimationClip>
): AnimationCompiledStateMachine => {
    if (!definition || !Array.isArray(definition.states) || definition.states.length === 0) {
        throw new AnimationValidationError('Animation state machines require at least one state');
    }
    const stateIndexById = new Map<string, number>();
    for (let index = 0; index < definition.states.length; index += 1) {
        const state = definition.states[index]!;
        if (!state || typeof state.id !== 'string' || state.id.length === 0) {
            throw new AnimationValidationError('Animation states require a non-empty id');
        }
        if (stateIndexById.has(state.id)) {
            throw new AnimationValidationError(`Duplicate animation state '${state.id}'`);
        }
        stateIndexById.set(state.id, index);
    }
    const compileTransition = (transition: AnimationTransitionDefinition): AnimationCompiledTransition => {
        const targetStateIndex = stateIndexById.get(transition.to);
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
            priority: normalizePriority(transition.priority),
            conditions: Object.freeze([...(transition.conditions ?? [])]),
        });
    };

    const states = Object.freeze(
        definition.states.map((state) =>
            Object.freeze({
                id: state.id,
                motion: compileMotion(state.motion, clips),
                speed:
                    typeof state.speed === 'number' && Number.isFinite(state.speed) ? state.speed : 1,
                loop: state.loop ?? true,
                transitions: sortTransitions(
                    Object.freeze(
                        (state.transitions ?? []).map((transition: AnimationTransitionDefinition) =>
                            compileTransition(transition)
                        )
                    )
                ),
            } satisfies AnimationCompiledState)
        )
    );
    const entryStateIndex = stateIndexById.get(definition.entryState);
    if (entryStateIndex === undefined) {
        throw new AnimationValidationError(`Unknown animation entry state '${definition.entryState}'`);
    }

    return Object.freeze({
        entryStateIndex,
        states,
        anyStateTransitions: sortTransitions(
            Object.freeze(
                (definition.anyStateTransitions ?? []).map((transition: AnimationTransitionDefinition) =>
                    compileTransition(transition)
                )
            )
        ),
        stateIndexById,
    });
};

export const createLayerRuntime = (machine: AnimationCompiledStateMachine): AnimationLayerRuntime => ({
    currentStateIndex: machine.entryStateIndex,
    currentNormalizedTime: 0,
    previousNormalizedTime: 0,
    transition: null,
});

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
    offset: number = 0
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
    };
}

export const evaluateLayerRuntime = (
    machine: AnimationCompiledStateMachine,
    runtime: AnimationLayerRuntime,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame
): AnimationFrame => {
    if (!runtime.transition) {
        return evaluateMotion(
            machine.states[runtime.currentStateIndex]!.motion,
            runtime.currentNormalizedTime,
            context,
            out
        );
    }
    const sourceFrame = context.scratch.acquire();
    const targetFrame = context.scratch.acquire();
    evaluateMotion(
        machine.states[runtime.transition.sourceStateIndex]!.motion,
        runtime.transition.sourceNormalizedTime,
        context,
        sourceFrame
    );
    evaluateMotion(
        machine.states[runtime.transition.targetStateIndex]!.motion,
        runtime.transition.targetNormalizedTime,
        context,
        targetFrame
    );
    return blendFrame(out, sourceFrame, targetFrame, runtime.transition.progress);
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
        quatIdentity(outRotation, 0);
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
            outRotation
        );
        return;
    }

    const sourceTranslation = new Float32Array(3);
    const targetTranslation = new Float32Array(3);
    const sourceRotation = new Float32Array(4);
    const targetRotation = new Float32Array(4);
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
        sourceRotation
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
        targetRotation
    );

    outTranslation[0] =
        sourceTranslation[0]! +
        (targetTranslation[0]! - sourceTranslation[0]!) * runtime.transition.progress;
    outTranslation[1] =
        sourceTranslation[1]! +
        (targetTranslation[1]! - sourceTranslation[1]!) * runtime.transition.progress;
    outTranslation[2] =
        sourceTranslation[2]! +
        (targetTranslation[2]! - sourceTranslation[2]!) * runtime.transition.progress;
    quatIdentity(outRotation, 0);
    quatSlerp(outRotation, 0, sourceRotation, 0, targetRotation, 0, runtime.transition.progress);
}

export const commitLayerRuntime = (runtime: AnimationLayerRuntime): void => {
    if (!runtime.transition || !runtime.transition.complete) {
        return;
    }
    runtime.currentStateIndex = runtime.transition.targetStateIndex;
    runtime.currentNormalizedTime = runtime.transition.targetNormalizedTime;
    runtime.previousNormalizedTime = runtime.transition.targetNormalizedTime;
    runtime.transition = null;
};