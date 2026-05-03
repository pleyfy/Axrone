import {
    encodeAnimationClipStreamingChunkPayload,
    type AnimationClipDefinition,
    type AnimationClipStreamingCatalogDefinition,
    type AnimationClipStreamingChunkDefinition,
    type AnimationClipStreamingChunkMergeMode,
    type AnimationClipStreamingChunkPayload,
    type AnimationTrackDefinition,
} from '@axrone/animation';
import {
    createPortableAnimationManifest,
    type PortableAnimationClipManifestEntry,
} from './animation-manifest';
import type { GltfPackageResourceInput } from './types';

export const DEFAULT_ANIMATION_STREAMING_CHUNK_MIME_TYPE =
    'application/vnd.axrone.animation.clip-chunk+json';

export interface AnimationStreamingChunkResourceOptions {
    readonly uri: string;
    readonly payload: AnimationClipStreamingChunkPayload;
    readonly mimeType?: string;
}

export interface PortableAnimationStreamingChunkRangeDefinition {
    readonly id?: string;
    readonly uri?: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly mimeType?: string;
}

export interface PortableAnimationStreamingClipSource
    extends Pick<
        AnimationClipDefinition,
        'id' | 'duration' | 'tracks' | 'events' | 'footContacts' | 'tags' | 'features' | 'compression' | 'streaming'
    > {}

export interface PortableAnimationStreamingClipBundleOptions {
    readonly clip: PortableAnimationStreamingClipSource;
    readonly sourceUri?: string;
    readonly chunkDuration?: number;
    readonly chunks?: readonly PortableAnimationStreamingChunkRangeDefinition[];
    readonly mergeMode?: AnimationClipStreamingChunkMergeMode;
    readonly mimeType?: string;
    readonly preloadWindow?: number;
    readonly priority?: number;
    readonly catalogId?: string;
    readonly catalogUri?: string;
}

export interface PortableAnimationStreamingClipBundle {
    readonly clip: PortableAnimationClipManifestEntry;
    readonly catalog: AnimationClipStreamingCatalogDefinition;
    readonly payloads: readonly AnimationClipStreamingChunkPayload[];
    readonly resources: readonly GltfPackageResourceInput[];
}

interface NormalizedChunkRange extends PortableAnimationStreamingChunkRangeDefinition {
    readonly id: string;
    readonly uri: string;
    readonly startTime: number;
    readonly endTime: number;
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const sanitizeIdSegment = (value: string): string => {
    const sanitized = value
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    return sanitized.length > 0 ? sanitized : 'clip';
};

const basenameOfUri = (value: string): string => {
    const slashIndex = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
    return slashIndex >= 0 ? value.slice(slashIndex + 1) : value;
};

const splitExtension = (value: string): readonly [string, string] => {
    const basename = basenameOfUri(value);
    const extensionIndex = basename.lastIndexOf('.');
    if (extensionIndex <= 0) {
        return [value, ''];
    }
    const absoluteIndex = value.length - (basename.length - extensionIndex);
    return [value.slice(0, absoluteIndex), value.slice(absoluteIndex)];
};

const resolveChunkStem = (clipId: string, sourceUri: string | undefined): string => {
    if (sourceUri && sourceUri.length > 0) {
        const [stem] = splitExtension(sourceUri);
        return stem;
    }
    return sanitizeIdSegment(clipId);
};

const resolveChunkCatalogId = (
    clipId: string,
    sourceUri: string | undefined,
    explicitCatalogId: string | undefined,
    fallbackCatalogId: string | undefined
): string => {
    if (typeof explicitCatalogId === 'string' && explicitCatalogId.length > 0) {
        return explicitCatalogId;
    }
    if (typeof fallbackCatalogId === 'string' && fallbackCatalogId.length > 0) {
        return fallbackCatalogId;
    }
    return `${sanitizeIdSegment(basenameOfUri(resolveChunkStem(clipId, sourceUri)))}-stream`;
};

const createChunkUri = (sourceUri: string, chunkIndex: number): string => {
    const [stem, extension] = splitExtension(sourceUri);
    return `${stem}.${chunkIndex}${extension}`;
};

const resolveClipId = (clip: PortableAnimationStreamingClipSource): string => {
    const clipId = `${clip.id ?? ''}`.trim();
    if (clipId.length === 0) {
        throw new Error('Portable animation streaming clip bundles require a non-empty clip id');
    }
    return clipId;
};

const getTrackKeyframeCount = (track: AnimationTrackDefinition): number =>
    isFiniteNumber(track.keyframeCount) ? Math.max(0, Math.trunc(track.keyframeCount)) : track.times.length;

const getTrackSampleStride = (track: AnimationTrackDefinition, keyframeCount: number): number => {
    if (isFiniteNumber(track.sampleStride)) {
        return Math.max(0, Math.trunc(track.sampleStride));
    }
    return keyframeCount > 0 ? Math.max(0, Math.trunc(track.values.length / keyframeCount)) : 0;
};

const getTrackValueComponentCount = (
    track: AnimationTrackDefinition,
    sampleStride: number
): number => {
    if (isFiniteNumber(track.valueComponentCount)) {
        return Math.max(0, Math.trunc(track.valueComponentCount));
    }
    return track.interpolation === 'CUBICSPLINE' ? Math.max(0, Math.trunc(sampleStride / 3)) : sampleStride;
};

const toFloat32Array = (value: readonly number[] | Float32Array): Float32Array =>
    value instanceof Float32Array ? new Float32Array(value) : Float32Array.from(value);

const inferClipDuration = (clip: PortableAnimationStreamingClipSource): number => {
    let duration = isFiniteNumber(clip.duration) ? Math.max(0, clip.duration) : 0;
    for (let index = 0; index < clip.tracks.length; index += 1) {
        const track = clip.tracks[index]!;
        const keyframeCount = getTrackKeyframeCount(track);
        if (keyframeCount <= 0) {
            continue;
        }
        const lastTime = Number(track.times[Math.max(0, keyframeCount - 1)] ?? 0);
        duration = Math.max(duration, lastTime);
    }
    return duration;
};

const createChunkRangesFromDuration = (
    duration: number,
    chunkDuration: number,
    clipId: string,
    sourceUri: string | undefined
): readonly NormalizedChunkRange[] => {
    if (!isFiniteNumber(chunkDuration) || chunkDuration <= 0) {
        throw new Error('Portable animation streaming clip bundles require a positive chunkDuration');
    }

    const ranges: NormalizedChunkRange[] = [];
    const defaultStem = resolveChunkStem(clipId, sourceUri);
    const safeDuration = Math.max(0, duration);

    if (safeDuration <= 0) {
        if (!sourceUri) {
            throw new Error(
                'Portable animation streaming clip bundles require sourceUri when chunk URIs must be generated'
            );
        }
        ranges.push(
            Object.freeze({
                id: `${sanitizeIdSegment(basenameOfUri(defaultStem))}-0`,
                uri: createChunkUri(sourceUri, 0),
                startTime: 0,
                endTime: 0,
            })
        );
        return Object.freeze(ranges);
    }

    let startTime = 0;
    let chunkIndex = 0;
    while (startTime < safeDuration - 1e-6 || chunkIndex === 0) {
        const endTime = Math.min(safeDuration, startTime + chunkDuration);
        if (!sourceUri) {
            throw new Error(
                'Portable animation streaming clip bundles require sourceUri when chunk URIs must be generated'
            );
        }
        ranges.push(
            Object.freeze({
                id: `${sanitizeIdSegment(basenameOfUri(defaultStem))}-${chunkIndex}`,
                uri: createChunkUri(sourceUri, chunkIndex),
                startTime,
                endTime,
            })
        );
        if (endTime >= safeDuration) {
            break;
        }
        startTime = endTime;
        chunkIndex += 1;
    }

    return Object.freeze(ranges);
};

const normalizeChunkRanges = (
    options: PortableAnimationStreamingClipBundleOptions,
    clipId: string,
    duration: number,
    sourceUri: string | undefined
): readonly NormalizedChunkRange[] => {
    const explicitRanges =
        options.chunks ??
        options.clip.streaming?.catalog?.chunks?.map((chunk) => ({
            id: chunk.id,
            uri: chunk.uri,
            startTime: chunk.startTime,
            endTime: chunk.endTime,
            mimeType: chunk.mimeType,
        }));

    const defaultStem = resolveChunkStem(clipId, sourceUri);
    const ranges = explicitRanges
        ? explicitRanges.map((entry, index) => {
              const startTime = Math.max(0, Math.min(entry.startTime, entry.endTime));
              const endTime = Math.max(0, Math.max(entry.startTime, entry.endTime));
              const id =
                  typeof entry.id === 'string' && entry.id.length > 0
                      ? entry.id
                      : `${sanitizeIdSegment(basenameOfUri(defaultStem))}-${index}`;
              const uri =
                  typeof entry.uri === 'string' && entry.uri.length > 0
                      ? entry.uri
                      : sourceUri
                        ? createChunkUri(sourceUri, index)
                        : undefined;
              if (!uri) {
                  throw new Error(
                      'Portable animation streaming clip bundles require chunk URIs or a sourceUri to derive them'
                  );
              }
              return Object.freeze({
                  id,
                  uri,
                  startTime,
                  endTime,
                  ...(typeof entry.mimeType === 'string' && entry.mimeType.length > 0
                      ? { mimeType: entry.mimeType }
                      : {}),
              });
          })
        : createChunkRangesFromDuration(
              duration,
              options.chunkDuration ?? options.clip.streaming?.chunkDuration ?? Number.NaN,
              clipId,
              sourceUri
          );

    if (ranges.length === 0) {
        throw new Error('Portable animation streaming clip bundles require at least one chunk range');
    }

    const sorted = [...ranges].sort((left, right) => {
        if (left.startTime !== right.startTime) {
            return left.startTime - right.startTime;
        }
        if (left.endTime !== right.endTime) {
            return left.endTime - right.endTime;
        }
        return left.uri.localeCompare(right.uri);
    });

    const seenIds = new Set<string>();
    const seenUris = new Set<string>();
    for (let index = 0; index < sorted.length; index += 1) {
        const range = sorted[index]!;
        if (seenIds.has(range.id)) {
            throw new Error(`Portable animation streaming clip bundles require unique chunk ids: '${range.id}'`);
        }
        if (seenUris.has(range.uri)) {
            throw new Error(`Portable animation streaming clip bundles require unique chunk URIs: '${range.uri}'`);
        }
        seenIds.add(range.id);
        seenUris.add(range.uri);
    }

    return Object.freeze(sorted);
};

const collectTrackChunkIndices = (
    times: Float32Array,
    startTime: number,
    endTime: number
): readonly number[] => {
    const selected = new Set<number>();
    let previousIndex = -1;
    let nextIndex = -1;
    for (let index = 0; index < times.length; index += 1) {
        const time = Number(times[index] ?? 0);
        if (time < startTime) {
            previousIndex = index;
            continue;
        }
        if (time <= endTime) {
            selected.add(index);
            continue;
        }
        nextIndex = index;
        break;
    }
    if (previousIndex >= 0) {
        selected.add(previousIndex);
    }
    if (nextIndex >= 0) {
        selected.add(nextIndex);
    }

    if (selected.size === 0 && times.length > 0) {
        const firstTime = Number(times[0] ?? 0);
        if (endTime < firstTime) {
            selected.add(0);
        } else {
            selected.add(times.length - 1);
        }
    }

    return Object.freeze([...selected].sort((left, right) => left - right));
};

const createChunkTrackDefinition = (
    track: AnimationTrackDefinition,
    startTime: number,
    endTime: number
): AnimationTrackDefinition => {
    const keyframeCount = getTrackKeyframeCount(track);
    const sampleStride = getTrackSampleStride(track, keyframeCount);
    const valueComponentCount = getTrackValueComponentCount(track, sampleStride);
    const times = toFloat32Array(track.times);
    const values = toFloat32Array(track.values);

    if (times.length !== keyframeCount) {
        throw new Error(`Animation track '${track.target}/${track.path}' has inconsistent keyframe timing`);
    }
    if (sampleStride * keyframeCount !== values.length) {
        throw new Error(`Animation track '${track.target}/${track.path}' has inconsistent sample stride`);
    }

    const selectedIndices = collectTrackChunkIndices(times, startTime, endTime);
    const chunkTimes = new Float32Array(selectedIndices.length);
    const chunkValues = new Float32Array(selectedIndices.length * sampleStride);
    for (let index = 0; index < selectedIndices.length; index += 1) {
        const keyframeIndex = selectedIndices[index]!;
        chunkTimes[index] = times[keyframeIndex] ?? 0;
        const valueOffset = keyframeIndex * sampleStride;
        const chunkOffset = index * sampleStride;
        for (let componentIndex = 0; componentIndex < sampleStride; componentIndex += 1) {
            chunkValues[chunkOffset + componentIndex] = values[valueOffset + componentIndex] ?? 0;
        }
    }

    return Object.freeze({
        target: track.target,
        path: track.path,
        ...(typeof track.interpolation === 'string' ? { interpolation: track.interpolation } : {}),
        times: Object.freeze(Array.from(chunkTimes)),
        values: Object.freeze(Array.from(chunkValues)),
        keyframeCount: chunkTimes.length,
        sampleStride,
        valueComponentCount,
    } satisfies AnimationTrackDefinition);
};

const createChunkPayload = (
    clip: PortableAnimationStreamingClipSource,
    clipId: string,
    startTime: number,
    endTime: number,
    duration: number,
    mergeMode: AnimationClipStreamingChunkMergeMode
): AnimationClipStreamingChunkPayload =>
    Object.freeze({
        version: 1,
        clipId,
        ...(mergeMode === 'replace-all' ? { mergeMode } : {}),
        startTime,
        endTime,
        duration,
        tracks: Object.freeze(
            clip.tracks.map((track) => createChunkTrackDefinition(track, startTime, endTime))
        ),
    });

export const createAnimationStreamingChunkResource = (
    options: AnimationStreamingChunkResourceOptions
): GltfPackageResourceInput => {
    if (typeof options.uri !== 'string' || options.uri.length === 0) {
        throw new Error('Animation streaming chunk resources require a non-empty uri');
    }

    return Object.freeze({
        uri: options.uri,
        data: encodeAnimationClipStreamingChunkPayload(options.payload),
        mimeType: options.mimeType ?? DEFAULT_ANIMATION_STREAMING_CHUNK_MIME_TYPE,
    });
};

export const createPortableAnimationStreamingClipBundle = (
    options: PortableAnimationStreamingClipBundleOptions
): PortableAnimationStreamingClipBundle => {
    const clipId = resolveClipId(options.clip);
    const duration = inferClipDuration(options.clip);
    const mergeMode = options.mergeMode ?? 'replace-range';
    const sourceUri = options.sourceUri ?? options.clip.streaming?.sourceUri;
    const catalogUri = options.catalogUri ?? options.clip.streaming?.catalogUri;
    const ranges = normalizeChunkRanges(options, clipId, duration, sourceUri);
    const payloads = Object.freeze(
        ranges.map((range) => createChunkPayload(options.clip, clipId, range.startTime, range.endTime, duration, mergeMode))
    );
    const resources = Object.freeze(
        ranges.map((range, index) =>
            createAnimationStreamingChunkResource({
                uri: range.uri,
                payload: payloads[index]!,
                mimeType: options.mimeType ?? range.mimeType ?? DEFAULT_ANIMATION_STREAMING_CHUNK_MIME_TYPE,
            })
        )
    );
    const catalog = Object.freeze({
        id: resolveChunkCatalogId(clipId, sourceUri, options.catalogId, options.clip.streaming?.catalog?.id),
        chunks: Object.freeze(
            ranges.map(
                (range, index) =>
                    Object.freeze({
                        id: range.id,
                        uri: range.uri,
                        startTime: range.startTime,
                        endTime: range.endTime,
                        byteLength:
                            resources[index]!.data instanceof Uint8Array
                                ? resources[index]!.data.byteLength
                                : undefined,
                        mimeType: resources[index]!.mimeType,
                    } satisfies AnimationClipStreamingChunkDefinition)
            )
        ),
    } satisfies AnimationClipStreamingCatalogDefinition);

    const manifest = createPortableAnimationManifest({
        clips: [
            {
                id: clipId,
                ...(options.clip.events ? { events: options.clip.events } : {}),
                ...(options.clip.footContacts ? { footContacts: options.clip.footContacts } : {}),
                ...(options.clip.tags ? { tags: options.clip.tags } : {}),
                ...(options.clip.features ? { features: options.clip.features } : {}),
                ...(options.clip.compression ? { compression: options.clip.compression } : {}),
                streaming: {
                    mode: 'streamed',
                    ...(isFiniteNumber(options.chunkDuration ?? options.clip.streaming?.chunkDuration)
                        ? { chunkDuration: options.chunkDuration ?? options.clip.streaming?.chunkDuration }
                        : {}),
                    ...(isFiniteNumber(options.preloadWindow ?? options.clip.streaming?.preloadWindow)
                        ? { preloadWindow: options.preloadWindow ?? options.clip.streaming?.preloadWindow }
                        : {}),
                    ...(isFiniteNumber(options.priority ?? options.clip.streaming?.priority)
                        ? { priority: Math.trunc(options.priority ?? options.clip.streaming?.priority ?? 0) }
                        : {}),
                    ...(typeof sourceUri === 'string' && sourceUri.length > 0 ? { sourceUri } : {}),
                    ...(typeof catalogUri === 'string' && catalogUri.length > 0 ? { catalogUri } : {}),
                    catalog,
                },
            } satisfies PortableAnimationClipManifestEntry,
        ],
    });
    const clip = manifest.clips?.[0];
    if (!clip?.streaming?.catalog) {
        throw new Error('Portable animation streaming clip bundle creation failed to normalize clip metadata');
    }

    return Object.freeze({
        clip,
        catalog: clip.streaming.catalog,
        payloads,
        resources,
    });
};