import { Vec4 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import {
    cloneSceneMaterialDefinition,
    normalizeSceneTextureBinding,
    SceneMaterialRegistry,
} from '@axrone/scene-3d';

describe('SceneMaterialRegistry', () => {
    it('creates material resources and returns handles', () => {
        const registry = new SceneMaterialRegistry();
        const handle = registry.create({
            id: 'mat/basic',
            shaderId: 'shader/basic',
            textures: {
                u_MainTex: {
                    textureId: 'checker',
                    samplerId: 'linear',
                },
            },
        });

        expect(handle).toEqual({
            id: 'mat/basic',
            shaderId: 'shader/basic',
            textureBindings: ['u_MainTex'],
            passIds: [],
        });
        expect(registry.get('mat/basic')?.textureBindings.get('u_MainTex')).toEqual({
            textureId: 'checker',
            samplerId: 'linear',
        });
    });

    it('updates material uniforms and texture bindings in definitions', () => {
        const registry = new SceneMaterialRegistry();
        registry.create({
            id: 'mat/basic',
            shaderId: 'shader/basic',
        });

        const tint = new Vec4(0.1, 0.2, 0.3, 1);
        expect(registry.setUniform('mat/basic', 'u_Tint', tint)).toBe(true);
        expect(
            registry.setTexture('mat/basic', 'u_MainTex', {
                textureId: 'checker',
                samplerId: 'linear',
                unit: 2,
            })
        ).toBe(true);

        tint.x = 1;
        const [definition] = registry.getDefinitions();

        expect(definition?.uniforms?.u_Tint).toBeInstanceOf(Vec4);
        expect(definition?.uniforms?.u_Tint).not.toBe(tint);
        expect(definition?.textures?.u_MainTex).toEqual({
            textureId: 'checker',
            samplerId: 'linear',
            unit: 2,
        });
        expect(registry.getHandle('mat/basic')).toEqual({
            id: 'mat/basic',
            shaderId: 'shader/basic',
            textureBindings: ['u_MainTex'],
            passIds: [],
        });
        expect(registry.getTextureSlots('mat/basic')).toEqual([
            {
                uniformName: 'u_MainTex',
                binding: {
                    textureId: 'checker',
                    samplerId: 'linear',
                    unit: 2,
                },
                resolvedUnit: 2,
            },
        ]);
    });

    it('normalizes string texture bindings and clones material definitions', () => {
        const definition = {
            id: 'mat/basic',
            shaderId: 'shader/basic',
            uniforms: {
                u_Tint: new Vec4(0.1, 0.2, 0.3, 1),
            },
            textures: {
                u_MainTex: 'checker',
            },
        };

        const normalized = normalizeSceneTextureBinding('checker');
        const cloned = cloneSceneMaterialDefinition(definition);
        (definition.uniforms.u_Tint as Vec4).x = 1;

        expect(normalized).toEqual({
            textureId: 'checker',
            samplerId: null,
        });
        expect(cloned.uniforms?.u_Tint).toBeInstanceOf(Vec4);
        expect(cloned.uniforms?.u_Tint).not.toBe(definition.uniforms.u_Tint);
        expect(cloned.textures?.u_MainTex).toBe('checker');
    });

    it('clones and exposes material pass definitions through handles', () => {
        const registry = new SceneMaterialRegistry();
        const definition = {
            id: 'mat/passes',
            shaderId: 'shader/basic',
            passes: [
                {
                    id: 'main',
                    primitive: 'triangle-list' as const,
                    rasterizerState: {
                        cullMode: 'back' as const,
                    },
                    blendState: {
                        blendColor: [0.1, 0.2, 0.3, 0.4] as const,
                        targets: [
                            {
                                blend: true,
                                colorWriteMask: [true, false, true, false] as const,
                            },
                        ],
                    },
                },
            ],
        };

        const handle = registry.create(definition);
        const storedPass = registry.get('mat/passes')?.passes[0];
        definition.passes[0]!.blendState!.blendColor = [1, 1, 1, 1];

        expect(handle.passIds).toEqual(['main']);
        expect(storedPass?.blendState?.blendColor).toEqual([0.1, 0.2, 0.3, 0.4]);
        expect(storedPass?.blendState?.targets?.[0]?.colorWriteMask).toEqual([
            true,
            false,
            true,
            false,
        ]);
    });

    it('clears stored materials', () => {
        const registry = new SceneMaterialRegistry();
        registry.create({
            id: 'mat/basic',
            shaderId: 'shader/basic',
        });

        registry.clear();

        expect(registry.get('mat/basic')).toBeUndefined();
        expect(registry.getDefinitions()).toEqual([]);
    });

    it('caches deterministic texture slots for repeated lookups', () => {
        const registry = new SceneMaterialRegistry();
        registry.create({
            id: 'mat/basic',
            shaderId: 'shader/basic',
            textures: {
                u_Overlay: {
                    textureId: 'overlay',
                    unit: 4,
                },
                u_MainTex: {
                    textureId: 'checker',
                },
            },
        });

        const first = registry.getTextureSlots('mat/basic');
        const second = registry.getTextureSlots('mat/basic');

        expect(first).toBe(second);
        expect(first.map((slot) => [slot.uniformName, slot.resolvedUnit])).toEqual([
            ['u_Overlay', 4],
            ['u_MainTex', 0],
        ]);

        registry.setTexture('mat/basic', 'u_Detail', {
            textureId: 'detail',
            unit: 1,
        });
        const third = registry.getTextureSlots('mat/basic');

        expect(third).not.toBe(first);
        expect(third.map((slot) => [slot.uniformName, slot.resolvedUnit])).toEqual([
            ['u_Detail', 1],
            ['u_Overlay', 4],
            ['u_MainTex', 0],
        ]);
    });
});
