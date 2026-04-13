export const ASSET_2D_CAPABILITY_ID = 'asset/2d';
export const ASSET_2D_CAPABILITY_PACKAGE = '@axrone/asset-2d';
export const ASSET_2D_OWNER_PACKAGE = '@axrone/asset-core';

const ASSET_2D_CAPABILITY = Object.freeze({
    id: ASSET_2D_CAPABILITY_ID,
    packageName: ASSET_2D_CAPABILITY_PACKAGE,
    ownerPackage: ASSET_2D_OWNER_PACKAGE,
});

export type Asset2DCapability = typeof ASSET_2D_CAPABILITY;

export const getAsset2DCapability = (): Asset2DCapability => ASSET_2D_CAPABILITY;

export type {
    Asset2DBorderLike,
    Asset2DRectLike,
    Asset2DSizeLike,
    Asset2DVec2Like,
    SpriteAnimationClip,
    SpriteAnimationClipDefinition,
    SpriteAnimationFrame,
    SpriteAnimationFrameDefinition,
    SpriteAtlas,
    SpriteAtlasDefinition,
    SpriteAtlasFrame,
    SpriteAtlasFrameDefinition,
} from './sprite-atlas';
export {
    Asset2DError,
    Asset2DValidationError,
    createSpriteAtlas,
    getSpriteAnimationClip,
    getSpriteAtlasFrame,
    serializeSpriteAtlasDefinition,
} from './sprite-atlas';

export * from '@axrone/asset-core';