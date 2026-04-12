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

export type AnimationTrackPath = 'translation' | 'rotation' | 'scale' | 'weights';
export type AnimationInterpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';
export type AnimationLayerBlendMode = 'override' | 'additive';
export type AnimationTransitionOperator = '<' | '<=' | '>' | '>=' | '==' | '!=';
export type AnimationParameterKind = 'float' | 'int' | 'bool' | 'trigger';
export type AnimationIkSolver = 'fabrik' | 'ccd';
export type AnimationRetargetTranslationMode = 'none' | 'absolute' | 'scaled';
export type AnimationRetargetRotationMode = 'copy' | 'offset';

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

export interface AnimationClipDefinition {
    readonly id: AnimationClipId | string;
    readonly duration?: number;
    readonly tracks: readonly AnimationTrackDefinition[];
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
    readonly priority?: number;
    readonly conditions?: readonly AnimationConditionDefinition[];
}

export interface AnimationStateDefinition {
    readonly id: AnimationStateId | string;
    readonly motion: AnimationMotionDefinition;
    readonly speed?: number;
    readonly loop?: boolean;
    readonly transitions?: readonly AnimationTransitionDefinition[];
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

export interface AnimationIkTarget {
    readonly position: AnimationVector3Tuple;
    readonly rotation?: AnimationQuaternionTuple;
}