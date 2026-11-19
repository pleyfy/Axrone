import { describe, expect, it } from 'vitest';
import { compileRenderShaderEffect } from '@axrone/render-core/shader-effect';
import {
    BUILTIN_MATERIAL_MODELS_V2,
    getMaterialModelDefinitionV2,
} from '@axrone/render-core/material-contract-v2';
import {
    GLTF_CLOTH_SHADER_EFFECT,
    GLTF_DECAL_SHADER_EFFECT,
    GLTF_FOLIAGE_SHADER_EFFECT,
    GLTF_HAIR_SHADER_EFFECT,
    GLTF_PARTICLE_SHADER_EFFECT,
    GLTF_PBR_SHADER_EFFECT,
    GLTF_REFRACTION_COPY_SHADER_EFFECT,
    GLTF_SSS_BLUR_SHADER_EFFECT,
    GLTF_TOON_OUTLINE_SHADER_EFFECT,
    GLTF_TOON_SHADER_EFFECT,
    GLTF_UNLIT_SHADER_EFFECT,
    GLTF_VOLUME_SHADER_EFFECT,
    GLTF_WATER_SHADER_EFFECT,
    POST_PROCESS_CONTRACT_SHADER_EFFECT,
    V2_BUILTIN_SHADER_EFFECTS,
    createGltfRuntimeMaterialPasses,
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
            ['gltf/volume', 'volume'],
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
                GLTF_VOLUME_SHADER_EFFECT,
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

const parseContractDefault = (
    value: string | undefined
): number | readonly number[] | undefined => {
    if (value === undefined) {
        return undefined;
    }
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
        return trimmed
            .slice(1, -1)
            .split(',')
            .map((part) => Number(part.trim()));
    }
    return Number(trimmed);
};

describe('V2 runtime material pass plans', () => {
    it('executes the volume model as a single front-culled raymarch pass', () => {
        const plan = getMaterialModelDefinitionV2('volume')?.passPlan ?? [];
        expect(plan.map((pass) => pass.id)).toEqual(['volume-raymarch']);
        expect(plan[0]?.phase).toBe('volume');
        expect(plan[0]?.cullMode).toBe('front');
        expect(plan[0]?.depthWrite).toBe(false);

        const passes = createGltfRuntimeMaterialPasses(
            { _AlphaMode: 0, _DoubleSided: 1, _VolumeDensity: 2 },
            'gltf/volume'
        );

        expect(passes).toHaveLength(1);
        expect(passes[0].id).toBe('volume-raymarch');
        expect(passes[0].phase).toBe('volume');
        expect(passes[0].rasterizerState.cullMode).toBe('front');
        expect(passes[0].depthStencilState.depthTest).toBe(true);
        expect(passes[0].depthStencilState.depthWrite).toBe(false);
        expect(passes[0].blendState.targets[0].blend).toBe(true);
        expect(Object.isFrozen(passes)).toBe(true);

        const legacy = createGltfRuntimeMaterialPasses({ _AlphaMode: 0 }, 'gltf/pbr');
        expect(legacy.map((pass) => pass.id)).toContain('shadow-caster');
        expect(passes.map((pass) => pass.id)).not.toContain('shadow-caster');
        expect(passes.map((pass) => pass.id)).not.toContain('forward-add');
    });

    it('keeps surface shader ids on the three-pass plan with uniform driven culling', () => {
        const pbrDoubleSided = createGltfRuntimeMaterialPasses({ _DoubleSided: 1 }, 'gltf/pbr');
        expect(pbrDoubleSided.map((pass) => pass.id)).toEqual([
            'main',
            'forward-add',
            'shadow-caster',
        ]);
        expect(pbrDoubleSided[0].rasterizerState.cullMode).toBe('none');

        const unlit = createGltfRuntimeMaterialPasses({ _AlphaMode: 0 }, 'gltf/unlit');
        expect(unlit).toHaveLength(3);
        expect(unlit[0].rasterizerState.cullMode).toBe('back');
    });

    it('keeps toon on exactly four passes without refraction-copy or sss-blur', () => {
        const toonPlan = getMaterialModelDefinitionV2('toon')?.passPlan ?? [];
        expect(toonPlan.map((pass) => pass.id)).toEqual([
            'main',
            'forward-add',
            'shadow-caster',
            'outline',
        ]);

        const toon = createGltfRuntimeMaterialPasses({ _OutlineWidth: 0.02 }, 'gltf/toon');
        expect(toon).toHaveLength(4);
        expect(toon.map((pass) => pass.id)).toEqual([
            'main',
            'forward-add',
            'shadow-caster',
            'outline',
        ]);
        expect(toon.map((pass) => pass.id)).not.toContain('refraction-copy');
        expect(toon.map((pass) => pass.id)).not.toContain('sss-blur');

        const pbr = createGltfRuntimeMaterialPasses({ _OutlineWidth: 0.02 }, 'gltf/pbr');
        expect(pbr.map((pass) => pass.id)).not.toContain('outline');
    });

    it('gates refraction-copy and sss-blur on real PBR uniforms and emits them as passes', () => {
        const plan = getMaterialModelDefinitionV2('pbr')?.passPlan ?? [];
        const gated = plan.filter((pass) => pass.enabledWhenUniformNonZero !== undefined);
        expect(gated.map((pass) => pass.id)).toEqual(['refraction-copy', 'sss-blur']);
        expect(gated.map((pass) => pass.enabledWhenUniformNonZero)).toEqual([
            '_TransmissionFactor',
            '_SubsurfaceFactor',
        ]);
        expect(gated.map((pass) => pass.shaderId)).toEqual([
            'gltf/refraction-copy',
            'gltf/sss-blur',
        ]);

        const pbrUniforms = compileRenderShaderEffect(GLTF_PBR_SHADER_EFFECT).uniformNames;
        expect(pbrUniforms).toContain('_TransmissionFactor');
        expect(pbrUniforms).toContain('_SubsurfaceFactor');

        const glass = createGltfRuntimeMaterialPasses(
            { _TransmissionFactor: 1, _SubsurfaceFactor: 0.5 },
            'gltf/pbr'
        );
        expect(glass.map((pass) => pass.id)).toEqual([
            'main',
            'forward-add',
            'shadow-caster',
            'refraction-copy',
            'sss-blur',
        ]);
        expect(glass[0]?.id).toBe('main');
        expect(Object.isFrozen(glass)).toBe(true);

        const refraction = glass[3]!;
        expect(refraction.phase).toBe('refraction');
        expect(refraction.shaderId).toBe('gltf/refraction-copy');
        expect(refraction.depthStencilState?.depthWrite).toBe(false);

        const subsurface = glass[4]!;
        expect(subsurface.phase).toBe('subsurface');
        expect(subsurface.shaderId).toBe('gltf/sss-blur');
        expect(subsurface.blendState?.targets[0]?.blend).toBe(true);
    });

    it('omits both offscreen passes when the gating uniforms are zero or absent', () => {
        expect(
            createGltfRuntimeMaterialPasses(
                { _TransmissionFactor: 0, _SubsurfaceFactor: 0 },
                'gltf/pbr'
            ).map((pass) => pass.id)
        ).toEqual(['main', 'forward-add', 'shadow-caster']);

        expect(
            createGltfRuntimeMaterialPasses({ _AlphaMode: 0 }, 'gltf/pbr').map((pass) => pass.id)
        ).toEqual(['main', 'forward-add', 'shadow-caster']);

        const transmissionOnly = createGltfRuntimeMaterialPasses(
            { _TransmissionFactor: 0.8, _SubsurfaceFactor: 0 },
            'gltf/pbr'
        );
        expect(transmissionOnly.map((pass) => pass.id)).toEqual([
            'main',
            'forward-add',
            'shadow-caster',
            'refraction-copy',
        ]);

        const subsurfaceOnly = createGltfRuntimeMaterialPasses(
            { _TransmissionFactor: 0, _SubsurfaceFactor: 0.4 },
            'gltf/pbr'
        );
        expect(subsurfaceOnly.map((pass) => pass.id)).toEqual([
            'main',
            'forward-add',
            'shadow-caster',
            'sss-blur',
        ]);
    });

    it('keeps the offscreen gates scoped to the PBR surface family', () => {
        const uniforms = { _TransmissionFactor: 1, _SubsurfaceFactor: 1 };
        expect(
            createGltfRuntimeMaterialPasses(uniforms, 'gltf/unlit').map((pass) => pass.id)
        ).toEqual(['main', 'forward-add', 'shadow-caster']);
        expect(
            createGltfRuntimeMaterialPasses(uniforms, 'gltf/toon').map((pass) => pass.id)
        ).toEqual(['main', 'forward-add', 'shadow-caster']);
        const volume = createGltfRuntimeMaterialPasses(uniforms, 'gltf/volume');
        expect(volume.map((pass) => pass.id)).toEqual(['volume-raymarch']);
    });

    it('carries pbr shader variants through to the offscreen pass shaders', () => {
        const blended = createGltfRuntimeMaterialPasses(
            { _TransmissionFactor: 1, _SubsurfaceFactor: 1, _AlphaMode: 2 },
            'gltf/pbr/blend'
        );
        expect(blended.map((pass) => pass.shaderId)).toEqual([
            undefined,
            undefined,
            undefined,
            'gltf/refraction-copy/blend',
            'gltf/sss-blur/blend',
        ]);
        expect(blended[3]?.rasterizerState?.cullMode).toBe('back');

        const doubleSided = createGltfRuntimeMaterialPasses(
            { _TransmissionFactor: 1, _DoubleSided: 1 },
            'gltf/pbr/double-sided'
        );
        expect(doubleSided[3]?.shaderId).toBe('gltf/refraction-copy/double-sided');
        expect(doubleSided[3]?.rasterizerState?.cullMode).toBe('none');
    });

    it('samples the offscreen targets instead of falling back to the base colour texture', () => {
        const refraction = compileRenderShaderEffect(GLTF_REFRACTION_COPY_SHADER_EFFECT);
        expect(refraction.uniformNames).toContain('_SceneColorTexture');
        expect(refraction.uniformNames).toContain('_RenderTargetSize');
        expect(GLTF_REFRACTION_COPY_SHADER_EFFECT.fragment.main.join('\n')).toContain(
            'texture(_SceneColorTexture'
        );
        expect(GLTF_REFRACTION_COPY_SHADER_EFFECT.fragment.main.join('\n')).not.toContain(
            'texture(_BaseColorTexture'
        );

        const sss = compileRenderShaderEffect(GLTF_SSS_BLUR_SHADER_EFFECT);
        expect(sss.uniformNames).toContain('_SubsurfaceBlurTexture');
        expect(GLTF_SSS_BLUR_SHADER_EFFECT.fragment.main.join('\n')).toContain(
            'texture(_SubsurfaceBlurTexture'
        );
        expect(GLTF_SSS_BLUR_SHADER_EFFECT.fragment.main.join('\n')).not.toContain(
            'texture(_BaseColorTexture'
        );

        expect(resolveGltfShaderDefinition('gltf/refraction-copy')?.id).toBe(
            'gltf/refraction-copy'
        );
        expect(resolveGltfShaderDefinition('gltf/sss-blur')?.id).toBe('gltf/sss-blur');
        expect(V2_BUILTIN_SHADER_EFFECTS).toContain(GLTF_REFRACTION_COPY_SHADER_EFFECT);
        expect(V2_BUILTIN_SHADER_EFFECTS).toContain(GLTF_SSS_BLUR_SHADER_EFFECT);
    });

    it('binds every volume slot to a compiled uniform with a matching default', () => {
        const model = getMaterialModelDefinitionV2('volume');
        expect(model?.defaultShaderId).toBe('gltf/volume');

        const compiled = compileRenderShaderEffect(GLTF_VOLUME_SHADER_EFFECT);
        const defaults = new Map(
            GLTF_VOLUME_SHADER_EFFECT.properties.map((property) => [property.name, property.defaultValue])
        );
        const slotsByKey = new Map((model?.outputSlots ?? []).map((slot) => [slot.key, slot]));

        for (const slot of model?.outputSlots ?? []) {
            if (!slot.bindingKey || slot.capability === 'unsupported') {
                continue;
            }
            expect(compiled.uniformNames, `${slot.key} (${slot.bindingKey})`).toContain(slot.bindingKey);
        }

        const volumeKnobs: readonly [string, string][] = [
            ['volumeDensity', '_VolumeDensity'],
            ['volumeAbsorption', '_VolumeAbsorption'],
            ['volumeScatterColor', '_VolumeScatterColor'],
            ['volumeAnisotropy', '_VolumeAnisotropy'],
        ];

        for (const [slotKey, bindingKey] of volumeKnobs) {
            const slot = slotsByKey.get(slotKey);
            expect(slot?.bindingKey, slotKey).toBe(bindingKey);
            expect(compiled.uniformNames).toContain(bindingKey);
            expect(defaults.get(bindingKey), bindingKey).toEqual(
                parseContractDefault(slot?.defaultValue)
            );
        }

        expect(defaults.get('_VolumeDensity')).toBe(1.2);
        expect(defaults.get('_VolumeAbsorption')).toBe(0.85);
        expect(defaults.get('_VolumeScatterColor')).toEqual([0.95, 0.98, 1]);
        expect(defaults.get('_VolumeAnisotropy')).toBe(0.45);
    });
});
