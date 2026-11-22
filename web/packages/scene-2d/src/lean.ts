/**
 * Lean `@axrone/scene-2d` entry point.
 *
 * Exposes only the 2D scene facade surface a render-only consumer needs:
 * `Scene2D`, the sprite-actor runtime, the camera and sprite renderer
 * components, and the accompanying config and resource types.
 *
 * The root entry (`@axrone/scene-2d`) keeps every existing export. This
 * subpath is additive and safe to adopt incrementally; it never changes the
 * behavior of the root entry.
 *
 * @module lean
 */

export { Scene2D } from './scene-2d-lean';
export type { Scene2DBulkSpriteConfig } from './scene-2d-actor-runtime';
export { Camera, type CameraConfig } from '@axrone/scene-runtime/scene-camera';
export {
    SpriteRenderer,
    type SpriteRendererConfig,
} from '@axrone/scene-runtime/scene-sprite-renderer';
export { Color } from '@axrone/numeric';

export type {
    SceneMaterialAlphaMode,
    SceneMaterialDefinition,
    SceneMaterialHandle,
    SceneMaterialSurfaceDefinition,
    SceneMeshDefinition,
    SceneMeshHandle,
    SceneOptions,
    SceneRegistry,
    SceneRenderPlanningStats,
    SceneRenderStats,
    SceneShaderDefinition,
    SceneShaderHandle,
    SceneTextureBindingDefinition,
    SceneTextureDefinition,
    SceneTextureHandle,
    SceneUniformValue,
} from '@axrone/scene-runtime/types';
