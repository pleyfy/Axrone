import { Vec3, Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import type { SceneRenderPassResource } from '../../scene/render-pass-registry';
import { SceneRenderRuntime } from '../../scene/scene-render-runtime';
import { createMockGL } from './test-harness';

const createRenderRuntime = (renderPasses: readonly SceneRenderPassResource[]) => {
    const canvas = document.createElement('canvas');
    const gl = createMockGL(canvas);

    const runtime = new SceneRenderRuntime({
        gl,
        resources: {
            renderPasses: {
                getEnabledResources: () => renderPasses,
            },
        } as any,
        ambientLight: new Vec3(0.05, 0.06, 0.07),
        defaultClearColor: new Vec4(0.1, 0.2, 0.3, 1),
        getActors: () => [],
        createMeshResource: vi.fn(),
        disposeMesh: vi.fn(),
        applyMissingVertexAttributeDefaults: vi.fn(),
    });

    return { gl, runtime };
};

describe('SceneRenderRuntime', () => {
    it('records the current frame even when no render passes are enabled', () => {
        const { gl, runtime } = createRenderRuntime([]);

        runtime.render({
            frame: 12,
            elapsedSeconds: 1.25,
            deltaSeconds: 0.016,
            viewportWidth: 640,
            viewportHeight: 360,
        });

        expect(runtime.stats).toEqual({
            frame: 12,
            drawCalls: 0,
            trianglesSubmitted: 0,
        });
        expect(gl.viewport).not.toHaveBeenCalled();
    });

    it('prepares enabled passes without issuing draws when no camera is active', () => {
        const { gl, runtime } = createRenderRuntime([
            {
                id: 'main',
                order: 0,
                rendererPassId: 'main',
                enabled: true,
                clearFlags: ['color', 'depth'],
                clearColor: null,
                clearDepth: null,
            },
        ]);

        runtime.render({
            frame: 18,
            elapsedSeconds: 2.5,
            deltaSeconds: 0.033,
            viewportWidth: 1280,
            viewportHeight: 720,
        });

        expect(gl.viewport).toHaveBeenCalledWith(0, 0, 1280, 720);
        expect(gl.clearColor).toHaveBeenCalledWith(0.1, 0.2, 0.3, 1);
        expect(gl.clearDepth).toHaveBeenCalledWith(1);
        expect(gl.clear).toHaveBeenCalledWith(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        expect(gl.bindVertexArray).toHaveBeenCalledWith(null);
        expect(runtime.stats).toEqual({
            frame: 18,
            drawCalls: 0,
            trianglesSubmitted: 0,
        });
    });
});
