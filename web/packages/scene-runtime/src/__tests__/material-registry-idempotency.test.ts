import { describe, expect, it, vi } from 'vitest';
import { SceneMaterialRegistry } from '../material-registry';
import type { SceneMaterialDefinition } from '../types';

const createPbrDefinition = (
    overrides: Partial<SceneMaterialDefinition> = {}
): SceneMaterialDefinition => ({
    id: 'test-material',
    shaderId: 'gltf/pbr',
    uniforms: {
        _BaseColorFactor: [1, 1, 1, 1],
        _MetallicFactor: 0,
        _RoughnessFactor: 0.5,
    },
    ...overrides,
});

describe('SceneMaterialRegistry — idempotent create', () => {
    it('returns existing handle silently when identical definition is re-created', () => {
        const registry = new SceneMaterialRegistry();
        const definition = createPbrDefinition();

        const handle1 = registry.create(definition);
        const warnSpy = vi.spyOn(console, 'warn');

        const handle2 = registry.create(definition);

        expect(handle2).toEqual(handle1);
        expect(warnSpy).not.toHaveBeenCalled();
        expect(registry.size).toBe(1);

        warnSpy.mockRestore();
    });

    it('returns same handle for semantically identical definitions with different object references', () => {
        const registry = new SceneMaterialRegistry();

        const def1: SceneMaterialDefinition = {
            id: 'mat-a',
            shaderId: 'gltf/pbr',
            uniforms: { _BaseColorFactor: [0.8, 0.8, 0.8, 1], _MetallicFactor: 0 },
            surface: {
                shadingModel: 'pbr',
                alphaMode: 'opaque',
                roughness: 0.5,
                metallic: 0,
            },
        };

        // Same content, different object references
        const def2: SceneMaterialDefinition = {
            id: 'mat-a',
            shaderId: 'gltf/pbr',
            uniforms: { _BaseColorFactor: [0.8, 0.8, 0.8, 1], _MetallicFactor: 0 },
            surface: {
                shadingModel: 'pbr',
                alphaMode: 'opaque',
                roughness: 0.5,
                metallic: 0,
            },
        };

        const handle1 = registry.create(def1);
        const warnSpy = vi.spyOn(console, 'warn');

        const handle2 = registry.create(def2);

        expect(handle2).toEqual(handle1);
        expect(warnSpy).not.toHaveBeenCalled();
        expect(registry.size).toBe(1);

        warnSpy.mockRestore();
    });

    it('overwrites with warning when definition differs', () => {
        const registry = new SceneMaterialRegistry();

        const def1 = createPbrDefinition({
            uniforms: { _BaseColorFactor: [1, 0, 0, 1], _RoughnessFactor: 0.5 },
        });
        const def2 = createPbrDefinition({
            uniforms: { _BaseColorFactor: [0, 1, 0, 1], _RoughnessFactor: 0.5 },
        });

        registry.create(def1);
        const warnSpy = vi.spyOn(console, 'warn');

        registry.create(def2);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
            expect.stringContaining("Material 'test-material' is already registered")
        );
        expect(registry.size).toBe(1);

        // Verify the new definition took effect
        const resource = registry.get('test-material');
        expect(resource!.uniforms.get('_BaseColorFactor')).toEqual([0, 1, 0, 1]);

        warnSpy.mockRestore();
    });

    it('overwrites with warning when shaderId differs', () => {
        const registry = new SceneMaterialRegistry();

        const def1 = createPbrDefinition({ shaderId: 'gltf/pbr' });
        const def2 = createPbrDefinition({ shaderId: 'gltf/unlit' });

        registry.create(def1);
        const warnSpy = vi.spyOn(console, 'warn');

        registry.create(def2);

        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(registry.get('test-material')!.shaderId).toBe('gltf/unlit');

        warnSpy.mockRestore();
    });

    it('identical re-create with surface maps is silent despite the texture bridge', () => {
        const registry = new SceneMaterialRegistry();

        const def: SceneMaterialDefinition = {
            id: 'surface-mat',
            shaderId: 'gltf/pbr',
            surface: {
                albedoMap: { textureId: 'tex_albedo' },
                normalMap: { textureId: 'tex_normal', texCoord: 1 },
            },
        };

        registry.create(def);
        const warnSpy = vi.spyOn(console, 'warn');

        const handle2 = registry.create({
            id: 'surface-mat',
            shaderId: 'gltf/pbr',
            surface: {
                albedoMap: { textureId: 'tex_albedo' },
                normalMap: { textureId: 'tex_normal', texCoord: 1 },
            },
        });

        expect(warnSpy).not.toHaveBeenCalled();
        expect(handle2.id).toBe('surface-mat');
        expect(registry.size).toBe(1);

        warnSpy.mockRestore();
    });

    it('identical re-create with textures is silent', () => {
        const registry = new SceneMaterialRegistry();

        const def: SceneMaterialDefinition = {
            id: 'textured-mat',
            shaderId: 'gltf/pbr',
            textures: {
                _BaseColorTexture: 'tex_albedo',
            },
        };

        registry.create(def);
        const warnSpy = vi.spyOn(console, 'warn');

        const handle2 = registry.create(def);

        expect(warnSpy).not.toHaveBeenCalled();
        expect(handle2.id).toBe('textured-mat');
        expect(registry.size).toBe(1);

        warnSpy.mockRestore();
    });
});
