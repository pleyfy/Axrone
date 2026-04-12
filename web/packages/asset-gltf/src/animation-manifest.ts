import type {
    GltfAnimationClipMetadata,
    GltfAnimationControllerMetadata,
    GltfPackageResourceInput,
} from './types';

export interface PortableAnimationFeatureExportDefinition {
    readonly rootNodeId?: string;
    readonly rootNodeIndex?: number;
    readonly sampleInterval?: number;
    readonly sampleTimes?: readonly number[];
    readonly forwardAxis?: readonly [number, number, number];
    readonly tags?: readonly string[];
    readonly costBias?: number;
}

export interface PortableAnimationClipManifestEntry extends Omit<GltfAnimationClipMetadata, 'id'> {
    readonly id?: string;
    readonly clipId?: string;
    readonly animationIndex?: number;
    readonly featureExport?: PortableAnimationFeatureExportDefinition;
}

export interface PortableAnimationManifestSceneEntry {
    readonly scene?: number;
    readonly sceneName?: string;
    readonly controller?: GltfAnimationControllerMetadata;
    readonly clips?: readonly PortableAnimationClipManifestEntry[];
}

export interface PortableAnimationManifest {
    readonly controller?: GltfAnimationControllerMetadata;
    readonly scenes?: readonly PortableAnimationManifestSceneEntry[];
    readonly clips?: readonly PortableAnimationClipManifestEntry[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Array.isArray(value) === false;

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const cloneSerializable = <T>(value: T): T => {
    if (Array.isArray(value)) {
        return Object.freeze(value.map((entry) => cloneSerializable(entry))) as T;
    }
    if (value instanceof Float32Array) {
        return new Float32Array(value) as T;
    }
    if (!isRecord(value)) {
        return value;
    }
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        cloned[key] = cloneSerializable(entry);
    }
    return Object.freeze(cloned) as T;
};

const cloneStringArray = (value: readonly string[] | undefined): readonly string[] | undefined => {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const tags = [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))];
    return tags.length > 0 ? Object.freeze(tags) : undefined;
};

const cloneFeatureExport = (
    value: PortableAnimationFeatureExportDefinition | undefined
): PortableAnimationFeatureExportDefinition | undefined => {
    if (!value) {
        return undefined;
    }
    const sampleTimes = Array.isArray(value.sampleTimes)
        ? Object.freeze(
              value.sampleTimes
                  .filter((entry): entry is number => isFiniteNumber(entry))
                  .map((entry) => Math.max(0, entry))
          )
        : undefined;
    const forwardAxis =
        Array.isArray(value.forwardAxis) &&
        value.forwardAxis.length === 3 &&
        value.forwardAxis.every((entry) => isFiniteNumber(entry))
            ? (Object.freeze([
                  value.forwardAxis[0],
                  value.forwardAxis[1],
                  value.forwardAxis[2],
              ]) as readonly [number, number, number])
            : undefined;
    const featureExport = {
        ...(typeof value.rootNodeId === 'string' && value.rootNodeId.length > 0
            ? { rootNodeId: value.rootNodeId }
            : {}),
        ...(isFiniteNumber(value.rootNodeIndex)
            ? { rootNodeIndex: Math.max(0, Math.trunc(value.rootNodeIndex)) }
            : {}),
        ...(isFiniteNumber(value.sampleInterval) && value.sampleInterval > 0
            ? { sampleInterval: value.sampleInterval }
            : {}),
        ...(sampleTimes && sampleTimes.length > 0 ? { sampleTimes } : {}),
        ...(forwardAxis ? { forwardAxis } : {}),
        ...(cloneStringArray(value.tags) ? { tags: cloneStringArray(value.tags) } : {}),
        ...(isFiniteNumber(value.costBias) ? { costBias: value.costBias } : {}),
    } satisfies PortableAnimationFeatureExportDefinition;
    return Object.keys(featureExport).length > 0 ? Object.freeze(featureExport) : undefined;
};

const cloneClipMetadata = (
    clip: PortableAnimationClipManifestEntry | undefined
): PortableAnimationClipManifestEntry | undefined => {
    if (!clip) {
        return undefined;
    }
    const featureExport = cloneFeatureExport(clip.featureExport);
    const cloned = {
        ...(typeof clip.id === 'string' && clip.id.length > 0 ? { id: clip.id } : {}),
        ...(typeof clip.clipId === 'string' && clip.clipId.length > 0 ? { clipId: clip.clipId } : {}),
        ...(isFiniteNumber(clip.animationIndex) ? { animationIndex: Math.max(0, Math.trunc(clip.animationIndex)) } : {}),
        ...(clip.events ? { events: cloneSerializable(clip.events) } : {}),
        ...(clip.footContacts ? { footContacts: cloneSerializable(clip.footContacts) } : {}),
        ...(cloneStringArray(clip.tags) ? { tags: cloneStringArray(clip.tags) } : {}),
        ...(clip.features ? { features: cloneSerializable(clip.features) } : {}),
        ...(clip.compression ? { compression: cloneSerializable(clip.compression) } : {}),
        ...(clip.streaming ? { streaming: cloneSerializable(clip.streaming) } : {}),
        ...(featureExport ? { featureExport } : {}),
    } satisfies PortableAnimationClipManifestEntry;
    return cloned.id || cloned.clipId || cloned.animationIndex !== undefined ? Object.freeze(cloned) : undefined;
};

const cloneControllerMetadata = (
    controller: GltfAnimationControllerMetadata | undefined
): GltfAnimationControllerMetadata | undefined => {
    if (!controller) {
        return undefined;
    }
    const clips = Array.isArray(controller.clips)
        ? Object.freeze(
              controller.clips
                  .map((clip) => cloneClipMetadata(clip))
                  .filter((clip): clip is PortableAnimationClipManifestEntry => Boolean(clip))
                  .map((clip) =>
                      Object.freeze({
                          id: clip.id ?? clip.clipId!,
                          ...(clip.events ? { events: clip.events } : {}),
                          ...(clip.footContacts ? { footContacts: clip.footContacts } : {}),
                          ...(clip.tags ? { tags: clip.tags } : {}),
                          ...(clip.features ? { features: clip.features } : {}),
                          ...(clip.compression ? { compression: clip.compression } : {}),
                          ...(clip.streaming ? { streaming: clip.streaming } : {}),
                      } satisfies GltfAnimationClipMetadata)
                  )
          )
        : undefined;
    const cloned = {
        ...(controller.parameters ? { parameters: cloneSerializable(controller.parameters) } : {}),
        ...(controller.layers ? { layers: cloneSerializable(controller.layers) } : {}),
        ...(controller.rootMotion !== undefined ? { rootMotion: cloneSerializable(controller.rootMotion) } : {}),
        ...(clips && clips.length > 0 ? { clips } : {}),
    } satisfies GltfAnimationControllerMetadata;
    return Object.keys(cloned).length > 0 ? Object.freeze(cloned) : undefined;
};

export const createPortableAnimationManifest = (
    manifest: PortableAnimationManifest
): PortableAnimationManifest => {
    const clips = Array.isArray(manifest.clips)
        ? Object.freeze(
              manifest.clips
                  .map((clip: PortableAnimationClipManifestEntry) => cloneClipMetadata(clip))
                  .filter(
                      (clip: PortableAnimationClipManifestEntry | undefined): clip is PortableAnimationClipManifestEntry =>
                          Boolean(clip)
                  )
          )
        : undefined;
    const scenes = Array.isArray(manifest.scenes)
        ? Object.freeze(
              manifest.scenes
                  .map((scene) => {
                      const sceneClips = Array.isArray(scene.clips)
                          ? Object.freeze(
                                scene.clips
                                    .map((clip: PortableAnimationClipManifestEntry) => cloneClipMetadata(clip))
                                    .filter(
                                        (clip: PortableAnimationClipManifestEntry | undefined): clip is PortableAnimationClipManifestEntry =>
                                            Boolean(clip)
                                    )
                            )
                          : undefined;
                      const controller = cloneControllerMetadata(scene.controller);
                      const entry = {
                          ...(isFiniteNumber(scene.scene) ? { scene: Math.max(0, Math.trunc(scene.scene)) } : {}),
                          ...(typeof scene.sceneName === 'string' && scene.sceneName.length > 0
                              ? { sceneName: scene.sceneName }
                              : {}),
                          ...(controller ? { controller } : {}),
                          ...(sceneClips && sceneClips.length > 0 ? { clips: sceneClips } : {}),
                      } satisfies PortableAnimationManifestSceneEntry;
                      return Object.keys(entry).length > 0 ? Object.freeze(entry) : undefined;
                  })
                  .filter((scene): scene is PortableAnimationManifestSceneEntry => Boolean(scene))
          )
        : undefined;
    const controller = cloneControllerMetadata(manifest.controller);

    return Object.freeze({
        ...(controller ? { controller } : {}),
        ...(scenes && scenes.length > 0 ? { scenes } : {}),
        ...(clips && clips.length > 0 ? { clips } : {}),
    });
};

export const serializePortableAnimationManifest = (
    manifest: PortableAnimationManifest,
    indent: number = 2
): string => JSON.stringify(createPortableAnimationManifest(manifest), null, clampIndent(indent));

export const createPortableAnimationManifestResource = (
    uri: string,
    manifest: PortableAnimationManifest,
    indent: number = 2
): GltfPackageResourceInput =>
    Object.freeze({
        uri,
        data: serializePortableAnimationManifest(manifest, indent),
        mimeType: 'application/json',
    });

const clampIndent = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 2;
    }
    return Math.max(0, Math.min(8, Math.trunc(value)));
};