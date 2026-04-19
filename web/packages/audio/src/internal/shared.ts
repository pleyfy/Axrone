import { AudioUnavailableError } from '../errors';
import { cloneAudioVector3 } from '../reference';
import type {
    AudioAssetSchema,
    AudioJsonValue,
    AudioRetryContext,
    AudioRetryPolicy,
    AudioVector3,
} from '../types';

export const DEFAULT_LISTENER_POSITION = Object.freeze({
    x: 0,
    y: 0,
    z: 0,
} satisfies AudioVector3);

export const DEFAULT_LISTENER_FORWARD = Object.freeze({
    x: 0,
    y: 0,
    z: -1,
} satisfies AudioVector3);

export const DEFAULT_LISTENER_UP = Object.freeze({
    x: 0,
    y: 1,
    z: 0,
} satisfies AudioVector3);

export const DEFAULT_SOURCE_POSITION = DEFAULT_LISTENER_POSITION;
export const DEFAULT_SOURCE_ORIENTATION = DEFAULT_LISTENER_FORWARD;

export const isObject = (value: unknown): value is Record<PropertyKey, unknown> =>
    typeof value === 'object' && value !== null;

export const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

export const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

export const cloneMetadata = (
    value: Readonly<Record<string, AudioJsonValue>> | undefined
): Readonly<Record<string, AudioJsonValue>> => Object.freeze({ ...(value ?? {}) });

export const normalizeVector3 = (value: AudioVector3 | undefined, fallback: AudioVector3): AudioVector3 => {
    const next = cloneAudioVector3(value, fallback);
    if (!isFiniteNumber(next.x) || !isFiniteNumber(next.y) || !isFiniteNumber(next.z)) {
        throw new TypeError('Audio vector values must be finite');
    }

    return next;
};

export const effectivePlaybackRate = (playbackRate: number, detuneCents: number): number =>
    playbackRate * 2 ** (detuneCents / 1200);

export const hasOwnKeys = (value: object): boolean => Object.keys(value).length > 0;

export const resolveContextFactory = (): (() => AudioContext) => {
    const GlobalAudioContext =
        (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!GlobalAudioContext) {
        throw new AudioUnavailableError('No AudioContext implementation is available');
    }

    return () => new GlobalAudioContext();
};

export const sleep = async (ms: number): Promise<void> => {
    if (ms <= 0) {
        return;
    }

    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
};

export const disconnectNode = (node: AudioNode | undefined): void => {
    if (!node) {
        return;
    }

    try {
        node.disconnect();
    } catch {}
};

export const setParamValue = (
    param: AudioParam,
    value: number,
    atTime: number,
    durationSeconds = 0
): void => {
    param.cancelScheduledValues(atTime);
    if (durationSeconds > 0) {
        param.setValueAtTime(param.value, atTime);
        param.linearRampToValueAtTime(value, atTime + durationSeconds);
        return;
    }

    param.setValueAtTime(value, atTime);
};

export const withRetry = async <
    TResult,
    TSchema extends AudioAssetSchema = AudioAssetSchema,
>(
    policy: AudioRetryPolicy<TSchema> | undefined,
    contextFactory: (attempt: number) => AudioRetryContext<TSchema>,
    operation: () => Promise<TResult>
): Promise<TResult> => {
    const attempts = Math.max(1, policy?.attempts ?? 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            const context = contextFactory(attempt);
            const shouldRetry = attempt < attempts && (policy?.shouldRetry?.(error, context) ?? true);
            if (!shouldRetry) {
                throw error;
            }
            const backoff =
                typeof policy?.backoffMs === 'function'
                    ? policy.backoffMs(attempt)
                    : (policy?.backoffMs ?? 0);
            await sleep(backoff);
        }
    }

    throw lastError;
};
