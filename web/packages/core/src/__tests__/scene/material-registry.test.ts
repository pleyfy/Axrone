import { Vec4 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import {
    cloneSceneMaterialDefinition,
    normalizeSceneTextureBinding,
    SceneMaterialRegistry,
} from '../../scene/material-registry';

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
        });
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
});
