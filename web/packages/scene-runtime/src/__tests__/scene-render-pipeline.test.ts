import { Mat4, Vec3 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { Transform } from '@axrone/ecs-runtime';
import { MeshRenderer } from '../components/mesh-renderer';
import { SceneRenderFrameState } from '../rendering/render-frame-state';
import { SceneRenderPipeline } from '../rendering/scene-render-pipeline';

const createMockGL = (): WebGL2RenderingContext => {
    let nextTextureId = 1;
    let nextFramebufferId = 1;
    let nextShaderId = 1;
    let nextProgramId = 1;
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
        FRAMEBUFFER_COMPLETE: 0x8cd5,
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
        createShader: vi.fn(
            (type: number) => ({ id: nextShaderId++, type }) as unknown as WebGLShader
        ),
        shaderSource: vi.fn(),
        compileShader: vi.fn(),
        getShaderParameter: vi.fn(() => true),
        getShaderInfoLog: vi.fn(() => ''),
        deleteShader: vi.fn(),
        createProgram: vi.fn(() => ({ id: nextProgramId++ }) as unknown as WebGLProgram),
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
        checkFramebufferStatus: vi.fn(() => 0x8cd5),
        getParameter: vi.fn((pname: number) => {
            if (pname === 0x0ba2) {
                return new Int32Array([0, 0, 640, 360]);
            }

            return null;
        }),
        isEnabled: vi.fn(() => false),
        enable: vi.fn(),
        pixelStorei: vi.fn(),
        getError: vi.fn(() => 0),
        bindRenderbuffer: vi.fn(),
        createRenderbuffer: vi.fn(() => ({ id: 1 }) as unknown as WebGLRenderbuffer),
    } as unknown as WebGL2RenderingContext;
};

describe('SceneRenderPipeline', () => {
    it('routes HDR scene frames through tonemap and present passes', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: {
                execute,
            },
            pipeline: {
                hdr: true,
            },
        });
        const frameState = new SceneRenderFrameState().begin(1);

        const stats = pipeline.render({
            entities: [],
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
                camera3D: {
                    frustum: {},
                },
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
                clearFlags: ['color', 'depth'],
                clearColor: null,
                clearDepth: null,
            } as any,
            drawContext: {} as any,
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
        });

        expect(execute).toHaveBeenCalledTimes(1);
        expect(stats).toEqual(
            expect.objectContaining({
                passCount: 3,
                opaqueCount: 1,
                transparentCount: 0,
            })
        );
        expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);
        expect(gl.blitFramebuffer).toHaveBeenCalledTimes(1);

        pipeline.dispose();
    });

    it('routes configured post-process effects through the fullscreen backend path', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: {
                execute,
            },
            pipeline: {
                postProcess: [{ category: 'builtin', name: 'vignette' }],
            },
        });
        const frameState = new SceneRenderFrameState().begin(1);

        const stats = pipeline.render({
            entities: [],
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
                camera3D: {
                    frustum: {},
                },
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
                clearFlags: ['color', 'depth'],
                clearColor: null,
                clearDepth: null,
            } as any,
            drawContext: {} as any,
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
        });

        expect(execute).toHaveBeenCalledTimes(1);
        expect(stats).toEqual(
            expect.objectContaining({
                passCount: 3,
                opaqueCount: 1,
                transparentCount: 0,
            })
        );
        expect(gl.drawArrays).toHaveBeenCalledWith(gl.TRIANGLES, 0, 3);
        expect(gl.blitFramebuffer).toHaveBeenCalledTimes(1);

        pipeline.dispose();
    });

    it('owns sprite batching and transparent budget aggregation for the active render pass', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const spriteRender = vi.fn(() => ({
            drawnSpriteCount: 2,
            spriteBatchCount: 1,
            skippedSpriteCount: 1,
            warnings: ['sprite budget warning'],
        }));
        const spriteClear = vi.fn();
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: {
                execute,
            },
            planning: {
                maxTransparentPrimitives: 5,
            },
            spriteBatchRuntime: {
                render: spriteRender,
                clear: spriteClear,
            },
        });
        const frameState = new SceneRenderFrameState().begin(1);

        const stats = pipeline.render({
            entities: [{} as any],
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
                camera3D: {
                    frustum: {},
                },
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
                clearFlags: ['color', 'depth'],
                clearColor: null,
                clearDepth: null,
            } as any,
            drawContext: {} as any,
            frameState,
            renderItems: [
                {
                    renderer: {
                        id: 'renderer:glass',
                        meshId: 'mesh:glass',
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
                materialId: 'material:glass',
                shadingModel: 'pbr',
                alphaMode: 'blend',
                transparent: true,
            }),
        });

        expect(execute).toHaveBeenCalledTimes(1);
        expect(spriteRender).toHaveBeenCalledWith(
            expect.objectContaining({
                transparentBudget: {
                    total: 5,
                    remaining: 4,
                },
            })
        );
        expect(stats).toEqual(
            expect.objectContaining({
                transparentCount: 3,
                meshTransparentCount: 1,
                spriteTransparentCount: 2,
                spriteBatchCount: 1,
                skippedSpriteCount: 1,
                warnings: ['sprite budget warning'],
            })
        );

        pipeline.reset();
        expect(spriteClear).toHaveBeenCalledTimes(1);
        pipeline.dispose();
        expect(spriteClear).toHaveBeenCalledTimes(2);
    });

    it('reuses cached primitives while item and registry revisions are unchanged', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: {
                execute,
            },
        });

        const transform = new Transform();
        const renderer = new MeshRenderer({
            meshId: 'mesh:cube',
            materialId: 'material:cube',
            passId: 'main',
        });
        const renderItems = [{ transform, renderer }];
        const renderPass = {
            id: 'main',
            rendererPassId: 'main',
            clearFlags: ['color', 'depth'],
            clearColor: null,
            clearDepth: null,
        } as any;
        const cameraFrame = {
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
            camera3D: {
                frustum: {},
            },
            position: [0, 0, 5],
        } as any;
        const lighting = {
            stats: {
                selectedDirectionalCount: 0,
                selectedPointCount: 0,
                selectedSpotCount: 0,
            },
        } as any;
        const resolveMaterial = vi.fn(() => ({
            materialId: 'material:cube',
            shadingModel: 'pbr' as const,
            alphaMode: 'opaque' as const,
            transparent: false,
        }));

        const renderFrame = (materialRevision: number, shaderRevision = 0) =>
            pipeline.render({
                entities: [{} as any],
                frame: 1,
                deltaSeconds: 1 / 60,
                viewportWidth: 640,
                viewportHeight: 360,
                cameraFrame,
                lighting,
                renderPass,
                drawContext: {} as any,
                frameState: new SceneRenderFrameState().begin(1),
                renderItems,
                materialRevision,
                meshRevision: 1,
                shaderRevision,
                resolveBounds: () => null,
                resolveMaterial,
            });

        const first = renderFrame(1);
        expect(first.primitiveCacheHit).toBe(false);
        expect(resolveMaterial).toHaveBeenCalledTimes(1);

        const second = renderFrame(1);
        expect(second.primitiveCacheHit).toBe(true);
        expect(resolveMaterial).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(2);

        renderer.materialId = 'material:other';
        const third = renderFrame(1);
        expect(third.primitiveCacheHit).toBe(false);
        expect(resolveMaterial).toHaveBeenCalledTimes(2);

        const fourth = renderFrame(2);
        expect(fourth.primitiveCacheHit).toBe(false);
        expect(resolveMaterial).toHaveBeenCalledTimes(3);

        const fifth = renderFrame(2, 1);
        expect(fifth.primitiveCacheHit).toBe(false);
        expect(resolveMaterial).toHaveBeenCalledTimes(4);

        pipeline.dispose();
    });

    it('refreshes retained primitives for transform-only frames without re-resolving materials', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const pipeline = new SceneRenderPipeline({
            gl,
            drawExecutor: {
                execute,
            },
        });

        const transform = new Transform();
        const renderer = new MeshRenderer({
            meshId: 'mesh:cube',
            materialId: 'material:cube',
            passId: 'main',
        });
        const renderItems = [{ transform, renderer }];
        const renderPass = {
            id: 'main',
            rendererPassId: 'main',
            clearFlags: ['color', 'depth'],
            clearColor: null,
            clearDepth: null,
        } as any;
        const cameraFrame = {
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
            camera3D: {
                frustum: {},
            },
            position: [0, 0, 5],
        } as any;
        const lighting = {
            stats: {
                selectedDirectionalCount: 0,
                selectedPointCount: 0,
                selectedSpotCount: 0,
            },
        } as any;
        const resolveMaterial = vi.fn(() => ({
            materialId: 'material:cube',
            shadingModel: 'pbr' as const,
            alphaMode: 'opaque' as const,
            transparent: false,
        }));

        const renderFrame = () =>
            pipeline.render({
                entities: [{} as any],
                frame: 1,
                deltaSeconds: 1 / 60,
                viewportWidth: 640,
                viewportHeight: 360,
                cameraFrame,
                lighting,
                renderPass,
                drawContext: {} as any,
                frameState: new SceneRenderFrameState().begin(1),
                renderItems,
                materialRevision: 1,
                meshRevision: 1,
                shaderRevision: 0,
                resolveBounds: () => null,
                resolveMaterial,
            });

        renderFrame();
        expect(resolveMaterial).toHaveBeenCalledTimes(1);

        // Dynamic frame: only the transform revision changes.
        transform.position = new Vec3(3, 0, 0);
        const dynamic = renderFrame();

        expect(dynamic.primitiveCacheHit).toBe(false);
        // No rebuild: material snapshot/ids are retained.
        expect(resolveMaterial).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(2);

        // The sequence continues to render after the incremental update.
        transform.position = new Vec3(4, 0, 0);
        renderFrame();
        expect(resolveMaterial).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(3);

        pipeline.dispose();
    });
});

describe('SceneRenderPipeline offscreen multi-pass scheduling', () => {
    const createFrameParams = (
        frame: number,
        enabledMaterialPassIds?: readonly string[]
    ): any => ({
        entities: [] as any[],
        frame,
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
        },
        lighting: {
            stats: {
                selectedDirectionalCount: 0,
                selectedPointCount: 0,
                selectedSpotCount: 0,
            },
        },
        renderPass: {
            id: 'main',
            rendererPassId: 'main',
            materialPassId: null,
            clearFlags: ['color', 'depth'],
            clearColor: null,
            clearDepth: null,
        },
        drawContext: { frame },
        frameState: new SceneRenderFrameState().begin(frame),
        renderItems: [
            {
                renderer: {
                    id: 'renderer:glass',
                    meshId: 'mesh:glass',
                    renderOrder: 0,
                    visible: true,
                    receiveLighting: true,
                },
                transform: { worldMatrix: new Mat4() },
            },
        ],
        resolveBounds: () => null,
        resolveMaterial: () => ({
            materialId: 'material:glass',
            shadingModel: 'pbr',
            alphaMode: 'blend',
            transparent: true,
        }),
        ...(enabledMaterialPassIds ? { enabledMaterialPassIds } : {}),
    });

    it('resolves the scene colour and blurs it between the opaque and transparent draws', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const pipeline = new SceneRenderPipeline({ gl, drawExecutor: { execute } });
        const createdBefore = gl.createFramebuffer.mock.calls.length;

        const stats = pipeline.render(
            createFrameParams(1, ['refraction-copy', 'sss-blur'])
        );

        expect(stats.refractionCopyCount).toBe(1);
        expect(stats.sssBlurCount).toBe(1);
        // The copy is a blit of what is already in the frame buffer, so it adds
        // no scene primitive draw of its own.
        expect(gl.blitFramebuffer).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(gl.createFramebuffer.mock.calls.length - createdBefore).toBe(2);
        // One target for the copy, one for the blur.
        expect(gl.framebufferTexture2D).toHaveBeenCalledTimes(2);

        pipeline.dispose();
    });

    it('runs the offscreen resolve at most once per frame across scene passes', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const pipeline = new SceneRenderPipeline({ gl, drawExecutor: { execute } });
        const params = createFrameParams(7, ['refraction-copy', 'sss-blur']);

        const first = pipeline.render(params);
        const second = pipeline.render(params);

        expect(first.refractionCopyCount).toBe(1);
        expect(second.refractionCopyCount).toBe(0);
        expect(second.sssBlurCount).toBe(0);
        expect(gl.blitFramebuffer).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(2);

        pipeline.render(createFrameParams(8, ['refraction-copy', 'sss-blur']));
        expect(gl.blitFramebuffer).toHaveBeenCalledTimes(2);

        pipeline.dispose();
    });

    it('keeps an ungated frame free of offscreen work', () => {
        const gl = createMockGL();
        const execute = vi.fn();
        const pipeline = new SceneRenderPipeline({ gl, drawExecutor: { execute } });

        const ungated = pipeline.render(createFrameParams(1));
        const zeroGated = pipeline.render(createFrameParams(2, ['main', 'forward-add']));

        expect(ungated.refractionCopyCount).toBe(0);
        expect(ungated.sssBlurCount).toBe(0);
        expect(zeroGated.refractionCopyCount).toBe(0);
        expect(zeroGated.sssBlurCount).toBe(0);
        expect(gl.blitFramebuffer).not.toHaveBeenCalled();
        expect(gl.createFramebuffer).not.toHaveBeenCalled();
        expect(gl.deleteFramebuffer).not.toHaveBeenCalled();

        pipeline.dispose();
    });

    it('schedules the blur alone without dropping its copy dependency', () => {
        const gl = createMockGL();
        const pipeline = new SceneRenderPipeline({ gl, drawExecutor: { execute: vi.fn() } });

        const stats = pipeline.render(createFrameParams(1, ['sss-blur']));

        expect(stats.refractionCopyCount).toBe(1);
        expect(stats.sssBlurCount).toBe(1);
        expect(gl.blitFramebuffer).toHaveBeenCalledTimes(1);

        pipeline.dispose();
    });

    it('allocates the offscreen targets once and releases both on dispose', () => {
        const gl = createMockGL();
        const pipeline = new SceneRenderPipeline({ gl, drawExecutor: { execute: vi.fn() } });
        const params = () => createFrameParams(1, ['refraction-copy', 'sss-blur']);

        pipeline.render(params());
        const createdAfterFirst = gl.createFramebuffer.mock.calls.length;
        pipeline.render(params());
        pipeline.render(params());

        // Every call carries the same frame number, so the resolve runs once;
        // reset() proves the targets themselves are retained across frames.
        expect(gl.createFramebuffer.mock.calls.length).toBe(createdAfterFirst);
        expect(gl.deleteFramebuffer).not.toHaveBeenCalled();

        pipeline.dispose();

        // Every framebuffer created for the offscreen passes is released: this
        // run has no other framebuffer source, so the counts must match exactly.
        expect(gl.createFramebuffer.mock.calls.length).toBe(2);
        expect(gl.deleteFramebuffer.mock.calls.length).toBe(
            gl.createFramebuffer.mock.calls.length
        );
        expect(gl.deleteTexture.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('rebuilds the offscreen targets after the viewport changes size', () => {
        const gl = createMockGL();
        const pipeline = new SceneRenderPipeline({ gl, drawExecutor: { execute: vi.fn() } });
        const params = (width: number, frame: number) => ({
            ...createFrameParams(frame, ['refraction-copy']),
            viewportWidth: width,
        });

        pipeline.render(params(640, 1));
        const createdAfterFirst = gl.createFramebuffer.mock.calls.length;
        pipeline.render(params(1280, 2));

        expect(gl.createFramebuffer.mock.calls.length - createdAfterFirst).toBe(2);
        expect(gl.blitFramebuffer).toHaveBeenCalledTimes(2);

        pipeline.dispose();
    });
});
