import { describe, expect, it } from 'vitest';
import {
    compileRenderShaderEffect,
    type RenderShaderEffectDefinition,
} from '@axrone/render-core';
import { GLTF_PBR_SHADER_EFFECT } from '../internal/gltf-shader-effects-pbr';
import { GLTF_UNLIT_SHADER_EFFECT } from '../internal/gltf-shader-effects-unlit';
import {
    GLTF_TOON_SHADER_EFFECT,
    GLTF_TOON_OUTLINE_SHADER_EFFECT,
} from '../internal/gltf-shader-effects-toon';

const STOCK_EFFECTS: ReadonlyArray<readonly [string, RenderShaderEffectDefinition]> = [
    ['gltf/pbr', GLTF_PBR_SHADER_EFFECT],
    ['gltf/unlit', GLTF_UNLIT_SHADER_EFFECT],
    ['gltf/toon', GLTF_TOON_SHADER_EFFECT],
    ['gltf/toon-outline', GLTF_TOON_OUTLINE_SHADER_EFFECT],
];

const collectDeclarations = (source: string): Set<string> => {
    const declared = new Set<string>();
    const interfacePattern = /^(?:layout\([^)]*\)\s*)?(?:in|out)\s+\w+\s+(\w+)\s*;/gm;
    const uniformPattern = /^uniform\s+\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/gm;

    for (const match of source.matchAll(interfacePattern)) {
        declared.add(match[1]!);
    }
    for (const match of source.matchAll(uniformPattern)) {
        declared.add(match[1]!);
    }

    return declared;
};

const collectReferences = (source: string): string[] =>
    [...new Set((source.match(/\b(?:v|a)_[A-Za-z][A-Za-z0-9_]*\b/g) ?? []))].sort();

const findUndeclared = (effect: RenderShaderEffectDefinition): string[] => {
    const compiled = compileRenderShaderEffect(effect);
    const problems: string[] = [];

    for (const [stageName, source] of [
        ['vertex', compiled.vertexSource],
        ['fragment', compiled.fragmentSource],
    ] as const) {
        const declared = collectDeclarations(source);
        for (const reference of collectReferences(source)) {
            if (!declared.has(reference)) {
                problems.push(`${effect.id} ${stageName}: ${reference}`);
            }
        }
    }

    return problems;
};

describe('gltf stock shader interface closure', () => {
    it.each(STOCK_EFFECTS)('%s declares every attribute and varying it references', (_id, effect) => {
        expect(findUndeclared(effect)).toEqual([]);
    });

    it('reports the reference set so the gate can fail', () => {
        const broken = {
            ...GLTF_TOON_OUTLINE_SHADER_EFFECT,
            varyings: [{ name: 'v_UV0', type: 'vec2' as const }],
        };

        expect(findUndeclared(broken).length).toBeGreaterThan(0);
    });
});
