import { describe, expect, it } from 'vitest';
import * as render2D from '@axrone/render-2d';

describe('render-2d entry', () => {
    it('keeps the 2d render seam narrow around public planning contracts', () => {
        expect(render2D.RENDER_2D_CAPABILITY_ID).toBe('render/2d');
        expect(render2D.getRender2DCapability().packageName).toBe('@axrone/render-2d');
        expect(render2D.createRenderPassGraph).toBeDefined();
        expect(render2D.RenderPipelineError).toBeDefined();
        expect('RenderPipeline' in render2D).toBe(false);
        expect('TextureFormat' in render2D).toBe(false);
    });
});