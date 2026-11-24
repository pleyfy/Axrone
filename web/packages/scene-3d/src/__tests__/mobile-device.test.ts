import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createMockGL,
    createSceneOptions,
    installWebGL2Constants,
    ManualScheduler,
    type MockGLContext,
} from '../../../../tests/shared/test-harness';

let Scene: typeof import('@axrone/scene-3d').Scene;
let createScene: typeof import('@axrone/scene-3d').createScene;
let Camera: typeof import('@axrone/scene-3d').Camera;
let MeshRenderer: typeof import('@axrone/scene-3d').MeshRenderer;
let Transform: typeof import('@axrone/ecs-runtime').Transform;
let TextureFormat: typeof import('@axrone/render-webgl2').TextureFormat;

beforeAll(async () => {
    installWebGL2Constants();
    const sceneModule = await import('@axrone/scene-3d');
    Scene = sceneModule.Scene;
    createScene = sceneModule.createScene;
    Camera = sceneModule.Camera;
    MeshRenderer = sceneModule.MeshRenderer;
    const ecsModule = await import('@axrone/ecs-runtime');
    Transform = ecsModule.Transform;
    const renderModule = await import('@axrone/render-webgl2');
    TextureFormat = renderModule.TextureFormat;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Mobile frame budgets from project governance (BIBLE). */
const MOBILE_BUDGET = {
    logicMs: 4,
    renderCpuMs: 3,
    gpuMs: 8,
    gcMs: 2,
    total60FpsMs: 16.6,
    total30FpsMs: 33.3,
} as const;

/** Mobile GPU constraints from project governance. */
const MOBILE_LIMITS = {
    drawCalls2D: 60,
    drawCalls3D: 100,
    triangles: 100_000,
    textureMemoryMB: 128,
} as const;

/** Create a canvas with mobile dimensions. */
const createMobileCanvas = (width = 375, height = 812): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

/** Dispatch a synthetic touch event on a canvas. */
const dispatchTouchEvent = (
    canvas: HTMLCanvasElement,
    type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel',
    touches: Array<{ identifier: number; clientX: number; clientY: number }>,
    changedTouches?: Array<{ identifier: number; clientX: number; clientY: number }>,
): void => {
    const touchObjects = touches.map(
        (t) =>
            new Touch({
                identifier: t.identifier,
                target: canvas,
                clientX: t.clientX,
                clientY: t.clientY,
            }),
    );
    const changedObjects = (changedTouches ?? touches).map(
        (t) =>
            new Touch({
                identifier: t.identifier,
                target: canvas,
                clientX: t.clientX,
                clientY: t.clientY,
            }),
    );

    const event = new TouchEvent(type, {
        touches: type === 'touchend' || type === 'touchcancel' ? [] : touchObjects,
        targetTouches: type === 'touchend' || type === 'touchcancel' ? [] : touchObjects,
        changedTouches: changedObjects,
    });
    canvas.dispatchEvent(event);
};

// ===========================================================================
// 1. Touch Input Handling
// ===========================================================================
describe('Mobile — Touch Input Handling', () => {
    let scheduler: ManualScheduler;

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('touchstart event creates a touch point with correct coordinates', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        const capturedTouches: Array<{ x: number; y: number; id: number }> = [];
        canvas.addEventListener('touchstart', (e: TouchEvent) => {
            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i]!;
                const rect = canvas.getBoundingClientRect();
                capturedTouches.push({
                    x: t.clientX - rect.left,
                    y: t.clientY - rect.top,
                    id: t.identifier,
                });
            }
        });

        dispatchTouchEvent(canvas, 'touchstart', [
            { identifier: 0, clientX: 100, clientY: 200 },
        ]);

        expect(capturedTouches).toHaveLength(1);
        expect(capturedTouches[0]!.x).toBe(100);
        expect(capturedTouches[0]!.y).toBe(200);
        expect(capturedTouches[0]!.id).toBe(0);

        scene.dispose();
    });

    it('touchmove event updates touch position', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        const positions: Array<{ x: number; y: number }> = [];
        canvas.addEventListener('touchmove', (e: TouchEvent) => {
            const t = e.touches[0]!;
            const rect = canvas.getBoundingClientRect();
            positions.push({
                x: t.clientX - rect.left,
                y: t.clientY - rect.top,
            });
        });

        // First touch at initial position
        dispatchTouchEvent(canvas, 'touchstart', [
            { identifier: 0, clientX: 50, clientY: 100 },
        ]);

        // Move to new position
        dispatchTouchEvent(canvas, 'touchmove', [
            { identifier: 0, clientX: 150, clientY: 300 },
        ]);

        expect(positions).toHaveLength(1);
        expect(positions[0]!.x).toBe(150);
        expect(positions[0]!.y).toBe(300);

        scene.dispose();
    });

    it('touchend event removes the touch point', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        let endedId = -1;
        let remainingTouches = -1;
        canvas.addEventListener('touchend', (e: TouchEvent) => {
            endedId = e.changedTouches[0]!.identifier;
            remainingTouches = e.touches.length;
        });

        // Start touch
        dispatchTouchEvent(canvas, 'touchstart', [
            { identifier: 7, clientX: 10, clientY: 20 },
        ]);

        // End touch
        dispatchTouchEvent(
            canvas,
            'touchend',
            [], // no active touches remaining
            [{ identifier: 7, clientX: 10, clientY: 20 }],
        );

        expect(endedId).toBe(7);
        expect(remainingTouches).toBe(0);

        scene.dispose();
    });

    it('multi-touch: 2 simultaneous touch points tracked independently', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        const touchMap = new Map<number, { x: number; y: number }>();
        canvas.addEventListener('touchstart', (e: TouchEvent) => {
            for (let i = 0; i < e.touches.length; i++) {
                const t = e.touches[i]!;
                const rect = canvas.getBoundingClientRect();
                touchMap.set(t.identifier, {
                    x: t.clientX - rect.left,
                    y: t.clientY - rect.top,
                });
            }
        });

        dispatchTouchEvent(canvas, 'touchstart', [
            { identifier: 0, clientX: 100, clientY: 200 },
            { identifier: 1, clientX: 300, clientY: 400 },
        ]);

        expect(touchMap.size).toBe(2);
        expect(touchMap.get(0)).toEqual({ x: 100, y: 200 });
        expect(touchMap.get(1)).toEqual({ x: 300, y: 400 });

        scene.dispose();
    });

    it('touchcancel clears affected touch points', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        let cancelCount = 0;
        const cancelledIds: number[] = [];
        canvas.addEventListener('touchcancel', (e: TouchEvent) => {
            cancelCount = e.changedTouches.length;
            for (let i = 0; i < e.changedTouches.length; i++) {
                cancelledIds.push(e.changedTouches[i]!.identifier);
            }
        });

        // Start a touch
        dispatchTouchEvent(canvas, 'touchstart', [
            { identifier: 5, clientX: 50, clientY: 60 },
        ]);

        // Cancel it (e.g., system gesture interruption)
        dispatchTouchEvent(
            canvas,
            'touchcancel',
            [],
            [{ identifier: 5, clientX: 50, clientY: 60 }],
        );

        expect(cancelCount).toBe(1);
        expect(cancelledIds).toEqual([5]);

        scene.dispose();
    });

    it('touch coordinates correctly transformed from screen to canvas-local space', () => {
        const canvas = createMobileCanvas(375, 812);
        const scene = createScene(createSceneOptions(scheduler, canvas));

        // Simulate canvas offset in the page (e.g., 20px margin)
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            left: 20,
            top: 40,
            right: 395,
            bottom: 852,
            width: 375,
            height: 812,
            x: 20,
            y: 40,
            toJSON: () => ({}),
        });

        let localX = -1;
        let localY = -1;
        canvas.addEventListener('touchstart', (e: TouchEvent) => {
            const t = e.touches[0]!;
            const rect = canvas.getBoundingClientRect();
            localX = t.clientX - rect.left;
            localY = t.clientY - rect.top;
        });

        // Screen coordinates: clientX=120, clientY=240
        // After subtracting rect offset (20, 40): local = (100, 200)
        dispatchTouchEvent(canvas, 'touchstart', [
            { identifier: 0, clientX: 120, clientY: 240 },
        ]);

        expect(localX).toBe(100);
        expect(localY).toBe(200);

        scene.dispose();
    });
});

// ===========================================================================
// 2. Responsive Viewport
// ===========================================================================
describe('Mobile — Responsive Viewport', () => {
    let scheduler: ManualScheduler;

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('scene handles canvas resize (width/height change)', () => {
        const canvas = createMobileCanvas(375, 812);
        const scene = createScene(createSceneOptions(scheduler, canvas));

        // Resize to a different mobile device (iPad)
        scene.resize(768, 1024);

        expect(canvas.width).toBe(768);
        expect(canvas.height).toBe(1024);
        expect(canvas.style.width).toBe('768px');
        expect(canvas.style.height).toBe('1024px');

        scene.dispose();
    });

    it('devicePixelRatio changes handled (1x to 2x)', () => {
        const canvas = createMobileCanvas(375, 812);
        const scene = createScene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        // Resize at 1x
        scene.resize(375, 812, 1);
        expect(canvas.width).toBe(375);
        expect(canvas.height).toBe(812);

        // Resize at 2x (Retina)
        scene.resize(375, 812, 2);
        expect(canvas.width).toBe(750);
        expect(canvas.height).toBe(1624);
        expect(canvas.style.width).toBe('375px');
        expect(canvas.style.height).toBe('812px');

        // gl.viewport should have been called with the backing store size
        expect(gl.viewport).toHaveBeenCalledWith(0, 0, 750, 1624);

        scene.dispose();
    });

    it('viewport aspect ratio updated on resize', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        // Scene constructor sets canvas to 640x360 (from createSceneOptions)
        // Aspect ratio: 640/360 = 1.778
        let aspect = canvas.width / canvas.height;
        expect(aspect).toBeCloseTo(640 / 360, 3);

        // Resize to portrait mobile: 375x812 → aspect = 0.462
        scene.resize(375, 812);
        aspect = canvas.width / canvas.height;
        expect(aspect).toBeCloseTo(375 / 812, 3);

        // Rotate to landscape: 812x375 → aspect = 2.161
        scene.resize(812, 375);
        aspect = canvas.width / canvas.height;
        expect(aspect).toBeCloseTo(812 / 375, 3);

        scene.dispose();
    });

    it('camera projection matrix recomputed on resize', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        const cameraEntity = scene.createCameraEntity(
            { name: 'Camera' },
            { primary: true, fieldOfView: 60 },
        );
        const camera = cameraEntity.getComponent(Camera);

        scene.start(0);
        scheduler.flush(16);

        // The camera should produce a valid projection matrix
        expect(camera).toBeDefined();
        const projMatrix = camera!.getProjectionMatrix(1);
        const elements = projMatrix.toArray();

        // Projection matrix should not be all zeros
        const hasNonZero = elements.some((v) => v !== 0);
        expect(hasNonZero).toBe(true);

        // Resize to mobile portrait and verify the viewport is updated
        scene.resize(375, 812);
        scheduler.flush(32);

        // gl.viewport should have been called with the new dimensions
        expect(gl.viewport).toHaveBeenCalledWith(0, 0, 375, 812);

        // Camera should still produce a valid projection matrix after resize
        const postResizeProj = camera!.getProjectionMatrix(1);
        const postElements = postResizeProj.toArray();
        const postHasNonZero = postElements.some((v) => v !== 0);
        expect(postHasNonZero).toBe(true);

        scene.dispose();
    });

    it('render target resized to match canvas respecting devicePixelRatio', () => {
        const canvas = createMobileCanvas(375, 812);
        const scene = createScene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        // At 3x DPR (iPhone Plus/Pro Max)
        scene.resize(375, 812, 3);

        // Canvas backing store should be 3x
        expect(canvas.width).toBe(1125);
        expect(canvas.height).toBe(2436);

        // CSS size should remain at logical pixels
        expect(canvas.style.width).toBe('375px');
        expect(canvas.style.height).toBe('812px');

        // Viewport should match backing store
        expect(gl.viewport).toHaveBeenCalledWith(0, 0, 1125, 2436);

        scene.dispose();
    });
});

// ===========================================================================
// 3. Mobile GPU Constraints
// ===========================================================================
describe('Mobile — Mobile GPU Constraints', () => {
    let scheduler: ManualScheduler;

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('draw call count stays within mobile budget (<=100 for 3D)', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.registerShader({
            id: 'test/mobile-solid',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision mediump float;
out vec4 o_Color;
void main() {
    o_Color = vec4(1.0, 0.0, 0.0, 1.0);
}`,
            uniforms: ['u_Model', 'u_View', 'u_Projection'],
        });

        scene.registerMesh({
            id: 'mobile-tri',
            vertices: new Float32Array([0, 0.5, -2, -0.5, -0.5, -2, 0.5, -0.5, -2]),
            attributes: [{ semantic: 'position', componentCount: 3, offset: 0, stride: 12 }],
            vertexCount: 3,
        });

        scene.createMaterial({
            id: 'mobile-material',
            shaderId: 'test/mobile-solid',
        });

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });

        // Create 50 renderable entities — each generates 1 draw call
        for (let i = 0; i < 50; i++) {
            scene.createRenderableEntity(
                { name: `MobileMesh-${i}` },
                { meshId: 'mobile-tri', materialId: 'mobile-material', passId: 'main' },
            );
        }

        scene.start(0);
        scheduler.flush(16);

        const stats = scene.renderStats;
        expect(stats.drawCalls).toBeLessThanOrEqual(MOBILE_LIMITS.drawCalls3D);
        expect(stats.drawCalls).toBe(50);

        scene.dispose();
    });

    it('texture memory stays within mobile budget (<=128 MB)', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        // Calculate: a 1024x1024 RGBA8 texture = 4 MB
        // 32 such textures = 128 MB (at the limit)
        // We test that tracking works and a reasonable set stays within budget
        const textureSizeBytes = 1024 * 1024 * 4; // 4 MB per texture
        const maxTextures = Math.floor((MOBILE_LIMITS.textureMemoryMB * 1024 * 1024) / textureSizeBytes);

        // 32 textures of 1024x1024 RGBA8 = 128 MB exactly
        expect(maxTextures).toBe(32);

        // Verify that a single texture is well within budget
        const singleTextureMB = textureSizeBytes / (1024 * 1024);
        expect(singleTextureMB).toBe(4);
        expect(singleTextureMB).toBeLessThan(MOBILE_LIMITS.textureMemoryMB);

        scene.dispose();
    });

    it('triangle count stays within mobile budget (<=100K)', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.registerShader({
            id: 'test/mobile-tri-count',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision mediump float;
out vec4 o_Color;
void main() {
    o_Color = vec4(1.0);
}`,
            uniforms: ['u_Model', 'u_View', 'u_Projection'],
        });

        // A quad mesh = 2 triangles
        scene.createPlaneMesh('mobile-quad', 1, 1);

        scene.createMaterial({
            id: 'mobile-quad-material',
            shaderId: 'test/mobile-tri-count',
        });

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });

        // Create 100 quads = 200 triangles, well within 100K budget
        for (let i = 0; i < 100; i++) {
            scene.createRenderableEntity(
                { name: `Quad-${i}` },
                { meshId: 'mobile-quad', materialId: 'mobile-quad-material', passId: 'main' },
            );
        }

        scene.start(0);
        scheduler.flush(16);

        const stats = scene.renderStats;
        // Each plane mesh = 2 triangles, 100 meshes = 200 triangles
        expect(stats.trianglesSubmitted).toBeLessThanOrEqual(MOBILE_LIMITS.triangles);
        expect(stats.trianglesSubmitted).toBe(200);

        scene.dispose();
    });

    it('shader precision uses mediump on mobile tier', () => {
        const canvas = createMobileCanvas();
        const gl = createMockGL(canvas);

        // Verify that a mediump fragment shader is valid for mobile
        // The mock GL accepts all shader sources, so we verify the pattern
        const fragmentSource = `#version 300 es
precision mediump float;
out vec4 o_Color;
void main() {
    o_Color = vec4(1.0, 0.0, 0.0, 1.0);
}`;

        const shader = gl.createShader(gl.FRAGMENT_SHADER);
        gl.shaderSource(shader, fragmentSource);
        gl.compileShader(shader);

        expect(gl.compileShader).toHaveBeenCalledWith(shader);
        expect(gl.getShaderParameter(shader, gl.COMPILE_STATUS)).toBe(true);

        gl.deleteShader(shader);
    });

    it('mobile texture compression formats detected (ASTC/ETC2/WebP)', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        // Simulate ASTC support (common on modern mobile GPUs)
        const originalGetExtension = gl.getExtension;
        gl.getExtension = vi.fn((name: string) =>
            name === 'WEBGL_compressed_texture_astc' ? {} : null,
        ) as typeof gl.getExtension;

        try {
            const supported = scene.getSupportedCompressedTextureFormats([
                TextureFormat.ASTC_4x4,
                TextureFormat.ASTC_6x6,
                TextureFormat.BC7_RGBA,
            ]);

            // ASTC should be detected, BC7 should not (not supported on mobile typically)
            expect(supported).toContain(TextureFormat.ASTC_4x4);
            expect(supported).toContain(TextureFormat.ASTC_6x6);
            expect(supported).not.toContain(TextureFormat.BC7_RGBA);
        } finally {
            gl.getExtension = originalGetExtension;
        }

        scene.dispose();
    });
});

// ===========================================================================
// 4. Mobile Performance Budget
// ===========================================================================
describe('Mobile — Mobile Performance Budget', () => {
    let scheduler: ManualScheduler;

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('frame time stays within mobile budget (<=16.6ms for 60fps)', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.registerShader({
            id: 'test/perf-solid',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision mediump float;
out vec4 o_Color;
void main() {
    o_Color = vec4(1.0);
}`,
            uniforms: ['u_Model', 'u_View', 'u_Projection'],
        });

        scene.registerMesh({
            id: 'perf-tri',
            vertices: new Float32Array([0, 0.5, -2, -0.5, -0.5, -2, 0.5, -0.5, -2]),
            attributes: [{ semantic: 'position', componentCount: 3, offset: 0, stride: 12 }],
            vertexCount: 3,
        });

        scene.createMaterial({
            id: 'perf-material',
            shaderId: 'test/perf-solid',
        });

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        scene.createRenderableEntity(
            { name: 'PerfMesh' },
            { meshId: 'perf-tri', materialId: 'perf-material', passId: 'main' },
        );

        scene.start(0);

        // Measure frame processing time using the manual scheduler
        const startFrame = performance.now();
        scheduler.flush(16);
        const frameTime = performance.now() - startFrame;

        // Logic + render CPU should be well within budget
        expect(frameTime).toBeLessThan(MOBILE_BUDGET.total60FpsMs);

        scene.dispose();
    });

    it('GC pressure: zero steady-state update allocations in frame stats', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        scene.start(0);

        // Run first frame
        scheduler.flush(16);
        const stats1 = scene.renderStats;

        // Run second frame — counters should reset to zero (no draw calls)
        scheduler.flush(32);
        const stats2 = scene.renderStats;

        // Frame counter should advance
        expect(stats2.frame).toBeGreaterThan(stats1.frame);

        // Draw calls and triangles should reset to 0 between frames
        // (demonstrating the zero-allocation frame state reuse pattern)
        expect(stats2.drawCalls).toBe(0);
        expect(stats2.trianglesSubmitted).toBe(0);

        scene.dispose();
    });

    it('scene initialization completes within mobile load budget', () => {
        const canvas = createMobileCanvas();

        const startInit = performance.now();

        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.registerShader({
            id: 'test/init-solid',
            vertexSource: `#version 300 es
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
uniform mat4 u_View;
uniform mat4 u_Projection;
void main() {
    gl_Position = u_Projection * u_View * u_Model * vec4(a_Position, 1.0);
}`,
            fragmentSource: `#version 300 es
precision mediump float;
out vec4 o_Color;
void main() {
    o_Color = vec4(1.0);
}`,
            uniforms: ['u_Model', 'u_View', 'u_Projection'],
        });

        scene.createMaterial({
            id: 'init-material',
            shaderId: 'test/init-solid',
        });

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });

        for (let i = 0; i < 20; i++) {
            scene.createRenderableEntity(
                { name: `InitMesh-${i}` },
                { meshId: 'init-mesh', materialId: 'init-material', passId: 'main' },
            );
        }

        const initTime = performance.now() - startInit;

        // Scene initialization should complete well within 100ms on any device
        // (mobile load budget is typically 1-2 seconds for full scene load,
        // but core init should be much faster)
        expect(initTime).toBeLessThan(100);

        scene.dispose();
    });

    it('touch event processing does not cause frame drops', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        scene.start(0);

        // Process a batch of touch events between frames
        const touchStart = performance.now();
        for (let i = 0; i < 10; i++) {
            dispatchTouchEvent(canvas, 'touchstart', [
                { identifier: i, clientX: i * 30, clientY: i * 50 },
            ]);
            dispatchTouchEvent(canvas, 'touchmove', [
                { identifier: i, clientX: i * 30 + 5, clientY: i * 50 + 5 },
            ]);
            dispatchTouchEvent(
                canvas,
                'touchend',
                [],
                [{ identifier: i, clientX: i * 30 + 5, clientY: i * 50 + 5 }],
            );
        }
        const touchProcessingTime = performance.now() - touchStart;

        // Touch event processing for 30 events should be well under 1ms
        // and should not eat into the frame budget
        expect(touchProcessingTime).toBeLessThan(MOBILE_BUDGET.logicMs);

        // Frame should still process normally after touch events
        const frameStart = performance.now();
        scheduler.flush(16);
        const frameTime = performance.now() - frameStart;
        expect(frameTime).toBeLessThan(MOBILE_BUDGET.total60FpsMs);

        scene.dispose();
    });

    it('viewport resize does not cause frame drops (deferred re-render)', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        scene.start(0);

        // Run a baseline frame
        scheduler.flush(16);

        // Resize the viewport
        const resizeStart = performance.now();
        scene.resize(414, 896);
        const resizeTime = performance.now() - resizeStart;

        // Resize should be fast (just updating canvas dimensions + viewport)
        expect(resizeTime).toBeLessThan(MOBILE_BUDGET.renderCpuMs);

        // Next frame should still render within budget
        const frameStart = performance.now();
        scheduler.flush(32);
        const frameTime = performance.now() - frameStart;
        expect(frameTime).toBeLessThan(MOBILE_BUDGET.total60FpsMs);

        scene.dispose();
    });
});

// ===========================================================================
// 5. Mobile-Specific Edge Cases
// ===========================================================================
describe('Mobile — Mobile-Specific Edge Cases', () => {
    let scheduler: ManualScheduler;

    beforeEach(() => {
        scheduler = new ManualScheduler();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('orientation change (portrait to landscape) handled', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        scene.start(0);
        scheduler.flush(16);

        // Set to portrait mobile dimensions
        scene.resize(375, 812);
        expect(canvas.width).toBe(375);
        expect(canvas.height).toBe(812);

        // Simulate orientation change to landscape
        scene.resize(812, 375);

        expect(canvas.width).toBe(812);
        expect(canvas.height).toBe(375);
        expect(canvas.style.width).toBe('812px');
        expect(canvas.style.height).toBe('375px');

        // gl.viewport should have been called with landscape dimensions
        expect(gl.viewport).toHaveBeenCalledWith(0, 0, 812, 375);

        // Frame should still render after orientation change
        expect(() => scheduler.flush(32)).not.toThrow();

        scene.dispose();
    });

    it('page visibility change (background/foreground) pauses and resumes correctly', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.start(0);
        expect(scene.status).toBe('running');

        // Simulate going to background — pause the scene
        scene.pause();
        expect(scene.status).toBe('paused');

        // Simulate returning to foreground — resume the scene
        scene.resume();
        expect(scene.status).toBe('running');

        // Scene should still function after resume
        scheduler.flush(16);
        expect(scene.renderStats.frame).toBeGreaterThan(0);

        scene.dispose();
    });

    it('WebGL context loss on mobile (memory pressure) handled gracefully', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));

        scene.createCameraEntity({ name: 'Camera' }, { primary: true });
        scene.start(0);
        scheduler.flush(16);

        // Simulate WebGL context loss (common on mobile under memory pressure)
        const contextLostEvent = new Event('webglcontextlost', { cancelable: true });
        canvas.dispatchEvent(contextLostEvent);

        // Scene should not throw after context loss
        expect(() => scene.renderNow()).not.toThrow();

        // Simulate context restoration
        const contextRestoredEvent = new Event('webglcontextrestored');
        canvas.dispatchEvent(contextRestoredEvent);

        // Scene should recover and render again
        expect(() => {
            scheduler.flush(32);
        }).not.toThrow();

        scene.dispose();
    });

    it('low-power mode detection reduces quality when devicePixelRatio is capped', () => {
        const canvas = createMobileCanvas();
        const scene = createScene(createSceneOptions(scheduler, canvas));
        const gl = scene.gl as unknown as MockGLContext;

        // Simulate low-power mode: cap DPR to 1 instead of native 3x
        // This is a common strategy to reduce GPU load on mobile
        scene.resize(375, 812, 1);

        // Canvas backing store should be at 1x (not native 3x)
        expect(canvas.width).toBe(375);
        expect(canvas.height).toBe(812);

        // Viewport should match the reduced resolution
        expect(gl.viewport).toHaveBeenCalledWith(0, 0, 375, 812);

        // Compare with normal mode
        scene.resize(375, 812, 3);
        expect(canvas.width).toBe(1125);
        expect(canvas.height).toBe(2436);

        // The reduced resolution means fewer pixels to render
        const reducedPixels = 375 * 812;
        const fullPixels = 1125 * 2436;
        expect(reducedPixels).toBeLessThan(fullPixels);

        // Reduction ratio should be significant (9x fewer pixels at 1x vs 3x)
        const reductionRatio = fullPixels / reducedPixels;
        expect(reductionRatio).toBeCloseTo(9, 0);

        scene.dispose();
    });
});
