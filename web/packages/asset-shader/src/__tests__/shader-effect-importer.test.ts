import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '@axrone/asset-core';
import {
    createAssetShaderImportPipeline,
    type AssetShaderImportSchema,
} from '../shader-effect-importer';

describe('asset-shader effect import pipeline', () => {
    it('imports shorthand effect JSON and derives a canonical shader effect definition', async () => {
        const database = new AssetDatabase<AssetShaderImportSchema>({
            pipeline: createAssetShaderImportPipeline(),
        });

        const receipt = await database.import({
            kind: 'text',
            uri: 'content/hero-tint.effect.json',
            mimeType: 'application/json',
            data: JSON.stringify({
                attributes: [{ name: 'a_Position', type: 'vec3', location: 0 }],
                properties: [
                    {
                        name: 'u_Tint',
                        type: 'vec4',
                        stages: ['fragment'],
                        scope: 'material',
                        inspector: {
                            label: 'Tint',
                            group: 'Surface',
                            control: 'color',
                        },
                    },
                ],
                vertex: {
                    main: ['gl_Position = vec4(a_Position, 1.0);'],
                },
                fragment: {
                    precision: 'highp',
                    outputs: [{ name: 'o_Color', type: 'vec4' }],
                    main: ['o_Color = u_Tint;'],
                },
            }),
        });

        expect(receipt.importerId).toBe('asset-shader.effect.json');
        expect(receipt.primary.kind).toBe('shaderEffect');
        expect(receipt.primary.data.format).toBe('axrone.shader/effect');
        expect(receipt.primary.data.version).toBe(1);
        expect(receipt.primary.data.id).toBe('hero-tint');
        expect(receipt.primary.data.properties?.[0]?.inspector?.control).toBe('color');
    });

    it('imports wrapped effect JSON and preserves inspector select options and array uniforms', async () => {
        const database = new AssetDatabase<AssetShaderImportSchema>({
            pipeline: createAssetShaderImportPipeline(),
        });

        const receipt = await database.import({
            kind: 'json',
            uri: 'content/rig.shader.json',
            data: {
                effect: {
                    id: 'shader/rig-preview',
                    attributes: [{ name: 'a_Position', type: 'vec3', location: 0 }],
                    properties: [
                        {
                            name: 'u_JointMatrices',
                            type: 'mat4',
                            arrayLength: 32,
                            stages: ['vertex'],
                            scope: 'object',
                        },
                        {
                            name: 'u_Mode',
                            type: 'float',
                            stages: ['fragment'],
                            scope: 'material',
                            inspector: {
                                label: 'Mode',
                                group: 'Rendering',
                                control: 'select',
                                options: [
                                    { label: 'Opaque', value: 0 },
                                    { label: 'Blend', value: 2 },
                                ],
                            },
                        },
                    ],
                    vertex: {
                        main: ['gl_Position = vec4(a_Position, 1.0);'],
                    },
                    fragment: {
                        precision: 'highp',
                        outputs: [{ name: 'o_Color', type: 'vec4' }],
                        main: ['o_Color = vec4(vec3(u_Mode / 2.0), 1.0);'],
                    },
                },
            },
        });

        expect(receipt.primary.data.id).toBe('shader/rig-preview');
        expect(receipt.primary.data.properties?.[0]?.arrayLength).toBe(32);
        expect(receipt.primary.data.properties?.[1]?.inspector?.options).toEqual([
            { label: 'Opaque', value: 0 },
            { label: 'Blend', value: 2 },
        ]);
    });
});
