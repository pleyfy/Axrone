import type { SceneShaderResource } from './shader-registry';
import type { SceneUniformWriteTarget } from './uniform-writer';

export interface SceneSkinningUniformSource {
    readonly skinJointCount: number;
    getSkinJointMatrixPalette(): Float32Array | null;
}

export class SceneSkinningUniformBinder {
    constructor(private readonly _writer: SceneUniformWriteTarget) {}

    apply(shader: SceneShaderResource, renderer: SceneSkinningUniformSource): void {
        const palette = renderer.getSkinJointMatrixPalette();
        const jointCount = palette ? renderer.skinJointCount : 0;

        this._writer.write(shader, 'u_Skinning', Boolean(palette && jointCount > 0));
        this._writer.write(shader, 'u_SkinJointCount', jointCount);

        if (palette) {
            this._writer.write(shader, 'u_JointMatrices', palette);
        }
    }
}
