import { describe, expect, it } from 'vitest';
import { createSceneShaderDefinitionFromEffect } from '../shader-effect';
import type { RenderShaderEffectDefinition } from '@axrone/render-core';

const createEffect = (): RenderShaderEffectDefinition => ({
    format: 'axrone.shader/effect',
    version: 1,
    id: 'scene/effect-test',
    attributes: [{ name: 'a_Position', type: 'vec3', location: 0 }],
    properties: [
        {
            name: 'u_Model',
            type: 'mat4',
            stages: ['vertex'],
            scope: 'object',
        },
        {
            name: 'u_Color',
            type: 'vec4',
            stages: ['fragment'],
            scope: 'material',
            inspector: { control: 'color' },
        },
    ],
    vertex: {
        main: ['gl_Position = u_Model * vec4(a_Position, 1.0);'],
    },
    fragment: {
        precision: 'highp',
        outputs: [{ name: 'o_Color', type: 'vec4' }],
        main: ['o_Color = u_Color;'],
    },
    renderState: {
        depthTest: false,
        cull: false,
        blend: true,
    },
});

describe('scene shader effect helper', () => {
    it('creates scene shader definitions from structured effect data', () => {
        const definition = createSceneShaderDefinitionFromEffect(createEffect(), {
            id: 'scene/effect-runtime',
            attributes: {
                position: 'a_Position',
            },
        });

        expect(definition.id).toBe('scene/effect-runtime');
        expect(definition.effect?.id).toBe('scene/effect-runtime');
        expect(definition.uniforms).toEqual(['u_Model', 'u_Color']);
        expect(definition.vertexSource).toContain('uniform mat4 u_Model;');
        expect(definition.fragmentSource).toContain('uniform vec4 u_Color;');
        expect(definition.attributes?.position).toBe('a_Position');
        expect(definition.depthTest).toBe(false);
        expect(definition.cull).toBe(false);
        expect(definition.blend).toBe(true);
    });
});