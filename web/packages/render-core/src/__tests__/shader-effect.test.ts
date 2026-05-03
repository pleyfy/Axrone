import { describe, expect, it } from 'vitest';
import {
    cloneRenderShaderEffectDefinition,
    compileRenderShaderEffect,
    type RenderShaderEffectDefinition,
} from '@axrone/render-core';

const createEffect = (): RenderShaderEffectDefinition => ({
    format: 'axrone.shader/effect',
    version: 1,
    id: 'effect/test',
    attributes: [
        { name: 'a_Position', type: 'vec3', location: 0 },
        { name: 'a_UV0', type: 'vec2', location: 2 },
    ],
    varyings: [{ name: 'v_UV0', type: 'vec2' }],
    properties: [
        {
            name: 'u_ViewProjection',
            type: 'mat4',
            stages: ['vertex'],
            scope: 'camera',
        },
        {
            name: 'u_LightColors',
            type: 'vec3',
            arrayLength: 4,
            stages: ['fragment'],
            scope: 'frame',
        },
        {
            name: 'u_MainTex',
            type: 'sampler2D',
            stages: ['fragment'],
            scope: 'material',
            inspector: {
                control: 'texture',
                options: [{ label: 'Main Texture', value: 'u_MainTex' }],
            },
        },
    ],
    libraries: [
        {
            id: 'sample',
            code: [
                'vec4 sampleMainTex(vec2 uv) {',
                '    return texture(u_MainTex, uv);',
                '}',
            ],
        },
    ],
    vertex: {
        outputs: [{ name: 'v_Position', type: 'vec3' }],
        main: [
            'v_UV0 = a_UV0;',
            'v_Position = a_Position;',
            'gl_Position = u_ViewProjection * vec4(a_Position, 1.0);',
        ],
    },
    fragment: {
        precision: 'highp',
        inputs: [{ name: 'v_Position', type: 'vec3' }],
        outputs: [{ name: 'o_Color', type: 'vec4' }],
        includes: ['sample'],
        main: ['o_Color = sampleMainTex(v_UV0) + vec4(v_Position, 0.0);'],
    },
    renderState: {
        depthTest: false,
        cull: false,
        blend: true,
    },
});

describe('render shader effect compiler', () => {
    it('builds vertex and fragment sources from a structured effect definition', () => {
        const compiled = compileRenderShaderEffect(createEffect());

        expect(compiled.uniformNames).toEqual([
            'u_ViewProjection',
            'u_LightColors',
            'u_MainTex',
        ]);
        expect(compiled.vertexSource).toContain('layout(location = 0) in vec3 a_Position;');
        expect(compiled.vertexSource).toContain('out vec2 v_UV0;');
        expect(compiled.vertexSource).toContain('out vec3 v_Position;');
        expect(compiled.fragmentSource).toContain('precision highp float;');
        expect(compiled.fragmentSource).toContain('uniform vec3 u_LightColors[4];');
        expect(compiled.fragmentSource).toContain('uniform sampler2D u_MainTex;');
        expect(compiled.fragmentSource).toContain('vec4 sampleMainTex(vec2 uv) {');
        expect(compiled.fragmentSource).toContain('out vec4 o_Color;');
    });

    it('clones effect definitions without leaking nested mutations', () => {
        const effect = createEffect();
        const cloned = cloneRenderShaderEffectDefinition(effect);
        const mutableEffect = effect as any;

        mutableEffect.attributes?.push({ name: 'a_Color0', type: 'vec4', location: 3 });
        mutableEffect.properties?.[0]?.stages?.push('fragment');
        if (Array.isArray(mutableEffect.libraries?.[0]?.code)) {
            mutableEffect.libraries[0].code.push('vec4 broken() { return vec4(0.0); }');
        }
        mutableEffect.vertex.main.push('gl_Position = vec4(0.0);');

        expect(cloned.attributes).toHaveLength(2);
        expect(cloned.properties?.[0]?.stages).toEqual(['vertex']);
        expect(cloned.properties?.[2]?.inspector?.options).toEqual([
            { label: 'Main Texture', value: 'u_MainTex' },
        ]);
        expect(cloned.vertex.main).toHaveLength(3);
        expect(Array.isArray(cloned.libraries?.[0]?.code) ? cloned.libraries[0].code : []).toHaveLength(3);
    });
});