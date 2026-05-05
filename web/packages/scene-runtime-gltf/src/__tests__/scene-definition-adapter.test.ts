import { describe, expect, it } from 'vitest';
import type { GltfMeshDefinition } from '@axrone/asset-gltf';
import { adaptGltfMeshDefinitionToScene } from '../scene-definition-adapter';

describe('scene-definition-adapter', () => {
    it('converts glTF mesh min-max bounds into scene bounding spheres', () => {
        const meshDefinition: GltfMeshDefinition = {
            id: 'mesh/source',
            vertices: new Float32Array([
                0, 0, 0,
                1, 0, 0,
                0, 1, 0,
            ]),
            attributes: [
                {
                    semantic: 'position',
                    componentCount: 3,
                    offset: 0,
                    stride: 12,
                },
            ],
            indices: new Uint16Array([0, 1, 2]),
        };

        const adapted = adaptGltfMeshDefinitionToScene(meshDefinition, 'mesh/runtime', {
            min: [0, 0, 0],
            max: [1, 1, 0],
        });

        expect(adapted.id).toBe('mesh/runtime');
        expect(adapted.bounds).toEqual({
            kind: 'sphere',
            center: [0.5, 0.5, 0],
            radius: Math.sqrt(0.5),
        });
    });
});