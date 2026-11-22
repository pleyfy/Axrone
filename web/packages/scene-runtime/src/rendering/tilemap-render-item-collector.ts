import type { SceneCameraFrameState } from '../camera-frame-state';
import type { WorldRect } from '@axrone/tilemap/query';

/**
 * Axis-aligned world rectangle for the active orthographic 2D camera.
 * Tilemap 2D rendering assumes an unrotated orthographic camera; perspective
 * or rolled cameras return `null` and the caller skips the tilemap pass.
 */
export const resolveTilemapCameraRect = (
    cameraFrame: SceneCameraFrameState | null,
    viewportWidth: number,
    viewportHeight: number
): WorldRect | null => {
    if (cameraFrame === null || !cameraFrame.camera3D.isOrthographic()) {
        return null;
    }
    const size = cameraFrame.camera.orthographicSize;
    const aspect = viewportWidth / Math.max(1, viewportHeight);
    const halfWidth = size * aspect;
    return {
        x: cameraFrame.position.x - halfWidth,
        y: cameraFrame.position.y - size,
        width: halfWidth * 2,
        height: size * 2,
    };
};
