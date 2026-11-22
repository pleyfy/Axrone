import type { Brand } from '@axrone/utility';

export const MAX_BLEND_DEPTH = 16 as const;
export type ValidBlendDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

declare const BlendWeightBrand: unique symbol;
export type BlendWeight = Brand<number, 'BlendWeight'>;

declare const NormalizedTimeBrand: unique symbol;
export type NormalizedTime = Brand<number, 'NormalizedTime'>;

export const asBlendWeight = (value: number): BlendWeight => {
    const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
    if (!Number.isFinite(clamped)) {
        return 0 as BlendWeight;
    }
    return clamped as BlendWeight;
};

export const asNormalizedTime = (value: number): NormalizedTime => {
    const clamped = value < 0 ? 0 : value > 1 ? 1 : value;
    if (!Number.isFinite(clamped)) {
        return 0 as NormalizedTime;
    }
    return clamped as NormalizedTime;
};

export const unblendWeight = (weight: BlendWeight): number => weight as number;
export const unnormalizedTime = (time: NormalizedTime): number => time as number;

export type DiagnosticCategory =
    | 'clip'
    | 'blendGraph'
    | 'parameter'
    | 'weight'
    | 'threshold'
    | 'position'
    | 'kind';

export type DiagnosticSeverity =
    | 'unknown'
    | 'empty'
    | 'invalid'
    | 'unsupported'
    | 'duplicate';

export type DiagnosticCode = `animation.${DiagnosticCategory}.${DiagnosticSeverity}`;

export type BlendMotionKind = 'clip' | 'blend1d' | 'blend2d' | 'direct' | 'additive' | 'motionMatching';

export interface AnimationCompiledClipMotion {
    readonly kind: 'clip';
    readonly clip: import('./clip').AnimationClip;
    readonly timeScale: number;
    readonly cycleOffset: number;
}

/**
 * Mutable selection state of a motion-matching leaf. The state belongs to the
 * compiled motion, so every consumer of the graph - duration, evaluation,
 * events, root delta - observes the same selection.
 */
export interface AnimationMotionMatchingSelection {
    clipId: string | null;
    clip: import('./clip').AnimationClip | null;
    startTime: number;
    duration: number;
    lastNormalizedTime: number;
    hasSelection: boolean;
}

export interface AnimationCompiledMotionMatchingMotion {
    readonly kind: 'motionMatching';
    readonly database: import('./motion-matching').AnimationMotionMatchDatabase;
    readonly clips: ReadonlyMap<string, import('./clip').AnimationClip>;
    readonly trajectoryXParameter: string;
    readonly trajectoryZParameter: string;
    readonly facingXParameter: string;
    readonly facingZParameter: string;
    readonly reselectIntervalSeconds: number;
    readonly continuityBias: number;
    readonly state: AnimationMotionMatchingSelection;
}

export interface AnimationCompiledBlend1DChild {
    readonly threshold: number;
    readonly motion: AnimationCompiledMotion;
}

export interface AnimationCompiledBlend1DMotion {
    readonly kind: 'blend1d';
    readonly parameter: string;
    readonly children: readonly AnimationCompiledBlend1DChild[];
}

export interface AnimationCompiledBlend2DChild {
    readonly x: number;
    readonly y: number;
    readonly motion: AnimationCompiledMotion;
}

export interface AnimationCompiledBlend2DMotion {
    readonly kind: 'blend2d';
    readonly parameterX: string;
    readonly parameterY: string;
    readonly children: readonly AnimationCompiledBlend2DChild[];
    readonly mode: 'inverse-distance' | 'freeform';
    readonly triangles: Int32Array;
}

export interface AnimationCompiledDirectChild {
    readonly parameter: string | undefined;
    readonly weight: number;
    readonly motion: AnimationCompiledMotion;
}

export interface AnimationCompiledDirectMotion {
    readonly kind: 'direct';
    readonly children: readonly AnimationCompiledDirectChild[];
}

export interface AnimationCompiledAdditiveMotion {
    readonly kind: 'additive';
    readonly base: AnimationCompiledMotion;
    readonly additive: AnimationCompiledMotion;
    readonly parameter: string | undefined;
    readonly weight: number;
}

export type AnimationCompiledMotion =
    | AnimationCompiledClipMotion
    | AnimationCompiledBlend1DMotion
    | AnimationCompiledBlend2DMotion
    | AnimationCompiledDirectMotion
    | AnimationCompiledAdditiveMotion
    | AnimationCompiledMotionMatchingMotion;

export type BlendMotionOfKind<K extends BlendMotionKind> = Extract<AnimationCompiledMotion, { kind: K }>;

export type BlendMotionVisitor<TContext, TResult> = {
    [K in BlendMotionKind as `visit${Capitalize<K>}`]: (
        motion: BlendMotionOfKind<K>,
        context: TContext
    ) => TResult;
};

export const BLEND_EPSILON = 1e-6;
export const BLEND_DISTANCE_EPSILON_SQ = 1e-12;
export const SLERP_LINEAR_THRESHOLD = 0.9995;
export const BLEND1D_LINEAR_SCAN_LIMIT = 8;
