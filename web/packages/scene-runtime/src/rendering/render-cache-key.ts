import type { SceneCameraFrameState } from '../camera-frame-state';

export interface RenderCacheViewport {
    readonly width: number;
    readonly height: number;
}

const FLOAT_SCRATCH = new Float32Array(1);
const UINT_SCRATCH = new Uint32Array(FLOAT_SCRATCH.buffer);

const hashUint32 = (hash: number, value: number): number => {
    let result = hash ^ value;
    result = Math.imul(result, 0x01000193);
    return result >>> 0;
};

const hashFloat = (hash: number, value: number): number => {
    FLOAT_SCRATCH[0] = value;
    return hashUint32(hash, UINT_SCRATCH[0]!);
};

const hashArray = (hash: number, values: ArrayLike<number>): number => {
    let result = hash;
    for (let index = 0; index < values.length; index += 1) {
        result = hashFloat(result, values[index]!);
    }
    return result;
};

const hashNumber = (hash: number, value: number): number =>
    hashUint32(hash, Number.isFinite(value) ? Math.trunc(value * 1_000_000) | 0 : 0);

/**
 * Computes a cheap, collision-resistant camera/viewport key for render caches.
 *
 * Cache consumers must rebuild whenever the camera projection, view, position
 * or viewport changes. A string key keeps the comparison allocation-light and
 * avoids accidental numeric overflow when persisted in diagnostics.
 */
export const createRenderCacheCameraKey = (
    cameraFrame: SceneCameraFrameState,
    viewport: RenderCacheViewport
): string => {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;

    first = hashArray(first, cameraFrame.viewMatrix.data);
    second = hashArray(second, cameraFrame.projectionMatrix.data);
    first = hashArray(first, cameraFrame.viewProjectionMatrix.data);
    second = hashFloat(second, cameraFrame.position.x);
    second = hashFloat(second, cameraFrame.position.y);
    second = hashFloat(second, cameraFrame.position.z);
    first = hashNumber(first, viewport.width);
    second = hashNumber(second, viewport.height);

    return `${first.toString(36)}:${second.toString(36)}:${viewport.width}x${viewport.height}`;
};
