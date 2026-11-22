import type { AnimationParameterStore } from './parameters';
import type { AnimationRig } from './rig';
import type {
    AnimationCompiledMotion,
    AnimationCompiledClipMotion,
    AnimationCompiledBlend1DMotion,
    AnimationCompiledBlend2DMotion,
    AnimationCompiledDirectMotion,
    AnimationCompiledAdditiveMotion,
    AnimationCompiledMotionMatchingMotion,
} from './blend-types';
import { SoaQuatBuffer } from '@axrone/numeric';
import { dispatchMotion } from './blend-visitor';
import type { BlendMotionVisitor } from './blend-types';
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
import { resolveMotionMatchingTime } from './motion-matching-node';

function extractClipRootDelta(
    motion: AnimationCompiledClipMotion,
    prevTime: number,
    currTime: number,
    loop: boolean,
    rootBoneIndex: number,
    rig: AnimationRig,
    outTranslation: Float32Array,
    outRotation: Float32Array
): void {
    motion.clip.extractBoneDelta(
        rootBoneIndex,
        resolveMotionTime(prevTime * motion.timeScale, motion.clip.duration, motion.cycleOffset, loop),
        resolveMotionTime(currTime * motion.timeScale, motion.clip.duration, motion.cycleOffset, loop),
        loop, rig, outTranslation, outRotation
    );
}

function extractMotionMatchingRootDelta(
    motion: AnimationCompiledMotionMatchingMotion,
    prevTime: number,
    currTime: number,
    loop: boolean,
    rootBoneIndex: number,
    rig: AnimationRig,
    outTranslation: Float32Array,
    outRotation: Float32Array
): void {
    const clip = motion.state.clip;
    if (clip === null) {
        outTranslation.fill(0);
        SoaQuatBuffer.quatIdentity(outRotation, 0);
        return;
    }

    clip.extractBoneDelta(
        rootBoneIndex,
        resolveMotionTime(resolveMotionMatchingTime(motion, prevTime), clip.duration, 0, loop),
        resolveMotionTime(resolveMotionMatchingTime(motion, currTime), clip.duration, 0, loop),
        loop, rig, outTranslation, outRotation
    );
}

function extractBlend1DRootDelta(
    motion: AnimationCompiledBlend1DMotion,
    prevTime: number,
    currTime: number,
    loop: boolean,
    rootBoneIndex: number,
    rig: AnimationRig,
    parameters: AnimationParameterStore,
    outTranslation: Float32Array,
    outRotation: Float32Array,
    context: AnimationMotionEvaluationContext,
    depth: number
): void {
    const input = resolveParameterScalar(parameters, motion.parameter);
    const segment = findBlend1DSegment(motion.children, input);
    if (segment < 0) {
        extractMotionRootDelta(motion.children[-segment - 1]!.motion, prevTime, currTime, loop, rootBoneIndex, rig, parameters, outTranslation, outRotation, context, depth);
        return;
    }
    const alpha = resolveBlend1DAlpha(motion.children, segment, input);
    const leftScratch = context.blendScratch.acquireRootDeltaScratch(depth * 2);
    const rightScratch = context.blendScratch.acquireRootDeltaScratch(depth * 2 + 1);
    extractMotionRootDelta(motion.children[segment]!.motion, prevTime, currTime, loop, rootBoneIndex, rig, parameters, leftScratch.translation, leftScratch.rotation, context, depth + 1);
    extractMotionRootDelta(motion.children[segment + 1]!.motion, prevTime, currTime, loop, rootBoneIndex, rig, parameters, rightScratch.translation, rightScratch.rotation, context, depth + 1);
    outTranslation[0] = leftScratch.translation[0]! + (rightScratch.translation[0]! - leftScratch.translation[0]!) * alpha;
    outTranslation[1] = leftScratch.translation[1]! + (rightScratch.translation[1]! - leftScratch.translation[1]!) * alpha;
    outTranslation[2] = leftScratch.translation[2]! + (rightScratch.translation[2]! - leftScratch.translation[2]!) * alpha;
    SoaQuatBuffer.quatSlerp(outRotation, 0, leftScratch.rotation, 0, rightScratch.rotation, 0, alpha);
}

function extractBlend2DRootDelta(
    motion: AnimationCompiledBlend2DMotion,
    prevTime: number,
    currTime: number,
    loop: boolean,
    rootBoneIndex: number,
    rig: AnimationRig,
    parameters: AnimationParameterStore,
    outTranslation: Float32Array,
    outRotation: Float32Array,
    context: AnimationMotionEvaluationContext,
    depth: number
): void {
    const weights = resolveBlend2DWeightsWithContext(
        resolveParameterScalar(parameters, motion.parameterX),
        resolveParameterScalar(parameters, motion.parameterY),
        motion.children,
        context,
        depth,
        motion.triangles
    );
    const childScratch = context.blendScratch.acquireRootDeltaScratch(depth * 2);
    const referenceScratch = context.blendScratch.acquireRootDeltaScratch(depth * 2 + 1);
    outTranslation.fill(0);
    let totalRotationWeight = 0;
    for (let index = 0; index < motion.children.length; index += 1) {
        extractMotionRootDelta(motion.children[index]!.motion, prevTime, currTime, loop, rootBoneIndex, rig, parameters, childScratch.translation, childScratch.rotation, context, depth + 1);
        const weight = Math.max(0, weights[index] ?? 0);
        outTranslation[0] += childScratch.translation[0]! * weights[index]!;
        outTranslation[1] += childScratch.translation[1]! * weights[index]!;
        outTranslation[2] += childScratch.translation[2]! * weights[index]!;
        if (weight > 0) {
            SoaQuatBuffer.quatAccumulateWeighted(outRotation, 0, referenceScratch.rotation, 0, childScratch.rotation, 0, weight, totalRotationWeight <= 0);
            totalRotationWeight += weight;
        }
    }
    SoaQuatBuffer.quatFinalizeWeighted(outRotation, 0, outRotation, 0, totalRotationWeight);
}

function extractDirectRootDelta(
    motion: AnimationCompiledDirectMotion,
    prevTime: number,
    currTime: number,
    loop: boolean,
    rootBoneIndex: number,
    rig: AnimationRig,
    parameters: AnimationParameterStore,
    outTranslation: Float32Array,
    outRotation: Float32Array,
    context: AnimationMotionEvaluationContext,
    depth: number
): void {
    const childScratch = context.blendScratch.acquireRootDeltaScratch(depth * 2);
    const referenceScratch = context.blendScratch.acquireRootDeltaScratch(depth * 2 + 1);
    outTranslation.fill(0);
    let totalWeight = 0;
    for (let index = 0; index < motion.children.length; index += 1) {
        const child = motion.children[index]!;
        const weight = resolveDirectChildWeight(parameters, child.parameter, child.weight);
        if (weight <= 0) continue;
        extractMotionRootDelta(child.motion, prevTime, currTime, loop, rootBoneIndex, rig, parameters, childScratch.translation, childScratch.rotation, context, depth + 1);
        outTranslation[0] += childScratch.translation[0]! * weight;
        outTranslation[1] += childScratch.translation[1]! * weight;
        outTranslation[2] += childScratch.translation[2]! * weight;
        SoaQuatBuffer.quatAccumulateWeighted(outRotation, 0, referenceScratch.rotation, 0, childScratch.rotation, 0, weight, totalWeight <= 0);
        totalWeight += weight;
    }
    if (totalWeight > 0) {
        outTranslation[0] /= totalWeight;
        outTranslation[1] /= totalWeight;
        outTranslation[2] /= totalWeight;
    }
    SoaQuatBuffer.quatFinalizeWeighted(outRotation, 0, outRotation, 0, totalWeight);
}

function extractAdditiveRootDelta(
    motion: AnimationCompiledAdditiveMotion,
    prevTime: number,
    currTime: number,
    loop: boolean,
    rootBoneIndex: number,
    rig: AnimationRig,
    parameters: AnimationParameterStore,
    outTranslation: Float32Array,
    outRotation: Float32Array,
    context: AnimationMotionEvaluationContext,
    depth: number
): void {
    const baseScratch = context.blendScratch.acquireRootDeltaScratch(depth * 2);
    const additiveScratch = context.blendScratch.acquireRootDeltaScratch(depth * 2 + 1);
    extractMotionRootDelta(motion.base, prevTime, currTime, loop, rootBoneIndex, rig, parameters, baseScratch.translation, baseScratch.rotation, context, depth + 1);
    extractMotionRootDelta(motion.additive, prevTime, currTime, loop, rootBoneIndex, rig, parameters, additiveScratch.translation, additiveScratch.rotation, context, depth + 1);
    const resolvedWeight = resolveAdditiveWeight(parameters, motion.parameter, motion.weight);
    outTranslation[0] = baseScratch.translation[0]! + additiveScratch.translation[0]! * resolvedWeight;
    outTranslation[1] = baseScratch.translation[1]! + additiveScratch.translation[1]! * resolvedWeight;
    outTranslation[2] = baseScratch.translation[2]! + additiveScratch.translation[2]! * resolvedWeight;
    SoaQuatBuffer.quatIdentity(outRotation, 0);
    SoaQuatBuffer.quatSlerp(outRotation, 0, outRotation, 0, additiveScratch.rotation, 0, resolvedWeight);
    SoaQuatBuffer.quatMultiply(outRotation, 0, baseScratch.rotation, 0, outRotation, 0);
    SoaQuatBuffer.quatNormalize(outRotation, 0, outRotation, 0);
}

interface RootDeltaContext {
    previousNormalizedTime: number;
    currentNormalizedTime: number;
    loop: boolean;
    rootBoneIndex: number;
    rig: AnimationRig;
    parameters: AnimationParameterStore;
    outTranslation: Float32Array;
    outRotation: Float32Array;
    context: AnimationMotionEvaluationContext;
    depth: number;
}

const rootDeltaVisitor: BlendMotionVisitor<RootDeltaContext, void> = {
    visitClip: (motion: AnimationCompiledClipMotion, ctx: RootDeltaContext) => extractClipRootDelta(motion, ctx.previousNormalizedTime, ctx.currentNormalizedTime, ctx.loop, ctx.rootBoneIndex, ctx.rig, ctx.outTranslation, ctx.outRotation),
    visitBlend1d: (motion: AnimationCompiledBlend1DMotion, ctx: RootDeltaContext) => extractBlend1DRootDelta(motion, ctx.previousNormalizedTime, ctx.currentNormalizedTime, ctx.loop, ctx.rootBoneIndex, ctx.rig, ctx.parameters, ctx.outTranslation, ctx.outRotation, ctx.context, ctx.depth),
    visitBlend2d: (motion: AnimationCompiledBlend2DMotion, ctx: RootDeltaContext) => extractBlend2DRootDelta(motion, ctx.previousNormalizedTime, ctx.currentNormalizedTime, ctx.loop, ctx.rootBoneIndex, ctx.rig, ctx.parameters, ctx.outTranslation, ctx.outRotation, ctx.context, ctx.depth),
    visitDirect: (motion: AnimationCompiledDirectMotion, ctx: RootDeltaContext) => extractDirectRootDelta(motion, ctx.previousNormalizedTime, ctx.currentNormalizedTime, ctx.loop, ctx.rootBoneIndex, ctx.rig, ctx.parameters, ctx.outTranslation, ctx.outRotation, ctx.context, ctx.depth),
    visitAdditive: (motion: AnimationCompiledAdditiveMotion, ctx: RootDeltaContext) => extractAdditiveRootDelta(motion, ctx.previousNormalizedTime, ctx.currentNormalizedTime, ctx.loop, ctx.rootBoneIndex, ctx.rig, ctx.parameters, ctx.outTranslation, ctx.outRotation, ctx.context, ctx.depth),
    visitMotionMatching: (motion: AnimationCompiledMotionMatchingMotion, ctx: RootDeltaContext) => extractMotionMatchingRootDelta(motion, ctx.previousNormalizedTime, ctx.currentNormalizedTime, ctx.loop, ctx.rootBoneIndex, ctx.rig, ctx.outTranslation, ctx.outRotation),
};

let rootDeltaContext: RootDeltaContext | null = null;

export const extractMotionRootDelta = (
    motion: AnimationCompiledMotion,
    previousNormalizedTime: number,
    currentNormalizedTime: number,
    loop: boolean,
    rootBoneIndex: number,
    rig: AnimationRig,
    parameters: AnimationParameterStore,
    outTranslation: Float32Array,
    outRotation: Float32Array,
    context: AnimationMotionEvaluationContext,
    depth: number = 0
): void => {
    if (rootDeltaContext === null) {
        rootDeltaContext = {
            previousNormalizedTime,
            currentNormalizedTime,
            loop,
            rootBoneIndex,
            rig,
            parameters,
            outTranslation,
            outRotation,
            context,
            depth,
        };
    } else {
        rootDeltaContext.previousNormalizedTime = previousNormalizedTime;
        rootDeltaContext.currentNormalizedTime = currentNormalizedTime;
        rootDeltaContext.loop = loop;
        rootDeltaContext.rootBoneIndex = rootBoneIndex;
        rootDeltaContext.rig = rig;
        rootDeltaContext.parameters = parameters;
        rootDeltaContext.outTranslation = outTranslation;
        rootDeltaContext.outRotation = outRotation;
        rootDeltaContext.context = context;
        rootDeltaContext.depth = depth;
    }
    dispatchMotion(motion, rootDeltaVisitor, rootDeltaContext);
};
