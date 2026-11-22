import { Actor, Transform, World } from '@axrone/ecs-runtime';
import { Vec3, Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { Camera } from '../components/camera';
import { MeshRenderer } from '../components/mesh-renderer';
import type { SceneMaterialResource } from '../material-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneRenderPassResource } from '../rendering/render-pass-registry';
import { SceneRenderRuntime } from '../rendering/scene-render-runtime';
import { createSceneRegistry } from '../scene-registry';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneMeshDefinition } from '../types';

const createMockGL = () => {
    const gl = {
        ARRAY_BUFFER: 0x8892,
        DYNAMIC_DRAW: 0x88e8,
        FLOAT: 0x1406,
        FLOAT_VEC3: 0x8b51,
        FLOAT_MAT4: 0x8b5c,
        INT: 0x1404,
        BOOL: 0x8b56,
        TRIANGLES: 0x0004,
        LINES: 0x0001,
        POINTS: 0x0000,
        COLOR_BUFFER_BIT: 0x4000,
        DEPTH_BUFFER_BIT: 0x0100,
        FRAMEBUFFER: 0x8d40,
        READ_FRAMEBUFFER: 0x8ca8,
        DRAW_FRAMEBUFFER: 0x8ca9,
        DEPTH_TEST: 0x0b71,
        CULL_FACE: 0x0b44,
        BLEND: 0x0be2,
        STENCIL_TEST: 0x0b90,
        BACK: 0x0405,
        FRONT: 0x0404,
        CCW: 0x0901,
        CW: 0x0900,
        KEEP: 0x1e00,
        ZERO: 0,
        REPLACE: 0x1e01,
        INVERT: 0x150a,
        INCR: 0x1e02,
        INCR_WRAP: 0x8507,
        DECR: 0x1e03,
        DECR_WRAP: 0x8508,
        ONE: 1,
        SRC_ALPHA: 0x0302,
        ONE_MINUS_SRC_ALPHA: 0x0303,
        FUNC_ADD: 0x8006,
        POLYGON_OFFSET_FILL: 0x8037,
        SAMPLE_ALPHA_TO_COVERAGE: 0x809e,
        RASTERIZER_DISCARD: 0x8c89,
        TEXTURE_MIN_FILTER: 0x2801,
        TEXTURE_MAG_FILTER: 0x2800,
        TEXTURE_WRAP_S: 0x2802,
        TEXTURE_WRAP_T: 0x2803,
        TEXTURE_WRAP_R: 0x8072,
        CLAMP_TO_EDGE: 0x812f,
        NEAREST: 0x2600,
        NONE: 0,
        LESS: 0x0201,
        TEXTURE0: 0x84c0,
        TEXTURE_2D: 0x0de1,
        RGBA8: 0x8058,
        RGBA: 0x1908,
        UNSIGNED_BYTE: 0x1401,
        DEPTH_COMPONENT24: 0x81a6,
        DEPTH_COMPONENT: 0x1902,
        UNSIGNED_INT: 0x1405,
        viewport: vi.fn(),
        clearColor: vi.fn(),
        clearDepth: vi.fn(),
        clear: vi.fn(),
        createTexture: vi.fn(() => ({}) as WebGLTexture),
        deleteTexture: vi.fn(),
        bindTexture: vi.fn(),
        texParameteri: vi.fn(),
        texStorage2D: vi.fn(),
        texStorage3D: vi.fn(),
        bindFramebuffer: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        frontFace: vi.fn(),
        cullFace: vi.fn(),
        blendEquationSeparate: vi.fn(),
        blendFuncSeparate: vi.fn(),
        blendColor: vi.fn(),
        colorMask: vi.fn(),
        depthMask: vi.fn(),
        depthFunc: vi.fn(),
        stencilFuncSeparate: vi.fn(),
        stencilMaskSeparate: vi.fn(),
        stencilOpSeparate: vi.fn(),
        polygonOffset: vi.fn(),
        lineWidth: vi.fn(),
        useProgram: vi.fn(),
        bindVertexArray: vi.fn(),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        bindSampler: vi.fn(),
        activeTexture: vi.fn(),
        uniformMatrix4fv: vi.fn(),
        uniform3f: vi.fn(),
        uniform1f: vi.fn(),
        uniform1i: vi.fn(),
        uniform3fv: vi.fn(),
        uniform1fv: vi.fn(),
        uniform1iv: vi.fn(),
        drawArrays: vi.fn(),
        drawElements: vi.fn(),
    };

    return gl as unknown as WebGL2RenderingContext;
};

const createSceneShader = (gl: WebGL2RenderingContext): SceneShaderResource => ({
    id: 'shader',
    program: {} as WebGLProgram,
    uniformLocations: new Map(),
    uniformTypes: new Map([
        ['u_ReceiveLighting', gl.BOOL],
        ['u_DirectionalLightCount', gl.INT],
        ['u_DirectionalLightColor', gl.FLOAT_VEC3],
        ['u_DirectionalLightIntensity', gl.FLOAT],
        ['u_PointLightCount', gl.INT],
        ['u_PointLightPosition', gl.FLOAT_VEC3],
    ]),
    uniformNames: [],
    attributeNames: { position: 'a_Position' },
    depthTest: false,
    cull: false,
    blend: false,
});

describe('SceneRenderRuntime render caches', () => {
    it('reports item and primitive cache hits while the static scene is unchanged', () => {
        const gl = createMockGL();
        const world = new World(createSceneRegistry());

        const cameraActor = new Actor(world);
        cameraActor.addComponent(Camera, { primary: true });
        cameraActor.requireComponent(Transform);

        const rendererActor = new Actor(world);
        rendererActor.addComponent(MeshRenderer, {
            meshId: 'mesh',
            materialId: 'material',
            passId: 'main',
            receiveLighting: false,
        });
        const rendererTransform = rendererActor.requireComponent(Transform);

        const mesh: SceneMeshResource = {
            id: 'mesh',
            vertexArray: {} as WebGLVertexArrayObject,
            vertexBuffer: {} as WebGLBuffer,
            indexBuffer: null,
            vertexCount: 3,
            indexCount: 0,
            indexType: null,
            topology: 'triangles',
            mode: gl.TRIANGLES,
            attributes: new Set(['position']),
        };
        const meshDefinition: SceneMeshDefinition = {
            id: 'mesh',
            vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            attributes: [{ semantic: 'position', componentCount: 3, offset: 0, stride: 12 }],
            vertexCount: 3,
            topology: 'triangles',
        };
        const material: SceneMaterialResource = {
            id: 'material',
            shaderId: 'shader',
            uniforms: new Map(),
            textureBindings: new Map(),
            surface: null,
            passes: Object.freeze([]),
        };
        const renderPass: SceneRenderPassResource = {
            id: 'main',
            order: 0,
            rendererPassId: 'main',
            materialPassId: null,
            enabled: true,
            clearFlags: [],
            clearColor: null,
            clearDepth: null,
        };
        const shader = createSceneShader(gl);
        const resources = {
            materials: {
                revision: 0,
                get: (id: string) => (id === material.id ? material : undefined),
                getTextureSlots: () => Object.freeze([]),
            },
            meshes: {
                revision: 0,
                get: (id: string) => (id === mesh.id ? mesh : undefined),
                getDefinition: (id: string) => (id === mesh.id ? meshDefinition : undefined),
            },
            shaders: {
                get: (id: string) => (id === shader.id ? shader : undefined),
            },
            textures: {
                get: () => undefined,
            },
            renderPasses: {
                getEnabledResources: () => [renderPass],
            },
            resolveSampler: () => ({
                bind: vi.fn(),
                nativeHandle: null,
            }),
        } as unknown as SceneResourceRuntime;
        const runtime = new SceneRenderRuntime({
            gl,
            resources,
            ambientLight: Vec3.ZERO.clone(),
            skyLight: Vec3.ZERO.clone(),
            groundLight: Vec3.ZERO.clone(),
            defaultClearColor: new Vec4(0, 0, 0, 1),
            getActors: () => world.getAllActors(),
            createMeshResource: vi.fn(() => mesh),
            disposeMesh: vi.fn(),
            applyMissingVertexAttributeDefaults: vi.fn(),
        });

        const renderFrame = (frame: number) =>
            runtime.render({
                frame,
                elapsedSeconds: frame,
                deltaSeconds: 1 / 60,
                viewportWidth: 640,
                viewportHeight: 360,
            });

        renderFrame(1);
        expect(runtime.stats.planning.renderListCacheHit).toBe(false);
        expect(runtime.stats.planning.primitiveCacheHit).toBe(false);

        renderFrame(2);
        expect(runtime.stats.planning.renderListCacheHit).toBe(true);
        expect(runtime.stats.planning.primitiveCacheHit).toBe(true);
        expect(runtime.stats.drawCalls).toBe(1);

        // A transform change invalidates both caches.
        rendererTransform.position = new Vec3(1, 0, 0);
        renderFrame(3);
        expect(runtime.stats.planning.renderListCacheHit).toBe(false);
        expect(runtime.stats.planning.primitiveCacheHit).toBe(false);
        expect(runtime.stats.drawCalls).toBe(1);

        // And the next unchanged frame is cached again.
        renderFrame(4);
        expect(runtime.stats.planning.renderListCacheHit).toBe(true);
        expect(runtime.stats.planning.primitiveCacheHit).toBe(true);
    });
});
