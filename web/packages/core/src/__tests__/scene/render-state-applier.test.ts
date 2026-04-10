import { describe, expect, it, vi } from 'vitest';
import { SceneRenderStateApplier } from '@axrone/scene-3d';
import type { SceneRenderPassResource } from '@axrone/scene-3d';
import type { SceneShaderResource } from '@axrone/scene-3d';

describe('SceneRenderStateApplier', () => {
    it('avoids redundant WebGL state transitions across draw calls', () => {
        const gl = {
            DEPTH_TEST: 1,
            CULL_FACE: 2,
            BLEND: 3,
            CCW: 4,
            BACK: 5,
            SRC_ALPHA: 6,
            ONE_MINUS_SRC_ALPHA: 7,
            enable: vi.fn(),
            disable: vi.fn(),
            frontFace: vi.fn(),
            cullFace: vi.fn(),
            blendFunc: vi.fn(),
            depthMask: vi.fn(),
        } as unknown as WebGL2RenderingContext;

        const applier = new SceneRenderStateApplier(gl);
        const shader = {
            depthTest: true,
            cull: true,
            blend: false,
        } as SceneShaderResource;
        const renderPass = {} as SceneRenderPassResource;

        applier.apply(shader, renderPass);
        applier.apply(shader, renderPass);

        expect(gl.enable).toHaveBeenCalledTimes(2);
        expect(gl.enable).toHaveBeenNthCalledWith(1, 1);
        expect(gl.enable).toHaveBeenNthCalledWith(2, 2);
        expect(gl.disable).toHaveBeenCalledTimes(1);
        expect(gl.disable).toHaveBeenNthCalledWith(1, 3);
        expect(gl.frontFace).toHaveBeenCalledTimes(1);
        expect(gl.cullFace).toHaveBeenCalledTimes(1);
        expect(gl.depthMask).toHaveBeenCalledTimes(1);

        applier.apply(
            {
                depthTest: false,
                cull: false,
                blend: true,
            } as SceneShaderResource,
            renderPass
        );

        expect(gl.disable).toHaveBeenCalledTimes(3);
        expect(gl.disable).toHaveBeenNthCalledWith(2, 1);
        expect(gl.disable).toHaveBeenNthCalledWith(3, 2);
        expect(gl.enable).toHaveBeenCalledTimes(3);
        expect(gl.enable).toHaveBeenNthCalledWith(3, 3);
        expect(gl.blendFunc).toHaveBeenCalledTimes(1);
    });
});
