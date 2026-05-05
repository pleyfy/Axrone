import { Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { SceneAssetRuntime } from '@axrone/scene-3d';
import { createMockGL } from './test-harness';

describe('SceneAssetRuntime', () => {
    it('releases base mesh caches before replacing a mesh definition', () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas);
        const releaseBaseMesh = vi.fn();
        const runtime = new SceneAssetRuntime({
            gl,
            defaultPassId: 'main',
            defaultClearColor: new Vec4(0.1, 0.2, 0.3, 1),
            releaseBaseMesh,
            clearRenderRuntime: vi.fn(),
        });

        runtime.registerMesh({
            id: 'mesh',
            vertices: new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]),
            indices: new Uint16Array([0, 1, 2]),
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride: 12,
                },
            ],
        });

        expect(releaseBaseMesh).toHaveBeenCalledWith('mesh');
        expect(runtime.resources.meshes.getDefinition('mesh')?.bounds?.kind).toBe('sphere');
        expect(runtime.resources.meshes.getDefinition('mesh')?.bounds?.radius).toBeGreaterThan(0.7);
    });

    it('clears runtime-owned GPU resources and render passes through one boundary', async () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas);
        const clearRenderRuntime = vi.fn();
        const runtime = new SceneAssetRuntime({
            gl,
            defaultPassId: 'main',
            defaultClearColor: new Vec4(0.1, 0.2, 0.3, 1),
            releaseBaseMesh: vi.fn(),
            clearRenderRuntime,
        });

        runtime.registerShader({
            id: 'shader',
            vertexSource: 'void main() { gl_Position = vec4(0.0); }',
            fragmentSource: 'precision highp float; out vec4 o_Color; void main() { o_Color = vec4(1.0); }',
        });
        runtime.registerMesh({
            id: 'mesh',
            vertices: new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]),
            indices: new Uint16Array([0, 1, 2]),
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride: 12,
                },
            ],
        });
        runtime.registerSampler({ id: 'sampler' });
        await runtime.registerTexture({
            id: 'texture',
            source: {
                kind: 'color',
                color: [1, 1, 1, 1],
            },
        });
        runtime.registerRenderPass({ id: 'main' });

        runtime.clear();

        expect(clearRenderRuntime).toHaveBeenCalledTimes(1);
        expect(runtime.getShader('shader')).toBeNull();
        expect(runtime.getMesh('mesh')).toBeNull();
        expect(runtime.getSampler('sampler')).toBeNull();
        expect(runtime.getTexture('texture')).toBeNull();
        expect(runtime.getRenderPasses()).toHaveLength(0);
    });

    it('registers built-in primitive mesh helpers beyond box plane and sphere', () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas);
        const runtime = new SceneAssetRuntime({
            gl,
            defaultPassId: 'main',
            defaultClearColor: new Vec4(0.1, 0.2, 0.3, 1),
            releaseBaseMesh: vi.fn(),
            clearRenderRuntime: vi.fn(),
        });

        runtime.createCapsuleMesh('capsule');
        runtime.createConeMesh('cone');
        runtime.createCylinderMesh('cylinder');
        runtime.createQuadMesh('quad');
        runtime.createTorusMesh('torus');

        expect(runtime.getMesh('capsule')).not.toBeNull();
        expect(runtime.getMesh('cone')).not.toBeNull();
        expect(runtime.getMesh('cylinder')).not.toBeNull();
        expect(runtime.getMesh('quad')).not.toBeNull();
        expect(runtime.getMesh('torus')).not.toBeNull();
    });
});
