export type {
    Asset2DBorderLike,
    SpriteAnimationClip,
    SpriteAnimationClipDefinition,
    SpriteAnimationFrame,
    SpriteAnimationFrameDefinition,
    SpriteAtlas,
    SpriteAtlasDefinition,
    SpriteAtlasFrame,
    SpriteAtlasFrameDefinition,
} from '@axrone/asset-2d';
export {
    createSpriteAtlas,
    getSpriteAnimationClip,
    getSpriteAtlasFrame,
    serializeSpriteAtlasDefinition,
} from '@axrone/asset-2d';
export type {
    SpriteAnimatorConfig,
} from './components/sprite-animator';
export { SpriteAnimator } from './components/sprite-animator';
export type {
    SpriteMaskConfig,
    SpriteMaskSizeInput,
    SpriteMaskVec2Input,
} from './components/sprite-mask';
export { SpriteMask } from './components/sprite-mask';
export type {
    SpriteRendererBorderInput,
    SpriteRendererBorderState,
    SpriteRendererColorInput,
    SpriteRendererConfig,
    SpriteRendererFrameApplyOptions,
    SpriteRendererRectInput,
    SpriteRendererRectState,
    SpriteRendererSizeInput,
    SpriteRendererVec2Input,
} from './components/sprite-renderer';
export { SpriteRenderer } from './components/sprite-renderer';
export { Color } from '@axrone/numeric';
export {
    DEFAULT_SCENE_2D_SPRITE_SHADER_ID,
    createSprite2DShaderDefinition,
} from './sprite-2d-shader';