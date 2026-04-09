import { Mat4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import type { SceneShaderResource } from '../../scene/shader-registry';
import { SceneUniformWriter } from '../../scene/uniform-writer';

const createShader = (
    entries: readonly [string, WebGLUniformLocation, number | undefined][]
): SceneShaderResource =>
    ({
        id: 'shader',
        program: {} as WebGLProgram,
        uniformLocations: new Map(entries.map(([name, location]) => [name, location] as const)),
        uniformTypes: new Map(entries.map(([name, , type]) => [name, type] as const)),
        uniformNames: entries.map(([name]) => name),
        attributeNames: {},
        depthTest: true,
        cull: true,
        blend: false,
    }) as SceneShaderResource;

describe('SceneUniformWriter', () => {
    it('reuses scratch buffers for matrix and matrix array uploads', () => {
        const gl = {
            FLOAT_MAT4: 1,
            uniformMatrix4fv: vi.fn(),
        } as unknown as WebGL2RenderingContext;
        const writer = new SceneUniformWriter(gl);
        const modelLocation = {} as WebGLUniformLocation;
        const jointsLocation = {} as WebGLUniformLocation;
        const shader = createShader([
            ['u_Model', modelLocation, 1],
            ['u_Joints', jointsLocation, 1],
        ]);

        const model = new Mat4([
            1, 2, 3, 4,
            5, 6, 7, 8,
            9, 10, 11, 12,
            13, 14, 15, 16,
        ]);
        const palette = new Float32Array([
            1, 2, 3, 4,
            5, 6, 7, 8,
            9, 10, 11, 12,
            13, 14, 15, 16,
            17, 18, 19, 20,
            21, 22, 23, 24,
            25, 26, 27, 28,
            29, 30, 31, 32,
        ]);

        writer.write(shader, 'u_Model', model);
        writer.write(shader, 'u_Model', model);
        writer.write(shader, 'u_Joints', palette);
        writer.write(shader, 'u_Joints', palette);

        const firstModelUpload = gl.uniformMatrix4fv.mock.calls[0]?.[2] as Float32Array;
        const secondModelUpload = gl.uniformMatrix4fv.mock.calls[1]?.[2] as Float32Array;
        const firstPaletteUpload = gl.uniformMatrix4fv.mock.calls[2]?.[2] as Float32Array;
        const secondPaletteUpload = gl.uniformMatrix4fv.mock.calls[3]?.[2] as Float32Array;

        expect(secondModelUpload).toBe(firstModelUpload);
        expect([...firstModelUpload]).toEqual([
            1, 5, 9, 13,
            2, 6, 10, 14,
            3, 7, 11, 15,
            4, 8, 12, 16,
        ]);

        expect(secondPaletteUpload).toBe(firstPaletteUpload);
        expect([...firstPaletteUpload]).toEqual([
            1, 5, 9, 13,
            2, 6, 10, 14,
            3, 7, 11, 15,
            4, 8, 12, 16,
            17, 21, 25, 29,
            18, 22, 26, 30,
            19, 23, 27, 31,
            20, 24, 28, 32,
        ]);
    });

    it('reuses float array scratch for generic number arrays', () => {
        const gl = {
            uniform1fv: vi.fn(),
        } as unknown as WebGL2RenderingContext;
        const writer = new SceneUniformWriter(gl);
        const weightsLocation = {} as WebGLUniformLocation;
        const shader = createShader([['u_Weights', weightsLocation, undefined]]);
        const weights = [0.125, 0.25, 0.5, 0.75, 1];

        writer.write(shader, 'u_Weights', weights);
        writer.write(shader, 'u_Weights', weights);

        const firstUpload = gl.uniform1fv.mock.calls[0]?.[1] as Float32Array;
        const secondUpload = gl.uniform1fv.mock.calls[1]?.[1] as Float32Array;

        expect(secondUpload).toBe(firstUpload);
        expect([...firstUpload]).toEqual(weights);
    });
});
