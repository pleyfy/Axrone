import { EPSILON } from '@axrone/numeric';
import { isPlainObject } from '@axrone/utility';
import type {
    AnimationClipCompressionDefinition,
    AnimationClipEventDefinition,
    AnimationClipStreamingCatalogDefinition,
    AnimationClipStreamingDefinition,
    AnimationFootContactDefinition,
    AnimationMotionFeatureDefinition,
} from '@axrone/animation/types';
import type { AssetImportDiagnostic } from '../asset-contract';
import type {
    GltfAnimationClipAsset,
    GltfAnimationClipMetadata,
    GltfSceneJson,
} from '../types';
import type { NormalizedGltfSource } from './source-runtime';
import { basenameOfUri, stripExtension } from './source-runtime';
import { ANIMATION_MANIFEST_RESOURCE_NAMES, EMPTY_ARRAY } from './gltf-constants';
import type {
    AnimationManifest,
    AnimationManifestSceneEntry,
    AnimationClipMetadata,
    AnimationClipMetadataIndex,
} from './gltf-animation-types';
import type { PortableAnimationFeatureExportDefinition } from '../animation-manifest';
import {
    isFiniteNumber,
    isBooleanTuple3,
    isNumberTuple3,
    isNumberTuple4,
    maybeFreeze,
    cloneSerializableMetadata,
    sanitizeAnimationTags,
    normalizeVector3Tuple,
    rotateVectorByQuaternion,
} from './gltf-utils';

type PortableAnimationManifest = AnimationManifest;
type PortableAnimationManifestSceneEntry = AnimationManifestSceneEntry;
type GltfAnimationClipMetadataSource = AnimationClipMetadata;
type GltfAnimationClipMetadataSourceIndex = AnimationClipMetadataIndex;

const toMetadataRecord = (value: object | undefined): Record<string, unknown> | undefined =>
    value as Record<string, unknown> | undefined;

const toMetadataRecordArray = (
    value: readonly object[] | undefined
): readonly Record<string, unknown>[] | undefined =>
    value as readonly Record<string, unknown>[] | undefined;

export const createAnimationMetadataDiagnostic = (
    sceneIndex: number,
    message: string
): AssetImportDiagnostic =>
    Object.freeze({
        level: 'warning',
        code: 'gltf.animation.metadata.invalid',
        message: `Scene ${sceneIndex} animation metadata was ignored: ${message}`,
    } satisfies AssetImportDiagnostic);

export const resolveSceneAnimationMetadataSource = (
    scene: GltfSceneJson | undefined
): Record<string, unknown> | undefined => {
    const extras = scene && isPlainObject(scene.extras) ? scene.extras : undefined;
    if (!extras) {
        return undefined;
    }

    const axrone = isPlainObject(extras.axrone) ? extras.axrone : undefined;
    const candidates = [
        axrone?.animationController,
        axrone?.animation,
        extras.animationController,
        extras.animation,
    ];

    for (let index = 0; index < candidates.length; index += 1) {
        const candidate = candidates[index];
        if (isPlainObject(candidate)) {
            return candidate;
        }
    }

    return undefined;
};

export const createAnimationManifestDiagnostic = (message: string): AssetImportDiagnostic =>
    Object.freeze({
        level: 'warning',
        code: 'gltf.animation.manifest.invalid',
        message,
    } satisfies AssetImportDiagnostic);

export const collectAnimationManifestResourceCandidates = (
    normalized: NormalizedGltfSource
): readonly string[] => {
    const sourceStem = stripExtension(basenameOfUri(normalized.sourceUri));
    return Object.freeze(
        [...new Set([
            ...ANIMATION_MANIFEST_RESOURCE_NAMES,
            ...(sourceStem
                ? [
                      `${sourceStem}.animation-manifest.json`,
                      `${sourceStem}.animations.json`,
                      `${sourceStem}.animation-controller.json`,
                  ]
                : []),
        ])]
    );
};

export const resolvePortableAnimationManifest = (
    normalized: NormalizedGltfSource,
    diagnostics: AssetImportDiagnostic[]
): PortableAnimationManifest | undefined => {
    if (normalized.resources.size === 0) {
        return undefined;
    }

    // Deduplicate resources by URI inline during candidate search
    const seenUris = new Set<string>();
    const uniqueResources = [...normalized.resources.values()].filter((resource) => {
        if (seenUris.has(resource.uri)) {
            return false;
        }
        seenUris.add(resource.uri);
        return true;
    });

    const candidates = collectAnimationManifestResourceCandidates(normalized);
    const candidate =
        candidates
            .map((name) => uniqueResources.find((resource) => basenameOfUri(resource.uri) === name))
            .find((resource): resource is (typeof uniqueResources)[number] => Boolean(resource)) ??
        uniqueResources.find((resource) => {
            const name = basenameOfUri(resource.uri)?.toLowerCase();
            return Boolean(
                name &&
                    (name.endsWith('.animation-manifest.json') ||
                        name.endsWith('.animations.json') ||
                        name.endsWith('.animation-controller.json'))
            );
        });

    if (!candidate) {
        return undefined;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(new TextDecoder().decode(candidate.bytes)) as unknown;
    } catch (error) {
        diagnostics.push(
            createAnimationManifestDiagnostic(
                `Animation manifest '${candidate.uri}' could not be parsed and was ignored`
            )
        );
        return undefined;
    }

    if (!isPlainObject(parsed)) {
        diagnostics.push(
            createAnimationManifestDiagnostic(
                `Animation manifest '${candidate.uri}' must contain a JSON object`
            )
        );
        return undefined;
    }

    const directController =
        'parameters' in parsed || 'layers' in parsed || 'rootMotion' in parsed ? parsed : undefined;
    const controller = isPlainObject(parsed.controller)
        ? parsed.controller
        : isPlainObject(parsed.animationController)
          ? parsed.animationController
          : directController;
    const scenes = Array.isArray(parsed.scenes)
        ? Object.freeze(
              parsed.scenes
                  .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
                  .map((entry) =>
                      Object.freeze({
                          ...(isFiniteNumber(entry.scene)
                              ? { scene: Math.max(0, Math.trunc(entry.scene)) }
                              : {}),
                          ...(typeof entry.sceneName === 'string'
                              ? { sceneName: entry.sceneName }
                              : typeof entry.name === 'string'
                                ? { sceneName: entry.name }
                                : {}),
                          ...(isPlainObject(entry.controller)
                              ? { controller: entry.controller }
                              : isPlainObject(entry.animationController)
                                ? { controller: entry.animationController }
                                : {}),
                          ...(Array.isArray(entry.clips)
                              ? {
                                    clips: Object.freeze(
                                        entry.clips.filter(
                                            (clip): clip is Record<string, unknown> => isPlainObject(clip)
                                        )
                                    ),
                                }
                              : {}),
                      } satisfies PortableAnimationManifestSceneEntry)
                  )
                  .filter(
                      (entry) =>
                          entry.controller !== undefined ||
                          (Array.isArray(entry.clips) && entry.clips.length > 0)
                  )
          )
        : undefined;
    const clips = Array.isArray(parsed.clips)
        ? Object.freeze(parsed.clips.filter((entry): entry is Record<string, unknown> => isPlainObject(entry)))
        : undefined;

    if (!controller && (!scenes || scenes.length === 0) && (!clips || clips.length === 0)) {
        diagnostics.push(
            createAnimationManifestDiagnostic(
                `Animation manifest '${candidate.uri}' did not contain any usable controller or clip metadata`
            )
        );
        return undefined;
    }

    return Object.freeze({
        ...(controller ? { controller } : {}),
        ...(scenes && scenes.length > 0 ? { scenes } : {}),
        ...(clips && clips.length > 0 ? { clips } : {}),
    });
};

export const mergeAnimationMetadataSources = (
    base: Record<string, unknown> | undefined,
    override: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
    if (!base) {
        return override;
    }
    if (!override) {
        return base;
    }

    return {
        ...base,
        ...override,
        ...(override.parameters !== undefined ? { parameters: override.parameters } : {}),
        ...(override.layers !== undefined ? { layers: override.layers } : {}),
        ...(override.rootMotion !== undefined ? { rootMotion: override.rootMotion } : {}),
    };
};

export const resolvePortableAnimationManifestSceneEntry = (
    manifest: PortableAnimationManifest | undefined,
    scene: GltfSceneJson | undefined,
    sceneIndex: number
): PortableAnimationManifestSceneEntry | undefined => {
    if (!manifest) {
        return undefined;
    }

    const sceneName = typeof scene?.name === 'string' ? scene.name : undefined;
    return (
        manifest.scenes?.find((entry) => entry.scene === sceneIndex) ??
        (sceneName ? manifest.scenes?.find((entry) => entry.sceneName === sceneName) : undefined)
    );
};

export const resolvePortableSceneAnimationMetadataSource = (
    manifest: PortableAnimationManifest | undefined,
    scene: GltfSceneJson | undefined,
    sceneIndex: number
): Record<string, unknown> | undefined => {
    if (!manifest) {
        return undefined;
    }

    const sceneEntry = resolvePortableAnimationManifestSceneEntry(manifest, scene, sceneIndex);

    return mergeAnimationMetadataSources(
        toMetadataRecord(manifest.controller),
        toMetadataRecord(sceneEntry?.controller),
    );
};

export const sanitizeAnimationClipEvents = (
    value: unknown,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): readonly AnimationClipEventDefinition[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const events: AnimationClipEventDefinition[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (!isPlainObject(entry) || typeof entry.name !== 'string' || !isFiniteNumber(entry.time)) {
            diagnostics.push(createDiagnostic(`event ${index} must provide a valid name and time`));
            continue;
        }

        const payload = cloneSerializableMetadata(entry.payload);
        events.push(
            maybeFreeze(
                {
                    ...(typeof entry.id === 'string' && entry.id.length > 0 ? { id: entry.id } : {}),
                    name: entry.name,
                    time: Math.max(0, entry.time),
                    ...(payload !== undefined ? { payload: payload as Readonly<Record<string, unknown>> | null } : {}),
                    ...(sanitizeAnimationTags(entry.tags) ? { tags: sanitizeAnimationTags(entry.tags) } : {}),
                } satisfies AnimationClipEventDefinition,
                freeze
            )
        );
    }

    return events.length > 0 ? Object.freeze(events.sort((left, right) => left.time - right.time)) : undefined;
};

export const sanitizeAnimationFootContacts = (
    value: unknown,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): readonly AnimationFootContactDefinition[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const contacts: AnimationFootContactDefinition[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (
            !isPlainObject(entry) ||
            typeof entry.bone !== 'string' ||
            !isFiniteNumber(entry.startTime) ||
            !isFiniteNumber(entry.endTime)
        ) {
            diagnostics.push(createDiagnostic(`foot contact ${index} must provide a valid bone, startTime, and endTime`));
            continue;
        }

        const metadata = cloneSerializableMetadata(entry.metadata);
        contacts.push(
            maybeFreeze(
                {
                    bone: entry.bone,
                    startTime: Math.max(0, Math.min(entry.startTime, entry.endTime)),
                    endTime: Math.max(0, Math.max(entry.startTime, entry.endTime)),
                    ...(isBooleanTuple3(entry.lockTranslationAxes)
                        ? { lockTranslationAxes: Object.freeze([...entry.lockTranslationAxes]) as readonly [boolean, boolean, boolean] }
                        : {}),
                    ...(metadata !== undefined ? { metadata: metadata as Readonly<Record<string, unknown>> } : {}),
                } satisfies AnimationFootContactDefinition,
                freeze
            )
        );
    }

    return contacts.length > 0 ? Object.freeze(contacts.sort((left, right) => left.startTime - right.startTime)) : undefined;
};

export const sanitizeAnimationMotionFeatures = (
    value: unknown,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): readonly AnimationMotionFeatureDefinition[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const features: AnimationMotionFeatureDefinition[] = [];
    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (!isPlainObject(entry) || !isFiniteNumber(entry.time)) {
            diagnostics.push(createDiagnostic(`motion feature ${index} must provide a valid time`));
            continue;
        }

        features.push(
            maybeFreeze(
                {
                    time: Math.max(0, entry.time),
                    ...(isNumberTuple3(entry.trajectoryPosition)
                        ? { trajectoryPosition: Object.freeze([...entry.trajectoryPosition]) as readonly [number, number, number] }
                        : {}),
                    ...(isNumberTuple3(entry.facingDirection)
                        ? { facingDirection: Object.freeze([...entry.facingDirection]) as readonly [number, number, number] }
                        : {}),
                    ...(sanitizeAnimationTags(entry.tags) ? { tags: sanitizeAnimationTags(entry.tags) } : {}),
                    ...(isFiniteNumber(entry.costBias) ? { costBias: entry.costBias } : {}),
                } satisfies AnimationMotionFeatureDefinition,
                freeze
            )
        );
    }

    return features.length > 0 ? Object.freeze(features.sort((left, right) => left.time - right.time)) : undefined;
};

export const sanitizeAnimationClipCompression = (
    value: unknown,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): AnimationClipCompressionDefinition | undefined => {
    if (!isPlainObject(value)) {
        return undefined;
    }

    if (
        value.codec !== undefined &&
        value.codec !== 'none' &&
        value.codec !== 'keyframe-reduced'
    ) {
        diagnostics.push(createDiagnostic('compression codec must be none or keyframe-reduced'));
        return undefined;
    }

    const compression = maybeFreeze(
        {
            ...(typeof value.codec === 'string' ? { codec: value.codec as AnimationClipCompressionDefinition['codec'] } : {}),
            ...(isFiniteNumber(value.positionTolerance) ? { positionTolerance: value.positionTolerance } : {}),
            ...(isFiniteNumber(value.rotationToleranceDegrees)
                ? { rotationToleranceDegrees: value.rotationToleranceDegrees }
                : {}),
            ...(isFiniteNumber(value.scaleTolerance) ? { scaleTolerance: value.scaleTolerance } : {}),
            ...(isFiniteNumber(value.curveTolerance) ? { curveTolerance: value.curveTolerance } : {}),
            ...(typeof value.preserveStepTracks === 'boolean'
                ? { preserveStepTracks: value.preserveStepTracks }
                : {}),
        } satisfies AnimationClipCompressionDefinition,
        freeze
    );

    return Object.keys(compression).length > 0 ? compression : undefined;
};

export const sanitizeAnimationClipStreaming = (
    value: unknown,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): AnimationClipStreamingDefinition | undefined => {
    if (!isPlainObject(value)) {
        return undefined;
    }

    if (value.mode !== undefined && value.mode !== 'resident' && value.mode !== 'streamed') {
        diagnostics.push(createDiagnostic('streaming mode must be resident or streamed'));
        return undefined;
    }

    const catalog = isPlainObject(value.catalog)
        ? (() => {
              const chunks = Array.isArray(value.catalog.chunks)
                  ? value.catalog.chunks
                        .filter((entry): entry is Record<string, unknown> => isPlainObject(entry))
                        .map((entry) => {
                            if (
                                typeof entry.uri !== 'string' ||
                                !isFiniteNumber(entry.startTime) ||
                                !isFiniteNumber(entry.endTime)
                            ) {
                                diagnostics.push(
                                    createDiagnostic(
                                        'streaming catalog chunks must provide uri, startTime, and endTime'
                                    )
                                );
                                return undefined;
                            }

                            return maybeFreeze(
                                {
                                    ...(typeof entry.id === 'string' ? { id: entry.id } : {}),
                                    uri: entry.uri,
                                    startTime: Math.max(0, Math.min(entry.startTime, entry.endTime)),
                                    endTime: Math.max(0, Math.max(entry.startTime, entry.endTime)),
                                    ...(isFiniteNumber(entry.byteOffset)
                                        ? { byteOffset: Math.max(0, Math.trunc(entry.byteOffset)) }
                                        : {}),
                                    ...(isFiniteNumber(entry.byteLength)
                                        ? { byteLength: Math.max(0, Math.trunc(entry.byteLength)) }
                                        : {}),
                                    ...(typeof entry.mimeType === 'string'
                                        ? { mimeType: entry.mimeType }
                                        : {}),
                                },
                                freeze
                            );
                        })
                        .filter(
                            (
                                entry
                            ): entry is NonNullable<
                                AnimationClipStreamingCatalogDefinition['chunks'][number]
                            > => Boolean(entry)
                        )
                  : [];

              if (chunks.length === 0) {
                  diagnostics.push(createDiagnostic('streaming catalog must provide at least one valid chunk'));
                  return undefined;
              }

              return maybeFreeze(
                  {
                      ...(typeof value.catalog.id === 'string' ? { id: value.catalog.id } : {}),
                      chunks: Object.freeze(chunks),
                  } satisfies AnimationClipStreamingCatalogDefinition,
                  freeze
              );
          })()
        : undefined;

    const streaming = maybeFreeze(
        {
            ...(typeof value.mode === 'string' ? { mode: value.mode as AnimationClipStreamingDefinition['mode'] } : {}),
            ...(isFiniteNumber(value.chunkDuration) ? { chunkDuration: value.chunkDuration } : {}),
            ...(isFiniteNumber(value.preloadWindow) ? { preloadWindow: value.preloadWindow } : {}),
            ...(isFiniteNumber(value.priority) ? { priority: Math.trunc(value.priority) } : {}),
            ...(typeof value.sourceUri === 'string' ? { sourceUri: value.sourceUri } : {}),
            ...(typeof value.catalogUri === 'string' ? { catalogUri: value.catalogUri } : {}),
            ...(catalog ? { catalog } : {}),
        } satisfies AnimationClipStreamingDefinition,
        freeze
    );

    return Object.keys(streaming).length > 0 ? streaming : undefined;
};

export const sanitizeAnimationFeatureExport = (
    value: unknown,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): PortableAnimationFeatureExportDefinition | undefined => {
    if (!isPlainObject(value)) {
        return undefined;
    }

    if (
        value.sampleInterval !== undefined &&
        (!isFiniteNumber(value.sampleInterval) || value.sampleInterval <= 0)
    ) {
        diagnostics.push(createDiagnostic('featureExport.sampleInterval must be a positive number'));
        return undefined;
    }

    const sampleTimes = Array.isArray(value.sampleTimes)
        ? Object.freeze(
              value.sampleTimes
                  .filter((entry): entry is number => isFiniteNumber(entry))
                  .map((entry) => Math.max(0, entry))
          )
        : undefined;
    if (value.sampleTimes !== undefined && (!sampleTimes || sampleTimes.length === 0)) {
        diagnostics.push(createDiagnostic('featureExport.sampleTimes must contain numeric values'));
        return undefined;
    }

    const forwardAxis = isNumberTuple3(value.forwardAxis)
        ? (Object.freeze([...value.forwardAxis]) as readonly [number, number, number])
        : undefined;
    if (value.forwardAxis !== undefined && !forwardAxis) {
        diagnostics.push(createDiagnostic('featureExport.forwardAxis must be a numeric vec3'));
        return undefined;
    }

    const config = maybeFreeze(
        {
            ...(typeof value.rootNodeId === 'string' ? { rootNodeId: value.rootNodeId } : {}),
            ...(isFiniteNumber(value.rootNodeIndex)
                ? { rootNodeIndex: Math.max(0, Math.trunc(value.rootNodeIndex)) }
                : {}),
            ...(isFiniteNumber(value.sampleInterval) ? { sampleInterval: value.sampleInterval } : {}),
            ...(sampleTimes && sampleTimes.length > 0 ? { sampleTimes } : {}),
            ...(forwardAxis ? { forwardAxis } : {}),
            ...(sanitizeAnimationTags(value.tags) ? { tags: sanitizeAnimationTags(value.tags) } : {}),
            ...(isFiniteNumber(value.costBias) ? { costBias: value.costBias } : {}),
        } satisfies PortableAnimationFeatureExportDefinition,
        freeze
    );

    if (Object.keys(config).length === 0) {
        diagnostics.push(createDiagnostic('featureExport must contain at least one usable field'));
        return undefined;
    }

    return config;
};

export const sanitizeAnimationClipMetadataSource = (
    value: Record<string, unknown>,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): GltfAnimationClipMetadataSource | undefined => {
    const events = sanitizeAnimationClipEvents(value.events, diagnostics, createDiagnostic, freeze);
    const footContacts = sanitizeAnimationFootContacts(value.footContacts, diagnostics, createDiagnostic, freeze);
    const tags = sanitizeAnimationTags(value.tags);
    const features = sanitizeAnimationMotionFeatures(value.features, diagnostics, createDiagnostic, freeze);
    const compression = sanitizeAnimationClipCompression(value.compression, diagnostics, createDiagnostic, freeze);
    const streaming = sanitizeAnimationClipStreaming(value.streaming, diagnostics, createDiagnostic, freeze);
    const featureExport = sanitizeAnimationFeatureExport(
        value.featureExport,
        diagnostics,
        createDiagnostic,
        freeze
    );

    if (!events && !footContacts && !tags && !features && !compression && !streaming && !featureExport) {
        return undefined;
    }

    return maybeFreeze(
        {
            ...(events ? { events } : {}),
            ...(footContacts ? { footContacts } : {}),
            ...(tags ? { tags } : {}),
            ...(features ? { features } : {}),
            ...(compression ? { compression } : {}),
            ...(streaming ? { streaming } : {}),
            ...(featureExport ? { featureExport } : {}),
        },
        freeze
    );
};

export const mergeClipMetadataSources = (
    base: GltfAnimationClipMetadataSource | undefined,
    override: GltfAnimationClipMetadataSource | undefined,
    freeze: boolean
): GltfAnimationClipMetadataSource | undefined => {
    if (!base) {
        return override;
    }
    if (!override) {
        return base;
    }

    return maybeFreeze(
        {
            ...(override.events ? { events: override.events } : base.events ? { events: base.events } : {}),
            ...(override.footContacts
                ? { footContacts: override.footContacts }
                : base.footContacts
                  ? { footContacts: base.footContacts }
                  : {}),
            ...(override.tags ? { tags: override.tags } : base.tags ? { tags: base.tags } : {}),
            ...(override.features
                ? { features: override.features }
                : base.features
                  ? { features: base.features }
                  : {}),
            ...(override.compression
                ? { compression: override.compression }
                : base.compression
                  ? { compression: base.compression }
                  : {}),
            ...(override.streaming
                ? { streaming: override.streaming }
                : base.streaming
                  ? { streaming: base.streaming }
                  : {}),
            ...(override.featureExport
                ? { featureExport: override.featureExport }
                : base.featureExport
                  ? { featureExport: base.featureExport }
                  : {}),
        } satisfies GltfAnimationClipMetadataSource,
        freeze
    );
};

export const resolveAnimationClipMetadataEntries = (
    entries: readonly Record<string, unknown>[] | undefined,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): GltfAnimationClipMetadataSourceIndex => {
    const byId = new Map<string, GltfAnimationClipMetadataSource>();
    const byAnimationIndex = new Map<number, GltfAnimationClipMetadataSource>();

    for (let index = 0; index < (entries?.length ?? 0); index += 1) {
        const entry = entries![index]!;
        const clipId =
            typeof entry.id === 'string'
                ? entry.id
                : typeof entry.clipId === 'string'
                  ? entry.clipId
                  : undefined;
        const animationIndex = isFiniteNumber(entry.animationIndex)
            ? Math.max(0, Math.trunc(entry.animationIndex))
            : undefined;
        if (!clipId && animationIndex === undefined) {
            diagnostics.push(createDiagnostic(`clip entry ${index} must provide an id, clipId, or animationIndex`));
            continue;
        }

        const metadata = sanitizeAnimationClipMetadataSource(entry, diagnostics, createDiagnostic, freeze);
        if (!metadata) {
            continue;
        }

        if (clipId) {
            byId.set(clipId, mergeClipMetadataSources(byId.get(clipId), metadata, freeze) ?? metadata);
        }
        if (animationIndex !== undefined) {
            byAnimationIndex.set(
                animationIndex,
                mergeClipMetadataSources(byAnimationIndex.get(animationIndex), metadata, freeze) ?? metadata
            );
        }
    }

    return {
        byId,
        byAnimationIndex,
    };
};

export const resolvePortableAnimationClipMetadataSources = (
    manifest: PortableAnimationManifest | undefined,
    diagnostics: AssetImportDiagnostic[],
    freeze: boolean
): GltfAnimationClipMetadataSourceIndex =>
    resolveAnimationClipMetadataEntries(
        toMetadataRecordArray(manifest?.clips),
        diagnostics,
        (message) => createAnimationManifestDiagnostic(`Animation manifest ${message}`),
        freeze
    );

export const resolveScenePortableAnimationClipMetadataSources = (
    manifest: PortableAnimationManifest | undefined,
    scene: GltfSceneJson | undefined,
    sceneIndex: number,
    diagnostics: AssetImportDiagnostic[],
    freeze: boolean
): GltfAnimationClipMetadataSourceIndex =>
    resolveAnimationClipMetadataEntries(
        toMetadataRecordArray(
            resolvePortableAnimationManifestSceneEntry(manifest, scene, sceneIndex)?.clips,
        ),
        diagnostics,
        (message) => createAnimationMetadataDiagnostic(sceneIndex, `clip override ${message}`),
        freeze
    );

export const resolveClipMetadataSourceForAnimation = (
    sources: GltfAnimationClipMetadataSourceIndex,
    animation: Pick<GltfAnimationClipAsset, 'id' | 'animationIndex'>
): GltfAnimationClipMetadataSource | undefined =>
    sources.byId.get(animation.id) ?? sources.byAnimationIndex.get(animation.animationIndex);

export const hasClipMetadata = (clip: GltfAnimationClipAsset): boolean =>
    Boolean(
        clip.events ||
            clip.footContacts ||
            clip.tags ||
            clip.features ||
            clip.compression ||
            clip.streaming
    );

export const toClipMetadata = (
    clip: GltfAnimationClipAsset,
    freeze: boolean
): GltfAnimationClipMetadata | undefined => {
    if (!hasClipMetadata(clip)) {
        return undefined;
    }

    return maybeFreeze(
        {
            id: clip.id,
            ...(clip.events ? { events: clip.events } : {}),
            ...(clip.footContacts ? { footContacts: clip.footContacts } : {}),
            ...(clip.tags ? { tags: clip.tags } : {}),
            ...(clip.features ? { features: clip.features } : {}),
            ...(clip.compression ? { compression: clip.compression } : {}),
            ...(clip.streaming ? { streaming: clip.streaming } : {}),
        } satisfies GltfAnimationClipMetadata,
        freeze
    );
};

export const mergeClipMetadata = (
    clipId: string,
    base: GltfAnimationClipMetadata | undefined,
    override: GltfAnimationClipMetadataSource | undefined,
    freeze: boolean
): GltfAnimationClipMetadata | undefined => {
    if (!base && !override) {
        return undefined;
    }

    return maybeFreeze(
        {
            id: clipId,
            ...(override?.events ? { events: override.events } : base?.events ? { events: base.events } : {}),
            ...(override?.footContacts
                ? { footContacts: override.footContacts }
                : base?.footContacts
                  ? { footContacts: base.footContacts }
                  : {}),
            ...(override?.tags ? { tags: override.tags } : base?.tags ? { tags: base.tags } : {}),
            ...(override?.features
                ? { features: override.features }
                : base?.features
                  ? { features: base.features }
                  : {}),
            ...(override?.compression
                ? { compression: override.compression }
                : base?.compression
                  ? { compression: base.compression }
                  : {}),
            ...(override?.streaming
                ? { streaming: override.streaming }
                : base?.streaming
                  ? { streaming: base.streaming }
                  : {}),
        } satisfies GltfAnimationClipMetadata,
        freeze
    );
};

export const findAnimationTrackFrameIndex = (times: Float32Array, time: number): number => {
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

    // Unreachable in normal cases — the loop above should always find a match
    // since we've already handled edge cases (time <= first, time >= last).
    // Kept as a safety net for floating-point edge cases.
    return Math.max(0, Math.min(lastIndex - 1, low));
};

export const sampleAnimationTrackValues = (
    track: GltfAnimationClipAsset['tracks'][number],
    time: number
): readonly number[] => {
    const componentCount = track.valueComponentCount;
    const frameIndex = findAnimationTrackFrameIndex(track.times, time);
    const nextIndex = Math.min(track.keyframeCount - 1, frameIndex + 1);
    const startTime = track.times[frameIndex] ?? 0;
    const endTime = track.times[nextIndex] ?? startTime;
    const duration = Math.max(0, endTime - startTime);
    const alpha = duration > 0 ? Math.max(0, Math.min(1, (time - startTime) / duration)) : 0;

    // Zero-allocation hot path: avoid Object.freeze and Array.from overhead.
    // Compile-time readonly is sufficient for immutability guarantee.
    if (track.interpolation === 'STEP' || frameIndex === nextIndex) {
        const baseOffset =
            frameIndex * track.sampleStride + (track.interpolation === 'CUBICSPLINE' ? componentCount : 0);
        const result = new Array(componentCount);
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
            result[componentIndex] = track.values[baseOffset + componentIndex] ?? (componentIndex === 3 ? 1 : 0);
        }
        return result;
    }

    if (track.interpolation === 'CUBICSPLINE') {
        const leftBase = frameIndex * track.sampleStride;
        const rightBase = nextIndex * track.sampleStride;
        const s = alpha;
        const s2 = s * s;
        const s3 = s2 * s;
        const h00 = 2 * s3 - 3 * s2 + 1;
        const h10 = s3 - 2 * s2 + s;
        const h01 = -2 * s3 + 3 * s2;
        const h11 = s3 - s2;
        const result = new Array(componentCount);
        for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
            const inTangent = track.values[rightBase + componentIndex] ?? 0;
            const value0 = track.values[leftBase + componentCount + componentIndex] ?? 0;
            const outTangent = track.values[leftBase + componentCount * 2 + componentIndex] ?? 0;
            const value1 = track.values[rightBase + componentCount + componentIndex] ?? 0;
            result[componentIndex] = h00 * value0 + h10 * duration * outTangent + h01 * value1 + h11 * duration * inTangent;
        }
        return result;
    }

    const leftOffset = frameIndex * track.sampleStride;
    const rightOffset = nextIndex * track.sampleStride;
    const result = new Array(componentCount);
    for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
        const left = track.values[leftOffset + componentIndex] ?? 0;
        const right = track.values[rightOffset + componentIndex] ?? left;
        result[componentIndex] = left + (right - left) * alpha;
    }
    return result;
};

export const resolveFeatureExportSampleTimes = (
    duration: number,
    config: PortableAnimationFeatureExportDefinition
): readonly number[] => {
    const explicitTimes = config.sampleTimes
        ? [...new Set(config.sampleTimes.map((entry) => Math.max(0, Math.min(duration, entry))))].sort((left, right) => left - right)
        : [];
    if (explicitTimes.length > 0) {
        return Object.freeze(explicitTimes);
    }

    const interval =
        typeof config.sampleInterval === 'number' && Number.isFinite(config.sampleInterval) && config.sampleInterval > 0
            ? config.sampleInterval
            : Math.max(duration, 1e-3);
    const times: number[] = [];
    for (let time = 0; time < duration; time += interval) {
        times.push(Math.max(0, Math.min(duration, time)));
    }
    if (times.length === 0 || Math.abs((times[times.length - 1] ?? 0) - duration) > EPSILON) {
        times.push(duration);
    }
    return Object.freeze([...new Set(times)].sort((left, right) => left - right));
};

export const resolveFeatureExportTarget = (
    tracks: readonly GltfAnimationClipAsset['tracks'][number][],
    config: PortableAnimationFeatureExportDefinition
): { readonly targetNodeId: string; readonly targetNodeIndex: number } | undefined => {
    const findTrack = (predicate: (track: GltfAnimationClipAsset['tracks'][number]) => boolean) =>
        tracks.find((track) => (track.path === 'translation' || track.path === 'rotation') && predicate(track));

    const resolvedTrack =
        (typeof config.rootNodeId === 'string'
            ? findTrack((track) => track.targetNodeId === config.rootNodeId)
            : undefined) ??
        (typeof config.rootNodeIndex === 'number'
            ? findTrack((track) => track.targetNodeIndex === config.rootNodeIndex)
            : undefined) ??
        tracks.find((track) => track.path === 'translation') ??
        tracks.find((track) => track.path === 'rotation');

    return resolvedTrack
        ? {
              targetNodeId: resolvedTrack.targetNodeId,
              targetNodeIndex: resolvedTrack.targetNodeIndex,
          }
        : undefined;
};

export const exportMotionFeaturesFromTracks = (
    clipId: string,
    tracks: readonly GltfAnimationClipAsset['tracks'][number][],
    duration: number,
    config: PortableAnimationFeatureExportDefinition,
    diagnostics: AssetImportDiagnostic[],
    createDiagnostic: (message: string) => AssetImportDiagnostic,
    freeze: boolean
): readonly AnimationMotionFeatureDefinition[] | undefined => {
    const target = resolveFeatureExportTarget(tracks, config);
    if (!target) {
        diagnostics.push(createDiagnostic(`clip '${clipId}' featureExport could not resolve a translation or rotation target`));
        return undefined;
    }

    const translationTrack = tracks.find(
        (track) => track.path === 'translation' && track.targetNodeId === target.targetNodeId
    );
    const rotationTrack = tracks.find(
        (track) => track.path === 'rotation' && track.targetNodeId === target.targetNodeId
    );
    if (!translationTrack && !rotationTrack) {
        diagnostics.push(createDiagnostic(`clip '${clipId}' featureExport target '${target.targetNodeId}' has no usable tracks`));
        return undefined;
    }

    const sampleTimes = resolveFeatureExportSampleTimes(duration, config);
    const forwardAxis = normalizeVector3Tuple(config.forwardAxis ?? [0, 0, 1]);
    const positions = translationTrack
        ? sampleTimes.map((time) => {
              const sample = sampleAnimationTrackValues(translationTrack, time);
              return Object.freeze([
                  sample[0] ?? 0,
                  sample[1] ?? 0,
                  sample[2] ?? 0,
              ]) as readonly [number, number, number];
          })
        : undefined;

    const fallbackFacing = sampleTimes.map((_, index) => {
        if (!positions) {
            return forwardAxis;
        }
        const current = positions[index]!;
        const neighbor = positions[index + 1] ?? positions[index - 1] ?? current;
        const direction: readonly [number, number, number] =
            positions[index + 1]
                ? [neighbor[0] - current[0], neighbor[1] - current[1], neighbor[2] - current[2]]
                : [current[0] - neighbor[0], current[1] - neighbor[1], current[2] - neighbor[2]];
        return normalizeVector3Tuple(direction);
    });

    const features = sampleTimes
        .map((time, index) => {
            const rotation = rotationTrack
                ? (sampleAnimationTrackValues(rotationTrack, time) as readonly [number, number, number, number])
                : undefined;
            const facingDirection = rotation ? rotateVectorByQuaternion(forwardAxis, rotation) : fallbackFacing[index]!;
            const trajectoryPosition = positions?.[index];
            if (!trajectoryPosition && !facingDirection) {
                return undefined;
            }

            return maybeFreeze(
                {
                    time,
                    ...(trajectoryPosition ? { trajectoryPosition } : {}),
                    ...(facingDirection ? { facingDirection } : {}),
                    ...(config.tags ? { tags: config.tags } : {}),
                    ...(typeof config.costBias === 'number' ? { costBias: config.costBias } : {}),
                } satisfies AnimationMotionFeatureDefinition,
                freeze
            );
        })
        .filter((feature): feature is AnimationMotionFeatureDefinition => Boolean(feature));

    return features.length > 0 ? Object.freeze(features) : undefined;
};
