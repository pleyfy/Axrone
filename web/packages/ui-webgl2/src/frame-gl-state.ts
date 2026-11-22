import type { RectLike } from '@axrone/ui/types';
import {
    GL_STATE_ACTIVE_TEXTURE,
    GL_STATE_ARRAY_BUFFER,
    GL_STATE_BLEND,
    GL_STATE_BLEND_FUNC,
    GL_STATE_CULL_FACE,
    GL_STATE_DEPTH_TEST,
    GL_STATE_FRAMEBUFFER,
    GL_STATE_PROGRAM,
    GL_STATE_SCISSOR_BOX,
    GL_STATE_SCISSOR_TEST,
    GL_STATE_UNPACK_ALIGNMENT,
    GL_STATE_UNIT0_SAMPLER,
    GL_STATE_UNIT0_TEXTURE,
    GL_STATE_VERTEX_ARRAY,
    GL_STATE_VIEWPORT,
    type GLStateShadow,
    createGLStateShadow,
    readGLEnabled,
    readGLParameter,
    restoreGLEnableState,
} from './gl-state';

export class FrameGLState {
    private readonly gl: WebGL2RenderingContext;
    private readonly shadow: GLStateShadow = createGLStateShadow();
    private capturedGroups = 0;
    private touchedGroups = 0;
    private activeTextureUnit = -1;

    constructor(gl: WebGL2RenderingContext) {
        this.gl = gl;
    }

    prepareFrame(width: number, height: number): void {
        const gl = this.gl;
        this.capture(GL_STATE_ACTIVE_TEXTURE);
        if (this.shadow.activeTexture !== gl.TEXTURE0) {
            gl.activeTexture(gl.TEXTURE0);
            this.touch(GL_STATE_ACTIVE_TEXTURE);
        }
        this.activeTextureUnit = gl.TEXTURE0;
        this.capture(GL_STATE_VIEWPORT);
        this.touch(GL_STATE_VIEWPORT);
        gl.viewport(0, 0, width, height);
        this.capture(GL_STATE_CULL_FACE);
        this.touch(GL_STATE_CULL_FACE);
        gl.disable(gl.CULL_FACE);
        this.capture(GL_STATE_DEPTH_TEST);
        this.touch(GL_STATE_DEPTH_TEST);
        gl.disable(gl.DEPTH_TEST);
        this.capture(GL_STATE_BLEND);
        this.touch(GL_STATE_BLEND);
        gl.enable(gl.BLEND);
        this.capture(GL_STATE_BLEND_FUNC);
        this.touch(GL_STATE_BLEND_FUNC);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }

    capture(groups: number): void {
        const pending = groups & ~this.capturedGroups;
        if (pending === 0) {
            return;
        }
        const gl = this.gl;
        const shadow = this.shadow;
        if ((pending & GL_STATE_FRAMEBUFFER) !== 0) {
            shadow.framebuffer = readGLParameter<WebGLFramebuffer | null>(gl, gl.FRAMEBUFFER_BINDING, null);
        }
        if ((pending & GL_STATE_VIEWPORT) !== 0) {
            const viewport = readGLParameter<Int32Array | readonly number[] | null>(gl, gl.VIEWPORT, null);
            const valid = viewport !== null && viewport.length >= 4;
            shadow.viewportX = valid ? viewport![0] ?? 0 : undefined;
            shadow.viewportY = valid ? viewport![1] ?? 0 : undefined;
            shadow.viewportWidth = valid ? viewport![2] ?? 0 : undefined;
            shadow.viewportHeight = valid ? viewport![3] ?? 0 : undefined;
        }
        if ((pending & GL_STATE_SCISSOR_BOX) !== 0) {
            const scissorBox = readGLParameter<Int32Array | readonly number[] | null>(gl, gl.SCISSOR_BOX, null);
            const valid = scissorBox !== null && scissorBox.length >= 4;
            shadow.scissorX = valid ? scissorBox![0] ?? 0 : undefined;
            shadow.scissorY = valid ? scissorBox![1] ?? 0 : undefined;
            shadow.scissorWidth = valid ? scissorBox![2] ?? 0 : undefined;
            shadow.scissorHeight = valid ? scissorBox![3] ?? 0 : undefined;
        }
        if ((pending & GL_STATE_SCISSOR_TEST) !== 0) {
            shadow.scissorTest = readGLEnabled(gl, gl.SCISSOR_TEST);
        }
        if ((pending & GL_STATE_PROGRAM) !== 0) {
            shadow.program = readGLParameter<WebGLProgram | null>(gl, gl.CURRENT_PROGRAM, null);
        }
        if ((pending & GL_STATE_VERTEX_ARRAY) !== 0) {
            shadow.vertexArray = readGLParameter<WebGLVertexArrayObject | null>(gl, gl.VERTEX_ARRAY_BINDING, null);
        }
        if ((pending & GL_STATE_ARRAY_BUFFER) !== 0) {
            shadow.arrayBuffer = readGLParameter<WebGLBuffer | null>(gl, gl.ARRAY_BUFFER_BINDING, null);
        }
        if ((pending & GL_STATE_UNPACK_ALIGNMENT) !== 0) {
            shadow.unpackAlignment = readGLParameter<number>(gl, gl.UNPACK_ALIGNMENT, undefined);
        }
        if ((pending & GL_STATE_CULL_FACE) !== 0) {
            shadow.cullFace = readGLEnabled(gl, gl.CULL_FACE);
        }
        if ((pending & GL_STATE_DEPTH_TEST) !== 0) {
            shadow.depthTest = readGLEnabled(gl, gl.DEPTH_TEST);
        }
        if ((pending & GL_STATE_BLEND) !== 0) {
            shadow.blend = readGLEnabled(gl, gl.BLEND);
        }
        if ((pending & GL_STATE_BLEND_FUNC) !== 0) {
            shadow.blendSrcRgb = readGLParameter<number>(gl, gl.BLEND_SRC_RGB, undefined);
            shadow.blendDstRgb = readGLParameter<number>(gl, gl.BLEND_DST_RGB, undefined);
            shadow.blendSrcAlpha = readGLParameter<number>(gl, gl.BLEND_SRC_ALPHA, undefined);
            shadow.blendDstAlpha = readGLParameter<number>(gl, gl.BLEND_DST_ALPHA, undefined);
        }
        if ((pending & GL_STATE_ACTIVE_TEXTURE) !== 0) {
            shadow.activeTexture = readGLParameter<number>(gl, gl.ACTIVE_TEXTURE, gl.TEXTURE0);
        }
        if ((pending & GL_STATE_UNIT0_TEXTURE) !== 0) {
            shadow.unit0Texture = readGLParameter<WebGLTexture | null>(gl, gl.TEXTURE_BINDING_2D, null);
        }
        if ((pending & GL_STATE_UNIT0_SAMPLER) !== 0) {
            shadow.unit0Sampler = readGLParameter<WebGLSampler | null>(gl, gl.SAMPLER_BINDING, null);
        }
        this.capturedGroups |= pending;
    }

    touch(groups: number): void {
        this.touchedGroups |= groups;
    }

    applyClip(clip: RectLike | null, viewportHeight: number): void {
        const gl = this.gl;
        this.capture(GL_STATE_SCISSOR_TEST);
        this.touch(GL_STATE_SCISSOR_TEST);
        if (clip === null) {
            gl.disable(gl.SCISSOR_TEST);
            return;
        }
        this.capture(GL_STATE_SCISSOR_BOX);
        this.touch(GL_STATE_SCISSOR_BOX);
        gl.enable(gl.SCISSOR_TEST);
        const x = Math.max(0, Math.floor(clip.x));
        const y = Math.max(0, Math.floor(viewportHeight - (clip.y + clip.height)));
        const width = Math.max(0, Math.ceil(clip.width));
        const height = Math.max(0, Math.ceil(clip.height));
        gl.scissor(x, y, width, height);
    }

    ensureActiveUnit0(): void {
        const gl = this.gl;
        if (this.activeTextureUnit === gl.TEXTURE0) {
            return;
        }
        this.capture(GL_STATE_ACTIVE_TEXTURE);
        gl.activeTexture(gl.TEXTURE0);
        this.activeTextureUnit = gl.TEXTURE0;
        this.touch(GL_STATE_ACTIVE_TEXTURE);
    }

    bindUnit0Texture(texture: WebGLTexture | null): void {
        const gl = this.gl;
        this.ensureActiveUnit0();
        this.capture(GL_STATE_UNIT0_TEXTURE);
        this.touch(GL_STATE_UNIT0_TEXTURE);
        gl.bindTexture(gl.TEXTURE_2D, texture);
    }

    invalidateTextureUnit(): void {
        this.activeTextureUnit = -1;
    }

    restore(): void {
        const gl = this.gl;
        const shadow = this.shadow;
        const touched = this.touchedGroups;
        if ((touched & GL_STATE_FRAMEBUFFER) !== 0) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.framebuffer);
        }
        if ((touched & GL_STATE_VIEWPORT) !== 0 && shadow.viewportX !== undefined) {
            gl.viewport(shadow.viewportX, shadow.viewportY ?? 0, shadow.viewportWidth ?? 0, shadow.viewportHeight ?? 0);
        }
        if ((touched & GL_STATE_CULL_FACE) !== 0) {
            restoreGLEnableState(gl, gl.CULL_FACE, shadow.cullFace);
        }
        if ((touched & GL_STATE_DEPTH_TEST) !== 0) {
            restoreGLEnableState(gl, gl.DEPTH_TEST, shadow.depthTest);
        }
        if ((touched & GL_STATE_BLEND) !== 0) {
            restoreGLEnableState(gl, gl.BLEND, shadow.blend);
        }
        if ((touched & GL_STATE_BLEND_FUNC) !== 0 && shadow.blendSrcRgb !== undefined) {
            if (
                shadow.blendDstRgb !== undefined &&
                shadow.blendSrcAlpha !== undefined &&
                shadow.blendDstAlpha !== undefined &&
                typeof gl.blendFuncSeparate === 'function'
            ) {
                gl.blendFuncSeparate(shadow.blendSrcRgb, shadow.blendDstRgb, shadow.blendSrcAlpha, shadow.blendDstAlpha);
            } else if (shadow.blendDstRgb !== undefined) {
                gl.blendFunc(shadow.blendSrcRgb, shadow.blendDstRgb);
            }
        }
        if ((touched & GL_STATE_SCISSOR_TEST) !== 0) {
            restoreGLEnableState(gl, gl.SCISSOR_TEST, shadow.scissorTest);
        }
        if ((touched & GL_STATE_SCISSOR_BOX) !== 0 && shadow.scissorX !== undefined) {
            gl.scissor(shadow.scissorX, shadow.scissorY ?? 0, shadow.scissorWidth ?? 0, shadow.scissorHeight ?? 0);
        }
        if ((touched & GL_STATE_PROGRAM) !== 0) {
            gl.useProgram(shadow.program);
        }
        if ((touched & GL_STATE_VERTEX_ARRAY) !== 0) {
            gl.bindVertexArray(shadow.vertexArray);
        }
        if ((touched & GL_STATE_ARRAY_BUFFER) !== 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, shadow.arrayBuffer);
        }
        if ((touched & GL_STATE_UNPACK_ALIGNMENT) !== 0 && shadow.unpackAlignment !== undefined) {
            gl.pixelStorei?.(gl.UNPACK_ALIGNMENT, shadow.unpackAlignment);
        }
        if ((touched & (GL_STATE_UNIT0_TEXTURE | GL_STATE_UNIT0_SAMPLER)) !== 0) {
            this.ensureActiveUnit0();
            if ((touched & GL_STATE_UNIT0_TEXTURE) !== 0) {
                gl.bindTexture(gl.TEXTURE_2D, shadow.unit0Texture);
            }
            if ((touched & GL_STATE_UNIT0_SAMPLER) !== 0) {
                gl.bindSampler?.(0, shadow.unit0Sampler);
            }
        }
        if ((touched & GL_STATE_ACTIVE_TEXTURE) !== 0) {
            gl.activeTexture(shadow.activeTexture);
            this.activeTextureUnit = shadow.activeTexture;
        }
        this.capturedGroups = 0;
        this.touchedGroups = 0;
    }
}
