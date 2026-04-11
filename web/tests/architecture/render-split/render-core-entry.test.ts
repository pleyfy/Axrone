import { describe, expect, it } from 'vitest';
import * as renderCore from '@axrone/render-core';

describe('render-core entry', () => {
    it('surfaces render pipeline planning primitives without leaking backend-specific texture APIs', () => {
        expect(renderCore.RenderPipeline).toBeDefined();
        expect(renderCore.createRenderPipeline).toBeDefined();
        expect(renderCore.RenderPipelineError).toBeDefined();
        expect(renderCore.createRenderPassGraph).toBeDefined();
        expect('TextureFormat' in renderCore).toBe(false);
        expect('TextureFormatInfo' in renderCore).toBe(false);
    });
});