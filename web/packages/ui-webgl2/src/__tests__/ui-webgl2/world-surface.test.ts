import { describe, expect, it, vi } from 'vitest';
import { createUIWorldSurface } from '../../world-surface';
import { createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('world-surface resize guard invalidation', () => {
    it('restores the current caller framebuffer binding after resize, not the construction-time one', () => {
        const gl = createMockWebGL2Context();
        const callerFbo = { id: 'caller-fbo' } as unknown as WebGLFramebuffer;
        // Construction captures null framebuffer.
        const surface = createUIWorldSurface(gl, 64, 64);
        // External code binds a different framebuffer.
        gl.bindFramebuffer(gl.FRAMEBUFFER, callerFbo);
        // Resize should capture and restore the CURRENT caller binding.
        surface.resize(128, 128);
        // After resize+restore, the framebuffer should be back to the caller's binding.
        const bindFramebufferCalls = (gl.bindFramebuffer as ReturnType<typeof vi.fn>).mock.calls;
        const lastBind = bindFramebufferCalls[bindFramebufferCalls.length - 1];
        expect(lastBind[1]).toBe(callerFbo);
        surface.dispose();
    });
});

