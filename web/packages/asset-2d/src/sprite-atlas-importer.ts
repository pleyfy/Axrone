import { AssetImportPipeline, type AssetImportPipelineOptions, type AssetImportSource, type AssetImporter, type AssetImportResult } from '@axrone/asset-core';
import {
    createSpriteAtlas,
    serializeSpriteAtlasDefinition,
    type SpriteAnimationClipDefinition,
    type SpriteAtlasDefinition,
    type SpriteAtlasFrameDefinition,
} from './sprite-atlas';

export type Asset2DImportKind = 'spriteAtlas';

export type Asset2DImportSchema = {
    readonly [key: string]: unknown;
    readonly spriteAtlas: SpriteAtlasDefinition;
};

export type Asset2DImportResult = AssetImportResult<Asset2DImportSchema, Asset2DImportKind>;

export interface Asset2DImportPipelineOptions
    extends Omit<AssetImportPipelineOptions<Asset2DImportSchema>, 'importers'> {
    readonly importers?: readonly AssetImporter<Asset2DImportSchema>[];
}

interface TexturePackerAtlasFrameSourceSize {
    readonly w: number;
    readonly h: number;
}

interface TexturePackerAtlasFramePivot {
    readonly x: number;
    readonly y: number;
}

interface TexturePackerAtlasFrameRect {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
}

interface TexturePackerAtlasFrameEntry {
    readonly frame: TexturePackerAtlasFrameRect;
    readonly rotated?: boolean;
    readonly trimmed?: boolean;
    readonly sourceSize?: TexturePackerAtlasFrameSourceSize;
    readonly spriteSourceSize?: TexturePackerAtlasFrameRect;
    readonly pivot?: TexturePackerAtlasFramePivot;
    readonly duration?: number;
}

interface TexturePackerAtlasMeta {
    readonly image?: string;
    readonly size?: TexturePackerAtlasFrameSourceSize;
    readonly scale?: string;
    readonly frameTags?: readonly {
        readonly name: string;
        readonly from: number;
        readonly to: number;
        readonly direction?: 'forward' | 'reverse' | 'pingpong';
    }[];
}

interface TexturePackerAtlasPayload {
    readonly frames: Readonly<Record<string, TexturePackerAtlasFrameEntry>>;
    readonly meta?: TexturePackerAtlasMeta;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && Array.isArray(value) === false;

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const isTexturePackerAtlasPayload = (value: unknown): value is TexturePackerAtlasPayload =>
    isPlainObject(value) && isPlainObject(value.frames);

const isCanonicalSpriteAtlasPayload = (value: unknown): value is SpriteAtlasDefinition =>
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    typeof value.textureId === 'string' &&
    isPlainObject(value.textureSize) &&
    isFiniteNumber(value.textureSize.width) &&
    isFiniteNumber(value.textureSize.height) &&
    Array.isArray(value.frames);

const readJsonLikeSource = (source: AssetImportSource): unknown => {
    if (source.kind === 'json') {
        return source.data;
    }

    if (source.kind === 'text') {
        return JSON.parse(source.data) as unknown;
    }

    throw new Error(`Unsupported sprite atlas import source kind: ${source.kind}`);
};

const deriveAtlasIdFromSource = (source: AssetImportSource, fallback: string): string => {
    const uri = source.uri?.trim();
    if (!uri) {
        return fallback;
    }

    const leaf = uri.split(/[\\/]/).pop() ?? fallback;
    return leaf
        .replace(/\.spriteatlas\.json$/i, '')
        .replace(/\.atlas\.json$/i, '')
        .replace(/\.json$/i, '')
        .replace(/\.[^.]+$/i, '') || fallback;
};

const normalizeCanonicalFrames = (
    frames: readonly SpriteAtlasFrameDefinition[]
): readonly SpriteAtlasFrameDefinition[] =>
    frames.map((frame) => ({
        id: frame.id,
        region: {
            x: frame.region.x,
            y: frame.region.y,
            width: frame.region.width,
            height: frame.region.height,
        },
        sourceSize: frame.sourceSize
            ? {
                  width: frame.sourceSize.width,
                  height: frame.sourceSize.height,
              }
            : undefined,
        pivot: frame.pivot
            ? {
                  x: frame.pivot.x,
                  y: frame.pivot.y,
              }
            : undefined,
        sliceBorder: frame.sliceBorder
            ? {
                  left: frame.sliceBorder.left,
                  right: frame.sliceBorder.right,
                  top: frame.sliceBorder.top,
                  bottom: frame.sliceBorder.bottom,
              }
            : undefined,
        durationMs: frame.durationMs,
    }));

const normalizeCanonicalAnimations = (
    animations: readonly SpriteAnimationClipDefinition[] | undefined
): readonly SpriteAnimationClipDefinition[] | undefined =>
    animations?.map((clip) => ({
        id: clip.id,
        fps: clip.fps,
        loop: clip.loop,
        frames: clip.frames.map((entry) =>
            typeof entry === 'string'
                ? entry
                : {
                      frameId: entry.frameId,
                      durationMs: entry.durationMs,
                  }
        ),
    }));

const normalizeCanonicalSpriteAtlasDefinition = (
    source: AssetImportSource,
    payload: SpriteAtlasDefinition
): SpriteAtlasDefinition => {
    const atlas = createSpriteAtlas({
        id: payload.id || deriveAtlasIdFromSource(source, 'sprite-atlas'),
        textureId: payload.textureId,
        textureSize: {
            width: payload.textureSize.width,
            height: payload.textureSize.height,
        },
        frames: normalizeCanonicalFrames(payload.frames),
        animations: normalizeCanonicalAnimations(payload.animations),
    });

    return serializeSpriteAtlasDefinition(atlas);
};

const normalizeTexturePackerFrame = (
    id: string,
    entry: TexturePackerAtlasFrameEntry
): SpriteAtlasFrameDefinition => ({
    id,
    region: {
        x: entry.frame.x,
        y: entry.frame.y,
        width: entry.frame.w,
        height: entry.frame.h,
    },
    sourceSize: entry.sourceSize
        ? {
              width: entry.sourceSize.w,
              height: entry.sourceSize.h,
          }
        : undefined,
    pivot: entry.pivot
        ? {
              x: entry.pivot.x,
              y: entry.pivot.y,
          }
        : undefined,
    durationMs: isFiniteNumber(entry.duration) ? entry.duration : undefined,
});

const normalizeTexturePackerAtlasDefinition = (
    source: AssetImportSource,
    payload: TexturePackerAtlasPayload
): SpriteAtlasDefinition => {
    const meta = payload.meta ?? {};
    const textureSize = meta.size;
    if (!textureSize) {
        throw new Error('TexturePacker atlas metadata is missing the source texture size');
    }

    const textureId = meta.image?.trim() || deriveAtlasIdFromSource(source, 'sprite-atlas');
    const frames = Object.entries(payload.frames).map(([id, entry]) =>
        normalizeTexturePackerFrame(id, entry)
    );

    const animations = meta.frameTags?.length
        ? meta.frameTags.map((tag) => ({
              id: tag.name,
              loop: tag.direction !== 'reverse',
              frames: Array.from(
                  { length: Math.max(0, tag.to - tag.from + 1) },
                  (_, index) => {
                      const frameIndex = tag.direction === 'reverse' ? tag.to - index : tag.from + index;
                      const frame = frames[frameIndex];
                      if (!frame) {
                          throw new Error(
                              `TexturePacker frame tag '${tag.name}' references missing frame index ${frameIndex}`
                          );
                      }

                      return {
                          frameId: frame.id,
                          durationMs: frame.durationMs ?? 1000 / 12,
                      };
                  }
              ),
          }))
        : undefined;

    const atlas = createSpriteAtlas({
        id: deriveAtlasIdFromSource(source, textureId),
        textureId,
        textureSize: {
            width: textureSize.w,
            height: textureSize.h,
        },
        frames,
        animations,
    });

    return serializeSpriteAtlasDefinition(atlas);
};

export const createSpriteAtlasJsonImporter = (): AssetImporter<Asset2DImportSchema> => ({
    id: 'asset-2d.sprite-atlas.json',
    priority: 20,
    sourceKinds: ['json', 'text'],
    extensions: ['spriteatlas.json', 'atlas.json', 'json'],
    mimeTypes: ['application/json', 'text/json', 'text/plain'],
    canImport: ({ source }) => {
        try {
            return isCanonicalSpriteAtlasPayload(readJsonLikeSource(source));
        } catch {
            return false;
        }
    },
    import: ({ source }) => {
        const payload = readJsonLikeSource(source);
        if (!isCanonicalSpriteAtlasPayload(payload)) {
            throw new Error('Source does not contain a canonical sprite atlas definition');
        }

        const definition = normalizeCanonicalSpriteAtlasDefinition(source, payload);
        return {
            primary: {
                kind: 'spriteAtlas',
                data: definition,
                name: definition.id,
                metadata: source.uri
                    ? {
                          uri: source.uri,
                          mimeType: source.mimeType,
                      }
                    : undefined,
            },
        };
    },
});

export const createTexturePackerSpriteAtlasImporter = (): AssetImporter<Asset2DImportSchema> => ({
    id: 'asset-2d.sprite-atlas.texturepacker',
    priority: 10,
    sourceKinds: ['json', 'text'],
    extensions: ['json'],
    mimeTypes: ['application/json', 'text/json', 'text/plain'],
    canImport: ({ source }) => {
        try {
            const payload = readJsonLikeSource(source);
            return isTexturePackerAtlasPayload(payload);
        } catch {
            return false;
        }
    },
    import: ({ source }) => {
        const payload = readJsonLikeSource(source);
        if (!isTexturePackerAtlasPayload(payload)) {
            throw new Error('Source does not contain a TexturePacker atlas payload');
        }

        const definition = normalizeTexturePackerAtlasDefinition(source, payload);
        return {
            primary: {
                kind: 'spriteAtlas',
                data: definition,
                name: definition.id,
                metadata: source.uri
                    ? {
                          uri: source.uri,
                          mimeType: source.mimeType,
                      }
                    : undefined,
            },
        };
    },
});

export const createAsset2DImportPipeline = (
    options: Asset2DImportPipelineOptions = {}
): AssetImportPipeline<Asset2DImportSchema> =>
    new AssetImportPipeline<Asset2DImportSchema>({
        ...options,
        importers: [
            createSpriteAtlasJsonImporter(),
            createTexturePackerSpriteAtlasImporter(),
            ...(options.importers ?? []),
        ],
    });
