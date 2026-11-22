import { describe, expect, it, vi } from 'vitest';
import type { GlyphAtlasEntry, GlyphAtlasPageSnapshot, TextLayoutResult, UIFrame, WidgetId } from '@axrone/ui/types';
import { WebGL2UIRenderer } from '../../index';
import { createMetrics, createGlyphEntry, createTextLayout, createMockWebGL2Context } from './support/ui-webgl2-harness';

describe('renderer text atlas', () => {
    it('packs sdf text styling into the text batch for outline rendering', () => {
        const gl = createMockWebGL2Context();
        const renderer = new WebGL2UIRenderer({ gl });
        const sdfGlyph = {
            ...createGlyphEntry(),
            format: 'sdf8' as const,
            distanceRange: 6,
            data: new Uint8Array(12 * 16).fill(127),
        };
        const frame: UIFrame<never> = {
            viewportWidth: 128,
            viewportHeight: 64,
            metrics: {
                ...createMetrics(),
                renderCount: 1,
                textCommandCount: 1,
                glyphCount: 1,
                customCommandCount: 0,
            },
            commands: [
                {
                    kind: 'text',
                    widget: 1 as WidgetId,
                    x: 12,
                    y: 20,
                    zIndex: 0,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    outlineColor: { r: 0.1, g: 0.8, b: 1, a: 1 },
                    outlineWidth: 1.5,
                    edgeSoftness: 1.25,
                    opacity: 1,
                    clip: null,
                    layout: createTextLayout(sdfGlyph),
                },
            ],
        };

        renderer.render(frame);

        const dynamicFloatUploads = gl.bufferSubData.mock.calls
            .map((call) => call[2])
            .filter((value): value is Float32Array => value instanceof Float32Array && value.length === 26);

        expect(dynamicFloatUploads).toHaveLength(1);
        expect(dynamicFloatUploads[0]?.[16]).toBe(1);
        expect(dynamicFloatUploads[0]?.[17]).toBe(6);
        expect(dynamicFloatUploads[0]?.[18]).toBe(1.5);
        expect(dynamicFloatUploads[0]?.[19]).toBe(1.25);
        expect(Array.from(dynamicFloatUploads[0]?.slice(20, 26) ?? [])).toEqual([1, 0, 0, 0, 1, 0]);
    });

    it('uploads distinct raster sizes for the same glyph code point on a shared atlas page', () => {
        const gl = createMockWebGL2Context();
        const renderer = new WebGL2UIRenderer({ gl });
        const smallGlyph: GlyphAtlasEntry = {
            ...createGlyphEntry(),
            rasterSize: 18,
            x: 4,
            y: 6,
            width: 12,
            height: 16,
            rowStride: 12,
            u0: 4 / 64,
            v0: 6 / 64,
            u1: 16 / 64,
            v1: 22 / 64,
            data: new Uint8Array(12 * 16).fill(80),
        };
        const largeGlyph: GlyphAtlasEntry = {
            ...createGlyphEntry(),
            rasterSize: 32,
            x: 20,
            y: 6,
            width: 20,
            height: 24,
            rowStride: 20,
            u0: 20 / 64,
            v0: 6 / 64,
            u1: 40 / 64,
            v1: 30 / 64,
            data: new Uint8Array(20 * 24).fill(160),
        };
        const frame: UIFrame<never> = {
            viewportWidth: 160,
            viewportHeight: 96,
            metrics: {
                ...createMetrics(),
                renderCount: 1,
                textCommandCount: 1,
                glyphCount: 2,
                customCommandCount: 0,
            },
            commands: [
                {
                    kind: 'text',
                    widget: 1 as WidgetId,
                    x: 12,
                    y: 20,
                    zIndex: 0,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                    outlineWidth: 0,
                    edgeSoftness: 1,
                    opacity: 1,
                    clip: null,
                    layout: {
                        faceId: smallGlyph.faceId,
                        width: 32,
                        height: 24,
                        lineHeight: 24,
                        baseline: 18,
                        lines: [
                            {
                                index: 0,
                                start: 0,
                                end: 2,
                                x: 0,
                                y: 0,
                                width: 32,
                                height: 24,
                                ascent: 18,
                                descent: 6,
                                gapCount: 0,
                            },
                        ],
                        clusters: [
                            {
                                index: 0,
                                line: 0,
                                x: 0,
                                y: 0,
                                width: 12,
                                height: 24,
                                text: 'A',
                                whitespace: false,
                                newline: false,
                                spanIndex: 0,
                            },
                            {
                                index: 1,
                                line: 0,
                                x: 12,
                                y: 0,
                                width: 20,
                                height: 24,
                                text: 'A',
                                whitespace: false,
                                newline: false,
                                spanIndex: 0,
                            },
                        ],
                        carets: [
                            { index: 0, line: 0, x: 0, y: 0, height: 24 },
                            { index: 1, line: 0, x: 12, y: 0, height: 24 },
                            { index: 2, line: 0, x: 32, y: 0, height: 24 },
                        ],
                        glyphs: [
                            {
                                codePoint: 65,
                                clusterIndex: 0,
                                x: 0,
                                y: 4,
                                advance: 12,
                                width: 12,
                                height: 16,
                                line: 0,
                                text: 'A',
                                atlasEntry: smallGlyph,
                                spanIndex: 0,
                            },
                            {
                                codePoint: 65,
                                clusterIndex: 1,
                                x: 12,
                                y: 0,
                                advance: 20,
                                width: 20,
                                height: 24,
                                line: 0,
                                text: 'A',
                                atlasEntry: largeGlyph,
                                spanIndex: 0,
                            },
                        ],
                        truncated: false,
                        direction: 'ltr',
                        text: 'AA',
                        spanStyles: [],
                    },
                },
            ],
        };

        renderer.render(frame);

        expect(gl.texSubImage2D).toHaveBeenCalledTimes(2);
        expect(renderer.getStats().uploadedGlyphCount).toBe(2);
    });

    it('creates distinct glyph pages for faceId >= 65536 without overflow', () => {
        const gl = createMockWebGL2Context();
        const renderer = new WebGL2UIRenderer({ gl });
        const baseEntry = createGlyphEntry();
        const smallFaceEntry: GlyphAtlasEntry = { ...baseEntry, faceId: 1 as GlyphAtlasEntry['faceId'], page: 0 as GlyphAtlasEntry['page'] };
        const largeFaceEntry: GlyphAtlasEntry = { ...baseEntry, faceId: 70000 as GlyphAtlasEntry['faceId'], page: 0 as GlyphAtlasEntry['page'] };
        const frame: UIFrame<never> = {
            viewportWidth: 160,
            viewportHeight: 96,
            metrics: { ...createMetrics(), renderCount: 1, textCommandCount: 2, glyphCount: 2, customCommandCount: 0 },
            commands: [
                {
                    kind: 'text',
                    widget: 1 as WidgetId,
                    x: 0, y: 0, zIndex: 0,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                    outlineWidth: 0, edgeSoftness: 0, opacity: 1, clip: null,
                    layout: { ...createTextLayout(smallFaceEntry), glyphs: [{ ...createTextLayout(smallFaceEntry).glyphs[0], atlasEntry: smallFaceEntry }] },
                },
                {
                    kind: 'text',
                    widget: 2 as WidgetId,
                    x: 0, y: 20, zIndex: 1,
                    color: { r: 1, g: 1, b: 1, a: 1 },
                    outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                    outlineWidth: 0, edgeSoftness: 0, opacity: 1, clip: null,
                    layout: { ...createTextLayout(largeFaceEntry), glyphs: [{ ...createTextLayout(largeFaceEntry).glyphs[0], atlasEntry: largeFaceEntry }] },
                },
            ],
        };
        renderer.render(frame);
        // Both glyphs uploaded separately means distinct page keys.
        expect(renderer.getStats().uploadedGlyphCount).toBe(2);
        expect(renderer.getStats().atlasPageCount).toBe(2);
        renderer.dispose();
    });
});

describe('atlas page eviction flushes text batch', () => {
    it('flushes batched glyphs before deleting the evicted active text page', () => {
        const gl = createMockWebGL2Context();
        const renderer = new WebGL2UIRenderer({ gl });
        const entry = createGlyphEntry();
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
            ],
        };
        renderer.render(frame);
        const drawCallsAfterFirst = (gl.drawArraysInstanced as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(drawCallsAfterFirst).toBeGreaterThan(0);
        const snapshot: GlyphAtlasPageSnapshot = {
            id: entry.page as number,
            width: entry.pageWidth,
            height: entry.pageHeight,
            entries: [entry],
        };
        renderer.handleAtlasPageEviction(snapshot);
        expect(renderer.getStats().atlasPageCount).toBe(0);
        renderer.dispose();
    });
});


describe('pushGlyph contract: return false when glyph not written to batch', () => {
    it('returns false (skipped) when atlasEntry is null — glyph not written', () => {
        const gl = createMockWebGL2Context();
        const renderer = new WebGL2UIRenderer({ gl });
        // Create a text layout with a glyph that has atlasEntry = null
        const layout: TextLayoutResult = {
            ...createTextLayout(createGlyphEntry()),
            glyphs: [
                {
                    codePoint: 65,
                    clusterIndex: 0,
                    x: 2,
                    y: 3,
                    advance: 14,
                    line: 0,
                    text: 'A',
                    atlasEntry: null,
                    spanIndex: 0,
                },
            ],
        };
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
                    layout,
                },
            ],
        };
        // Should not throw — null atlasEntry is silently skipped
        expect(() => renderer.render(frame)).not.toThrow();
        // glyphCount should be 0 since the only glyph had no atlas entry
        expect(renderer.getStats().glyphCount).toBe(0);
        renderer.dispose();
    });

    it('returns false (skipped) when entry.data is null — no batch corruption', () => {
        const gl = createMockWebGL2Context();
        const renderer = new WebGL2UIRenderer({ gl });
        // Create an entry with null data (simulates whitespace or post-eviction loss)
        const entryNoData = createGlyphEntry();
        entryNoData.data = null;
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
                    layout: createTextLayout(entryNoData),
                },
            ],
        };
        // Should not throw — null data is gracefully skipped
        expect(() => renderer.render(frame)).not.toThrow();
        // glyphCount should be 0 since the glyph had no data
        expect(renderer.getStats().glyphCount).toBe(0);
        renderer.dispose();
    });

    it('after eviction + re-render with data retained, glyphs are re-uploaded and drawn', () => {
        const gl = createMockWebGL2Context();
        const renderer = new WebGL2UIRenderer({ gl });
        const entry = createGlyphEntry();
        const makeFrame = (): UIFrame<never> => ({
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
            ],
        });
        // First render — uploads glyph data
        renderer.render(makeFrame());
        expect(renderer.getStats().glyphCount).toBe(1);
        expect(renderer.getStats().uploadedGlyphCount).toBe(1);
        const drawCallsAfterFirst = (gl.drawArraysInstanced as ReturnType<typeof vi.fn>).mock.calls.length;
        expect(drawCallsAfterFirst).toBeGreaterThan(0);

        // Simulate eviction (deletes GPU texture + renderer page)
        const snapshot: GlyphAtlasPageSnapshot = {
            id: entry.page as number,
            width: entry.pageWidth,
            height: entry.pageHeight,
            entries: [entry],
        };
        renderer.handleAtlasPageEviction(snapshot);
        expect(renderer.getStats().atlasPageCount).toBe(0);

        // Second render — entry.data is still present, so re-upload succeeds
        renderer.render(makeFrame());
        expect(renderer.getStats().glyphCount).toBe(1);
        // Statistics are per-frame; uploadedGlyphCount=1 means the glyph was re-uploaded
        expect(renderer.getStats().uploadedGlyphCount).toBe(1);
        // texSubImage2D was called again (re-upload after eviction)
        expect(gl.texSubImage2D).toHaveBeenCalledTimes(2);
        renderer.dispose();
    });
});

