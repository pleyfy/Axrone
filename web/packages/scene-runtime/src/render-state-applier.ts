import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneShaderResource } from './shader-registry';

export class SceneRenderStateApplier {
    private _depthTest: boolean | null = null;
    private _cull: boolean | null = null;
    private _blend: boolean | null = null;
    private _depthMask: boolean | null = null;
    private _stencilTest: boolean | null = null;
    private _stencilFunc: number | null = null;
    private _stencilRef: number | null = null;
    private _stencilMask: number | null = null;
    private _stencilFail: number | null = null;
    private _stencilZFail: number | null = null;
    private _stencilZPass: number | null = null;

    constructor(private readonly _gl: WebGL2RenderingContext) {}

    apply(shader: SceneShaderResource, renderPass: SceneRenderPassResource): void {
        const depthTest = renderPass.depthTest ?? shader.depthTest;
        const cull = renderPass.cull ?? shader.cull;
        const blend = renderPass.blend ?? shader.blend;
        const stencilTest = renderPass.stencilTest;

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

        if (this._stencilTest !== stencilTest) {
            if (stencilTest) {
                this._gl.enable?.(this._gl.STENCIL_TEST);
            } else {
                this._gl.disable?.(this._gl.STENCIL_TEST);
            }
            this._stencilTest = stencilTest ?? null;
        }

        if (renderPass.stencilMask !== undefined && this._stencilMask !== renderPass.stencilMask) {
            this._gl.stencilMask?.(renderPass.stencilMask);
            this._stencilMask = renderPass.stencilMask;
        }

        if (
            renderPass.stencilFunc !== undefined ||
            renderPass.stencilRef !== undefined ||
            renderPass.stencilMask !== undefined
        ) {
            const nextFunc = renderPass.stencilFunc ?? this._gl.ALWAYS;
            const nextRef = renderPass.stencilRef ?? 0;
            const nextMask = renderPass.stencilMask ?? 0xff;

            if (
                this._stencilFunc !== nextFunc ||
                this._stencilRef !== nextRef ||
                this._stencilMask !== nextMask
            ) {
                this._gl.stencilFunc?.(nextFunc, nextRef, nextMask);
                this._stencilFunc = nextFunc;
                this._stencilRef = nextRef;
                this._stencilMask = nextMask;
            }
        }

        if (
            renderPass.stencilFail !== undefined ||
            renderPass.stencilZFail !== undefined ||
            renderPass.stencilZPass !== undefined
        ) {
            const nextFail = renderPass.stencilFail ?? this._gl.KEEP;
            const nextZFail = renderPass.stencilZFail ?? this._gl.KEEP;
            const nextZPass = renderPass.stencilZPass ?? this._gl.KEEP;

            if (
                this._stencilFail !== nextFail ||
                this._stencilZFail !== nextZFail ||
                this._stencilZPass !== nextZPass
            ) {
                this._gl.stencilOp?.(nextFail, nextZFail, nextZPass);
                this._stencilFail = nextFail;
                this._stencilZFail = nextZFail;
                this._stencilZPass = nextZPass;
            }
        }
    }

    reset(): void {
        this._depthTest = null;
        this._cull = null;
        this._blend = null;
        this._depthMask = null;
        this._stencilTest = null;
        this._stencilFunc = null;
        this._stencilRef = null;
        this._stencilMask = null;
        this._stencilFail = null;
        this._stencilZFail = null;
        this._stencilZPass = null;
    }
}
