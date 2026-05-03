import { describe, expect, it } from 'vitest';
import { createSceneShaderDefinitionFromEffect } from '../shader-effect';
import {
    createSceneMaterialInspectorControls,
    createSceneMaterialInspectorSections,
} from '../material-inspector';

describe('scene material inspector metadata', () => {
    it('derives grouped material controls from shader effect metadata', () => {
        const shader = createSceneShaderDefinitionFromEffect({
            format: 'axrone.shader/effect',
            version: 1,
            id: 'shader/test-material',
            properties: [
                {
                    name: 'u_Tint',
                    type: 'vec4',
                    stages: ['fragment'],
                    scope: 'material',
                    defaultValue: [1, 1, 1, 1],
                    inspector: {
                        label: 'Tint',
                        group: 'Surface',
                        control: 'color',
                    },
                },
                {
                    name: 'u_Metallic',
                    type: 'float',
                    stages: ['fragment'],
                    scope: 'material',
                    defaultValue: 1,
                    inspector: {
                        label: 'Metallic',
                        group: 'Surface',
                        control: 'slider',
                        min: 0,
                        max: 1,
                        step: 0.01,
                    },
                },
                {
                    name: 'u_MainTex',
                    type: 'sampler2D',
                    stages: ['fragment'],
                    scope: 'material',
                    inspector: {
                        label: 'Main Texture',
                        group: 'Maps',
                        control: 'texture',
                    },
                },
                {
                    name: 'u_Mode',
                    type: 'float',
                    stages: ['fragment'],
                    scope: 'material',
                    defaultValue: 0,
                    inspector: {
                        label: 'Mode',
                        group: 'Flags',
                        control: 'select',
                        options: [
                            { label: 'Opaque', value: 0 },
                            { label: 'Blend', value: 2 },
                        ],
                    },
                },
                {
                    name: 'u_Enabled',
                    type: 'bool',
                    stages: ['fragment'],
                    scope: 'material',
                    defaultValue: false,
                    inspector: {
                        label: 'Enabled',
                        group: 'Flags',
                        control: 'toggle',
                    },
                },
                {
                    name: 'u_Internal',
                    type: 'float',
                    stages: ['fragment'],
                    scope: 'material',
                    inspector: { hidden: true },
                },
            ],
            vertex: {
                main: ['gl_Position = vec4(0.0);'],
            },
            fragment: {
                precision: 'highp',
                outputs: [{ name: 'o_Color', type: 'vec4' }],
                main: ['o_Color = vec4(1.0);'],
            },
        });

        const controls = createSceneMaterialInspectorControls(shader, {
            id: 'material/test',
            shaderId: shader.id,
            uniforms: {
                u_Tint: [0.8, 0.4, 0.2, 1],
                u_Metallic: 0.35,
                u_Mode: 2,
                u_Enabled: true,
            },
            textures: {
                u_MainTex: 'textures/test/albedo.ktx2',
            },
        });
        const sections = createSceneMaterialInspectorSections(shader, {
            id: 'material/test',
            shaderId: shader.id,
            uniforms: {
                u_Tint: [0.8, 0.4, 0.2, 1],
                u_Metallic: 0.35,
                u_Mode: 2,
                u_Enabled: true,
            },
            textures: {
                u_MainTex: 'textures/test/albedo.ktx2',
            },
        });

        expect(controls).toHaveLength(5);
        expect(controls.find((entry) => entry.name === 'u_Tint')).toMatchObject({
            control: 'color',
            group: 'Surface',
            value: [0.8, 0.4, 0.2, 1],
        });
        expect(controls.find((entry) => entry.name === 'u_MainTex')).toMatchObject({
            control: 'texture',
            value: 'textures/test/albedo.ktx2',
        });
        expect(controls.find((entry) => entry.name === 'u_Mode')?.options).toEqual([
            { label: 'Opaque', value: 0 },
            { label: 'Blend', value: 2 },
        ]);
        expect(sections.map((entry) => entry.title)).toEqual(['Surface', 'Maps', 'Flags']);
    });
});
