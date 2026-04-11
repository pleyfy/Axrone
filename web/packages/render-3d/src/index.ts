export const RENDER_3D_CAPABILITY_ID = 'render/3d';
export const RENDER_3D_CAPABILITY_PACKAGE = '@axrone/render-3d';
export const RENDER_3D_OWNER_PACKAGE = '@axrone/render-core';

const RENDER_3D_CAPABILITY = Object.freeze({
    id: RENDER_3D_CAPABILITY_ID,
    packageName: RENDER_3D_CAPABILITY_PACKAGE,
    ownerPackage: RENDER_3D_OWNER_PACKAGE,
});

export type Render3DCapability = typeof RENDER_3D_CAPABILITY;

export const getRender3DCapability = (): Render3DCapability => RENDER_3D_CAPABILITY;

export * from '@axrone/render-core';