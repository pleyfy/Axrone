import {
    RENDER_2D_DEFAULT_SPRITE_SHADER_ID,
    RENDER_2D_SPRITE_ATTRIBUTE_NAMES,
    RENDER_2D_SPRITE_EFFECT,
} from '@axrone/render-2d';
import type { SceneShaderDefinition } from './types';
import { createSceneShaderDefinitionFromEffect } from './shader-effect';

export const DEFAULT_SCENE_2D_SPRITE_SHADER_ID = RENDER_2D_DEFAULT_SPRITE_SHADER_ID;

export const createSprite2DShaderDefinition = (
    id: string = DEFAULT_SCENE_2D_SPRITE_SHADER_ID
): SceneShaderDefinition =>
    createSceneShaderDefinitionFromEffect(
        {
            ...RENDER_2D_SPRITE_EFFECT,
            id,
        },
        {
            attributes: {
                position: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.position,
                uv0: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.uv0,
                color0: RENDER_2D_SPRITE_ATTRIBUTE_NAMES.color0,
            },
        }
    );