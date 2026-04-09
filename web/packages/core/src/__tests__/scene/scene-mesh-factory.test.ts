import { describe, expect, it } from 'vitest';
import { SceneMeshFactory } from '../../scene/scene-mesh-factory';
import { createMockGL } from './test-harness';

describe('SceneMeshFactory', () => {
    it('creates indexed mesh resources and disposes them cleanly', () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas);
        const factory = new SceneMeshFactory({ gl });

        const mesh = factory.create({
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

        expect(mesh.vertexCount).toBe(3);
        expect(mesh.indexCount).toBe(3);
        expect(mesh.indexType).toBe(gl.UNSIGNED_SHORT);
        expect(gl.enableVertexAttribArray).toHaveBeenCalledWith(0);

        factory.dispose(mesh);
        expect(gl.deleteBuffer).toHaveBeenCalledWith(mesh.vertexBuffer);
        expect(gl.deleteBuffer).toHaveBeenCalledWith(mesh.indexBuffer);
        expect(gl.deleteVertexArray).toHaveBeenCalledWith(mesh.vertexArray);
    });

    it('binds zeroed joint defaults only when the mesh omits joints0', () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas);
        const factory = new SceneMeshFactory({ gl });

        factory.applyMissingVertexAttributeDefaults({
            attributes: new Set(['position']),
        } as any);
        expect(gl.vertexAttribI4ui).toHaveBeenCalledWith(9, 0, 0, 0, 0);

        (gl.vertexAttribI4ui as any).mockClear();
        factory.applyMissingVertexAttributeDefaults({
            attributes: new Set(['position', 'joints0']),
        } as any);
        expect(gl.vertexAttribI4ui).not.toHaveBeenCalled();
    });
});
