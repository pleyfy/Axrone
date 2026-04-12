import { ObjectPool } from '@axrone/utility';
import { AnimationStateMachineError, AnimationValidationError } from './errors';
import { quatDot, quatIdentity, quatMultiply, quatNormalize, quatSlerp } from './math';
import { AnimationParameterStore } from './parameters';
import { applyAdditiveFrame, blendFrame, blendWeightedFrames, AnimationFrame, type AnimationCurveLayout } from './pose';
import type { AnimationRig } from './rig';
import { AnimationClip } from './clip';
import type { AnimationBlendTreeDefinition, AnimationMotionDefinition } from './types';

export interface AnimationMotionEvaluationContext {
    readonly rig: AnimationRig;
    readonly parameters: AnimationParameterStore;
    readonly restFrame: AnimationFrame;
    readonly scratch: AnimationScratchPool;
}

export class AnimationScratchPool {
    private readonly _framePool: ObjectPool<AnimationFrame>;
    private readonly _activeFrames: AnimationFrame[] = [];

    constructor(
        private readonly _rig: AnimationRig,
        private readonly _curveLayout: AnimationCurveLayout,
        private readonly _curveDefaults?: ArrayLike<number>
    ) {
        this._framePool = new ObjectPool<AnimationFrame>({
            initialCapacity: 8,
            maxCapacity: 256,
            minFree: 8,
            expansionStrategy: 'multiplicative',
            expansionFactor: 1.5,
            allocationStrategy: 'least-recently-used',
            evictionPolicy: 'lru',
            resetOnRecycle: true,
            preallocate: false,
            autoExpand: true,
            enableMetrics: false,
            name: 'AnimationScratchPool',
            factory: () => new AnimationFrame(this._rig, this._curveLayout),
            resetHandler: (frame) => {
                frame.reset(this._rig, this._curveDefaults);
            },
        });
    }

    reset(): void {
        for (let index = this._activeFrames.length - 1; index >= 0; index -= 1) {
            this._framePool.release(this._activeFrames[index]!);
        }
        this._activeFrames.length = 0;
    }

    acquire(): AnimationFrame {
        const frame = this._framePool.acquire();
        frame.reset(this._rig, this._curveDefaults);
        this._activeFrames.push(frame);
        return frame;
    }
}

export type AnimationCompiledMotion =
    | {
          readonly kind: 'clip';
          readonly clip: AnimationClip;
          readonly timeScale: number;
          readonly cycleOffset: number;
      }
    | {
          readonly kind: 'blend1d';
          readonly parameter: string;
          readonly children: readonly {
              readonly threshold: number;
              readonly motion: AnimationCompiledMotion;
          }[];
      }
    | {
          readonly kind: 'blend2d';
          readonly parameterX: string;
          readonly parameterY: string;
          readonly children: readonly {
              readonly x: number;
              readonly y: number;
              readonly motion: AnimationCompiledMotion;
          }[];
      }
    | {
          readonly kind: 'direct';
          readonly children: readonly {
              readonly parameter?: string;
              readonly weight: number;
              readonly motion: AnimationCompiledMotion;
          }[];
      }
    | {
          readonly kind: 'additive';
          readonly base: AnimationCompiledMotion;
          readonly additive: AnimationCompiledMotion;
          readonly parameter?: string;
          readonly weight: number;
      };

const resolveMotionTime = (
    normalizedTime: number,
    duration: number,
    cycleOffset: number,
    loop: boolean
): number => {
    if (duration <= 0) {
        return 0;
    }
    const offsetTime = normalizedTime + cycleOffset;
    if (!loop) {
        const normalized = Math.max(0, Math.min(1, offsetTime));
        return normalized * duration;
    }
    const wrapped = offsetTime % 1;
    const normalized = wrapped < 0 ? wrapped + 1 : wrapped;
    return normalized * duration;
};

const compileBlendTree = (
    definition: AnimationBlendTreeDefinition,
    clips: ReadonlyMap<string, AnimationClip>
): AnimationCompiledMotion => {
    switch (definition.kind) {
        case 'blend1d':
            if (definition.children.length === 0) {
                throw new AnimationValidationError('1D blend trees require at least one child');
            }
            return Object.freeze({
                kind: 'blend1d',
                parameter: definition.parameter,
                children: Object.freeze(
                    [...definition.children]
                        .map((child) =>
                            Object.freeze({
                                threshold: child.threshold,
                                motion: compileMotion(child.motion, clips),
                            })
                        )
                        .sort((left, right) => left.threshold - right.threshold)
                ),
            });
        case 'blend2d':
            if (definition.children.length === 0) {
                throw new AnimationValidationError('2D blend trees require at least one child');
            }
            return Object.freeze({
                kind: 'blend2d',
                parameterX: definition.parameterX,
                parameterY: definition.parameterY,
                children: Object.freeze(
                    definition.children.map((child) =>
                        Object.freeze({
                            x: child.position[0],
                            y: child.position[1],
                            motion: compileMotion(child.motion, clips),
                        })
                    )
                ),
            });
        case 'direct':
            if (definition.children.length === 0) {
                throw new AnimationValidationError('Direct blend trees require at least one child');
            }
            return Object.freeze({
                kind: 'direct',
                children: Object.freeze(
                    definition.children.map((child) =>
                        Object.freeze({
                            parameter: child.parameter,
                            weight: child.weight ?? 1,
                            motion: compileMotion(child.motion, clips),
                        })
                    )
                ),
            });
        case 'additive':
            return Object.freeze({
                kind: 'additive',
                base: compileMotion(definition.base, clips),
                additive: compileMotion(definition.additive, clips),
                parameter: definition.parameter,
                weight: definition.weight ?? 1,
            });
        default:
            throw new AnimationValidationError(`Unsupported blend tree '${String((definition as { kind?: unknown }).kind)}'`);
    }
};

export const compileMotion = (
    definition: AnimationMotionDefinition,
    clips: ReadonlyMap<string, AnimationClip>
): AnimationCompiledMotion => {
    if (definition.kind === 'clip') {
        const clip = clips.get(definition.clipId);
        if (!clip) {
            throw new AnimationValidationError(`Unknown animation clip '${definition.clipId}'`);
        }
        return Object.freeze({
            kind: 'clip',
            clip,
            timeScale: definition.timeScale ?? 1,
            cycleOffset: definition.cycleOffset ?? 0,
        });
    }
    return compileBlendTree(definition, clips);
};

const resolveDirectChildWeight = (
    parameters: AnimationParameterStore,
    parameter: string | undefined,
    weight: number
): number => {
    if (!parameter) {
        return Math.max(0, weight);
    }
    const value = parameters.get(parameter);
    return typeof value === 'number' ? Math.max(0, value * weight) : value ? Math.max(0, weight) : 0;
};

const resolveBlend2DWeights = (
    x: number,
    y: number,
    children: AnimationCompiledMotion extends never ? never : readonly {
        readonly x: number;
        readonly y: number;
        readonly motion: AnimationCompiledMotion;
    }[]
): number[] => {
    const distances = new Array<number>(children.length);
    let total = 0;
    for (let index = 0; index < children.length; index += 1) {
        const child = children[index]!;
        const dx = x - child.x;
        const dy = y - child.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared <= 1e-12) {
            const result = new Array<number>(children.length).fill(0);
            result[index] = 1;
            return result;
        }
        const inverseDistance = 1 / Math.sqrt(distanceSquared);
        distances[index] = inverseDistance;
        total += inverseDistance;
    }
    if (total <= 0) {
        return new Array<number>(children.length).fill(1 / Math.max(1, children.length));
    }
    return distances.map((value) => value / total);
};

export const resolveMotionDuration = (
    motion: AnimationCompiledMotion,
    parameters: AnimationParameterStore
): number => {
    switch (motion.kind) {
        case 'clip':
            return motion.clip.duration / Math.max(Math.abs(motion.timeScale), 1e-6);
        case 'blend1d': {
            const parameterValue = parameters.get(motion.parameter);
            const input = typeof parameterValue === 'number' ? parameterValue : parameterValue ? 1 : 0;
            if (motion.children.length === 1) {
                return resolveMotionDuration(motion.children[0]!.motion, parameters);
            }
            if (input <= motion.children[0]!.threshold) {
                return resolveMotionDuration(motion.children[0]!.motion, parameters);
            }
            for (let index = 0; index < motion.children.length - 1; index += 1) {
                const left = motion.children[index]!;
                const right = motion.children[index + 1]!;
                if (input > right.threshold) {
                    continue;
                }
                const alpha = (input - left.threshold) / Math.max(1e-6, right.threshold - left.threshold);
                return (
                    resolveMotionDuration(left.motion, parameters) * (1 - alpha) +
                    resolveMotionDuration(right.motion, parameters) * alpha
                );
            }
            return resolveMotionDuration(motion.children[motion.children.length - 1]!.motion, parameters);
        }
        case 'blend2d': {
            const parameterX = parameters.get(motion.parameterX);
            const parameterY = parameters.get(motion.parameterY);
            const weights = resolveBlend2DWeights(
                typeof parameterX === 'number' ? parameterX : parameterX ? 1 : 0,
                typeof parameterY === 'number' ? parameterY : parameterY ? 1 : 0,
                motion.children
            );
            let total = 0;
            for (let index = 0; index < motion.children.length; index += 1) {
                total += resolveMotionDuration(motion.children[index]!.motion, parameters) * weights[index]!;
            }
            return total;
        }
        case 'direct': {
            let weightedDuration = 0;
            let totalWeight = 0;
            for (let index = 0; index < motion.children.length; index += 1) {
                const child = motion.children[index]!;
                const weight = resolveDirectChildWeight(parameters, child.parameter, child.weight);
                if (weight <= 0) {
                    continue;
                }
                totalWeight += weight;
                weightedDuration += resolveMotionDuration(child.motion, parameters) * weight;
            }
            return totalWeight > 0 ? weightedDuration / totalWeight : 0;
        }
        case 'additive':
            return resolveMotionDuration(motion.base, parameters);
        default:
            throw new AnimationStateMachineError(`Unsupported motion kind '${String((motion as { kind?: unknown }).kind)}'`);
    }
};

export const evaluateMotion = (
    motion: AnimationCompiledMotion,
    normalizedTime: number,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame,
    loop: boolean = true
): AnimationFrame => {
    switch (motion.kind) {
        case 'clip': {
            out.reset(context.rig, context.restFrame.curves.values);
            const time = resolveMotionTime(
                normalizedTime * motion.timeScale,
                motion.clip.duration,
                motion.cycleOffset,
                loop
            );
            return motion.clip.sampleTime(time, out);
        }
        case 'blend1d': {
            const parameterValue = context.parameters.get(motion.parameter);
            const input = typeof parameterValue === 'number' ? parameterValue : parameterValue ? 1 : 0;
            if (motion.children.length === 1 || input <= motion.children[0]!.threshold) {
                return evaluateMotion(motion.children[0]!.motion, normalizedTime, context, out, loop);
            }
            for (let index = 0; index < motion.children.length - 1; index += 1) {
                const left = motion.children[index]!;
                const right = motion.children[index + 1]!;
                if (input > right.threshold) {
                    continue;
                }
                const alpha =
                    (input - left.threshold) / Math.max(1e-6, right.threshold - left.threshold);
                const leftFrame = context.scratch.acquire();
                const rightFrame = context.scratch.acquire();
                evaluateMotion(left.motion, normalizedTime, context, leftFrame, loop);
                evaluateMotion(right.motion, normalizedTime, context, rightFrame, loop);
                return blendFrame(out, leftFrame, rightFrame, alpha);
            }
            return evaluateMotion(
                motion.children[motion.children.length - 1]!.motion,
                normalizedTime,
                context,
                out,
                loop
            );
        }
        case 'blend2d': {
            const parameterX = context.parameters.get(motion.parameterX);
            const parameterY = context.parameters.get(motion.parameterY);
            const weights = resolveBlend2DWeights(
                typeof parameterX === 'number' ? parameterX : parameterX ? 1 : 0,
                typeof parameterY === 'number' ? parameterY : parameterY ? 1 : 0,
                motion.children
            );
            const frames = new Array<AnimationFrame>(motion.children.length);
            for (let index = 0; index < motion.children.length; index += 1) {
                const frame = context.scratch.acquire();
                evaluateMotion(motion.children[index]!.motion, normalizedTime, context, frame, loop);
                frames[index] = frame;
            }
            return blendWeightedFrames(out, frames, weights, context.restFrame);
        }
        case 'direct': {
            const frames: AnimationFrame[] = [];
            const weights: number[] = [];
            for (let index = 0; index < motion.children.length; index += 1) {
                const child = motion.children[index]!;
                const weight = resolveDirectChildWeight(context.parameters, child.parameter, child.weight);
                if (weight <= 0) {
                    continue;
                }
                const frame = context.scratch.acquire();
                evaluateMotion(child.motion, normalizedTime, context, frame, loop);
                frames.push(frame);
                weights.push(weight);
            }
            if (frames.length === 0) {
                return out.copyFrom(context.restFrame);
            }
            if (frames.length === 1) {
                return out.copyFrom(frames[0]!);
            }
            return blendWeightedFrames(out, frames, weights, context.restFrame);
        }
        case 'additive': {
            const baseFrame = context.scratch.acquire();
            const additiveFrame = context.scratch.acquire();
            evaluateMotion(motion.base, normalizedTime, context, baseFrame);
            evaluateMotion(motion.additive, normalizedTime, context, additiveFrame);
            const parameterWeight = motion.parameter ? context.parameters.get(motion.parameter) : motion.weight;
            const resolvedWeight =
                typeof parameterWeight === 'number'
                    ? parameterWeight
                    : parameterWeight
                      ? motion.weight
                      : 0;
            return applyAdditiveFrame(out, baseFrame, additiveFrame, context.restFrame, resolvedWeight);
        }
        default:
            throw new AnimationStateMachineError(`Unsupported motion kind '${String((motion as { kind?: unknown }).kind)}'`);
    }
};

const blendRootDelta = (
    rotations: readonly Float32Array[],
    weights: readonly number[],
    outRotation: Float32Array
): void => {
    let qx = 0;
    let qy = 0;
    let qz = 0;
    let qw = 0;
    let total = 0;
    let reference = -1;
    for (let index = 0; index < rotations.length; index += 1) {
        const weight = Math.max(0, weights[index] ?? 0);
        if (weight <= 0) {
            continue;
        }
        total += weight;
        const rotation = rotations[index]!;
        const sign = reference >= 0 && quatDot(rotations[reference]!, 0, rotation, 0) < 0 ? -1 : 1;
        qx += rotation[0]! * weight * sign;
        qy += rotation[1]! * weight * sign;
        qz += rotation[2]! * weight * sign;
        qw += rotation[3]! * weight * sign;
        if (reference < 0) {
            reference = index;
        }
    }
    if (total <= 0) {
        quatIdentity(outRotation, 0);
        return;
    }
    outRotation[0] = qx / total;
    outRotation[1] = qy / total;
    outRotation[2] = qz / total;
    outRotation[3] = qw / total;
    quatNormalize(outRotation, 0, outRotation, 0);
};

export const extractMotionRootDelta = (
    motion: AnimationCompiledMotion,
    previousNormalizedTime: number,
    currentNormalizedTime: number,
    loop: boolean,
    rootBoneIndex: number,
    rig: AnimationRig,
    parameters: AnimationParameterStore,
    outTranslation: Float32Array,
    outRotation: Float32Array
): void => {
    switch (motion.kind) {
        case 'clip': {
            motion.clip.extractBoneDelta(
                rootBoneIndex,
                resolveMotionTime(
                    previousNormalizedTime * motion.timeScale,
                    motion.clip.duration,
                    motion.cycleOffset,
                    loop
                ),
                resolveMotionTime(
                    currentNormalizedTime * motion.timeScale,
                    motion.clip.duration,
                    motion.cycleOffset,
                    loop
                ),
                loop,
                rig,
                outTranslation,
                outRotation
            );
            return;
        }
        case 'blend1d': {
            const parameterValue = parameters.get(motion.parameter);
            const input = typeof parameterValue === 'number' ? parameterValue : parameterValue ? 1 : 0;
            if (motion.children.length === 1 || input <= motion.children[0]!.threshold) {
                return extractMotionRootDelta(
                    motion.children[0]!.motion,
                    previousNormalizedTime,
                    currentNormalizedTime,
                    loop,
                    rootBoneIndex,
                    rig,
                    parameters,
                    outTranslation,
                    outRotation
                );
            }
            for (let index = 0; index < motion.children.length - 1; index += 1) {
                const left = motion.children[index]!;
                const right = motion.children[index + 1]!;
                if (input > right.threshold) {
                    continue;
                }
                const alpha =
                    (input - left.threshold) / Math.max(1e-6, right.threshold - left.threshold);
                const leftTranslation = new Float32Array(3);
                const rightTranslation = new Float32Array(3);
                const leftRotation = new Float32Array(4);
                const rightRotation = new Float32Array(4);
                extractMotionRootDelta(
                    left.motion,
                    previousNormalizedTime,
                    currentNormalizedTime,
                    loop,
                    rootBoneIndex,
                    rig,
                    parameters,
                    leftTranslation,
                    leftRotation
                );
                extractMotionRootDelta(
                    right.motion,
                    previousNormalizedTime,
                    currentNormalizedTime,
                    loop,
                    rootBoneIndex,
                    rig,
                    parameters,
                    rightTranslation,
                    rightRotation
                );
                outTranslation[0] = leftTranslation[0]! + (rightTranslation[0]! - leftTranslation[0]!) * alpha;
                outTranslation[1] = leftTranslation[1]! + (rightTranslation[1]! - leftTranslation[1]!) * alpha;
                outTranslation[2] = leftTranslation[2]! + (rightTranslation[2]! - leftTranslation[2]!) * alpha;
                quatSlerp(outRotation, 0, leftRotation, 0, rightRotation, 0, alpha);
                return;
            }
            return extractMotionRootDelta(
                motion.children[motion.children.length - 1]!.motion,
                previousNormalizedTime,
                currentNormalizedTime,
                loop,
                rootBoneIndex,
                rig,
                parameters,
                outTranslation,
                outRotation
            );
        }
        case 'blend2d': {
            const parameterX = parameters.get(motion.parameterX);
            const parameterY = parameters.get(motion.parameterY);
            const weights = resolveBlend2DWeights(
                typeof parameterX === 'number' ? parameterX : parameterX ? 1 : 0,
                typeof parameterY === 'number' ? parameterY : parameterY ? 1 : 0,
                motion.children
            );
            const rotations: Float32Array[] = [];
            outTranslation.fill(0);
            for (let index = 0; index < motion.children.length; index += 1) {
                const translation = new Float32Array(3);
                const rotation = new Float32Array(4);
                extractMotionRootDelta(
                    motion.children[index]!.motion,
                    previousNormalizedTime,
                    currentNormalizedTime,
                    loop,
                    rootBoneIndex,
                    rig,
                    parameters,
                    translation,
                    rotation
                );
                outTranslation[0] += translation[0]! * weights[index]!;
                outTranslation[1] += translation[1]! * weights[index]!;
                outTranslation[2] += translation[2]! * weights[index]!;
                rotations.push(rotation);
            }
            blendRootDelta(rotations, weights, outRotation);
            return;
        }
        case 'direct': {
            const weights: number[] = [];
            const rotations: Float32Array[] = [];
            outTranslation.fill(0);
            for (let index = 0; index < motion.children.length; index += 1) {
                const child = motion.children[index]!;
                const weight = resolveDirectChildWeight(parameters, child.parameter, child.weight);
                if (weight <= 0) {
                    continue;
                }
                const translation = new Float32Array(3);
                const rotation = new Float32Array(4);
                extractMotionRootDelta(
                    child.motion,
                    previousNormalizedTime,
                    currentNormalizedTime,
                    loop,
                    rootBoneIndex,
                    rig,
                    parameters,
                    translation,
                    rotation
                );
                outTranslation[0] += translation[0]! * weight;
                outTranslation[1] += translation[1]! * weight;
                outTranslation[2] += translation[2]! * weight;
                weights.push(weight);
                rotations.push(rotation);
            }
            const totalWeight = weights.reduce((accumulator, value) => accumulator + value, 0);
            if (totalWeight > 0) {
                outTranslation[0] /= totalWeight;
                outTranslation[1] /= totalWeight;
                outTranslation[2] /= totalWeight;
            }
            blendRootDelta(rotations, weights, outRotation);
            return;
        }
        case 'additive': {
            const baseTranslation = new Float32Array(3);
            const additiveTranslation = new Float32Array(3);
            const baseRotation = new Float32Array(4);
            const additiveRotation = new Float32Array(4);
            extractMotionRootDelta(
                motion.base,
                previousNormalizedTime,
                currentNormalizedTime,
                loop,
                rootBoneIndex,
                rig,
                parameters,
                baseTranslation,
                baseRotation
            );
            extractMotionRootDelta(
                motion.additive,
                previousNormalizedTime,
                currentNormalizedTime,
                loop,
                rootBoneIndex,
                rig,
                parameters,
                additiveTranslation,
                additiveRotation
            );
            const parameterWeight = motion.parameter ? parameters.get(motion.parameter) : motion.weight;
            const resolvedWeight =
                typeof parameterWeight === 'number'
                    ? parameterWeight
                    : parameterWeight
                      ? motion.weight
                      : 0;
            outTranslation[0] = baseTranslation[0]! + additiveTranslation[0]! * resolvedWeight;
            outTranslation[1] = baseTranslation[1]! + additiveTranslation[1]! * resolvedWeight;
            outTranslation[2] = baseTranslation[2]! + additiveTranslation[2]! * resolvedWeight;
            quatIdentity(outRotation, 0);
            quatSlerp(outRotation, 0, outRotation, 0, additiveRotation, 0, resolvedWeight);
            quatMultiply(outRotation, 0, baseRotation, 0, outRotation, 0);
            quatNormalize(outRotation, 0, outRotation, 0);
            return;
        }
        default:
            throw new AnimationStateMachineError(`Unsupported motion kind '${String((motion as { kind?: unknown }).kind)}'`);
    }
};