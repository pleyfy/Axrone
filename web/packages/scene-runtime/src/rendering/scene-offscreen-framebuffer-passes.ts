import {
    createRenderTarget,
    type IFramebuffer,
    type ITexture,
} from '@axrone/render-webgl2/framebuffer';
import type { SceneFramebufferPassDefinition } from './scene-framebuffer-passes';

const BLUR_VERTEX_SHADER_SOURCE = `#version 300 es
precision mediump float;

out vec2 vUv;

void main() {
    vec2 positions[3] = vec2[](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    vec2 position = positions[gl_VertexID];
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}
`;

/**
 * Five bilinear taps reproduce a nine-tap Gaussian at half the samples, which
 * keeps the pass inside the mobile four-tap budget for a filter this wide.
 */
const BLUR_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;

uniform sampler2D _SourceTexture;
uniform vec2 _TexelSize;
uniform float _BlurRadius;

in vec2 vUv;
out vec4 outColor;

void main() {
    vec2 radius = _TexelSize * _BlurRadius;
    vec3 sum = texture(_SourceTexture, vUv).rgb * 0.2270270270;
    sum += (texture(_SourceTexture, vUv + vec2(radius.x, 0.0)).rgb +
            texture(_SourceTexture, vUv - vec2(radius.x, 0.0)).rgb) * 0.1945945946;
    sum += (texture(_SourceTexture, vUv + vec2(0.0, radius.y)).rgb +
            texture(_SourceTexture, vUv - vec2(0.0, radius.y)).rgb) * 0.1216216216;
    sum += (texture(_SourceTexture, vUv + vec2(radius.x, radius.y)).rgb +
            texture(_SourceTexture, vUv - vec2(radius.x, radius.y)).rgb) * 0.0540540541;
    sum += (texture(_SourceTexture, vUv + vec2(radius.x * 2.0, 0.0)).rgb +
            texture(_SourceTexture, vUv - vec2(radius.x * 2.0, 0.0)).rgb) * 0.0162162162;
    outColor = vec4(sum, 1.0);
}
`;

const DEFAULT_BLUR_RADIUS = 2;
const BLUR_SAMPLER_UNIT = 0;

export interface SceneFramebufferPassStats {
    readonly refractionCopyCount: number;
    readonly sssBlurCount: number;
    readonly targetWidth: number;
    readonly targetHeight: number;
}

export interface SceneFramebufferTextureBindings {
    readonly sceneColorTexture: ITexture | null;
    readonly sssBlurTexture: ITexture | null;
}

const EMPTY_STATS: SceneFramebufferPassStats = Object.freeze({
    refractionCopyCount: 0,
    sssBlurCount: 0,
    targetWidth: 0,
    targetHeight: 0,
});

const compilePass = (
    gl: WebGL2RenderingContext,
    type: number,
    source: string
): WebGLShader | null => {
    const shader = gl.createShader(type);
    if (!shader) {
        return null;
    }

    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
    }

    return shader;
};

/**
 * Owns the offscreen colour targets the multi-pass material effects need.
 *
 * `refraction-copy` resolves the already-drawn scene colour into its own
 * texture with a framebuffer blit, so transmissive geometry can read the
 * background without a single primitive being drawn a second time. `sss-blur`
 * filters that copy into a separate target. Both targets are created lazily —
 * a frame with no gated material never allocates a texture — and are resized
 * in place and disposed together with the runtime.
 */
export class SceneFramebufferPassRuntime {
    private readonly _gl: WebGL2RenderingContext;
    private _copyTarget: IFramebuffer | null = null;
    private _blurTarget: IFramebuffer | null = null;
    private _blurProgram: WebGLProgram | null = null;
    private _blurProgramFailed = false;
    private _blurSourceLocation: WebGLUniformLocation | null = null;
    private _blurTexelLocation: WebGLUniformLocation | null = null;
    private _blurRadiusLocation: WebGLUniformLocation | null = null;
    private _width = 0;
    private _height = 0;
    private readonly _savedViewport: Int32Array = new Int32Array(4);

    constructor(gl: WebGL2RenderingContext) {
        this._gl = gl;
    }

    /**
     * Records the resolution the offscreen targets must match. No GL work is
     * issued here: targets only materialise when a pass is actually executed.
     */
    beginFrame(width: number, height: number): void {
        this._width = width;
        this._height = height;
    }

    get sceneColorTexture(): ITexture | null {
        return this._copyTarget?.colorAttachments[0] ?? null;
    }

    get sssBlurTexture(): ITexture | null {
        return this._blurTarget?.colorAttachments[0] ?? null;
    }

    getTextureBindings(): SceneFramebufferTextureBindings {
        return {
            sceneColorTexture: this.sceneColorTexture,
            sssBlurTexture: this.sssBlurTexture,
        };
    }

    /**
     * Runs the planned passes back to back and always puts the GL state this
     * function touched back the way it found it, so the scene draw loop keeps
     * owning the frame from the caller's point of view.
     */
    execute(plan: readonly SceneFramebufferPassDefinition[]): SceneFramebufferPassStats {
        if (plan.length === 0 || this._width <= 0 || this._height <= 0) {
            return EMPTY_STATS;
        }

        const restore = this._pushState();
        let copies = 0;
        let blurs = 0;

        try {
            this._ensureTargets();
            for (let index = 0; index < plan.length; index += 1) {
                const pass = plan[index]!;
                if (pass.operation === 'copy') {
                    this._copySceneColor(restore.framebuffer);
                    copies += 1;
                } else if (pass.operation === 'blur' && this._copyTarget !== null) {
                    if (this._ensureBlurProgram()) {
                        this._runBlurPass();
                        blurs += 1;
                    }
                }
            }
        } finally {
            this._popState(restore);
        }

        return {
            refractionCopyCount: copies,
            sssBlurCount: blurs,
            targetWidth: this._width,
            targetHeight: this._height,
        };
    }

    private _ensureTargets(): void {
        const gl = this._gl;
        const width = this._width;
        const height = this._height;
        if (!this._copyTarget || this._copyTarget.width !== width || this._copyTarget.height !== height) {
            this._copyTarget?.dispose();
            this._copyTarget = createRenderTarget(gl, width, height, {
                useDepth: false,
                label: 'scene-color-copy',
            });
        }

        if (!this._blurTarget || this._blurTarget.width !== width || this._blurTarget.height !== height) {
            this._blurTarget?.dispose();
            this._blurTarget = createRenderTarget(gl, width, height, {
                useDepth: false,
                label: 'sss-blur',
            });
        }
    }

    /**
     * Colour-only resolve from the framebuffer the scene just rendered into
     * (the default drawing buffer, or the HDR target when the pipeline owns an
     * offscreen frame buffer) into the copy target. A blit touches no vertex
     * data, which is what keeps opaque and non-transmissive geometry out of a
     * second blended draw.
     */
    private _copySceneColor(
        sourceFramebuffer: WebGLFramebuffer | null
    ): void {
        const gl = this._gl;
        const target = this._copyTarget;
        if (!target) {
            return;
        }

        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sourceFramebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, target.id);
        gl.blitFramebuffer(
            0,
            0,
            this._width,
            this._height,
            0,
            0,
            target.width,
            target.height,
            gl.COLOR_BUFFER_BIT,
            gl.NEAREST
        );
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    }

    private _ensureBlurProgram(): boolean {
        const gl = this._gl;
        if (this._blurProgram !== null) {
            return true;
        }

        if (this._blurProgramFailed) {
            return false;
        }

        const vertex = compilePass(gl, gl.VERTEX_SHADER, BLUR_VERTEX_SHADER_SOURCE);
        const fragment = compilePass(gl, gl.FRAGMENT_SHADER, BLUR_FRAGMENT_SHADER_SOURCE);
        if (!vertex || !fragment) {
            this._blurProgramFailed = true;
            return false;
        }

        const program = gl.createProgram();
        if (!program) {
            this._blurProgramFailed = true;
            gl.deleteShader(vertex);
            gl.deleteShader(fragment);
            return false;
        }

        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            gl.deleteProgram(program);
            this._blurProgramFailed = true;
            return false;
        }

        this._blurProgram = program;
        this._blurSourceLocation = gl.getUniformLocation(program, '_SourceTexture');
        this._blurTexelLocation = gl.getUniformLocation(program, '_TexelSize');
        this._blurRadiusLocation = gl.getUniformLocation(program, '_BlurRadius');
        gl.uniform1i(this._blurSourceLocation, BLUR_SAMPLER_UNIT);
        return true;
    }

    private _runBlurPass(): void {
        const gl = this._gl;
        const target = this._blurTarget;
        const source = this._copyTarget?.colorAttachments[0];
        const program = this._blurProgram;
        if (!target || !source || !program) {
            return;
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, target.id);
        gl.viewport(0, 0, target.width, target.height);
        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.useProgram(program);
        gl.activeTexture(gl.TEXTURE0 + BLUR_SAMPLER_UNIT);
        gl.bindTexture(gl.TEXTURE_2D, source.id);
        gl.uniform2f(this._blurTexelLocation, 1 / target.width, 1 / target.height);
        gl.uniform1f(this._blurRadiusLocation, DEFAULT_BLUR_RADIUS);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindTexture(gl.TEXTURE_2D, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    private _pushState(): StateSnapshot {
        const gl = this._gl;
        const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array | null;
        if (viewport) {
            this._savedViewport[0] = viewport[0];
            this._savedViewport[1] = viewport[1];
            this._savedViewport[2] = viewport[2];
            this._savedViewport[3] = viewport[3];
        }

        return {
            depthTest: gl.isEnabled(gl.DEPTH_TEST),
            blend: gl.isEnabled(gl.BLEND),
            cullFace: gl.isEnabled(gl.CULL_FACE),
            depthMask: gl.getParameter(gl.DEPTH_WRITEMASK) as boolean | null,
            program: gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null,
            texture2D: gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null,
            activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE) as number | null,
            framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null,
        };
    }

    private _popState(restore: StateSnapshot): void {
        const gl = this._gl;
        gl.bindFramebuffer(gl.FRAMEBUFFER, restore.framebuffer);
        gl.viewport(
            this._savedViewport[0],
            this._savedViewport[1],
            this._savedViewport[2],
            this._savedViewport[3]
        );
        gl.activeTexture((restore.activeTexture ?? gl.TEXTURE0) as number);
        gl.bindTexture(gl.TEXTURE_2D, restore.texture2D);
        gl.useProgram(restore.program);
        if (restore.depthMask === null || restore.depthMask === undefined) {
            gl.depthMask(true);
        } else {
            gl.depthMask(restore.depthMask);
        }

        if (restore.depthTest) {
            gl.enable(gl.DEPTH_TEST);
        } else {
            gl.disable(gl.DEPTH_TEST);
        }

        if (restore.blend) {
            gl.enable(gl.BLEND);
        } else {
            gl.disable(gl.BLEND);
        }

        if (restore.cullFace) {
            gl.enable(gl.CULL_FACE);
        } else {
            gl.disable(gl.CULL_FACE);
        }
    }

    /** Drops the GL handles without issuing deletes: used after context loss. */
    invalidateContextResources(): void {
        this._copyTarget = null;
        this._blurTarget = null;
        this._blurProgram = null;
        this._blurProgramFailed = false;
        this._blurSourceLocation = null;
        this._blurTexelLocation = null;
        this._blurRadiusLocation = null;
    }

    dispose(): void {
        const gl = this._gl;
        this._copyTarget?.dispose();
        this._blurTarget?.dispose();
        this._copyTarget = null;
        this._blurTarget = null;
        if (this._blurProgram) {
            gl.deleteProgram(this._blurProgram);
            this._blurProgram = null;
        }

        this._blurProgramFailed = false;
        this._blurSourceLocation = null;
        this._blurTexelLocation = null;
        this._blurRadiusLocation = null;
    }
}

interface StateSnapshot {
    readonly depthTest: boolean;
    readonly blend: boolean;
    readonly cullFace: boolean;
    readonly depthMask: boolean | null;
    readonly program: WebGLProgram | null;
    readonly texture2D: WebGLTexture | null;
    readonly activeTexture: number | null;
    readonly framebuffer: WebGLFramebuffer | null;
}
