import type {
    AnimationClipId,
    AnimationCurveId,
    AnimationIkJobId,
    AnimationLayerId,
    AnimationParameterId,
    AnimationRetargetProfileId,
    AnimationRigId,
    AnimationStateId,
} from './brands';
import type { AnimationMotionMatchDatabase } from './motion-matching';

export type AnimationTrackPath = 'translation' | 'rotation' | 'scale' | 'weights';
export type AnimationInterpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';
export type AnimationLayerBlendMode = 'override' | 'additive';
export type AnimationTransitionOperator = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type AnimationParameterKind = 'float' | 'int' | 'bool' | 'trigger';
export type AnimationIkSolver = 'fabrik' | 'ccd' | 'twoBone' | 'aim';
export type AnimationTransitionEasing = 'linear' | 'smoothStep' | 'easeIn' | 'easeOut' | 'easeInOut';
export type AnimationConditionMatch = 'all' | 'any';
export type AnimationInterruptMode = 'blocked' | 'open' | 'priorityGated';
export type AnimationInterruptHandoff = 'auto' | 'source' | 'target';
export type AnimationRetargetTranslationMode = 'none' | 'absolute' | 'scaled';
export type AnimationRetargetRotationMode = 'copy' | 'offset';
export type AnimationStateBehaviourPhase = 'enter' | 'update' | 'exit';
/**
 * How a layer that declares `syncSourceLayerId` tracks its source.
 * `stateAndTime` mirrors the source outright, `stateOnly` adopts just the state
 * so the layer keeps its own clock, `timeOnly` keeps its own state and borrows
 * the source clock.
 */
export type AnimationLayerSyncMode = 'stateAndTime' | 'stateOnly' | 'timeOnly';

export type AnimationVector2Tuple = readonly [number, number];
export type AnimationVector3Tuple = readonly [number, number, number];
export type AnimationQuaternionTuple = readonly [number, number, number, number];
export type AnimationMatrix4Tuple = readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
];

export type AnimationParameterValue<TKind extends AnimationParameterKind = AnimationParameterKind> =
    TKind extends 'bool' | 'trigger' ? boolean : number;

export interface AnimationBoneDefinition {
    readonly name: string;
    readonly parent?: string | number | null;
    readonly translation?: AnimationVector3Tuple;
    readonly rotation?: AnimationQuaternionTuple;
    readonly scale?: AnimationVector3Tuple;
    readonly inverseBindMatrix?: AnimationMatrix4Tuple | readonly number[] | Float32Array;
}

export interface AnimationRigDefinition {
    readonly id?: AnimationRigId | string;
    readonly bones: readonly AnimationBoneDefinition[];
}

export interface AnimationParameterDefinition<
    TName extends string = string,
    TKind extends AnimationParameterKind = AnimationParameterKind,
> {
    readonly name: TName;
    readonly kind: TKind;
    readonly defaultValue?: AnimationParameterValue<TKind>;
}

export type AnimationParameterMap<
    TDefinitions extends readonly AnimationParameterDefinition[] = readonly AnimationParameterDefinition[],
> = {
    readonly [TEntry in TDefinitions[number] as TEntry['name']]: TEntry extends AnimationParameterDefinition<
        string,
        infer TKind
    >
        ? AnimationParameterValue<TKind>
        : never;
};

export interface AnimationTrackBase<
    TPath extends AnimationTrackPath = AnimationTrackPath,
    TTarget extends string = string,
> {
    readonly target: TTarget;
    readonly path: TPath;
    readonly interpolation?: AnimationInterpolation;
    readonly times: readonly number[] | Float32Array;
    readonly values: readonly number[] | Float32Array;
    readonly keyframeCount?: number;
    readonly sampleStride?: number;
    readonly valueComponentCount?: number;
}

export type AnimationTrackDefinition =
    | AnimationTrackBase<'translation'>
    | AnimationTrackBase<'rotation'>
    | AnimationTrackBase<'scale'>
    | AnimationTrackBase<'weights'>;

export interface AnimationClipEventDefinition {
    readonly id?: string;
    readonly name: string;
    readonly time: number;
    readonly payload?: Readonly<Record<string, unknown>> | null;
    readonly tags?: readonly string[];
}

export interface AnimationFootContactDefinition {
    readonly bone: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly lockTranslationAxes?: readonly [boolean, boolean, boolean];
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AnimationMotionFeatureDefinition {
    readonly time: number;
    readonly trajectoryPosition?: AnimationVector3Tuple;
    readonly facingDirection?: AnimationVector3Tuple;
    readonly tags?: readonly string[];
    readonly costBias?: number;
}

export interface AnimationClipCompressionDefinition {
    readonly codec?: 'none' | 'keyframe-reduced';
    readonly positionTolerance?: number;
    readonly rotationToleranceDegrees?: number;
    readonly scaleTolerance?: number;
    readonly curveTolerance?: number;
    readonly preserveStepTracks?: boolean;
}

export interface AnimationClipStreamingDefinition {
    readonly mode?: 'resident' | 'streamed';
    readonly chunkDuration?: number;
    readonly preloadWindow?: number;
    readonly priority?: number;
    readonly sourceUri?: string;
    readonly catalogUri?: string;
    readonly catalog?: AnimationClipStreamingCatalogDefinition;
}

export interface AnimationClipStreamingChunkDefinition {
    readonly id?: string;
    readonly uri: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly byteOffset?: number;
    readonly byteLength?: number;
    readonly mimeType?: string;
}

export interface AnimationClipStreamingCatalogDefinition {
    readonly id?: string;
    readonly chunks: readonly AnimationClipStreamingChunkDefinition[];
}

export interface AnimationClipDefinition {
    readonly id: AnimationClipId | string;
    readonly duration?: number;
    readonly tracks: readonly AnimationTrackDefinition[];
    readonly events?: readonly AnimationClipEventDefinition[];
    readonly footContacts?: readonly AnimationFootContactDefinition[];
    readonly tags?: readonly string[];
    readonly features?: readonly AnimationMotionFeatureDefinition[];
    readonly compression?: AnimationClipCompressionDefinition;
    readonly streaming?: AnimationClipStreamingDefinition;
}

export interface AnimationClipEventOccurrence {
    readonly clipId: string;
    readonly id?: string;
    readonly name: string;
    readonly time: number;
    readonly normalizedTime: number;
    readonly payload?: Readonly<Record<string, unknown>> | null;
    readonly tags?: readonly string[];
}

export interface AnimationFootContactState {
    readonly bone: string;
    readonly active: boolean;
    readonly weight: number;
    readonly normalizedTime: number;
    readonly lockTranslationAxes?: readonly [boolean, boolean, boolean];
    readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AnimationRootMotionDefinition {
    readonly bone: string;
    readonly consume?: boolean;
    readonly projectTranslationAxes?: readonly [boolean, boolean, boolean];
    readonly extractRotation?: boolean;
}

export interface AnimationMotionClipDefinition {
    readonly kind: 'clip';
    readonly clipId: AnimationClipId | string;
    readonly timeScale?: number;
    readonly cycleOffset?: number;
}

/**
 * Motion-matching leaf: the runtime searches a pose database for the sample
 * that best matches the query parameters, then samples the owning clip.
 */
export interface AnimationMotionMatchingDefinition {
    readonly kind: 'motionMatching';
    readonly database: AnimationMotionMatchDatabase;
    /** Parameter holding the world-space trajectory X of the actor. */
    readonly trajectoryXParameter: AnimationParameterId | string;
    /** Parameter holding the world-space trajectory Z of the actor. */
    readonly trajectoryZParameter: AnimationParameterId | string;
    /** Parameter holding the world-space facing X of the actor. */
    readonly facingXParameter: AnimationParameterId | string;
    /** Parameter holding the world-space facing Z of the actor. */
    readonly facingZParameter: AnimationParameterId | string;
    /** Minimum seconds between two searches. */
    readonly reselectIntervalSeconds?: number;
    /** Score bonus for staying on the currently selected clip. */
    readonly continuityBias?: number;
}

export interface AnimationBlendTreeChild1D {
    readonly threshold: number;
    readonly motion: AnimationMotionDefinition;
}

export interface AnimationBlendTreeChild2D {
    readonly position: AnimationVector2Tuple;
    readonly motion: AnimationMotionDefinition;
}

export interface AnimationBlendTreeDirectChild {
    readonly motion: AnimationMotionDefinition;
    readonly parameter?: AnimationParameterId | string;
    readonly weight?: number;
}

export interface AnimationBlendTree1DDefinition {
    readonly kind: 'blend1d';
    readonly parameter: AnimationParameterId | string;
    readonly children: readonly AnimationBlendTreeChild1D[];
}

export interface AnimationBlendTree2DDefinition {
    readonly kind: 'blend2d';
    readonly parameterX: AnimationParameterId | string;
    readonly parameterY: AnimationParameterId | string;
    readonly mode?: 'inverse-distance' | 'freeform';
    readonly children: readonly AnimationBlendTreeChild2D[];
}

export interface AnimationBlendTreeDirectDefinition {
    readonly kind: 'direct';
    readonly children: readonly AnimationBlendTreeDirectChild[];
}

export interface AnimationBlendTreeAdditiveDefinition {
    readonly kind: 'additive';
    readonly base: AnimationMotionDefinition;
    readonly additive: AnimationMotionDefinition;
    readonly parameter?: AnimationParameterId | string;
    readonly weight?: number;
}

export type AnimationBlendTreeDefinition =
    | AnimationBlendTree1DDefinition
    | AnimationBlendTree2DDefinition
    | AnimationBlendTreeDirectDefinition
    | AnimationBlendTreeAdditiveDefinition;

export type AnimationMotionDefinition =
    | AnimationMotionClipDefinition
    | AnimationMotionMatchingDefinition
    | AnimationBlendTreeDefinition;

export type AnimationConditionDefinition =
    | {
          readonly kind: 'float' | 'int';
          readonly parameter: AnimationParameterId | string;
          readonly operator: AnimationTransitionOperator;
          readonly value: number;
      }
    | {
          readonly kind: 'bool';
          readonly parameter: AnimationParameterId | string;
          readonly value: boolean;
      }
    | {
          readonly kind: 'trigger';
          readonly parameter: AnimationParameterId | string;
      };

export interface AnimationTransitionDefinition {
    readonly to: AnimationStateId | string;
    readonly duration?: number;
    readonly offset?: number;
    readonly exitTime?: number;
    readonly fixedDuration?: boolean;
    readonly canInterrupt?: boolean;
    /** When the crossfade this transition started may be superseded. Wins over `canInterrupt`. */
    readonly interruptMode?: AnimationInterruptMode;
    /** Which side of a superseded crossfade becomes the next blend's source. */
    readonly interruptHandoff?: AnimationInterruptHandoff;
    readonly priority?: number;
    readonly easing?: AnimationTransitionEasing;
    /** How multiple conditions combine: every condition, or at least one. Defaults to 'all'. */
    readonly conditionMatch?: AnimationConditionMatch;
    readonly conditions?: readonly AnimationConditionDefinition[];
}

/**
 * Declarative work a state performs on itself. Actions are a closed set of
 * engine operations; there is no callback, script reference or code execution.
 */
export type AnimationStateBehaviourActionDefinition =
    | {
          readonly kind: 'writeParameter';
          readonly parameter: AnimationParameterId | string;
          readonly value: number | boolean;
      }
    | {
          readonly kind: 'pulseTrigger';
          readonly parameter: AnimationParameterId | string;
      }
    | {
          readonly kind: 'emitSignal';
          readonly signal: string;
          readonly payload?: Readonly<Record<string, unknown>> | null;
      };

export interface AnimationStateBehaviourDefinition {
    readonly id?: string;
    /** Which point of the state's lifetime this behaviour is dispatched at. */
    readonly phase: AnimationStateBehaviourPhase;
    readonly actions: readonly AnimationStateBehaviourActionDefinition[];
    readonly conditions?: readonly AnimationConditionDefinition[];
    /** How multiple conditions combine. Defaults to 'all'. */
    readonly conditionMatch?: AnimationConditionMatch;
    /** `phase: 'update'` only: minimum seconds between two dispatches. Defaults to 0. */
    readonly intervalSeconds?: number;
}

export interface AnimationStateDefinition {
    readonly id: AnimationStateId | string;
    /**
     * A state either plays a motion or refines its lifetime with a
     * `childMachine`. Exactly one of the two is required.
     */
    readonly motion?: AnimationMotionDefinition;
    /**
     * A machine owned by this state. While any of its states is active, this
     * state stays active too, so its transitions and behaviours bracket the
     * whole group instead of a single clip.
     */
    readonly childMachine?: AnimationStateMachineDefinition;
    readonly speed?: number;
    readonly loop?: boolean;
    readonly transitions?: readonly AnimationTransitionDefinition[];
    readonly behaviours?: readonly AnimationStateBehaviourDefinition[];
}

export interface AnimationStateMachineDefinition {
    readonly entryState: AnimationStateId | string;
    readonly states: readonly AnimationStateDefinition[];
    readonly anyStateTransitions?: readonly AnimationTransitionDefinition[];
}

export interface AnimationIkJobDefinition {
    readonly id: AnimationIkJobId | string;
    readonly solver: AnimationIkSolver;
    readonly rootBone: string;
    readonly tipBone: string;
    readonly targetPosition?: AnimationVector3Tuple;
    readonly targetRotation?: AnimationQuaternionTuple;
    readonly targetBone?: string;
    readonly precision?: number;
    readonly maxIterations?: number;
    readonly weight?: number;
    readonly preserveTipRotation?: boolean;
    /** World-space point the two-bone mid joint bends toward. */
    readonly polePosition?: AnimationVector3Tuple;
    /** Bone whose world position selects the two-bone bend plane. */
    readonly poleBone?: string;
    /** Minimum interior angle at the two-bone root, in degrees. */
    readonly minBendDegrees?: number;
    /** Maximum interior angle at the two-bone root, in degrees. */
    readonly maxBendDegrees?: number;
    /** Twist around the root-to-target axis, in degrees. */
    readonly twistDegrees?: number;
    /** World up used by the aim solver to remove roll. */
    readonly aimUp?: AnimationVector3Tuple;
    /** Maximum turn of the aim solver, in degrees. */
    readonly maxAimAngleDegrees?: number;
}

export interface AnimationIkLayerDefinition {
    readonly id: string;
    readonly weight?: number;
    readonly jobs: readonly AnimationIkJobDefinition[];
}

export interface AnimationLayerDefinition {
    readonly id: AnimationLayerId | string;
    readonly weight?: number;
    readonly mode?: AnimationLayerBlendMode;
    readonly boneMask?: readonly string[];
    readonly syncSourceLayerId?: AnimationLayerId | string;
    /** Defaults to `stateAndTime` when `syncSourceLayerId` is present. */
    readonly syncMode?: AnimationLayerSyncMode;
    /** Normalized fraction added to the borrowed source clock. Defaults to 0. */
    readonly syncTimeOffset?: number;
    readonly stateMachine: AnimationStateMachineDefinition;
    readonly ikLayers?: readonly AnimationIkLayerDefinition[];
}

export interface AnimationRetargetBoneMappingDefinition {
    readonly sourceBone: string;
    readonly targetBone: string;
    readonly translationMode?: AnimationRetargetTranslationMode;
    readonly rotationMode?: AnimationRetargetRotationMode;
    readonly scaleTranslation?: number;
}

export interface AnimationRetargetProfileDefinition {
    readonly id?: AnimationRetargetProfileId | string;
    readonly sourceRig: AnimationRigDefinition;
    readonly targetRig: AnimationRigDefinition;
    readonly mappings?: readonly AnimationRetargetBoneMappingDefinition[];
}

export interface AnimationControllerDefinition<
    TParameters extends readonly AnimationParameterDefinition[] = readonly AnimationParameterDefinition[],
> {
    readonly rig: AnimationRigDefinition;
    readonly clips: readonly AnimationClipDefinition[];
    readonly layers: readonly AnimationLayerDefinition[];
    readonly parameters?: TParameters;
    readonly rootMotion?: AnimationRootMotionDefinition | null;
}

export interface AnimationCurveBindingDefinition {
    readonly id: AnimationCurveId | string;
    readonly componentCount: number;
}

export interface AnimationRootMotionDelta {
    readonly translation: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
}

export interface AnimationControllerEvent extends AnimationClipEventOccurrence {
    readonly layerId: string;
    readonly stateId: string;
    readonly layerWeight: number;
    readonly motionWeight: number;
}

export interface AnimationStateSignal {
    readonly layerId: string;
    readonly stateId: string;
    readonly behaviourId: string;
    readonly phase: AnimationStateBehaviourPhase;
    readonly signal: string;
    readonly payload: Readonly<Record<string, unknown>> | null;
    readonly normalizedTime: number;
}

export interface AnimationControllerClipActivity {
    readonly clipId: string;
    readonly layerId: string;
    readonly stateId: string;
    readonly layerWeight: number;
    readonly motionWeight: number;
    readonly loop: boolean;
    readonly time: number;
    readonly normalizedTime: number;
}

export interface AnimationControllerLayerProfile {
    readonly layerId: string;
    readonly stateId: string;
    readonly normalizedTime: number;
    readonly weight: number;
    readonly transitioning: boolean;
    readonly transitionProgress?: number;
}

export interface AnimationControllerProfile {
    readonly evaluationTimeMs: number;
    readonly sampledTrackCount: number;
    readonly activeClipCount: number;
    readonly emittedEventCount: number;
    readonly rootMotionTranslationMagnitude: number;
    readonly rootMotionRotationW: number;
    readonly activeLayers: readonly AnimationControllerLayerProfile[];
}

export interface AnimationIkTarget {
    readonly position: AnimationVector3Tuple;
    readonly rotation?: AnimationQuaternionTuple;
}

export interface AnimationMotionMatchQuery {
    readonly requiredTags?: readonly string[];
    readonly excludedTags?: readonly string[];
    readonly desiredTrajectoryPosition?: AnimationVector3Tuple;
    readonly desiredFacingDirection?: AnimationVector3Tuple;
    readonly currentClipId?: string | null;
    readonly continuityBias?: number;
    readonly maxResults?: number;
}

export interface AnimationMotionMatchResult {
    readonly clipId: string;
    readonly time: number;
    readonly score: number;
    readonly tags: readonly string[];
}

export interface AnimationGroundingContactResult {
    readonly bone: string;
    readonly weight: number;
    readonly groundOffset: number;
    readonly lockTranslationAxes?: readonly [boolean, boolean, boolean];
}

export interface AnimationGroundingResult {
    readonly rootOffset: AnimationVector3Tuple;
    readonly contacts: readonly AnimationGroundingContactResult[];
}