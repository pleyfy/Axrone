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

    it('clones schema v2 keyword, binding, and technique metadata', () => {
        const effect: RenderShaderEffectDefinition = {
            format: 'axrone.shader/effect',
            version: 2,
            id: 'effect/advanced',
            properties: [
                {
                    name: 'u_Tint',
                    type: 'vec4',
                    stages: ['fragment'],
                    scope: 'material',
                    binding: {
                        target: 'u_SurfaceParams',
                        channels: ['r', 'g', 'b', 'a'],
                    },
                },
            ],
            keywords: [
                { name: 'USE_FOG', stages: ['fragment'], defaultValue: false },
                { name: 'SURFACE_MODE', options: ['OPAQUE', 'BLEND'], defaultValue: 'OPAQUE' },
            ],
            defaultTechnique: 'forward',
            techniques: [
                {
                    id: 'forward',
                    label: 'Forward',
                    passes: [
                        {
                            id: 'lit',
                            keywords: ['USE_FOG', 'SURFACE_MODE'],
                            renderState: { blend: true },
                        },
                    ],
                },
            ],
            vertex: {
                main: ['gl_Position = vec4(0.0);'],
            },
            fragment: {
                precision: 'highp',
                outputs: [{ name: 'o_Color', type: 'vec4' }],
                main: ['o_Color = u_Tint;'],
            },
        };

        const cloned = cloneRenderShaderEffectDefinition(effect);
        const mutableEffect = effect as any;
        mutableEffect.properties[0].binding.channels.push('x');
        mutableEffect.keywords[1].options.push('MASK');
        mutableEffect.techniques[0].passes[0].keywords.push('EXTRA_KEYWORD');

        expect(cloned.properties?.[0]?.binding).toEqual({
            target: 'u_SurfaceParams',
            channels: ['r', 'g', 'b', 'a'],
        });
        expect(cloned.keywords?.[1]?.options).toEqual(['OPAQUE', 'BLEND']);
        expect(cloned.defaultTechnique).toBe('forward');
        expect(cloned.techniques?.[0]?.passes[0]?.keywords).toEqual([
            'USE_FOG',
            'SURFACE_MODE',
        ]);
    });

    it('round-trips cullMode and depthWrite at effect level', () => {
        const effect: RenderShaderEffectDefinition = {
            ...createEffect(),
            renderState: {
                depthTest: true,
                cull: true,
                blend: false,
                cullMode: 'front',
                depthWrite: false,
            },
        };

        const cloned = cloneRenderShaderEffectDefinition(effect);

        expect(cloned.renderState).toEqual({
            depthTest: true,
            cull: true,
            blend: false,
            cullMode: 'front',
            depthWrite: false,
        });
        expect(cloned.renderState?.cullMode).toBe('front');
        expect(cloned.renderState?.depthWrite).toBe(false);
    });

    it('round-trips cullMode and depthWrite at technique pass level', () => {
        const effect: RenderShaderEffectDefinition = {
            format: 'axrone.shader/effect',
            version: 2,
            id: 'effect/outline-pass-state',
            defaultTechnique: 'toon',
            techniques: [
                {
                    id: 'toon',
                    passes: [
                        {
                            id: 'outline',
                            renderState: {
                                depthTest: true,
                                cull: true,
                                blend: false,
                                cullMode: 'front',
                                depthWrite: true,
                            },
                        },
                        {
                            id: 'main',
                            renderState: { cullMode: 'none', depthWrite: false },
                        },
                    ],
                },
            ],
            vertex: { main: ['gl_Position = vec4(0.0);'] },
            fragment: { main: [''] },
        };

        const cloned = cloneRenderShaderEffectDefinition(effect);
        const passes = cloned.techniques?.[0]?.passes ?? [];

        expect(passes[0]?.renderState).toEqual({
            depthTest: true,
            cull: true,
            blend: false,
            cullMode: 'front',
            depthWrite: true,
        });
        expect(passes[1]?.renderState).toEqual({
            depthTest: undefined,
            cull: undefined,
            blend: undefined,
            cullMode: 'none',
            depthWrite: false,
        });
    });

    it('keeps undefined cullMode and depthWrite undefined when cloning', () => {
        const effect: RenderShaderEffectDefinition = {
            ...createEffect(),
            renderState: { depthTest: true, cull: true, blend: true },
        };

        const cloned = cloneRenderShaderEffectDefinition(effect);

        expect(cloned.renderState?.cullMode).toBeUndefined();
        expect(cloned.renderState?.depthWrite).toBeUndefined();
        expect(Object.keys(cloned.renderState ?? {})).toEqual([
            'depthTest',
            'cull',
            'blend',
            'cullMode',
            'depthWrite',
        ]);
    });

    it('does not leak nested render state mutations through cloning', () => {
        const effect: RenderShaderEffectDefinition = {
            ...createEffect(),
            renderState: { cullMode: 'back', depthWrite: true },
        };

        const cloned = cloneRenderShaderEffectDefinition(effect);
        (cloned.renderState as any).cullMode = 'front';
        (effect.renderState as any).depthWrite = false;

        expect(effect.renderState?.cullMode).toBe('back');
        expect(cloned.renderState?.depthWrite).toBe(true);
    });
});