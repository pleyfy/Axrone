import { createGameLoop } from '@axrone/game-loop';
import { describe, expect, it, vi } from 'vitest';
import type { GlyphAtlasEntry, TextLayoutResult, UIFrame, UIFrameMetrics, WidgetId } from '@axrone/ui';
import {
    WebGL2UIRenderer,
    attachUIOverlayToScene,
    createSceneUIResourceResolver,
    createManagedWebGL2UIOverlayRenderPipelineBackend,
    createUIOverlayRenderPipelineBackend,
} from '../index';

const createMetrics = (): UIFrameMetrics => ({
    widgetCount: 2,
    visibleWidgetCount: 2,
    renderCount: 2,
    customCommandCount: 1,
    imageCommandCount: 0,
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
    distanceRange: 1,
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
    clusters: [
        {
            index: 0,
            line: 0,
            x: 2,
            y: 0,
            width: 14,
            height: 16,
            text: 'A',
            whitespace: false,
            newline: false,
        },
    ],
    carets: [
        { index: 0, line: 0, x: 2, y: 0, height: 16 },
        { index: 1, line: 0, x: 16, y: 0, height: 16 },
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
                outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                outlineWidth: 0,
                edgeSoftness: 1,
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
        bindSampler: vi.fn(),
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

    it('lazily creates, reuses, and disposes managed renderers across WebGL context changes', async () => {
        const glA = createMockWebGL2Context();
        const glB = createMockWebGL2Context();
        const frame = createFrame();
        const backend = createManagedWebGL2UIOverlayRenderPipelineBackend({
            ui: () => frame,
            getGL: ({ context }) => (context.frame < 2 ? glA : glB),
        });
        const contextFor = (frameIndex: number) =>
            ({
                frame: frameIndex,
                viewport: { width: 160, height: 120 },
            }) as Parameters<NonNullable<typeof backend.endFrame>>[1];
        const result = {
            frame: 0,
            viewport: { width: 160, height: 120 },
            passes: [],
            resources: [],
            statistics: createMetrics() as never,
            degraded: false,
            warnings: [],
        } as Parameters<NonNullable<typeof backend.endFrame>>[0];

        await backend.endFrame?.(result, contextFor(0));
        await backend.endFrame?.(result, contextFor(1));

        expect(glA.createProgram).toHaveBeenCalledTimes(3);
        expect(glA.deleteProgram).not.toHaveBeenCalled();

        await backend.endFrame?.(result, contextFor(2));

        expect(glB.createProgram).toHaveBeenCalledTimes(3);
        expect(glA.deleteProgram).toHaveBeenCalledTimes(3);

        backend.dispose();

        expect(glB.deleteProgram).toHaveBeenCalledTimes(3);
    });

    it('attaches UI rendering to the scene after-frame hook', () => {
        const gl = createMockWebGL2Context();
        const loop = createGameLoop({
            state: { sceneId: 'scene:test' },
            autoStart: false,
        });
        const frame = createFrame();
        const overlay = attachUIOverlayToScene(
            {
                gl,
                canvas: { width: 320, height: 180 } as HTMLCanvasElement,
                loop,
            },
            {
                systemId: 'ui.overlay.test',
                ui: () => frame,
            }
        );
        const system = loop.getSystem('ui.overlay.test');

        expect(system).toBeDefined();
        system?.afterFrame?.({} as never);

        expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(2);
        expect(overlay.render()).toBe(frame);

        overlay.dispose();

        expect(loop.getSystem('ui.overlay.test')).toBeUndefined();
        expect(gl.deleteProgram).toHaveBeenCalledTimes(3);
    });

    it('renders texture images and delegates material-backed image commands', () => {
        const gl = createMockWebGL2Context();
        const texture = { id: 'texture:image' } as unknown as WebGLTexture;
        const sampler = { id: 'sampler:image' } as unknown as WebGLSampler;
        const materialRender = vi.fn();
        const renderer = new WebGL2UIRenderer({
            gl,
            resolveImageResource(source) {
                if (source.kind === 'material') {
                    return {
                        kind: 'material',
                        render: materialRender,
                    };
                }
                return {
                    kind: 'texture',
                    texture,
                    sampler,
                };
            },
        });
        const frame: UIFrame<never> = {
            viewportWidth: 128,
            viewportHeight: 96,
            metrics: {
                ...createMetrics(),
                renderCount: 2,
                imageCommandCount: 2,
                textCommandCount: 0,
                customCommandCount: 0,
                glyphCount: 0,
            },
            commands: [
                {
                    kind: 'image',
                    widget: 1 as WidgetId,
                    source: {
                        kind: 'texture',
                        resourceId: 'ui:texture',
                        width: 32,
                        height: 32,
                    },
                    x: 8,
                    y: 10,
                    width: 32,
                    height: 32,
                    zIndex: 0,
                    tint: { r: 1, g: 1, b: 1, a: 1 },
                    opacity: 1,
                    sampling: 'linear',
                    radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
                    clip: null,
                    uvRect: { x: 0, y: 0, width: 1, height: 1 },
                },
                {
                    kind: 'image',
                    widget: 2 as WidgetId,
                    source: {
                        kind: 'material',
                        materialId: 'ui:material',
                        width: 48,
                        height: 24,
                    },
                    x: 40,
                    y: 18,
                    width: 48,
                    height: 24,
                    zIndex: 1,
                    tint: { r: 1, g: 1, b: 1, a: 1 },
                    opacity: 0.85,
                    sampling: 'nearest',
                    radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                    clip: { x: 0, y: 0, width: 96, height: 80 },
                    uvRect: { x: 0, y: 0, width: 1, height: 1 },
                },
            ],
        };

        renderer.render(frame);

        expect(gl.drawArraysInstanced).toHaveBeenCalledTimes(1);
    expect(gl.bindSampler).toHaveBeenCalledWith(0, sampler);
        expect(materialRender).toHaveBeenCalledTimes(1);
        expect(renderer.getStats()).toEqual({
            drawCalls: 1,
            quadCount: 0,
            imageCount: 2,
            materialImageCount: 1,
            glyphCount: 0,
            customCommandCount: 0,
            uploadedGlyphCount: 0,
            atlasPageCount: 0,
        });
    });

    it('resolves scene texture and material image sources into native WebGL handles', () => {
        const nativeTexture = { id: 'native:texture' } as unknown as WebGLTexture;
        const nativeSampler = { id: 'native:sampler' } as unknown as WebGLSampler;
        const scene = {
            getTextureResource: vi.fn((id: string) =>
                id === 'scene:icon'
                    ? {
                          id,
                          width: 64,
                          height: 64,
                          samplerId: 'ui',
                          nativeTexture,
                          nativeSampler,
                      }
                    : null
            ),
            getMaterialTextureBinding: vi.fn((materialId: string, uniformName?: string) =>
                materialId === 'scene:card' && uniformName === 'u_BaseColor'
                    ? {
                          materialId,
                          uniformName,
                          textureId: 'scene:albedo',
                          samplerId: 'ui',
                          unit: 0,
                          width: 128,
                          height: 128,
                          nativeTexture,
                          nativeSampler,
                      }
                    : null
            ),
        };
        const resolver = createSceneUIResourceResolver(scene, {
            materialTextureBinding: 'u_BaseColor',
        });
        const context = {
            gl: createMockWebGL2Context(),
            frame: createFrame(),
            command: {
                kind: 'image',
                widget: 1 as WidgetId,
                source: {
                    kind: 'texture',
                    resourceId: 'scene:icon',
                    width: 64,
                    height: 64,
                },
                x: 0,
                y: 0,
                width: 64,
                height: 64,
                zIndex: 0,
                tint: { r: 1, g: 1, b: 1, a: 1 },
                opacity: 1,
                sampling: 'linear' as const,
                radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                clip: null,
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
            },
        };

        const textureResource = resolver(
            {
                kind: 'texture',
                resourceId: 'scene:icon',
                width: 64,
                height: 64,
            },
            context
        );
        const materialResource = resolver(
            {
                kind: 'material',
                materialId: 'scene:card',
                textureBinding: 'u_BaseColor',
                width: 128,
                height: 128,
            },
            {
                ...context,
                command: {
                    ...context.command,
                    source: {
                        kind: 'material',
                        materialId: 'scene:card',
                        textureBinding: 'u_BaseColor',
                        width: 128,
                        height: 128,
                    },
                },
            }
        );

        expect(textureResource).toEqual({ kind: 'texture', texture: nativeTexture, sampler: nativeSampler });
        expect(materialResource).toEqual({ kind: 'texture', texture: nativeTexture, sampler: nativeSampler });
        expect(scene.getTextureResource).toHaveBeenCalledWith('scene:icon');
        expect(scene.getMaterialTextureBinding).toHaveBeenCalledWith('scene:card', 'u_BaseColor');
    });

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

        const dynamicFloatUploads = gl.bufferData.mock.calls
            .map((call) => call[1])
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
                            },
                        ],
                        truncated: false,
                        direction: 'ltr',
                        text: 'AA',
                    },
                },
            ],
        };

        renderer.render(frame);

        expect(gl.texSubImage2D).toHaveBeenCalledTimes(2);
        expect(renderer.getStats().uploadedGlyphCount).toBe(2);
    });
});
