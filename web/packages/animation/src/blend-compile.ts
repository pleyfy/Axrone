import { AnimationCompilationError, AnimationResolutionError } from './errors';
import { buildDelaunayTriangles } from './delaunay';
import { AnimationClip } from './clip';
import type { DiagnosticCode } from './blend-types';
import type {
    AnimationCompiledMotion,
    AnimationCompiledBlend1DMotion,
    AnimationCompiledBlend2DMotion,
    AnimationCompiledDirectMotion,
    AnimationCompiledAdditiveMotion,
    AnimationCompiledClipMotion,
    AnimationCompiledMotionMatchingMotion,
} from './blend-types';
import type { AnimationBlendTreeDefinition, AnimationMotionDefinition } from './types';
import { assertNever } from './errors';
import {
    createMotionMatchingSelection,
    MOTION_MATCH_DEFAULT_CONTINUITY_BIAS,
    MOTION_MATCH_DEFAULT_RESELECT_INTERVAL,
    validateMotionMatchingDefinition,
} from './motion-matching-node';

const pushDiagnostic = (code: DiagnosticCode, message: string, path: string): never => {
    throw new AnimationCompilationError(message, code, path);
};

const compileBlendTree = (
    definition: AnimationBlendTreeDefinition,
    clips: ReadonlyMap<string, AnimationClip>
): AnimationCompiledMotion => {
    switch (definition.kind) {
        case 'blend1d':
            if (definition.children.length === 0) {
                pushDiagnostic('animation.blendGraph.empty', '1D blend trees require at least one child', definition.kind);
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
            } satisfies AnimationCompiledBlend1DMotion);
        case 'blend2d':
            if (definition.children.length === 0) {
                pushDiagnostic('animation.blendGraph.empty', '2D blend trees require at least one child', definition.kind);
            }
            return Object.freeze({
                kind: 'blend2d',
                parameterX: definition.parameterX,
                parameterY: definition.parameterY,
                mode: definition.mode ?? 'inverse-distance',
                triangles:
                    definition.mode === 'freeform'
                        ? buildDelaunayTriangles(
                              definition.children.map((child) => ({
                                  x: child.position[0],
                                  y: child.position[1],
                              }))
                          )
                        : new Int32Array(0),
                children: Object.freeze(
                    definition.children.map((child) =>
                        Object.freeze({
                            x: child.position[0],
                            y: child.position[1],
                            motion: compileMotion(child.motion, clips),
                        })
                    )
                ),
            } satisfies AnimationCompiledBlend2DMotion);
        case 'direct':
            if (definition.children.length === 0) {
                pushDiagnostic('animation.blendGraph.empty', 'Direct blend trees require at least one child', definition.kind);
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
            } satisfies AnimationCompiledDirectMotion);
        case 'additive':
            return Object.freeze({
                kind: 'additive',
                base: compileMotion(definition.base, clips),
                additive: compileMotion(definition.additive, clips),
                parameter: definition.parameter,
                weight: definition.weight ?? 1,
            } satisfies AnimationCompiledAdditiveMotion);
        default:
            return assertNever(definition, 'Unsupported blend tree');
    }
};

export const compileMotion = (
    definition: AnimationMotionDefinition,
    clips: ReadonlyMap<string, AnimationClip>
): AnimationCompiledMotion => {
    if (definition.kind === 'clip') {
        const clip = clips.get(definition.clipId);
        if (!clip) {
            throw new AnimationResolutionError(`Unknown animation clip '${definition.clipId}'`, definition.clipId);
        }
        return Object.freeze({
            kind: 'clip',
            clip,
            timeScale: definition.timeScale ?? 1,
            cycleOffset: definition.cycleOffset ?? 0,
        } satisfies AnimationCompiledClipMotion);
    }
    if (definition.kind === 'motionMatching') {
        validateMotionMatchingDefinition(definition, 'motionMatching');
        if (definition.database.size === 0) {
            pushDiagnostic(
                'animation.blendGraph.empty',
                'Motion matching requires at least one database entry',
                definition.kind
            );
        }
        return Object.freeze({
            kind: 'motionMatching',
            database: definition.database,
            clips,
            trajectoryXParameter: String(definition.trajectoryXParameter),
            trajectoryZParameter: String(definition.trajectoryZParameter),
            facingXParameter: String(definition.facingXParameter),
            facingZParameter: String(definition.facingZParameter),
            reselectIntervalSeconds:
                definition.reselectIntervalSeconds ?? MOTION_MATCH_DEFAULT_RESELECT_INTERVAL,
            continuityBias: definition.continuityBias ?? MOTION_MATCH_DEFAULT_CONTINUITY_BIAS,
            state: createMotionMatchingSelection(),
        } satisfies AnimationCompiledMotionMatchingMotion);
    }
    return compileBlendTree(definition, clips);
};
