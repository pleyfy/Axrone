import { Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { SceneSnapshotRuntime } from '@axrone/scene-3d';

describe('SceneSnapshotRuntime', () => {
    it('restores a default render pass through the snapshot boundary', () => {
        const registerRenderPass = vi.fn();
        const runtime = new SceneSnapshotRuntime({
            sceneId: 'scene-1',
            defaultRenderPassId: 'main',
            defaultClearColor: new Vec4(0.1, 0.2, 0.3, 1),
            actors: {
                createPrefab: vi.fn(() => ({ id: 'prefab', actors: [] })),
                instantiatePrefab: vi.fn(() => []),
                destroyAllActors: vi.fn(),
            },
            assets: {
                clear: vi.fn(),
                clearRenderPasses: vi.fn(),
                registerShader: vi.fn(),
                registerMesh: vi.fn(),
                registerSampler: vi.fn(),
                registerTexture: vi.fn(async () => {}),
                registerRenderPass,
                createMaterial: vi.fn(),
                serializeDefinitions: vi.fn(() => ({
                    shaders: [],
                    meshes: [],
                    materials: [],
                    textures: [],
                    samplers: [],
                    renderPasses: [],
                })),
            },
        });

        runtime.initializeRenderPasses();

        expect(registerRenderPass).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 'main',
                rendererPassId: 'main',
                clearFlags: ['color', 'depth'],
                clearColor: new Vec4(0.1, 0.2, 0.3, 1),
            })
        );
    });

    it('serializes and loads snapshots through actor and asset hosts', async () => {
        const createPrefab = vi.fn(() => ({ id: 'prefab', actors: [] }));
        const instantiatePrefab = vi.fn(() => [{ id: 'actor-1' }]);
        const destroyAllActors = vi.fn();
        const clear = vi.fn();
        const clearRenderPasses = vi.fn();
        const registerShader = vi.fn();
        const registerMesh = vi.fn();
        const registerSampler = vi.fn();
        const registerTexture = vi.fn(async () => {});
        const registerRenderPass = vi.fn();
        const createMaterial = vi.fn();
        const serializeDefinitions = vi.fn(() => ({
            shaders: [{ id: 'shader', vertexSource: '', fragmentSource: '' }],
            meshes: [{ id: 'mesh', vertices: new Float32Array(), attributes: [] as any }],
            materials: [{ id: 'material', shaderId: 'shader' }],
            textures: [{ id: 'texture', source: { kind: 'color', color: [1, 1, 1, 1] } }],
            samplers: [{ id: 'sampler' }],
            renderPasses: [],
        }));
        const runtime = new SceneSnapshotRuntime({
            sceneId: 'scene-1',
            defaultRenderPassId: 'main',
            defaultClearColor: new Vec4(0.1, 0.2, 0.3, 1),
            actors: {
                createPrefab,
                instantiatePrefab,
                destroyAllActors,
            },
            assets: {
                clear,
                clearRenderPasses,
                registerShader,
                registerMesh,
                registerSampler,
                registerTexture,
                registerRenderPass,
                createMaterial,
                serializeDefinitions,
            },
        });

        const snapshot = runtime.serializeScene();
        const restored = await runtime.loadScene(snapshot);

        expect(createPrefab).toHaveBeenCalledWith('scene-1:prefab', undefined);
        expect(restored).toEqual([{ id: 'actor-1' }]);
        expect(destroyAllActors).toHaveBeenCalledTimes(1);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(registerShader).toHaveBeenCalledWith(snapshot.shaders[0]);
        expect(registerMesh).toHaveBeenCalledWith(snapshot.meshes[0]);
        expect(registerSampler).toHaveBeenCalledWith(snapshot.samplers[0]);
        expect(registerTexture).toHaveBeenCalledWith(snapshot.textures[0]);
        expect(clearRenderPasses).toHaveBeenCalledTimes(1);
        expect(registerRenderPass).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'main' })
        );
        expect(createMaterial).toHaveBeenCalledWith(snapshot.materials[0]);
        expect(instantiatePrefab).toHaveBeenCalledWith(snapshot.prefab, {});
    });
});
