import { Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { SceneLifecycleError } from '@axrone/scene-3d';
import { SceneSnapshotLoader } from '@axrone/scene-3d';

describe('SceneSnapshotLoader', () => {
    it('loads scene assets in deterministic order and restores a fallback pass when needed', async () => {
        const calls: string[] = [];
        const actors = [{ id: 'actor-1' }] as any;
        const loader = new SceneSnapshotLoader({
            defaultRenderPassId: 'main',
            defaultClearColor: new Vec4(0.1, 0.2, 0.3, 1),
            clearExisting: () => {
                calls.push('clear-existing');
            },
            clearRenderPasses: () => {
                calls.push('clear-render-passes');
            },
            registerShader: (shader) => {
                calls.push(`shader:${shader.id}`);
            },
            registerMesh: (mesh) => {
                calls.push(`mesh:${mesh.id}`);
            },
            registerSampler: (sampler) => {
                calls.push(`sampler:${sampler.id}`);
            },
            registerTexture: async (texture) => {
                calls.push(`texture:${texture.id}`);
            },
            registerRenderPass: (renderPass) => {
                calls.push(`render-pass:${renderPass.id}`);
            },
            createMaterial: (material) => {
                calls.push(`material:${material.id}`);
            },
            instantiatePrefab: () => actors,
        });

        const restoredActors = await loader.load({
            version: 1,
            prefab: { id: 'prefab', actors: [] },
            shaders: [{ id: 'shader', vertexSource: '', fragmentSource: '' }],
            meshes: [{ id: 'mesh', vertices: new Float32Array(), attributes: [] as any }],
            samplers: [{ id: 'sampler' }],
            textures: [{ id: 'texture', source: { kind: 'color', color: [1, 1, 1, 1] } }],
            renderPasses: [],
            materials: [{ id: 'material', shaderId: 'shader' }],
        } as any);

        expect(restoredActors).toBe(actors);
        expect(calls).toEqual([
            'clear-existing',
            'shader:shader',
            'mesh:mesh',
            'sampler:sampler',
            'texture:texture',
            'clear-render-passes',
            'render-pass:main',
            'material:material',
        ]);
    });

    it('rejects unsupported snapshot versions', async () => {
        const loader = new SceneSnapshotLoader({
            defaultRenderPassId: 'main',
            defaultClearColor: new Vec4(0, 0, 0, 1),
            clearExisting: vi.fn(),
            clearRenderPasses: vi.fn(),
            registerShader: vi.fn(),
            registerMesh: vi.fn(),
            registerSampler: vi.fn(),
            registerTexture: vi.fn(async () => {}),
            registerRenderPass: vi.fn(),
            createMaterial: vi.fn(),
            instantiatePrefab: vi.fn(() => []),
        });

        await expect(
            loader.load({
                version: 2,
                prefab: { id: 'prefab', actors: [] },
                shaders: [],
                meshes: [],
                samplers: [],
                textures: [],
                renderPasses: [],
                materials: [],
            } as any)
        ).rejects.toThrowError(SceneLifecycleError);
    });
});
