import { describe, expect, it } from 'vitest';
import * as renderWebgl2 from '@axrone/render-webgl2';
import * as renderWebgl2Buffer from '@axrone/render-webgl2/buffer';

describe('render-webgl2 entry', () => {
    it('keeps the root surface focused on texture/backend contracts while exposing buffer runtime via subpath entries', () => {
        expect(renderWebgl2.TextureFormat).toBeDefined();
        expect(renderWebgl2.TextureFormatInfo).toBeDefined();
        expect(renderWebgl2.WebGLTextureManager).toBeDefined();
        expect('RenderPipeline' in renderWebgl2).toBe(false);
        expect('createRenderPipeline' in renderWebgl2).toBe(false);
        expect('createBufferFactory' in renderWebgl2).toBe(false);
        expect(renderWebgl2Buffer.createBufferFactory).toBeDefined();
        expect(renderWebgl2Buffer.Buffer).toBeDefined();
    });
});