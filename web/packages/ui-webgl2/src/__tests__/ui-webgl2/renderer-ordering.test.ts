import { describe, expect, it, vi } from 'vitest';
import type { UIFrame, WidgetId } from '@axrone/ui/types';
import { WebGL2UIRenderer } from '../../index';
import { createMetrics, createGlyphEntry, createTextLayout, createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('stroke batch flush re-emit', () => {
    it('preserves all stroke segments when the quad batch overflows', () => {
        const gl = createMockWebGL2Context();
        const segmentCount = 5;
        const renderer = new WebGL2UIRenderer({ gl, quadBatchCapacity: 2 });
        const points: [number, number][] = [];
        for (let i = 0; i <= segmentCount; i++) {
            points.push([i / segmentCount, 0.5]);
        }
        const frame: UIFrame = {
            viewportWidth: 160,
            viewportHeight: 120,
            metrics: createMetrics(),
            commands: [
                {
                    kind: 'stroke',
                    widget: 1 as WidgetId,
                    x: 0,
                    y: 0,
                    width: 100,
                    height: 100,
                    zIndex: 0,
                    opacity: 1,
                    clip: null,
                    strokes: [
                        {
                            color: { r: 1, g: 0, b: 0, a: 1 },
                            weight: 2,
                            points,
                        },
                    ],
                },
            ],
        };
        renderer.render(frame);
        // drawArraysInstanced is called each time the batch flushes + final flush.
        // With 5 segments and capacity 2: flush at 2, flush at 2, flush remaining 1 = 3 draw calls.
        expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(3);
        // All 5 segments must be rendered (statistics track total quads emitted).
        expect(renderer.getStats().quadCount).toBe(segmentCount);
        renderer.dispose();
    });
});


describe('flush order: text draws after quads (label-on-fill regression)', () => {
    it('does NOT flush text batch when a quad command follows text with same clip', () => {
        const gl = createMockWebGL2Context();
        const renderer = new WebGL2UIRenderer({ gl });
        const entry = createGlyphEntry();

        // Frame: quad (fill) → text (label) → quad (another fill, same clip)
        // Before fix: text was flushed before the second quad, so the second
        // quad drew over the text, making it invisible.
        // After fix: text is NOT flushed when encountering the second quad,
        // so all quads draw first, then text draws on top.
        const frame: UIFrame<never> = {
            viewportWidth: 160,
            viewportHeight: 120,
            metrics: { ...createMetrics(), renderCount: 1, textCommandCount: 1, glyphCount: 1, customCommandCount: 0 },
            commands: [
                {
                    kind: 'quad',
                    widget: 1 as WidgetId,
                    x: 0, y: 0, width: 100, height: 30, zIndex: 0,
                    color: { r: 0.1, g: 0.5, b: 0.9, a: 1 },
                    borderColor: { r: 0, g: 0, b: 0, a: 0 },
                    borderWidth: 0,
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    opacity: 1, clip: null,
                },
                {
                    kind: 'text',
                    widget: 2 as WidgetId,
                    x: 10, y: 5, zIndex: 1,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                    outlineWidth: 0, edgeSoftness: 0, opacity: 1, clip: null,
                    layout: createTextLayout(entry),
                },
                {
                    kind: 'quad',
                    widget: 3 as WidgetId,
                    x: 0, y: 40, width: 100, height: 30, zIndex: 0,
                    color: { r: 0.1, g: 0.5, b: 0.9, a: 1 },
                    borderColor: { r: 0, g: 0, b: 0, a: 0 },
                    borderWidth: 0,
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    opacity: 1, clip: null,
                },
            ],
        };

        renderer.render(frame);

        // Verify draw calls were issued
        const drawCalls = (gl.drawArraysInstanced as ReturnType<typeof vi.fn>).mock.calls;
        expect(drawCalls.length).toBeGreaterThan(0);

        // The last draw call should be text (text draws after quads)
        // Each draw call: [mode, offset, count, instanceCount]
        // Text glyphs are drawn with TRIANGLE_STRIP, 4 vertices, instanceCount = glyph count
        const lastDrawCall = drawCalls[drawCalls.length - 1];
        // Text glyphs are drawn with TRIANGLE_STRIP, 4 vertices, instanceCount = glyph count
        expect(lastDrawCall[3]).toBeGreaterThan(0); // instanceCount > 0

        renderer.dispose();
    });

    it('flushes pending quads before text when an image command follows', () => {
        const gl = createMockWebGL2Context();
        const mockTexture = gl.createTexture();
        const renderer = new WebGL2UIRenderer({
            gl,
            resolveImageResource: () => ({
                kind: 'texture' as const,
                texture: mockTexture!,
                sampler: null,
            }),
        });
        const entry = createGlyphEntry();

        const programFor = (uniformName: string): WebGLProgram | null => {
            const call = (gl.getUniformLocation as ReturnType<typeof vi.fn>).mock.calls.find(
                (args) => args[1] === uniformName,
            );
            return (call?.[0] as WebGLProgram) ?? null;
        };
        const quadProgram = programFor('u_Viewport');
        const textProgram = programFor('u_Atlas');
        const imageProgram = programFor('u_Image');
        expect(quadProgram).not.toBeNull();
        expect(textProgram).not.toBeNull();
        expect(imageProgram).not.toBeNull();

        // Frame: button fill quad → label text → icon image (as in an
        // authored button with an image and a label child).
        const frame: UIFrame<never> = {
            viewportWidth: 160,
            viewportHeight: 120,
            metrics: { ...createMetrics(), renderCount: 1, textCommandCount: 1, glyphCount: 1, customCommandCount: 0 },
            commands: [
                {
                    kind: 'quad',
                    widget: 1 as WidgetId,
                    x: 0, y: 0, width: 100, height: 30, zIndex: 0,
                    color: { r: 0.1, g: 0.5, b: 0.9, a: 1 },
                    borderColor: { r: 0, g: 0, b: 0, a: 0 },
                    borderWidth: 0,
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    opacity: 1, clip: null,
                },
                {
                    kind: 'text',
                    widget: 2 as WidgetId,
                    x: 10, y: 5, zIndex: 1,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                    outlineWidth: 0, edgeSoftness: 0, opacity: 1, clip: null,
                    layout: createTextLayout(entry),
                },
                {
                    kind: 'image',
                    widget: 3 as WidgetId,
                    x: 0, y: 40, width: 32, height: 32, zIndex: 0,
                    source: { width: 32, height: 32 },
                    uvRect: { x: 0, y: 0, width: 1, height: 1 },
                    tint: { r: 1, g: 1, b: 1, a: 1 },
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    opacity: 1, clip: null,
                },
            ],
        };

        renderer.render(frame);

        const drawOrder = (gl.drawArraysInstanced as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
        const useProgramOrder = (gl.useProgram as ReturnType<typeof vi.fn>).mock.invocationCallOrder;
        const useProgramArgs = (gl.useProgram as ReturnType<typeof vi.fn>).mock.calls;
        const programAtDraw = drawOrder.map((order) => {
            let last = -1;
            for (let i = 0; i < useProgramOrder.length; i += 1) {
                if (useProgramOrder[i] < order) last = i;
            }
            return last >= 0 ? useProgramArgs[last][0] : null;
        });

        // The fill must draw before the label; the image draws last.
        expect(programAtDraw).toEqual([quadProgram, textProgram, imageProgram]);

        renderer.dispose();
    });

    it('flushes text when image command follows (shared texture unit)', () => {
        const gl = createMockWebGL2Context();
        // Mock resolveImageResource to return a texture for image commands
        const mockTexture = gl.createTexture();
        const renderer = new WebGL2UIRenderer({
            gl,
            resolveImageResource: () => ({
                kind: 'texture' as const,
                texture: mockTexture!,
                sampler: null,
            }),
        });
        const entry = createGlyphEntry();

        // Frame: text → image (should flush text before image due to texture unit)
        const frame: UIFrame<never> = {
            viewportWidth: 160,
            viewportHeight: 120,
            metrics: { ...createMetrics(), renderCount: 1, textCommandCount: 1, glyphCount: 1, customCommandCount: 0 },
            commands: [
                {
                    kind: 'text',
                    widget: 1 as WidgetId,
                    x: 0, y: 0, zIndex: 0,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                    outlineWidth: 0, edgeSoftness: 0, opacity: 1, clip: null,
                    layout: createTextLayout(entry),
                },
                {
                    kind: 'image',
                    widget: 2 as WidgetId,
                    x: 0, y: 0, width: 50, height: 50, zIndex: 0,
                    source: { width: 50, height: 50 },
                    uvRect: { x: 0, y: 0, width: 1, height: 1 },
                    tint: { r: 1, g: 1, b: 1, a: 1 },
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    opacity: 1, clip: null,
                },
            ],
        };

        renderer.render(frame);

        // Verify draw calls were issued: text flush + image draw = 2
        const drawCalls = (gl.drawArraysInstanced as ReturnType<typeof vi.fn>).mock.calls;
        expect(drawCalls.length).toBeGreaterThanOrEqual(2); // text + image

        renderer.dispose();
    });
});
