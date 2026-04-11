import { describe, expect, it } from 'vitest';
import * as render3D from '@axrone/render-3d';

describe('render-3d entry', () => {
    it('surfaces the 3d render seam on top of render-core without leaking backend-specific texture managers', () => {
        expect(render3D.RENDER_3D_CAPABILITY_ID).toBe('render/3d');
        expect(render3D.getRender3DCapability().packageName).toBe('@axrone/render-3d');
        expect(render3D.RenderPipeline).toBeDefined();
        expect(render3D.createRenderPipeline).toBeDefined();
        expect('TextureFormat' in render3D).toBe(false);
        expect('WebGLTextureManager' in render3D).toBe(false);
    });
});