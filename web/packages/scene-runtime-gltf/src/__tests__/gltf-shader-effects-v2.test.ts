import { describe, expect, it } from 'vitest';
import { compileRenderShaderEffect } from '@axrone/render-core/shader-effect';
import { BUILTIN_MATERIAL_MODELS_V2 } from '@axrone/render-core/material-contract-v2';
import {
    GLTF_CLOTH_SHADER_EFFECT,
    GLTF_DECAL_SHADER_EFFECT,
    GLTF_FOLIAGE_SHADER_EFFECT,
    GLTF_HAIR_SHADER_EFFECT,
    GLTF_PARTICLE_SHADER_EFFECT,
    GLTF_PBR_SHADER_EFFECT,
    GLTF_TOON_OUTLINE_SHADER_EFFECT,
    GLTF_TOON_SHADER_EFFECT,
    GLTF_UNLIT_SHADER_EFFECT,
    GLTF_WATER_SHADER_EFFECT,
    POST_PROCESS_CONTRACT_SHADER_EFFECT,
    V2_BUILTIN_SHADER_EFFECTS,
    createGltfRuntimeSurfaceDefinition,
} from '../index';
import { resolveGltfShaderDefinition } from '../internal/runtime-shaders';

describe('V2 shader effects compilation and contract parity', () => {
    it('compiles every V2 built-in shader effect cleanly via compileRenderShaderEffect', () => {
        for (const effect of V2_BUILTIN_SHADER_EFFECTS) {
            const compiled = compileRenderShaderEffect(effect);
            expect(compiled.id, effect.id).toBe(effect.id);
            expect(compiled.vertexSource, `${effect.id} vertex`).toContain('#version 300 es');
            expect(compiled.fragmentSource, `${effect.id} fragment`).toContain('#version 300 es');
            expect(compiled.uniformNames.length, `${effect.id} uniforms`).toBeGreaterThan(5);
        }
    });

    it('wires _OcclusionFactor and _OpacityTexture into PBR, Unlit, and Toon', () => {
        const pbr = compileRenderShaderEffect(GLTF_PBR_SHADER_EFFECT);
        const unlit = compileRenderShaderEffect(GLTF_UNLIT_SHADER_EFFECT);
        const toon = compileRenderShaderEffect(GLTF_TOON_SHADER_EFFECT);
        const outline = compileRenderShaderEffect(GLTF_TOON_OUTLINE_SHADER_EFFECT);

        expect(pbr.uniformNames).toContain('_OcclusionFactor');
        expect(pbr.uniformNames).toContain('_OpacityTexture');
        expect(unlit.uniformNames).toContain('_OpacityTexture');
        expect(toon.uniformNames).toContain('_OcclusionFactor');
        expect(toon.uniformNames).toContain('_OpacityTexture');
        expect(outline.uniformNames).toContain('_OpacityTexture');
    });

    it('resolves GltfShaderDefinition and runtime surface shadingModel for every V2 shader ID', () => {
        const expectedPairs: readonly [string, string][] = [
            ['gltf/hair', 'hair'],
            ['gltf/cloth', 'cloth'],
            ['gltf/water', 'water'],
            ['gltf/foliage', 'foliage'],
            ['gltf/particle', 'particle'],
            ['gltf/decal', 'decal'],
            ['post-process/contract', 'post-process'],
        ];

        for (const [shaderId, shadingModel] of expectedPairs) {
            const definition = resolveGltfShaderDefinition(shaderId);
            expect(definition?.id, shaderId).toBe(shaderId);
            expect(definition?.effect?.id, shaderId).toBe(shaderId);
            expect(createGltfRuntimeSurfaceDefinition(shaderId).shadingModel).toBe(shadingModel);
        }
    });

    it('declares every bindingKey of V2 shader models on the matching engine effect', () => {
        const effectsById = new Map(
            [
                GLTF_PBR_SHADER_EFFECT,
                GLTF_UNLIT_SHADER_EFFECT,
                GLTF_TOON_SHADER_EFFECT,
                GLTF_HAIR_SHADER_EFFECT,
                GLTF_CLOTH_SHADER_EFFECT,
                GLTF_WATER_SHADER_EFFECT,
                GLTF_FOLIAGE_SHADER_EFFECT,
                GLTF_PARTICLE_SHADER_EFFECT,
                GLTF_DECAL_SHADER_EFFECT,
                POST_PROCESS_CONTRACT_SHADER_EFFECT,
            ].map((effect) => [effect.id, compileRenderShaderEffect(effect)])
        );

        for (const model of BUILTIN_MATERIAL_MODELS_V2) {
            const compiled = effectsById.get(model.defaultShaderId);
            if (!compiled) {
                continue;
            }
            for (const slot of model.outputSlots) {
                if (!slot.bindingKey || slot.capability === 'unsupported') {
                    continue;
                }
                if (slot.key === 'depthOffset') {
                    continue;
                }
                if (model.id === 'toon' && (slot.key === 'outlineWidth' || slot.key === 'outlineColor')) {
                    continue;
                }
                expect(
                    compiled.uniformNames,
                    `${model.id}.${slot.key} (${slot.bindingKey}) missing on ${model.defaultShaderId}`
                ).toContain(slot.bindingKey);
            }
        }
    });

    it('preserves pass render states on water, foliage, particle, decal, and post-process effects', () => {
        expect(GLTF_WATER_SHADER_EFFECT.renderState).toMatchObject({ blend: true, depthWrite: false, cull: false });
        expect(GLTF_FOLIAGE_SHADER_EFFECT.renderState).toMatchObject({ cull: false, depthTest: true, depthWrite: true });
        expect(GLTF_PARTICLE_SHADER_EFFECT.renderState).toMatchObject({ blend: true, depthWrite: false, cull: false });
        expect(GLTF_DECAL_SHADER_EFFECT.renderState).toMatchObject({ blend: true, depthWrite: false, cull: true });
        expect(POST_PROCESS_CONTRACT_SHADER_EFFECT.renderState).toMatchObject({
            depthTest: false,
            depthWrite: false,
            cull: false,
            blend: true,
        });
    });
});
