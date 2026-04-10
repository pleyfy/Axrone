import { Vec4 } from '@axrone/numeric';
import type { Camera } from './components/camera';
import type { SceneRenderPassResource } from './render-pass-registry';

const isSameVec4 = (
    left: Vec4 | null | undefined,
    right: Vec4 | null | undefined
): boolean =>
    left === right ||
    (left !== null &&
        left !== undefined &&
        right !== null &&
        right !== undefined &&
        left.x === right.x &&
        left.y === right.y &&
        left.z === right.z &&
        left.w === right.w);

export class SceneRenderPassPreparer {
    private _clearColor: Vec4 | null = null;
    private _clearDepth: number | null = null;

    constructor(
        private readonly _gl: WebGL2RenderingContext,
        private readonly _defaultClearColor: Vec4
    ) {}

    prepare(renderPass: SceneRenderPassResource, camera?: Camera): void {
        const clearFlags = renderPass.clearFlags;
        let mask = 0;

        if (clearFlags.includes('color')) {
            const clearColor =
                renderPass.clearColor ?? camera?.clearColor ?? this._defaultClearColor;
            if (!isSameVec4(this._clearColor, clearColor)) {
                this._gl.clearColor(clearColor.x, clearColor.y, clearColor.z, clearColor.w);
                this._clearColor = clearColor;
            }
            mask |= this._gl.COLOR_BUFFER_BIT;
        }

        if (clearFlags.includes('depth')) {
            const clearDepth = renderPass.clearDepth ?? camera?.clearDepth ?? 1;
            if (this._clearDepth !== clearDepth) {
                this._gl.clearDepth(clearDepth);
                this._clearDepth = clearDepth;
            }
            mask |= this._gl.DEPTH_BUFFER_BIT;
        }

        if (mask !== 0) {
            this._gl.clear(mask);
        }
    }

    reset(): void {
        this._clearColor = null;
        this._clearDepth = null;
    }
}
