import type { AnimationTrackDefinition } from './types';

export const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const EMPTY_SPREAD: Readonly<Record<string, never>> = Object.freeze({}) as Readonly<Record<string, never>>;

export const spreadIfFinite = (key: string, value: unknown): Readonly<Record<string, unknown>> =>
    isFiniteNumber(value) ? { [key]: value } as Readonly<Record<string, unknown>> : EMPTY_SPREAD;

export const spreadIfNonEmptyString = (key: string, value: unknown): Readonly<Record<string, unknown>> =>
    typeof value === 'string' && value.length > 0 ? { [key]: value } as Readonly<Record<string, unknown>> : EMPTY_SPREAD;

export const getTrackComponentCount = (track: AnimationTrackDefinition): number => {
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
