import { describe, expect, it, vi } from 'vitest';
import { WebGL2UIRenderer } from '../../index';
import { createUIWorldQuadRenderer } from '../../world-quad';
import { createUIWorldSurface } from '../../world-surface';
import { columnMajorIdentity, createFrame, createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('renderer framebuffer and GL state', () => {
    it('restores the previous WebGL state after rendering a UI frame', () => {
        const gl = createMockWebGL2Context();
        const previousProgram = { id: 'previous-program' } as unknown as WebGLProgram;
        const previousVao = { id: 'previous-vao' } as unknown as WebGLVertexArrayObject;
        const previousBuffer = { id: 'previous-buffer' } as unknown as WebGLBuffer;
        const previousTexture = { id: 'previous-texture' } as unknown as WebGLTexture;
        const previousSampler = { id: 'previous-sampler' } as unknown as WebGLSampler;
        const previousFramebuffer = { id: 'previous-framebuffer' } as unknown as WebGLFramebuffer;
        const renderer = new WebGL2UIRenderer({ gl });

        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        gl.viewport(3, 4, 320, 180);
        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.BLEND);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(5, 6, 70, 80);
        gl.useProgram(previousProgram);
        gl.bindVertexArray(previousVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, previousBuffer);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
        gl.blendFuncSeparate(gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, previousTexture);
        gl.bindSampler(0, previousSampler);
        gl.activeTexture(gl.TEXTURE1);

        renderer.render(createFrame());

        expect(gl.getParameter(gl.FRAMEBUFFER_BINDING)).toBe(previousFramebuffer);
        expect(gl.getParameter(gl.CURRENT_PROGRAM)).toBe(previousProgram);
        expect(gl.getParameter(gl.VERTEX_ARRAY_BINDING)).toBe(previousVao);
        expect(gl.getParameter(gl.ARRAY_BUFFER_BINDING)).toBe(previousBuffer);
        expect(gl.getParameter(gl.ACTIVE_TEXTURE)).toBe(gl.TEXTURE1);
        gl.activeTexture(gl.TEXTURE0);
        expect(gl.getParameter(gl.TEXTURE_BINDING_2D)).toBe(previousTexture);
        expect(gl.getParameter(gl.SAMPLER_BINDING)).toBe(previousSampler);
        expect(gl.getParameter(gl.VIEWPORT)).toEqual([3, 4, 320, 180]);
        expect(gl.getParameter(gl.SCISSOR_BOX)).toEqual([5, 6, 70, 80]);
        expect(gl.isEnabled(gl.CULL_FACE)).toBe(true);
        expect(gl.isEnabled(gl.DEPTH_TEST)).toBe(true);
        expect(gl.isEnabled(gl.BLEND)).toBe(false);
        expect(gl.isEnabled(gl.SCISSOR_TEST)).toBe(true);
        expect(gl.getParameter(gl.UNPACK_ALIGNMENT)).toBe(4);
        expect(gl.getParameter(gl.BLEND_SRC_RGB)).toBe(gl.ONE_MINUS_SRC_ALPHA);
        expect(gl.getParameter(gl.BLEND_DST_RGB)).toBe(gl.SRC_ALPHA);
        expect(gl.getParameter(gl.BLEND_SRC_ALPHA)).toBe(gl.ONE_MINUS_SRC_ALPHA);
        expect(gl.getParameter(gl.BLEND_DST_ALPHA)).toBe(gl.SRC_ALPHA);
    });

    it('renders into an offscreen framebuffer and restores the previous binding', () => {
        const gl = createMockWebGL2Context();
        const previousFramebuffer = { id: 'previous-framebuffer' } as unknown as WebGLFramebuffer;
        const offscreen = { id: 'offscreen-framebuffer' } as unknown as WebGLFramebuffer;
        const renderer = new WebGL2UIRenderer({ gl });

        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        renderer.render(createFrame(), { framebuffer: offscreen });

        // The UI must have been drawn against the offscreen target...
        expect(gl.bindFramebuffer).toHaveBeenCalledWith(gl.FRAMEBUFFER, offscreen);
        // ...and the scene's binding restored on the way out.
        expect(gl.getParameter(gl.FRAMEBUFFER_BINDING)).toBe(previousFramebuffer);
    });

    it('draws to the default framebuffer when the render options omit a target', () => {
        const gl = createMockWebGL2Context();
        const previousFramebuffer = { id: 'previous-framebuffer' } as unknown as WebGLFramebuffer;
        const renderer = new WebGL2UIRenderer({ gl });

        gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        renderer.render(createFrame());

        // No target override: the binding is left untouched during the pass.
        expect(gl.bindFramebuffer).not.toHaveBeenCalledWith(gl.FRAMEBUFFER, null);
        expect(gl.getParameter(gl.FRAMEBUFFER_BINDING)).toBe(previousFramebuffer);
    });

});

describe('context loss handling', () => {
    const createMockCanvas = () => {
        const listeners = new Map<string, Set<(event: Event) => void>>();
        return {
            width: 320,
            height: 180,
            addEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
                if (!listeners.has(type)) listeners.set(type, new Set());
                listeners.get(type)!.add(listener);
            }),
            removeEventListener: vi.fn((type: string, listener: (event: Event) => void) => {
                listeners.get(type)?.delete(listener);
            }),
            dispatchEvent(event: Event) {
                for (const listener of listeners.get(event.type) ?? []) {
                    listener(event);
                }
                return true;
            },
        };
    };

    const createGLWithCanvas = () => {
        const gl = createMockWebGL2Context();
        const canvas = createMockCanvas();
        (gl as unknown as { canvas: object }).canvas = canvas;
        return { gl, canvas };
    };

    it('skips world-quad draw while context is lost and recreates resources on restore', () => {
        const { gl, canvas } = createGLWithCanvas();
        const quadRenderer = createUIWorldQuadRenderer(gl);
        const vp = columnMajorIdentity();
        const texture = gl.createTexture()!;

        // Dispatch context lost.
        canvas.dispatchEvent(new Event('webglcontextlost'));

        // Draw should be skipped.
        const drawCallsBefore = (gl.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length;
        quadRenderer.draw(texture, { modelMatrix: vp, viewProjection: vp, width: 32, height: 32 });
        expect((gl.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length).toBe(drawCallsBefore);

        // Dispatch context restored.
        canvas.dispatchEvent(new Event('webglcontextrestored'));

        // Draw should work again.
        quadRenderer.draw(texture, { modelMatrix: vp, viewProjection: vp, width: 32, height: 32 });
        expect((gl.drawArrays as ReturnType<typeof vi.fn>).mock.calls.length).toBe(drawCallsBefore + 1);

        quadRenderer.dispose();
        // Listeners removed.
        expect(canvas.removeEventListener).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
        expect(canvas.removeEventListener).toHaveBeenCalledWith('webglcontextrestored', expect.any(Function));
    });

    it('skips world-surface resize while context is lost and recreates on restore', () => {
        const { gl, canvas } = createGLWithCanvas();
        const surface = createUIWorldSurface(gl, 64, 64);

        canvas.dispatchEvent(new Event('webglcontextlost'));

        const texImageCallsBefore = (gl.texImage2D as ReturnType<typeof vi.fn>).mock.calls.length;
        surface.resize(128, 128);
        // No new texImage2D calls because resize is skipped.
        expect((gl.texImage2D as ReturnType<typeof vi.fn>).mock.calls.length).toBe(texImageCallsBefore);

        canvas.dispatchEvent(new Event('webglcontextrestored'));
        // After restore, resources are recreated (new texture allocated).
        expect((gl.texImage2D as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(texImageCallsBefore);

        surface.dispose();
        expect(canvas.removeEventListener).toHaveBeenCalledWith('webglcontextlost', expect.any(Function));
    });
});

