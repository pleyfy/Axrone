export interface Asset2DVec2Like {
    readonly x: number;
    readonly y: number;
}

export interface Asset2DSizeLike {
    readonly width: number;
    readonly height: number;
}

export interface Asset2DRectLike extends Asset2DVec2Like, Asset2DSizeLike {}

export interface Asset2DBorderLike {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
}

export interface SpriteAtlasFrameDefinition {
    readonly id: string;
    readonly region: Asset2DRectLike;
    readonly sourceSize?: Asset2DSizeLike;
    readonly pivot?: Asset2DVec2Like;
    readonly sliceBorder?: Asset2DBorderLike;
    readonly durationMs?: number;
}

export interface SpriteAnimationFrameDefinition {
    readonly frameId: string;
    readonly durationMs?: number;
}

export interface SpriteAnimationClipDefinition {
    readonly id: string;
    readonly frames: readonly (string | SpriteAnimationFrameDefinition)[];
    readonly fps?: number;
    readonly loop?: boolean;
}

export interface SpriteAtlasDefinition {
    readonly id: string;
    readonly textureId: string;
    readonly textureSize: Asset2DSizeLike;
    readonly frames: readonly SpriteAtlasFrameDefinition[];
    readonly animations?: readonly SpriteAnimationClipDefinition[];
}

export interface SpriteAtlasFrame {
    readonly id: string;
    readonly textureId: string;
    readonly region: Readonly<Asset2DRectLike>;
    readonly sourceSize: Readonly<Asset2DSizeLike>;
    readonly uvRect: Readonly<Asset2DRectLike>;
    readonly pivot: Readonly<Asset2DVec2Like>;
    readonly sliceBorder: Readonly<Asset2DBorderLike> | null;
    readonly durationMs: number | null;
}

export interface SpriteAnimationFrame {
    readonly frame: SpriteAtlasFrame;
    readonly durationMs: number;
}

export interface SpriteAnimationClip {
    readonly id: string;
    readonly frames: readonly SpriteAnimationFrame[];
    readonly durationMs: number;
    readonly loop: boolean;
}

export interface SpriteAtlas {
    readonly id: string;
    readonly textureId: string;
    readonly textureSize: Readonly<Asset2DSizeLike>;
    readonly frames: readonly SpriteAtlasFrame[];
    readonly animations: readonly SpriteAnimationClip[];
    getFrame(id: string): SpriteAtlasFrame | undefined;
    getAnimation(id: string): SpriteAnimationClip | undefined;
}

export class Asset2DError extends Error {
    constructor(message: string, readonly code: string, readonly cause?: unknown) {
        super(message);
        this.name = 'Asset2DError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export class Asset2DValidationError extends Asset2DError {
    constructor(message: string, cause?: unknown) {
        super(message, 'ASSET_2D_VALIDATION_ERROR', cause);
        this.name = 'Asset2DValidationError';
    }
}

const freezeVec2 = (value: Asset2DVec2Like): Readonly<Asset2DVec2Like> =>
    Object.freeze({ x: value.x, y: value.y });

const freezeSize = (value: Asset2DSizeLike): Readonly<Asset2DSizeLike> =>
    Object.freeze({ width: value.width, height: value.height });

const freezeRect = (value: Asset2DRectLike): Readonly<Asset2DRectLike> =>
    Object.freeze({ x: value.x, y: value.y, width: value.width, height: value.height });

const freezeBorder = (
    value: Asset2DBorderLike | undefined
): Readonly<Asset2DBorderLike> | null =>
    value
        ? Object.freeze({
              left: value.left,
              right: value.right,
              top: value.top,
              bottom: value.bottom,
          })
        : null;

const assertFinite = (label: string, value: number): void => {
    if (!Number.isFinite(value)) {
        throw new Asset2DValidationError(`${label} must be a finite number`);
    }
};

const assertPositive = (label: string, value: number): void => {
    assertFinite(label, value);
    if (value <= 0) {
        throw new Asset2DValidationError(`${label} must be greater than zero`);
    }
};

const assertNonNegative = (label: string, value: number): void => {
    assertFinite(label, value);
    if (value < 0) {
        throw new Asset2DValidationError(`${label} must be zero or greater`);
    }
};

const normalizeClipFrame = (
    entry: string | SpriteAnimationFrameDefinition
): SpriteAnimationFrameDefinition =>
    typeof entry === 'string'
        ? Object.freeze({ frameId: entry })
        : Object.freeze({ frameId: entry.frameId, durationMs: entry.durationMs });

const resolveFrameDuration = (
    frame: SpriteAtlasFrame,
    entry: SpriteAnimationFrameDefinition,
    fallbackDurationMs: number
): number => {
    const resolved = entry.durationMs ?? frame.durationMs ?? fallbackDurationMs;
    assertPositive(`Animation frame duration for '${frame.id}'`, resolved);
    return resolved;
};

export const createSpriteAtlas = (definition: SpriteAtlasDefinition): SpriteAtlas => {
    if (!definition.id) {
        throw new Asset2DValidationError('Sprite atlas id is required');
    }

    if (!definition.textureId) {
        throw new Asset2DValidationError('Sprite atlas textureId is required');
    }

    assertPositive('Sprite atlas texture width', definition.textureSize.width);
    assertPositive('Sprite atlas texture height', definition.textureSize.height);

    const textureSize = freezeSize(definition.textureSize);
    const frameMap = new Map<string, SpriteAtlasFrame>();
    const frames = definition.frames.map((frameDefinition) => {
        if (!frameDefinition.id) {
            throw new Asset2DValidationError('Sprite atlas frame id is required');
        }

        if (frameMap.has(frameDefinition.id)) {
            throw new Asset2DValidationError(
                `Duplicate sprite atlas frame id '${frameDefinition.id}'`
            );
        }

        assertNonNegative(`Frame '${frameDefinition.id}' region.x`, frameDefinition.region.x);
        assertNonNegative(`Frame '${frameDefinition.id}' region.y`, frameDefinition.region.y);
        assertPositive(`Frame '${frameDefinition.id}' region.width`, frameDefinition.region.width);
        assertPositive(
            `Frame '${frameDefinition.id}' region.height`,
            frameDefinition.region.height
        );

        if (
            frameDefinition.region.x + frameDefinition.region.width > textureSize.width ||
            frameDefinition.region.y + frameDefinition.region.height > textureSize.height
        ) {
            throw new Asset2DValidationError(
                `Frame '${frameDefinition.id}' exceeds the atlas texture bounds`
            );
        }

        const sourceSize = freezeSize(
            frameDefinition.sourceSize ?? {
                width: frameDefinition.region.width,
                height: frameDefinition.region.height,
            }
        );
        assertPositive(`Frame '${frameDefinition.id}' source width`, sourceSize.width);
        assertPositive(`Frame '${frameDefinition.id}' source height`, sourceSize.height);

        const pivot = freezeVec2(frameDefinition.pivot ?? { x: 0.5, y: 0.5 });
        assertFinite(`Frame '${frameDefinition.id}' pivot.x`, pivot.x);
        assertFinite(`Frame '${frameDefinition.id}' pivot.y`, pivot.y);

        const sliceBorder = freezeBorder(frameDefinition.sliceBorder);
        if (sliceBorder) {
            assertNonNegative(`Frame '${frameDefinition.id}' sliceBorder.left`, sliceBorder.left);
            assertNonNegative(`Frame '${frameDefinition.id}' sliceBorder.right`, sliceBorder.right);
            assertNonNegative(`Frame '${frameDefinition.id}' sliceBorder.top`, sliceBorder.top);
            assertNonNegative(
                `Frame '${frameDefinition.id}' sliceBorder.bottom`,
                sliceBorder.bottom
            );
        }

        if (frameDefinition.durationMs !== undefined) {
            assertPositive(
                `Frame '${frameDefinition.id}' durationMs`,
                frameDefinition.durationMs
            );
        }

        const frame = Object.freeze({
            id: frameDefinition.id,
            textureId: definition.textureId,
            region: freezeRect(frameDefinition.region),
            sourceSize,
            uvRect: freezeRect({
                x: frameDefinition.region.x / textureSize.width,
                y: frameDefinition.region.y / textureSize.height,
                width: frameDefinition.region.width / textureSize.width,
                height: frameDefinition.region.height / textureSize.height,
            }),
            pivot,
            sliceBorder,
            durationMs: frameDefinition.durationMs ?? null,
        } satisfies SpriteAtlasFrame);

        frameMap.set(frame.id, frame);
        return frame;
    });

    const animationMap = new Map<string, SpriteAnimationClip>();
    const animations = (definition.animations ?? []).map((clipDefinition) => {
        if (!clipDefinition.id) {
            throw new Asset2DValidationError('Sprite animation clip id is required');
        }

        if (animationMap.has(clipDefinition.id)) {
            throw new Asset2DValidationError(
                `Duplicate sprite animation clip id '${clipDefinition.id}'`
            );
        }

        if (clipDefinition.frames.length === 0) {
            throw new Asset2DValidationError(
                `Sprite animation clip '${clipDefinition.id}' must include at least one frame`
            );
        }

        const fallbackDurationMs = 1000 / Math.max(1, clipDefinition.fps ?? 12);
        const clipFrames = clipDefinition.frames.map((entry) => {
            const normalizedEntry = normalizeClipFrame(entry);
            const frame = frameMap.get(normalizedEntry.frameId);

            if (!frame) {
                throw new Asset2DValidationError(
                    `Sprite animation clip '${clipDefinition.id}' references missing frame '${normalizedEntry.frameId}'`
                );
            }

            return Object.freeze({
                frame,
                durationMs: resolveFrameDuration(frame, normalizedEntry, fallbackDurationMs),
            } satisfies SpriteAnimationFrame);
        });

        const durationMs = clipFrames.reduce((total, frame) => total + frame.durationMs, 0);
        const clip = Object.freeze({
            id: clipDefinition.id,
            frames: Object.freeze(clipFrames),
            durationMs,
            loop: clipDefinition.loop ?? true,
        } satisfies SpriteAnimationClip);

        animationMap.set(clip.id, clip);
        return clip;
    });

    return Object.freeze({
        id: definition.id,
        textureId: definition.textureId,
        textureSize,
        frames: Object.freeze(frames),
        animations: Object.freeze(animations),
        getFrame: (id: string) => frameMap.get(id),
        getAnimation: (id: string) => animationMap.get(id),
    } satisfies SpriteAtlas);
};

export const getSpriteAtlasFrame = (
    atlas: SpriteAtlas,
    frameId: string
): SpriteAtlasFrame | undefined => atlas.getFrame(frameId);

export const getSpriteAnimationClip = (
    atlas: SpriteAtlas,
    clipId: string
): SpriteAnimationClip | undefined => atlas.getAnimation(clipId);

export const serializeSpriteAtlasDefinition = (
    atlas: SpriteAtlas
): SpriteAtlasDefinition => ({
    id: atlas.id,
    textureId: atlas.textureId,
    textureSize: {
        width: atlas.textureSize.width,
        height: atlas.textureSize.height,
    },
    frames: atlas.frames.map((frame) => ({
        id: frame.id,
        region: {
            x: frame.region.x,
            y: frame.region.y,
            width: frame.region.width,
            height: frame.region.height,
        },
        sourceSize: {
            width: frame.sourceSize.width,
            height: frame.sourceSize.height,
        },
        pivot: {
            x: frame.pivot.x,
            y: frame.pivot.y,
        },
        sliceBorder: frame.sliceBorder
            ? {
                  left: frame.sliceBorder.left,
                  right: frame.sliceBorder.right,
                  top: frame.sliceBorder.top,
                  bottom: frame.sliceBorder.bottom,
              }
            : undefined,
        durationMs: frame.durationMs ?? undefined,
    })),
    animations: atlas.animations.map((clip) => ({
        id: clip.id,
        loop: clip.loop,
        frames: clip.frames.map((frame) => ({
            frameId: frame.frame.id,
            durationMs: frame.durationMs,
        })),
    })),
});