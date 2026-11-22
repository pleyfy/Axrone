import type { SceneShaderResource } from './shader-registry';
import type { SceneUniformWriteTarget } from './uniform-writer';

export interface SceneSkinningUniformSource {
    readonly skinJointCount: number;
    getSkinJointMatrixPalette(): Float32Array | null;
}

/**
 * Writes the skinning palette into a shader. The joint count is clamped to the
 * uniform array the program actually declares, so a rig with more joints than
 * the shader budget can hold never overflows the uniform array or reads past it.
 */
export class SceneSkinningUniformBinder {
    private readonly _jointArraySizes = new Map<WebGLProgram, number>();

    constructor(
        private readonly _writer: SceneUniformWriteTarget,
        private readonly _gl?: WebGL2RenderingContext
    ) {}

    apply(shader: SceneShaderResource, renderer: SceneSkinningUniformSource): void {
        const palette = renderer.getSkinJointMatrixPalette();
        const rawJointCount = palette ? renderer.skinJointCount : 0;
        const maxJoints = this._resolveMaxJoints(shader);
        const jointCount = Math.max(0, Math.min(rawJointCount, maxJoints));

        this._writer.write(shader, 'u_Skinning', Boolean(palette && jointCount > 0));
        this._writer.write(shader, 'u_SkinJointCount', jointCount);

        if (palette && jointCount > 0) {
            const limit = jointCount * 16;
            const slice = palette.length > limit ? palette.subarray(0, limit) : palette;
            this._writer.write(shader, 'u_JointMatrices', slice);
        }
    }

    private _resolveMaxJoints(shader: SceneShaderResource): number {
        const gl = this._gl;
        if (!gl) {
            return Number.MAX_SAFE_INTEGER;
        }

        const cached = this._jointArraySizes.get(shader.program);
        if (cached !== undefined) {
            return cached;
        }

        let size = Number.MAX_SAFE_INTEGER;
        const getProgramParameter = gl.getProgramParameter?.bind(gl);
        const getActiveUniform = gl.getActiveUniform?.bind(gl);
        if (!getProgramParameter || !getActiveUniform) {
            this._jointArraySizes.set(shader.program, size);
            return size;
        }

        const uniformCount = getProgramParameter(shader.program, gl.ACTIVE_UNIFORMS) as number;
        for (let index = 0; index < uniformCount; index += 1) {
            const info = getActiveUniform(shader.program, index);
            if (!info) {
                continue;
            }
            const name = info.name.endsWith('[0]') ? info.name.slice(0, -3) : info.name;
            if (name === 'u_JointMatrices') {
                size = info.size;
                break;
            }
        }

        this._jointArraySizes.set(shader.program, size);
        return size;
    }
}
