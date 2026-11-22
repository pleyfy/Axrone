import type {
    AnimationCompiledMotion,
    AnimationCompiledClipMotion,
    AnimationCompiledBlend1DMotion,
    AnimationCompiledBlend2DMotion,
    AnimationCompiledDirectMotion,
    AnimationCompiledAdditiveMotion,
    AnimationCompiledMotionMatchingMotion,
} from './blend-types';
import { AnimationFrame } from './pose-frame';
import { blendFrame as blendFrameOp, blendWeightedFrames as blendWeightedFramesOp, applyAdditiveFrame as applyAdditiveFrameOp } from './pose-blend';
import type { AnimationMotionEvaluationContext } from './blend-scratch';
import {
    resolveParameterScalar,
    resolveDirectChildWeight,
    resolveAdditiveWeight,
    resolveMotionTime,
    findBlend1DSegment,
    resolveBlend1DAlpha,
    resolveBlend2DWeightsWithContext,
} from './blend-helpers';
import { dispatchMotion } from './blend-visitor';
import type { BlendMotionVisitor } from './blend-types';
import {
    resolveMotionMatchingTime,
    updateMotionMatchingSelection,
} from './motion-matching-node';

function evaluateClipMotion(
    motion: AnimationCompiledClipMotion,
    normalizedTime: number,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame,
    loop: boolean
): AnimationFrame {
    out.reset(context.rig, context.restFrame.curves.values);
    const time = resolveMotionTime(normalizedTime * motion.timeScale, motion.clip.duration, motion.cycleOffset, loop);
    return motion.clip.sampleTime(time, out);
}

function evaluateMotionMatchingMotion(
    motion: AnimationCompiledMotionMatchingMotion,
    normalizedTime: number,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame,
    loop: boolean
): AnimationFrame {
    updateMotionMatchingSelection(motion, normalizedTime, context.parameters);
    const clip = motion.state.clip;
    if (clip === null) {
        out.reset(context.rig, context.restFrame.curves.values);
        return out;
    }

    out.reset(context.rig, context.restFrame.curves.values);
    const time = resolveMotionTime(resolveMotionMatchingTime(motion, normalizedTime), clip.duration, 0, loop);
    return clip.sampleTime(time, out);
}

function evaluateBlend1DMotion(
    motion: AnimationCompiledBlend1DMotion,
    normalizedTime: number,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame,
    loop: boolean,
    depth: number
): AnimationFrame {
    const input = resolveParameterScalar(context.parameters, motion.parameter);
    const segment = findBlend1DSegment(motion.children, input);
    if (segment < 0) {
        return evaluateMotion(motion.children[-segment - 1]!.motion, normalizedTime, context, out, loop, depth + 1);
    }
    const alpha = resolveBlend1DAlpha(motion.children, segment, input);
    const leftFrame = context.scratch.acquire();
    const rightFrame = context.scratch.acquire();
    evaluateMotion(motion.children[segment]!.motion, normalizedTime, context, leftFrame, loop, depth + 1);
    evaluateMotion(motion.children[segment + 1]!.motion, normalizedTime, context, rightFrame, loop, depth + 1);
    return blendFrameOp(out, leftFrame, rightFrame, alpha);
}

function evaluateBlend2DMotion(
    motion: AnimationCompiledBlend2DMotion,
    normalizedTime: number,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame,
    loop: boolean,
    depth: number
): AnimationFrame {
    const weights = resolveBlend2DWeightsWithContext(
        resolveParameterScalar(context.parameters, motion.parameterX),
        resolveParameterScalar(context.parameters, motion.parameterY),
        motion.children,
        context,
        depth,
        motion.triangles
    );
    const frames = context.scratch.acquireFrameArray(motion.children.length);
    for (let index = 0; index < motion.children.length; index += 1) {
        const frame = context.scratch.acquire();
        evaluateMotion(motion.children[index]!.motion, normalizedTime, context, frame, loop, depth + 1);
        frames[index] = frame;
    }
    return blendWeightedFramesOp(out, frames, weights, context.restFrame, context.blendScratch.referenceRotation);
}

function evaluateDirectMotion(
    motion: AnimationCompiledDirectMotion,
    normalizedTime: number,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame,
    loop: boolean,
    depth: number
): AnimationFrame {
    const frames = context.scratch.acquireFrameArray(motion.children.length);
    const weights = context.scratch.acquireWeightArray(motion.children.length);
    let activeCount = 0;
    for (let index = 0; index < motion.children.length; index += 1) {
        const child = motion.children[index]!;
        const weight = resolveDirectChildWeight(context.parameters, child.parameter, child.weight);
        if (weight <= 0) {
            continue;
        }
        const frame = context.scratch.acquire();
        evaluateMotion(child.motion, normalizedTime, context, frame, loop, depth + 1);
        frames[activeCount] = frame;
        weights[activeCount] = weight;
        activeCount += 1;
    }
    if (activeCount === 0) {
        return out.copyFrom(context.restFrame);
    }
    if (activeCount === 1) {
        return out.copyFrom(frames[0]!);
    }
    frames.length = activeCount;
    weights.length = activeCount;
    return blendWeightedFramesOp(
        out,
        frames,
        weights,
        context.restFrame,
        context.blendScratch.referenceRotation
    );
}

function evaluateAdditiveMotion(
    motion: AnimationCompiledAdditiveMotion,
    normalizedTime: number,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame,
    loop: boolean,
    depth: number
): AnimationFrame {
    const baseFrame = context.scratch.acquire();
    const additiveFrame = context.scratch.acquire();
    evaluateMotion(motion.base, normalizedTime, context, baseFrame, loop, depth + 1);
    evaluateMotion(motion.additive, normalizedTime, context, additiveFrame, loop, depth + 1);
    const resolvedWeight = resolveAdditiveWeight(context.parameters, motion.parameter, motion.weight);
    return applyAdditiveFrameOp(out, baseFrame, additiveFrame, context.restFrame, resolvedWeight, context.blendScratch.additiveScratch);
}

interface EvaluateContext {
    normalizedTime: number;
    context: AnimationMotionEvaluationContext;
    out: AnimationFrame;
    loop: boolean;
    depth: number;
}

const evaluateVisitor: BlendMotionVisitor<EvaluateContext, AnimationFrame> = {
    visitClip: (motion: AnimationCompiledClipMotion, ctx: EvaluateContext) => evaluateClipMotion(motion, ctx.normalizedTime, ctx.context, ctx.out, ctx.loop),
    visitBlend1d: (motion: AnimationCompiledBlend1DMotion, ctx: EvaluateContext) => evaluateBlend1DMotion(motion, ctx.normalizedTime, ctx.context, ctx.out, ctx.loop, ctx.depth),
    visitBlend2d: (motion: AnimationCompiledBlend2DMotion, ctx: EvaluateContext) => evaluateBlend2DMotion(motion, ctx.normalizedTime, ctx.context, ctx.out, ctx.loop, ctx.depth),
    visitDirect: (motion: AnimationCompiledDirectMotion, ctx: EvaluateContext) => evaluateDirectMotion(motion, ctx.normalizedTime, ctx.context, ctx.out, ctx.loop, ctx.depth),
    visitAdditive: (motion: AnimationCompiledAdditiveMotion, ctx: EvaluateContext) => evaluateAdditiveMotion(motion, ctx.normalizedTime, ctx.context, ctx.out, ctx.loop, ctx.depth),
    visitMotionMatching: (motion: AnimationCompiledMotionMatchingMotion, ctx: EvaluateContext) => evaluateMotionMatchingMotion(motion, ctx.normalizedTime, ctx.context, ctx.out, ctx.loop),
};

let evaluateContext: EvaluateContext | null = null;

export const evaluateMotion = (
    motion: AnimationCompiledMotion,
    normalizedTime: number,
    context: AnimationMotionEvaluationContext,
    out: AnimationFrame,
    loop: boolean = true,
    depth: number = 0
): AnimationFrame => {
    if (evaluateContext === null) {
        evaluateContext = { normalizedTime, context, out, loop, depth };
    } else {
        evaluateContext.normalizedTime = normalizedTime;
        evaluateContext.context = context;
        evaluateContext.out = out;
        evaluateContext.loop = loop;
        evaluateContext.depth = depth;
    }
    return dispatchMotion(motion, evaluateVisitor, evaluateContext);
};
