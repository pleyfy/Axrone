import { FilterMode, TextureFormat, WrapMode } from '@axrone/render-webgl2';
import type {
    AnimationClipCompressionDefinition,
    AnimationClipEventDefinition,
    AnimationClipStreamingCatalogDefinition,
    AnimationClipStreamingDefinition,
    AnimationFootContactDefinition,
    AnimationLayerDefinition,
    AnimationMotionFeatureDefinition,
    AnimationParameterDefinition,
    AnimationRootMotionDefinition,
} from '@axrone/animation';
import type {
    AssetImportDiagnostic,
    AssetImportResult,
    AssetImportSource,
    AssetWriteInput,
} from './asset-contract';
import { GltfSchemaError } from './errors';
import { encodeGltfValue } from './value-serialization';
import { GltfAccessorRuntime } from './internal/accessor-runtime';
import type {
    GltfActorSnapshot,
    GltfComponentSnapshot,
    GltfMaterialDefinition,
    GltfPrefabDefinition,
} from './asset-ir';
import {
    basenameOfUri,
    GltfResourceRuntime,
    inferFormatFromSource,
    isGltfPackageSource,
    normalizeGltfSource,
    stripExtension,
    type NormalizedGltfSource,
} from './internal/source-runtime';
import { buildMeshDefinition, collectPrimitiveDiagnostics } from './internal/mesh-runtime';
import type {
    GltfAccessorJson,
    GltfAnimationClipAsset,
    GltfAnimationClipMetadata,
    GltfAnimationControllerMetadata,
    GltfAssetSchema,
    GltfAssetSchemaLike,
    GltfCameraJson,
    GltfDocumentAsset,
    GltfDocumentSceneAsset,
    GltfImporter,
    GltfImporterOptions,
    GltfMaterialAlphaMode,
    GltfMaterialAsset,
    GltfMaterialJson,
    GltfMaterialTextureBinding,
    GltfMeshAsset,
    GltfMeshJson,
    GltfSceneJson,
    GltfSkinAsset,
    GltfNodeJson,
    GltfPunctualLightJson,
    GltfRootJson,
    GltfSamplerJson,
    GltfTextureAsset,
    GltfTextureBindingJson,
    GltfTexturePayload,
    GltfTextureJson,
    GltfTextureSampler,
    GltfTextureTranscodeRequest,
    GltfTextureTranscodeResult,
    GltfTextureTranscodeStageOptions,
    GltfTextureTranscoder,
    GltfTextureTransform,
    GltfTextureUsage,
    GltfTranscodeStage,
} from './types';

const EMPTY_ARRAY = Object.freeze([]) as readonly never[];
const DEFAULT_SAMPLER_ID = 'gltf/sampler/default';
const DEFAULT_MATERIAL_KEY_SUFFIX = 'material/default';
const DEFAULT_MATERIAL_NAME = 'Default Material';
const DEFAULT_DOCUMENT_NAME = 'glTF Document';
const MAX_SCENE_LOCAL_LIGHTS = 4;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const VALID_ANIMATION_PARAMETER_KINDS = new Set(['float', 'int', 'bool', 'trigger']);
const VALID_ANIMATION_LAYER_MODES = new Set(['override', 'additive']);
const VALID_ANIMATION_IK_SOLVERS = new Set(['ccd', 'fabrik']);
const VALID_ANIMATION_CONDITION_KINDS = new Set(['float', 'int', 'bool', 'trigger']);
const VALID_ANIMATION_CONDITION_OPERATORS = new Set(['<', '<=', '>', '>=', '==', '!=']);
const ANIMATION_MANIFEST_RESOURCE_NAMES = Object.freeze([
    'animation-manifest.json',
    'animations.manifest.json',
    'animation-controller.json',
    'animations.json',
]);
const SUPPORTED_GLTF_EXTENSIONS = new Set<string>([
    'EXT_meshopt_compression',
    'KHR_draco_mesh_compression',
    'KHR_lights_punctual',
    'KHR_materials_emissive_strength',
    'KHR_materials_unlit',
    'KHR_mesh_quantization',
    'KHR_texture_basisu',
    'KHR_texture_transform',
]);

interface PrefabBuildResult {
    readonly prefab: GltfPrefabDefinition;
    readonly rootNodeIds: readonly string[];
    readonly nodeIds: readonly string[];
    readonly meshKeys: readonly string[];
    readonly skinKeys: readonly string[];
    readonly animationKeys: readonly string[];
    readonly materialKeys: readonly string[];
    readonly animationController?: GltfAnimationControllerMetadata;
    readonly diagnostics: readonly AssetImportDiagnostic[];
}

interface GltfSkinBinding {
    readonly jointNodeIds: readonly string[];
    readonly skeletonNodeId?: string;
    readonly inverseBindMatrices?: readonly number[] | Float32Array;
}

interface PortableAnimationManifestSceneEntry {
    readonly scene?: number;
    readonly sceneName?: string;
    readonly controller?: Record<string, unknown>;
    readonly clips?: readonly Record<string, unknown>[];
}

interface PortableAnimationManifest {
    readonly controller?: Record<string, unknown>;
    readonly scenes?: readonly PortableAnimationManifestSceneEntry[];
    readonly clips?: readonly Record<string, unknown>[];
}

interface PortableAnimationFeatureExportDefinition {
    readonly rootNodeId?: string;
    readonly rootNodeIndex?: number;
    readonly sampleInterval?: number;
    readonly sampleTimes?: readonly number[];
    readonly forwardAxis?: readonly [number, number, number];
    readonly tags?: readonly string[];
    readonly costBias?: number;
}

interface GltfAnimationClipMetadataSource extends Omit<GltfAnimationClipMetadata, 'id'> {
    readonly featureExport?: PortableAnimationFeatureExportDefinition;
}

interface GltfAnimationClipMetadataSourceIndex {
    readonly byId: ReadonlyMap<string, GltfAnimationClipMetadataSource>;
    readonly byAnimationIndex: ReadonlyMap<number, GltfAnimationClipMetadataSource>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Array.isArray(value) === false;

const isTypedArray = (value: unknown): value is ArrayBufferView =>
    ArrayBuffer.isView(value) && (value instanceof DataView === false);

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isBooleanTuple3 = (value: unknown): value is readonly [boolean, boolean, boolean] =>
    Array.isArray(value) && value.length === 3 && value.every((entry) => typeof entry === 'boolean');

const isNumberTuple3 = (value: unknown): value is readonly [number, number, number] =>
    Array.isArray(value) && value.length === 3 && value.every((entry) => isFiniteNumber(entry));

const isNumberTuple4 = (value: unknown): value is readonly [number, number, number, number] =>
    Array.isArray(value) && value.length === 4 && value.every((entry) => isFiniteNumber(entry));

const freezeDeep = <T>(value: T): T => {
    if (value === null || typeof value !== 'object') {
        return value;
    }

    if (value instanceof ArrayBuffer || isTypedArray(value) || value instanceof DataView) {
        return value;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            freezeDeep(item);
        }
        return Object.freeze(value) as T;
    }

    for (const nested of Object.values(value as Record<string, unknown>)) {
        freezeDeep(nested);
    }

    return Object.freeze(value);
};

const maybeFreeze = <T>(value: T, enabled: boolean): T => (enabled ? freezeDeep(value) : value);

const cloneSerializableMetadata = (value: unknown): unknown => {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => cloneSerializableMetadata(entry));
    }

    if (!isPlainObject(value)) {
        return undefined;
    }

    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        const clonedEntry = cloneSerializableMetadata(entry);
        if (clonedEntry !== undefined) {
            cloned[key] = clonedEntry;
        }
    }

    return cloned;
};

const createAnimationMetadataDiagnostic = (
    sceneIndex: number,
    message: string
): AssetImportDiagnostic =>
    Object.freeze({
        level: 'warning',
        code: 'gltf.animation.metadata.invalid',
        message: `Scene ${sceneIndex} animation metadata was ignored: ${message}`,
    } satisfies AssetImportDiagnostic);

const resolveSceneAnimationMetadataSource = (
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

const createAnimationManifestDiagnostic = (message: string): AssetImportDiagnostic =>
    Object.freeze({
        level: 'warning',
        code: 'gltf.animation.manifest.invalid',
        message,
    } satisfies AssetImportDiagnostic);

const collectAnimationManifestResourceCandidates = (
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

const resolvePortableAnimationManifest = (
    normalized: NormalizedGltfSource,
    diagnostics: AssetImportDiagnostic[]
): PortableAnimationManifest | undefined => {
    if (normalized.resources.size === 0) {
        return undefined;
    }

    const resources = [...new Map([...normalized.resources.values()].map((resource) => [resource.uri, resource])).values()];
    const candidates = collectAnimationManifestResourceCandidates(normalized);
    const candidate =
        candidates
            .map((name) => resources.find((resource) => basenameOfUri(resource.uri) === name))
            .find((resource): resource is (typeof resources)[number] => Boolean(resource)) ??
        resources.find((resource) => {
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

const mergeAnimationMetadataSources = (
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

const resolvePortableAnimationManifestSceneEntry = (
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

const resolvePortableSceneAnimationMetadataSource = (
    manifest: PortableAnimationManifest | undefined,
    scene: GltfSceneJson | undefined,
    sceneIndex: number
): Record<string, unknown> | undefined => {
    if (!manifest) {
        return undefined;
    }

    const sceneEntry = resolvePortableAnimationManifestSceneEntry(manifest, scene, sceneIndex);

    return mergeAnimationMetadataSources(manifest.controller, sceneEntry?.controller);
};

const sanitizeAnimationTags = (value: unknown): readonly string[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const tags = [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))];
    return tags.length > 0 ? Object.freeze(tags) : undefined;
};

const sanitizeAnimationClipEvents = (
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

const sanitizeAnimationFootContacts = (
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

const sanitizeAnimationMotionFeatures = (
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

const sanitizeAnimationClipCompression = (
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

const sanitizeAnimationClipStreaming = (
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

const sanitizeAnimationFeatureExport = (
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

const sanitizeAnimationClipMetadataSource = (
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

const mergeClipMetadataSources = (
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

const resolveAnimationClipMetadataEntries = (
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

const resolvePortableAnimationClipMetadataSources = (
    manifest: PortableAnimationManifest | undefined,
    diagnostics: AssetImportDiagnostic[],
    freeze: boolean
): GltfAnimationClipMetadataSourceIndex =>
    resolveAnimationClipMetadataEntries(
        manifest?.clips,
        diagnostics,
        (message) => createAnimationManifestDiagnostic(`Animation manifest ${message}`),
        freeze
    );

const resolveScenePortableAnimationClipMetadataSources = (
    manifest: PortableAnimationManifest | undefined,
    scene: GltfSceneJson | undefined,
    sceneIndex: number,
    diagnostics: AssetImportDiagnostic[],
    freeze: boolean
): GltfAnimationClipMetadataSourceIndex =>
    resolveAnimationClipMetadataEntries(
        resolvePortableAnimationManifestSceneEntry(manifest, scene, sceneIndex)?.clips,
        diagnostics,
        (message) => createAnimationMetadataDiagnostic(sceneIndex, `clip override ${message}`),
        freeze
    );

const resolveClipMetadataSourceForAnimation = (
    sources: GltfAnimationClipMetadataSourceIndex,
    animation: Pick<GltfAnimationClipAsset, 'id' | 'animationIndex'>
): GltfAnimationClipMetadataSource | undefined =>
    sources.byId.get(animation.id) ?? sources.byAnimationIndex.get(animation.animationIndex);

const hasClipMetadata = (clip: GltfAnimationClipAsset): boolean =>
    Boolean(
        clip.events ||
            clip.footContacts ||
            clip.tags ||
            clip.features ||
            clip.compression ||
            clip.streaming
    );

const toClipMetadata = (
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

const mergeClipMetadata = (
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

const findAnimationTrackFrameIndex = (times: Float32Array, time: number): number => {
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

const sampleAnimationTrackValues = (
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

    if (track.interpolation === 'STEP' || frameIndex === nextIndex) {
        const baseOffset =
            frameIndex * track.sampleStride + (track.interpolation === 'CUBICSPLINE' ? componentCount : 0);
        return Object.freeze(
            Array.from({ length: componentCount }, (_, componentIndex) =>
                track.values[baseOffset + componentIndex] ?? (componentIndex === 3 ? 1 : 0)
            )
        );
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
        return Object.freeze(
            Array.from({ length: componentCount }, (_, componentIndex) => {
                const inTangent = track.values[rightBase + componentIndex] ?? 0;
                const value0 = track.values[leftBase + componentCount + componentIndex] ?? 0;
                const outTangent = track.values[leftBase + componentCount * 2 + componentIndex] ?? 0;
                const value1 = track.values[rightBase + componentCount + componentIndex] ?? 0;
                return h00 * value0 + h10 * duration * outTangent + h01 * value1 + h11 * duration * inTangent;
            })
        );
    }

    const leftOffset = frameIndex * track.sampleStride;
    const rightOffset = nextIndex * track.sampleStride;
    return Object.freeze(
        Array.from({ length: componentCount }, (_, componentIndex) => {
            const left = track.values[leftOffset + componentIndex] ?? 0;
            const right = track.values[rightOffset + componentIndex] ?? left;
            return left + (right - left) * alpha;
        })
    );
};

const normalizeVector3Tuple = (
    value: readonly [number, number, number]
): readonly [number, number, number] => {
    const length = Math.hypot(value[0], value[1], value[2]);
    if (length <= Number.EPSILON) {
        return Object.freeze([0, 0, 1]) as readonly [number, number, number];
    }
    return Object.freeze([value[0] / length, value[1] / length, value[2] / length]) as readonly [number, number, number];
};

const normalizeQuaternionTuple = (
    value: readonly [number, number, number, number]
): readonly [number, number, number, number] => {
    const length = Math.hypot(value[0], value[1], value[2], value[3]);
    if (length <= Number.EPSILON) {
        return Object.freeze([0, 0, 0, 1]) as readonly [number, number, number, number];
    }
    return Object.freeze([
        value[0] / length,
        value[1] / length,
        value[2] / length,
        value[3] / length,
    ]) as readonly [number, number, number, number];
};

const rotateVectorByQuaternion = (
    vector: readonly [number, number, number],
    quaternion: readonly [number, number, number, number]
): readonly [number, number, number] => {
    const [x, y, z, w] = normalizeQuaternionTuple(quaternion);
    const uvX = y * vector[2] - z * vector[1];
    const uvY = z * vector[0] - x * vector[2];
    const uvZ = x * vector[1] - y * vector[0];
    const uuvX = y * uvZ - z * uvY;
    const uuvY = z * uvX - x * uvZ;
    const uuvZ = x * uvY - y * uvX;
    return normalizeVector3Tuple([
        vector[0] + (uvX * w + uuvX) * 2,
        vector[1] + (uvY * w + uuvY) * 2,
        vector[2] + (uvZ * w + uuvZ) * 2,
    ]);
};

const resolveFeatureExportSampleTimes = (
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
    if (times.length === 0 || Math.abs((times[times.length - 1] ?? 0) - duration) > 1e-6) {
        times.push(duration);
    }
    return Object.freeze([...new Set(times)].sort((left, right) => left - right));
};

const resolveFeatureExportTarget = (
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

const exportMotionFeaturesFromTracks = (
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

const sanitizeAnimationParameters = (
    value: unknown,
    sceneIndex: number,
    diagnostics: AssetImportDiagnostic[],
    freeze: boolean
): readonly AnimationParameterDefinition[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const parameters: AnimationParameterDefinition[] = [];
    const seenNames = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (!isPlainObject(entry)) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(sceneIndex, `parameter ${index} is not an object`)
            );
            continue;
        }

        const name = typeof entry.name === 'string' ? entry.name : null;
        const kind =
            typeof entry.kind === 'string' && VALID_ANIMATION_PARAMETER_KINDS.has(entry.kind)
                ? (entry.kind as AnimationParameterDefinition['kind'])
                : null;
        if (!name || !kind || VALID_ANIMATION_PARAMETER_KINDS.has(kind) === false) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(
                    sceneIndex,
                    `parameter ${index} must provide a valid name and kind`
                )
            );
            continue;
        }

        if (seenNames.has(name)) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(sceneIndex, `parameter '${name}' is duplicated`)
            );
            continue;
        }

        const defaultValue = entry.defaultValue;
        if (
            defaultValue !== undefined &&
            ((kind === 'float' || kind === 'int')
                ? isFiniteNumber(defaultValue) === false
                : typeof defaultValue !== 'boolean')
        ) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(
                    sceneIndex,
                    `parameter '${name}' has an invalid defaultValue`
                )
            );
            continue;
        }

        seenNames.add(name);
        switch (kind) {
            case 'float':
            case 'int':
                parameters.push(
                    maybeFreeze(
                        {
                            name,
                            kind,
                            ...(typeof defaultValue === 'number' ? { defaultValue } : {}),
                        } satisfies AnimationParameterDefinition<string, 'float' | 'int'>,
                        freeze
                    )
                );
                break;
            case 'bool':
            case 'trigger':
                parameters.push(
                    maybeFreeze(
                        {
                            name,
                            kind,
                            ...(typeof defaultValue === 'boolean' ? { defaultValue } : {}),
                        } satisfies AnimationParameterDefinition<string, 'bool' | 'trigger'>,
                        freeze
                    )
                );
                break;
        }
    }

    return parameters.length > 0 ? Object.freeze(parameters) : undefined;
};

const validateAnimationParameterReference = (
    parameter: unknown,
    parameterNames: ReadonlySet<string>
): boolean => typeof parameter === 'string' && parameterNames.has(parameter);

const validateAnimationConditionMetadata = (
    condition: unknown,
    parameterNames: ReadonlySet<string>
): boolean => {
    if (!isPlainObject(condition) || typeof condition.kind !== 'string') {
        return false;
    }

    if (VALID_ANIMATION_CONDITION_KINDS.has(condition.kind) === false) {
        return false;
    }

    if (!validateAnimationParameterReference(condition.parameter, parameterNames)) {
        return false;
    }

    switch (condition.kind) {
        case 'float':
        case 'int':
            return (
                typeof condition.operator === 'string' &&
                VALID_ANIMATION_CONDITION_OPERATORS.has(condition.operator) &&
                isFiniteNumber(condition.value)
            );
        case 'bool':
            return typeof condition.value === 'boolean';
        case 'trigger':
            return true;
        default:
            return false;
    }
};

const validateAnimationMotionMetadata = (
    motion: unknown,
    clipIds: ReadonlySet<string>,
    parameterNames: ReadonlySet<string>
): boolean => {
    if (!isPlainObject(motion) || typeof motion.kind !== 'string') {
        return false;
    }

    switch (motion.kind) {
        case 'clip':
            return typeof motion.clipId === 'string' && clipIds.has(motion.clipId);
        case 'blend1d':
            return (
                validateAnimationParameterReference(motion.parameter, parameterNames) &&
                Array.isArray(motion.children) &&
                motion.children.length > 0 &&
                motion.children.every(
                    (child) =>
                        isPlainObject(child) &&
                        isFiniteNumber(child.threshold) &&
                        validateAnimationMotionMetadata(child.motion, clipIds, parameterNames)
                )
            );
        case 'blend2d':
            return (
                validateAnimationParameterReference(motion.parameterX, parameterNames) &&
                validateAnimationParameterReference(motion.parameterY, parameterNames) &&
                Array.isArray(motion.children) &&
                motion.children.length > 0 &&
                motion.children.every(
                    (child) =>
                        isPlainObject(child) &&
                        Array.isArray(child.position) &&
                        child.position.length === 2 &&
                        child.position.every((entry) => isFiniteNumber(entry)) &&
                        validateAnimationMotionMetadata(child.motion, clipIds, parameterNames)
                )
            );
        case 'direct':
            return (
                Array.isArray(motion.children) &&
                motion.children.length > 0 &&
                motion.children.every(
                    (child) =>
                        isPlainObject(child) &&
                        (child.parameter === undefined ||
                            validateAnimationParameterReference(child.parameter, parameterNames)) &&
                        (child.weight === undefined || isFiniteNumber(child.weight)) &&
                        validateAnimationMotionMetadata(child.motion, clipIds, parameterNames)
                )
            );
        case 'additive':
            return (
                validateAnimationMotionMetadata(motion.base, clipIds, parameterNames) &&
                validateAnimationMotionMetadata(motion.additive, clipIds, parameterNames) &&
                (motion.parameter === undefined ||
                    validateAnimationParameterReference(motion.parameter, parameterNames)) &&
                (motion.weight === undefined || isFiniteNumber(motion.weight))
            );
        default:
            return false;
    }
};

const validateAnimationStateMachineMetadata = (
    stateMachine: unknown,
    clipIds: ReadonlySet<string>,
    parameterNames: ReadonlySet<string>
): boolean => {
    if (
        !isPlainObject(stateMachine) ||
        typeof stateMachine.entryState !== 'string' ||
        !Array.isArray(stateMachine.states)
    ) {
        return false;
    }

    const stateIds = new Set<string>();
    for (let index = 0; index < stateMachine.states.length; index += 1) {
        const state = stateMachine.states[index];
        if (!isPlainObject(state) || typeof state.id !== 'string') {
            return false;
        }
        stateIds.add(state.id);
    }

    if (!stateIds.has(stateMachine.entryState)) {
        return false;
    }

    const validateTransitions = (transitions: unknown): boolean =>
        transitions === undefined ||
        (Array.isArray(transitions) &&
            transitions.every(
                (transition) =>
                    isPlainObject(transition) &&
                    typeof transition.to === 'string' &&
                    stateIds.has(transition.to) &&
                    (transition.duration === undefined || isFiniteNumber(transition.duration)) &&
                    (transition.offset === undefined || isFiniteNumber(transition.offset)) &&
                    (transition.exitTime === undefined || isFiniteNumber(transition.exitTime)) &&
                    (transition.fixedDuration === undefined || typeof transition.fixedDuration === 'boolean') &&
                    (transition.canInterrupt === undefined || typeof transition.canInterrupt === 'boolean') &&
                    (transition.priority === undefined || isFiniteNumber(transition.priority)) &&
                    (transition.conditions === undefined ||
                        (Array.isArray(transition.conditions) &&
                            transition.conditions.every((condition) =>
                                validateAnimationConditionMetadata(condition, parameterNames)
                            )))
            ));

    return (
        validateTransitions(stateMachine.anyStateTransitions) &&
        stateMachine.states.every(
            (state) =>
                isPlainObject(state) &&
                validateAnimationMotionMetadata(state.motion, clipIds, parameterNames) &&
                (state.speed === undefined || isFiniteNumber(state.speed)) &&
                (state.loop === undefined || typeof state.loop === 'boolean') &&
                validateTransitions(state.transitions)
        )
    );
};

const validateAnimationIkLayerMetadata = (
    value: unknown,
    boneIds: ReadonlySet<string>
): boolean => {
    if (!isPlainObject(value) || typeof value.id !== 'string' || !Array.isArray(value.jobs)) {
        return false;
    }

    return value.jobs.every(
        (job) =>
            isPlainObject(job) &&
            typeof job.id === 'string' &&
            typeof job.solver === 'string' &&
            VALID_ANIMATION_IK_SOLVERS.has(job.solver) &&
            typeof job.rootBone === 'string' &&
            boneIds.has(job.rootBone) &&
            typeof job.tipBone === 'string' &&
            boneIds.has(job.tipBone) &&
            (job.targetBone === undefined ||
                (typeof job.targetBone === 'string' && boneIds.has(job.targetBone))) &&
            (job.targetPosition === undefined || isNumberTuple3(job.targetPosition)) &&
            (job.targetRotation === undefined || isNumberTuple4(job.targetRotation)) &&
            (job.precision === undefined || isFiniteNumber(job.precision)) &&
            (job.maxIterations === undefined || isFiniteNumber(job.maxIterations)) &&
            (job.weight === undefined || isFiniteNumber(job.weight)) &&
            (job.preserveTipRotation === undefined || typeof job.preserveTipRotation === 'boolean')
    );
};

const sanitizeAnimationLayers = (
    value: unknown,
    sceneIndex: number,
    diagnostics: AssetImportDiagnostic[],
    clipIds: ReadonlySet<string>,
    parameterNames: ReadonlySet<string>,
    boneIds: ReadonlySet<string>,
    freeze: boolean
): readonly AnimationLayerDefinition[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }

    const layers: AnimationLayerDefinition[] = [];
    const seenLayerIds = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        const entry = value[index];
        if (!isPlainObject(entry) || typeof entry.id !== 'string') {
            diagnostics.push(
                createAnimationMetadataDiagnostic(sceneIndex, `layer ${index} must provide an id`)
            );
            continue;
        }

        if (seenLayerIds.has(entry.id)) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(sceneIndex, `layer '${entry.id}' is duplicated`)
            );
            continue;
        }

        if (
            entry.mode !== undefined &&
            (typeof entry.mode !== 'string' || VALID_ANIMATION_LAYER_MODES.has(entry.mode) === false)
        ) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(sceneIndex, `layer '${entry.id}' has an unsupported mode`)
            );
            continue;
        }

        if (entry.weight !== undefined && isFiniteNumber(entry.weight) === false) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(sceneIndex, `layer '${entry.id}' has an invalid weight`)
            );
            continue;
        }

        if (
            entry.boneMask !== undefined &&
            (!Array.isArray(entry.boneMask) ||
                entry.boneMask.some(
                    (boneId) => typeof boneId !== 'string' || boneIds.has(boneId) === false
                ))
        ) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(
                    sceneIndex,
                    `layer '${entry.id}' references unknown bone ids in boneMask`
                )
            );
            continue;
        }

        if (!validateAnimationStateMachineMetadata(entry.stateMachine, clipIds, parameterNames)) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(
                    sceneIndex,
                    `layer '${entry.id}' has an invalid state machine`
                )
            );
            continue;
        }

        if (
            entry.ikLayers !== undefined &&
            (!Array.isArray(entry.ikLayers) ||
                entry.ikLayers.some((ikLayer) => validateAnimationIkLayerMetadata(ikLayer, boneIds) === false))
        ) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(sceneIndex, `layer '${entry.id}' has invalid IK metadata`)
            );
            continue;
        }

        const cloned = cloneSerializableMetadata(entry);
        if (!isPlainObject(cloned)) {
            diagnostics.push(
                createAnimationMetadataDiagnostic(sceneIndex, `layer '${entry.id}' could not be cloned`)
            );
            continue;
        }

        seenLayerIds.add(entry.id);
        layers.push(maybeFreeze(cloned as unknown as AnimationLayerDefinition, freeze));
    }

    return layers.length > 0 ? Object.freeze(layers) : undefined;
};

const sanitizeAnimationRootMotion = (
    value: unknown,
    sceneIndex: number,
    diagnostics: AssetImportDiagnostic[],
    boneIds: ReadonlySet<string>,
    freeze: boolean
): AnimationRootMotionDefinition | null | undefined => {
    if (value === null) {
        return null;
    }

    if (!isPlainObject(value)) {
        return undefined;
    }

    if (typeof value.bone !== 'string' || boneIds.has(value.bone) === false) {
        diagnostics.push(
            createAnimationMetadataDiagnostic(
                sceneIndex,
                'rootMotion must reference an imported node id'
            )
        );
        return undefined;
    }

    if (
        value.projectTranslationAxes !== undefined &&
        isBooleanTuple3(value.projectTranslationAxes) === false
    ) {
        diagnostics.push(
            createAnimationMetadataDiagnostic(
                sceneIndex,
                'rootMotion.projectTranslationAxes must be a boolean tuple of length 3'
            )
        );
        return undefined;
    }

    if (
        (value.consume !== undefined && typeof value.consume !== 'boolean') ||
        (value.extractRotation !== undefined && typeof value.extractRotation !== 'boolean')
    ) {
        diagnostics.push(
            createAnimationMetadataDiagnostic(sceneIndex, 'rootMotion flags must be boolean values')
        );
        return undefined;
    }

    return maybeFreeze(
        {
            bone: value.bone,
            ...(value.consume !== undefined ? { consume: value.consume } : {}),
            ...(value.projectTranslationAxes !== undefined
                ? {
                      projectTranslationAxes: Object.freeze([
                          ...value.projectTranslationAxes,
                      ]) as readonly [boolean, boolean, boolean],
                  }
                : {}),
            ...(value.extractRotation !== undefined
                ? { extractRotation: value.extractRotation }
                : {}),
        } satisfies AnimationRootMotionDefinition,
        freeze
    );
};

const resolveSceneAnimationControllerMetadata = (
    scene: GltfSceneJson | undefined,
    sceneIndex: number,
    clipIds: ReadonlySet<string>,
    boneIds: ReadonlySet<string>,
    animations: readonly GltfAnimationClipAsset[],
    manifest: PortableAnimationManifest | undefined,
    diagnostics: AssetImportDiagnostic[],
    freeze: boolean
): GltfAnimationControllerMetadata | undefined => {
    const source = mergeAnimationMetadataSources(
        resolvePortableSceneAnimationMetadataSource(manifest, scene, sceneIndex),
        resolveSceneAnimationMetadataSource(scene)
    );
    const parameters = source
        ? sanitizeAnimationParameters(source.parameters, sceneIndex, diagnostics, freeze)
        : undefined;
    const parameterNames = new Set(parameters?.map((parameter) => parameter.name) ?? EMPTY_ARRAY);
    const layers = source
        ? sanitizeAnimationLayers(
              source.layers,
              sceneIndex,
              diagnostics,
              clipIds,
              parameterNames,
              boneIds,
              freeze
          )
        : undefined;
    const rootMotion = source
        ? sanitizeAnimationRootMotion(
              source.rootMotion,
              sceneIndex,
              diagnostics,
              boneIds,
              freeze
          )
        : undefined;
    const sceneClipMetadataSources = resolveScenePortableAnimationClipMetadataSources(
        manifest,
        scene,
        sceneIndex,
        diagnostics,
        freeze
    );
    const clips = Object.freeze(
        animations
            .map((animation) =>
                mergeClipMetadata(
                    animation.id,
                    toClipMetadata(animation, freeze),
                    resolveClipMetadataSourceForAnimation(sceneClipMetadataSources, animation),
                    freeze
                )
            )
            .filter((clip): clip is GltfAnimationClipMetadata => Boolean(clip))
    );

    if (!parameters && !layers && rootMotion === undefined && clips.length === 0) {
        return undefined;
    }

    return maybeFreeze(
        {
            ...(parameters ? { parameters } : {}),
            ...(layers ? { layers } : {}),
            ...(rootMotion !== undefined ? { rootMotion } : {}),
            ...(clips.length > 0 ? { clips } : {}),
        } satisfies GltfAnimationControllerMetadata,
        freeze
    );
};

const sanitizeName = (value: string | undefined, fallback: string): string => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const listUnsupportedExtensions = (
    extensions: readonly string[] | undefined
): readonly string[] =>
    Object.freeze(
        [...new Set(extensions?.filter((extension) => !SUPPORTED_GLTF_EXTENSIONS.has(extension)) ?? [])].sort(
            (left, right) => left.localeCompare(right)
        )
    );

const assertSupportedRequiredExtensions = (root: GltfRootJson): void => {
    const unsupported = listUnsupportedExtensions(root.extensionsRequired);
    if (unsupported.length === 0) {
        return;
    }

    throw new GltfSchemaError(
        `Unsupported required glTF extensions: ${unsupported.join(', ')}`
    );
};

const collectExtensionDiagnostics = (root: GltfRootJson): readonly AssetImportDiagnostic[] => {
    const required = new Set(root.extensionsRequired ?? EMPTY_ARRAY);

    return Object.freeze(
        listUnsupportedExtensions(root.extensionsUsed)
            .filter((extension) => required.has(extension) === false)
            .map(
                (extension) =>
                    Object.freeze({
                        level: 'warning',
                        code: 'gltf.extension.unsupported',
                        message: `glTF extension ${extension} is not supported and related data may be ignored`,
                    } satisfies AssetImportDiagnostic)
            )
    );
};

const collectFeatureDiagnostics = (root: GltfRootJson): readonly AssetImportDiagnostic[] => {
    return Object.freeze([]);
};

const mapWrapMode = (
    value: GltfSamplerJson['wrapS'] | GltfSamplerJson['wrapT'] | undefined
): WrapMode => {
    switch (value) {
        case 33071:
            return WrapMode.CLAMP_TO_EDGE;
        case 33648:
            return WrapMode.MIRRORED_REPEAT;
        case 10497:
        default:
            return WrapMode.REPEAT;
    }
};

const mapMinFilter = (value: GltfSamplerJson['minFilter'] | undefined): FilterMode => {
    switch (value) {
        case 9728:
            return FilterMode.NEAREST;
        case 9729:
            return FilterMode.LINEAR;
        case 9984:
            return FilterMode.NEAREST_MIPMAP_NEAREST;
        case 9985:
            return FilterMode.LINEAR_MIPMAP_NEAREST;
        case 9986:
            return FilterMode.NEAREST_MIPMAP_LINEAR;
        case 9987:
        default:
            return FilterMode.LINEAR_MIPMAP_LINEAR;
    }
};

const mapMagFilter = (value: GltfSamplerJson['magFilter'] | undefined): FilterMode => {
    switch (value) {
        case 9728:
            return FilterMode.NEAREST;
        case 9729:
        default:
            return FilterMode.LINEAR;
    }
};

const inferTextureFormat = (payload: GltfTexturePayload): TextureFormat | undefined => {
    if (payload.kind === 'compressed') {
        return payload.targetFormat;
    }

    const mimeType = payload.mimeType?.toLowerCase();
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
        return TextureFormat.RGB8;
    }
    if (mimeType === 'image/png' || mimeType === 'image/webp') {
        return TextureFormat.RGBA8;
    }
    if (mimeType === 'image/ktx2') {
        return TextureFormat.RGBA8;
    }
    return undefined;
};

const inferCompressedContainer = (
    mimeType: string | undefined,
    uri: string | undefined
): 'ktx2' | 'basisu' | undefined => {
    const normalizedMime = mimeType?.toLowerCase();
    const normalizedUri = uri?.toLowerCase();
    if (normalizedMime === 'image/ktx2' || normalizedUri?.endsWith('.ktx2')) {
        return 'ktx2';
    }
    if (normalizedMime === 'image/basis' || normalizedUri?.endsWith('.basis')) {
        return 'basisu';
    }
    return undefined;
};

const createTextureTransform = (binding: GltfTextureBindingJson | undefined): GltfTextureTransform | undefined => {
    const transform = binding?.extensions?.KHR_texture_transform;
    if (!transform && binding?.texCoord === undefined) {
        return undefined;
    }

    return Object.freeze({
        offset: Object.freeze([...(transform?.offset ?? [0, 0])]) as readonly [number, number],
        scale: Object.freeze([...(transform?.scale ?? [1, 1])]) as readonly [number, number],
        rotation: transform?.rotation ?? 0,
        texCoord: transform?.texCoord ?? binding?.texCoord ?? 0,
    });
};

const createMaterialTextureBinding = (
    usage: GltfTextureUsage,
    key: string,
    json: GltfTextureBindingJson,
    colorSpace: 'linear' | 'srgb'
): GltfMaterialTextureBinding =>
    Object.freeze({
        textureKey: key,
        usage,
        texCoord: json.texCoord ?? 0,
        colorSpace,
        transform: createTextureTransform(json),
        ...(json.scale !== undefined ? { scale: json.scale } : {}),
        ...(json.strength !== undefined ? { strength: json.strength } : {}),
    });


const decomposeNodeTransform = (
    node: GltfNodeJson
): {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
    readonly scale: readonly [number, number, number];
} => {
    if (node.matrix && node.matrix.length === 16) {
        const m = node.matrix;
        const sx = Math.hypot(m[0], m[1], m[2]);
        const sy = Math.hypot(m[4], m[5], m[6]);
        const sz = Math.hypot(m[8], m[9], m[10]);
        const rm00 = sx === 0 ? 1 : m[0] / sx;
        const rm01 = sx === 0 ? 0 : m[1] / sx;
        const rm02 = sx === 0 ? 0 : m[2] / sx;
        const rm10 = sy === 0 ? 0 : m[4] / sy;
        const rm11 = sy === 0 ? 1 : m[5] / sy;
        const rm12 = sy === 0 ? 0 : m[6] / sy;
        const rm20 = sz === 0 ? 0 : m[8] / sz;
        const rm21 = sz === 0 ? 0 : m[9] / sz;
        const rm22 = sz === 0 ? 1 : m[10] / sz;
        const trace = rm00 + rm11 + rm22;
        let x = 0;
        let y = 0;
        let z = 0;
        let w = 1;

        if (trace > 0) {
            const s = Math.sqrt(trace + 1) * 2;
            w = 0.25 * s;
            x = (rm21 - rm12) / s;
            y = (rm02 - rm20) / s;
            z = (rm10 - rm01) / s;
        } else if (rm00 > rm11 && rm00 > rm22) {
            const s = Math.sqrt(1 + rm00 - rm11 - rm22) * 2;
            w = (rm21 - rm12) / s;
            x = 0.25 * s;
            y = (rm01 + rm10) / s;
            z = (rm02 + rm20) / s;
        } else if (rm11 > rm22) {
            const s = Math.sqrt(1 + rm11 - rm00 - rm22) * 2;
            w = (rm02 - rm20) / s;
            x = (rm01 + rm10) / s;
            y = 0.25 * s;
            z = (rm12 + rm21) / s;
        } else {
            const s = Math.sqrt(1 + rm22 - rm00 - rm11) * 2;
            w = (rm10 - rm01) / s;
            x = (rm02 + rm20) / s;
            y = (rm12 + rm21) / s;
            z = 0.25 * s;
        }

        return {
            position: [m[12], m[13], m[14]],
            rotation: [x, y, z, w],
            scale: [sx || 1, sy || 1, sz || 1],
        };
    }

    return {
        position: node.translation ?? [0, 0, 0],
        rotation: node.rotation ?? [0, 0, 0, 1],
        scale: node.scale ?? [1, 1, 1],
    };
};

const createTransformSnapshot = (node: GltfNodeJson): GltfComponentSnapshot => {
    const transform = decomposeNodeTransform(node);
    return Object.freeze({
        type: 'Transform',
        data: Object.freeze({
            position: Object.freeze([...transform.position]),
            rotation: Object.freeze([...transform.rotation]),
            scale: Object.freeze([...transform.scale]),
        }),
    });
};

const createCameraSnapshot = (
    camera: GltfCameraJson,
    isPrimary: boolean
): GltfComponentSnapshot => {
    if (camera.type === 'orthographic') {
        if (!camera.orthographic) {
            throw new GltfSchemaError('Orthographic glTF camera is missing orthographic settings');
        }

        return Object.freeze({
            type: 'Camera',
            data: Object.freeze({
                primary: isPrimary,
                near: camera.orthographic.znear,
                far: camera.orthographic.zfar,
                orthographic: true,
                orthographicSize: camera.orthographic.ymag,
            }),
        });
    }

    if (!camera.perspective) {
        throw new GltfSchemaError('Perspective glTF camera is missing perspective settings');
    }

    return Object.freeze({
        type: 'Camera',
        data: Object.freeze({
            primary: isPrimary,
            near: camera.perspective.znear,
            ...(camera.perspective.zfar !== undefined
                ? { far: camera.perspective.zfar }
                : {}),
            fieldOfView: camera.perspective.yfov * RADIANS_TO_DEGREES,
            orthographic: false,
        }),
    });
};

const createDirectionalLightSnapshot = (
    light: GltfPunctualLightJson,
    isPrimary: boolean
): GltfComponentSnapshot =>
    Object.freeze({
        type: 'DirectionalLight',
        data: Object.freeze({
            color: Object.freeze([...(light.color ?? [1, 1, 1])]),
            intensity: light.intensity ?? 1,
            primary: isPrimary,
        }),
    });

const createPointLightSnapshot = (light: GltfPunctualLightJson): GltfComponentSnapshot =>
    Object.freeze({
        type: 'PointLight',
        data: Object.freeze({
            color: Object.freeze([...(light.color ?? [1, 1, 1])]),
            intensity: light.intensity ?? 1,
            ...(light.range !== undefined ? { range: light.range } : {}),
        }),
    });

const createSpotLightSnapshot = (light: GltfPunctualLightJson): GltfComponentSnapshot =>
    Object.freeze({
        type: 'SpotLight',
        data: Object.freeze({
            color: Object.freeze([...(light.color ?? [1, 1, 1])]),
            intensity: light.intensity ?? 1,
            ...(light.range !== undefined ? { range: light.range } : {}),
            innerConeAngle: light.spot?.innerConeAngle ?? 0,
            outerConeAngle: light.spot?.outerConeAngle ?? Math.PI / 4,
        }),
    });

const createMeshRendererSnapshot = (
    meshKey: string,
    materialKey: string | undefined,
    morphWeights: readonly number[] | Float32Array | undefined,
    skin: GltfSkinBinding | undefined
): GltfComponentSnapshot => {
    const skinData = skin
        ? Object.freeze({
              jointNodeIds: Object.freeze([...skin.jointNodeIds]),
              ...(skin.skeletonNodeId ? { skeletonNodeId: skin.skeletonNodeId } : {}),
              ...(skin.inverseBindMatrices
                  ? { inverseBindMatrices: new Float32Array(skin.inverseBindMatrices) }
                  : {}),
          })
        : undefined;
    const morphData = morphWeights
        ? Object.freeze({
              weights: new Float32Array(morphWeights),
          })
        : undefined;

    return Object.freeze({
        type: 'MeshRenderer',
        data: encodeGltfValue(
            Object.freeze({
                meshId: meshKey,
                materialId: materialKey ?? null,
                visible: true,
                renderOrder: 0,
                passId: 'main',
                receiveLighting: true,
                uniformOverrides: Object.freeze({}),
                ...(morphData ? { morph: morphData } : {}),
                ...(skinData ? { skin: skinData } : {}),
            })
        ),
    });
};

const createMorphWeights = (
    node: GltfNodeJson,
    mesh: GltfMeshJson | undefined,
    primitiveIndex: number
): Float32Array | undefined => {
    const primitive = mesh?.primitives[primitiveIndex];
    const targetCount = primitive?.targets?.length ?? 0;
    if (targetCount === 0) {
        return undefined;
    }

    const sourceWeights = node.weights ?? mesh?.weights;
    const weights = new Float32Array(targetCount);
    if (sourceWeights) {
        const count = Math.min(targetCount, sourceWeights.length);
        for (let index = 0; index < count; index += 1) {
            weights[index] = Number(sourceWeights[index] ?? 0);
        }
    }

    return weights;
};

const createSkinBinding = (skin: GltfSkinAsset | undefined): GltfSkinBinding | undefined => {
    if (!skin) {
        return undefined;
    }

    return Object.freeze({
        jointNodeIds: Object.freeze([...skin.jointNodeIds]),
        ...(skin.skeletonNodeId ? { skeletonNodeId: skin.skeletonNodeId } : {}),
        ...(skin.inverseBindMatrices
            ? { inverseBindMatrices: new Float32Array(skin.inverseBindMatrices) }
            : {}),
    });
};

const createAnimatorSnapshot = (
    animations: readonly GltfAnimationClipAsset[],
    metadata: GltfAnimationControllerMetadata | undefined
): GltfComponentSnapshot | undefined => {
    type SerializableTrack = Readonly<{
        targetNodeId: string;
        path: 'translation' | 'rotation' | 'scale' | 'weights';
        interpolation: NonNullable<GltfAnimationClipAsset['tracks'][number]['interpolation']>;
        keyframeCount: number;
        valueComponentCount: number;
        sampleStride: number;
        times: Float32Array;
        values: Float32Array;
    }>;

    type SerializableClip = Readonly<{
        id: string;
        duration: number;
        events?: readonly AnimationClipEventDefinition[];
        footContacts?: readonly AnimationFootContactDefinition[];
        tags?: readonly string[];
        features?: readonly AnimationMotionFeatureDefinition[];
        compression?: AnimationClipCompressionDefinition;
        streaming?: AnimationClipStreamingDefinition;
        tracks: readonly SerializableTrack[];
    }>;

    const clipMetadataById = new Map(
        (metadata?.clips ?? EMPTY_ARRAY).map((clip) => [clip.id, clip] as const)
    );

    const clips = animations
        .map((clip) => {
            const clipMetadata = clipMetadataById.get(clip.id) ?? clip;
            const tracks = clip.tracks
                .map(
                    (track) =>
                        Object.freeze({
                            targetNodeId: track.targetNodeId,
                            path: track.path,
                            interpolation: track.interpolation,
                            keyframeCount: track.keyframeCount,
                            valueComponentCount: track.valueComponentCount,
                            sampleStride: track.sampleStride,
                            times: new Float32Array(track.times),
                            values: new Float32Array(track.values),
                        } satisfies SerializableTrack)
                );

            if (tracks.length === 0) {
                return undefined;
            }

            return Object.freeze({
                id: clip.id,
                duration: clip.duration,
                ...(clipMetadata.events ? { events: clipMetadata.events } : {}),
                ...(clipMetadata.footContacts ? { footContacts: clipMetadata.footContacts } : {}),
                ...(clipMetadata.tags ? { tags: clipMetadata.tags } : {}),
                ...(clipMetadata.features ? { features: clipMetadata.features } : {}),
                ...(clipMetadata.compression ? { compression: clipMetadata.compression } : {}),
                ...(clipMetadata.streaming ? { streaming: clipMetadata.streaming } : {}),
                tracks: Object.freeze(tracks),
            } satisfies SerializableClip);
        })
        .filter((clip) => clip !== undefined) as readonly SerializableClip[];

    if (clips.length === 0) {
        return undefined;
    }

    return Object.freeze({
        type: 'Animator',
        data: encodeGltfValue(
            Object.freeze({
                clips: Object.freeze(clips),
                ...(metadata?.parameters ? { parameters: metadata.parameters } : {}),
                ...(metadata?.layers ? { layers: metadata.layers } : {}),
                ...(metadata && 'rootMotion' in metadata ? { rootMotion: metadata.rootMotion ?? null } : {}),
                clipId: clips[0]?.id ?? null,
                playOnStart: true,
                playing: true,
                loop: true,
                speed: 1,
                time: 0,
            })
        ),
    });
};

const collectTextureUsages = (root: GltfRootJson): Map<number, Set<GltfTextureUsage>> => {
    const usages = new Map<number, Set<GltfTextureUsage>>();
    const addUsage = (textureIndex: number | undefined, usage: GltfTextureUsage): void => {
        if (textureIndex === undefined) {
            return;
        }

        const set = usages.get(textureIndex) ?? new Set<GltfTextureUsage>();
        if (!usages.has(textureIndex)) {
            usages.set(textureIndex, set);
        }
        set.add(usage);
    };

    for (const material of root.materials ?? EMPTY_ARRAY) {
        addUsage(material.pbrMetallicRoughness?.baseColorTexture?.index, 'baseColor');
        addUsage(
            material.pbrMetallicRoughness?.metallicRoughnessTexture?.index,
            'metallicRoughness'
        );
        addUsage(material.normalTexture?.index, 'normal');
        addUsage(material.occlusionTexture?.index, 'occlusion');
        addUsage(material.emissiveTexture?.index, 'emissive');
    }

    return usages;
};

const createSamplerDefinition = (
    index: number | undefined,
    sampler: GltfSamplerJson | undefined,
    fallbackId: string
): GltfTextureSampler =>
    Object.freeze({
        id: index === undefined ? fallbackId : `gltf/sampler/${index}`,
        minFilter: mapMinFilter(sampler?.minFilter),
        magFilter: mapMagFilter(sampler?.magFilter),
        wrapS: mapWrapMode(sampler?.wrapS),
        wrapT: mapWrapMode(sampler?.wrapT),
    });

const resolveTextureImageIndex = (texture: GltfTextureJson): number | undefined =>
    texture.extensions?.KHR_texture_basisu?.source ?? texture.source;

const resolveNodeLight = (
    root: GltfRootJson,
    node: GltfNodeJson,
    nodeIndex: number
): { readonly index: number; readonly light: GltfPunctualLightJson } | undefined => {
    const lightIndex = node.extensions?.KHR_lights_punctual?.light;
    if (lightIndex === undefined) {
        return undefined;
    }

    const light = root.extensions?.KHR_lights_punctual?.lights?.[lightIndex];
    if (!light) {
        throw new GltfSchemaError(`Node ${nodeIndex} references missing punctual light ${lightIndex}`);
    }

    return Object.freeze({ index: lightIndex, light });
};

const scaleEmissiveFactor = (
    value: readonly [number, number, number] | undefined,
    strength: number
): readonly [number, number, number] =>
    Object.freeze([
        (value?.[0] ?? 0) * strength,
        (value?.[1] ?? 0) * strength,
        (value?.[2] ?? 0) * strength,
    ]) as readonly [number, number, number];

const createDocumentName = (
    normalized: NormalizedGltfSource,
    explicitName: string | undefined
): string =>
    sanitizeName(
        explicitName ??
            normalized.json.scenes?.[normalized.json.scene ?? 0]?.name ??
            stripExtension(basenameOfUri(normalized.sourceUri)) ??
            normalized.json.asset.generator,
        DEFAULT_DOCUMENT_NAME
    );

const ensureArray = <T>(value: readonly T[] | undefined): readonly T[] => value ?? EMPTY_ARRAY;


const createDefaultMaterialDefinition = (
    shaderId: string
): GltfMaterialDefinition =>
    Object.freeze({
        id: '',
        shaderId,
        uniforms: Object.freeze({
            _BaseColorFactor: Object.freeze([1, 1, 1, 1]),
            _MetallicFactor: 1,
            _RoughnessFactor: 1,
            _EmissiveFactor: Object.freeze([0, 0, 0]),
            _AlphaMode: 0,
            _AlphaCutoff: 0.5,
            _DoubleSided: 0,
        }),
        textures: Object.freeze({}),
    });

const createMaterialDefinition = (
    material: GltfMaterialJson,
    shaderId: string,
    textureKeys: readonly string[]
): {
    readonly definition: GltfMaterialDefinition;
    readonly textures: Readonly<Record<GltfTextureUsage, GltfMaterialTextureBinding>>;
    readonly alphaMode: GltfMaterialAlphaMode;
    readonly alphaCutoff: number;
    readonly doubleSided: boolean;
    readonly unlit: boolean;
} => {
    const emissiveStrength =
        material.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    const uniforms: Record<string, number | readonly number[]> = {
        _BaseColorFactor: material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
        _MetallicFactor: material.pbrMetallicRoughness?.metallicFactor ?? 1,
        _RoughnessFactor: material.pbrMetallicRoughness?.roughnessFactor ?? 1,
        _EmissiveFactor: scaleEmissiveFactor(material.emissiveFactor, emissiveStrength),
        _AlphaMode:
            material.alphaMode === 'MASK' ? 1 : material.alphaMode === 'BLEND' ? 2 : 0,
        _AlphaCutoff: material.alphaCutoff ?? 0.5,
        _DoubleSided: material.doubleSided ? 1 : 0,
    };
    const textureBindings: Record<string, string> = {};
    const textures: Partial<Record<GltfTextureUsage, GltfMaterialTextureBinding>> = {};

    const addTexture = (
        slot: GltfTextureUsage,
        source: GltfTextureBindingJson | undefined,
        uniformName: string,
        colorSpace: 'linear' | 'srgb'
    ): void => {
        if (!source) {
            return;
        }

        const textureKey = textureKeys[source.index];
        if (!textureKey) {
            throw new GltfSchemaError(
                `Material references missing texture ${source.index}`
            );
        }

        textureBindings[uniformName] = textureKey;
        const binding = createMaterialTextureBinding(slot, textureKey, source, colorSpace);
        textures[slot] = binding;
        if (binding.transform) {
            uniforms[`${uniformName}_ST`] = Object.freeze([
                binding.transform.scale[0],
                binding.transform.scale[1],
                binding.transform.offset[0],
                binding.transform.offset[1],
            ]);
            uniforms[`${uniformName}_Rotation`] = binding.transform.rotation;
            uniforms[`${uniformName}_TexCoord`] = binding.transform.texCoord;
        }
        if (binding.scale !== undefined) {
            uniforms[`${uniformName}_Scale`] = binding.scale;
        }
        if (binding.strength !== undefined) {
            uniforms[`${uniformName}_Strength`] = binding.strength;
        }
    };

    addTexture(
        'baseColor',
        material.pbrMetallicRoughness?.baseColorTexture,
        '_BaseColorTexture',
        'srgb'
    );
    addTexture(
        'metallicRoughness',
        material.pbrMetallicRoughness?.metallicRoughnessTexture,
        '_MetallicRoughnessTexture',
        'linear'
    );
    addTexture('normal', material.normalTexture, '_NormalTexture', 'linear');
    addTexture('occlusion', material.occlusionTexture, '_OcclusionTexture', 'linear');
    addTexture('emissive', material.emissiveTexture, '_EmissiveTexture', 'srgb');

    const unlit = material.extensions?.KHR_materials_unlit !== undefined;

    return {
        definition: Object.freeze({
            id: '',
            shaderId: unlit ? 'gltf/unlit' : shaderId,
            uniforms: Object.freeze(uniforms),
            textures: Object.freeze(textureBindings),
        }),
        textures: Object.freeze(
            textures as Record<GltfTextureUsage, GltfMaterialTextureBinding>
        ),
        alphaMode: material.alphaMode ?? 'OPAQUE',
        alphaCutoff: material.alphaCutoff ?? 0.5,
        doubleSided: material.doubleSided ?? false,
        unlit,
    };
};

const createActorSnapshot = (
    nodeId: string,
    parentNodeId: string | null,
    name: string,
    components: readonly GltfComponentSnapshot[]
): GltfActorSnapshot =>
    Object.freeze({
        nodeId,
        parentNodeId,
        name,
        layer: 0,
        tag: 'Default',
        active: true,
        persistent: false,
        pooled: false,
        components,
    });

const nodeIdFromIndex = (nodeIndex: number): string => `node/${nodeIndex}`;

const accessorTypeComponentCount = (type: GltfAccessorJson['type']): number => {
    switch (type) {
        case 'SCALAR':
            return 1;
        case 'VEC2':
            return 2;
        case 'VEC3':
            return 3;
        case 'VEC4':
        case 'MAT2':
            return 4;
        case 'MAT3':
            return 9;
        case 'MAT4':
            return 16;
    }

    throw new GltfSchemaError(`Unsupported accessor type: ${type}`);
};

const createSkinAsset = async (
    root: GltfRootJson,
    skinIndex: number,
    accessors: GltfAccessorRuntime,
    freeze: boolean
): Promise<GltfSkinAsset> => {
    const skin = root.skins?.[skinIndex];
    if (!skin) {
        throw new GltfSchemaError(`Missing skin ${skinIndex}`);
    }

    const jointNodeIds = skin.joints.map((jointIndex) => {
        if (!root.nodes?.[jointIndex]) {
            throw new GltfSchemaError(`Skin ${skinIndex} references a missing joint node ${jointIndex}`);
        }

        return nodeIdFromIndex(jointIndex);
    });

    if (skin.skeleton !== undefined && !root.nodes?.[skin.skeleton]) {
        throw new GltfSchemaError(`Skin ${skinIndex} references a missing skeleton node ${skin.skeleton}`);
    }

    let inverseBindMatrices: Float32Array | undefined;
    if (skin.inverseBindMatrices !== undefined) {
        const decoded = await accessors.decodeAccessor(skin.inverseBindMatrices);
        if (decoded.componentCount !== 16) {
            throw new GltfSchemaError(
                `Skin ${skinIndex} inverse bind matrices must use MAT4 accessors`
            );
        }

        if (decoded.count !== skin.joints.length) {
            throw new GltfSchemaError(
                `Skin ${skinIndex} inverse bind matrix count does not match its joints`
            );
        }

        inverseBindMatrices = new Float32Array(decoded.values.length);
        for (let matrixOffset = 0; matrixOffset < decoded.values.length; matrixOffset += 16) {
            inverseBindMatrices[matrixOffset + 0] = decoded.values[matrixOffset + 0]!;
            inverseBindMatrices[matrixOffset + 1] = decoded.values[matrixOffset + 4]!;
            inverseBindMatrices[matrixOffset + 2] = decoded.values[matrixOffset + 8]!;
            inverseBindMatrices[matrixOffset + 3] = decoded.values[matrixOffset + 12]!;
            inverseBindMatrices[matrixOffset + 4] = decoded.values[matrixOffset + 1]!;
            inverseBindMatrices[matrixOffset + 5] = decoded.values[matrixOffset + 5]!;
            inverseBindMatrices[matrixOffset + 6] = decoded.values[matrixOffset + 9]!;
            inverseBindMatrices[matrixOffset + 7] = decoded.values[matrixOffset + 13]!;
            inverseBindMatrices[matrixOffset + 8] = decoded.values[matrixOffset + 2]!;
            inverseBindMatrices[matrixOffset + 9] = decoded.values[matrixOffset + 6]!;
            inverseBindMatrices[matrixOffset + 10] = decoded.values[matrixOffset + 10]!;
            inverseBindMatrices[matrixOffset + 11] = decoded.values[matrixOffset + 14]!;
            inverseBindMatrices[matrixOffset + 12] = decoded.values[matrixOffset + 3]!;
            inverseBindMatrices[matrixOffset + 13] = decoded.values[matrixOffset + 7]!;
            inverseBindMatrices[matrixOffset + 14] = decoded.values[matrixOffset + 11]!;
            inverseBindMatrices[matrixOffset + 15] = decoded.values[matrixOffset + 15]!;
        }
    }

    return maybeFreeze(
        {
            id: sanitizeName(skin.name, `Skin ${skinIndex}`),
            skinIndex,
            jointNodeIds: Object.freeze(jointNodeIds),
            jointNodeIndices: Object.freeze([...skin.joints]),
            ...(skin.skeleton !== undefined
                ? {
                      skeletonNodeId: nodeIdFromIndex(skin.skeleton),
                      skeletonNodeIndex: skin.skeleton,
                  }
                : {}),
            ...(inverseBindMatrices ? { inverseBindMatrices } : {}),
        } satisfies GltfSkinAsset,
        freeze
    );
};

const createAnimationClipAsset = async (
    root: GltfRootJson,
    animationIndex: number,
    accessors: GltfAccessorRuntime,
    clipMetadataSources: GltfAnimationClipMetadataSourceIndex,
    diagnostics: AssetImportDiagnostic[],
    freeze: boolean
): Promise<GltfAnimationClipAsset> => {
    const animation = root.animations?.[animationIndex];
    if (!animation) {
        throw new GltfSchemaError(`Missing animation ${animationIndex}`);
    }

    const tracks: GltfAnimationClipAsset['tracks'][number][] = [];
    let duration = 0;

    for (let channelIndex = 0; channelIndex < animation.channels.length; channelIndex += 1) {
        const channel = animation.channels[channelIndex]!;
        const sampler = animation.samplers[channel.sampler];
        if (!sampler) {
            throw new GltfSchemaError(
                `Animation ${animationIndex} channel ${channelIndex} references a missing sampler`
            );
        }

        const targetNodeIndex = channel.target.node;
        if (targetNodeIndex === undefined) {
            throw new GltfSchemaError(
                `Animation ${animationIndex} channel ${channelIndex} is missing a target node`
            );
        }

        if (!root.nodes?.[targetNodeIndex]) {
            throw new GltfSchemaError(
                `Animation ${animationIndex} channel ${channelIndex} references a missing node ${targetNodeIndex}`
            );
        }

        const input = await accessors.decodeAccessor(sampler.input);
        if (input.componentCount !== 1) {
            throw new GltfSchemaError(
                `Animation ${animationIndex} sampler ${channel.sampler} input must use SCALAR accessors`
            );
        }

        const output = await accessors.decodeAccessor(sampler.output);
        const interpolation = sampler.interpolation ?? 'LINEAR';
        const keyframeCount = input.count;
        const sampleStride =
            keyframeCount > 0 ? output.values.length / keyframeCount : accessorTypeComponentCount(
                root.accessors?.[sampler.output]?.type ?? 'SCALAR'
            );

        if (!Number.isFinite(sampleStride) || Number.isInteger(sampleStride) === false) {
            throw new GltfSchemaError(
                `Animation ${animationIndex} sampler ${channel.sampler} output does not align with its keyframe count`
            );
        }

        const valueComponentCount =
            interpolation === 'CUBICSPLINE' ? sampleStride / 3 : sampleStride;
        if (
            interpolation === 'CUBICSPLINE' &&
            (sampleStride % 3 !== 0 || Number.isInteger(valueComponentCount) === false)
        ) {
            throw new GltfSchemaError(
                `Animation ${animationIndex} sampler ${channel.sampler} CUBICSPLINE output must pack in-tangent, value, and out-tangent triplets`
            );
        }

        for (const time of input.values) {
            duration = Math.max(duration, time);
        }

        tracks.push(
            maybeFreeze(
                {
                    channelIndex,
                    samplerIndex: channel.sampler,
                    inputAccessor: sampler.input,
                    outputAccessor: sampler.output,
                    targetNodeIndex,
                    targetNodeId: nodeIdFromIndex(targetNodeIndex),
                    path: channel.target.path,
                    interpolation,
                    keyframeCount,
                    valueComponentCount,
                    sampleStride,
                    times: input.values,
                    values: output.values,
                },
                freeze
            )
        );
    }

    const clipId = sanitizeName(animation.name, `Animation ${animationIndex}`);
    const clipMetadata =
        clipMetadataSources.byId.get(clipId) ??
        clipMetadataSources.byAnimationIndex.get(animationIndex);
    const exportedFeatures = clipMetadata?.featureExport
        ? exportMotionFeaturesFromTracks(
              clipId,
              Object.freeze(tracks),
              duration,
              clipMetadata.featureExport,
              diagnostics,
              (message) => createAnimationManifestDiagnostic(message),
              freeze
          )
        : undefined;
    const features =
        clipMetadata?.features || exportedFeatures
            ? Object.freeze(
                  [
                      ...(clipMetadata?.features ?? []),
                      ...(exportedFeatures ?? []),
                  ].sort((left, right) => left.time - right.time)
              )
            : undefined;

    return maybeFreeze(
        {
            id: clipId,
            animationIndex,
            duration,
            ...(clipMetadata?.events ? { events: clipMetadata.events } : {}),
            ...(clipMetadata?.footContacts ? { footContacts: clipMetadata.footContacts } : {}),
            ...(clipMetadata?.tags ? { tags: clipMetadata.tags } : {}),
            ...(features ? { features } : {}),
            ...(clipMetadata?.compression ? { compression: clipMetadata.compression } : {}),
            ...(clipMetadata?.streaming ? { streaming: clipMetadata.streaming } : {}),
            tracks: Object.freeze(tracks),
        } satisfies GltfAnimationClipAsset,
        freeze
    );
};

const buildPrefabDefinition = (
    root: GltfRootJson,
    sceneIndex: number,
    defaultSceneIndex: number,
    meshKeysByMesh: readonly (readonly string[])[],
    materialKeysByMesh: readonly (readonly (string | undefined)[])[],
    skinsByIndex: readonly (GltfSkinAsset | undefined)[],
    skinKeysByIndex: readonly string[],
    animationsByIndex: readonly (GltfAnimationClipAsset | undefined)[],
    animationKeysByIndex: readonly string[],
    manifest: PortableAnimationManifest | undefined
): PrefabBuildResult => {
    const scene = root.scenes?.[sceneIndex];
    if (!scene) {
        throw new GltfSchemaError(`Missing scene ${sceneIndex}`);
    }

    const actors: GltfActorSnapshot[] = [];
    const rootNodeIds: string[] = [];
    const nodeIds: string[] = [];
    const meshKeys = new Set<string>();
    const skinKeys = new Set<string>();
    const animationKeys = new Set<string>();
    const materialKeys = new Set<string>();
    const diagnostics: AssetImportDiagnostic[] = [];
    let primaryCameraAssigned = false;
    let primaryDirectionalAssigned = false;
    let directionalLightCount = 0;
    let localLightCount = 0;

    const visitNode = (nodeIndex: number, parentNodeId: string | null): void => {
        const node = root.nodes?.[nodeIndex];
        if (!node) {
            throw new GltfSchemaError(`Missing node ${nodeIndex}`);
        }

        const baseNodeId = `node/${nodeIndex}`;
        if (parentNodeId === null) {
            rootNodeIds.push(baseNodeId);
        }

        const primitives =
            node.mesh !== undefined ? meshKeysByMesh[node.mesh] ?? EMPTY_ARRAY : EMPTY_ARRAY;
        const primitiveMaterials =
            node.mesh !== undefined ? materialKeysByMesh[node.mesh] ?? EMPTY_ARRAY : EMPTY_ARRAY;
        const meshDefinition = node.mesh !== undefined ? root.meshes?.[node.mesh] : undefined;
        const primitiveMorphWeights = meshDefinition
            ? meshDefinition.primitives.map((_, primitiveIndex) =>
                  createMorphWeights(node, meshDefinition, primitiveIndex)
              )
            : EMPTY_ARRAY;
        const transformComponent = createTransformSnapshot(node);
        const nodeName = sanitizeName(node.name, `Node ${nodeIndex}`);
                const skin =
                        node.skin !== undefined
                                ? skinsByIndex[node.skin] ??
                                    (() => {
                                            throw new GltfSchemaError(`Missing skin ${node.skin}`);
                                    })()
                                : undefined;
                const skinBinding = createSkinBinding(skin);
        const punctualLight = resolveNodeLight(root, node, nodeIndex);
        const cameraComponent =
            node.camera !== undefined
                ? createCameraSnapshot(
                      root.cameras?.[node.camera] ??
                          (() => {
                              throw new GltfSchemaError(`Missing camera ${node.camera}`);
                          })(),
                      sceneIndex === defaultSceneIndex && primaryCameraAssigned === false
                  )
                : undefined;
        const lightComponent =
            punctualLight?.light.type === 'directional'
                ? createDirectionalLightSnapshot(
                      punctualLight.light,
                      sceneIndex === defaultSceneIndex && primaryDirectionalAssigned === false
                  )
                : punctualLight?.light.type === 'point'
                  ? createPointLightSnapshot(punctualLight.light)
                                    : punctualLight?.light.type === 'spot'
                                        ? createSpotLightSnapshot(punctualLight.light)
                  : undefined;

        if (cameraComponent && sceneIndex === defaultSceneIndex && primaryCameraAssigned === false) {
            primaryCameraAssigned = true;
        }

        if (
            punctualLight?.light.type === 'directional' &&
            sceneIndex === defaultSceneIndex &&
            primaryDirectionalAssigned === false
        ) {
            primaryDirectionalAssigned = true;
        }

        if (punctualLight?.light.type === 'directional') {
            directionalLightCount += 1;
        } else if (
            punctualLight?.light.type === 'point' ||
            punctualLight?.light.type === 'spot'
        ) {
            localLightCount += 1;
        }

        if (primitives.length <= 1) {
            const components = Object.freeze([
                transformComponent,
                ...(cameraComponent ? [cameraComponent] : EMPTY_ARRAY),
                ...(lightComponent ? [lightComponent] : EMPTY_ARRAY),
                ...(primitives.length === 1
                    ? [
                          createMeshRendererSnapshot(
                              primitives[0]!,
                              primitiveMaterials[0],
                              primitiveMorphWeights[0],
                              skinBinding
                          ),
                      ]
                    : EMPTY_ARRAY),
            ]);

            actors.push(createActorSnapshot(baseNodeId, parentNodeId, nodeName, components));
            nodeIds.push(baseNodeId);

            if (primitives.length === 1) {
                meshKeys.add(primitives[0]!);
                if (node.skin !== undefined && skinKeysByIndex[node.skin]) {
                    skinKeys.add(skinKeysByIndex[node.skin]!);
                }
                if (primitiveMaterials[0]) {
                    materialKeys.add(primitiveMaterials[0]!);
                }
            }
        } else {
            actors.push(
                createActorSnapshot(
                    baseNodeId,
                    parentNodeId,
                    nodeName,
                    Object.freeze([
                        transformComponent,
                        ...(cameraComponent ? [cameraComponent] : EMPTY_ARRAY),
                        ...(lightComponent ? [lightComponent] : EMPTY_ARRAY),
                    ])
                )
            );
            nodeIds.push(baseNodeId);

            for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
                const primitiveNodeId = `${baseNodeId}/primitive/${primitiveIndex}`;
                actors.push(
                    createActorSnapshot(
                        primitiveNodeId,
                        baseNodeId,
                        `${nodeName} Primitive ${primitiveIndex}`,
                        Object.freeze([
                            Object.freeze({
                                type: 'Transform',
                                data: Object.freeze({
                                    position: Object.freeze([0, 0, 0]),
                                    rotation: Object.freeze([0, 0, 0, 1]),
                                    scale: Object.freeze([1, 1, 1]),
                                }),
                            }),
                            createMeshRendererSnapshot(
                                primitives[primitiveIndex]!,
                                primitiveMaterials[primitiveIndex],
                                primitiveMorphWeights[primitiveIndex],
                                skinBinding
                            ),
                        ])
                    )
                );
                nodeIds.push(primitiveNodeId);
                meshKeys.add(primitives[primitiveIndex]!);
                if (node.skin !== undefined && skinKeysByIndex[node.skin]) {
                    skinKeys.add(skinKeysByIndex[node.skin]!);
                }
                if (primitiveMaterials[primitiveIndex]) {
                    materialKeys.add(primitiveMaterials[primitiveIndex]!);
                }
            }
        }

        for (const child of ensureArray(node.children)) {
            visitNode(child, baseNodeId);
        }
    };

    for (const rootNode of ensureArray(scene.nodes)) {
        visitNode(rootNode, null);
    }

    const importedNodeIds = new Set(nodeIds.filter((nodeId) => nodeId.startsWith('node/')));
    const sceneAnimations = animationsByIndex
        .map((animation, index) => {
            if (!animation) {
                return undefined;
            }

            const hasTrackedTarget = animation.tracks.some(
                (track) =>
                    importedNodeIds.has(track.targetNodeId) &&
                    (track.path === 'translation' ||
                        track.path === 'rotation' ||
                        track.path === 'scale' ||
                        track.path === 'weights')
            );
            if (!hasTrackedTarget) {
                return undefined;
            }

            if (animationKeysByIndex[index]) {
                animationKeys.add(animationKeysByIndex[index]!);
            }
            return animation;
        })
        .filter((animation): animation is GltfAnimationClipAsset => Boolean(animation));

    const animationController = resolveSceneAnimationControllerMetadata(
        root.scenes?.[sceneIndex],
        sceneIndex,
        new Set(sceneAnimations.map((animation) => animation.id)),
        importedNodeIds,
        sceneAnimations,
        manifest,
        diagnostics,
        true
    );

    const animatorComponent = createAnimatorSnapshot(sceneAnimations, animationController);
    if (animatorComponent) {
        const firstRootActorIndex = actors.findIndex((actor) => actor.parentNodeId === null);
        if (firstRootActorIndex >= 0) {
            const firstRootActor = actors[firstRootActorIndex]!;
            actors[firstRootActorIndex] = Object.freeze({
                ...firstRootActor,
                components: Object.freeze([...firstRootActor.components, animatorComponent]),
            });
        }
    }

    if (directionalLightCount > 1) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.light.directional.runtime-limit',
                message: `Scene ${sceneIndex} imports ${directionalLightCount} directional lights, but Axrone currently shades only one directional light`,
            } satisfies AssetImportDiagnostic)
        );
    }

    if (localLightCount > MAX_SCENE_LOCAL_LIGHTS) {
        diagnostics.push(
            Object.freeze({
                level: 'warning',
                code: 'gltf.light.local.runtime-limit',
                message: `Scene ${sceneIndex} imports ${localLightCount} local lights, but Axrone currently shades only ${MAX_SCENE_LOCAL_LIGHTS} point/spot lights`,
            } satisfies AssetImportDiagnostic)
        );
    }

    return {
        prefab: Object.freeze({
            id: `gltf/scene/${sceneIndex}`,
            actors: Object.freeze(actors),
        }),
        rootNodeIds: Object.freeze(rootNodeIds),
        nodeIds: Object.freeze(nodeIds),
        meshKeys: Object.freeze([...meshKeys]),
        skinKeys: Object.freeze([...skinKeys]),
        animationKeys: Object.freeze([...animationKeys]),
        materialKeys: Object.freeze([...materialKeys]),
        ...(animationController ? { animationController } : {}),
        diagnostics: Object.freeze(diagnostics),
    };
};

export class GltfTextureTranscoderRegistry {
    private readonly _transcoders = new Map<string, GltfTextureTranscoder>();

    constructor(transcoders: readonly GltfTextureTranscoder[] = EMPTY_ARRAY) {
        for (const transcoder of transcoders) {
            this.register(transcoder);
        }
    }

    register(transcoder: GltfTextureTranscoder): this {
        this._transcoders.set(transcoder.id, transcoder);
        return this;
    }

    unregister(id: string): boolean {
        return this._transcoders.delete(id);
    }

    list(): readonly GltfTextureTranscoder[] {
        return Object.freeze(
            [...this._transcoders.values()].sort(
                (left, right) =>
                    (right.priority ?? 0) - (left.priority ?? 0) ||
                    left.id.localeCompare(right.id)
            )
        );
    }

    resolve(request: Readonly<GltfTextureTranscodeRequest>): GltfTextureTranscoder | undefined {
        return this.list().find((transcoder) => transcoder.canTranscode(request));
    }

    async transcode(
        request: Readonly<GltfTextureTranscodeRequest>
    ): Promise<GltfTextureTranscodeResult | undefined> {
        const transcoder = this.resolve(request);
        return transcoder ? transcoder.transcode(request) : undefined;
    }
}

const isTextureWrite = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<TSchema>
): boolean => input.kind === 'gltf.texture';

const applyTextureTranscode = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<TSchema>,
    result: GltfTextureTranscodeResult
): AssetWriteInput<TSchema> => {
    const data = input.data as unknown as GltfTextureAsset;
    const updated = Object.freeze({
        ...data,
        payload: result.payload ?? data.payload,
        runtimeFormat: result.runtimeFormat ?? data.runtimeFormat,
        transcode: result.state,
    }) as unknown as TSchema['gltf.texture'];

    return Object.freeze({
        ...input,
        data: updated,
    }) as unknown as AssetWriteInput<TSchema>;
};

const asWrite = <TSchema extends GltfAssetSchemaLike>(
    input: AssetWriteInput<any>
): AssetWriteInput<TSchema> => input as unknown as AssetWriteInput<TSchema>;

export const createGltfTextureTranscodeStage = <
    TSchema extends GltfAssetSchemaLike = GltfAssetSchema,
>(
    options: GltfTextureTranscodeStageOptions<TSchema> = {}
): GltfTranscodeStage<TSchema> => {
    const registry = options.registry ?? new GltfTextureTranscoderRegistry();

    return {
        id: options.id ?? 'gltf.texture.transcode',
        phases: ['after-import'],
        run: async (context) => {
            if (context.phase !== 'after-import') {
                return {};
            }

            const { result, signal } = context;
            const diagnostics: AssetImportDiagnostic[] = [];
            let primary = result.primary;
            let primaryChanged = false;
            let additionalChanged = false;
            const additional = result.additional ? [...result.additional] : undefined;

            if (isTextureWrite(primary)) {
                const transcode = await registry.transcode({
                    texture: primary.data as unknown as GltfTextureAsset,
                    signal,
                });
                if (transcode) {
                    primary = applyTextureTranscode(primary, transcode);
                    primaryChanged = true;
                    if (transcode.diagnostics?.length) {
                        diagnostics.push(...transcode.diagnostics);
                    }
                }
            }

            if (additional) {
                for (let index = 0; index < additional.length; index += 1) {
                    const entry = additional[index]!;
                    if (!isTextureWrite(entry)) {
                        continue;
                    }

                    const transcode = await registry.transcode({
                        texture: entry.data as unknown as GltfTextureAsset,
                        signal,
                    });
                    if (!transcode) {
                        continue;
                    }

                    additional[index] = applyTextureTranscode(entry, transcode);
                    additionalChanged = true;
                    if (transcode.diagnostics?.length) {
                        diagnostics.push(...transcode.diagnostics);
                    }
                }
            }

            if (!primaryChanged && !additionalChanged && diagnostics.length === 0) {
                return {};
            }

            return {
                result: Object.freeze({
                    ...result,
                    primary,
                    ...(additional
                        ? {
                              additional: Object.freeze(additional),
                          }
                        : {}),
                    diagnostics:
                        diagnostics.length > 0
                            ? Object.freeze([
                                  ...(result.diagnostics ?? EMPTY_ARRAY),
                                  ...diagnostics,
                              ])
                            : result.diagnostics,
                }),
            };
        },
    };
};

export const createPassthroughGltfTextureTranscoder = (
    targetFormat?: TextureFormat
): GltfTextureTranscoder => ({
    id: 'gltf.texture.passthrough',
    priority: -100,
    canTranscode: () => true,
    transcode: ({ texture }) => ({
        runtimeFormat: texture.runtimeFormat ?? inferTextureFormat(texture.payload) ?? targetFormat,
        state: {
            status: 'source',
            transcoderId: 'gltf.texture.passthrough',
            targetFormat:
                texture.runtimeFormat ?? inferTextureFormat(texture.payload) ?? targetFormat,
        },
    }),
});

export const createGltfImporter = <
    TSchema extends GltfAssetSchemaLike = GltfAssetSchema,
>(
    options: GltfImporterOptions<TSchema> = {}
): GltfImporter<TSchema> => {
    const freeze = options.freeze !== false;
    const materialShaderId = options.materialShaderId ?? 'gltf/pbr';
    const fallbackSamplerId = options.defaultSamplerId ?? DEFAULT_SAMPLER_ID;

    const importer = {
        id: options.id ?? 'asset.gltf',
        sourceKinds: ['bytes', 'text', 'json', 'custom'],
        extensions: ['gltf', 'glb'],
        mimeTypes: ['model/gltf+json', 'model/gltf-binary', 'application/json'],
        canImport: (context: Readonly<{ source: AssetImportSource }>) => {
            const { source } = context;
            if (isGltfPackageSource(source)) {
                return true;
            }

            if (source.kind === 'json') {
                return isPlainObject(source.data) && isPlainObject(source.data.asset);
            }

            if (source.kind === 'text') {
                return source.data.trimStart().startsWith('{');
            }

            if (source.kind === 'bytes') {
                const inferred = inferFormatFromSource(source);
                return inferred === 'glb' || inferred === 'gltf';
            }

            return false;
        },
        import: async (
            context: Readonly<{
                source: AssetImportSource;
                createSubKey: (suffix: string) => string;
            }>
        ) => {
            const { source, createSubKey } = context;
            const normalized = normalizeGltfSource(source);
            assertSupportedRequiredExtensions(normalized.json);
            const runtime = new GltfResourceRuntime(normalized, source, options.resourceResolver);
            const accessors = new GltfAccessorRuntime(runtime);
            const diagnostics: AssetImportDiagnostic[] = [
                ...collectExtensionDiagnostics(normalized.json),
                ...collectFeatureDiagnostics(normalized.json),
            ];
            const animationManifest = resolvePortableAnimationManifest(normalized, diagnostics);
            const textureUsageMap = collectTextureUsages(normalized.json);
            const explicitTextures = normalized.json.textures ?? EMPTY_ARRAY;
            const explicitMaterials = normalized.json.materials ?? EMPTY_ARRAY;
            const explicitMeshes = normalized.json.meshes ?? EMPTY_ARRAY;
            const explicitSkins = normalized.json.skins ?? EMPTY_ARRAY;
            const explicitAnimations = normalized.json.animations ?? EMPTY_ARRAY;
            const clipMetadataSources = resolvePortableAnimationClipMetadataSources(
                animationManifest,
                diagnostics,
                freeze
            );
            const textureKeys = explicitTextures.map((_, index) =>
                String(createSubKey(`texture/${index}`))
            );
            const materialKeys = explicitMaterials.map((_, index) =>
                String(createSubKey(`material/${index}`))
            );
            const skinKeys = explicitSkins.map((_, index) => String(createSubKey(`skin/${index}`)));
            const animationKeys = explicitAnimations.map((_, index) =>
                String(createSubKey(`animation/${index}`))
            );
            const meshKeysByMesh: string[][] = [];
            const materialKeysByMesh: Array<Array<string | undefined>> = [];
            const skinsByIndex: Array<GltfSkinAsset | undefined> = [];
            const animationsByIndex: Array<GltfAnimationClipAsset | undefined> = [];
            const additional: AssetWriteInput<TSchema>[] = [];
            let defaultMaterialKey: string | undefined;

            for (let textureIndex = 0; textureIndex < explicitTextures.length; textureIndex += 1) {
                const texture = explicitTextures[textureIndex]!;
                const imageIndex = resolveTextureImageIndex(texture);
                if (imageIndex === undefined) {
                    diagnostics.push({
                        level: 'warning',
                        code: 'gltf.texture.missing-source',
                        message: `Texture ${textureIndex} does not declare an image source`,
                    });
                    continue;
                }

                const payload = await runtime.resolveImage(imageIndex);
                const sampler = createSamplerDefinition(
                    texture.sampler,
                    texture.sampler !== undefined
                        ? normalized.json.samplers?.[texture.sampler]
                        : undefined,
                    fallbackSamplerId
                );
                const usageHints = Object.freeze([
                    ...(textureUsageMap.get(textureIndex) ?? EMPTY_ARRAY),
                ]);
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(texture.name, `Texture ${textureIndex}`),
                        textureIndex,
                        imageIndex,
                        sampler,
                        payload,
                        usageHints,
                        runtimeFormat: inferTextureFormat(payload),
                        transcode: Object.freeze({
                            status: 'source',
                            targetFormat: inferTextureFormat(payload),
                        }),
                    } satisfies GltfTextureAsset,
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.texture',
                        stableKey: textureKeys[textureIndex],
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.texture'],
                    }))
                );
            }

            const requiresDefaultMaterial = explicitMeshes.some((mesh) =>
                mesh.primitives.some((primitive) => primitive.material === undefined)
            );
            if (requiresDefaultMaterial) {
                defaultMaterialKey = String(createSubKey(DEFAULT_MATERIAL_KEY_SUFFIX));
                const definition = createDefaultMaterialDefinition(materialShaderId);
                const asset = maybeFreeze(
                    {
                        id: DEFAULT_MATERIAL_NAME,
                        materialIndex: -1,
                        definition: Object.freeze({
                            ...definition,
                            id: defaultMaterialKey,
                        }),
                        alphaMode: 'OPAQUE',
                        alphaCutoff: 0.5,
                        doubleSided: false,
                        unlit: false,
                        textures: Object.freeze({}),
                    } satisfies GltfMaterialAsset,
                    freeze
                );
                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.material',
                        stableKey: defaultMaterialKey,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.material'],
                    }))
                );
            }

            for (let materialIndex = 0; materialIndex < explicitMaterials.length; materialIndex += 1) {
                const material = explicitMaterials[materialIndex]!;
                const built = createMaterialDefinition(material, materialShaderId, textureKeys);
                const key = materialKeys[materialIndex]!;
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(material.name, `Material ${materialIndex}`),
                        materialIndex,
                        definition: Object.freeze({
                            ...built.definition,
                            id: key,
                        }),
                        alphaMode: built.alphaMode,
                        alphaCutoff: built.alphaCutoff,
                        doubleSided: built.doubleSided,
                        unlit: built.unlit,
                        textures: built.textures,
                    } satisfies GltfMaterialAsset,
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.material',
                        stableKey: key,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.material'],
                        dependencies: Object.freeze(
                            Object.values(asset.textures).map((binding) => binding.textureKey)
                        ),
                    }))
                );
            }

            for (let meshIndex = 0; meshIndex < explicitMeshes.length; meshIndex += 1) {
                const mesh = explicitMeshes[meshIndex]!;
                const primitiveKeys: string[] = [];
                const primitiveMaterialKeys: Array<string | undefined> = [];

                for (
                    let primitiveIndex = 0;
                    primitiveIndex < mesh.primitives.length;
                    primitiveIndex += 1
                ) {
                    const primitive = mesh.primitives[primitiveIndex]!;
                    diagnostics.push(
                        ...collectPrimitiveDiagnostics(primitive, meshIndex, primitiveIndex)
                    );
                    const built = await buildMeshDefinition(primitive, accessors, runtime);
                    const key = String(
                        createSubKey(`mesh/${meshIndex}/primitive/${primitiveIndex}`)
                    );
                    const materialKey =
                        primitive.material !== undefined
                            ? materialKeys[primitive.material]
                            : defaultMaterialKey;
                    const meshAsset = maybeFreeze(
                        {
                            id: sanitizeName(
                                mesh.name,
                                `${sanitizeName(mesh.name, `Mesh ${meshIndex}`)} Primitive ${primitiveIndex}`
                            ),
                            meshIndex,
                            primitiveIndex,
                            definition: Object.freeze({
                                ...built.definition,
                                id: key,
                            }),
                            ...(built.bounds ? { bounds: built.bounds } : {}),
                            ...(materialKey ? { materialKey } : {}),
                            ...(primitive.extras ? { extras: primitive.extras } : {}),
                        } satisfies GltfMeshAsset,
                        freeze
                    );

                    additional.push(
                        asWrite<TSchema>(Object.freeze({
                            kind: 'gltf.mesh',
                            stableKey: key,
                            name: meshAsset.id,
                            data: meshAsset as unknown as TSchema['gltf.mesh'],
                            ...(materialKey
                                ? {
                                      dependencies: Object.freeze([materialKey]),
                                  }
                                : {}),
                        }))
                    );
                    primitiveKeys.push(key);
                    primitiveMaterialKeys.push(materialKey);
                }

                meshKeysByMesh[meshIndex] = primitiveKeys;
                materialKeysByMesh[meshIndex] = primitiveMaterialKeys;
            }

            for (let skinIndex = 0; skinIndex < explicitSkins.length; skinIndex += 1) {
                const key = skinKeys[skinIndex]!;
                const asset = await createSkinAsset(normalized.json, skinIndex, accessors, freeze);
                skinsByIndex[skinIndex] = asset;
                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.skin',
                        stableKey: key,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.skin'],
                    }))
                );
            }

            for (let animationIndex = 0; animationIndex < explicitAnimations.length; animationIndex += 1) {
                const key = animationKeys[animationIndex]!;
                const asset = await createAnimationClipAsset(
                    normalized.json,
                    animationIndex,
                    accessors,
                    clipMetadataSources,
                    diagnostics,
                    freeze
                );
                animationsByIndex[animationIndex] = asset;
                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.animation',
                        stableKey: key,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.animation'],
                    }))
                );
            }

            const scenes =
                normalized.json.scenes && normalized.json.scenes.length > 0
                    ? normalized.json.scenes
                    : Object.freeze([
                          Object.freeze({
                              name: 'Scene 0',
                              nodes: Object.freeze(
                                  ensureArray(normalized.json.nodes).map((_, index) => index)
                              ),
                          }),
                      ]);
            const defaultSceneIndex = Math.min(
                Math.max(normalized.json.scene ?? 0, 0),
                Math.max(0, scenes.length - 1)
            );
            const sceneEntries: GltfDocumentSceneAsset[] = [];

            for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex += 1) {
                const built = buildPrefabDefinition(
                    normalized.json,
                    sceneIndex,
                    defaultSceneIndex,
                    meshKeysByMesh,
                    materialKeysByMesh,
                    skinsByIndex,
                    skinKeys,
                    animationsByIndex,
                    animationKeys,
                    animationManifest
                );
                diagnostics.push(...built.diagnostics);
                const key = String(createSubKey(`scene/${sceneIndex}/prefab`));
                const asset = maybeFreeze(
                    {
                        id: sanitizeName(scenes[sceneIndex]?.name, `Scene ${sceneIndex}`),
                        sceneIndex,
                        definition: Object.freeze({
                            ...built.prefab,
                            id: key,
                        }),
                        rootNodeIds: built.rootNodeIds,
                        nodeIds: built.nodeIds,
                        meshKeys: built.meshKeys,
                        skinKeys: built.skinKeys,
                        animationKeys: built.animationKeys,
                        materialKeys: built.materialKeys,
                        ...(built.animationController
                            ? { animationController: built.animationController }
                            : {}),
                    },
                    freeze
                );

                additional.push(
                    asWrite<TSchema>(Object.freeze({
                        kind: 'gltf.prefab',
                        stableKey: key,
                        name: asset.id,
                        data: asset as unknown as TSchema['gltf.prefab'],
                        dependencies: Object.freeze([
                            ...built.meshKeys,
                            ...built.skinKeys,
                            ...built.animationKeys,
                            ...built.materialKeys,
                        ]),
                    }))
                );
                sceneEntries.push(
                    maybeFreeze(
                        {
                            sceneIndex,
                            name: asset.id,
                            prefabKey: key,
                            rootNodeIds: built.rootNodeIds,
                            ...(built.animationController
                                ? { animationController: built.animationController }
                                : {}),
                        } satisfies GltfDocumentSceneAsset,
                        freeze
                    )
                );
            }

            const document = maybeFreeze(
                {
                    id: createDocumentName(normalized, options.documentName),
                    uri: normalized.sourceUri,
                    name: createDocumentName(normalized, options.documentName),
                    format: normalized.format,
                    version: normalized.json.asset.version,
                    ...(normalized.json.asset.generator
                        ? { generator: normalized.json.asset.generator }
                        : {}),
                    ...(normalized.json.asset.copyright
                        ? { copyright: normalized.json.asset.copyright }
                        : {}),
                    defaultScene: defaultSceneIndex,
                    scenes: Object.freeze(sceneEntries),
                    meshKeys: Object.freeze(meshKeysByMesh.flat()),
                    skinKeys: Object.freeze([...skinKeys]),
                    animationKeys: Object.freeze([...animationKeys]),
                    materialKeys: Object.freeze(
                        [
                            ...(defaultMaterialKey ? [defaultMaterialKey] : EMPTY_ARRAY),
                            ...materialKeys,
                        ].filter((value): value is string => Boolean(value))
                    ),
                    textureKeys: Object.freeze(textureKeys.filter(Boolean)),
                    extensionsUsed: Object.freeze([
                        ...(normalized.json.extensionsUsed ?? EMPTY_ARRAY),
                    ]),
                    extensionsRequired: Object.freeze([
                        ...(normalized.json.extensionsRequired ?? EMPTY_ARRAY),
                    ]),
                    stats: Object.freeze({
                        sceneCount: sceneEntries.length,
                        nodeCount: ensureArray(normalized.json.nodes).length,
                        cameraCount: ensureArray(normalized.json.cameras).length,
                        lightCount:
                            ensureArray(normalized.json.extensions?.KHR_lights_punctual?.lights)
                                .length,
                        meshCount: explicitMeshes.length,
                        primitiveCount: meshKeysByMesh.reduce(
                            (total, entries) => total + entries.length,
                            0
                        ),
                        materialCount:
                            explicitMaterials.length + (defaultMaterialKey ? 1 : 0),
                        textureCount: textureKeys.length,
                        skinCount: ensureArray(normalized.json.skins).length,
                        animationCount: ensureArray(normalized.json.animations).length,
                    }),
                } satisfies GltfDocumentAsset,
                freeze
            );

            return Object.freeze({
                primary: asWrite<TSchema>(Object.freeze({
                    kind: 'gltf.document',
                    stableKey: String(createSubKey('document')),
                    name: document.name,
                    data: document as unknown as TSchema['gltf.document'],
                    dependencies: Object.freeze([
                        ...document.textureKeys,
                        ...document.materialKeys,
                        ...document.meshKeys,
                        ...document.skinKeys,
                        ...document.animationKeys,
                        ...document.scenes.map((scene) => scene.prefabKey),
                    ]),
                })),
                additional: Object.freeze(additional),
                diagnostics: Object.freeze(diagnostics),
            }) as AssetImportResult<TSchema>;
        },
    };

    return importer as unknown as GltfImporter<TSchema>;
};
