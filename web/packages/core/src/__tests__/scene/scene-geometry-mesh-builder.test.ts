import { describe, expect, it } from 'vitest';
import { createPlane } from '../../geometry/primitives';
import { SceneGeometryMeshBuilder } from '../../scene/scene-geometry-mesh-builder';

describe('SceneGeometryMeshBuilder', () => {
    it('builds scene mesh definitions from geometry buffers without temporary index arrays', () => {
        const builder = new SceneGeometryMeshBuilder();
        const definition = builder.createDefinition(
            'plane',
            createPlane({
                width: 1,
                height: 1,
                generateNormals: true,
                generateTexCoords: true,
                generateTangents: false,
            })
        );

        expect(definition.id).toBe('plane');
        expect(definition.vertexCount).toBeGreaterThan(0);
        expect(definition.vertices).toBeInstanceOf(Float32Array);
        expect(definition.indices).toBeInstanceOf(Uint16Array);
        expect(definition.attributes.map((attribute) => attribute.semantic)).toEqual([
            'position',
            'normal',
            'uv0',
        ]);
    });
});
