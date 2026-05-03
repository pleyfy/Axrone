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
            STENCIL_TEST: 4,
            FRONT: 5,
            BACK: 6,
            NONE: 0,
            CCW: 7,
            CW: 8,
            LESS: 9,
            ALWAYS: 10,
            KEEP: 11,
            SRC_ALPHA: 12,
            ONE_MINUS_SRC_ALPHA: 13,
            ONE: 14,
            FUNC_ADD: 15,
            enable: vi.fn(),
            disable: vi.fn(),
            frontFace: vi.fn(),
            cullFace: vi.fn(),
            blendEquationSeparate: vi.fn(),
            blendFuncSeparate: vi.fn(),
            blendColor: vi.fn(),
            colorMask: vi.fn(),
            depthMask: vi.fn(),
            depthFunc: vi.fn(),
            stencilFuncSeparate: vi.fn(),
            stencilMaskSeparate: vi.fn(),
            stencilOpSeparate: vi.fn(),
            lineWidth: vi.fn(),
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
        expect(gl.disable).toHaveBeenCalledTimes(2);
        expect(gl.disable).toHaveBeenNthCalledWith(1, 3);
        expect(gl.disable).toHaveBeenNthCalledWith(2, 4);
        expect(gl.frontFace).toHaveBeenCalledTimes(1);
        expect(gl.cullFace).toHaveBeenCalledTimes(1);
        expect(gl.depthMask).toHaveBeenCalledTimes(1);
        expect(gl.depthFunc).toHaveBeenCalledTimes(1);
        expect(gl.colorMask).toHaveBeenCalledTimes(1);
        expect(gl.lineWidth).toHaveBeenCalledTimes(1);

        applier.apply(
            {
                depthTest: false,
                cull: false,
                blend: true,
            } as SceneShaderResource,
            renderPass
        );

        expect(gl.disable).toHaveBeenCalledTimes(4);
        expect(gl.disable).toHaveBeenNthCalledWith(3, 1);
        expect(gl.disable).toHaveBeenNthCalledWith(4, 2);
        expect(gl.enable).toHaveBeenCalledTimes(3);
        expect(gl.enable).toHaveBeenNthCalledWith(3, 3);
        expect(gl.blendFuncSeparate).toHaveBeenCalledTimes(1);
        expect(gl.blendEquationSeparate).toHaveBeenCalledTimes(1);
        expect(gl.blendColor).toHaveBeenCalledTimes(1);
    });
});
