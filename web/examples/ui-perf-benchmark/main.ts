/**
 * SOP-03 UI Profiling Benchmark Harness
 *
 * Deterministic scenario: 100-widget tree (50 panels + 50 labels) under 5
 * nested containers, 1 opacity tween, 1 scrolling list.  Instruments WebGL
 * draw calls and getParameter/isEnabled per-frame, measures frame timing and
 * heap delta, then publishes results for the benchmark runner.
 */

import { Scene, createUnlitColorShaderDefinition } from '@axrone/scene-3d';
import { UIRuntime } from '@axrone/ui';
import {
    createUICanvas,
    createUILayout,
    createUIRichText,
    createUIScrollView,
    createUIWidget,
    animateWidgetOpacity,
} from '@axrone/ui';
import type { WidgetId } from '@axrone/ui';
import { attachUIOverlayToScene } from '@axrone/ui-webgl2';

// ─── Configuration ──────────────────────────────────────────────────────────

const urlParams = new URLSearchParams(globalThis.location?.search ?? '');
const WARMUP_FRAMES = 10;
const MEASURED_FRAMES = Number(urlParams.get('frames')) || 120;
const VIEWPORT_W = 960;
const VIEWPORT_H = 540;
const FONT_FAMILY = 'OverlayBitmap';

// ─── Minimal bitmap font (same as example-helpers) ──────────────────────────

const GLYPH_PATTERNS: Record<string, readonly string[]> = {
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    J: ['..###', '...#.', '...#.', '...#.', '#..#.', '#..#.', '.##..'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '...#.', '..##.', '....#', '#...#', '.###.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['.###.', '#...#', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '#...#', '.###.'],
};

const scaleGlyphPattern = (rows: readonly string[], scale = 2): Uint8Array => {
    const sourceHeight = rows.length;
    const sourceWidth = rows[0]?.length ?? 0;
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    const data = new Uint8Array(width * height);
    for (let sy = 0; sy < sourceHeight; sy++) {
        for (let sx = 0; sx < sourceWidth; sx++) {
            const alpha = rows[sy]?.[sx] === '#' ? 255 : 0;
            for (let oy = 0; oy < scale; oy++) {
                for (let ox = 0; ox < scale; ox++) {
                    data[(sy * scale + oy) * width + (sx * scale + ox)] = alpha;
                }
            }
        }
    }
    return data;
};

const registerDemoFont = (runtime: UIRuntime): void => {
    runtime.fonts.registerFace({
        family: FONT_FAMILY,
        face: 'Regular',
        style: 'normal' as const,
        weight: 400 as const,
        ascent: 14,
        descent: 4,
        lineGap: 2,
        unitsPerEm: 20,
        defaultAdvance: 12,
        fallbackCodePoint: 63,
        glyphs: Object.entries(GLYPH_PATTERNS).map(([char, pattern]) => {
            if (char === ' ') {
                return { codePoint: 32, advance: 6, width: 1, height: 1 };
            }
            const data = scaleGlyphPattern(pattern);
            const isPunct = char === '.' || char === ':';
            return {
                codePoint: char.charCodeAt(0),
                advance: isPunct ? 6 : 12,
                width: 10,
                height: 14,
                data,
                format: 'alpha8' as const,
                rowStride: 10,
            };
        }),
    });
};

// ─── GL instrumentation (installed BEFORE renderer creation) ────────────────

let drawCallsThisFrame = 0;
let getParamCallsThisFrame = 0;

const origDrawArrays = WebGL2RenderingContext.prototype.drawArrays;
const origDrawElements = WebGL2RenderingContext.prototype.drawElements;
const origDrawArraysInstanced = WebGL2RenderingContext.prototype.drawArraysInstanced;
const origDrawElementsInstanced = WebGL2RenderingContext.prototype.drawElementsInstanced;
const origGetParameter = WebGL2RenderingContext.prototype.getParameter;
const origIsEnabled = WebGL2RenderingContext.prototype.isEnabled;

WebGL2RenderingContext.prototype.drawArrays = function (this: WebGL2RenderingContext, ...args: Parameters<typeof origDrawArrays>) {
    drawCallsThisFrame++;
    return origDrawArrays.apply(this, args);
};
WebGL2RenderingContext.prototype.drawElements = function (this: WebGL2RenderingContext, ...args: Parameters<typeof origDrawElements>) {
    drawCallsThisFrame++;
    return origDrawElements.apply(this, args);
};
WebGL2RenderingContext.prototype.drawArraysInstanced = function (this: WebGL2RenderingContext, ...args: Parameters<typeof origDrawArraysInstanced>) {
    drawCallsThisFrame++;
    return origDrawArraysInstanced.apply(this, args);
};
WebGL2RenderingContext.prototype.drawElementsInstanced = function (this: WebGL2RenderingContext, ...args: Parameters<typeof origDrawElementsInstanced>) {
    drawCallsThisFrame++;
    return origDrawElementsInstanced.apply(this, args);
};
WebGL2RenderingContext.prototype.getParameter = function (this: WebGL2RenderingContext, ...args: Parameters<typeof origGetParameter>) {
    getParamCallsThisFrame++;
    return origGetParameter.apply(this, args);
};
WebGL2RenderingContext.prototype.isEnabled = function (this: WebGL2RenderingContext, ...args: Parameters<typeof origIsEnabled>) {
    getParamCallsThisFrame++;
    return origIsEnabled.apply(this, args);
};

// ─── Scene + UI runtime setup ───────────────────────────────────────────────

const container = document.getElementById('container')!;

const scene = new Scene({
    width: VIEWPORT_W,
    height: VIEWPORT_H,
    autoStart: true,
    parent: container,
    appendToDom: true,
    createCanvas: () => document.createElement('canvas'),
    clearColor: [0.03, 0.04, 0.07, 1],
});

scene.registerShader(createUnlitColorShaderDefinition('ui-perf/overlay-unlit'));
scene.createCameraEntity({ name: 'UICamera' }, { primary: true, fieldOfView: 60 });

const runtime = new UIRuntime({ width: VIEWPORT_W, height: VIEWPORT_H });
registerDemoFont(runtime);

const _overlay = attachUIOverlayToScene(scene, {
    ui: () => runtime.commit({ width: scene.canvas.width, height: scene.canvas.height }),
    priority: -1000,
    renderer: { atlasFilter: 'nearest' },
});

// ─── Build widget tree ──────────────────────────────────────────────────────
// 100 widgets: 50 panels + 50 labels under 5 nested containers.

const rootCanvas = createUICanvas(runtime, {
    layout: { display: 'overlay', width: '100%', height: '100%' },
    style: { background: '#050b1600' },
});

const sectionWidgets: WidgetId[] = [];

for (let s = 0; s < 5; s++) {
    // Nested container (1 of 5)
    const sectionContainer = createUILayout(runtime, {
        parent: rootCanvas,
        layout: {
            position: 'absolute',
            anchor: 'top-left',
            inset: { top: s * 80, left: s * 12 },
            width: 420,
            height: 260,
            display: 'stack',
            direction: 'column',
            gap: 4,
            padding: 8,
        },
        style: {
            background: '#0f172acc',
            borderColor: '#38bdf844',
            borderWidth: 1,
            radius: 12,
        },
    });
    sectionWidgets.push(sectionContainer.root);

    // 10 panels per section = 50 total
    for (let p = 0; p < 10; p++) {
        createUIWidget(runtime, {
            parent: sectionContainer.root,
            layout: { width: '100%', height: 14 },
            style: {
                background: `hsl(${210 + s * 20}, 60%, ${25 + p * 3}%)`,
                radius: 4,
            },
        });
    }

    // 10 labels per section = 50 total
    for (let l = 0; l < 10; l++) {
        createUIRichText(runtime, {
            parent: sectionContainer.root,
            value: `S${s}L${l}`,
            layout: { width: '100%', height: 12 },
            text: { family: FONT_FAMILY, size: 10, color: '#94a3b8ff' },
        });
    }
}

// Scrolling list
const scrollView = createUIScrollView(runtime, {
    parent: rootCanvas,
    layout: {
        position: 'absolute',
        anchor: 'bottom-right',
        inset: { right: 10, bottom: 10 },
        width: 200,
        height: 180,
    },
    style: { background: '#0f172aee', borderColor: '#475569', borderWidth: 1, radius: 8, clip: true },
});

for (let i = 0; i < 30; i++) {
    createUIRichText(runtime, {
        parent: scrollView.content,
        value: `Scroll item ${i}`,
        layout: { width: '100%', height: 24 },
        text: { family: FONT_FAMILY, size: 12, color: '#cbd5e1ff' },
    });
}

// Opacity tween on first section's child panels
const firstSectionWidget = sectionWidgets[0];
const _opacityAnim = animateWidgetOpacity(runtime, firstSectionWidget, 1.0, 0.3, 2.0);

// ─── Measurement loop ───────────────────────────────────────────────────────

const frameTimes: number[] = [];
const drawCallSamples: number[] = [];
const getParamSamples: number[] = [];
const heapStart = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

let frameIndex = 0;
let measuring = true;
let lastFrameTime = performance.now();

const tick = () => {
    if (!measuring) return;

    // Deterministic scroll: offset = f(frameIndex)
    scrollView.setScroll(0, (frameIndex * 1.7) % 200);

    // Snapshot GL counters for this frame and reset
    drawCallSamples.push(drawCallsThisFrame);
    getParamSamples.push(getParamCallsThisFrame);
    drawCallsThisFrame = 0;
    getParamCallsThisFrame = 0;

    const now = performance.now();

    if (frameIndex > 0) {
        frameTimes.push(now - lastFrameTime);
    }
    lastFrameTime = now;
    frameIndex++;

    const totalNeeded = WARMUP_FRAMES + MEASURED_FRAMES;
    if (frameIndex >= totalNeeded) {
        measuring = false;
        publishResults();
        return;
    }

    requestAnimationFrame(tick);
};

requestAnimationFrame(tick);

// ─── Statistics ─────────────────────────────────────────────────────────────

const computeStats = (samples: number[]) => {
    if (samples.length === 0) {
        return { median: 0, p95: 0, p99: 0, max: 0 };
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const pct = (p: number) => {
        const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
        return sorted[idx];
    };
    return {
        median: pct(0.5),
        p95: pct(0.95),
        p99: pct(0.99),
        max: sorted[sorted.length - 1] ?? 0,
    };
};

// ─── Publish results ────────────────────────────────────────────────────────

const publishResults = () => {
    const measuredDrawCalls = drawCallSamples.slice(WARMUP_FRAMES);
    const measuredGetParams = getParamSamples.slice(WARMUP_FRAMES);
    const heapEnd = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

    const result = {
        frameTimeMs: computeStats(frameTimes),
        drawCallsPerFrame: computeStats(measuredDrawCalls),
        getParameterPerFrame: computeStats(measuredGetParams),
        heapBytes: {
            start: heapStart,
            end: heapEnd,
            delta: heapEnd - heapStart,
        },
        frames: {
            warmup: WARMUP_FRAMES,
            measured: frameTimes.length,
        },
    };

    (globalThis as unknown as Record<string, unknown>).__UI_PERF_RESULT__ = result;

    const pre = document.getElementById('ui-perf-result');
    if (pre) {
        pre.textContent = JSON.stringify(result, null, 2);
    }
    document.title = 'UIPERF_DONE';
};
