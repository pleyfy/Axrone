import { describe, expect, it } from 'vitest';
import { SceneRuntimeKernel } from '@axrone/scene-3d';
import { ManualScheduler, createSceneOptions } from './test-harness';

describe('SceneRuntimeKernel', () => {
    it('builds scene runtime services and initializes a default render pass', () => {
        const scheduler = new ManualScheduler();
        const canvas = document.createElement('canvas');
        const kernel = new SceneRuntimeKernel({
            sceneId: 'scene-kernel',
            options: createSceneOptions(scheduler, canvas),
        });

        expect(kernel.canvas).toBe(canvas);
        expect(kernel.gl.canvas).toBe(canvas);
        expect(kernel.assets.getRenderPasses()).toHaveLength(1);
        expect(kernel.assets.getRenderPass('main')?.rendererPassId).toBe('main');
        expect(canvas.width).toBe(640);
        expect(canvas.height).toBe(360);
    });

    it('preserves explicitly configured render passes without restoring defaults', () => {
        const scheduler = new ManualScheduler();
        const canvas = document.createElement('canvas');
        const kernel = new SceneRuntimeKernel({
            sceneId: 'scene-kernel',
            options: {
                ...createSceneOptions(scheduler, canvas),
                renderPasses: [
                    {
                        id: 'shadow',
                        order: 1,
                        rendererPassId: 'shadow',
                        clearFlags: ['depth'],
                    },
                ],
            },
        });

        expect(kernel.assets.getRenderPasses()).toHaveLength(1);
        expect(kernel.assets.getRenderPass('shadow')?.rendererPassId).toBe('shadow');
        expect(kernel.assets.getRenderPass('main')).toBeNull();
    });
});
