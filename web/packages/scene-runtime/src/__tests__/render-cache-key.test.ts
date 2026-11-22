import { Mat4, Vec3 } from '@axrone/numeric';
import { describe, expect, it } from 'vitest';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { createRenderCacheCameraKey } from '../rendering/render-cache-key';

const createCameraFrame = (x: number): SceneCameraFrameState => {
    const view = Mat4.translate(new Vec3(-x, 0, 0));
    const projection = new Mat4();
    return {
        viewMatrix: view,
        projectionMatrix: projection,
        viewProjectionMatrix: Mat4.multiply(projection, view),
        position: new Vec3(x, 0, 4),
        camera3D: null as never,
    } as SceneCameraFrameState;
};

describe('createRenderCacheCameraKey', () => {
    it('returns a stable key for an unchanged camera and viewport', () => {
        const camera = createCameraFrame(3);
        const viewport = { width: 1600, height: 900 };

        expect(createRenderCacheCameraKey(camera, viewport)).toBe(
            createRenderCacheCameraKey(camera, viewport)
        );
    });

    it('changes when the camera moves or the viewport changes', () => {
        const base = createRenderCacheCameraKey(createCameraFrame(3), {
            width: 1600,
            height: 900,
        });
        const moved = createRenderCacheCameraKey(createCameraFrame(4), {
            width: 1600,
            height: 900,
        });
        const resized = createRenderCacheCameraKey(createCameraFrame(3), {
            width: 1280,
            height: 720,
        });

        expect(moved).not.toBe(base);
        expect(resized).not.toBe(base);
    });
});
