/**
 * Rendering sub-module barrel.
 *
 * Re-exports the scene rendering pipeline, draw execution, batch runtimes,
 * render-pass management, and state application.
 *
 * Consumers can import via `@axrone/scene-runtime/rendering` or from
 * `@axrone/scene-runtime/scene-3d-support` (which re-exports the same symbols).
 */

export { SceneDrawExecutionContextCache } from './draw-execution-context';
export type { SceneDrawExecutorContext } from './draw-executor';
export { SceneDrawExecutor } from './draw-executor';
export { createRenderCacheCameraKey } from './render-cache-key';
export type { RenderCacheViewport } from './render-cache-key';
export { SceneRenderFrameState } from './render-frame-state';
export { SceneRenderPassPreparer } from './render-pass-preparer';
export type { SceneRenderItem } from './render-item-collector';
export { SceneRenderItemCollector } from './render-item-collector';
export { SceneRenderStateApplier } from './render-state-applier';
export type {
    SceneRenderPassResource,
    SceneRenderPassRegistryOptions,
} from './render-pass-registry';
export { cloneSceneRenderPassDefinition, SceneRenderPassRegistry } from './render-pass-registry';
export type { SceneRenderRuntimeOptions, SceneRenderRuntimeParams } from './scene-render-runtime';
export { SceneRenderRuntime } from './scene-render-runtime';
export { SceneRenderPipeline } from './scene-render-pipeline';
export type {
    SceneFramebufferPassDefinition,
    SceneFramebufferPassId,
} from './scene-framebuffer-passes';
export {
    getSceneFramebufferPassDefinition,
    isSceneFramebufferPassId,
    planSceneFramebufferPasses,
    REFRACTION_COPY_PASS_ID,
    SCENE_COLOR_COPY_TEXTURE_ID,
    SCENE_COLOR_COPY_UNIFORM_NAME,
    SCENE_FRAMEBUFFER_PASS_DEFINITIONS,
    SCENE_FRAMEBUFFER_RENDERER_PASS_ID,
    SSS_BLUR_PASS_ID,
    SSS_BLUR_TEXTURE_ID,
    SSS_BLUR_UNIFORM_NAME,
    toSceneRenderPassDefinitions,
} from './scene-framebuffer-passes';
export type {
    SceneFramebufferPassStats,
    SceneFramebufferTextureBindings,
} from './scene-offscreen-framebuffer-passes';
export { SceneFramebufferPassRuntime } from './scene-offscreen-framebuffer-passes';
export type {
    SceneParticleBatchRuntimeOptions,
    SceneParticleBatchRuntimeRenderParams,
    SceneParticleBatchRuntimeRenderStats,
} from './particle-batch-runtime';
export { SceneParticleBatchRuntime } from './particle-batch-runtime';
export type {
    SceneSpriteBatchRuntimeOptions,
    SceneSpriteBatchRuntimeRenderStats,
} from './sprite-batch-runtime';
export { SceneSpriteBatchRuntime } from './sprite-batch-runtime';
export { SceneSpriteRenderItemCollector } from './sprite-render-item-collector';
export { SceneDirectGlPassGuard } from './internal/render-state-guard';
export type { SceneLodEvaluateParams, SceneLodEvaluateStats } from './lod-evaluator';
export { SceneLodEvaluator } from './lod-evaluator';
