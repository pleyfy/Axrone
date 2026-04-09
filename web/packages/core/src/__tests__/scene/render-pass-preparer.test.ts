import { Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { SceneRenderPassPreparer } from '../../scene/render-pass-preparer';
import type { SceneRenderPassResource } from '../../scene/render-pass-registry';

describe('SceneRenderPassPreparer', () => {
    it('avoids redundant clear state uploads while still clearing each pass', () => {
        const gl = {
            COLOR_BUFFER_BIT: 1,
            DEPTH_BUFFER_BIT: 2,
            clearColor: vi.fn(),
            clearDepth: vi.fn(),
            clear: vi.fn(),
        } as unknown as WebGL2RenderingContext;

        const defaultClearColor = new Vec4(0.1, 0.2, 0.3, 1);
        const preparer = new SceneRenderPassPreparer(gl, defaultClearColor);
        const renderPass = {
            id: 'main',
            order: 0,
            rendererPassId: 'main',
            enabled: true,
            clearFlags: ['color', 'depth'],
            clearColor: null,
            clearDepth: null,
        } satisfies SceneRenderPassResource;
        const camera = {
            clearColor: defaultClearColor,
            clearDepth: 1,
        } as any;

        preparer.prepare(renderPass, camera);
        preparer.prepare(renderPass, camera);

        expect(gl.clearColor).toHaveBeenCalledTimes(1);
        expect(gl.clearDepth).toHaveBeenCalledTimes(1);
        expect(gl.clear).toHaveBeenCalledTimes(2);
        expect(gl.clear).toHaveBeenNthCalledWith(1, 3);
        expect(gl.clear).toHaveBeenNthCalledWith(2, 3);
    });

    it('prefers pass-specific clear overrides over camera defaults', () => {
        const gl = {
            COLOR_BUFFER_BIT: 1,
            DEPTH_BUFFER_BIT: 2,
            clearColor: vi.fn(),
            clearDepth: vi.fn(),
            clear: vi.fn(),
        } as unknown as WebGL2RenderingContext;

        const preparer = new SceneRenderPassPreparer(gl, new Vec4(0, 0, 0, 1));
        preparer.prepare(
            {
                id: 'custom',
                order: 0,
                rendererPassId: 'custom',
                enabled: true,
                clearFlags: ['color', 'depth'],
                clearColor: new Vec4(0.8, 0.7, 0.6, 1),
                clearDepth: 0.5,
            },
            {
                clearColor: new Vec4(0.1, 0.2, 0.3, 1),
                clearDepth: 1,
            } as any
        );

        expect(gl.clearColor).toHaveBeenCalledWith(0.8, 0.7, 0.6, 1);
        expect(gl.clearDepth).toHaveBeenCalledWith(0.5);
    });
});
