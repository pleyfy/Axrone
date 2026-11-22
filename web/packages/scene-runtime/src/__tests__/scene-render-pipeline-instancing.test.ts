import { Mat4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { SceneRenderFrameState } from '../rendering/render-frame-state';
import { SceneRenderPipeline } from '../rendering/scene-render-pipeline';

const createMockGL = (): WebGL2RenderingContext => {
    let nextTextureId = 1;
    let nextFramebufferId = 1;
    let nextVertexArrayId = 1;

    return {
        FRAMEBUFFER: 0x8d40,
        READ_FRAMEBUFFER: 0x8ca8,
        DRAW_FRAMEBUFFER: 0x8ca9,
        DEPTH_TEST: 0x0b71,
        CULL_FACE: 0x0b44,
        BLEND: 0x0be2,
        TEXTURE_2D: 0x0de1,
        TEXTURE0: 0x84c0,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        CLAMP_TO_EDGE: 0x812f,
        NEAREST: 0x2600,
        COLOR_ATTACHMENT0: 0x8ce0,
        DEPTH_ATTACHMENT: 0x8d00,
        COLOR_BUFFER_BIT: 0x4000,
        DEPTH_BUFFER_BIT: 0x0100,
        RGBA8: 0x8058,
        RGBA16F: 0x881a,
        RGBA: 0x1908,
        HALF_FLOAT: 0x140b,
        UNSIGNED_BYTE: 0x1401,
        FLOAT: 0x1406,
        TRIANGLES: 0x0004,
        VERTEX_SHADER: 0x8b31,
        FRAGMENT_SHADER: 0x8b30,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS: 0x8b82,
        DEPTH_COMPONENT24: 0x81a6,
        DEPTH_COMPONENT: 0x1902,
        UNSIGNED_INT: 0x1405,
        createShader: vi.fn(() => ({}) as unknown as WebGLShader),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        getShaderInfoLog: vi.fn(() => ''),
        deleteShader: vi.fn(),
        createProgram: vi.fn(() => ({}) as unknown as WebGLProgram),
        attachShader: vi.fn(),
        linkProgram: vi.fn(),
        getProgramParameter: vi.fn(() => true),
        getProgramInfoLog: vi.fn(() => ''),
        deleteProgram: vi.fn(),
        getUniformLocation: vi.fn(
            (_program: WebGLProgram, name: string) => ({ name }) as unknown as WebGLUniformLocation
        ),
        useProgram: vi.fn(),
        createVertexArray: vi.fn(
            () => ({ id: nextVertexArrayId++ }) as unknown as WebGLVertexArrayObject
        ),
        bindVertexArray: vi.fn(),
        deleteVertexArray: vi.fn(),
        createTexture: vi.fn(() => ({ id: nextTextureId++ }) as unknown as WebGLTexture),
        deleteTexture: vi.fn(),
        bindTexture: vi.fn(),
        activeTexture: vi.fn(),
        texParameteri: vi.fn(),
        texStorage2D: vi.fn(),
        createFramebuffer: vi.fn(
            () => ({ id: nextFramebufferId++ }) as unknown as WebGLFramebuffer
        ),
        deleteFramebuffer: vi.fn(),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        drawBuffers: vi.fn(),
        viewport: vi.fn(),
        clearColor: vi.fn(),
        clearDepth: vi.fn(),
        clear: vi.fn(),
        clearStencil: vi.fn(),
        blitFramebuffer: vi.fn(),
        disable: vi.fn(),
        depthMask: vi.fn(),
        colorMask: vi.fn(),
        uniform2f: vi.fn(),
        uniform3f: vi.fn(),
        uniform4f: vi.fn(),
        uniform1i: vi.fn(),
        uniform1f: vi.fn(),
        drawArrays: vi.fn(),
    } as unknown as WebGL2RenderingContext;
};

const createRenderParams = (
    frameState: SceneRenderFrameState,
    overrides: Record<string, unknown> = {}
) => ({
    actors: [],
    frame: 1,
    deltaSeconds: 1 / 60,
    viewportWidth: 640,
    viewportHeight: 360,
    cameraFrame: {
        camera: {
            id: 'camera:main',
            clearFlags: ['color', 'depth'],
            clearColor: [0.1, 0.2, 0.3, 1],
            clearDepth: 1,
            near: 0.1,
            far: 100,
        },
        viewMatrix: new Mat4(),
        projectionMatrix: new Mat4(),
        viewProjectionMatrix: new Mat4(),
        camera3D: { frustum: {} },
        position: [0, 0, 5],
    } as any,
    lighting: {
        stats: {
            selectedDirectionalCount: 0,
            selectedPointCount: 0,
            selectedSpotCount: 0,
        },
    } as any,
    renderPass: {
        id: 'main',
        rendererPassId: 'main',
        materialPassId: null,
        clearFlags: ['color', 'depth'],
        clearColor: null,
        clearDepth: null,
    } as any,
    drawContext: { fog: { enabled: false } } as any,
    frameState,
    renderItems: [
        {
            renderer: {
                id: 'renderer:cube',
                meshId: 'mesh:cube',
                renderOrder: 0,
                visible: true,
                receiveLighting: true,
            },
            transform: {
                worldMatrix: new Mat4(),
            },
        },
    ] as any,
    resolveBounds: () => null,
    resolveMaterial: () => ({
        materialId: 'material:cube',
        shadingModel: 'pbr',
        alphaMode: 'opaque',
        transparent: false,
    }),
    ...overrides,
});

const createInstancedRuntime = (plan: any) => ({
    build: vi.fn(() => plan),
    draw: vi.fn(() => 1),
});

const createPlan = () => ({
    groups: [{ key: 'group' }],
    individualItems: [],
    instanceCount: 1,
    groupCount: 1,
    uploadCount: 1,
    reused: false,
});

describe('SceneRenderPipeline instancing integration', () => {
    it('is inert when instancing stays off', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const runtime = createInstancedRuntime(createPlan());
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: { execute },
            instancedMeshRuntime: runtime,
        });

        pipeline.render(createRenderParams(new SceneRenderFrameState().begin(1)));

        expect(runtime.build).not.toHaveBeenCalled();
        expect(runtime.draw).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledTimes(1);
        pipeline.dispose();
    });

    it('draws instance groups in the opaque pass and skips per-item draws', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const runtime = createInstancedRuntime(createPlan());
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: { execute },
            instancing: 'auto',
            instancedMeshRuntime: runtime,
        });

        const stats = pipeline.render(createRenderParams(new SceneRenderFrameState().begin(1)));

        expect(runtime.build).toHaveBeenCalledTimes(1);
        expect(runtime.draw).toHaveBeenCalledTimes(1);
        expect(execute).not.toHaveBeenCalled();
        expect(stats).toEqual(
            expect.objectContaining({
                instancing: 'auto',
                instancedGroupCount: 1,
                instancedInstanceCount: 1,
                instancedDrawCalls: 1,
                instancedPlanReused: false,
                opaqueCount: 1,
            })
        );
        pipeline.dispose();
    });

    it('keeps the individual path for render items the plan does not claim', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const plan = createPlan();
        plan.individualItems = [
            {
                renderer: {
                    id: 'renderer:cube',
                    meshId: 'mesh:cube',
                    renderOrder: 0,
                    visible: true,
                    receiveLighting: true,
                },
                transform: { worldMatrix: new Mat4() },
            },
        ] as any;
        const runtime = createInstancedRuntime(plan);
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: { execute },
            instancing: 'auto',
            instancedMeshRuntime: runtime,
        });

        const stats = pipeline.render(createRenderParams(new SceneRenderFrameState().begin(1)));

        expect(runtime.draw).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(stats.opaqueCount).toBe(2);
        pipeline.dispose();
    });

    it('forwards the render-list cache hit as the plan stability signal', () => {
        const gl = createMockGL();
        const runtime = createInstancedRuntime(createPlan());
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: { execute: vi.fn() },
            instancing: 'auto',
            instancedMeshRuntime: runtime,
            capabilities: undefined,
        });

        pipeline.render(
            createRenderParams(new SceneRenderFrameState().begin(1), {
                renderListCacheHit: true,
                materialRevision: 4,
                meshRevision: 5,
                shaderRevision: 6,
            })
        );

        expect(runtime.build).toHaveBeenCalledWith(
            expect.objectContaining({
                stable: true,
                materialRevision: 4,
                meshRevision: 5,
                shaderRevision: 6,
            })
        );
        pipeline.dispose();
    });
});
