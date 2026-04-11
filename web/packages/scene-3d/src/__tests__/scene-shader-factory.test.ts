import { describe, expect, it, vi } from 'vitest';
import { SceneShaderFactory } from '@axrone/scene-3d';
import { SceneShaderError } from '@axrone/scene-3d';
import { createMockGL } from './test-harness';

describe('SceneShaderFactory', () => {
    it('creates linked shader resources with inferred uniforms and attribute bindings', () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas) as ReturnType<typeof createMockGL> & {
            ACTIVE_UNIFORMS: number;
            getActiveUniform: ReturnType<typeof vi.fn>;
        };
        gl.ACTIVE_UNIFORMS = 2;
        gl.getProgramParameter = vi.fn((_: unknown, parameter: number) =>
            parameter === gl.ACTIVE_UNIFORMS ? 2 : true
        ) as any;
        gl.getActiveUniform = vi
            .fn()
            .mockReturnValueOnce({ name: 'u_Model', type: gl.FLOAT_MAT4 })
            .mockReturnValueOnce({ name: 'u_Color', type: gl.FLOAT_VEC4 });

        const factory = new SceneShaderFactory({ gl: gl as any });
        const resource = factory.create({
            id: 'shader',
            vertexSource: `
                uniform mat4 u_Model;
                in vec3 a_Position;
                void main() { gl_Position = u_Model * vec4(a_Position, 1.0); }
            `,
            fragmentSource: `
                precision highp float;
                uniform vec4 u_Color;
                out vec4 o_Color;
                void main() { o_Color = u_Color; }
            `,
        });

        expect(gl.bindAttribLocation).toHaveBeenCalledWith(
            resource.program,
            0,
            'a_Position'
        );
        expect(resource.uniformNames).toEqual(['u_Model', 'u_Color']);
        expect(resource.uniformTypes.get('u_Model')).toBe(gl.FLOAT_MAT4);
        expect(resource.uniformTypes.get('u_Color')).toBe(gl.FLOAT_VEC4);

        factory.delete(resource);
        expect(gl.deleteProgram).toHaveBeenCalledWith(resource.program);
    });

    it('throws when shader compilation fails', () => {
        const canvas = document.createElement('canvas');
        const gl = createMockGL(canvas) as ReturnType<typeof createMockGL>;
        gl.getShaderParameter = vi.fn(() => false) as any;
        gl.getShaderInfoLog = vi.fn(() => 'compile failed') as any;

        const factory = new SceneShaderFactory({ gl: gl as any });

        expect(() =>
            factory.create({
                id: 'broken',
                vertexSource: 'void main() {}',
                fragmentSource: 'void main() {}',
            })
        ).toThrowError(SceneShaderError);
    });
});
