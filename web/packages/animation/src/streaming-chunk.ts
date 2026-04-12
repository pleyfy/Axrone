import { AnimationValidationError } from './errors';
import type { AnimationClipDefinition, AnimationTrackDefinition } from './types';

export type AnimationClipStreamingChunkMergeMode = 'replace-range' | 'replace-all';

export interface AnimationClipStreamingChunkPayload {
    readonly version?: 1;
    readonly clipId?: string;
    readonly mergeMode?: AnimationClipStreamingChunkMergeMode;
    readonly startTime?: number;
    readonly endTime?: number;
    readonly duration?: number;
    readonly tracks: readonly AnimationTrackDefinition[];
}

export interface AnimationClipStreamingChunkApplicationOptions {
    readonly clipId?: string;
    readonly startTime?: number;
    readonly endTime?: number;
}

interface AnimationTrackSampleFrame {
    readonly time: number;
    readonly sample: readonly number[];
}

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && Array.isArray(value) === false;

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const toReadonlyNumberArray = (
    value: readonly number[] | Float32Array
): readonly number[] | Float32Array => (value instanceof Float32Array ? new Float32Array(value) : [...value]);

const toTrackKey = (track: AnimationTrackDefinition): string => `${track.path}:${track.target}`;

const getTrackKeyframeCount = (track: AnimationTrackDefinition): number => track.keyframeCount ?? track.times.length;

const getTrackSampleStride = (track: AnimationTrackDefinition): number => {
    const keyframeCount = getTrackKeyframeCount(track);
    if (keyframeCount <= 0) {
        return 0;
    }
    if (typeof track.sampleStride === 'number' && Number.isFinite(track.sampleStride)) {
        return Math.trunc(track.sampleStride);
    }
    const valueLength = track.values.length;
    return Math.trunc(valueLength / keyframeCount);
};

const getTrackComponentCount = (track: AnimationTrackDefinition): number => {
    if (typeof track.valueComponentCount === 'number' && Number.isFinite(track.valueComponentCount)) {
        return Math.trunc(track.valueComponentCount);
    }
    switch (track.path) {
        case 'translation':
        case 'scale':
            return 3;
        case 'rotation':
            return 4;
        case 'weights': {
            const stride = getTrackSampleStride(track);
            if (track.interpolation === 'CUBICSPLINE') {
                return Math.trunc(stride / 3);
            }
            return stride;
        }
        default:
            return 0;
    }
};

const normalizeTrackDefinition = (track: AnimationTrackDefinition): AnimationTrackDefinition => {
    if (!track || typeof track.target !== 'string' || track.target.length === 0) {
        throw new AnimationValidationError('Streaming animation tracks require a non-empty target');
    }
    const keyframeCount = getTrackKeyframeCount(track);
    const sampleStride = getTrackSampleStride(track);
    const componentCount = getTrackComponentCount(track);
    if (!Number.isInteger(keyframeCount) || keyframeCount < 0) {
        throw new AnimationValidationError(
            `Streaming animation track '${track.target}/${track.path}' has invalid keyframeCount`
        );
    }
    if (!Number.isInteger(sampleStride) || sampleStride < 0) {
        throw new AnimationValidationError(
            `Streaming animation track '${track.target}/${track.path}' has invalid sampleStride`
        );
    }
    if (!Number.isInteger(componentCount) || componentCount < 0) {
        throw new AnimationValidationError(
            `Streaming animation track '${track.target}/${track.path}' has invalid valueComponentCount`
        );
    }
    if (track.times.length !== keyframeCount) {
        throw new AnimationValidationError(
            `Streaming animation track '${track.target}/${track.path}' times length does not match keyframeCount`
        );
    }
    if (sampleStride * keyframeCount !== track.values.length) {
        throw new AnimationValidationError(
            `Streaming animation track '${track.target}/${track.path}' has inconsistent values length`
        );
    }

    return Object.freeze({
        target: track.target,
        path: track.path,
        ...(typeof track.interpolation === 'string' ? { interpolation: track.interpolation } : {}),
        times: toReadonlyNumberArray(track.times),
        values: toReadonlyNumberArray(track.values),
        ...(keyframeCount > 0 ? { keyframeCount } : {}),
        ...(sampleStride > 0 ? { sampleStride } : {}),
        ...(componentCount > 0 ? { valueComponentCount: componentCount } : {}),
    });
};

const normalizeChunkPayload = (
    payload: AnimationClipStreamingChunkPayload
): AnimationClipStreamingChunkPayload => {
    if (!Array.isArray(payload.tracks)) {
        throw new AnimationValidationError('Animation streaming chunks require a tracks array');
    }

    return Object.freeze({
        ...(payload.version === 1 ? { version: 1 as const } : {}),
        ...(typeof payload.clipId === 'string' && payload.clipId.length > 0 ? { clipId: payload.clipId } : {}),
        ...(payload.mergeMode === 'replace-all' ? { mergeMode: 'replace-all' as const } : {}),
        ...(isFiniteNumber(payload.startTime) ? { startTime: payload.startTime } : {}),
        ...(isFiniteNumber(payload.endTime) ? { endTime: payload.endTime } : {}),
        ...(isFiniteNumber(payload.duration) ? { duration: Math.max(0, payload.duration) } : {}),
        tracks: Object.freeze(payload.tracks.map(normalizeTrackDefinition)),
    });
};

const decodeChunkSource = (
    source: string | Uint8Array | ArrayBuffer | ArrayBufferView
): string => {
    if (typeof source === 'string') {
        return source;
    }
    if (source instanceof Uint8Array) {
        return textDecoder.decode(source);
    }
    if (ArrayBuffer.isView(source)) {
        return textDecoder.decode(new Uint8Array(source.buffer, source.byteOffset, source.byteLength));
    }
    return textDecoder.decode(new Uint8Array(source));
};

const extractTrackFrames = (track: AnimationTrackDefinition): AnimationTrackSampleFrame[] => {
    const keyframeCount = getTrackKeyframeCount(track);
    const sampleStride = getTrackSampleStride(track);
    const frames: AnimationTrackSampleFrame[] = [];
    for (let index = 0; index < keyframeCount; index += 1) {
        const time = Number(track.times[index] ?? 0);
        const sampleOffset = index * sampleStride;
        frames.push(
            Object.freeze({
                time,
                sample: Object.freeze(
                    Array.from({ length: sampleStride }, (_, sampleIndex) =>
                        Number(track.values[sampleOffset + sampleIndex] ?? 0)
                    )
                ),
            })
        );
    }
    return frames;
};

const buildTrackFromFrames = (
    template: AnimationTrackDefinition,
    frames: readonly AnimationTrackSampleFrame[]
): AnimationTrackDefinition => {
    const sampleStride = getTrackSampleStride(template);
    const times = new Float32Array(frames.length);
    const values = new Float32Array(frames.length * sampleStride);
    for (let index = 0; index < frames.length; index += 1) {
        const frame = frames[index]!;
        times[index] = frame.time;
        const valueOffset = index * sampleStride;
        for (let sampleIndex = 0; sampleIndex < sampleStride; sampleIndex += 1) {
            values[valueOffset + sampleIndex] = frame.sample[sampleIndex] ?? 0;
        }
    }

    return Object.freeze({
        target: template.target,
        path: template.path,
        ...(typeof template.interpolation === 'string' ? { interpolation: template.interpolation } : {}),
        times,
        values,
        keyframeCount: frames.length,
        sampleStride,
        valueComponentCount: getTrackComponentCount(template),
    });
};

const mergeTrackDefinitions = (
    existing: AnimationTrackDefinition | undefined,
    incoming: AnimationTrackDefinition,
    mergeMode: AnimationClipStreamingChunkMergeMode,
    startTime: number,
    endTime: number
): AnimationTrackDefinition => {
    if (!existing || mergeMode === 'replace-all') {
        return incoming;
    }

    if (
        existing.path !== incoming.path ||
        existing.target !== incoming.target ||
        existing.interpolation !== incoming.interpolation ||
        getTrackSampleStride(existing) !== getTrackSampleStride(incoming) ||
        getTrackComponentCount(existing) !== getTrackComponentCount(incoming)
    ) {
        const retainedExisting = extractTrackFrames(existing).filter(
            (frame) => frame.time < startTime || frame.time > endTime
        );
        if (retainedExisting.length > 0) {
            throw new AnimationValidationError(
                `Streaming chunk for '${incoming.target}/${incoming.path}' cannot be merged with an incompatible existing track`
            );
        }
        return incoming;
    }

    const retainedExistingFrames = extractTrackFrames(existing).filter(
        (frame) => frame.time < startTime || frame.time > endTime
    );
    const incomingFrames = extractTrackFrames(incoming);
    const merged = [...retainedExistingFrames, ...incomingFrames]
        .sort((left, right) => left.time - right.time);

    const deduped: AnimationTrackSampleFrame[] = [];
    for (let index = 0; index < merged.length; index += 1) {
        const frame = merged[index]!;
        const previous = deduped[deduped.length - 1];
        if (previous && Math.abs(previous.time - frame.time) <= 1e-6) {
            deduped[deduped.length - 1] = frame;
            continue;
        }
        deduped.push(frame);
    }

    return buildTrackFromFrames(incoming, deduped);
};

const inferChunkRange = (
    payload: AnimationClipStreamingChunkPayload,
    options: AnimationClipStreamingChunkApplicationOptions
): readonly [number, number] => {
    if (isFiniteNumber(payload.startTime) || isFiniteNumber(payload.endTime)) {
        const start = isFiniteNumber(payload.startTime) ? payload.startTime : payload.endTime ?? 0;
        const end = isFiniteNumber(payload.endTime) ? payload.endTime : payload.startTime ?? start;
        return start <= end ? [start, end] : [end, start];
    }
    if (isFiniteNumber(options.startTime) || isFiniteNumber(options.endTime)) {
        const start = isFiniteNumber(options.startTime) ? options.startTime : options.endTime ?? 0;
        const end = isFiniteNumber(options.endTime) ? options.endTime : options.startTime ?? start;
        return start <= end ? [start, end] : [end, start];
    }

    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (let index = 0; index < payload.tracks.length; index += 1) {
        const track = payload.tracks[index]!;
        const firstTime = Number(track.times[0] ?? 0);
        const lastTime = Number(track.times[Math.max(0, track.times.length - 1)] ?? 0);
        start = Math.min(start, firstTime);
        end = Math.max(end, lastTime);
    }
    if (!Number.isFinite(start)) {
        return [0, 0];
    }
    return [start, end];
};

const resolveDuration = (
    base: AnimationClipDefinition,
    payload: AnimationClipStreamingChunkPayload,
    tracks: readonly AnimationTrackDefinition[]
): number => {
    if (isFiniteNumber(payload.duration)) {
        return Math.max(0, payload.duration);
    }

    let duration =
        typeof base.duration === 'number' && Number.isFinite(base.duration) ? Math.max(0, base.duration) : 0;
    for (let index = 0; index < tracks.length; index += 1) {
        const track = tracks[index]!;
        duration = Math.max(duration, Number(track.times[Math.max(0, track.times.length - 1)] ?? 0));
    }
    return duration;
};

export const encodeAnimationClipStreamingChunkPayload = (
    payload: AnimationClipStreamingChunkPayload
): Uint8Array => textEncoder.encode(JSON.stringify(normalizeChunkPayload(payload)));

export const decodeAnimationClipStreamingChunkPayload = (
    source: string | Uint8Array | ArrayBuffer | ArrayBufferView
): AnimationClipStreamingChunkPayload => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeChunkSource(source));
    } catch (error) {
        throw new AnimationValidationError(
            `Failed to parse animation streaming chunk payload: ${error instanceof Error ? error.message : String(error)}`
        );
    }
    if (!isRecord(parsed)) {
        throw new AnimationValidationError('Animation streaming chunk payload must be a JSON object');
    }
    return normalizeChunkPayload(parsed as unknown as AnimationClipStreamingChunkPayload);
};

export const applyAnimationClipStreamingChunkDefinition = (
    base: AnimationClipDefinition,
    payload: AnimationClipStreamingChunkPayload,
    options: AnimationClipStreamingChunkApplicationOptions = {}
): AnimationClipDefinition => {
    const normalizedPayload = normalizeChunkPayload(payload);
    const expectedClipId = options.clipId ?? base.id;
    if (normalizedPayload.clipId && normalizedPayload.clipId !== expectedClipId) {
        throw new AnimationValidationError(
            `Streaming chunk targets clip '${normalizedPayload.clipId}', expected '${expectedClipId}'`
        );
    }

    const mergeMode = normalizedPayload.mergeMode ?? 'replace-range';
    const [startTime, endTime] = inferChunkRange(normalizedPayload, options);
    const incomingByKey = new Map<string, AnimationTrackDefinition>();
    for (let index = 0; index < normalizedPayload.tracks.length; index += 1) {
        const track = normalizedPayload.tracks[index]!;
        const key = toTrackKey(track);
        if (incomingByKey.has(key)) {
            throw new AnimationValidationError(
                `Streaming chunk contains duplicate track '${track.target}/${track.path}'`
            );
        }
        incomingByKey.set(key, track);
    }

    const mergedTracks: AnimationTrackDefinition[] = [];
    const consumedKeys = new Set<string>();
    for (let index = 0; index < base.tracks.length; index += 1) {
        const existing = normalizeTrackDefinition(base.tracks[index]!);
        const key = toTrackKey(existing);
        const incoming = incomingByKey.get(key);
        if (!incoming) {
            mergedTracks.push(existing);
            continue;
        }
        mergedTracks.push(mergeTrackDefinitions(existing, incoming, mergeMode, startTime, endTime));
        consumedKeys.add(key);
    }

    for (const [key, incoming] of incomingByKey.entries()) {
        if (consumedKeys.has(key)) {
            continue;
        }
        mergedTracks.push(incoming);
    }

    return Object.freeze({
        ...base,
        id: expectedClipId,
        duration: resolveDuration(base, normalizedPayload, mergedTracks),
        tracks: Object.freeze(mergedTracks),
    } satisfies AnimationClipDefinition);
};