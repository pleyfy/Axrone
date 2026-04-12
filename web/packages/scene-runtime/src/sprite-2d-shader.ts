import {
    RENDER_2D_DEFAULT_SPRITE_SHADER_ID,
    RENDER_2D_SPRITE_ATTRIBUTE_NAMES,
    RENDER_2D_SPRITE_FRAGMENT_SOURCE,
    RENDER_2D_SPRITE_UNIFORM_NAMES,
    RENDER_2D_SPRITE_VERTEX_SOURCE,
} from '@axrone/render-2d';
import type { SceneShaderDefinition } from './types';

export const DEFAULT_SCENE_2D_SPRITE_SHADER_ID = RENDER_2D_DEFAULT_SPRITE_SHADER_ID;

export const createSprite2DShaderDefinition = (
    id: string = DEFAULT_SCENE_2D_SPRITE_SHADER_ID
): SceneShaderDefinition => ({
    id,
    vertexSource: RENDER_2D_SPRITE_VERTEX_SOURCE,
    fragmentSource: RENDER_2D_SPRITE_FRAGMENT_SOURCE,
    attributes: {
        position: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.position,
        uv0: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.uv0,
        color0: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.color0,
    },
    uniforms: [...RENDER_2D_SPRITE_UNIFORM_NAMES],
    depthTest: false,
    cull: false,
    blend: true,
});