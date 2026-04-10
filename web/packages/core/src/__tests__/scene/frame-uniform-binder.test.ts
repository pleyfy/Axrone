import { Mat4, Vec2, Vec3 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import type { SceneShaderResource } from '@axrone/scene-3d';
import type { SceneUniformWriteTarget } from '@axrone/scene-3d';
import { SceneFrameUniformBinder } from '@axrone/scene-3d';

describe('SceneFrameUniformBinder', () => {
    it('reuses MVP and resolution scratch objects while writing built-in uniforms', () => {
        const writer = {
            write: vi.fn(),
        } as unknown as SceneUniformWriteTarget;
        const binder = new SceneFrameUniformBinder(writer);
        const shader = {} as SceneShaderResource;

        const modelMatrix = new Mat4([
            1, 0, 0, 2,
            0, 1, 0, 3,
            0, 0, 1, 4,
            0, 0, 0, 1,
        ]);
        const viewMatrix = new Mat4([
            1, 0, 0, -1,
            0, 1, 0, -2,
            0, 0, 1, -3,
            0, 0, 0, 1,
        ]);
        const projectionMatrix = new Mat4([
            2, 0, 0, 0,
            0, 3, 0, 0,
            0, 0, 4, 0,
            0, 0, 0, 1,
        ]);
        const viewProjectionMatrix = Mat4.multiply(projectionMatrix, viewMatrix);
        const cameraPosition = new Vec3(5, 6, 7);

        binder.apply(shader, {
            modelMatrix,
            viewMatrix,
            projectionMatrix,
            viewProjectionMatrix,
            cameraPosition,
            elapsedSeconds: 1.5,
            deltaSeconds: 0.016,
            frame: 42,
            viewportWidth: 1920,
            viewportHeight: 1080,
        });
        binder.apply(shader, {
            modelMatrix,
            viewMatrix,
            projectionMatrix,
            viewProjectionMatrix,
            cameraPosition,
            elapsedSeconds: 2.5,
            deltaSeconds: 0.032,
            frame: 43,
            viewportWidth: 1280,
            viewportHeight: 720,
        });

        const firstMvp = writer.write.mock.calls[4]?.[2] as Mat4;
        const secondMvp = writer.write.mock.calls[14]?.[2] as Mat4;
        const firstResolution = writer.write.mock.calls[8]?.[2] as Vec2;
        const secondResolution = writer.write.mock.calls[18]?.[2] as Vec2;

        expect(secondMvp).toBe(firstMvp);
        expect(secondResolution).toBe(firstResolution);
        expect(secondResolution.x).toBe(1280);
        expect(secondResolution.y).toBe(720);
        expect(
            secondMvp.equals(Mat4.multiply(viewProjectionMatrix, modelMatrix))
        ).toBe(true);
        expect(writer.write.mock.calls[19]?.[2]).toBe(cameraPosition);
    });
});
