import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    BUILTIN_MATERIAL_MODELS_V1,
    MATERIAL_MODEL_REGISTRY_V1,
    getMaterialModelDefinition,
    isMaterialSlotValueType,
    listMaterialModelDefinitions,
    resolveModelOutputSlot,
    serializeMaterialModelsV1,
    validateMaterialModelDefinition,
    type MaterialModelDefinition,
    type MaterialOutputSlotDefinition,
} from '@axrone/render-core';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const modelsJsonPath = path.join(testDir, '..', 'material-models.v1.json');

const findModel = (id: 'pbr' | 'unlit' | 'toon'): MaterialModelDefinition => {
    const definition = getMaterialModelDefinition(id);
    if (!definition) {
        throw new Error(`missing material model '${id}'`);
    }

    return definition;
};

const slotKeys = (slots: readonly MaterialOutputSlotDefinition[]): readonly string[] =>
    slots.map((slot) => slot.key);

describe('material contract v1 pass plan consistency', () => {
    it('names the primary pass identically across every Material Model', () => {
        for (const definition of listMaterialModelDefinitions()) {
            expect(definition.passPlan[0]?.id).toBe('main');
            expect(definition.passPlan[0]?.phase).toBe('default');
            expect(definition.passPlan.map((entry) => entry.id)).not.toContain('default');
        }
    });

    it('reserves a shaderId override for the toon outline pass only', () => {
        const withOverride = listMaterialModelDefinitions()
            .flatMap((definition) =>
                definition.passPlan
                    .filter((entry) => entry.shaderId !== undefined)
                    .map((entry) => `${definition.id}/${entry.id}`)
            )
            .sort();

        expect(withOverride).toEqual(['toon/outline']);
        expect(getMaterialModelDefinition('toon')?.passPlan[3]).toMatchObject({
            id: 'outline',
            phase: 'outline',
            shaderId: 'gltf/toon-outline',
            cullMode: 'front',
            depthTest: true,
            depthWrite: true,
            enabledWhenUniformNonZero: '_OutlineWidth',
        });
    });
});

describe('material contract v1 registry', () => {
    it('exposes exactly the three locked material models', () => {
        expect(listMaterialModelDefinitions()).toBe(BUILTIN_MATERIAL_MODELS_V1);
        expect(BUILTIN_MATERIAL_MODELS_V1.map((model) => model.id)).toEqual([
            'pbr',
            'unlit',
            'toon',
        ]);
        expect([...MATERIAL_MODEL_REGISTRY_V1.keys()]).toEqual(['pbr', 'unlit', 'toon']);
    });

    it('resolves registered definitions and returns undefined for unknown ids', () => {
        expect(getMaterialModelDefinition('pbr')?.compilerFamily).toBe('gltf/pbr');
        expect(getMaterialModelDefinition('unlit')?.defaultShaderId).toBe('gltf/unlit');
        expect(getMaterialModelDefinition('toon')?.domain).toBe('surface');
        expect(getMaterialModelDefinition('hair' as never)).toBeUndefined();
    });

    it('resolves output slots per model without cross-model leakage', () => {
        expect(resolveModelOutputSlot('toon', 'shadowColor')?.bindingKey).toBe('_ShadowColor');
        expect(resolveModelOutputSlot('pbr', 'shadowColor')).toBeUndefined();
        expect(resolveModelOutputSlot('unlit', 'metallic')).toBeUndefined();
        expect(resolveModelOutputSlot('pbr', 'vertexOffset')?.semantic).toBe('vertex.offset');
    });

    it('guards slot value types against the locked union', () => {
        expect(isMaterialSlotValueType('vec3')).toBe(true);
        expect(isMaterialSlotValueType('tex')).toBe(true);
        expect(isMaterialSlotValueType('vec5')).toBe(false);
        expect(isMaterialSlotValueType(undefined)).toBe(false);
    });

    it('keeps every built-in definition valid', () => {
        for (const definition of BUILTIN_MATERIAL_MODELS_V1) {
            expect(validateMaterialModelDefinition(definition)).toEqual({
                valid: true,
                errors: [],
            });
        }
    });
});

describe('material contract v1 pbr model', () => {
    const model = findModel('pbr');

    it('declares the locked core surface slots in order', () => {
        const fragmentStage = model.stages[1];
        expect(fragmentStage.stage).toBe('fragment');
        expect(fragmentStage.defaultCollapsed).toBe(false);
        expect(fragmentStage.slots.slice(0, 7)).toEqual([
            'baseColor',
            'metallic',
            'roughness',
            'normal',
            'opacity',
            'opacityMask',
            'emission',
        ]);
        expect(model.stages[0].slots).toEqual(['vertexOffset']);
        expect(model.stages[0].defaultCollapsed).toBe(true);
    });

    it('binds the core uniform names from the contract', () => {
        const expectedBindings: Readonly<Record<string, string>> = {
            vertexOffset: '_VertexOffset',
            baseColor: '_BaseColorFactor',
            metallic: '_MetallicFactor',
            roughness: '_RoughnessFactor',
            normal: '_NormalTexture',
            opacity: '_OpacityFactor',
            opacityMask: '_AlphaCutoff',
            emission: '_EmissiveFactor',
        };

        for (const [key, bindingKey] of Object.entries(expectedBindings)) {
            expect(resolveModelOutputSlot('pbr', key)?.bindingKey).toBe(bindingKey);
        }
    });

    it('declares all eighteen advanced sections as advanced slots', () => {
        const advanced = model.outputSlots.filter((slot) => slot.advanced === true);
        expect(slotKeys(advanced)).toEqual([
            'clearcoat',
            'clearcoatRoughness',
            'clearcoatNormal',
            'clearcoatNormalScale',
            'sheen',
            'sheenColor',
            'sheenRoughness',
            'anisotropy',
            'anisotropyRotation',
            'subsurface',
            'subsurfaceColor',
            'subsurfaceRadius',
            'iridescence',
            'iridescenceIor',
            'iridescenceThickness',
            'transmission',
            'ior',
            'thickness',
        ]);
        expect(advanced.every((slot) => slot.stage === 'fragment')).toBe(true);
        expect(new Set(advanced.map((slot) => slot.section)).size).toBe(6);
    });
});

describe('material contract v1 unlit model', () => {
    const model = findModel('unlit');

    it('limits the fragment stage contract to unlit surface slots', () => {
        expect(slotKeys(model.outputSlots)).toEqual([
            'vertexOffset',
            'baseColor',
            'opacity',
            'opacityMask',
            'emission',
        ]);
        expect(model.passPlan).toEqual([{ id: 'main', phase: 'default', required: true }]);
    });
});

describe('material contract v1 toon model', () => {
    const model = findModel('toon');

    it('orders surface, toon and outline sections on the fragment stage', () => {
        expect(model.stages[1].slots).toEqual([
            'baseColor',
            'normal',
            'opacity',
            'opacityMask',
            'emission',
            'shadowColor',
            'shadowThreshold',
            'shadowSmoothness',
            'highlightThreshold',
            'highlightColor',
            'rimColor',
            'rimThreshold',
            'rimSmoothness',
            'outlineWidth',
            'outlineColor',
        ]);
        expect(resolveModelOutputSlot('toon', 'normal')?.optional).toBe(true);
    });

    it('carries the locked toon default values as string encodings', () => {
        const defaults: Readonly<Record<string, string>> = {
            shadowColor: '[0.2, 0.2, 0.3]',
            shadowThreshold: '0.5',
            shadowSmoothness: '0.05',
            highlightThreshold: '0.8',
            highlightColor: '[1, 1, 1]',
            rimColor: '[0.8, 0.9, 1.0]',
            rimThreshold: '0.6',
            rimSmoothness: '0.1',
            outlineWidth: '0',
            outlineColor: '[0, 0, 0]',
        };

        for (const [key, defaultValue] of Object.entries(defaults)) {
            expect(resolveModelOutputSlot('toon', key)?.defaultValue).toBe(defaultValue);
        }
    });

    it('plans the inverted-hull outline pass with pass-level render state', () => {
        expect(model.passPlan).toEqual([
            { id: 'main', phase: 'default', required: true },
            { id: 'forward-add', phase: 'forward-add' },
            { id: 'shadow-caster', phase: 'shadow-caster' },
            {
                id: 'outline',
                phase: 'outline',
                shaderId: 'gltf/toon-outline',
                cullMode: 'front',
                depthTest: true,
                depthWrite: true,
                enabledWhenUniformNonZero: '_OutlineWidth',
            },
        ]);
    });
});

describe('material contract v1 validation', () => {
    const cloneModel = (id: 'pbr' | 'unlit' | 'toon'): MaterialModelDefinition =>
        JSON.parse(JSON.stringify(findModel(id))) as MaterialModelDefinition;

    it('rejects a mismatched contract version', () => {
        const broken: MaterialModelDefinition = {
            ...cloneModel('unlit'),
            contractVersion: 2,
        } as unknown as MaterialModelDefinition;

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "material model 'unlit' has contractVersion 2; expected 1.",
        ]);
    });

    it('rejects empty identity fields', () => {
        const broken = { ...cloneModel('pbr'), label: '', description: '' };

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "material model 'pbr' has an empty label.",
            "material model 'pbr' has an empty description.",
        ]);
    });

    it('rejects an unsupported compiler family', () => {
        const broken: MaterialModelDefinition = {
            ...cloneModel('toon'),
            compilerFamily: 'gltf/hair',
        } as unknown as MaterialModelDefinition;

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "material model 'toon' has invalid compilerFamily 'gltf/hair'.",
        ]);
    });

    it('reports undeclared stage slot references and unreferenced output slots', () => {
        const broken = cloneModel('unlit');
        broken.stages = [
            ...broken.stages,
            {
                stage: 'fragment',
                label: 'Extra Stage',
                defaultCollapsed: false,
                slots: ['ghostSlot'],
            },
        ];

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "stages declares stage 'fragment' more than once.",
            "stages[2].slots[0] references undeclared outputSlot 'ghostSlot' on model 'unlit'.",
        ]);
    });

    it('reports a slot key listed twice inside one stage contract', () => {
        const broken = cloneModel('toon');
        broken.stages = broken.stages.map((stage) =>
            stage.stage === 'vertex' ? { ...stage, slots: ['vertexOffset', 'vertexOffset'] } : stage
        );

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "stage 'vertex' lists slot key 'vertexOffset' more than once.",
            "outputSlot 'vertexOffset' is referenced by more than one stage.",
        ]);
    });

    it('reports output slots that no stage contract references', () => {
        const broken = cloneModel('unlit');
        broken.stages = [
            {
                stage: 'vertex',
                label: 'Vertex Stage',
                defaultCollapsed: true,
                slots: ['vertexOffset'],
            },
        ];

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "outputSlot 'baseColor' is not referenced by any stage contract.",
            "outputSlot 'opacity' is not referenced by any stage contract.",
            "outputSlot 'opacityMask' is not referenced by any stage contract.",
            "outputSlot 'emission' is not referenced by any stage contract.",
        ]);
    });

    it('flags duplicate output slot keys and duplicate stage listings', () => {
        const broken = cloneModel('toon');
        const duplicated: MaterialOutputSlotDefinition = {
            key: 'baseColor',
            label: 'Base Color',
            stage: 'fragment',
            section: 'surface',
            valueType: 'vec4',
            semantic: 'surface.baseColor',
            capability: 'supported',
        };
        broken.outputSlots = [...broken.outputSlots, duplicated];

        expect(validateMaterialModelDefinition(broken).errors).toContain(
            "outputSlots contains duplicate slot key 'baseColor'."
        );
    });

    it('requires binding keys and enablement gates to start with an underscore', () => {
        const broken = cloneModel('toon');
        broken.outputSlots = broken.outputSlots.map((slot) =>
            slot.key === 'rimColor' ? { ...slot, bindingKey: 'rimColor' } : slot
        );
        broken.passPlan = broken.passPlan.map((entry) =>
            entry.id === 'outline' ? { ...entry, enabledWhenUniformNonZero: 'OutlineWidth' } : entry
        );

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "outputSlot 'rimColor' bindingKey 'rimColor' must start with '_'.",
            "passPlan entry 'outline' enabledWhenUniformNonZero 'OutlineWidth' must start with '_'.",
        ]);
    });

    it('rejects default values that do not parse as the declared value type', () => {
        const broken = cloneModel('toon');
        broken.outputSlots = broken.outputSlots.map((slot) =>
            slot.key === 'shadowColor' ? { ...slot, defaultValue: '0.2, 0.2, 0.3' } : slot
        );

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "outputSlot 'shadowColor' defaultValue '0.2, 0.2, 0.3' does not parse as valueType 'vec3'.",
        ]);
    });

    it('accepts vector defaults whose component count matches the value type', () => {
        const broken = cloneModel('pbr');
        broken.outputSlots = broken.outputSlots.map((slot) =>
            slot.key === 'baseColor' ? { ...slot, defaultValue: '[1, 1, 1, 1]' } : slot
        );

        expect(validateMaterialModelDefinition(broken)).toEqual({ valid: true, errors: [] });

        broken.outputSlots = broken.outputSlots.map((slot) =>
            slot.key === 'baseColor' ? { ...slot, defaultValue: '[1, 1, 1]' } : slot
        );

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "outputSlot 'baseColor' defaultValue '[1, 1, 1]' does not parse as valueType 'vec4'.",
        ]);
    });

    it('rejects bool and float defaults that cannot be parsed', () => {
        const broken = cloneModel('toon');
        broken.outputSlots = broken.outputSlots.map((slot) =>
            slot.key === 'shadowThreshold'
                ? { ...slot, defaultValue: 'medium' }
                : slot.key === 'outlineWidth'
                  ? { ...slot, valueType: 'bool', defaultValue: 'yes' }
                  : slot
        );

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "outputSlot 'shadowThreshold' defaultValue 'medium' does not parse as valueType 'float'.",
            "outputSlot 'outlineWidth' defaultValue 'yes' does not parse as valueType 'bool'.",
        ]);
    });

    it('rejects duplicate pass ids and empty optional pass shaders', () => {
        const broken = cloneModel('toon');
        broken.passPlan = [
            ...broken.passPlan,
            { id: 'main', phase: 'default', shaderId: '' },
        ];

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "passPlan contains duplicate pass id 'main'.",
            "passPlan entry 'main' has an empty shaderId.",
        ]);
    });

    it('rejects invalid capability profiles and statuses', () => {
        const broken = cloneModel('pbr');
        broken.capabilities = [
            { profile: 'webgl2-standard', status: 'partial' },
            { profile: 'webgl2-standard', status: 'experimental' as never },
        ];

        expect(validateMaterialModelDefinition(broken).errors).toEqual([
            "capabilities contains duplicate profile 'webgl2-standard'.",
            "capability 'webgl2-standard' has invalid status 'experimental'.",
        ]);
    });

    it('does not throw for partially malformed definitions', () => {
        const malformed = {
            contractVersion: 1,
            id: 'pbr',
            label: '',
            description: '',
            domain: 'volume' as never,
            compilerFamily: 'gltf/unknown' as never,
            defaultShaderId: '',
            stages: [],
            outputSlots: [],
            passPlan: [],
            capabilities: [],
        } satisfies unknown as MaterialModelDefinition;

        const result = validateMaterialModelDefinition(malformed);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(6);
    });
});

describe('material contract v1 json artifact', () => {
    it('matches the serialized registry byte for byte', () => {
        const fileContent = fs.readFileSync(modelsJsonPath, 'utf8').replace(/\r\n/g, '\n');

        expect(fileContent).toBe(serializeMaterialModelsV1());
    });

    it('parses back into the registry without drift', () => {
        const parsed = JSON.parse(fs.readFileSync(modelsJsonPath, 'utf8')) as {
            readonly contractVersion: number;
            readonly models: readonly MaterialModelDefinition[];
        };

        expect(parsed.contractVersion).toBe(1);
        expect(parsed.models).toEqual(BUILTIN_MATERIAL_MODELS_V1);
    });

    it('is deterministic across repeated serialization', () => {
        expect(serializeMaterialModelsV1()).toBe(serializeMaterialModelsV1());
    });

    it('uses axrone canonical vocabulary only', () => {
        const document = serializeMaterialModelsV1();
        const forbiddenForeignTerms = [
            'Master' + ' Stack',
            'Graph' + ' Settings',
            'Black' + 'board',
            'Sub' + 'graph',
            'Material' + ' Function',
            'World Position' + ' Offset',
            'Pixel Depth' + ' Offset',
            'Material' + ' Attributes',
            'Sub' + 'strate',
            'Shader' + ' Graph',
            'Master' + ' Material',
            'U' + 'RP',
            'HDR' + 'P',
        ];

        for (const term of forbiddenForeignTerms) {
            expect(document.includes(term)).toBe(false);
        }
    });
});
