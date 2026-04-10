import { Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { SceneResourceRuntime } from '@axrone/scene-3d';
import type { SceneMeshResource } from '@axrone/scene-3d';
import type { SceneSamplerResource } from '@axrone/scene-3d';
import type { SceneShaderResource } from '@axrone/scene-3d';
import type { SceneTextureResource } from '@axrone/scene-3d';

const createDefaultSampler = () =>
    ({
        nativeHandle: { id: 'default-sampler' } as WebGLSampler,
        isDisposed: false,
        bind: () => {},
        dispose: () => {},
    }) as any;

const createShaderResource = (id: string): SceneShaderResource =>
    ({
        id,
        program: { id } as WebGLProgram,
        uniformLocations: new Map(),
        uniformTypes: new Map(),
        uniformNames: [],
        attributeNames: {
            position: 'a_Position',
            normal: 'a_Normal',
            uv0: 'a_UV0',
            uv1: 'a_UV1',
            tangent: 'a_Tangent',
            color0: 'a_Color0',
            joints0: 'a_Joints0',
            weights0: 'a_Weights0',
        },
        depthTest: true,
        cull: true,
        blend: false,
    }) as const;

const createMeshResource = (id: string): SceneMeshResource => ({
    id,
    vertexArray: { id } as unknown as WebGLVertexArrayObject,
    vertexBuffer: { id: `${id}/vb` } as unknown as WebGLBuffer,
    indexBuffer: null,
    vertexCount: 3,
    indexCount: 0,
    indexType: null,
    topology: 'triangles',
    mode: 4,
    attributes: new Set(['position']),
});

const createSamplerResource = (id: string): SceneSamplerResource => ({
    id,
    sampler: {
        nativeHandle: { id } as WebGLSampler,
        isDisposed: false,
        bind: () => {},
        dispose: () => {},
    } as any,
});

const createTextureResource = (id: string): SceneTextureResource => ({
    id,
    texture: {
        nativeHandle: { id } as WebGLTexture,
        isDisposed: false,
        bind: () => {},
        dispose: () => {},
    } as any,
    width: 4,
    height: 4,
    samplerId: 'linear',
});

describe('SceneResourceRuntime', () => {
    it('serializes resource definitions and resolves material texture bindings', () => {
        const runtime = new SceneResourceRuntime({
            defaultPassId: 'main',
            defaultClearColor: new Vec4(0, 0, 0, 1),
            defaultSampler: createDefaultSampler(),
        });

        runtime.shaders.register(
            {
                id: 'shader/basic',
                vertexSource: 'void main() {}',
                fragmentSource: 'void main() {}',
            },
            createShaderResource('shader/basic')
        );
        runtime.meshes.register(
            {
                id: 'mesh/triangle',
                vertices: new Float32Array([0, 0, 0]),
                attributes: [
                    { semantic: 'position', componentCount: 3, offset: 0, stride: 12 },
                ],
                vertexCount: 1,
            },
            createMeshResource('mesh/triangle')
        );
        runtime.samplers.register({ id: 'linear' }, createSamplerResource('linear'));
        runtime.textures.register(
            {
                id: 'tex/checker',
                source: { kind: 'checker', size: 4 },
                samplerId: 'linear',
            },
            createTextureResource('tex/checker')
        );
        runtime.materials.create({
            id: 'mat/basic',
            shaderId: 'shader/basic',
            textures: {
                u_MainTex: 'tex/checker',
            },
        });
        runtime.renderPasses.register({ id: 'main' });

        const serialized = runtime.serializeDefinitions();
        const bindings = runtime.getMaterialTextureBindings('mat/basic');
        const textureHandle = runtime.getTextureResourceHandle('tex/checker');

        expect(serialized.shaders).toHaveLength(1);
        expect(serialized.meshes).toHaveLength(1);
        expect(serialized.materials).toHaveLength(1);
        expect(serialized.textures).toHaveLength(1);
        expect(serialized.samplers).toHaveLength(1);
        expect(serialized.renderPasses).toHaveLength(1);
        expect(bindings).toEqual([
            expect.objectContaining({
                materialId: 'mat/basic',
                uniformName: 'u_MainTex',
                textureId: 'tex/checker',
                samplerId: 'linear',
                unit: 0,
            }),
        ]);
        expect(textureHandle?.nativeSampler).toEqual({ id: 'linear' });
    });

    it('clears runtime-owned registries through disposal callbacks', () => {
        const runtime = new SceneResourceRuntime({
            defaultPassId: 'main',
            defaultClearColor: new Vec4(0, 0, 0, 1),
            defaultSampler: createDefaultSampler(),
        });

        runtime.shaders.register(
            {
                id: 'shader/basic',
                vertexSource: 'void main() {}',
                fragmentSource: 'void main() {}',
            },
            createShaderResource('shader/basic')
        );
        runtime.meshes.register(
            {
                id: 'mesh/triangle',
                vertices: new Float32Array([0, 0, 0]),
                attributes: [
                    { semantic: 'position', componentCount: 3, offset: 0, stride: 12 },
                ],
                vertexCount: 1,
            },
            createMeshResource('mesh/triangle')
        );
        runtime.samplers.register({ id: 'linear' }, createSamplerResource('linear'));
        runtime.textures.register(
            {
                id: 'tex/checker',
                source: { kind: 'checker', size: 4 },
            },
            createTextureResource('tex/checker')
        );
        runtime.materials.create({
            id: 'mat/basic',
            shaderId: 'shader/basic',
        });
        runtime.renderPasses.register({ id: 'main' });

        const deleteProgram = vi.fn();
        const disposeMesh = vi.fn();
        const disposeSampler = vi.fn();
        const disposeTexture = vi.fn();

        runtime.clear({
            deleteProgram,
            disposeMesh,
            disposeSampler,
            disposeTexture,
        });

        expect(deleteProgram).toHaveBeenCalledTimes(1);
        expect(disposeMesh).toHaveBeenCalledTimes(1);
        expect(disposeSampler).toHaveBeenCalledTimes(1);
        expect(disposeTexture).toHaveBeenCalledTimes(1);
        expect(runtime.serializeDefinitions().shaders).toEqual([]);
        expect(runtime.serializeDefinitions().renderPasses).toEqual([]);
    });
});
