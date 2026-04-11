import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneShaderResource } from './shader-registry';

export class SceneRenderStateApplier {
    private _depthTest: boolean | null = null;
    private _cull: boolean | null = null;
    private _blend: boolean | null = null;
    private _depthMask: boolean | null = null;

    constructor(private readonly _gl: WebGL2RenderingContext) {}

    apply(shader: SceneShaderResource, renderPass: SceneRenderPassResource): void {
        const depthTest = renderPass.depthTest ?? shader.depthTest;
        const cull = renderPass.cull ?? shader.cull;
        const blend = renderPass.blend ?? shader.blend;

        if (this._depthTest !== depthTest) {
            if (depthTest) {
                this._gl.enable?.(this._gl.DEPTH_TEST);
            } else {
                this._gl.disable?.(this._gl.DEPTH_TEST);
            }
            this._depthTest = depthTest;
        }

        if (this._cull !== cull) {
            if (cull) {
                this._gl.enable?.(this._gl.CULL_FACE);
                this._gl.frontFace?.(this._gl.CCW);
                this._gl.cullFace?.(this._gl.BACK);
            } else {
                this._gl.disable?.(this._gl.CULL_FACE);
            }
            this._cull = cull;
        }

        if (this._blend !== blend) {
            if (blend) {
                this._gl.enable?.(this._gl.BLEND);
                this._gl.blendFunc?.(this._gl.SRC_ALPHA, this._gl.ONE_MINUS_SRC_ALPHA);
            } else {
                this._gl.disable?.(this._gl.BLEND);
            }
            this._blend = blend;
        }

        if (this._depthMask !== true) {
            this._gl.depthMask?.(true);
            this._depthMask = true;
        }
    }

    reset(): void {
        this._depthTest = null;
        this._cull = null;
        this._blend = null;
        this._depthMask = null;
    }
}
