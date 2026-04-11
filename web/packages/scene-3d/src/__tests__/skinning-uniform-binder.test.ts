import { describe, expect, it, vi } from 'vitest';
import type { SceneShaderResource } from '@axrone/scene-3d';
import { SceneSkinningUniformBinder } from '@axrone/scene-3d';
import type { SceneUniformWriteTarget } from '@axrone/scene-3d';

describe('SceneSkinningUniformBinder', () => {
    it('writes skinning flags and palette only when a valid palette is available', () => {
        const writer = {
            write: vi.fn(),
        } as unknown as SceneUniformWriteTarget;
        const binder = new SceneSkinningUniformBinder(writer);
        const shader = {} as SceneShaderResource;
        const palette = new Float32Array(16);

        binder.apply(shader, {
            skinJointCount: 1,
            getSkinJointMatrixPalette: () => palette,
        });

        expect(writer.write).toHaveBeenNthCalledWith(1, shader, 'u_Skinning', true);
        expect(writer.write).toHaveBeenNthCalledWith(2, shader, 'u_SkinJointCount', 1);
        expect(writer.write).toHaveBeenNthCalledWith(3, shader, 'u_JointMatrices', palette);

        writer.write.mockClear();

        binder.apply(shader, {
            skinJointCount: 3,
            getSkinJointMatrixPalette: () => null,
        });

        expect(writer.write).toHaveBeenNthCalledWith(1, shader, 'u_Skinning', false);
        expect(writer.write).toHaveBeenNthCalledWith(2, shader, 'u_SkinJointCount', 0);
        expect(writer.write).toHaveBeenCalledTimes(2);
    });
});
