import { AnimationValidationError } from './errors';
import type { AnimationParameterStore } from './parameters';
import type {
    AnimationCompiledMotionMatchingMotion,
    AnimationMotionMatchingSelection,
} from './blend-types';

export const MOTION_MATCH_DEFAULT_RESELECT_INTERVAL = 0.2;
export const MOTION_MATCH_DEFAULT_CONTINUITY_BIAS = 1;

const EPSILON = 1e-6;

/**
 * Creates the mutable selection state of a motion-matching leaf.
 */
export const createMotionMatchingSelection = (): AnimationMotionMatchingSelection => ({
    clipId: null,
    clip: null,
    startTime: 0,
    duration: 0,
    lastNormalizedTime: 0,
    hasSelection: false,
});

/**
 * Reads the world-space trajectory and facing from the actor parameters and
 * picks the pose that matches them best.
 *
 * The search runs at most once per reselect interval so a moving actor does
 * not flip between two similar poses every frame; a loop of the timeline
 * always forces a fresh search.
 */
export const updateMotionMatchingSelection = (
    motion: AnimationCompiledMotionMatchingMotion,
    normalizedTime: number,
    parameters: AnimationParameterStore
): void => {
    const state = motion.state;
    const elapsed = (normalizedTime - state.lastNormalizedTime) * state.duration;
    const looped = normalizedTime < state.lastNormalizedTime;
    state.lastNormalizedTime = normalizedTime;

    if (state.hasSelection && !looped && elapsed < motion.reselectIntervalSeconds) {
        return;
    }

    const trajectoryX = readParameter(parameters, motion.trajectoryXParameter);
    const trajectoryZ = readParameter(parameters, motion.trajectoryZParameter);
    const facingX = readParameter(parameters, motion.facingXParameter);
    const facingZ = readParameter(parameters, motion.facingZParameter);

    const best = motion.database.searchBest({
        desiredTrajectoryPosition: [trajectoryX, 0, trajectoryZ],
        desiredFacingDirection: [facingX, 0, facingZ],
        currentClipId: state.clipId,
        continuityBias: motion.continuityBias,
    });
    if (best === null) {
        state.hasSelection = true;
        return;
    }

    const clip = motion.clips.get(best.clipId) ?? null;
    if (clip === null) {
        // The database references a clip the controller does not know: keep the
        // previous selection instead of sampling a missing clip.
        state.hasSelection = true;
        return;
    }

    state.clipId = best.clipId;
    state.clip = clip;
    state.startTime = best.time;
    state.duration = clip.duration;
    state.hasSelection = true;
};

/**
 * Maps the motion timeline onto the selected clip. The selection owns the
 * start time inside the clip, so the node samples a window that begins at the
 * matched pose.
 */
export const resolveMotionMatchingTime = (
    motion: AnimationCompiledMotionMatchingMotion,
    normalizedTime: number
): number => {
    const state = motion.state;
    const clip = state.clip;
    if (clip === null || state.duration <= EPSILON) {
        return 0;
    }
    const absolute = state.startTime + normalizedTime * state.duration;
    return clip.duration > EPSILON ? absolute / clip.duration : 0;
};

/**
 * Duration of the currently selected clip. Without a selection the node
 * reports the duration of the first clip the database knows, so the timeline
 * advances at a sane rate before the first search runs.
 */
export const resolveMotionMatchingDuration = (
    motion: AnimationCompiledMotionMatchingMotion
): number => {
    const state = motion.state;
    if (state.hasSelection && state.clip !== null) {
        return state.clip.duration;
    }

    const clipIds = motion.database.clipIds;
    for (let index = 0; index < clipIds.length; index += 1) {
        const clip = motion.clips.get(clipIds[index]!);
        if (clip !== undefined) {
            return clip.duration;
        }
    }
    return 0;
};

const readParameter = (parameters: AnimationParameterStore, name: string): number => {
    if (!parameters.has(name)) {
        return 0;
    }
    const value = parameters.get(name);
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

/**
 * Validates a motion-matching definition before it is compiled.
 */
export const validateMotionMatchingDefinition = (
    definition: {
        readonly id?: unknown;
        readonly reselectIntervalSeconds?: number;
        readonly continuityBias?: number;
        readonly trajectoryXParameter?: unknown;
        readonly trajectoryZParameter?: unknown;
        readonly facingXParameter?: unknown;
        readonly facingZParameter?: unknown;
    },
    label: string
): void => {
    const reselectInterval = definition.reselectIntervalSeconds ?? MOTION_MATCH_DEFAULT_RESELECT_INTERVAL;
    if (!Number.isFinite(reselectInterval) || reselectInterval < 0) {
        throw new AnimationValidationError(
            `Motion-matching reselect interval must be finite and non-negative (${label})`
        );
    }

    const continuityBias = definition.continuityBias ?? MOTION_MATCH_DEFAULT_CONTINUITY_BIAS;
    if (!Number.isFinite(continuityBias) || continuityBias < 0) {
        throw new AnimationValidationError(
            `Motion-matching continuity bias must be finite and non-negative (${label})`
        );
    }

    for (const parameter of [
        definition.trajectoryXParameter,
        definition.trajectoryZParameter,
        definition.facingXParameter,
        definition.facingZParameter,
    ]) {
        if (typeof parameter !== 'string' || parameter.length === 0) {
            throw new AnimationValidationError(
                `Motion-matching requires non-empty parameter names (${label})`
            );
        }
    }
};
