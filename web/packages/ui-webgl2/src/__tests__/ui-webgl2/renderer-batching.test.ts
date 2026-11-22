import { describe, expect, it, vi } from 'vitest';
import type { UIFrame, WidgetId } from '@axrone/ui/types';
import { WebGL2UIRenderer } from '../../index';
import { createMetrics, createGlyphEntry, createTextLayout, createFrame, createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('renderer quad and text batching', () => {
    it('renders quad and text batches and uploads glyph pages once', () => {
        const gl = createMockWebGL2Context();
        const customCommandRenderer = vi.fn();
        const renderer = new WebGL2UIRenderer({ gl, customCommandRenderer });
        const frame = createFrame();

        renderer.render(frame);

        expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(2);
        expect(gl.drawArraysInstanced.mock.calls.map((call) => call[3])).toEqual([1, 1]);
        expect(gl.texImage2D).toHaveBeenCalledTimes(1);
        expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
        expect(gl.scissor).toHaveBeenCalled();
        expect(customCommandRenderer).toHaveBeenCalledTimes(1);
        expect(renderer.getStats()).toEqual({
            drawCalls: 2,
            quadCount: 1,
            imageCount: 0,
            materialImageCount: 0,
            glyphCount: 1,
            customCommandCount: 1,
            uploadedGlyphCount: 1,
            atlasPageCount: 1,
        });

        renderer.render(frame);

        expect(gl.texSubImage2D).toHaveBeenCalledTimes(1);
        expect(renderer.getStats().uploadedGlyphCount).toBe(0);

        renderer.dispose();
    });

    it('unbinds sampler on unit 0 in text batch after image batch binds one (regression: text invisible on frame 2)', () => {
        const gl = createMockWebGL2Context();
        const imageTexture = { id: 'image-tex' } as unknown as WebGLTexture;
        const imageSampler = { id: 'image-sampler' } as unknown as WebGLSampler;
        const renderer = new WebGL2UIRenderer({
            gl,
            resolveImageResource() {
                return { kind: 'texture', texture: imageTexture, sampler: imageSampler };
            },
        });
        const glyphEntry = createGlyphEntry();
        // Frame: image command FIRST (binds sampler), then text command.
        const frame: UIFrame<never> = {
            viewportWidth: 128,
            viewportHeight: 96,
            metrics: {
                ...createMetrics(),
                renderCount: 2,
                imageCommandCount: 1,
                textCommandCount: 1,
                customCommandCount: 0,
                glyphCount: 1,
            },
            commands: [
                {
                    kind: 'image',
                    widget: 1 as WidgetId,
                    source: { kind: 'texture', resourceId: 'img', width: 32, height: 32 },
                    x: 0, y: 0, width: 32, height: 32,
                    zIndex: 0,
                    tint: { r: 1, g: 1, b: 1, a: 1 },
                    opacity: 1,
                    sampling: 'linear',
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    clip: null,
                    uvRect: { x: 0, y: 0, width: 1, height: 1 },
                },
                {
                    kind: 'text',
                    widget: 2 as WidgetId,
                    x: 40, y: 48, zIndex: 1,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                    outlineWidth: 0,
                    edgeSoftness: 1,
                    opacity: 1,
                    clip: null,
                    layout: createTextLayout(glyphEntry),
                },
            ],
        };

        // Frame 1: image batch binds sampler, text batch must unbind it.
        renderer.render(frame);
        // The text draw must have bound null sampler after the image bound its sampler.
        const bindSamplerCallsFrame1 = (gl.bindSampler as ReturnType<typeof vi.fn>).mock.calls.slice();
        const lastBindSamplerCallFrame1 = bindSamplerCallsFrame1[bindSamplerCallsFrame1.length - 1];
        expect(lastBindSamplerCallFrame1).toEqual([0, null]);

        // Frame 2: same frame re-rendered. Text must still be drawn with null sampler.
        (gl.bindSampler as ReturnType<typeof vi.fn>).mockClear();
        (gl.drawArraysInstanced as ReturnType<typeof vi.fn>).mockClear();
        renderer.render(frame);

        // Text draw call must happen.
        expect(gl.drawArraysInstanced).toHaveBeenCalled();
        // The LAST bindSampler call before the text drawArraysInstanced must be (0, null).
        const bindSamplerCallsFrame2 = (gl.bindSampler as ReturnType<typeof vi.fn>).mock.calls.slice();
        // Find the last null sampler bind — it must exist.
        const nullSamplerCalls = bindSamplerCallsFrame2.filter((c: unknown[]) => c[1] === null);
        expect(nullSamplerCalls.length).toBeGreaterThan(0);
        // The very last bindSampler call should be null (text batch unbinds after image binds).
        const lastCall = bindSamplerCallsFrame2[bindSamplerCallsFrame2.length - 1];
        expect(lastCall).toEqual([0, null]);

        renderer.dispose();
    });

});
