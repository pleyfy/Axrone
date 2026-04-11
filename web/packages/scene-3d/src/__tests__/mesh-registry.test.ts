import { describe, expect, it } from 'vitest';
import {
    cloneSceneMeshDefinition,
    SceneMeshRegistry,
    type SceneMeshResource,
} from '@axrone/scene-3d';

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

describe('SceneMeshRegistry', () => {
    it('stores mesh resources and returns handles', () => {
        const registry = new SceneMeshRegistry();
        const handle = registry.register(
            {
                id: 'triangle',
                vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
                attributes: [
                    {
                        semantic: 'position',
                        componentCount: 3,
                        offset: 0,
                        stride: 12,
                    },
                ],
                vertexCount: 3,
            },
            createMeshResource('triangle')
        ).handle;

        expect(handle).toEqual({
            id: 'triangle',
            vertexCount: 3,
            indexCount: 0,
            topology: 'triangles',
        });
    });

    it('returns replaced resources and cloned definitions', () => {
        const registry = new SceneMeshRegistry();
        const first = createMeshResource('triangle');
        const second = createMeshResource('triangle');
        const definition = {
            id: 'triangle',
            vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            attributes: [
                {
                    semantic: 'position' as const,
                    componentCount: 3 as const,
                    offset: 0,
                    stride: 12,
                },
            ],
            vertexCount: 3,
        };

        registry.register(definition, first);
        definition.attributes[0]!.stride = 24;
        const result = registry.register(
            {
                ...definition,
                vertices: new Float32Array([0, 0, 0]),
            },
            second
        );

        const cloned = cloneSceneMeshDefinition(definition);

        expect(result.previous).toBe(first);
        expect(registry.get('triangle')).toBe(second);
        expect(registry.getDefinition('triangle')?.attributes[0]?.stride).toBe(24);
        expect(cloned.attributes[0]?.stride).toBe(24);

        const cleared = registry.clear();
        expect(cleared).toHaveLength(1);
        expect(registry.getDefinitions()).toEqual([]);
    });
});
