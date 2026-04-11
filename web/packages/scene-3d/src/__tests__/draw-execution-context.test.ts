import { describe, expect, it } from 'vitest';
import { SceneDrawExecutionContextCache } from '@axrone/scene-3d';

describe('SceneDrawExecutionContextCache', () => {
    it('reuses a single draw execution context object across updates', () => {
        const cache = new SceneDrawExecutionContextCache();

        const first = cache.prepare({
            renderPass: { id: 'main' } as any,
            cameraFrame: { camera: { id: 'cam-a' } } as any,
            lighting: { ambient: { x: 1 } } as any,
            elapsedSeconds: 1,
            deltaSeconds: 0.016,
            frame: 10,
            viewportWidth: 1280,
            viewportHeight: 720,
        });

        const second = cache.prepare({
            renderPass: { id: 'shadow' } as any,
            cameraFrame: { camera: { id: 'cam-b' } } as any,
            lighting: { ambient: { x: 2 } } as any,
            elapsedSeconds: 2,
            deltaSeconds: 0.032,
            frame: 11,
            viewportWidth: 1920,
            viewportHeight: 1080,
        });

        expect(second).toBe(first);
        expect(second.renderPass).toEqual({ id: 'shadow' });
        expect(second.cameraFrame).toEqual({ camera: { id: 'cam-b' } });
        expect(second.lighting).toEqual({ ambient: { x: 2 } });
        expect(second.elapsedSeconds).toBe(2);
        expect(second.deltaSeconds).toBe(0.032);
        expect(second.frame).toBe(11);
        expect(second.viewportWidth).toBe(1920);
        expect(second.viewportHeight).toBe(1080);
    });
});
