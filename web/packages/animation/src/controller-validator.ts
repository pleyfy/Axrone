import { validateAnimationMotionDefinition } from './blend-graph';
import {
    buildAnimationControllerDefinition,
    buildAnimationLayerDefinition,
    buildAnimationStateMachineDefinition,
    type AnimationControllerInput,
    type AnimationLayerInput,
    type AnimationStateMachineInput,
} from './controller-builder';
import {
    ANIMATION_MAX_STATE_NESTING_DEPTH,
    ANIMATION_NESTED_STATE_SEPARATOR,
} from './state-machine';
import { isFiniteNumber } from './internal';
import type {
    AnimationConditionDefinition,
    AnimationConditionMatch,
    AnimationIkLayerDefinition,
    AnimationInterruptHandoff,
    AnimationInterruptMode,
    AnimationLayerBlendMode,
    AnimationLayerSyncMode,
    AnimationStateBehaviourActionDefinition,
    AnimationStateBehaviourDefinition,
    AnimationStateBehaviourPhase,
    AnimationStateDefinition,
    AnimationStateMachineDefinition,
    AnimationTransitionDefinition,
} from './types';

export interface AnimationControllerGraphDiagnostic {
    readonly code: string;
    readonly message: string;
    readonly path: string;
}

export interface AnimationControllerGraphValidationOptions {
    readonly knownClipIds?: readonly string[];
    readonly knownParameters?: readonly string[];
    readonly knownBones?: readonly string[];
}

const VALID_LAYER_MODES: readonly AnimationLayerBlendMode[] = ['override', 'additive'] as const;
const VALID_CONDITION_MATCH: readonly AnimationConditionMatch[] = ['all', 'any'] as const;
const VALID_INTERRUPT_MODES: readonly AnimationInterruptMode[] = ['blocked', 'open', 'priorityGated'] as const;
const VALID_INTERRUPT_HANDOFFS: readonly AnimationInterruptHandoff[] = ['auto', 'source', 'target'] as const;
const VALID_LAYER_SYNC_MODES: readonly AnimationLayerSyncMode[] = [
    'stateAndTime',
    'stateOnly',
    'timeOnly',
] as const;
const VALID_BEHAVIOUR_PHASES: readonly AnimationStateBehaviourPhase[] = [
    'enter',
    'update',
    'exit',
] as const;

const pushDiagnostic = (
    diagnostics: AnimationControllerGraphDiagnostic[],
    code: string,
    message: string,
    path: string
): void => {
    diagnostics.push(Object.freeze({ code, message, path }));
};

const validateCondition = (
    condition: AnimationConditionDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    path: string
): void => {
    if (
        options.knownParameters &&
        options.knownParameters.includes(String(condition.parameter)) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.parameter.unknown',
            `Unknown parameter '${condition.parameter}'`,
            `${path}.parameter`
        );
    }
    switch (condition.kind) {
        case 'float':
        case 'int':
            if (!isFiniteNumber(condition.value)) {
                pushDiagnostic(
                    diagnostics,
                    'animation.controller.condition.value.invalid',
                    'Numeric transition conditions require a finite value',
                    `${path}.value`
                );
            }
            break;
        case 'bool':
        case 'trigger':
            break;
        default:
            pushDiagnostic(
                diagnostics,
                'animation.controller.condition.kind.unsupported',
                `Unsupported condition kind '${String((condition as { kind?: unknown }).kind)}'`,
                path
            );
            break;
    }
};

const validateTransition = (
    transition: AnimationTransitionDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    knownStates: ReadonlySet<string>,
    path: string
): void => {
    if (knownStates.has(String(transition.to)) === false) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.unknown',
            `Unknown transition target '${transition.to}'`,
            `${path}.to`
        );
    }
    if (transition.duration !== undefined && !isFiniteNumber(transition.duration)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.duration.invalid',
            'Transition duration must be finite',
            `${path}.duration`
        );
    }
    if (transition.offset !== undefined && !isFiniteNumber(transition.offset)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.offset.invalid',
            'Transition offset must be finite',
            `${path}.offset`
        );
    }
    if (transition.exitTime !== undefined && !isFiniteNumber(transition.exitTime)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.exitTime.invalid',
            'Transition exitTime must be finite',
            `${path}.exitTime`
        );
    }
    if (transition.priority !== undefined && !isFiniteNumber(transition.priority)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.priority.invalid',
            'Transition priority must be finite',
            `${path}.priority`
        );
    }
    if (
        transition.conditionMatch !== undefined &&
        VALID_CONDITION_MATCH.includes(transition.conditionMatch) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.conditionMatch.invalid',
            `Unsupported transition condition match '${String(transition.conditionMatch)}'`,
            `${path}.conditionMatch`
        );
    }
    if (
        transition.interruptMode !== undefined &&
        VALID_INTERRUPT_MODES.includes(transition.interruptMode) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.interruptMode.invalid',
            `Unsupported transition interrupt mode '${String(transition.interruptMode)}'`,
            `${path}.interruptMode`
        );
    }
    if (
        transition.interruptHandoff !== undefined &&
        VALID_INTERRUPT_HANDOFFS.includes(transition.interruptHandoff) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.interruptHandoff.invalid',
            `Unsupported transition interrupt handoff '${String(transition.interruptHandoff)}'`,
            `${path}.interruptHandoff`
        );
    }
    if (transition.fixedDuration !== undefined && typeof transition.fixedDuration !== 'boolean') {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.fixedDuration.invalid',
            'Transition fixedDuration must be a boolean',
            `${path}.fixedDuration`
        );
    }
    if (transition.canInterrupt !== undefined && typeof transition.canInterrupt !== 'boolean') {
        pushDiagnostic(
            diagnostics,
            'animation.controller.transition.canInterrupt.invalid',
            'Transition canInterrupt must be a boolean',
            `${path}.canInterrupt`
        );
    }
    for (let index = 0; index < (transition.conditions?.length ?? 0); index += 1) {
        validateCondition(
            transition.conditions![index]!,
            diagnostics,
            options,
            `${path}.conditions[${index}]`
        );
    }
};

const validateBehaviourAction = (
    action: AnimationStateBehaviourActionDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    path: string
): void => {
    if (!action) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.behaviour.action.empty',
            'State behaviour actions may not be null',
            path
        );
        return;
    }
    switch (action.kind) {
        case 'writeParameter':
            if (typeof action.value !== 'number' && typeof action.value !== 'boolean') {
                pushDiagnostic(
                    diagnostics,
                    'animation.controller.state.behaviour.action.value.invalid',
                    "A 'writeParameter' action requires a number or boolean value",
                    `${path}.value`
                );
            }
            break;
        case 'pulseTrigger':
            break;
        case 'emitSignal':
            if (typeof action.signal !== 'string' || action.signal.length === 0) {
                pushDiagnostic(
                    diagnostics,
                    'animation.controller.state.behaviour.action.signal.empty',
                    "An 'emitSignal' action requires a non-empty signal",
                    `${path}.signal`
                );
            }
            break;
        default:
            pushDiagnostic(
                diagnostics,
                'animation.controller.state.behaviour.action.unsupported',
                `Unsupported state behaviour action '${String((action as { kind?: unknown }).kind)}'`,
                path
            );
            return;
    }
    if (
        action.kind !== 'emitSignal' &&
        options.knownParameters &&
        options.knownParameters.includes(String(action.parameter)) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.parameter.unknown',
            `Unknown parameter '${action.parameter}'`,
            `${path}.parameter`
        );
    }
};

const validateStateBehaviour = (
    behaviour: AnimationStateBehaviourDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    path: string
): void => {
    if (!behaviour) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.behaviour.empty',
            'State behaviours require a definition object',
            path
        );
        return;
    }
    if (VALID_BEHAVIOUR_PHASES.includes(behaviour.phase) === false) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.behaviour.phase.invalid',
            `Unsupported state behaviour phase '${String(behaviour.phase)}'`,
            `${path}.phase`
        );
    }
    if (!Array.isArray(behaviour.actions) || behaviour.actions.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.behaviour.actions.empty',
            'State behaviours require at least one action',
            `${path}.actions`
        );
    }
    if (
        behaviour.conditionMatch !== undefined &&
        VALID_CONDITION_MATCH.includes(behaviour.conditionMatch) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.behaviour.conditionMatch.invalid',
            `Unsupported state behaviour condition match '${String(behaviour.conditionMatch)}'`,
            `${path}.conditionMatch`
        );
    }
    if (
        behaviour.intervalSeconds !== undefined &&
        (!isFiniteNumber(behaviour.intervalSeconds) || behaviour.intervalSeconds < 0)
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.behaviour.interval.invalid',
            'State behaviour intervalSeconds must be a finite non-negative number',
            `${path}.intervalSeconds`
        );
    }
    for (let index = 0; index < (behaviour.actions?.length ?? 0); index += 1) {
        validateBehaviourAction(
            behaviour.actions![index]!,
            diagnostics,
            options,
            `${path}.actions[${index}]`
        );
    }
    for (let index = 0; index < (behaviour.conditions?.length ?? 0); index += 1) {
        validateCondition(
            behaviour.conditions![index]!,
            diagnostics,
            options,
            `${path}.conditions[${index}]`
        );
    }
};

const machineHasChildMachine = (machine: AnimationStateMachineDefinition): boolean => {
    for (let index = 0; index < (machine?.states?.length ?? 0); index += 1) {
        const state = machine.states![index]!;
        if (state?.childMachine) {
            return true;
        }
    }
    return false;
};

const validateState = (
    state: AnimationStateDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    knownStates: ReadonlySet<string>,
    path: string,
    outerKnownStates: ReadonlySet<string>,
    nested: boolean,
    depth: number
): void => {
    if (!String(state.id)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.id.empty',
            'States require a non-empty id',
            `${path}.id`
        );
    }
    if (nested && String(state.id).indexOf(ANIMATION_NESTED_STATE_SEPARATOR) >= 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.id.separator',
            `State ids may not contain '${ANIMATION_NESTED_STATE_SEPARATOR}' in a nested machine`,
            `${path}.id`
        );
    }
    if (state.speed !== undefined && !isFiniteNumber(state.speed)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.speed.invalid',
            'State speed must be finite',
            `${path}.speed`
        );
    }

    const hasChildMachine = state.childMachine !== undefined;
    if (hasChildMachine) {
        if (state.motion !== undefined) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.state.source.conflict',
                `State '${state.id}' declares both a motion and a child machine`,
                `${path}.childMachine`
            );
        }
        if (depth >= ANIMATION_MAX_STATE_NESTING_DEPTH) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.state.nesting.depth',
                `State nesting may not exceed ${ANIMATION_MAX_STATE_NESTING_DEPTH} levels`,
                `${path}.childMachine`
            );
        } else {
            collectMachineDiagnostics(
                state.childMachine,
                diagnostics,
                options,
                mergeVisible(knownStates, outerKnownStates),
                `${path}.childMachine`,
                depth + 1,
                true
            );
        }
    } else if (state.motion === undefined) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.motion.missing',
            `State '${state.id}' requires a motion or a child machine`,
            `${path}.motion`
        );
    }

    if (state.motion !== undefined) {
        const motionDiagnostics = validateAnimationMotionDefinition(state.motion, {
            knownClipIds: options.knownClipIds,
            knownParameters: options.knownParameters,
        });
        for (let index = 0; index < motionDiagnostics.length; index += 1) {
            const diagnostic = motionDiagnostics[index]!;
            pushDiagnostic(
                diagnostics,
                diagnostic.code.replace('animation.blendGraph', 'animation.controller.motion'),
                diagnostic.message,
                `${path}.motion${diagnostic.path === 'motion' ? '' : diagnostic.path.slice('motion'.length)}`
            );
        }
    }
    for (let index = 0; index < (state.transitions?.length ?? 0); index += 1) {
        validateTransition(
            state.transitions![index]!,
            diagnostics,
            options,
            knownStates,
            `${path}.transitions[${index}]`
        );
    }
    for (let index = 0; index < (state.behaviours?.length ?? 0); index += 1) {
        validateStateBehaviour(
            state.behaviours![index]!,
            diagnostics,
            options,
            `${path}.behaviours[${index}]`
        );
    }
};

const mergeVisible = (
    own: ReadonlySet<string>,
    outer: ReadonlySet<string>
): ReadonlySet<string> => {
    if (outer.size === 0) {
        return own;
    }
    const merged = new Set<string>(outer);
    own.forEach((id) => merged.add(id));
    return merged;
};

const collectMachineDiagnostics = (
    machine: AnimationStateMachineDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    outerKnownStates: ReadonlySet<string>,
    path: string,
    depth: number,
    nested: boolean
): void => {
    if (!machine || !Array.isArray(machine.states)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.states.missing',
            'State machines require a state list',
            `${path}.states`
        );
        return;
    }
    if (machine.states.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.states.empty',
            'State machines require at least one state',
            `${path}.states`
        );
    }

    const ownStates = new Set<string>();
    for (let index = 0; index < machine.states.length; index += 1) {
        const state = machine.states[index]!;
        if (!state || ownStates.has(String(state.id))) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.state.duplicate',
                `Duplicate state '${String(state?.id)}'`,
                `${path}.states[${index}].id`
            );
            continue;
        }
        ownStates.add(String(state.id));
    }
    const knownStates = mergeVisible(ownStates, outerKnownStates);

    if (knownStates.has(String(machine.entryState)) === false) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.state.entry.unknown',
            `Unknown entry state '${machine.entryState}'`,
            `${path}.entryState`
        );
    }

    for (let index = 0; index < machine.states.length; index += 1) {
        validateState(
            machine.states[index]!,
            diagnostics,
            options,
            knownStates,
            `${path}.states[${index}]`,
            outerKnownStates,
            nested,
            depth
        );
    }

    for (let index = 0; index < (machine.anyStateTransitions?.length ?? 0); index += 1) {
        validateTransition(
            machine.anyStateTransitions![index]!,
            diagnostics,
            options,
            knownStates,
            `${path}.anyStateTransitions[${index}]`
        );
    }
};

export const validateAnimationStateMachineDefinition = (
    stateMachine: AnimationStateMachineInput,
    options: AnimationControllerGraphValidationOptions = {}
): readonly AnimationControllerGraphDiagnostic[] => {
    const diagnostics: AnimationControllerGraphDiagnostic[] = [];
    const resolved = buildAnimationStateMachineDefinition(stateMachine);
    collectMachineDiagnostics(
        resolved,
        diagnostics,
        options,
        EMPTY_STATE_NAMES,
        'stateMachine',
        0,
        machineHasChildMachine(resolved)
    );
    return Object.freeze(diagnostics);
};

const EMPTY_STATE_NAMES: ReadonlySet<string> = new Set<string>();

const validateIkLayer = (
    layer: AnimationIkLayerDefinition,
    diagnostics: AnimationControllerGraphDiagnostic[],
    options: AnimationControllerGraphValidationOptions,
    path: string
): void => {
    if (!String(layer.id)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.ikLayer.id.empty',
            'IK layers require a non-empty id',
            `${path}.id`
        );
    }
    if (layer.weight !== undefined && !isFiniteNumber(layer.weight)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.ikLayer.weight.invalid',
            'IK layer weight must be finite',
            `${path}.weight`
        );
    }
    if (layer.jobs.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.ikLayer.jobs.empty',
            'IK layers require at least one job',
            `${path}.jobs`
        );
    }
    for (let index = 0; index < layer.jobs.length; index += 1) {
        const job = layer.jobs[index]!;
        if (
            options.knownBones &&
            options.knownBones.includes(job.rootBone) === false
        ) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.unknown',
                `Unknown bone '${job.rootBone}'`,
                `${path}.jobs[${index}].rootBone`
            );
        }
        if (
            options.knownBones &&
            options.knownBones.includes(job.tipBone) === false
        ) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.unknown',
                `Unknown bone '${job.tipBone}'`,
                `${path}.jobs[${index}].tipBone`
            );
        }
        if (
            typeof job.targetBone === 'string' &&
            options.knownBones &&
            options.knownBones.includes(job.targetBone) === false
        ) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.unknown',
                `Unknown bone '${job.targetBone}'`,
                `${path}.jobs[${index}].targetBone`
            );
        }
    }
};

export const validateAnimationLayerDefinition = (
    layer: AnimationLayerInput,
    options: AnimationControllerGraphValidationOptions = {}
): readonly AnimationControllerGraphDiagnostic[] => {
    const diagnostics: AnimationControllerGraphDiagnostic[] = [];
    const resolved = buildAnimationLayerDefinition(layer);

    if (!String(resolved.id)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.id.empty',
            'Layers require a non-empty id',
            'layer.id'
        );
    }
    if (resolved.weight !== undefined && !isFiniteNumber(resolved.weight)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.weight.invalid',
            'Layer weight must be finite',
            'layer.weight'
        );
    }
    if (resolved.mode !== undefined && VALID_LAYER_MODES.includes(resolved.mode) === false) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.mode.invalid',
            `Unsupported layer mode '${String(resolved.mode)}'`,
            'layer.mode'
        );
    }
    for (let index = 0; index < (resolved.boneMask?.length ?? 0); index += 1) {
        const bone = resolved.boneMask![index]!;
        if (options.knownBones && options.knownBones.includes(bone) === false) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.unknown',
                `Unknown bone '${bone}'`,
                `layer.boneMask[${index}]`
            );
        }
    }
    if (
        resolved.syncMode !== undefined &&
        VALID_LAYER_SYNC_MODES.includes(resolved.syncMode) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.syncMode.invalid',
            `Unsupported layer sync mode '${String(resolved.syncMode)}'`,
            'layer.syncMode'
        );
    }
    if (resolved.syncTimeOffset !== undefined && !isFiniteNumber(resolved.syncTimeOffset)) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.syncTimeOffset.invalid',
            'Layer syncTimeOffset must be finite',
            'layer.syncTimeOffset'
        );
    }
    if (
        resolved.syncSourceLayerId === undefined &&
        (resolved.syncMode !== undefined || resolved.syncTimeOffset !== undefined)
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.sync.source.missing',
            'Sync options require a syncSourceLayerId to be meaningful',
            'layer.syncMode'
        );
    }

    diagnostics.push(
        ...validateAnimationStateMachineDefinition(resolved.stateMachine, options).map((diagnostic) =>
            Object.freeze({
                code: diagnostic.code,
                message: diagnostic.message,
                path: `layer.${diagnostic.path}`,
            })
        )
    );

    for (let index = 0; index < (resolved.ikLayers?.length ?? 0); index += 1) {
        validateIkLayer(resolved.ikLayers![index]!, diagnostics, options, `layer.ikLayers[${index}]`);
    }

    return Object.freeze(diagnostics);
};

export const validateAnimationControllerDefinition = (
    controller: AnimationControllerInput,
    options: AnimationControllerGraphValidationOptions = {}
): readonly AnimationControllerGraphDiagnostic[] => {
    const diagnostics: AnimationControllerGraphDiagnostic[] = [];
    const resolved = buildAnimationControllerDefinition(controller);
    const knownClipIds = options.knownClipIds ?? resolved.clips.map((clip) => String(clip.id));
    const knownParameters =
        options.knownParameters ?? resolved.parameters?.map((parameter) => parameter.name) ?? [];
    const knownBones = options.knownBones ?? resolved.rig.bones.map((bone) => bone.name);

    if (resolved.rig.bones.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.rig.bones.empty',
            'Controllers require at least one rig bone',
            'controller.rig.bones'
        );
    }
    const seenBones = new Set<string>();
    for (let index = 0; index < resolved.rig.bones.length; index += 1) {
        const bone = resolved.rig.bones[index]!;
        if (!bone.name) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.name.empty',
                'Rig bones require a non-empty name',
                `controller.rig.bones[${index}].name`
            );
        }
        if (seenBones.has(bone.name)) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.bone.duplicate',
                `Duplicate rig bone '${bone.name}'`,
                `controller.rig.bones[${index}].name`
            );
        }
        seenBones.add(bone.name);
    }

    if (resolved.clips.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.clips.empty',
            'Controllers require at least one clip',
            'controller.clips'
        );
    }
    const seenClips = new Set<string>();
    for (let index = 0; index < resolved.clips.length; index += 1) {
        const clipId = String(resolved.clips[index]!.id);
        if (seenClips.has(clipId)) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.clip.duplicate',
                `Duplicate clip '${clipId}'`,
                `controller.clips[${index}].id`
            );
        }
        seenClips.add(clipId);
    }

    const seenParameters = new Set<string>();
    for (let index = 0; index < (resolved.parameters?.length ?? 0); index += 1) {
        const parameter = resolved.parameters![index]!;
        if (seenParameters.has(parameter.name)) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.parameter.duplicate',
                `Duplicate parameter '${parameter.name}'`,
                `controller.parameters[${index}].name`
            );
        }
        seenParameters.add(parameter.name);
    }

    if (resolved.layers.length === 0) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layers.empty',
            'Controllers require at least one layer',
            'controller.layers'
        );
    }
    const seenLayers = new Set<string>();
    for (let index = 0; index < resolved.layers.length; index += 1) {
        const layer = resolved.layers[index]!;
        if (seenLayers.has(String(layer.id))) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.layer.duplicate',
                `Duplicate layer '${layer.id}'`,
                `controller.layers[${index}].id`
            );
        }
        seenLayers.add(String(layer.id));

        diagnostics.push(
            ...validateAnimationLayerDefinition(layer, {
                knownClipIds,
                knownParameters,
                knownBones,
            }).map((diagnostic) =>
                Object.freeze({
                    code: diagnostic.code,
                    message: diagnostic.message,
                    path: diagnostic.path.replace(/^layer\./, `controller.layers[${index}].`),
                })
            )
        );
    }

    const layerIndexById = new Map<string, number>();
    for (let index = 0; index < resolved.layers.length; index += 1) {
        layerIndexById.set(String(resolved.layers[index]!.id), index);
    }
    const syncEdges = new Map<string, string>();
    for (let index = 0; index < resolved.layers.length; index += 1) {
        const layer = resolved.layers[index]!;
        if (layer.syncSourceLayerId === undefined) {
            continue;
        }
        const sourceId = String(layer.syncSourceLayerId);
        const layerId = String(layer.id);
        if (sourceId === layerId) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.layer.sync.self',
                `Layer '${layerId}' cannot sync to itself`,
                `controller.layers[${index}].syncSourceLayerId`
            );
            continue;
        }
        if (seenLayers.has(sourceId) === false) {
            pushDiagnostic(
                diagnostics,
                'animation.controller.layer.sync.unknown',
                `Layer '${layerId}' syncs to unknown layer '${sourceId}'`,
                `controller.layers[${index}].syncSourceLayerId`
            );
            continue;
        }
        syncEdges.set(layerId, sourceId);
    }
    const cyclicLayers = new Set<string>();
    syncEdges.forEach((_sourceId, startId) => {
        const walked = new Set<string>();
        let cursor: string | undefined = startId;
        while (cursor !== undefined) {
            if (walked.has(cursor)) {
                walked.forEach((member) => cyclicLayers.add(member));
                return;
            }
            walked.add(cursor);
            cursor = syncEdges.get(cursor);
        }
    });
    cyclicLayers.forEach((layerId) => {
        pushDiagnostic(
            diagnostics,
            'animation.controller.layer.sync.cycle',
            `Layer '${layerId}' takes part in a synchronization cycle`,
            `controller.layers[${layerIndexById.get(layerId) ?? 0}].syncSourceLayerId`
        );
    });

    if (
        resolved.rootMotion &&
        knownBones.includes(resolved.rootMotion.bone) === false
    ) {
        pushDiagnostic(
            diagnostics,
            'animation.controller.rootMotion.bone.unknown',
            `Unknown root motion bone '${resolved.rootMotion.bone}'`,
            'controller.rootMotion.bone'
        );
    }

    return Object.freeze(diagnostics);
};
