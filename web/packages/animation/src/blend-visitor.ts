import type {
    AnimationCompiledMotion,
    BlendMotionKind,
    BlendMotionVisitor,
    BlendMotionOfKind,
} from './blend-types';
import { assertNever } from './errors';

export const dispatchMotion = <TContext, TResult>(
    motion: AnimationCompiledMotion,
    visitor: BlendMotionVisitor<TContext, TResult>,
    context: TContext
): TResult => {
    switch (motion.kind) {
        case 'clip':
            return visitor.visitClip(motion as BlendMotionOfKind<'clip'>, context);
        case 'blend1d':
            return visitor.visitBlend1d(motion as BlendMotionOfKind<'blend1d'>, context);
        case 'blend2d':
            return visitor.visitBlend2d(motion as BlendMotionOfKind<'blend2d'>, context);
        case 'direct':
            return visitor.visitDirect(motion as BlendMotionOfKind<'direct'>, context);
        case 'additive':
            return visitor.visitAdditive(motion as BlendMotionOfKind<'additive'>, context);
        case 'motionMatching':
            return visitor.visitMotionMatching(motion as BlendMotionOfKind<'motionMatching'>, context);
        default:
            return assertNever(motion, 'Unsupported motion kind');
    }
};

export const createVisitor = <TContext, TResult>(
    impl: BlendMotionVisitor<TContext, TResult>
): BlendMotionVisitor<TContext, TResult> => impl;

export type BlendMotionFolder<TContext, TResult> = (
    motion: AnimationCompiledMotion,
    context: TContext,
    foldChild: (child: AnimationCompiledMotion, context: TContext) => TResult
) => TResult;

export const foldMotion = <TContext, TResult>(
    motion: AnimationCompiledMotion,
    context: TContext,
    handlers: {
        readonly clip: (motion: BlendMotionOfKind<'clip'>, context: TContext) => TResult;
        readonly blend1d: (motion: BlendMotionOfKind<'blend1d'>, context: TContext, foldChild: (child: AnimationCompiledMotion) => TResult) => TResult;
        readonly blend2d: (motion: BlendMotionOfKind<'blend2d'>, context: TContext, foldChild: (child: AnimationCompiledMotion) => TResult) => TResult;
        readonly direct: (motion: BlendMotionOfKind<'direct'>, context: TContext, foldChild: (child: AnimationCompiledMotion) => TResult) => TResult;
        readonly additive: (motion: BlendMotionOfKind<'additive'>, context: TContext, foldBase: (base: AnimationCompiledMotion) => TResult, foldAdditive: (additive: AnimationCompiledMotion) => TResult) => TResult;
        readonly motionMatching: (motion: BlendMotionOfKind<'motionMatching'>, context: TContext) => TResult;
    }
): TResult => {
    switch (motion.kind) {
        case 'clip':
            return handlers.clip(motion as BlendMotionOfKind<'clip'>, context);
        case 'blend1d': {
            const m = motion as BlendMotionOfKind<'blend1d'>;
            return handlers.blend1d(m, context, (child) => foldMotion(child, context, handlers));
        }
        case 'blend2d': {
            const m = motion as BlendMotionOfKind<'blend2d'>;
            return handlers.blend2d(m, context, (child) => foldMotion(child, context, handlers));
        }
        case 'direct': {
            const m = motion as BlendMotionOfKind<'direct'>;
            return handlers.direct(m, context, (child) => foldMotion(child, context, handlers));
        }
        case 'additive': {
            const m = motion as BlendMotionOfKind<'additive'>;
            return handlers.additive(
                m,
                context,
                (base) => foldMotion(base, context, handlers),
                (additive) => foldMotion(additive, context, handlers)
            );
        }
        case 'motionMatching':
            return handlers.motionMatching(motion as BlendMotionOfKind<'motionMatching'>, context);
        default:
            return assertNever(motion, 'Unsupported motion kind');
    }
};
