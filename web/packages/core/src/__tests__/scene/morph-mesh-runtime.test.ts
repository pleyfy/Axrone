import { describe, expect, it, vi } from 'vitest';
import type { SceneMeshDefinition } from '../../scene/types';
import type { SceneMeshResource } from '../../scene/mesh-registry';
import { SceneMorphMeshRuntime } from '../../scene/morph-mesh-runtime';

describe('SceneMorphMeshRuntime', () => {
    it('reuses morph mesh resources and avoids redundant buffer uploads for unchanged weights', () => {
        const gl = {
            ARRAY_BUFFER: 1,
            DYNAMIC_DRAW: 2,
            bindBuffer: vi.fn(),
            bufferData: vi.fn(),
        } as unknown as WebGL2RenderingContext;

        const createdResources: SceneMeshResource[] = [];
        const runtime = new SceneMorphMeshRuntime({
            gl,
            createMeshResource: vi.fn((definition: SceneMeshDefinition) => {
                const resource = {
                    id: definition.id,
                    vertexArray: {} as WebGLVertexArrayObject,
                    vertexBuffer: {} as WebGLBuffer,
                    indexBuffer: null,
                    vertexCount: 3,
                    indexCount: 0,
                    indexType: null,
                    topology: 'triangles',
                    mode: 4,
                    attributes: new Set(['position']),
                } satisfies SceneMeshResource;
                createdResources.push(resource);
                return resource;
            }),
            disposeMesh: vi.fn(),
        });

        const baseMesh = {
            id: 'mesh',
            vertexArray: {} as WebGLVertexArrayObject,
            vertexBuffer: {} as WebGLBuffer,
            indexBuffer: null,
            vertexCount: 3,
            indexCount: 0,
            indexType: null,
            topology: 'triangles',
            mode: 4,
            attributes: new Set(['position']),
        } satisfies SceneMeshResource;
        const definition = {
            id: 'mesh',
            vertices: new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]),
            vertexCount: 3,
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride: 12,
                },
            ],
            morphTargets: [
                {
                    attributes: [
                        {
                            semantic: 'position',
                            componentCount: 3,
                            values: new Float32Array([
                                0.5, 0, 0,
                                0, 0.5, 0,
                                0, 0, 0.5,
                            ]),
                        },
                    ],
                },
            ],
        } satisfies SceneMeshDefinition;

        const meshes = {
            get: () => baseMesh,
            getDefinition: () => definition,
        };
        const renderer = {
            id: 'renderer-1',
            meshId: 'mesh',
            morphWeightVersion: 1,
            getMorphWeightArray: () => new Float32Array([0.5]),
        };

        const first = runtime.resolve(renderer as any, meshes);
        const second = runtime.resolve(renderer as any, meshes);

        expect(first).toBe(createdResources[0]);
        expect(second).toBe(first);
        expect(createdResources).toHaveLength(1);
        expect(gl.bufferData).toHaveBeenCalledTimes(1);

        const updated = runtime.resolve(
            {
                ...renderer,
                morphWeightVersion: 2,
                getMorphWeightArray: () => new Float32Array([1]),
            } as any,
            meshes
        );

        expect(updated).toBe(first);
        expect(gl.bufferData).toHaveBeenCalledTimes(2);

        runtime.releaseBaseMesh('mesh');

        expect(runtime.resolve({ ...renderer, getMorphWeightArray: () => new Float32Array([0]) } as any, meshes)).toBe(baseMesh);
    });
});
