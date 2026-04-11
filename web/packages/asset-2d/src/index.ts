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

export * from '@axrone/asset-core';