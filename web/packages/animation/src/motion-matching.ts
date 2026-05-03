import { AnimationClip } from './clip';
import type {
    AnimationClipDefinition,
    AnimationMotionFeatureDefinition,
    AnimationMotionMatchQuery,
    AnimationMotionMatchResult,
} from './types';

interface AnimationMotionMatchEntry {
    readonly clipId: string;
    readonly time: number;
    readonly tags: readonly string[];
    readonly trajectoryPosition?: readonly [number, number, number];
    readonly facingDirection?: readonly [number, number, number];
    readonly costBias: number;
}

const EMPTY_TAGS = Object.freeze([]) as readonly string[];

const normalizeTags = (value: readonly string[] | undefined): readonly string[] =>
    Object.freeze(
        [...new Set((value ?? []).filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))]
    );

const readClipMetadata = (
    clip: AnimationClip | AnimationClipDefinition
): {
    readonly id: string;
    readonly tags: readonly string[];
    readonly features: readonly AnimationMotionFeatureDefinition[];
} =>
    clip instanceof AnimationClip
        ? {
              id: clip.id,
              tags: clip.tags,
              features: clip.features,
          }
        : {
              id: clip.id,
              tags: normalizeTags(clip.tags),
              features: Object.freeze([...(clip.features ?? [])]),
          };

const squaredDistance3 = (
    left: readonly [number, number, number],
    right: readonly [number, number, number]
): number => {
    const dx = left[0] - right[0];
    const dy = left[1] - right[1];
    const dz = left[2] - right[2];
    return dx * dx + dy * dy + dz * dz;
};

const normalizedDot3 = (
    left: readonly [number, number, number],
    right: readonly [number, number, number]
): number => {
    const leftLength = Math.hypot(left[0], left[1], left[2]);
    const rightLength = Math.hypot(right[0], right[1], right[2]);
    if (leftLength <= Number.EPSILON || rightLength <= Number.EPSILON) {
        return 1;
    }
    return (
        (left[0] * right[0] + left[1] * right[1] + left[2] * right[2]) /
        (leftLength * rightLength)
    );
};

export class AnimationMotionMatchDatabase {
    private readonly _entries: readonly AnimationMotionMatchEntry[];

    constructor(clips: readonly (AnimationClip | AnimationClipDefinition)[]) {
        this._entries = Object.freeze(
            clips.flatMap((clip) => {
                const metadata = readClipMetadata(clip);
                if (metadata.features.length === 0) {
                    return [
                        Object.freeze({
                            clipId: metadata.id,
                            time: 0,
                            tags: metadata.tags,
                            costBias: 0,
                        } satisfies AnimationMotionMatchEntry),
                    ];
                }

                return metadata.features.map((feature) =>
                    Object.freeze({
                        clipId: metadata.id,
                        time: feature.time,
                        tags: normalizeTags([...(metadata.tags ?? EMPTY_TAGS), ...(feature.tags ?? EMPTY_TAGS)]),
                        ...(feature.trajectoryPosition
                            ? {
                                  trajectoryPosition: Object.freeze([
                                      feature.trajectoryPosition[0],
                                      feature.trajectoryPosition[1],
                                      feature.trajectoryPosition[2],
                                  ]) as readonly [number, number, number],
                              }
                            : {}),
                        ...(feature.facingDirection
                            ? {
                                  facingDirection: Object.freeze([
                                      feature.facingDirection[0],
                                      feature.facingDirection[1],
                                      feature.facingDirection[2],
                                  ]) as readonly [number, number, number],
                              }
                            : {}),
                        costBias:
                            typeof feature.costBias === 'number' && Number.isFinite(feature.costBias)
                                ? feature.costBias
                                : 0,
                    } satisfies AnimationMotionMatchEntry)
                );
            })
        );
    }

    get size(): number {
        return this._entries.length;
    }

    query(query: AnimationMotionMatchQuery): readonly AnimationMotionMatchResult[] {
        const requiredTags = new Set(normalizeTags(query.requiredTags));
        const excludedTags = new Set(normalizeTags(query.excludedTags));
        const continuityBias =
            typeof query.continuityBias === 'number' && Number.isFinite(query.continuityBias)
                ? query.continuityBias
                : 0;
        const maxResults =
            typeof query.maxResults === 'number' && Number.isFinite(query.maxResults)
                ? Math.max(1, Math.trunc(query.maxResults))
                : 1;

        return Object.freeze(
            this._entries
                .filter((entry) => {
                    for (const tag of requiredTags) {
                        if (entry.tags.includes(tag) === false) {
                            return false;
                        }
                    }
                    for (const tag of excludedTags) {
                        if (entry.tags.includes(tag)) {
                            return false;
                        }
                    }
                    return true;
                })
                .map((entry) => {
                    let score = entry.costBias;
                    if (query.desiredTrajectoryPosition && entry.trajectoryPosition) {
                        score += squaredDistance3(query.desiredTrajectoryPosition, entry.trajectoryPosition);
                    } else if (query.desiredTrajectoryPosition) {
                        score += 10;
                    }

                    if (query.desiredFacingDirection && entry.facingDirection) {
                        score += 1 - normalizedDot3(query.desiredFacingDirection, entry.facingDirection);
                    } else if (query.desiredFacingDirection) {
                        score += 5;
                    }

                    if (query.currentClipId && query.currentClipId === entry.clipId) {
                        score -= continuityBias;
                    }

                    return Object.freeze({
                        clipId: entry.clipId,
                        time: entry.time,
                        score,
                        tags: entry.tags,
                    } satisfies AnimationMotionMatchResult);
                })
                .sort((left, right) => left.score - right.score)
                .slice(0, maxResults)
        );
    }
}