import { describe, expect, it } from 'vitest';
import type {
    GlyphAtlasEntry,
    GlyphAtlasPageSnapshot,
    TextLayoutResult,
    UIFrame,
    UIFrameMetrics,
    WidgetId,
} from '@axrone/ui/types';
import { Rect } from '@axrone/numeric';
import { WebGL2UIRenderer } from '../index';
import { FrameGLState } from '../frame-gl-state';
import { GlyphAtlasPages } from '../glyph-atlas-pages';
import { GL_STATE_FRAMEBUFFER } from '../gl-state';
import { ImageBatch } from '../image-batch';
import { QuadBatch } from '../quad-batch';
import { RenderHost } from '../render-host';
import { RenderPipelines } from '../render-pipelines';
import { createRendererStatisticsState, getRendererStatistics } from '../renderer-statistics';
import { TextBatch } from '../text-batch';
import type { WebGL2UIRenderOptions } from '../types';

type RecordedCall = { readonly name: string; readonly text: string };

const createRecordingGL = () => {
    const calls: RecordedCall[] = [];
    const state = {
        enabled: new Set<number>(),
        viewport: [0, 0, 0, 0],
        scissorBox: [0, 0, 0, 0],
        framebuffer: null as WebGLFramebuffer | null,
        currentProgram: null as WebGLProgram | null,
        vertexArray: null as WebGLVertexArrayObject | null,
        arrayBuffer: null as WebGLBuffer | null,
        unpackAlignment: 4,
        activeTexture: 0x84c0,
        textureBindings: new Map<number, WebGLTexture | null>(),
        samplerBindings: new Map<number, WebGLSampler | null>(),
        blendFunc: [0x0302, 0x0303, 0x0302, 0x0303] as [number, number, number, number],
    };
    let handleId = 0;
    const makeHandle = (kind: string) => ({ kind, id: ++handleId });
    const show = (value: unknown): string => {
        if (value === null) {
            return 'null';
        }
        if (value === undefined) {
            return 'undefined';
        }
        if (typeof value === 'object') {
            const handle = value as { kind?: string; id?: number; name?: string; program?: { id?: number } };
            if (handle.kind !== undefined && handle.id !== undefined) {
                return `${handle.kind}#${handle.id}`;
            }
            if (handle.name !== undefined) {
                return `uniform(${handle.program?.id ?? 0}.${handle.name})`;
            }
            if (value instanceof Float32Array) {
                return `[${Array.from(value).join(',')}]`;
            }
            if (value instanceof Uint8Array) {
                return `Uint8Array(${value.length})`;
            }
            return 'object';
        }
        return String(value);
    };
    const record =
        (name: string) =>
        (...args: unknown[]): void => {
            calls.push({ name, text: `${name}(${args.map(show).join(',')})` });
        };
    const gl = {
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
        TEXTURE1: 0x84c1,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        VIEWPORT: 0x0ba2,
        SCISSOR_BOX: 0x0c10,
        CURRENT_PROGRAM: 0x8b8d,
        VERTEX_ARRAY_BINDING: 0x85b5,
        ARRAY_BUFFER_BINDING: 0x8894,
        ACTIVE_TEXTURE: 0x84e0,
        TEXTURE_BINDING_2D: 0x8069,
        SAMPLER_BINDING: 0x8919,
        FRAMEBUFFER: 0x8d40,
        FRAMEBUFFER_BINDING: 0x8ca6,
        UNPACK_ALIGNMENT: 0x0cf5,
        BLEND_SRC_RGB: 0x80c9,
        BLEND_DST_RGB: 0x80c8,
        BLEND_SRC_ALPHA: 0x80cb,
        BLEND_DST_ALPHA: 0x80ca,
        CLAMP_TO_EDGE: 0x812f,
        LINEAR: 0x2601,
        NEAREST: 0x2600,
        RGBA8: 0x8058,
        RGBA: 0x1908,
        R8: 0x8229,
        RED: 0x1903,
        UNSIGNED_BYTE: 0x1401,
        createShader: (type: number) => {
            record('createShader')(type);
            return makeHandle('shader');
        },
        shaderSource: record('shaderSource'),
        compileShader: record('compileShader'),
        getShaderParameter: () => true,
        getShaderInfoLog: () => '',
        deleteShader: record('deleteShader'),
        createProgram: () => {
            record('createProgram')();
            return makeHandle('program');
        },
        attachShader: record('attachShader'),
        linkProgram: record('linkProgram'),
        getProgramParameter: () => true,
        getProgramInfoLog: () => '',
        deleteProgram: record('deleteProgram'),
        getUniformLocation: (program: WebGLProgram, name: string) => ({ program, name }),
        createBuffer: () => {
            record('createBuffer')();
            return makeHandle('buffer');
        },
        deleteBuffer: record('deleteBuffer'),
        bindBuffer: (target: number, buffer: WebGLBuffer | null) => {
            record('bindBuffer')(target, buffer);
            if (target === 0x8892) {
                state.arrayBuffer = buffer;
            }
        },
        bufferData: record('bufferData'),
        bufferSubData: record('bufferSubData'),
        enableVertexAttribArray: record('enableVertexAttribArray'),
        vertexAttribPointer: record('vertexAttribPointer'),
        vertexAttribDivisor: record('vertexAttribDivisor'),
        createVertexArray: () => {
            record('createVertexArray')();
            return makeHandle('vao');
        },
        deleteVertexArray: record('deleteVertexArray'),
        bindVertexArray: (vao: WebGLVertexArrayObject | null) => {
            record('bindVertexArray')(vao);
            state.vertexArray = vao;
        },
        createTexture: () => {
            record('createTexture')();
            return makeHandle('texture');
        },
        deleteTexture: record('deleteTexture'),
        bindTexture: (target: number, texture: WebGLTexture | null) => {
            record('bindTexture')(target, texture);
            state.textureBindings.set(state.activeTexture, texture);
        },
        bindSampler: (unit: number, sampler: WebGLSampler | null) => {
            record('bindSampler')(unit, sampler);
            state.samplerBindings.set(unit, sampler);
        },
        texParameteri: record('texParameteri'),
        pixelStorei: (parameter: number, value: number) => {
            record('pixelStorei')(parameter, value);
            if (parameter === 0x0cf5) {
                state.unpackAlignment = value;
            }
        },
        texImage2D: record('texImage2D'),
        texSubImage2D: record('texSubImage2D'),
        viewport: (x: number, y: number, width: number, height: number) => {
            record('viewport')(x, y, width, height);
            state.viewport = [x, y, width, height];
        },
        disable: (capability: number) => {
            record('disable')(capability);
            state.enabled.delete(capability);
        },
        enable: (capability: number) => {
            record('enable')(capability);
            state.enabled.add(capability);
        },
        blendFunc: (src: number, dst: number) => {
            record('blendFunc')(src, dst);
            state.blendFunc = [src, dst, src, dst];
        },
        blendFuncSeparate: (srcRgb: number, dstRgb: number, srcAlpha: number, dstAlpha: number) => {
            record('blendFuncSeparate')(srcRgb, dstRgb, srcAlpha, dstAlpha);
            state.blendFunc = [srcRgb, dstRgb, srcAlpha, dstAlpha];
        },
        useProgram: (program: WebGLProgram | null) => {
            record('useProgram')(program);
            state.currentProgram = program;
        },
        uniform2f: record('uniform2f'),
        uniform1i: record('uniform1i'),
        activeTexture: (textureUnit: number) => {
            record('activeTexture')(textureUnit);
            state.activeTexture = textureUnit;
        },
        drawArraysInstanced: (...args: unknown[]) => {
            record('drawArraysInstanced')(...args);
        },
        getError: () => 0,
        scissor: (x: number, y: number, width: number, height: number) => {
            record('scissor')(x, y, width, height);
            state.scissorBox = [x, y, width, height];
        },
        bindFramebuffer: (target: number, framebuffer: WebGLFramebuffer | null) => {
            record('bindFramebuffer')(target, framebuffer);
            state.framebuffer = framebuffer;
        },
        getParameter: (parameter: number) => {
            switch (parameter) {
                case 0x0ba2:
                    return state.viewport;
                case 0x0c10:
                    return state.scissorBox;
                case 0x8b8d:
                    return state.currentProgram;
                case 0x85b5:
                    return state.vertexArray;
                case 0x8894:
                    return state.arrayBuffer;
                case 0x84e0:
                    return state.activeTexture;
                case 0x8069:
                    return state.textureBindings.get(state.activeTexture) ?? null;
                case 0x8919:
                    return state.samplerBindings.get(state.activeTexture - 0x84c0) ?? null;
                case 0x8ca6:
                    return state.framebuffer;
                case 0x0cf5:
                    return state.unpackAlignment;
                case 0x80c9:
                    return state.blendFunc[0];
                case 0x80c8:
                    return state.blendFunc[1];
                case 0x80cb:
                    return state.blendFunc[2];
                case 0x80ca:
                    return state.blendFunc[3];
                default:
                    return null;
            }
        },
        isEnabled: (capability: number) => state.enabled.has(capability),
        isContextLost: () => false,
    } as unknown as WebGL2RenderingContext;
    return { gl, calls, state };
};

const callNames = (calls: readonly RecordedCall[]): string[] => calls.map((call) => call.name);

const hashCallSequence = (calls: readonly RecordedCall[]): string => {
    const text = calls.map((call) => call.text).join('\n');
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${calls.length}:${hash.toString(16)}`;
};

const createMetrics = (): UIFrameMetrics => ({
    widgetCount: 0,
    visibleWidgetCount: 0,
    renderCount: 0,
    customCommandCount: 0,
    imageCommandCount: 0,
    textCommandCount: 0,
    strokeCommandCount: 0,
    glyphCount: 0,
    layoutPasses: 0,
});

const createGlyphEntry = (page: number, codePoint: number): GlyphAtlasEntry => ({
    faceId: 1 as GlyphAtlasEntry['faceId'],
    page: page as GlyphAtlasEntry['page'],
    pageWidth: 64,
    pageHeight: 64,
    codePoint,
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

const createTextLayout = (entry: GlyphAtlasEntry): TextLayoutResult =>
    ({
        faceId: entry.faceId,
        width: 14,
        height: 16,
        lineHeight: 16,
        baseline: 12,
        lines: [],
        clusters: [],
        carets: [],
        glyphs: [
            {
                codePoint: entry.codePoint,
                clusterIndex: 0,
                x: 2,
                y: 3,
                advance: 14,
                line: 0,
                text: 'A',
                atlasEntry: entry,
                spanIndex: 0,
            },
        ],
        truncated: false,
        direction: 'ltr',
        text: 'A',
        spanStyles: [],
    }) as unknown as TextLayoutResult;

const createCommandFrame = <TPayload>(): UIFrame<TPayload> => {
    const pageOneGlyph = createGlyphEntry(1, 65);
    const pageTwoGlyph = createGlyphEntry(2, 66);
    const texture = {
        kind: 'texture' as const,
        resourceId: 'ui:texture',
        width: 32,
        height: 32,
    };
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
                kind: 'quad',
                widget: 1 as WidgetId,
                x: 8,
                y: 10,
                width: 48,
                height: 20,
                zIndex: 1,
                color: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
                borderColor: { r: 1, g: 1, b: 1, a: 0.5 },
                borderWidth: 2,
                radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
                opacity: 1,
                clip: { x: 4, y: 8, width: 80, height: 40 },
            },
            {
                kind: 'stroke',
                widget: 2 as WidgetId,
                x: 10,
                y: 20,
                width: 100,
                height: 60,
                zIndex: 2,
                opacity: 0.8,
                clip: { x: 4, y: 8, width: 80, height: 40 },
                strokes: [
                    {
                        color: { r: 1, g: 0, b: 0, a: 1 },
                        weight: 2,
                        points: [
                            [0, 0],
                            [0.5, 0.5],
                            [1, 0.25],
                        ],
                    },
                ],
            },
            {
                kind: 'image',
                widget: 3 as WidgetId,
                source: texture,
                x: 8,
                y: 10,
                width: 32,
                height: 32,
                zIndex: 3,
                tint: { r: 1, g: 1, b: 1, a: 1 },
                opacity: 1,
                sampling: 'linear',
                radius: { topLeft: 4, topRight: 4, bottomRight: 4, bottomLeft: 4 },
                clip: null,
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
            },
            {
                kind: 'image',
                widget: 4 as WidgetId,
                source: texture,
                x: 50,
                y: 12,
                width: 90,
                height: 60,
                zIndex: 4,
                tint: { r: 1, g: 1, b: 0, a: 1 },
                opacity: 0.6,
                sampling: 'linear',
                radius: { topLeft: 2, topRight: 2, bottomRight: 2, bottomLeft: 2 },
                clip: { x: 4, y: 8, width: 80, height: 40 },
                border: { left: 8, top: 8, right: 8, bottom: 8 },
                fillCenter: true,
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
            },
            {
                kind: 'text',
                widget: 5 as WidgetId,
                x: 40,
                y: 48,
                zIndex: 5,
                color: { r: 1, g: 1, b: 1, a: 1 },
                outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                outlineWidth: 0,
                edgeSoftness: 1,
                opacity: 0.75,
                clip: { x: 16, y: 20, width: 96, height: 36 },
                layout: createTextLayout(pageOneGlyph),
            },
            {
                kind: 'image',
                widget: 6 as WidgetId,
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
                zIndex: 6,
                tint: { r: 1, g: 1, b: 1, a: 1 },
                opacity: 0.85,
                sampling: 'nearest',
                radius: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
                clip: { x: 0, y: 0, width: 96, height: 80 },
                uvRect: { x: 0, y: 0, width: 1, height: 1 },
            },
            {
                kind: 'text',
                widget: 7 as WidgetId,
                x: 20,
                y: 70,
                zIndex: 7,
                color: { r: 0, g: 1, b: 0, a: 1 },
                outlineColor: { r: 1, g: 1, b: 1, a: 1 },
                outlineWidth: 1,
                edgeSoftness: 0.5,
                opacity: 1,
                clip: null,
                layout: createTextLayout(pageTwoGlyph),
            },
            {
                kind: 'custom',
                widget: 8 as WidgetId,
                zIndex: 8,
                clip: { x: 0, y: 0, width: 160, height: 120 },
                payload: { kind: 'pulse' },
            },
        ],
    } as unknown as UIFrame<TPayload>;
};

type TestPayload = { readonly kind: 'pulse' };

const createResolveImageResource = (calls: RecordedCall[]) =>
    (source: { readonly kind: string }) => {
        if (source.kind === 'material') {
            return {
                kind: 'material' as const,
                render: (context: { readonly command: { readonly x: number } }) => {
                    calls.push({
                        name: 'materialRender',
                        text: `materialRender(${context.command.x})`,
                    });
                },
            };
        }
        return {
            kind: 'texture' as const,
            texture: { kind: 'texture', id: 900 } as unknown as WebGLTexture,
            sampler: { kind: 'sampler', id: 901 } as unknown as WebGLSampler,
        };
    };

const createCustomCommandRenderer = (gl: WebGL2RenderingContext, calls: RecordedCall[]) => () => {
    calls.push({ name: 'customRender', text: 'customRender' });
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, { kind: 'texture', id: 902 } as unknown as WebGLTexture);
};

const renderWithRenderer = (
    gl: WebGL2RenderingContext,
    calls: RecordedCall[],
    frame: UIFrame<TestPayload>,
    options: WebGL2UIRenderOptions | undefined
) => {
    const renderer = new WebGL2UIRenderer<TestPayload>({
        gl,
        quadBatchCapacity: 3,
        imageBatchCapacity: 2,
        glyphBatchCapacity: 2,
        resolveImageResource: createResolveImageResource(calls),
        customCommandRenderer: createCustomCommandRenderer(gl, calls),
    });
    renderer.render(frame, options);
    return { calls, statistics: renderer.getStats() };
};

const renderWithExtractedModules = (
    gl: WebGL2RenderingContext,
    calls: RecordedCall[],
    frame: UIFrame<TestPayload>,
    options: WebGL2UIRenderOptions | undefined
) => {
    const statistics = createRendererStatisticsState();
    const state = new FrameGLState(gl);
    const quads = new QuadBatch<TestPayload>(3);
    const images = new ImageBatch<TestPayload>(2);
    const pages = new GlyphAtlasPages(gl, 'linear');
    const texts = new TextBatch<TestPayload>(2, pages);
    const pipelines = new RenderPipelines({
        gl,
        quadBatchByteLength: quads.byteLength,
        imageBatchByteLength: images.byteLength,
        textBatchByteLength: texts.byteLength,
    });
    const host = new RenderHost<TestPayload>({
        gl,
        state,
        statistics,
        pipelines,
        resolveImageResource: createResolveImageResource(calls),
    });
    const customCommandRenderer = createCustomCommandRenderer(gl, calls);

    host.currentFrame = frame;
    host.resetStatistics();
    quads.reset();
    images.reset();
    texts.reset();

    try {
        if (options && 'framebuffer' in options) {
            state.capture(GL_STATE_FRAMEBUFFER);
            state.touch(GL_STATE_FRAMEBUFFER);
            gl.bindFramebuffer(gl.FRAMEBUFFER, options.framebuffer ?? null);
        }
        state.prepareFrame(frame.viewportWidth, frame.viewportHeight);

        let hasPendingImages = false;
        let hasPendingText = false;
        let pendingImageZIndex = -1;

        for (const command of frame.commands) {
            if (command.kind === 'quad') {
                if (hasPendingImages && pendingImageZIndex < command.zIndex) {
                    images.flush(frame.viewportHeight, host);
                    hasPendingImages = false;
                    pendingImageZIndex = -1;
                }
                if (
                    quads.activeClip !== (command.clip ?? null) &&
                    !Rect.equals(quads.activeClip, command.clip as never)
                ) {
                    quads.flush(frame.viewportHeight, host);
                    quads.setActiveClip(command.clip ?? null);
                }
                quads.push(command, frame.viewportHeight, host);
                continue;
            }
            if (command.kind === 'image') {
                if (hasPendingText) {
                    quads.flush(frame.viewportHeight, host);
                    texts.flush(frame.viewportHeight, host);
                    hasPendingText = false;
                }
                hasPendingImages = true;
                pendingImageZIndex = command.zIndex;
                images.pushCommand(command, frame, host);
                continue;
            }
            if (command.kind === 'text') {
                if (hasPendingImages) {
                    images.flush(frame.viewportHeight, host);
                    hasPendingImages = false;
                    pendingImageZIndex = -1;
                }
                hasPendingText = true;
                texts.pushCommand(command, frame.viewportHeight, host);
                continue;
            }
            if (command.kind === 'stroke') {
                if (hasPendingImages && pendingImageZIndex < command.zIndex) {
                    images.flush(frame.viewportHeight, host);
                    hasPendingImages = false;
                    pendingImageZIndex = -1;
                }
                if (!quads.activeClip || !Rect.equals(quads.activeClip, command.clip as never)) {
                    quads.flush(frame.viewportHeight, host);
                    quads.setActiveClip(command.clip ?? null);
                }
                quads.pushStroke(command, frame.viewportHeight, host);
                continue;
            }
            quads.flush(frame.viewportHeight, host);
            images.flush(frame.viewportHeight, host);
            hasPendingImages = false;
            pendingImageZIndex = -1;
            texts.flush(frame.viewportHeight, host);
            statistics.customCommandCount += 1;
            customCommandRenderer(command as never, {
                gl,
                frame,
                clip: command.clip ?? null,
                viewport: { width: frame.viewportWidth, height: frame.viewportHeight },
            } as never);
            state.invalidateTextureUnit();
        }

        quads.flush(frame.viewportHeight, host);
        images.flush(frame.viewportHeight, host);
        texts.flush(frame.viewportHeight, host);
    } finally {
        host.currentFrame = null;
        state.restore();
    }

    return { calls, statistics: getRendererStatistics(statistics, pages.pageCount) };
};

describe('extracted ui-webgl2 renderer modules', () => {
    it('reproduces the renderer GL call log for a mixed command frame', () => {
        const frame = createCommandFrame<TestPayload>();
        const reference = createRecordingGL();
        const candidate = createRecordingGL();

        const rendererResult = renderWithRenderer(reference.gl, reference.calls, frame, undefined);
        const moduleResult = renderWithExtractedModules(candidate.gl, candidate.calls, frame, undefined);

        expect(callNames(moduleResult.calls)).toEqual(callNames(rendererResult.calls));
        expect(moduleResult.calls.map((call) => call.text)).toEqual(
            rendererResult.calls.map((call) => call.text)
        );
        expect(moduleResult.statistics).toEqual(rendererResult.statistics);
        expect(rendererResult.calls.length).toBeGreaterThan(80);
        expect(rendererResult.statistics.drawCalls).toBeGreaterThan(4);
        expect(hashCallSequence(rendererResult.calls)).toBe('266:6c1b178b');
        expect(hashCallSequence(moduleResult.calls)).toBe('266:6c1b178b');
    });

    it('reproduces the renderer GL call log when rendering into an offscreen framebuffer', () => {
        const frame = createCommandFrame<TestPayload>();
        const reference = createRecordingGL();
        const candidate = createRecordingGL();
        const offscreen = { kind: 'framebuffer', id: 500 } as unknown as WebGLFramebuffer;

        const rendererResult = renderWithRenderer(reference.gl, reference.calls, frame, { framebuffer: offscreen });
        const moduleResult = renderWithExtractedModules(candidate.gl, candidate.calls, frame, {
            framebuffer: offscreen,
        });

        expect(callNames(moduleResult.calls)).toEqual(callNames(rendererResult.calls));
        expect(candidate.state.framebuffer).toBeNull();
    });

    it('restores the external GL state captured before the frame', () => {
        const { gl, state } = createRecordingGL();
        const previous = {
            framebuffer: { kind: 'framebuffer', id: 11 } as unknown as WebGLFramebuffer,
            program: { kind: 'program', id: 12 } as unknown as WebGLProgram,
            vao: { kind: 'vao', id: 13 } as unknown as WebGLVertexArrayObject,
            buffer: { kind: 'buffer', id: 14 } as unknown as WebGLBuffer,
        };
        state.framebuffer = previous.framebuffer;
        state.currentProgram = previous.program;
        state.vertexArray = previous.vao;
        state.arrayBuffer = previous.buffer;
        state.viewport = [11, 22, 33, 44];
        state.scissorBox = [55, 66, 77, 88];
        state.enabled.add(0x0b44);
        state.enabled.add(0x0b71);
        state.unpackAlignment = 8;
        state.activeTexture = 0x84c1;
        state.textureBindings.set(0x84c0, { kind: 'texture', id: 15 } as unknown as WebGLTexture);
        state.samplerBindings.set(0, { kind: 'sampler', id: 16 } as unknown as WebGLSampler);

        const frameGLState = new FrameGLState(gl);
        frameGLState.prepareFrame(160, 120);
        expect(state.viewport).toEqual([0, 0, 160, 120]);
        expect(state.enabled.has(0x0b44)).toBe(false);
        expect(state.activeTexture).toBe(0x84c0);

        frameGLState.restore();

        expect(state.framebuffer).toBe(previous.framebuffer);
        expect(state.currentProgram).toBe(previous.program);
        expect(state.vertexArray).toBe(previous.vao);
        expect(state.arrayBuffer).toBe(previous.buffer);
        expect(state.viewport).toEqual([11, 22, 33, 44]);
        expect(state.scissorBox).toEqual([55, 66, 77, 88]);
        expect(state.enabled.has(0x0b44)).toBe(true);
        expect(state.enabled.has(0x0b71)).toBe(true);
        expect(state.unpackAlignment).toBe(8);
        expect(state.activeTexture).toBe(0x84c1);
        expect(state.textureBindings.get(0x84c0)).toEqual({ kind: 'texture', id: 15 });
        expect(state.samplerBindings.get(0)).toEqual({ kind: 'sampler', id: 16 });
    });

    it('uploads a glyph atlas page once, repacks row strides, and deletes it on eviction', () => {
        const { gl, calls } = createRecordingGL();
        const statistics = createRendererStatisticsState();
        const state = new FrameGLState(gl);
        const pipelines = new RenderPipelines({
            gl,
            quadBatchByteLength: 23 * 4,
            imageBatchByteLength: 22 * 4,
            textBatchByteLength: 26 * 4,
        });
        const host = new RenderHost({
            gl,
            state,
            statistics,
            pipelines,
        });
        const pages = new GlyphAtlasPages(gl, 'linear');
        const texts = new TextBatch(4, pages);
        host.currentFrame = {
            viewportWidth: 160,
            viewportHeight: 120,
            metrics: createMetrics(),
            commands: [],
        };

        const entry = createGlyphEntry(3, 67);
        entry.format = 'rgba8';
        entry.data = new Uint8Array(entry.width * 4 * entry.height + 8).fill(7);
        entry.rowStride = entry.width * 4 + 2;

        texts.pushCommand(
            {
                kind: 'text',
                widget: 1 as WidgetId,
                x: 10,
                y: 20,
                zIndex: 0,
                color: { r: 1, g: 1, b: 1, a: 1 },
                outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                outlineWidth: 0,
                edgeSoftness: 1,
                opacity: 1,
                clip: null,
                layout: createTextLayout(entry),
            } as never,
            120,
            host
        );

        const firstPageCall = calls.findIndex((call) => call.name === 'texImage2D');
        expect(firstPageCall).toBeGreaterThanOrEqual(0);
        expect(calls.filter((call) => call.name === 'texImage2D')).toHaveLength(1);
        expect(calls.filter((call) => call.name === 'texSubImage2D')).toHaveLength(1);
        const upload = calls.find((call) => call.name === 'texSubImage2D');
        expect(upload?.text).toContain('Uint8Array(768)');
        expect(statistics.uploadedGlyphCount).toBe(1);
        expect(pages.pageCount).toBe(1);

        texts.pushCommand(
            {
                kind: 'text',
                widget: 1 as WidgetId,
                x: 10,
                y: 20,
                zIndex: 0,
                color: { r: 1, g: 1, b: 1, a: 1 },
                outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                outlineWidth: 0,
                edgeSoftness: 1,
                opacity: 1,
                clip: null,
                layout: createTextLayout(entry),
            } as never,
            120,
            host
        );
        texts.flush(120, host);

        expect(calls.filter((call) => call.name === 'texSubImage2D')).toHaveLength(1);
        expect(statistics.uploadedGlyphCount).toBe(1);
        expect(calls.filter((call) => call.name === 'drawArraysInstanced')).toHaveLength(1);

        const snapshot = {
            id: 3,
            entries: [{ faceId: 1 }],
        } as unknown as GlyphAtlasPageSnapshot;
        const pageKey = (1 as number) * 65536 + (3 as number);
        expect(texts.activePageKey).toBeNull();
        pages.evict(pageKey);
        expect(pages.pageCount).toBe(0);
        expect(calls[calls.length - 1].name).toBe('deleteTexture');
        expect(snapshot.entries[0]?.faceId).toBe(1);

        texts.pushCommand(
            {
                kind: 'text',
                widget: 1 as WidgetId,
                x: 10,
                y: 20,
                zIndex: 0,
                color: { r: 1, g: 1, b: 1, a: 1 },
                outlineColor: { r: 0, g: 0, b: 0, a: 0 },
                outlineWidth: 0,
                edgeSoftness: 1,
                opacity: 1,
                clip: null,
                layout: createTextLayout(entry),
            } as never,
            120,
            host
        );

        expect(pages.pageCount).toBe(1);
        expect(statistics.uploadedGlyphCount).toBe(2);
    });
});
