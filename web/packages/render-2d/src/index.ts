export const RENDER_2D_CAPABILITY_ID = 'render/2d';
export const RENDER_2D_CAPABILITY_PACKAGE = '@axrone/render-2d';
export const RENDER_2D_OWNER_PACKAGE = '@axrone/render-core';

const RENDER_2D_CAPABILITY = Object.freeze({
    id: RENDER_2D_CAPABILITY_ID,
    packageName: RENDER_2D_CAPABILITY_PACKAGE,
    ownerPackage: RENDER_2D_OWNER_PACKAGE,
});

export type Render2DCapability = typeof RENDER_2D_CAPABILITY;

export const getRender2DCapability = (): Render2DCapability => RENDER_2D_CAPABILITY;

export type {
    ReadonlyRenderResourceRegistry,
    RenderClearState,
    RenderPassName,
    RenderPassSummary,
    RenderResourceLifetime,
    RenderResourceName,
    RenderResourceUsage,
    RenderTextureDescriptor,
    RenderTextureFormat,
    RenderViewport,
} from '@axrone/render-core';
export {
    RenderExecutionError,
    RenderPipelineError,
    RenderValidationError,
    createRenderPassGraph,
} from '@axrone/render-core';