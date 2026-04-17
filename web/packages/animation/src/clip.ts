import { AnimationSamplingError, AnimationValidationError } from './errors';
import { clamp, quatCopy, quatIdentity, quatInvert, quatMultiply, quatNormalize, quatSlerp, toFloat32Array, vec3Copy, vec3Lerp } from './math';
import type { AnimationCurveLayout, AnimationFrame } from './pose';
import type { AnimationRig } from './rig';
import {
    applyAnimationClipStreamingChunkDefinition,
    type AnimationClipStreamingChunkApplicationOptions,
    type AnimationClipStreamingChunkPayload,
} from './streaming-chunk';
import type {
    AnimationClipCompressionDefinition,
    AnimationClipDefinition,
    AnimationClipEventDefinition,
    AnimationClipEventOccurrence,
    AnimationFootContactDefinition,
    AnimationFootContactState,
    AnimationInterpolation,
    AnimationMotionFeatureDefinition,
    AnimationTrackDefinition,
    AnimationClipStreamingCatalogDefinition,
    AnimationClipStreamingChunkDefinition,
    AnimationClipStreamingDefinition,
} from './types';

const enum AnimationInterpolationMode {
    Linear = 0,
    Step = 1,
    CubicSpline = 2,
}

interface AnimationBoneTrack {
    readonly targetIndex: number;
    readonly path: AnimationTrackDefinition['path'];
    readonly interpolation: AnimationInterpolationMode;
    readonly times: Float32Array;
    readonly values: Float32Array;
    readonly keyframeCount: number;
    readonly valueComponentCount: number;
    readonly sampleStride: number;
}

interface AnimationCurveTrack extends AnimationBoneTrack {
    readonly curveOffset: number;
    readonly curveComponentCount: number;
}

const resolveInterpolationMode = (
    value: AnimationInterpolation | undefined
): AnimationInterpolationMode => {
    switch (value) {
        case 'STEP':
            return AnimationInterpolationMode.Step;
        case 'CUBICSPLINE':
            return AnimationInterpolationMode.CubicSpline;
        case 'LINEAR':
        case undefined:
            return AnimationInterpolationMode.Linear;
        default:
            throw new AnimationValidationError(`Unsupported interpolation '${String(value)}'`);
    }
};

const findFrameIndex = (times: Float32Array, time: number): number => {
    if (times.length <= 1 || time <= times[0]!) {
        return 0;
    }
    const lastIndex = times.length - 1;
    if (time >= times[lastIndex]!) {
        return Math.max(0, lastIndex - 1);
    }

    let low = 0;
    let high = lastIndex;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const start = times[mid]!;
        const end = times[mid + 1] ?? Number.POSITIVE_INFINITY;
        if (time < start) {
            high = mid - 1;
            continue;
        }
        if (time >= end) {
            low = mid + 1;
            continue;
        }
        return mid;
    }

    return Math.max(0, Math.min(lastIndex - 1, low));
};

const resolveTrackStride = (track: AnimationTrackDefinition, times: Float32Array, values: Float32Array): {
    readonly keyframeCount: number;
    readonly valueComponentCount: number;
    readonly sampleStride: number;
} => {
    const keyframeCount = track.keyframeCount ?? times.length;
    if (!Number.isInteger(keyframeCount) || keyframeCount <= 0) {
        throw new AnimationValidationError(`Animation track '${track.target}/${track.path}' has invalid keyframeCount`);
    }
    if (times.length !== keyframeCount) {
        throw new AnimationValidationError(
            `Animation track '${track.target}/${track.path}' times length does not match keyframeCount`
        );
    }
    const interpolation = resolveInterpolationMode(track.interpolation);
    const sampleStride =
        track.sampleStride ??
        (keyframeCount > 0 ? values.length / keyframeCount : track.valueComponentCount ?? 0);
    const valueComponentCount =
        track.valueComponentCount ??
        (interpolation === AnimationInterpolationMode.CubicSpline ? sampleStride / 3 : sampleStride);

    if (
        !Number.isInteger(sampleStride) ||
        !Number.isInteger(valueComponentCount) ||
        sampleStride <= 0 ||
        valueComponentCount <= 0 ||
        sampleStride * keyframeCount !== values.length
    ) {
        throw new AnimationValidationError(
            `Animation track '${track.target}/${track.path}' has inconsistent values layout`
        );
    }

    if (track.path === 'translation' || track.path === 'scale') {
        if (valueComponentCount !== 3) {
            throw new AnimationValidationError(
                `Animation track '${track.target}/${track.path}' requires 3 value components`
            );
        }
    }
    if (track.path === 'rotation' && valueComponentCount !== 4) {
        throw new AnimationValidationError(
            `Animation track '${track.target}/${track.path}' requires 4 value components`
        );
    }

    return {
        keyframeCount,
        valueComponentCount,
        sampleStride,
    };
};

const sampleTrack = (
    track: AnimationBoneTrack,
    time: number,
    componentCount: number,
    out: Float32Array,
    outOffset: number
): void => {
    const frameIndex = findFrameIndex(track.times, time);
    const nextIndex = Math.min(track.keyframeCount - 1, frameIndex + 1);
    const startTime = track.times[frameIndex] ?? 0;
    const endTime = track.times[nextIndex] ?? startTime;
    const duration = Math.max(0, endTime - startTime);
    const alpha = duration > 0 ? clamp((time - startTime) / duration, 0, 1) : 0;

    if (track.interpolation === AnimationInterpolationMode.Step || frameIndex === nextIndex) {
        const baseOffset =
            frameIndex * track.sampleStride +
            (track.interpolation === AnimationInterpolationMode.CubicSpline
                ? track.valueComponentCount
                : 0);
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
            out[outOffset + componentIndex] =
                track.values[baseOffset + componentIndex] ?? (componentIndex === 3 ? 1 : 0);
        }
        return;
    }

    if (track.interpolation === AnimationInterpolationMode.CubicSpline) {
        const leftBase = frameIndex * track.sampleStride;
        const rightBase = nextIndex * track.sampleStride;
        const s = alpha;
        const s2 = s * s;
        const s3 = s2 * s;
        const h00 = 2 * s3 - 3 * s2 + 1;
        const h10 = s3 - 2 * s2 + s;
        const h01 = -2 * s3 + 3 * s2;
        const h11 = s3 - s2;
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
            const inTangent = track.values[rightBase + componentIndex] ?? 0;
            const value0 = track.values[leftBase + track.valueComponentCount + componentIndex] ?? 0;
            const outTangent =
                track.values[leftBase + track.valueComponentCount * 2 + componentIndex] ?? 0;
            const value1 =
                track.values[rightBase + track.valueComponentCount + componentIndex] ?? 0;
            out[outOffset + componentIndex] =
                h00 * value0 +
                h10 * duration * outTangent +
                h01 * value1 +
                h11 * duration * inTangent;
        }
        return;
    }

    const leftOffset = frameIndex * track.sampleStride;
    const rightOffset = nextIndex * track.sampleStride;
    if (track.path === 'rotation' && componentCount === 4) {
        quatSlerp(out, outOffset, track.values, leftOffset, track.values, rightOffset, alpha);
        return;
    }

    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
        const left = track.values[leftOffset + componentIndex] ?? 0;
        const right = track.values[rightOffset + componentIndex] ?? left;
        out[outOffset + componentIndex] = left + (right - left) * alpha;
    }
};

const wrapClipTime = (time: number, duration: number): number => {
    if (duration <= 0) {
        return 0;
    }
    const wrapped = time % duration;
    return wrapped < 0 ? wrapped + duration : wrapped;
};

const cloneMetadataRecord = (
    value: Readonly<Record<string, unknown>> | null | undefined
): Readonly<Record<string, unknown>> | null | undefined => {
    if (value === null || value === undefined) {
        return value;
    }

    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        cloned[key] = entry;
    }
    return Object.freeze(cloned);
};

const sanitizeTags = (value: readonly string[] | undefined): readonly string[] =>
    Object.freeze(
        [...new Set((value ?? []).filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))]
    );

const sanitizeClipEvents = (
    events: readonly AnimationClipEventDefinition[] | undefined,
    duration: number
): readonly AnimationClipEventDefinition[] =>
    Object.freeze(
        (events ?? [])
            .filter(
                (event): event is AnimationClipEventDefinition =>
                    Boolean(
                        event &&
                            typeof event.name === 'string' &&
                            event.name.length > 0 &&
                            typeof event.time === 'number' &&
                            Number.isFinite(event.time)
                    )
            )
            .map((event) =>
                Object.freeze({
                    ...(typeof event.id === 'string' && event.id.length > 0 ? { id: event.id } : {}),
                    name: event.name,
                    time: clamp(event.time, 0, duration),
                    ...(event.payload !== undefined
                        ? { payload: cloneMetadataRecord(event.payload) ?? null }
                        : {}),
                    ...(event.tags && event.tags.length > 0 ? { tags: sanitizeTags(event.tags) } : {}),
                } satisfies AnimationClipEventDefinition)
            )
            .sort((left, right) => left.time - right.time)
    );

const sanitizeFootContacts = (
    contacts: readonly AnimationFootContactDefinition[] | undefined,
    duration: number
): readonly AnimationFootContactDefinition[] =>
    Object.freeze(
        (contacts ?? [])
            .filter(
                (contact): contact is AnimationFootContactDefinition =>
                    Boolean(
                        contact &&
                            typeof contact.bone === 'string' &&
                            contact.bone.length > 0 &&
                            typeof contact.startTime === 'number' &&
                            typeof contact.endTime === 'number' &&
                            Number.isFinite(contact.startTime) &&
                            Number.isFinite(contact.endTime)
                    )
            )
            .map((contact) => {
                const startTime = clamp(Math.min(contact.startTime, contact.endTime), 0, duration);
                const endTime = clamp(Math.max(contact.startTime, contact.endTime), 0, duration);
                return Object.freeze({
                    bone: contact.bone,
                    startTime,
                    endTime,
                    ...(contact.lockTranslationAxes
                        ? {
                              lockTranslationAxes: Object.freeze([
                                  contact.lockTranslationAxes[0],
                                  contact.lockTranslationAxes[1],
                                  contact.lockTranslationAxes[2],
                              ]) as readonly [boolean, boolean, boolean],
                          }
                        : {}),
                    ...(contact.metadata ? { metadata: cloneMetadataRecord(contact.metadata) ?? {} } : {}),
                } satisfies AnimationFootContactDefinition);
            })
    );

const sanitizeMotionFeatures = (
    features: readonly AnimationMotionFeatureDefinition[] | undefined,
    duration: number
): readonly AnimationMotionFeatureDefinition[] =>
    Object.freeze(
        (features ?? [])
            .filter(
                (feature): feature is AnimationMotionFeatureDefinition =>
                    Boolean(feature && typeof feature.time === 'number' && Number.isFinite(feature.time))
            )
            .map((feature) =>
                Object.freeze({
                    time: clamp(feature.time, 0, duration),
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
                    ...(feature.tags && feature.tags.length > 0
                        ? { tags: sanitizeTags(feature.tags) }
                        : {}),
                    ...(typeof feature.costBias === 'number' && Number.isFinite(feature.costBias)
                        ? { costBias: feature.costBias }
                        : {}),
                } satisfies AnimationMotionFeatureDefinition)
            )
            .sort((left, right) => left.time - right.time)
    );

const sanitizeStreamingChunks = (
    chunks: readonly AnimationClipStreamingChunkDefinition[] | undefined,
    duration: number
): readonly AnimationClipStreamingChunkDefinition[] | undefined => {
    if (!Array.isArray(chunks) || chunks.length === 0) {
        return undefined;
    }

    const sanitized = chunks
        .filter(
            (chunk): chunk is AnimationClipStreamingChunkDefinition =>
                Boolean(
                    chunk &&
                        typeof chunk.uri === 'string' &&
                        chunk.uri.length > 0 &&
                        typeof chunk.startTime === 'number' &&
                        typeof chunk.endTime === 'number' &&
                        Number.isFinite(chunk.startTime) &&
                        Number.isFinite(chunk.endTime)
                )
        )
        .map((chunk) => {
            const startTime = clamp(Math.min(chunk.startTime, chunk.endTime), 0, duration);
            const endTime = clamp(Math.max(chunk.startTime, chunk.endTime), 0, duration);
            return Object.freeze({
                ...(typeof chunk.id === 'string' && chunk.id.length > 0 ? { id: chunk.id } : {}),
                uri: chunk.uri,
                startTime,
                endTime,
                ...(typeof chunk.byteOffset === 'number' && Number.isFinite(chunk.byteOffset)
                    ? { byteOffset: Math.max(0, Math.trunc(chunk.byteOffset)) }
                    : {}),
                ...(typeof chunk.byteLength === 'number' && Number.isFinite(chunk.byteLength)
                    ? { byteLength: Math.max(0, Math.trunc(chunk.byteLength)) }
                    : {}),
                ...(typeof chunk.mimeType === 'string' && chunk.mimeType.length > 0
                    ? { mimeType: chunk.mimeType }
                    : {}),
            } satisfies AnimationClipStreamingChunkDefinition);
        })
        .sort((left, right) => left.startTime - right.startTime || left.endTime - right.endTime);

    return sanitized.length > 0 ? Object.freeze(sanitized) : undefined;
};

const sanitizeStreamingCatalog = (
    catalog: AnimationClipStreamingCatalogDefinition | undefined,
    duration: number
): AnimationClipStreamingCatalogDefinition | undefined => {
    if (!catalog) {
        return undefined;
    }

    const chunks = sanitizeStreamingChunks(catalog.chunks, duration);
    if (!chunks) {
        return undefined;
    }

    return Object.freeze({
        ...(typeof catalog.id === 'string' && catalog.id.length > 0 ? { id: catalog.id } : {}),
        chunks,
    } satisfies AnimationClipStreamingCatalogDefinition);
};

const sanitizeStreamingDefinition = (
    streaming: AnimationClipStreamingDefinition | undefined,
    duration: number
): AnimationClipStreamingDefinition | null => {
    if (!streaming) {
        return null;
    }

    const catalog = sanitizeStreamingCatalog(streaming.catalog, duration);
    return Object.freeze({
        ...(typeof streaming.mode === 'string' ? { mode: streaming.mode } : {}),
        ...(typeof streaming.chunkDuration === 'number' && Number.isFinite(streaming.chunkDuration)
            ? { chunkDuration: Math.max(0, streaming.chunkDuration) }
            : {}),
        ...(typeof streaming.preloadWindow === 'number' && Number.isFinite(streaming.preloadWindow)
            ? { preloadWindow: Math.max(0, streaming.preloadWindow) }
            : {}),
        ...(typeof streaming.priority === 'number' && Number.isFinite(streaming.priority)
            ? { priority: Math.trunc(streaming.priority) }
            : {}),
        ...(typeof streaming.sourceUri === 'string' && streaming.sourceUri.length > 0
            ? { sourceUri: streaming.sourceUri }
            : {}),
        ...(typeof streaming.catalogUri === 'string' && streaming.catalogUri.length > 0
            ? { catalogUri: streaming.catalogUri }
            : {}),
        ...(catalog ? { catalog } : {}),
    } satisfies AnimationClipStreamingDefinition);
};

interface AnimationClipMutableFields {
    id: string;
    duration: number;
    translationTracks: readonly AnimationBoneTrack[];
    rotationTracks: readonly AnimationBoneTrack[];
    scaleTracks: readonly AnimationBoneTrack[];
    curveTracks: readonly AnimationCurveTrack[];
    events: readonly AnimationClipEventDefinition[];
    footContacts: readonly AnimationFootContactDefinition[];
    tags: readonly string[];
    features: readonly AnimationMotionFeatureDefinition[];
    compression: AnimationClipCompressionDefinition | null;
    streaming: AnimationClipStreamingDefinition | null;
}

export class AnimationClip {
    readonly id!: string;
    readonly duration!: number;
    readonly translationTracks!: readonly AnimationBoneTrack[];
    readonly rotationTracks!: readonly AnimationBoneTrack[];
    readonly scaleTracks!: readonly AnimationBoneTrack[];
    readonly curveTracks!: readonly AnimationCurveTrack[];
    readonly events!: readonly AnimationClipEventDefinition[];
    readonly footContacts!: readonly AnimationFootContactDefinition[];
    readonly tags!: readonly string[];
    readonly features!: readonly AnimationMotionFeatureDefinition[];
    readonly compression!: AnimationClipCompressionDefinition | null;
    readonly streaming!: AnimationClipStreamingDefinition | null;

    private readonly _translationTrackByTarget = new Map<number, AnimationBoneTrack>();
    private readonly _rotationTrackByTarget = new Map<number, AnimationBoneTrack>();
    private readonly _scaleTrackByTarget = new Map<number, AnimationBoneTrack>();
    private readonly _rig: AnimationRig;
    private readonly _curveLayout: AnimationCurveLayout;
    private readonly _sampleStartTranslation = new Float32Array(3);
    private readonly _sampleEndTranslation = new Float32Array(3);
    private readonly _sampleStartRotation = new Float32Array(4);
    private readonly _sampleEndRotation = new Float32Array(4);
    private readonly _sampleMidTranslation = new Float32Array(3);
    private readonly _sampleMidRotation = new Float32Array(4);
    private readonly _sampleZeroRotation = new Float32Array(4);
    private readonly _inverseQuaternion = new Float32Array(4);
    private _definition!: AnimationClipDefinition;

    constructor(
        definition: AnimationClipDefinition,
        rig: AnimationRig,
        curveLayout: AnimationCurveLayout
    ) {
        this._rig = rig;
        this._curveLayout = curveLayout;
        this._applyDefinition(definition);
    }

    get definition(): AnimationClipDefinition {
        return this._definition;
    }

    applyStreamingChunk(
        payload: AnimationClipStreamingChunkPayload,
        options: AnimationClipStreamingChunkApplicationOptions = {}
    ): this {
        this._applyDefinition(
            applyAnimationClipStreamingChunkDefinition(this._definition, payload, {
                clipId: this.id,
                ...options,
            })
        );
        return this;
    }

    private _applyDefinition(definition: AnimationClipDefinition): void {
        if (!definition || typeof definition.id !== 'string' || definition.id.length === 0) {
            throw new AnimationValidationError('Animation clips require a non-empty id');
        }

        const translationTracks: AnimationBoneTrack[] = [];
        const rotationTracks: AnimationBoneTrack[] = [];
        const scaleTracks: AnimationBoneTrack[] = [];
        const curveTracks: AnimationCurveTrack[] = [];
        let resolvedDuration =
            typeof definition.duration === 'number' && Number.isFinite(definition.duration)
                ? definition.duration
                : 0;

        this._translationTrackByTarget.clear();
        this._rotationTrackByTarget.clear();
        this._scaleTrackByTarget.clear();

        for (let trackIndex = 0; trackIndex < definition.tracks.length; trackIndex += 1) {
            const track = definition.tracks[trackIndex]!;
            const times = toFloat32Array(track.times);
            const values = toFloat32Array(track.values);
            const { keyframeCount, valueComponentCount, sampleStride } = resolveTrackStride(
                track,
                times,
                values
            );
            resolvedDuration = Math.max(resolvedDuration, times[times.length - 1] ?? 0);
            const baseTrack = Object.freeze({
                targetIndex: track.path === 'weights' ? -1 : this._rig.indexOfBone(track.target),
                path: track.path,
                interpolation: resolveInterpolationMode(track.interpolation),
                times,
                values,
                keyframeCount,
                valueComponentCount,
                sampleStride,
            } satisfies AnimationBoneTrack);

            switch (track.path) {
                case 'translation':
                    translationTracks.push(baseTrack);
                    this._translationTrackByTarget.set(baseTrack.targetIndex, baseTrack);
                    break;
                case 'rotation':
                    rotationTracks.push(baseTrack);
                    this._rotationTrackByTarget.set(baseTrack.targetIndex, baseTrack);
                    break;
                case 'scale':
                    scaleTracks.push(baseTrack);
                    this._scaleTrackByTarget.set(baseTrack.targetIndex, baseTrack);
                    break;
                case 'weights': {
                    const curveBinding = this._curveLayout.get(track.target);
                    if (!curveBinding) {
                        throw new AnimationValidationError(
                            `Animation clip '${definition.id}' references unknown curve '${track.target}'`
                        );
                    }
                    if (curveBinding.componentCount !== valueComponentCount) {
                        throw new AnimationValidationError(
                            `Animation clip '${definition.id}' curve '${track.target}' component count does not match layout`
                        );
                    }
                    curveTracks.push(
                        Object.freeze({
                            ...baseTrack,
                            curveOffset: curveBinding.offset,
                            curveComponentCount: curveBinding.componentCount,
                        })
                    );
                    break;
                }
                default:
                    throw new AnimationValidationError('Unsupported animation track path');
            }
        }

        const mutable = this as unknown as AnimationClipMutableFields;
        mutable.id = definition.id;
        mutable.duration = resolvedDuration;
        mutable.translationTracks = Object.freeze(translationTracks);
        mutable.rotationTracks = Object.freeze(rotationTracks);
        mutable.scaleTracks = Object.freeze(scaleTracks);
        mutable.curveTracks = Object.freeze(curveTracks);
        mutable.events = sanitizeClipEvents(definition.events, mutable.duration);
        mutable.footContacts = sanitizeFootContacts(definition.footContacts, mutable.duration);
        mutable.tags = sanitizeTags(definition.tags);
        mutable.features = sanitizeMotionFeatures(definition.features, mutable.duration);
        mutable.compression = definition.compression
            ? Object.freeze({ ...definition.compression })
            : null;
        mutable.streaming = sanitizeStreamingDefinition(definition.streaming, mutable.duration);
        this._definition = definition;
    }

    sampleTime(timeSeconds: number, frame: AnimationFrame): AnimationFrame {
        const sampleTimeValue = clamp(timeSeconds, 0, this.duration);
        for (let trackIndex = 0; trackIndex < this.translationTracks.length; trackIndex += 1) {
            const track = this.translationTracks[trackIndex]!;
            sampleTrack(track, sampleTimeValue, 3, frame.pose.translations, track.targetIndex * 3);
        }
        for (let trackIndex = 0; trackIndex < this.rotationTracks.length; trackIndex += 1) {
            const track = this.rotationTracks[trackIndex]!;
            sampleTrack(track, sampleTimeValue, 4, frame.pose.rotations, track.targetIndex * 4);
            quatNormalize(frame.pose.rotations, track.targetIndex * 4, frame.pose.rotations, track.targetIndex * 4);
        }
        for (let trackIndex = 0; trackIndex < this.scaleTracks.length; trackIndex += 1) {
            const track = this.scaleTracks[trackIndex]!;
            sampleTrack(track, sampleTimeValue, 3, frame.pose.scales, track.targetIndex * 3);
        }
        for (let trackIndex = 0; trackIndex < this.curveTracks.length; trackIndex += 1) {
            const track = this.curveTracks[trackIndex]!;
            sampleTrack(
                track,
                sampleTimeValue,
                track.curveComponentCount,
                frame.curves.values,
                track.curveOffset
            );
        }
        return frame;
    }

    sampleNormalizedTime(normalizedTime: number, frame: AnimationFrame): AnimationFrame {
        const timeSeconds = clamp(normalizedTime, 0, 1) * this.duration;
        return this.sampleTime(timeSeconds, frame);
    }

    collectEvents(
        startTimeSeconds: number,
        endTimeSeconds: number,
        loop: boolean,
        out: AnimationClipEventOccurrence[] = []
    ): readonly AnimationClipEventOccurrence[] {
        if (this.events.length === 0 || this.duration <= 0) {
            return out;
        }

        const pushRange = (rangeStart: number, rangeEnd: number): void => {
            for (let index = 0; index < this.events.length; index += 1) {
                const event = this.events[index]!;
                if (event.time <= rangeStart || event.time > rangeEnd) {
                    continue;
                }
                out.push(
                    Object.freeze({
                        clipId: this.id,
                        ...(event.id ? { id: event.id } : {}),
                        name: event.name,
                        time: event.time,
                        normalizedTime: this.duration > 0 ? event.time / this.duration : 0,
                        ...(event.payload !== undefined ? { payload: event.payload } : {}),
                        ...(event.tags ? { tags: event.tags } : {}),
                    } satisfies AnimationClipEventOccurrence)
                );
            }
        };

        const start = loop ? wrapClipTime(startTimeSeconds, this.duration) : clamp(startTimeSeconds, 0, this.duration);
        const end = loop ? wrapClipTime(endTimeSeconds, this.duration) : clamp(endTimeSeconds, 0, this.duration);
        if (loop && end < start) {
            pushRange(start, this.duration);
            pushRange(-Number.EPSILON, end);
            return out;
        }

        pushRange(start, end);
        return out;
    }

    sampleFootContacts(timeSeconds: number): readonly AnimationFootContactState[] {
        if (this.footContacts.length === 0 || this.duration <= 0) {
            return EMPTY_CONTACTS;
        }

        const sampleTimeValue = clamp(timeSeconds, 0, this.duration);
        return Object.freeze(
            this.footContacts.map((contact) => {
                const active = sampleTimeValue >= contact.startTime && sampleTimeValue <= contact.endTime;
                const span = Math.max(Number.EPSILON, contact.endTime - contact.startTime);
                const normalized = clamp((sampleTimeValue - contact.startTime) / span, 0, 1);
                const ramp = Math.min(normalized, 1 - normalized);
                const weight = active ? Math.min(1, Math.max(0.25, ramp * 4)) : 0;
                return Object.freeze({
                    bone: contact.bone,
                    active,
                    weight,
                    normalizedTime: this.duration > 0 ? sampleTimeValue / this.duration : 0,
                    ...(contact.lockTranslationAxes
                        ? { lockTranslationAxes: contact.lockTranslationAxes }
                        : {}),
                    ...(contact.metadata ? { metadata: contact.metadata } : {}),
                } satisfies AnimationFootContactState);
            })
        );
    }

    sampleBoneTransform(
        boneIndex: number,
        timeSeconds: number,
        rig: AnimationRig,
        outTranslation: Float32Array,
        outRotation: Float32Array,
        outScale?: Float32Array
    ): void {
        const translationOffset = boneIndex * 3;
        const rotationOffset = boneIndex * 4;
        vec3Copy(outTranslation, 0, rig.restTranslations, translationOffset);
        quatCopy(outRotation, 0, rig.restRotations, rotationOffset);
        if (outScale) {
            vec3Copy(outScale, 0, rig.restScales, translationOffset);
        }

        const sampleTimeValue = clamp(timeSeconds, 0, this.duration);
        const translationTrack = this._translationTrackByTarget.get(boneIndex);
        if (translationTrack) {
            sampleTrack(translationTrack, sampleTimeValue, 3, outTranslation, 0);
        }
        const rotationTrack = this._rotationTrackByTarget.get(boneIndex);
        if (rotationTrack) {
            sampleTrack(rotationTrack, sampleTimeValue, 4, outRotation, 0);
            quatNormalize(outRotation, 0, outRotation, 0);
        }
        if (outScale) {
            const scaleTrack = this._scaleTrackByTarget.get(boneIndex);
            if (scaleTrack) {
                sampleTrack(scaleTrack, sampleTimeValue, 3, outScale, 0);
            }
        }
    }

    extractBoneDelta(
        boneIndex: number,
        startTimeSeconds: number,
        endTimeSeconds: number,
        loop: boolean,
        rig: AnimationRig,
        outTranslation: Float32Array,
        outRotation: Float32Array
    ): void {
        if (this.duration <= 0) {
            outTranslation.fill(0);
            quatIdentity(outRotation, 0);
            return;
        }

        if (loop && endTimeSeconds < startTimeSeconds) {
            this.sampleBoneTransform(
                boneIndex,
                startTimeSeconds,
                rig,
                this._sampleStartTranslation,
                this._sampleStartRotation
            );
            this.sampleBoneTransform(
                boneIndex,
                this.duration,
                rig,
                this._sampleMidTranslation,
                this._sampleMidRotation
            );
            this.sampleBoneTransform(boneIndex, 0, rig, this._sampleEndTranslation, this._sampleZeroRotation);
            this.sampleBoneTransform(
                boneIndex,
                endTimeSeconds,
                rig,
                outTranslation,
                outRotation
            );

            outTranslation[0] =
                (this._sampleMidTranslation[0]! - this._sampleStartTranslation[0]!) +
                (outTranslation[0]! - this._sampleEndTranslation[0]!);
            outTranslation[1] =
                (this._sampleMidTranslation[1]! - this._sampleStartTranslation[1]!) +
                (outTranslation[1]! - this._sampleEndTranslation[1]!);
            outTranslation[2] =
                (this._sampleMidTranslation[2]! - this._sampleStartTranslation[2]!) +
                (outTranslation[2]! - this._sampleEndTranslation[2]!);

            quatInvert(this._inverseQuaternion, 0, this._sampleStartRotation, 0);
            quatMultiply(this._sampleMidRotation, 0, this._inverseQuaternion, 0, this._sampleMidRotation, 0);
            quatInvert(this._inverseQuaternion, 0, this._sampleZeroRotation, 0);
            quatMultiply(outRotation, 0, this._inverseQuaternion, 0, outRotation, 0);
            quatMultiply(outRotation, 0, this._sampleMidRotation, 0, outRotation, 0);
            quatNormalize(outRotation, 0, outRotation, 0);
            return;
        }

        this.sampleBoneTransform(
            boneIndex,
            loop ? wrapClipTime(startTimeSeconds, this.duration) : clamp(startTimeSeconds, 0, this.duration),
            rig,
            this._sampleStartTranslation,
            this._sampleStartRotation
        );
        this.sampleBoneTransform(
            boneIndex,
            loop ? wrapClipTime(endTimeSeconds, this.duration) : clamp(endTimeSeconds, 0, this.duration),
            rig,
            this._sampleEndTranslation,
            this._sampleEndRotation
        );

        outTranslation[0] = this._sampleEndTranslation[0]! - this._sampleStartTranslation[0]!;
        outTranslation[1] = this._sampleEndTranslation[1]! - this._sampleStartTranslation[1]!;
        outTranslation[2] = this._sampleEndTranslation[2]! - this._sampleStartTranslation[2]!;
        quatInvert(this._inverseQuaternion, 0, this._sampleStartRotation, 0);
        quatMultiply(outRotation, 0, this._inverseQuaternion, 0, this._sampleEndRotation, 0);
        quatNormalize(outRotation, 0, outRotation, 0);
    }
}

export const createAnimationClips = (
    definitions: readonly AnimationClipDefinition[],
    rig: AnimationRig,
    curveLayout: AnimationCurveLayout
): ReadonlyMap<string, AnimationClip> => {
    const clips = new Map<string, AnimationClip>();
    for (let index = 0; index < definitions.length; index += 1) {
        const definition = definitions[index]!;
        if (clips.has(definition.id)) {
            throw new AnimationValidationError(`Duplicate animation clip '${definition.id}'`);
        }
        clips.set(definition.id, new AnimationClip(definition, rig, curveLayout));
    }
    return clips;
};

const EMPTY_CONTACTS = Object.freeze([]) as readonly AnimationFootContactState[];