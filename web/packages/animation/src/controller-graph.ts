export {
    cloneClipDefinition,
    cloneCondition,
    cloneParameterDefinition,
    cloneRigDefinition,
    cloneRootMotionDefinition,
} from './controller-clone';

export {
    type AnimationMotionInput,
    type AnimationTransitionInput,
    type AnimationStateInput,
    type AnimationStateMachineInput,
    type AnimationIkLayerInput,
    type AnimationLayerInput,
    type AnimationControllerInput,
    AnimationTransitionBuilder,
    AnimationStateBehaviourBuilder,
    AnimationStateBuilder,
    AnimationStateMachineBuilder,
    AnimationIkLayerBuilder,
    AnimationLayerBuilder,
    AnimationControllerBuilder,
    createAnimationTransition,
    createAnimationState,
    createAnimationGroupState,
    createAnimationStateBehaviour,
    createAnimationStateMachine,
    createAnimationIkLayer,
    createAnimationLayer,
    createAnimationController,
    buildAnimationTransitionDefinition,
    buildAnimationStateDefinition,
    buildAnimationStateMachineDefinition,
    buildAnimationIkLayerDefinition,
    buildAnimationLayerDefinition,
    buildAnimationControllerDefinition,
} from './controller-builder';

export {
    type AnimationControllerGraphDiagnostic,
    type AnimationControllerGraphValidationOptions,
    validateAnimationStateMachineDefinition,
    validateAnimationLayerDefinition,
    validateAnimationControllerDefinition,
} from './controller-validator';

import {
    createAnimationTransition,
    createAnimationState,
    createAnimationStateMachine,
    createAnimationIkLayer,
    createAnimationLayer,
    createAnimationController,
    buildAnimationTransitionDefinition,
    buildAnimationStateDefinition,
    buildAnimationStateMachineDefinition,
    buildAnimationIkLayerDefinition,
    buildAnimationLayerDefinition,
    buildAnimationControllerDefinition,
} from './controller-builder';
import {
    validateAnimationStateMachineDefinition,
    validateAnimationLayerDefinition,
    validateAnimationControllerDefinition,
} from './controller-validator';

export const AnimationControllerGraph = Object.freeze({
    transition: createAnimationTransition,
    state: createAnimationState,
    machine: createAnimationStateMachine,
    ikLayer: createAnimationIkLayer,
    layer: createAnimationLayer,
    controller: createAnimationController,
    buildTransition: buildAnimationTransitionDefinition,
    buildState: buildAnimationStateDefinition,
    buildMachine: buildAnimationStateMachineDefinition,
    buildIkLayer: buildAnimationIkLayerDefinition,
    buildLayer: buildAnimationLayerDefinition,
    buildController: buildAnimationControllerDefinition,
    validateMachine: validateAnimationStateMachineDefinition,
    validateLayer: validateAnimationLayerDefinition,
    validateController: validateAnimationControllerDefinition,
});
