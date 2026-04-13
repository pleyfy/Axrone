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
    PackedRender2DColor,
    Render2DBorderLike,
    Render2DColorLike,
    Render2DMaterialReference,
    Render2DReadonlyMat4Like,
    Render2DRectLike,
    Render2DSizeLike,
    Render2DSpriteMask,
    Render2DSpriteMaskShape,
    Render2DSpriteBatchBuildResult,
    Render2DSpriteBatchBuilderOptions,
    Render2DSpriteBatchKey,
    Render2DSpriteBatchRange,
    Render2DSpriteMaterialSource,
    Render2DSpriteSlice,
    Render2DSpriteSource,
    Render2DSpriteSourceKey,
    Render2DSpriteSubmission,
    Render2DSpriteTextureSource,
    Render2DTextureReference,
    Render2DVec2Like,
} from './types';
export {
    asRender2DMaterialReference,
    asRender2DTextureReference,
    getRender2DSpriteSourceKey,
    isRender2DSpriteMaterialSource,
    isRender2DSpriteTextureSource,
} from './types';
export {
    RENDER_2D_DEFAULT_SPRITE_SHADER_ID,
    RENDER_2D_SPRITE_ATTRIBUTE_NAMES,
    RENDER_2D_SPRITE_FLOAT_STRIDE,
    RENDER_2D_SPRITE_FRAGMENT_SOURCE,
    RENDER_2D_SPRITE_INDICES_PER_QUAD,
    RENDER_2D_SPRITE_UNIFORM_NAMES,
    RENDER_2D_SPRITE_VERTEX_SOURCE,
    RENDER_2D_SPRITE_VERTEX_STRIDE,
    RENDER_2D_SPRITE_VERTICES_PER_QUAD,
} from './sprite-shader';
export {
    Render2DCapacityError,
    Render2DError,
    Render2DValidationError,
} from './errors';
export { Render2DSpriteBatchBuilder } from './sprite-batch-builder';

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