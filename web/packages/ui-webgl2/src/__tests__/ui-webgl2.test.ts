import { describe, expect, it, vi } from 'vitest';
import type { GlyphAtlasEntry, TextLayoutResult, UIFrame, UIFrameMetrics, WidgetId } from '@axrone/ui';
import { WebGL2UIRenderer, createUIOverlayRenderPipelineBackend } from '../index';

const createMetrics = (): UIFrameMetrics => ({
    widgetCount: 2,
    visibleWidgetCount: 2,
    renderCount: 2,
    customCommandCount: 1,
    textCommandCount: 1,
    glyphCount: 1,
    layoutPasses: 1,
});

const createGlyphEntry = (): GlyphAtlasEntry => ({
    faceId: 1 as GlyphAtlasEntry['faceId'],
    page: 1 as GlyphAtlasEntry['page'],
    pageWidth: 64,
    pageHeight: 64,
    codePoint: 65,
    x: 4,
    y: 6,
    width: 12,
    height: 16,
    format: 'alpha8',
    rowStride: 12,
    u0: 4 / 64,
    v0: 6 / 64,
    u1: 16 / 64,
    v1: 22 / 64,
    data: new Uint8Array(12 * 16).fill(255),
});

const createTextLayout = (entry: GlyphAtlasEntry): TextLayoutResult => ({
    faceId: entry.faceId,
    width: 14,
    height: 16,
    lineHeight: 16,
    baseline: 12,
    lines: [
        {
            index: 0,
            start: 0,
            end: 1,
            x: 0,
            y: 0,
            width: 14,
            height: 16,
            ascent: 12,
            descent: 4,
            gapCount: 0,
        },
    ],
    glyphs: [
        {
            codePoint: 65,
            clusterIndex: 0,
            x: 2,
            y: 3,
            advance: 14,
            line: 0,
            text: 'A',
            atlasEntry: entry,
        },
    ],
    truncated: false,
    direction: 'ltr',
    text: 'A',
});

const createFrame = (): UIFrame<{ readonly kind: 'pulse' }> => {
    const glyphEntry = createGlyphEntry();
    return {
        viewportWidth: 160,
        viewportHeight: 120,
        metrics: createMetrics(),
        commands: [
            {
                kind: 'quad',
                widget: 1 as WidgetId,
                x: 8,
                y: 10,
                width: 48,
                height: 20,
                zIndex: 0,
                color: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
                borderColor: { r: 1, g: 1, b: 1, a: 0.5 },
                borderWidth: 2,
                radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
                opacity: 1,
                clip: { x: 4, y: 8, width: 80, height: 40 },
            },
            {
                kind: 'text',
                widget: 2 as WidgetId,
                x: 40,
                y: 48,
                zIndex: 1,
                color: { r: 1, g: 1, b: 1, a: 1 },
                opacity: 0.75,
                clip: { x: 16, y: 20, width: 96, height: 36 },
                layout: createTextLayout(glyphEntry),
            },
            {
                kind: 'custom',
                widget: 2 as WidgetId,
                zIndex: 2,
                clip: { x: 0, y: 0, width: 160, height: 120 },
                payload: { kind: 'pulse' as const },
            },
        ],
    };
};

const createMockWebGL2Context = () => {
    let handleId = 0;
    const makeHandle = (kind: string) => ({ kind, id: ++handleId });
    return {
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        ARRAY_BUFFER: 0x8892,
        STATIC_DRAW: 0x88e4,
        DYNAMIC_DRAW: 0x88e8,
        FLOAT: 0x1406,
        TRIANGLE_STRIP: 0x0005,
        CULL_FACE: 0x0b44,
        DEPTH_TEST: 0x0b71,
        BLEND: 0x0be2,
        SRC_ALPHA: 0x0302,
        ONE_MINUS_SRC_ALPHA: 0x0303,
        SCISSOR_TEST: 0x0c11,
        TEXTURE_2D: 0x0de1,
        TEXTURE0: 0x84c0,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        CLAMP_TO_EDGE: 0x812f,
        LINEAR: 0x2601,
        NEAREST: 0x2600,
        RGBA8: 0x8058,
        RGBA: 0x1908,
        R8: 0x8229,
        RED: 0x1903,
        UNSIGNED_BYTE: 0x1401,
        UNPACK_ALIGNMENT: 0x0cf5,
        createShader: vi.fn(() => makeHandle('shader')),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        getShaderInfoLog: vi.fn(() => ''),
        deleteShader: vi.fn(),
        createProgram: vi.fn(() => makeHandle('program')),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn(() => true),
        getProgramInfoLog: vi.fn(() => ''),
        deleteProgram: vi.fn(),
        getUniformLocation: vi.fn((program, name) => ({ program, name })),
        createBuffer: vi.fn(() => makeHandle('buffer')),
        deleteBuffer: vi.fn(),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        vertexAttribDivisor: vi.fn(),
        createVertexArray: vi.fn(() => makeHandle('vao')),
        deleteVertexArray: vi.fn(),
        bindVertexArray: vi.fn(),
        createTexture: vi.fn(() => makeHandle('texture')),
        deleteTexture: vi.fn(),
        bindTexture: vi.fn(),
        texParameteri: vi.fn(),
        pixelStorei: vi.fn(),
        texImage2D: vi.fn(),
        texSubImage2D: vi.fn(),
        viewport: vi.fn(),
        disable: vi.fn(),
        enable: vi.fn(),
        blendFunc: vi.fn(),
        useProgram: vi.fn(),
        uniform2f: vi.fn(),
        uniform1i: vi.fn(),
        activeTexture: vi.fn(),
        drawArraysInstanced: vi.fn(),
        scissor: vi.fn(),
    } as unknown as WebGL2RenderingContext;
};

describe('@axrone/ui-webgl2', () => {
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

    it('decorates the pipeline backend and renders UI after the base backend ends the frame', async () => {
        const order: string[] = [];
        const frame = createFrame();
        const ui = vi.fn(() => frame);
        const renderer = {
            render: vi.fn(() => {
                order.push('ui');
            }),
        };
        const backend = createUIOverlayRenderPipelineBackend({
            base: {
                beginFrame: vi.fn(async () => {
                    order.push('begin');
                }),
                executePass: vi.fn(async () => {
                    order.push('pass');
                }),
                endFrame: vi.fn(async () => {
                    order.push('base-end');
                }),
            },
            renderer,
            ui,
        });
        const context = {
            viewport: { width: 320, height: 180 },
        } as Parameters<NonNullable<typeof backend.beginFrame>>[0];

        await backend.beginFrame?.(context);
        await backend.executePass?.({} as never, context);
        await backend.endFrame?.({} as never, context);

        expect(order).toEqual(['begin', 'pass', 'base-end', 'ui']);
        expect(ui).toHaveBeenCalledWith({ width: 320, height: 180 });
        expect(renderer.render).toHaveBeenCalledWith(frame);
    });
});