import { createGameLoop } from '@axrone/game-loop';
import { vi } from 'vitest';
import type { GlyphAtlasEntry, TextLayoutResult, UIAsset, UIFrame, UIFrameMetrics, WidgetId } from '@axrone/ui/types';

/** Shared fixtures and the mock WebGL2 context for the ui-webgl2 suites. */
/** Column-major identity with an optional translation. */
export const columnMajorIdentity = (tx = 0, ty = 0, tz = 0): Float32Array =>
    new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1]);

/** Minimal structural scene target shared by the UIHost binding suites. */
export const createSceneTarget = () => {
    const gl = createMockWebGL2Context();
    const loop = createGameLoop({
        state: { sceneId: 'scene:ui-host' },
        autoStart: false,
    });
    return {
        gl,
        canvas: { width: 320, height: 180 } as HTMLCanvasElement,
        loop,
    };
};

/** Checkbox asset (160x24 at inset 20,20) for end-to-end input-path tests. */
export const createCheckboxAsset = (): UIAsset => ({
    id: 'ui.checkbox',
    name: 'Checkbox',
    version: 1,
    canvas: {
        referenceWidth: 320,
        referenceHeight: 180,
        scaleMode: 'fill',
        matchBias: 0.5,
    },
    bindings: {
        root: 'root',
        checkbox: 'checkbox',
        'checkbox-box': 'checkbox-box',
        'checkbox-mark': 'checkbox-mark',
        'checkbox-label': 'checkbox-label',
    },
    root: {
        role: 'root',
        key: 'root',
        enabled: true,
        interactive: false,
        layout: { display: 'overlay', width: '100%', height: '100%' },
        children: [
            {
                role: 'custom:checkbox',
                key: 'checkbox',
                enabled: true,
                interactive: true,
                controller: 'checkbox-toggle',
                props: {
                    boxKey: 'checkbox-box',
                    markKey: 'checkbox-mark',
                    labelKey: 'checkbox-label',
                    isOn: false,
                },
                layout: {
                    display: 'overlay',
                    position: 'absolute',
                    inset: { left: 20, top: 20 },
                    width: 160,
                    height: 24,
                },
                children: [
                    {
                        role: 'custom:checkbox-box',
                        key: 'checkbox-box',
                        enabled: true,
                        interactive: false,
                        layout: {
                            position: 'absolute',
                            inset: { left: 0, top: 0 },
                            width: 20,
                            height: 20,
                        },
                        style: { background: '#334155ff', radius: 4 },
                        children: [
                            {
                                role: 'custom:checkbox-mark',
                                key: 'checkbox-mark',
                                enabled: false,
                                interactive: false,
                                layout: {
                                    position: 'absolute',
                                    anchor: { x: 0.5, y: 0.5, pivotX: 0.5, pivotY: 0.5 },
                                    width: 12,
                                    height: 12,
                                },
                                style: { background: '#00000000' },
                                children: [],
                            },
                        ],
                    },
                    {
                        role: 'text',
                        key: 'checkbox-label',
                        enabled: true,
                        interactive: false,
                        layout: {
                            position: 'absolute',
                            inset: { left: 28, top: 2 },
                            width: 120,
                            height: 20,
                        },
                        text: { value: 'Option', size: 12 },
                        children: [],
                    },
                ],
            },
        ],
    } as never,
});

/** HUD asset with one interactive button filling the top-left 100x100. */
export const createHostAsset = (): UIAsset => ({
    id: 'ui.hud',
    name: 'HUD',
    version: 1,
    canvas: {
        referenceWidth: 320,
        referenceHeight: 180,
        scaleMode: 'fill',
        matchBias: 0.5,
    },
    bindings: { button: 'hud-button' },
    root: {
        role: 'root',
        enabled: true,
        interactive: false,
        layout: { display: 'overlay', width: '100%', height: '100%' },
        children: [
            {
                role: 'button',
                key: 'hud-button',
                enabled: true,
                interactive: true,
                layout: { width: 100, height: 100 },
                style: { background: '#112233ff' },
                children: [],
            },
        ],
    } as never,
});

export const createMetrics = (): UIFrameMetrics => ({
    widgetCount: 2,
    visibleWidgetCount: 2,
    renderCount: 2,
    customCommandCount: 1,
    imageCommandCount: 0,
    textCommandCount: 1,
    strokeCommandCount: 0,
    glyphCount: 1,
    layoutPasses: 1,
});

export const createGlyphEntry = (): GlyphAtlasEntry => ({
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

export const createTextLayout = (entry: GlyphAtlasEntry): TextLayoutResult => ({
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
            spanIndex: 0,
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
            spanIndex: 0,
        },
    ],
    truncated: false,
    direction: 'ltr',
    text: 'A',
    spanStyles: [],
});

export const createFrame = (): UIFrame<{ readonly kind: 'pulse' }> => {
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

export const createMockWebGL2Context = () => {
    let handleId = 0;
    const makeHandle = (kind: string) => ({ kind, id: ++handleId });
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
        depthMask: true,
    };
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
        bindBuffer: vi.fn((target, buffer) => {
            if (target === 0x8892) {
                state.arrayBuffer = buffer as WebGLBuffer | null;
            }
        }),
        bufferData: vi.fn(),
        bufferSubData: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        vertexAttribDivisor: vi.fn(),
        createVertexArray: vi.fn(() => makeHandle('vao')),
        deleteVertexArray: vi.fn(),
        bindVertexArray: vi.fn((vao) => {
            state.vertexArray = vao as WebGLVertexArrayObject | null;
        }),
        createTexture: vi.fn(() => makeHandle('texture')),
        deleteTexture: vi.fn(),
        bindTexture: vi.fn((_target, texture) => {
            state.textureBindings.set(state.activeTexture, texture as WebGLTexture | null);
        }),
        bindSampler: vi.fn((unit, sampler) => {
            state.samplerBindings.set(unit, sampler as WebGLSampler | null);
        }),
        texParameteri: vi.fn(),
        pixelStorei: vi.fn((parameter, value) => {
            if (parameter === 0x0cf5) {
                state.unpackAlignment = value as number;
            }
        }),
        texImage2D: vi.fn(),
        texSubImage2D: vi.fn(),
        viewport: vi.fn((x, y, width, height) => {
            state.viewport = [x as number, y as number, width as number, height as number];
        }),
        disable: vi.fn((capability) => {
            state.enabled.delete(capability as number);
        }),
        enable: vi.fn((capability) => {
            state.enabled.add(capability as number);
        }),
        blendFunc: vi.fn((src, dst) => {
            state.blendFunc = [src as number, dst as number, src as number, dst as number];
        }),
        blendFuncSeparate: vi.fn((srcRgb, dstRgb, srcAlpha, dstAlpha) => {
            state.blendFunc = [
                srcRgb as number,
                dstRgb as number,
                srcAlpha as number,
                dstAlpha as number,
            ];
        }),
        useProgram: vi.fn((program) => {
            state.currentProgram = program as WebGLProgram | null;
        }),
        uniform2f: vi.fn(),
        uniform1i: vi.fn(),
        activeTexture: vi.fn((textureUnit) => {
            state.activeTexture = textureUnit as number;
        }),
        drawArraysInstanced: vi.fn(),
        getError: vi.fn(() => 0),
        scissor: vi.fn((x, y, width, height) => {
            state.scissorBox = [x as number, y as number, width as number, height as number];
        }),
        bindFramebuffer: vi.fn((_target, framebuffer) => {
            state.framebuffer = framebuffer as WebGLFramebuffer | null;
        }),
        // World-space UI surface + quad pass surface area.
        COLOR_ATTACHMENT0: 0x8ce0,
        DEPTH_WRITEMASK: 0x0b98,
        createFramebuffer: vi.fn(() => makeHandle('framebuffer')),
        deleteFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        checkFramebufferStatus: vi.fn(() => 0x8cd5),
        isTexture: vi.fn(() => true),
        drawArrays: vi.fn(),
        depthMask: vi.fn((flag: boolean) => {
            state.depthMask = flag;
        }),
        clearColor: vi.fn(),
        clear: vi.fn(),
        uniform1f: vi.fn(),
        uniformMatrix4fv: vi.fn(),
        getParameter: vi.fn((parameter) => {
            switch (parameter) {
                case 0x0b98:
                    return state.depthMask;
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
        }),
        isEnabled: vi.fn((capability) => state.enabled.has(capability as number)),
        isContextLost: vi.fn(() => false),
        clearBufferfv: vi.fn(),
    } as unknown as WebGL2RenderingContext;
};
