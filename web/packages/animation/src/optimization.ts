import { AnimationValidationError } from './errors';
import type {
    AnimationClipCompressionDefinition,
    AnimationClipDefinition,
    AnimationTrackDefinition,
} from './types';

const getTrackComponentCount = (track: AnimationTrackDefinition): number => {
    if (typeof track.valueComponentCount === 'number' && Number.isFinite(track.valueComponentCount)) {
        return track.valueComponentCount;
    }
    switch (track.path) {
        case 'translation':
        case 'scale':
            return 3;
        case 'rotation':
            return 4;
        case 'weights': {
            const keyframeCount = track.keyframeCount ?? track.times.length;
            if (keyframeCount <= 0) {
                return 0;
            }
            return Math.max(1, Math.trunc(track.values.length / keyframeCount));
        }
        default:
            return 0;
    }
};

const getTolerance = (
    track: AnimationTrackDefinition,
    compression: AnimationClipCompressionDefinition
): number => {
    switch (track.path) {
        case 'translation':
            return compression.positionTolerance ?? 1e-4;
        case 'rotation':
            return (compression.rotationToleranceDegrees ?? 0.25) * (Math.PI / 180);
        case 'scale':
            return compression.scaleTolerance ?? 1e-4;
        case 'weights':
            return compression.curveTolerance ?? 1e-4;
        default:
            return 1e-4;
    }
};

const canRemoveLinearKeyframe = (
    track: AnimationTrackDefinition,
    index: number,
    componentCount: number,
    tolerance: number,
    times: readonly number[],
    values: readonly number[]
): boolean => {
    if (track.interpolation === 'STEP') {
        return false;
    }
    if (track.interpolation === 'CUBICSPLINE') {
        return false;
    }

    const prevTime = times[index - 1] ?? 0;
    const currentTime = times[index] ?? 0;
    const nextTime = times[index + 1] ?? currentTime;
    const span = nextTime - prevTime;
    if (span <= Number.EPSILON) {
        return false;
    }

    const alpha = (currentTime - prevTime) / span;
    const prevOffset = (index - 1) * componentCount;
    const currentOffset = index * componentCount;
    const nextOffset = (index + 1) * componentCount;

    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
        const prevValue = values[prevOffset + componentIndex] ?? 0;
        const currentValue = values[currentOffset + componentIndex] ?? 0;
        const nextValue = values[nextOffset + componentIndex] ?? 0;
        const predicted = prevValue + (nextValue - prevValue) * alpha;
        if (track.path === 'rotation') {
            if (Math.abs(predicted - currentValue) > tolerance) {
                return false;
            }
            continue;
        }
        if (Math.abs(predicted - currentValue) > tolerance) {
            return false;
        }
    }

    return true;
};

const optimizeTrack = (
    track: AnimationTrackDefinition,
    compression: AnimationClipCompressionDefinition
): AnimationTrackDefinition => {
    const keyframeCount = track.keyframeCount ?? track.times.length;
    if (keyframeCount <= 2 || compression.codec === 'none') {
        return track;
    }

    const componentCount = getTrackComponentCount(track);
    if (componentCount <= 0) {
        throw new AnimationValidationError(`Animation track '${track.target}/${track.path}' has invalid component count`);
    }

    const times = [...track.times];
    const values = [...track.values];
    const tolerance = getTolerance(track, compression);
    const keep = new Array<boolean>(keyframeCount).fill(true);

    for (let index = 1; index < keyframeCount - 1; index += 1) {
        if (!canRemoveLinearKeyframe(track, index, componentCount, tolerance, times, values)) {
            continue;
        }
        keep[index] = false;
    }

    const optimizedTimes: number[] = [];
    const optimizedValues: number[] = [];
    for (let index = 0; index < keyframeCount; index += 1) {
        if (!keep[index]) {
            continue;
        }
        optimizedTimes.push(times[index]!);
        const valueOffset = index * componentCount;
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
            optimizedValues.push(values[valueOffset + componentIndex] ?? 0);
        }
    }

    return Object.freeze({
        ...track,
        keyframeCount: optimizedTimes.length,
        valueComponentCount: componentCount,
        sampleStride: componentCount,
        times: new Float32Array(optimizedTimes),
        values: new Float32Array(optimizedValues),
    } satisfies AnimationTrackDefinition);
};

export const optimizeAnimationClipDefinition = (
    clip: AnimationClipDefinition,
    compression: AnimationClipCompressionDefinition = clip.compression ?? { codec: 'keyframe-reduced' }
): AnimationClipDefinition =>
    Object.freeze({
        ...clip,
        compression: Object.freeze({
            codec: compression.codec ?? 'keyframe-reduced',
            ...(compression.positionTolerance !== undefined
                ? { positionTolerance: compression.positionTolerance }
                : {}),
            ...(compression.rotationToleranceDegrees !== undefined
                ? { rotationToleranceDegrees: compression.rotationToleranceDegrees }
                : {}),
            ...(compression.scaleTolerance !== undefined ? { scaleTolerance: compression.scaleTolerance } : {}),
            ...(compression.curveTolerance !== undefined ? { curveTolerance: compression.curveTolerance } : {}),
            ...(compression.preserveStepTracks !== undefined
                ? { preserveStepTracks: compression.preserveStepTracks }
                : {}),
        }),
        tracks: Object.freeze(clip.tracks.map((track) => optimizeTrack(track, compression))),
    });

export const optimizeAnimationClipDefinitions = (
    clips: readonly AnimationClipDefinition[],
    compression?: AnimationClipCompressionDefinition
): readonly AnimationClipDefinition[] =>
    Object.freeze(
        clips.map((clip) =>
            optimizeAnimationClipDefinition(
                clip,
                compression ?? clip.compression ?? { codec: 'keyframe-reduced' }
            )
        )
    );