import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    BUILTIN_MATERIAL_MODELS_V1,
} from '@axrone/render-core/material-contract';
import {
    BUILTIN_MATERIAL_MODELS_V2,
    MATERIAL_DOMAINS_V2,
    MATERIAL_MODEL_REGISTRY_V2,
    getMaterialDomainDefinitionV2,
    getMaterialModelDefinitionV2,
    isMaterialSlotValueTypeV2,
    listMaterialDomainsV2,
    listMaterialModelDefinitionsV2,
    resolveMaterialModelCapability,
    resolveModelIdFromLegacyShaderId,
    resolveModelOutputSlotV2,
    resolveModelStageSlotsV2,
    resolveOutputSlotCapability,
    resolveShaderIdFromModelId,
    serializeMaterialModelsV2,
    validateBuiltinMaterialModelsV2,
} from '@axrone/render-core/material-contract-v2';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const modelsV2JsonPath = path.join(testDir, '..', 'material-models.v2.json');

describe('material contract v2 domains and registry', () => {
    it('defines all four contract domains including surface, decal, post-process, and planned volume', () => {
        expect(listMaterialDomainsV2()).toBe(MATERIAL_DOMAINS_V2);
        expect(MATERIAL_DOMAINS_V2.map((domain) => domain.id)).toEqual([
            'surface',
            'decal',
            'post-process',
            'volume',
        ]);
        expect(getMaterialDomainDefinitionV2('volume')?.capabilities[0]?.status).toBe('unsupported');
        expect(getMaterialDomainDefinitionV2('decal')?.supportsDepthOffset).toBe(true);
        expect(getMaterialDomainDefinitionV2('post-process')?.supportsVertexOffset).toBe(false);
    });

    it('registers all 12 V2 Material Models cleanly without disturbing V1', () => {
        expect(BUILTIN_MATERIAL_MODELS_V1).toHaveLength(3);
        expect(listMaterialModelDefinitionsV2()).toBe(BUILTIN_MATERIAL_MODELS_V2);
        expect(BUILTIN_MATERIAL_MODELS_V2.map((model) => model.id)).toEqual([
            'pbr',
            'unlit',
            'toon',
            'hair',
            'cloth',
            'water',
            'foliage',
            'sprite',
            'particle',
            'composable',
            'decal',
            'post-process',
        ]);
        expect(MATERIAL_MODEL_REGISTRY_V2.size).toBe(12);
    });

    it('passes structural V2 contract validation across every model', () => {
        const validation = validateBuiltinMaterialModelsV2();
        expect(validation.errors).toEqual([]);
        expect(validation.valid).toBe(true);
    });

    it('upgrades V1 models with ambientOcclusion, opacityMap, and depthOffset slots', () => {
        expect(resolveModelOutputSlotV2('pbr', 'ambientOcclusion')?.bindingKey).toBe('_OcclusionFactor');
        expect(resolveModelOutputSlotV2('pbr', 'opacityMap')?.bindingKey).toBe('_OpacityTexture');
        expect(resolveModelOutputSlotV2('pbr', 'depthOffset')?.bindingKey).toBe('_DepthOffset');
        expect(resolveModelOutputSlotV2('toon', 'ambientOcclusion')?.capability).toBe('supported');
        expect(resolveModelOutputSlotV2('unlit', 'opacityMap')?.capability).toBe('supported');
        expect(resolveModelOutputSlotV2('composable', 'surfaceAttributes')?.valueType).toBe(
            'surfaceAttributes'
        );
        expect(isMaterialSlotValueTypeV2('surfaceAttributes')).toBe(true);
    });

    it('declares animated vertex channels on water and foliage models', () => {
        expect(resolveModelStageSlotsV2('water', 'vertex')).toEqual([
            'vertexOffset',
            'waveAmplitude',
            'waveFrequency',
            'waveSpeed',
        ]);
        expect(resolveModelStageSlotsV2('foliage', 'vertex')).toEqual([
            'vertexOffset',
            'windStrength',
            'windSpeed',
            'windTurbulence',
        ]);
        expect(getMaterialModelDefinitionV2('foliage')?.passPlan[0]?.cullMode).toBe('none');
    });

    it('evaluates Render Profile capability matrices consistently', () => {
        expect(resolveMaterialModelCapability('hair', 'webgl2-standard')?.status).toBe('supported');
        expect(resolveMaterialModelCapability('toon', 'webgl2-minimal')?.status).toBe('unsupported');
        expect(resolveOutputSlotCapability('pbr', 'clearcoat', 'webgl2-standard')).toBe('supported');
        expect(resolveOutputSlotCapability('pbr', 'clearcoat', 'webgl2-minimal')).toBe('unsupported');
        expect(resolveOutputSlotCapability('pbr', 'baseColor', 'native')).toBe('partial');
        expect(resolveOutputSlotCapability('water', 'foamColor', 'native')).toBe('unsupported');
    });

    it('maps legacy and V2 shader IDs onto canonical Material Model IDs round-trip', () => {
        for (const model of BUILTIN_MATERIAL_MODELS_V2) {
            if (model.id === 'composable') {
                continue;
            }
            expect(resolveModelIdFromLegacyShaderId(model.defaultShaderId)).toBe(model.id);
            expect(resolveShaderIdFromModelId(model.id)).toBe(model.defaultShaderId);
        }
        expect(resolveModelIdFromLegacyShaderId('scene/particle-point')).toBe('particle');
    });
});

describe('material contract v2 json artifact', () => {
    it('matches serializeMaterialModelsV2() byte for byte', () => {
        const onDisk = fs.readFileSync(modelsV2JsonPath, 'utf8').replace(/\r\n/g, '\n');
        expect(onDisk).toBe(serializeMaterialModelsV2());
    });
});
